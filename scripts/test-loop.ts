// M1 端到端验证（无 GUI）：真实启动本地桥 → 用真实 cc-forward.mjs 转发一条 PreToolUse
// → 确认岛状态机出现待审批请求 → 模拟用户裁决 → 确认转发脚本拿到决定并打印正确 JSON。
// 覆盖全项目最大风险点：hook 阻塞审批闭环是否成立。

import { spawn } from 'child_process'
import { join } from 'path'
import { mkdtempSync, writeFileSync } from 'fs'
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
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf dist/ && npm run build' }
  })

  // ===== 场景 0：PreToolUse 只是活动上报，必须立即返回且不产生待审批 =====
  {
    const started = Date.now()
    const probe = spawn('node', [script, 'claude-code', 'PreToolUse'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let probeOut = ''
    probe.stdout.on('data', (c) => (probeOut += c))
    probe.stdin.write(JSON.stringify({ session_id: 'probe', cwd: process.cwd(), tool_name: 'Bash', tool_input: { command: 'echo hi' } }))
    probe.stdin.end()
    const code: number = await new Promise((resolve) => probe.on('close', resolve))
    const elapsed = Date.now() - started
    if (code !== 0 || elapsed > 2000 || probeOut.trim() || store.snapshot().agents.some((a) => a.status === 'needs_approval')) {
      console.error(`❌ PreToolUse 不应阻塞或产生审批：code=${code} elapsed=${elapsed}ms out=${probeOut}`)
      process.exit(1)
    }
    console.log(`[forwarder] ✓ PreToolUse 非阻塞（${elapsed}ms，无决定、无审批卡）`)
  }

  // ===== 场景 0b：PostToolUse 把验证命令的真实结果带回岛（耗时来自 Pre→Post 之间） =====
  {
    const runForward = (event: string, payload: Record<string, unknown>): Promise<void> =>
      new Promise((resolve) => {
        const child = spawn('node', [script, 'claude-code', event], { stdio: ['pipe', 'pipe', 'pipe'] })
        child.stdin.write(JSON.stringify(payload))
        child.stdin.end()
        child.on('close', () => resolve())
      })
    const base2 = { session_id: 'check-sess', cwd: process.cwd(), tool_name: 'Bash', tool_input: { command: 'npm test' } }
    await runForward('PreToolUse', base2)
    await sleep(120)
    await runForward('PostToolUse', { ...base2, tool_response: { stdout: 'ok', stderr: '', interrupted: false } })
    await sleep(200)
    const probed = store.snapshot().agents.find((a) => a.id === 'claude-code:check-sess')
    const run = probed?.checks?.[0]
    if (!run || run.command !== 'npm test' || !run.ms || run.ms < 100 || run.exitCode !== undefined) {
      console.error(`❌ 验证命令结果未正确留档：${JSON.stringify(probed?.checks)}`)
      process.exit(1)
    }
    console.log(`[island] ✓ PostToolUse 记录 npm test 耗时 ${run.ms}ms（Claude 不回传退出码，如实留空）`)
  }

  // 启动真实转发脚本，喂入 PermissionRequest（Claude Code 真正准备弹权限时才会触发）
  const child = spawn('node', [script, 'claude-code', 'PermissionRequest'], { stdio: ['pipe', 'pipe', 'pipe'] })
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
  const decision = parsed?.hookSpecificOutput?.decision
  if (decision?.behavior !== 'allow') {
    console.error(`❌ 决定回传错误，期望 decision.behavior=allow，实际 ${JSON.stringify(decision)}`)
    process.exit(1)
  }
  if ('permissionDecision' in (parsed?.hookSpecificOutput || {})) {
    console.error('❌ PermissionRequest 不应回传 permissionDecision（该字段属于 PreToolUse）')
    process.exit(1)
  }

  // 裁决后状态机应回到 running
  snap = store.snapshot()
  const after = snap.agents.find((a) => a.id === pending.id)
  console.log(`[island] 裁决后状态：${after?.status} · ${after?.detail}`)

  // ===== 场景 2：deny + 接力理由 → 理由必须回传为 permissionDecisionReason =====
  const child2 = spawn('node', [script, 'claude-code', 'PermissionRequest'], { stdio: ['pipe', 'pipe', 'pipe'] })
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
  if (parsed2?.hookSpecificOutput?.decision?.behavior !== 'deny' || parsed2?.hookSpecificOutput?.decision?.message !== steerMsg) {
    console.error('❌ 接力理由未正确回传为 decision.message')
    process.exit(1)
  }
  console.log('[island] ✓ 用户接力理由已作为 deny 理由回传给 CLI')

  // ===== 场景 3：Stop + transcript → 卡片补齐模型名与上下文占用 =====
  const transcript = join(mkdtempSync(join(tmpdir(), 'aiisland-tl-')), 'transcript.jsonl')
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: '你好' }], usage: { input_tokens: 4, cache_read_input_tokens: 12000, cache_creation_input_tokens: 300, output_tokens: 42 } } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: '最终回复' }], usage: { input_tokens: 4, cache_read_input_tokens: 15000, cache_creation_input_tokens: 500, output_tokens: 88 } } })
  ].join('\n'), 'utf8')
  const child3 = spawn('node', [script, 'claude-code', 'Stop'], { stdio: ['pipe', 'pipe', 'pipe'] })
  child3.stdin.write(JSON.stringify({ session_id: 'test-sess', cwd: process.cwd(), transcript_path: transcript }))
  child3.stdin.end()
  await new Promise((resolve) => child3.on('close', resolve))
  await sleep(400)
  const withMeta = store.snapshot().agents.find((a) => a.id === 'claude-code:test-sess')
  if (withMeta?.model !== 'claude-sonnet-4-5' || withMeta?.contextTokens !== 15504) {
    console.error(`❌ 卡片元信息缺失：model=${withMeta?.model} contextTokens=${withMeta?.contextTokens}（期望 claude-sonnet-4-5 / 15504）`)
    process.exit(1)
  }
  console.log('[island] ✓ Stop 事件已补齐卡片：model=claude-sonnet-4-5 · 上下文 15504 tok')

  // ===== 场景 4：最后回复与计划留档（验收台依赖这两项，会话结束后就再也拿不到了） =====
  if (withMeta?.lastReply !== '最终回复') {
    console.error(`❌ Stop 未留档最后回复：${JSON.stringify(withMeta?.lastReply)}`)
    process.exit(1)
  }
  console.log('[island] ✓ Stop 已留档最后回复')

  const planStore = new AgentsStore()
  const planText = '## 计划\n- [ ] 加限流\n\n## 验证方式\n- 单测覆盖桶耗尽'
  const planPending = planStore.handlePermission({
    token: 't', backend: 'claude-code', kind: 'permission', sessionId: 'plan-sess',
    cwd: process.cwd(), tool: 'ExitPlanMode', command: planText, isPlan: true
  })
  const planAgent = planStore.snapshot().agents.find((a) => a.id === 'claude-code:plan-sess')
  if (!planAgent?.requestId || planAgent.plan?.text !== planText) {
    console.error(`❌ 计划全文未留档：${JSON.stringify(planAgent?.plan)}`)
    process.exit(1)
  }
  planStore.decide(planAgent.requestId, 'deny', '先补测试')
  await planPending
  const decidedPlan = planStore.snapshot().agents.find((a) => a.id === 'claude-code:plan-sess')?.plan
  if (decidedPlan?.decision !== 'deny' || decidedPlan?.reason !== '先补测试') {
    console.error(`❌ 计划裁决未留档：${JSON.stringify(decidedPlan)}`)
    process.exit(1)
  }
  console.log('[island] ✓ 计划全文与裁决（deny + 理由）已留档')

  bridge.stop()
  console.log('\n✅ M1 + 接力 steer 验证通过：PreToolUse 零阻塞，PermissionRequest 裁决与拒绝理由双向回传成立')
  process.exit(0)
}

run().catch((e) => {
  console.error('测试异常:', e)
  process.exit(1)
})
