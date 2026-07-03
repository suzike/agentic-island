// 验证"全局常驻实时接入"：
// A) 会话全生命周期事件经真实 cc-forward.mjs → 桥 → 状态机，实时更新岛（非审批事件非阻塞）。
// B) 安装器写出覆盖全生命周期的全局 hooks，且幂等、合并不覆盖已有配置。

import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentsStore } from '../src/main/agents-store.ts'
import { BridgeServer } from '../src/main/bridge-server.ts'

// 关键：测试桥用临时发现文件（forwarder 子进程经继承的环境变量找到它），
// 绝不覆盖真实 ~/.agentic-island/bridge.json —— 否则真实 hook 全部打到死端口，岛失联！
const TEST_BRIDGE_FILE = join(mkdtempSync(join(tmpdir(), 'aiisland-test-')), 'bridge.json')
process.env.AIISLAND_BRIDGE_FILE = TEST_BRIDGE_FILE

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let failed = false
const check = (cond: boolean, msg: string): void => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed = true }

async function fire(script: string, evt: string, input: object): Promise<void> {
  const child = spawn('node', [script, 'claude-code', evt], { stdio: ['pipe', 'ignore', 'ignore'] })
  child.stdin.write(JSON.stringify(input))
  child.stdin.end()
  await new Promise((res) => child.on('close', res))
}

async function partA(): Promise<void> {
  console.log('A) 会话全生命周期实时上报：')
  const store = new AgentsStore()
  const bridge = new BridgeServer(store, undefined, TEST_BRIDGE_FILE)
  await bridge.start()
  // 自动放行任何待审批（模拟用户点允许）
  store.on('change', () => {
    for (const a of store.snapshot().agents) if (a.status === 'needs_approval' && a.requestId) store.decide(a.requestId, 'allow')
  })
  const script = join(process.cwd(), 'src', 'hooks-bin', 'cc-forward.mjs')
  const cwd = process.cwd()
  const detail = (): string => store.snapshot().agents[0]?.detail || ''

  await fire(script, 'SessionStart', { cwd, session_id: 's' }); await sleep(120)
  check(detail().includes('会话已开始'), `SessionStart → "${detail()}"`)

  await fire(script, 'UserPromptSubmit', { cwd, session_id: 's' }); await sleep(120)
  check(detail().includes('对话中'), `UserPromptSubmit → "${detail()}"`)

  // 只读工具 → 不拦，只上报活动
  await fire(script, 'PreToolUse', { cwd, session_id: 's', tool_name: 'Read' }); await sleep(120)
  check(detail().includes('读取文件'), `PreToolUse(Read) 只读→活动 → "${detail()}"`)

  // Edit（非只读）→ 岛上审批（自动放行）
  await fire(script, 'PreToolUse', { cwd, session_id: 's', tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'running' && detail().includes('已允许'), `PreToolUse(Edit) 非只读→审批放行 → "${detail()}"`)

  // MCP 工具 → 岛上审批（自动放行）—— 正是截图里 list_directory 的场景
  await fire(script, 'PreToolUse', { cwd, session_id: 's', tool_name: 'mcp__filesystem__list_directory', tool_input: { path: 'C:/x' } }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'running' && detail().includes('已允许'), `PreToolUse(MCP) 非只读→审批放行 → "${detail()}"`)

  // Bash → 审批（自动放行）
  await fire(script, 'PreToolUse', { cwd, session_id: 's', tool_name: 'Bash', tool_input: { command: 'ls -la' } }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'running', `PreToolUse(Bash) 审批放行后 → running`)

  // Notification（Agent 反问/等你输入）→ 醒目的"等待你回复"态
  await fire(script, 'Notification', { cwd, session_id: 's', message: '还需要你补充目标数据库的连接串' }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'waiting' && detail().includes('数据库'), `Notification → 等待回复 → "${detail()}"`)

  // ExitPlanMode（Plan 模式提交计划）→ 岛上"实施计划待审阅"（自动放行）
  await fire(script, 'PreToolUse', { cwd, session_id: 's', tool_name: 'ExitPlanMode', tool_input: { plan: '## 计划\n1. 重构 X\n2. 补测试' } }); await sleep(150)
  {
    const a = store.snapshot().agents[0]
    check(a?.status === 'running', `ExitPlanMode → 计划审阅（放行后 running）`)
  }

  // 权限类通知（permission_prompt）应被跳过（由 PreToolUse 审批处理），不误报"等待"
  await fire(script, 'Notification', { cwd, session_id: 's', message: 'Claude needs your permission', notification_type: 'permission_prompt' }); await sleep(120)
  check(store.snapshot().agents[0]?.status !== 'waiting', `permission_prompt 通知被跳过（状态未变 waiting）`)

  // AskUserQuestion（Claude 向你提问）→ 自动放行 + 岛上"等待回复"带问题原文
  await fire(script, 'PreToolUse', { cwd, session_id: 's', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: '选哪个数据库？', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] } }); await sleep(150)
  check(store.snapshot().agents[0]?.status === 'waiting' && detail().includes('选哪个数据库'), `AskUserQuestion → 等待回复带问题原文 → "${detail().slice(0, 50)}"`)

  // 每轮结束 = 等待用户回复 → 立即弹岛（不等 CC 迟到的 idle 通知）
  await fire(script, 'Stop', { cwd, session_id: 's' }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'waiting' && detail().includes('等待你的回复'), `Stop → 等待你回复（立即弹出）→ "${detail()}"`)

  await fire(script, 'SessionEnd', { cwd, session_id: 's' }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'done', `SessionEnd → done`)

  // 多会话：不同 session_id（同一 cwd）→ 两个独立 Agent（多终端不再塌缩成一个）
  await fire(script, 'SessionStart', { cwd, session_id: 'session-2' }); await sleep(140)
  check(store.snapshot().agents.length >= 2, `多会话独立：agents 数=${store.snapshot().agents.length}（应≥2，多终端不塌缩）`)

  bridge.stop()
}

async function partB(): Promise<void> {
  console.log('B) 安装器写出全局全生命周期 hooks（幂等 + 合并不覆盖）：')
  const home = mkdtempSync(join(tmpdir(), 'aiisland-home-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  // 预置用户已有的自定义 hook，验证合并不覆盖
  const ccPath = join(home, '.claude')
  writeFileSync(join(home, '.claude-marker'), 'x') // 占位
  const inst = await import('../src/main/hook-installer.ts')

  // 先放一个用户已有配置
  const fs = await import('fs')
  fs.mkdirSync(ccPath, { recursive: true })
  writeFileSync(join(ccPath, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user-own' }] }] } }))

  inst.installClaudeCode('C:/app/cc-forward.mjs')
  inst.installClaudeCode('C:/app/cc-forward.mjs') // 二次安装应幂等

  const settings = JSON.parse(readFileSync(join(ccPath, 'settings.json'), 'utf8'))
  const events = Object.keys(settings.hooks || {})
  check(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'SessionEnd', 'Notification'].every((e) => events.includes(e)), `覆盖事件：${events.join(', ')}`)
  check(settings.model === 'opus', '保留了用户已有的 model 配置（合并不覆盖）')
  const stopHooks = settings.hooks.Stop.flatMap((m: { hooks: { command: string }[] }) => m.hooks.map((h) => h.command))
  check(stopHooks.some((c: string) => c.includes('echo user-own')), '保留了用户已有的 Stop hook')
  const ourPre = settings.hooks.PreToolUse.flatMap((m: { hooks: { command: string }[] }) => m.hooks).filter((h: { command: string }) => h.command.includes('cc-forward.mjs'))
  check(ourPre.length === 1, `PreToolUse 幂等（我方条目数=${ourPre.length}，应为 1）`)
  check(existsSync(join(ccPath, 'settings.json.aiisland.bak')), '生成了备份文件')

  // Codex notify（Windows 用）：config.toml 追加 notify，不覆盖用户已有内容
  const cxDir = join(home, '.codex')
  fs.mkdirSync(cxDir, { recursive: true })
  writeFileSync(join(cxDir, 'config.toml'), 'model = "gpt-5-codex"\napproval_policy = "on-request"\n')
  inst.installCodexNotify('C:/app/codex-notify.mjs')
  inst.installCodexNotify('C:/app/codex-notify.mjs') // 幂等
  const toml = readFileSync(join(cxDir, 'config.toml'), 'utf8')
  check(toml.includes('model = "gpt-5-codex"') && toml.includes('approval_policy'), 'Codex config.toml 保留了用户原有内容')
  check((toml.match(/notify = \[/g) || []).length === 1, `Codex notify 幂等（notify 行数=${(toml.match(/notify = \[/g) || []).length}）`)
  check(toml.includes('codex-notify.mjs'), 'Codex notify 指向我方脚本')
  inst.uninstallCodexNotify()
  const toml2 = readFileSync(join(cxDir, 'config.toml'), 'utf8')
  check(!toml2.includes('codex-notify.mjs') && toml2.includes('model = "gpt-5-codex"'), 'Codex notify 可卸载还原且不动用户内容')
}

async function run(): Promise<void> {
  await partA()
  await partB()
  if (failed) { console.error('\n❌ 有断言未通过'); process.exit(1) }
  console.log('\n✅ 全局常驻实时接入验证通过：全生命周期实时上报 + 全局幂等合并安装')
  process.exit(0)
}
run().catch((e) => { console.error('异常', e); process.exit(1) })
