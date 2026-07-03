// CodexTail 单测：用临时 sessions 根目录 + 真实 rollout schema，验证
// ①「岛启动前已在跑」的会话续跟随、②「启动后新出现」的会话从头跟随、
// ③ 命令活动、④ task_complete → 等待态 + 完成文案、⑤ CLI/桌面端标签。
// 运行：node --experimental-strip-types scripts/test-codex-tail.ts

import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AgentsStore } from '../src/main/agents-store.ts'
import { CodexTail } from '../src/main/codex-tail.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

const line = (type: string, payload: Record<string, unknown>): string =>
  JSON.stringify({ timestamp: '2026-07-02T04:14:06.000Z', type, payload }) + '\n'

const meta = (sid: string, cwd: string, originator: string): string =>
  line('session_meta', { session_id: sid, id: sid, cwd, originator, cli_version: '0.142.5' })

// --- 环境 ---
const root = mkdtempSync(join(tmpdir(), 'codex-sessions-'))
const day = join(root, '2026', '07', '02')
mkdirSync(day, { recursive: true })

const store = new AgentsStore()
const sidA = '019f2108-aaaa-7790-929c-000000000001'
const fileA = join(day, `rollout-A-${sidA}.jsonl`)

// 场景①：会话在「岛启动前」已存在（含 meta + 一轮 task_started）
writeFileSync(fileA, meta(sidA, 'E:\\proj\\alpha', 'codex-tui') + line('event_msg', { type: 'task_started', turn_id: 't1' }))

const tail = new CodexTail(store, undefined, root)
tail.start() // 首扫：抓 ctx，偏移设到末尾（不回放上面两行历史）

let a = store.snapshot().agents.find((x) => x.id === `codex:${sidA}`)
ok(!a, '首扫不回放历史：启动前的旧行不产生卡片')

// 之后该会话继续：用户提问 → 跑命令 → 本轮完成
appendFileSync(fileA, line('event_msg', { type: 'user_message', message: '帮我重构 parser' }))
appendFileSync(fileA, line('response_item', { type: 'function_call', name: 'shell_command', arguments: JSON.stringify({ command: 'npm test' }) }))
appendFileSync(fileA, line('event_msg', { type: 'task_complete', turn_id: 't1', last_agent_message: '已完成重构，测试通过。' }))
tail.pollOnce()

a = store.snapshot().agents.find((x) => x.id === `codex:${sidA}`)
ok(!!a, '续跟随：新增行生成/更新了 Codex 卡片')
// Codex 的 rollout 元数据无法区分 CLI/桌面端（originator 恒为 codex-tui）→ 统一标 "Codex"
ok(a?.tool === 'Codex', `统一 Codex 标签（实际：${a?.tool}）`)
ok(a?.proj === 'alpha', `项目名取 cwd 短名（实际：${a?.proj}）`)
ok(a?.status === 'waiting', `task_complete → 等待你回复态（实际：${a?.status}）`)
ok(!!a && a.detail.includes('本轮完成') && a.detail.includes('已完成重构'), 'task_complete 文案含完成提示与回复原文')

// 场景②：岛启动后「新出现」的会话文件（桌面端 originator）
const sidB = '019f2108-bbbb-7790-929c-000000000002'
const fileB = join(day, `rollout-B-${sidB}.jsonl`)
writeFileSync(
  fileB,
  meta(sidB, 'E:\\proj\\beta', 'vscode') +
    line('event_msg', { type: 'task_started', turn_id: 't2' }) +
    line('response_item', { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch' })
)
tail.pollOnce()

const b = store.snapshot().agents.find((x) => x.id === `codex:${sidB}`)
ok(!!b, '新会话：启动后出现的文件从头跟随')
ok(b?.tool === 'Codex', `非 codex-tui originator 也统一 Codex 标签（实际：${b?.tool}）`)
ok(b?.status === 'running' && !!b.detail.includes('修改文件'), `apply_patch → 正在修改文件（实际：${b?.status}/${b?.detail}）`)

// 场景③：幂等——再次 pollOnce 不重复处理（无新增字节）
const before = store.snapshot().agents.find((x) => x.id === `codex:${sidA}`)?.updatedAt
tail.pollOnce()
const after = store.snapshot().agents.find((x) => x.id === `codex:${sidA}`)?.updatedAt
ok(before === after, '幂等：无新增行时不重复更新')

tail.stop()
console.log(failed === 0 ? '\n✅ CodexTail 全部通过：Codex 经 rollout 日志实时接入成立' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
