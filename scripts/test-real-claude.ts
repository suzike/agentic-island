// 真机联调：用真实的 `claude` 二进制端到端验证。
// 在临时项目里装项目级 .claude/settings.json 的 PreToolUse hook（指向 cc-forward.mjs），
// 启动桥并自动放行，然后 `claude -p` 让它用 Bash 工具执行命令，
// 断言：真实 Claude Code 的权限请求确实经 hook → 桥 流到了岛的状态机。

import { spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentsStore } from '../src/main/agents-store.ts'
import { BridgeServer } from '../src/main/bridge-server.ts'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// 测试桥用临时发现文件，绝不覆盖真实 bridge.json（否则真实 hook 全打到死端口）
const TEST_BRIDGE_FILE = join(mkdtempSync(join(tmpdir(), 'aiisland-test-')), 'bridge.json')
process.env.AIISLAND_BRIDGE_FILE = TEST_BRIDGE_FILE

async function run(): Promise<void> {
  const script = join(process.cwd(), 'src', 'hooks-bin', 'cc-forward.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'aiisland-real-'))
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: `node "${script}" claude-code PreToolUse` }] }
          ]
        }
      },
      null,
      2
    )
  )

  const store = new AgentsStore()
  const bridge = new BridgeServer(store, undefined, TEST_BRIDGE_FILE)
  await bridge.start()

  // 自动放行：真实 claude 的请求一到就 allow，避免卡住
  const captured: { tool?: string; command?: string }[] = []
  store.on('change', () => {
    for (const a of store.snapshot().agents) {
      if (a.status === 'needs_approval' && a.requestId) {
        captured.push({ tool: a.tool, command: a.command })
        console.log(`[island] ← 真实 claude 请求：${a.command || a.tool}`)
        store.decide(a.requestId, 'allow')
      }
    }
  })

  console.log(`[harness] 启动真实 claude（临时项目 ${dir}）…`)
  const child = spawn(
    'claude',
    ['-p', 'Use the Bash tool to run exactly: echo hello-from-island', '--allowedTools', 'Bash', '--max-turns', '4'],
    { cwd: dir, shell: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let out = ''
  child.stdout.on('data', (c) => (out += c))
  child.stderr.on('data', (c) => (out += c))

  const timeout = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 150000))
  const done = new Promise<'done'>((res) => child.on('close', () => res('done')))
  const result = await Promise.race([done, timeout])
  if (result === 'timeout' && child.pid) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: true }) } catch { /* */ }
  }

  await sleep(500)
  bridge.stop()
  console.log(`[harness] claude 结束(${result})，输出片段：`, out.slice(0, 240).replace(/\n/g, ' '))
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }) } catch { /* Windows 句柄残留，忽略 */ }
  if (captured.length > 0) {
    console.log(`\n✅ 真机联调通过：真实 Claude Code 触发了 ${captured.length} 次权限请求，全部经 hook→桥 到达岛并被放行`)
    process.exit(0)
  }
  console.log('\n⚠️ 未捕获到权限请求（claude 可能未调用 Bash、需登录、或不可达）。headless 闭环已另行验证；可手动按下方步骤真机联调。')
  process.exit(2)
}

run().catch((e) => { console.error('异常', e); process.exit(1) })
