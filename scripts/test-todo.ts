// 待办纯逻辑单测：时间分组、四象限、趋势、Markdown 导入导出、AI 时间解析。
// 运行：node --experimental-strip-types scripts/test-todo.ts

import type { TodoItem } from '../src/renderer/src/types.ts'
import { dayStart, dueLabel, dailyDoneSeries, groupTodos, quadrantOf, todoStats, todosToMarkdown, markdownToTodos, buildExecutionPlan, executionScore, projectRollups } from '../src/renderer/src/logic/todo.ts'
import { parseDue, parseJsonArray, parseJsonObject } from '../src/renderer/src/logic/todoAi.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

const now = new Date(2026, 6, 8, 10, 0).getTime()
const d0 = dayStart(new Date(now))
const at = (dayOffset: number, hour: number, minute = 0): number => d0 + dayOffset * 86400000 + (hour * 60 + minute) * 60000

const active: TodoItem[] = [
  { id: 1, text: '已到时', due: at(0, 9), done: false, priority: 1 },
  { id: 2, text: '今天下午', due: at(0, 15), done: false, priority: 3 },
  { id: 3, text: '明天', due: at(1, 9), done: false, priority: 2 },
  { id: 4, text: '以后', due: at(8, 9), done: false, priority: 2 },
  { id: 5, text: '未安排', done: false, priority: 3 }
]
const doneToday: TodoItem = { id: 6, text: '今天完成', done: true, doneAt: at(0, 8) }
const doneYesterday: TodoItem = { id: 7, text: '昨天完成', done: true, doneAt: at(-1, 18) }

ok(dueLabel(at(0, 15), now).text === '今天 15:00', 'dueLabel 使用传入 now 判定今天')
ok(dueLabel(at(1, 9), now).text === '明天 09:00', 'dueLabel 使用传入 now 判定明天')

const groups = groupTodos(active, now)
ok(groups.map((g) => g.key).join(',') === 'over,today,tomo,later,none', 'groupTodos 时间线分组稳定')
ok(groups[0].items[0].id === 1 && groups[1].items[0].id === 2, 'groupTodos 组内内容正确')

ok(quadrantOf(active[0], now) === 'q1', 'quadrantOf 重要且紧急')
ok(quadrantOf(active[3], now) === 'q2', 'quadrantOf 重要不紧急')
ok(quadrantOf(active[1], now) === 'q3', 'quadrantOf 紧急不重要')
ok(quadrantOf(active[4], now) === 'q4', 'quadrantOf 不重要不紧急')

const stats = todoStats([...active, doneToday, doneYesterday], now)
ok(stats.activeCount === 5 && stats.doneToday === 1 && stats.todayCnt === 1 && stats.overdue === 1, 'todoStats 不重复计算今天未完成与已到时')
ok(stats.pct === 33, 'todoStats 进度百分比稳定')

ok(dailyDoneSeries([...active, doneToday, doneYesterday], 3, now).join(',') === '0,1,1', 'dailyDoneSeries 支持传入 now')

const executionItems: TodoItem[] = [
  { id: 20, text: '进行中', done: false, status: 'doing', estimate: 120, priority: 2, project: 'Island', createdAt: 1 },
  { id: 21, text: '逾期紧急', done: false, due: at(0, 9), estimate: 90, priority: 1, project: 'Island', createdAt: 2 },
  { id: 22, text: '被阻塞', done: false, blockedBy: '等待接口', estimate: 30, project: '模型', createdAt: 3 },
  { id: 23, text: '低优先', done: false, estimate: 180, priority: 3, project: '模型', createdAt: 4 },
  { id: 24, text: '已完成', done: true, project: 'Island', createdAt: 5 }
]
ok(executionScore(executionItems[1], now) > executionScore(executionItems[3], now), 'executionScore 优先逾期紧急任务')
const plan = buildExecutionPlan(executionItems, now, 240)
ok(plan.planned.map((t) => t.id).join(',') === '21,20' && plan.blocked[0].id === 22, 'buildExecutionPlan 遵守优先级、容量并排除阻塞')
const rollups = projectRollups(executionItems)
const islandProject = rollups.find((x) => x.project === 'Island')
ok(islandProject?.done === 1 && islandProject.doing === 1 && islandProject.remainingMinutes === 210, 'projectRollups 汇总项目进度与剩余工时')

const md = todosToMarkdown([{ id: 8, text: '写报告', due: at(1, 14), done: false, priority: 1, tags: ['工作'], subs: [{ id: 1, text: '列提纲', done: true }] }])
ok(md.includes('- [ ] 写报告') && md.includes('  - [x] 列提纲'), 'todosToMarkdown 导出主任务和子任务')

const imported = markdownToTodos('- [ ] 写报告 @2026-07-09 14:00 !1 #工作\n  - [x] 列提纲')
ok(imported.length === 1 && imported[0].priority === 1 && imported[0].tags?.[0] === '工作' && imported[0].subs?.[0].done === true, 'markdownToTodos 解析时间/优先级/标签/子任务')

ok(parseJsonArray('```json\n[{"a":1}]\n```')?.length === 1, 'parseJsonArray 支持代码围栏')
ok(parseJsonObject('前缀 {"a":1} 后缀')?.a === 1, 'parseJsonObject 支持前后噪声')
ok(parseDue('今晚', now) === at(0, 20), 'parseDue 支持今晚默认 20:00')
ok(parseDue('明天下午三点半', now) === at(1, 15, 30), 'parseDue 支持中文时段和半点')
ok(parseDue('周五 14:00', now) === at(2, 14), 'parseDue 支持周几')
ok(parseDue('2小时后', now) === now + 2 * 3600000, 'parseDue 支持相对时间')

console.log(failed === 0 ? '\n✅ todo 全部通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
