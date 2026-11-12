// review 复盘逻辑单测：日期键/区间、事实汇总、提示组装。
// 运行：node --experimental-strip-types scripts/test-review.ts

import { dayKey, dayRange, buildFacts, hasContent, reviewPrompt, weeklyPrompt } from '../src/renderer/src/logic/review.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

// ---- dayKey / dayRange ----
const t = new Date(2026, 6, 5, 14, 30, 0).getTime() // 2026-07-05 14:30 本地
const key = dayKey(t)
ok(key === '2026-07-05', `dayKey 本地自然日: ${key}`)
const { start, end } = dayRange(key)
ok(start <= t && t < end, 'dayRange 覆盖当日时刻')
ok(end - start === 86400_000, 'dayRange 恰好 24h')
ok(dayKey(start) === key && dayKey(end - 1) === key, '区间两端仍属同一天')

// ---- buildFacts ----
const todos = [
  { id: 1, text: '写热管理需求文档', done: true, doneAt: new Date(2026, 6, 5, 9).getTime(), createdAt: 0 },
  { id: 2, text: '跑 MIL 回归', done: true, doneAt: new Date(2026, 6, 5, 18).getTime(), createdAt: 0 },
  { id: 3, text: '昨天完成的', done: true, doneAt: new Date(2026, 6, 4, 10).getTime(), createdAt: 0 },
  { id: 4, text: '未完成', done: false, createdAt: 0 }
]
const acts = [
  { id: 'cc:a', ts: new Date(2026, 6, 5, 10).getTime(), updatedAt: t, tool: 'Claude Code CLI', proj: 'thermal', detail: '编辑控制器', files: 3, added: 40, removed: 5, commit: 'abc' },
  { id: 'cx:b', ts: new Date(2026, 6, 5, 16).getTime(), updatedAt: t, tool: 'Codex', proj: 'island', detail: '重构' },
  { id: 'cc:c', ts: new Date(2026, 6, 3, 10).getTime(), updatedAt: 0, tool: 'Claude Code CLI', proj: 'old', detail: '旧的' }
]

const f = buildFacts('2026-07-05', todos as never, acts as never)
ok(f.doneTodos.length === 2, `当天完成待办数=2 实际${f.doneTodos.length}`)
ok(f.doneTodos[0] === '写热管理需求文档', '完成待办按时间升序')
ok(f.activities.length === 2, `当天活动数=2 实际${f.activities.length}`)
ok(f.projects.length === 2 && f.projects.includes('thermal') && f.projects.includes('island'), '项目去重')
ok(f.files === 3 && f.added === 40 && f.removed === 5 && f.commits === 1, '代码变更累计正确')

// 空日
const empty = buildFacts('2026-01-01', todos as never, acts as never)
ok(!hasContent(empty), '无内容日 hasContent=false')
ok(hasContent(f), '有内容日 hasContent=true')

// ---- 提示组装 ----
const rp = reviewPrompt(f)
ok(rp.includes('写热管理需求文档') && rp.includes('thermal') && rp.includes('+40/-5'), '今日复盘提示含关键事实')

const week = ['2026-07-05', '2026-07-04', '2026-07-03'].map((k) => buildFacts(k, todos as never, acts as never))
const wp = weeklyPrompt(week)
ok(wp.includes('本周合计') && wp.includes('完成待办 3 项'), `周报提示合计正确`)

// ---- 验收事实 ----
const accept = [
  { endedAt: new Date(2026, 6, 5, 9).getTime(), status: 'accepted' as const, followups: 1, unverified: 0, proj: 'island' },
  { endedAt: new Date(2026, 6, 5, 11).getTime(), status: 'pending' as const, followups: 0, unverified: 3, proj: 'thermal' },
  { endedAt: new Date(2026, 6, 4, 11).getTime(), status: 'pending' as const, followups: 2, unverified: 5, proj: 'thermal' }
]
const withAccept = buildFacts('2026-07-05', todos as never, acts as never, accept)
ok(withAccept.acceptance.total === 2, `只统计当天验收（实际 ${withAccept.acceptance.total}）`)
ok(withAccept.acceptance.accepted === 1 && withAccept.acceptance.pending === 1, '已验收/待核对拆分正确')
ok(withAccept.acceptance.followups === 1 && withAccept.acceptance.unverified === 3, '补验证次数与未验证项累计正确')
ok(reviewPrompt(withAccept).includes('验收：2 条'), '复盘提示带验收事实')
ok(hasContent(buildFacts('2026-01-01', [], [], [accept[0]])) === false, '跨日验收不会让空日变成有内容')
const acceptOnly = buildFacts('2026-07-06', [], [], [{ ...accept[0], endedAt: new Date(2026, 6, 6, 9).getTime() }])
ok(hasContent(acceptOnly), '只有验收记录也算有内容')
ok(weeklyPrompt([withAccept]).includes('验收 2 条'), '周报合计带验收')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
