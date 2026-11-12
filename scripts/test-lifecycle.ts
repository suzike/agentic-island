// 验证"全局常驻实时接入"：
// A) 会话全生命周期事件经真实 cc-forward.mjs → 桥 → 状态机，实时更新岛（非审批事件非阻塞）。
// B) 安装器写出覆盖全生命周期的全局 hooks，且幂等、合并不覆盖已有配置。

import { spawn } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { createServer } from 'http'
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

async function runForwarder(
  script: string,
  backend: string,
  evt: string,
  input: object,
  timeoutMs = 15000
): Promise<{ stdout: string; ms: number }> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, backend, evt], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${evt} 超过 ${timeoutMs}ms 仍未返回；stderr=${stderr.trim()}`))
    }, timeoutMs)
    child.on('close', () => {
      clearTimeout(timer)
      resolve({ stdout, ms: Date.now() - started })
    })
    child.stdin.write(JSON.stringify(input))
    child.stdin.end()
  })
}

const fire = (script: string, evt: string, input: object, timeoutMs = 15000) =>
  runForwarder(script, 'claude-code', evt, input, timeoutMs)

const fireCodex = (script: string, evt: string, input: object, timeoutMs = 15000) =>
  runForwarder(script, 'codex', evt, input, timeoutMs)

async function partA(): Promise<void> {
  console.log('A) 会话全生命周期实时上报：')
  const store = new AgentsStore()
  const bridge = new BridgeServer(store, undefined, TEST_BRIDGE_FILE)
  await bridge.start()
  const script = join(process.cwd(), 'src', 'hooks-bin', 'cc-forward.mjs')
  const cwd = process.cwd()
  const detail = (): string => store.snapshot().agents[0]?.detail || ''
  const pending = () => store.snapshot().agents.find((a) => a.status === 'needs_approval')

  await fire(script, 'SessionStart', { cwd, session_id: 's' }); await sleep(120)
  check(detail().includes('会话已开始'), `SessionStart → "${detail()}"`)

  await fire(script, 'UserPromptSubmit', { cwd, session_id: 's' }); await sleep(120)
  check(detail().includes('对话中'), `UserPromptSubmit → "${detail()}"`)

  // PreToolUse 不论工具类型都必须立即返回：它只是活动上报，不是权限请求。
  for (const [tool, toolInput, expect] of [
    ['Read', { file_path: 'a.ts' }, '读取文件'],
    ['Edit', { file_path: 'a.ts' }, '编辑文件'],
    ['mcp__filesystem__list_directory', { path: 'C:/x' }, 'list_directory'],
    ['Bash', { command: 'ls -la' }, '运行命令']
  ] as const) {
    const result = await fire(script, 'PreToolUse', { cwd, session_id: 's', tool_name: tool, tool_input: toolInput })
    check(result.ms < 2000 && !pending(), `PreToolUse(${tool}) 不阻塞（${result.ms}ms）`)
    check(detail().includes(expect), `PreToolUse(${tool}) 只上报活动 → "${detail()}"`)
  }

  // 真正需要权限时，PermissionRequest 才阻塞，并回传 Claude Code 原生 decision 结构。
  {
    const p = fire(script, 'PermissionRequest', {
      cwd, session_id: 's', tool_name: 'Edit', tool_input: { file_path: 'a.ts' }
    })
    await sleep(300)
    const card = pending()
    check(!!card?.requestId && (card?.command || '').includes('a.ts'), `PermissionRequest(Edit) → 待审批卡`)
    store.decide(card!.requestId!, 'allow')
    const result = await p
    const out = JSON.parse(result.stdout.trim())
    check(out?.hookSpecificOutput?.decision?.behavior === 'allow', `PermissionRequest(Edit) 回传 behavior=allow`)
    check(!('permissionDecision' in (out?.hookSpecificOutput || {})), 'PermissionRequest 不再回传错误的 permissionDecision 字段')
    check(detail().includes('已允许'), `PermissionRequest(Edit) 裁决后 → "${detail()}"`)
  }

  // deny 的理由必须走 decision.message，Claude Code 会把它作为拒绝原因反馈给模型。
  {
    const p = fire(script, 'PermissionRequest', {
      cwd, session_id: 's', tool_name: 'Bash', tool_input: { command: 'rm -rf dist' }
    })
    await sleep(300)
    const card = pending()
    store.decide(card!.requestId!, 'deny', '只清理 dist/.cache')
    const result = await p
    const decision = JSON.parse(result.stdout.trim())?.hookSpecificOutput?.decision
    check(decision?.behavior === 'deny' && decision?.message === '只清理 dist/.cache', `PermissionRequest deny 理由已回传`)
  }

  // Notification（Agent 反问/等你输入）→ 醒目的"等待你回复"态
  await fire(script, 'Notification', { cwd, session_id: 's', message: '还需要你补充目标数据库的连接串' }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'waiting' && detail().includes('数据库'), `Notification → 等待回复 → "${detail()}"`)

  // ExitPlanMode 的审批必须带 updatedInput，否则 Claude Code 仍会再次询问计划。
  const planText = '## 计划\n1. 重构 X\n2. 补测试'
  {
    const p = fire(script, 'PermissionRequest', {
      cwd, session_id: 's', tool_name: 'ExitPlanMode', tool_input: { plan: planText }
    })
    await sleep(300)
    const card = pending()
    check(card?.isPlan === true, 'PermissionRequest(ExitPlanMode) → 计划审阅卡')
    store.decide(card!.requestId!, 'allow')
    const result = await p
    const decision = JSON.parse(result.stdout.trim())?.hookSpecificOutput?.decision
    check(decision?.behavior === 'allow' && decision?.updatedInput?.plan === planText, '计划批准回传 updatedInput，授权可被 Claude Code 直接采用')
    check(store.snapshot().agents[0]?.status === 'running', 'ExitPlanMode 批准后回到 running')
  }

  // 权限类通知（permission_prompt）应被跳过（由 PreToolUse 审批处理），不误报"等待"
  await fire(script, 'Notification', { cwd, session_id: 's', message: 'Claude needs your permission', notification_type: 'permission_prompt' }); await sleep(120)
  check(store.snapshot().agents[0]?.status !== 'waiting', `permission_prompt 通知被跳过（状态未变 waiting）`)

  // AskUserQuestion：岛上只提示问题，不代答、不阻塞原生提问 UI。
  {
    const result = await fire(script, 'PreToolUse', {
      cwd, session_id: 's', tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: '选哪个数据库？', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] }
    })
    check(result.ms < 2000 && !result.stdout.trim(), 'AskUserQuestion 不返回伪批准，交还原生提问 UI')
  }
  await sleep(150)
  check(store.snapshot().agents[0]?.status === 'waiting' && detail().includes('选哪个数据库'), `AskUserQuestion → 等待回复带问题原文 → "${detail().slice(0, 50)}"`)

  // 每轮结束 = 等待用户回复 → 立即弹岛（不等 CC 迟到的 idle 通知）
  await fire(script, 'Stop', { cwd, session_id: 's' }); await sleep(120)
  check(store.snapshot().agents[0]?.status === 'waiting' && detail().includes('等待你的回复'), `Stop → 等待你回复（立即弹出）→ "${detail()}"`)

  // 多会话：不同 session_id（同一 cwd）→ 两个独立 Agent（多终端不再塌缩成一个）
  await fire(script, 'SessionStart', { cwd, session_id: 'session-2' }); await sleep(140)
  check(store.snapshot().agents.length >= 2, `多会话独立：agents 数=${store.snapshot().agents.length}（应≥2，多终端不塌缩）`)

  // 会话真正结束 → 立即从岛上移除（不再保留 done 占位），其它会话不受影响
  await fire(script, 'SessionEnd', { cwd, session_id: 's' }); await sleep(120)
  const afterEnd = store.snapshot().agents
  check(!afterEnd.some((a) => a.id.endsWith(':s')) && afterEnd.length === 1, `SessionEnd → 立即移除（剩 ${afterEnd.length} 个，且不含已结束会话）`)

  // Codex 关闭窗口不会补 SessionEnd：等待态超过 10 分钟必须自动回收，不能长期挂在 Agents。
  store.handleSession({ backend: 'codex', sessionId: 'stale-codex', kind: 'session', cwd } as never)
  const stale = store.snapshot().agents.find((a) => a.id === 'codex:stale-codex')
  if (stale) { stale.status = 'waiting'; stale.updatedAt = Date.now() - 11 * 60 * 1000 }
  ;(store as unknown as { prune(): boolean }).prune()
  check(!store.snapshot().agents.some((a) => a.id === 'codex:stale-codex'), 'Codex 等待态超过 10 分钟自动回收（关闭窗口无 SessionEnd）')

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
  writeFileSync(join(ccPath, 'settings.json'), JSON.stringify({
    model: 'opus',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'echo user-own' }] }],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'node "D:/old/Agentic-Island/resources/hooks-bin/cc-forward.mjs" claude-code PreToolUse' }] }]
    }
  }))

  inst.installClaudeCode('C:\\app\\cc-forward.mjs')
  inst.installClaudeCode('C:\\app\\cc-forward.mjs') // 二次安装应幂等

  const settings = JSON.parse(readFileSync(join(ccPath, 'settings.json'), 'utf8'))
  const events = Object.keys(settings.hooks || {})
  check(
    ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop', 'SessionEnd', 'Notification'].every((e) => events.includes(e)),
    `覆盖事件：${events.join(', ')}`
  )
  check(settings.model === 'opus', '保留了用户已有的 model 配置（合并不覆盖）')
  const stopHooks = settings.hooks.Stop.flatMap((m: { hooks: { command: string }[] }) => m.hooks.map((h) => h.command))
  check(stopHooks.some((c: string) => c.includes('echo user-own')), '保留了用户已有的 Stop hook')
  const ourPre = settings.hooks.PreToolUse.flatMap((m: { hooks: { command: string }[] }) => m.hooks).filter((h: { command: string }) => h.command.includes('cc-forward.mjs'))
  check(ourPre.length === 1, `PreToolUse 幂等（我方条目数=${ourPre.length}，应为 1）`)
  check(ourPre[0]?.command.includes('C:/app/cc-forward.mjs'), '重新接入会清理迁移前的失效脚本路径')
  check(ourPre[0]?.timeout === 30, `PreToolUse 短超时（${ourPre[0]?.timeout}s，不再占住 600s）`)
  const ourPermission = settings.hooks.PermissionRequest.flatMap((m: { hooks: { command: string; timeout?: number }[] }) => m.hooks).filter((h: { command: string }) => h.command.includes('cc-forward.mjs'))
  check(ourPermission.length === 1 && ourPermission[0]?.timeout === 300, `PermissionRequest 接管真实权限弹窗（条目=${ourPermission.length}，超时=${ourPermission[0]?.timeout}s）`)
  check(existsSync(join(ccPath, 'settings.json.aiisland.bak')), '生成了备份文件')

  // Codex：PreToolUse 也必须短超时且不承担审批，PermissionRequest 才允许等待用户。
  // 同时清理 7 月遗留的 agentic-island-permission.mjs，避免同一次授权弹两张卡。
  const cxDir = join(home, '.codex')
  fs.mkdirSync(cxDir, { recursive: true })
  writeFileSync(join(cxDir, 'hooks.json'), JSON.stringify({
    hooks: {
      PermissionRequest: [{
        hooks: [
          { type: 'command', command: 'node "C:/Users/old/.codex/hooks/agentic-island-permission.mjs" codex PermissionRequest', timeout: 125 },
          { type: 'command', command: 'echo user-codex-own' }
        ]
      }]
    }
  }))
  inst.installCodex('C:\\app\\codex-forward.mjs')
  inst.installCodex('C:\\app\\codex-forward.mjs')
  const codexHooks = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'))
  const codexPre = codexHooks.hooks.PreToolUse.flatMap((m: { hooks: { command: string; timeout?: number }[] }) => m.hooks)
    .filter((h: { command: string }) => h.command.includes('codex-forward.mjs'))
  const codexPermission = codexHooks.hooks.PermissionRequest.flatMap((m: { hooks: { command: string; timeout?: number }[] }) => m.hooks)
    .filter((h: { command: string }) => h.command.includes('codex-forward.mjs'))
  check(codexPre.length === 1 && codexPre[0]?.timeout === 30, `Codex PreToolUse 短超时（${codexPre[0]?.timeout}s）`)
  check(codexPermission.length === 1 && codexPermission[0]?.timeout === 300, `Codex PermissionRequest 独立接管（${codexPermission[0]?.timeout}s）`)
  const codexPermissionAll = codexHooks.hooks.PermissionRequest.flatMap((m: { hooks: { command: string }[] }) => m.hooks)
  check(!codexPermissionAll.some((h: { command: string }) => h.command.includes('agentic-island-permission.mjs')), '清理遗留 Codex 权限 hook，避免重复弹窗')
  check(codexPermissionAll.some((h: { command: string }) => h.command.includes('user-codex-own')), '保留用户自己的 Codex hook')

  // Codex notify（Windows 用）：config.toml 追加 notify，不覆盖用户已有内容
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

async function partC(): Promise<void> {
  console.log('C) Codex hook：PreToolUse 只上报，PermissionRequest 才接管：')
  const store = new AgentsStore()
  const bridge = new BridgeServer(store, undefined, TEST_BRIDGE_FILE)
  await bridge.start()
  const script = join(process.cwd(), 'src', 'hooks-bin', 'codex-forward.mjs')
  const cwd = process.cwd()
  const pending = () => store.snapshot().agents.find((a) => a.status === 'needs_approval')

  {
    const result = await fireCodex(script, 'PreToolUse', {
      cwd, session_id: 'codex-s', tool_name: 'Bash', tool_input: { command: 'echo codex-ok' }
    })
    check(result.ms < 2000 && !result.stdout.trim() && !pending(), `Codex PreToolUse 不阻塞（${result.ms}ms）`)
    check((store.snapshot().agents[0]?.detail || '').includes('正在执行'), `Codex PreToolUse 只上报活动`)
  }

  {
    const p = fireCodex(script, 'PermissionRequest', {
      cwd, session_id: 'codex-s', tool_name: 'Bash', tool_input: { command: 'echo needs-approval', description: 'run echo' }
    })
    await sleep(300)
    const card = pending()
    check(!!card?.requestId && (card?.detail || '').includes('run echo'), 'Codex PermissionRequest → 待审批卡')
    store.decide(card!.requestId!, 'allow')
    const result = await p
    const out = JSON.parse(result.stdout.trim())
    check(out?.hookSpecificOutput?.decision?.behavior === 'allow', 'Codex PermissionRequest 回传 behavior=allow')
    check(!('decision' in out) && !('permissionDecision' in out), 'Codex 不再回传旧版 decision/permissionDecision 顶层字段')
  }

  {
    const p = fireCodex(script, 'PermissionRequest', {
      cwd, session_id: 'codex-s', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch' }
    })
    await sleep(300)
    const card = pending()
    store.decide(card!.requestId!, 'deny', '不要改这个文件')
    const result = await p
    const decision = JSON.parse(result.stdout.trim())?.hookSpecificOutput?.decision
    check(decision?.behavior === 'deny' && decision?.message === '不要改这个文件', 'Codex PermissionRequest deny 理由已回传')
  }

  bridge.stop()
}

async function partD(): Promise<void> {
  console.log('D) 桥接受连接但卡住时，PreToolUse 仍快速 fail-open：')
  const server = createServer(() => {
    // 故意不响应：模拟岛进程卡死但端口仍接受连接。
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no hanging bridge port')
  const bridgeFile = join(mkdtempSync(join(tmpdir(), 'aiisland-hang-')), 'bridge.json')
  writeFileSync(bridgeFile, JSON.stringify({ port: address.port, token: 'hang-token' }))

  const script = join(process.cwd(), 'src', 'hooks-bin', 'cc-forward.mjs')
  const started = Date.now()
  const child = spawn('node', [script, 'claude-code', 'PreToolUse'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AIISLAND_BRIDGE_FILE: bridgeFile }
  })
  let stdout = ''
  child.stdout.on('data', (c) => (stdout += c))
  const timer = setTimeout(() => child.kill(), 6000)
  child.stdin.write(JSON.stringify({ cwd: process.cwd(), session_id: 'hang', tool_name: 'Bash', tool_input: { command: 'echo hi' } }))
  child.stdin.end()
  const code: number = await new Promise((resolve) => child.on('close', resolve))
  clearTimeout(timer)
  const elapsed = Date.now() - started
  check(code === 0 && elapsed < 4000 && !stdout.trim(), `活动上报 2s 超时后放行（${elapsed}ms）`)
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function run(): Promise<void> {
  await partA()
  await partB()
  await partC()
  await partD()
  if (failed) { console.error('\n❌ 有断言未通过'); process.exit(1) }
  console.log('\n✅ 全局接入验证通过：PreToolUse 零阻塞 + PermissionRequest 裁决回传 + 幂等安装')
  process.exit(0)
}
run().catch((e) => { console.error('异常', e); process.exit(1) })
