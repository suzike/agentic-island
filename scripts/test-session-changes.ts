// 回归：审批放行前必须先把工作区基线拍完。
// 用户可能在百毫秒内批准计划，若基线采集晚于 Agent 的第一次改动，本次产出会被整段吞掉。
// 运行：node --experimental-strip-types scripts/test-session-changes.ts

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentsStore } from '../src/main/agents-store.ts'
import { BridgeServer } from '../src/main/bridge-server.ts'
import { SessionChanges } from '../src/main/session-changes.ts'
import { captureBaseline, diffSinceBaseline } from '../src/main/git-baseline.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const repo = mkdtempSync(join(tmpdir(), 'aiisland-order-'))
const bridgeFile = join(mkdtempSync(join(tmpdir(), 'aiisland-order-bridge-')), 'bridge.json')
process.env.AIISLAND_BRIDGE_FILE = bridgeFile

const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

async function run(): Promise<void> {
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, 'app.txt'), 'line1\nline2\n')
  git('add', '-A')
  git('commit', '-qm', 'init')

  const store = new AgentsStore()
  const changes = new SessionChanges(captureBaseline, diffSinceBaseline)
  store.setPolicyHooks({
    onSessionStart: (id, cwd) => { void changes.ensure(id, cwd) },
    onSessionEnd: (id) => changes.forget(id)
  })
  const bridge = new BridgeServer(
    store,
    (cwd, id) => changes.summary(cwd, id),
    bridgeFile,
    (event) => changes.ready(`${event.backend}:${event.sessionId || event.cwd}`, event.cwd)
  )
  const { port, token } = await bridge.start()
  const post = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, backend: 'claude-code', sessionId: 'order-1', cwd: repo, ...payload })
    })

  // 计划审批：请求挂起，等用户裁决
  const permission = post({ kind: 'permission', tool: 'ExitPlanMode', command: '## 计划\n- [ ] 做事', isPlan: true })
  let agent = null
  for (let i = 0; i < 100 && !agent; i++) {
    agent = store.snapshot().agents.find((a) => a.id === 'claude-code:order-1') || null
    if (!agent) await sleep(20)
  }
  ok(!!agent?.requestId, '审批卡出现（此时基线已落定）')

  // 卡片一出现就立刻改文件：模拟"用户秒批 + Agent 立刻动手"
  writeFileSync(join(repo, 'DEMO_CHANGE.md'), '# 改动\n\n- a\n- b\n')
  store.decide(agent!.requestId!, 'allow')
  await permission

  await post({ kind: 'notification', detail: '本轮完成', turnEnd: true, lastReply: '做完了' })
  let summary = null
  for (let i = 0; i < 100 && !summary; i++) {
    summary = store.snapshot().agents.find((a) => a.id === 'claude-code:order-1')?.summary || null
    if (!summary) await sleep(20)
  }
  ok(summary?.files === 1, `秒批后立刻改动仍被计入（实际 ${summary?.files ?? 'null'}）`)
  ok(summary?.paths?.[0]?.path === 'DEMO_CHANGE.md', '改动文件归属正确')
  ok(summary?.added === 4, `行数按基线计算（实际 ${summary?.added}）`)

  bridge.stop()
}

run()
  .catch((e) => { console.error('测试异常:', e); failed++ })
  .finally(() => {
    rmSync(repo, { recursive: true, force: true })
    try { rmSync(join(bridgeFile, '..'), { recursive: true, force: true }) } catch { /* */ }
    if (failed > 0) {
      console.error(`\n${failed} 项失败`)
      process.exit(1)
    }
    console.log('\n审批前基线落定：回归通过')
    process.exit(0)
  })
