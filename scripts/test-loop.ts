// M1 端到端验证（无 GUI）：真实启动本地桥 → 用真实 cc-forward.mjs 转发一条 PreToolUse
// → 确认岛状态机出现待审批请求 → 模拟用户裁决 → 确认转发脚本拿到决定并打印正确 JSON。
// 覆盖全项目最大风险点：hook 阻塞审批闭环是否成立。

import { spawn } from 'child_process'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { AgentsStore } from '../src/main/agents-store.ts'
import { BridgeServer } from '../src/main/bridge-server.ts'

// 测试桥用临时发现文件，绝不覆盖真实 bridge.json（否则真实 hook 全打到死端口）
const TEST_BRIDGE_FILE = join(mkdtempSync(join(tmpdir(), 'aiisland-test-')), 'bridge.json')
process.env.AIISLAND_BRIDGE_FILE = TEST_BRIDGE_FILE

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function run(): Promise<void> {
  const store = new AgentsStore()
  const bridge = new BridgeServer(store, undefined, TEST_BRIDGE_FILE)
  const { port } = await bridge.start()
  console.log(`[bridge] listening on 127.0.0.1:${port}`)

  const script = join(process.cwd(), 'src', 'hooks-bin', 'cc-forward.mjs')
  const payload = JSON.stringify({
    session_id: 'test-sess',
    cwd: process.cwd(),
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf dist/ && npm run build' }
  })

  // 启动真实转发脚本，喂入 PreToolUse
  const child = spawn('node', [script, 'claude-code', 'PreToolUse'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  child.stdout.on('data', (c) => (stdout += c))
  child.stdin.write(payload)
  child.stdin.end()

  // 等待请求抵达状态机
  await sleep(400)
  let snap = store.snapshot()
  const pending = snap.agents.find((a) => a.status === 'needs_approval')
  if (!pending || !pending.requestId) {
    console.error('❌ 未捕获到待审批请求')
    process.exit(1)
  }
  console.log(`[island] 收到待审批：${pending.tool} · ${pending.proj} · cmd="${pending.command}"`)

  // 转发脚本此刻应仍在阻塞（尚未输出）
  if (stdout.trim().length > 0) {
    console.error('❌ 转发脚本在裁决前就返回了（未阻塞）:', stdout)
    process.exit(1)
  }
  console.log('[forwarder] 正确阻塞中，等待用户裁决…')

  // 模拟用户点击「允许」
  store.decide(pending.requestId, 'allow')

  const code: number = await new Promise((resolve) => child.on('close', resolve))
  console.log(`[forwarder] 退出码 ${code}，输出：${stdout.trim()}`)

  const parsed = JSON.parse(stdout.trim())
  const decision = parsed?.hookSpecificOutput?.permissionDecision
  if (decision !== 'allow') {
    console.error(`❌ 决定回传错误，期望 allow，实际 ${decision}`)
    process.exit(1)
  }

  // 裁决后状态机应回到 running
  snap = store.snapshot()
  const after = snap.agents.find((a) => a.id === pending.id)
  console.log(`[island] 裁决后状态：${after?.status} · ${after?.detail}`)

  // ===== 场景 2：deny + 接力理由 → 理由必须回传为 permissionDecisionReason =====
  const child2 = spawn('node', [script, 'claude-code', 'PreToolUse'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out2 = ''
  child2.stdout.on('data', (c) => (out2 += c))
  child2.stdin.write(JSON.stringify({ session_id: 's2', cwd: process.cwd(), tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }))
  child2.stdin.end()
  await sleep(400)
  const p2 = store.snapshot().agents.find((a) => a.status === 'needs_approval')
  const steerMsg = '别删整个目录，只清理 dist/.cache 就行'
  store.decide(p2!.requestId!, 'deny', steerMsg)
  await new Promise((resolve) => child2.on('close', resolve))
  const parsed2 = JSON.parse(out2.trim())
  console.log('[forwarder2] 输出:', out2.trim())
  if (parsed2?.hookSpecificOutput?.permissionDecision !== 'deny' || parsed2?.hookSpecificOutput?.permissionDecisionReason !== steerMsg) {
    console.error('❌ 接力理由未正确回传为 deny 理由')
    process.exit(1)
  }
  console.log('[island] ✓ 用户接力理由已作为 deny 理由回传给 CLI')

  bridge.stop()
  console.log('\n✅ M1 + 接力 steer 验证通过：审批裁决与"拒绝并说明理由"双向回传全链路成立')
  process.exit(0)
}

run().catch((e) => {
  console.error('测试异常:', e)
  process.exit(1)
})
