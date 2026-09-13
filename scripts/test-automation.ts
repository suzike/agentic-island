// 定时自动化调度测试：触发窗口 / 宽限补跑 / 已触发防重 / 非法输入。
import assert from 'node:assert/strict'
import { automationDue, automationTriggerLabel, clampMinutes, disappearedAgents, meetingTriggerDue, normalizeAutomationRules, pomoFocusEnded, withFiredKey } from '../src/renderer/src/logic/automation.ts'

const ok = (cond: unknown, msg: string): void => {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`❌ ${msg}`); process.exit(1) }
}

// 基准时刻：2026-09-13 09:35:00（本地时区）
const at = (h: number, min: number, sec = 0): Date => new Date(2026, 8, 13, h, min, sec, 0)
const now = at(9, 35)
const rule = { enabled: true, trigger: { kind: 'daily' as const, time: '09:30' }, lastRunDay: undefined as string | undefined }

// 到达时刻后的窗口内触发
const due1 = automationDue(rule, now)
ok(due1.fire && due1.missed, '到达时刻 5 分钟后：触发并标记为补跑（超一个轮询周期）')
ok(automationDue(rule, at(9, 30, 10)).fire && !automationDue(rule, at(9, 30, 10)).missed, '刚到点（10 秒内）：触发且非补跑')

// 已触发防重：lastRunDay 为今天不再触发
ok(automationDue({ ...rule, lastRunDay: '2026-09-13' }, now).fire === false, '今天已触发：不再触发（dayKey 格式一致）')
ok(automationDue({ ...rule, lastRunDay: '2026-09-12' }, now).fire === true, '昨天触发过：今天仍触发')

// 宽限边界：30 分钟内补跑（missed=true），31 分钟不再触发
const due2 = automationDue(rule, at(9, 59, 30))
ok(due2.fire && due2.missed, '29.5 分钟时仍触发且标记补跑')
ok(automationDue(rule, at(10, 0, 1)).fire === false, '超过 30 分钟宽限：不再补跑')

// 时刻未到 / 恰好到达
ok(automationDue(rule, at(9, 30, 0)).fire && !automationDue(rule, at(9, 30, 0)).missed, '恰好在设定时刻：触发且非补跑')
ok(automationDue(rule, at(8, 59)).fire === false, '时刻未到：不触发')

// 禁用 / 非法输入
ok(automationDue({ ...rule, enabled: false }, now).fire === false, '禁用规则：不触发')
ok(automationDue({ ...rule, trigger: { kind: 'daily' as const, time: '' } }, now).fire === false, '空时间：不触发')
ok(automationDue({ ...rule, trigger: { kind: 'daily' as const, time: '25:00' } }, now).fire === false, '非法小时：不触发')
ok(automationDue({ ...rule, trigger: { kind: 'daily' as const, time: '9:5' } }, now).fire === false, '分钟缺位格式：不触发')

// 宽限参数可调
ok(automationDue(rule, at(10, 0, 1), 60).fire, '自定义 60 分钟宽限：可补跑')

// ── 事件触发器：不由时间轮询驱动 ──
ok(automationDue({ enabled: true, trigger: { kind: 'agent-end' } }, now).fire === false, 'Agent 会话结束触发器不由时间轮询触发')
ok(automationDue({ enabled: true, trigger: { kind: 'pomo-end' } }, now).fire === false, '番茄钟触发器不由时间轮询触发')
ok(automationDue({ enabled: false, trigger: { kind: 'daily', time: '09:30' } }, now).fire === false, '禁用规则一律不触发')

// ── 会话结束边沿：上一轮存在、这一轮消失 ──
ok(disappearedAgents(['a', 'b'], ['a']).join() === 'b', '会话结束：识别消失的会话 id')
ok(disappearedAgents(['a'], ['a', 'b']).length === 0, '新增会话不算结束')
ok(disappearedAgents([], ['a']).length === 0 && disappearedAgents(['a'], []).join() === 'a', '空集边界安全')
ok(disappearedAgents(['a', 'b', 'c'], ['c']).join() === 'a,b', '多个会话同时结束全部识别')

// ── 番茄钟专注结束边沿：仅 work → 非 work ──
ok(pomoFocusEnded('work', 'break') && pomoFocusEnded('work', 'longbreak'), '专注结束：work → 休息/长休')
ok(pomoFocusEnded('work', 'idle'), '专注结束：work → idle（中途重置也算结束）')
ok(!pomoFocusEnded('break', 'work') && !pomoFocusEnded('idle', 'work'), '休息结束与开始专注不触发')

// ── 旧数据迁移与归一化 ──
const migrated = normalizeAutomationRules([
  { id: 'old-1', name: '旧版定时', enabled: true, time: '08:15', action: { kind: 'todo', text: '喝水' } },
  { id: 'new-1', name: '会话结束', enabled: true, trigger: { kind: 'agent-end' }, action: { kind: 'note', text: '复盘' } },
  { id: 'bad-1', name: '缺动作', enabled: true, trigger: { kind: 'agent-end' } },
  { id: 'bad-2', name: '未知触发器', enabled: true, trigger: { kind: 'nope' }, action: { kind: 'todo', text: 'x' } },
  'not-an-object',
  null
])
ok(migrated.length === 2, '归一化：旧版迁移 1 条 + 新格式 1 条，非法项被丢弃')
ok(migrated[0].trigger.kind === 'daily' && (migrated[0].trigger as { time: string }).time === '08:15', '归一化：旧版 time 迁移为每日定时触发器')
ok(migrated[1].trigger.kind === 'agent-end', '归一化：事件触发器原样保留')
ok(migrated.every((r) => r.enabled), '归一化：enabled 缺省为启用')
ok(normalizeAutomationRules('nonsense').length === 0 && normalizeAutomationRules(undefined).length === 0, '归一化：非数组输入返回空列表')

// ── 触发器文案 ──
ok(automationTriggerLabel({ kind: 'daily', time: '09:30' }) === '每日 09:30', '文案：每日定时')
ok(automationTriggerLabel({ kind: 'agent-end' }) === 'Agent 会话结束', '文案：会话结束')
ok(automationTriggerLabel({ kind: 'pomo-end' }) === '番茄钟专注结束', '文案：番茄结束')

// ── 会议触发器：会前窗口 / 会后宽限 / 去重 / 全天事件 ──
const meeting = { id: 'm1', title: '周会', start: at(10, 0).getTime(), end: at(11, 0).getTime() }
const startTrigger = { kind: 'meeting-start' as const, leadMin: 5 }

// 会前窗口：[start-5min, start)
ok(meetingTriggerDue(startTrigger, [meeting], at(9, 56).getTime())?.key === `m1@${meeting.start}`, '会前：进入提前量窗口即命中')
ok(meetingTriggerDue(startTrigger, [meeting], at(9, 59, 30).getTime()) !== null, '会前：窗口末尾仍命中')
ok(meetingTriggerDue(startTrigger, [meeting], at(9, 54).getTime()) === null, '会前：早于提前量不命中')
ok(meetingTriggerDue(startTrigger, [meeting], at(10, 0).getTime()) === null, '会前：会议已开始则不再补触发')
ok(meetingTriggerDue(startTrigger, [meeting], at(9, 56).getTime(), [`m1@${meeting.start}`]) === null, '会前：已触发过的会议实例不重复命中')

// 会后窗口：[end, end+10min]
const endTrigger = { kind: 'meeting-end' as const }
ok(meetingTriggerDue(endTrigger, [meeting], at(11, 3).getTime())?.key === `m1@${meeting.end}`, '会后：结束后宽限内命中')
ok(meetingTriggerDue(endTrigger, [meeting], at(10, 59).getTime()) === null, '会后：尚未结束不命中')
ok(meetingTriggerDue(endTrigger, [meeting], at(11, 30).getTime()) === null, '会后：超出宽限不再补触发')

// 全天事件与会前/会后互不干扰
const allDay = { id: 'm2', title: '假期', start: at(0, 0).getTime(), end: at(23, 59).getTime(), allDay: true }
ok(meetingTriggerDue(startTrigger, [allDay], at(9, 58).getTime()) === null, '全天事件不参与会前触发')
ok(meetingTriggerDue(startTrigger, [{ ...meeting, start: 0 }], at(9, 58).getTime()) === null, '无 id 的脏数据安全跳过')

// 多场同时命中：取开始最早的一场（便于按 tick 依次推进）
const earlier = { id: 'm0', title: '晨会', start: at(9, 58).getTime(), end: at(10, 30).getTime() }
const hit = meetingTriggerDue({ kind: 'meeting-start', leadMin: 60 }, [meeting, earlier, allDay], at(9, 51).getTime())
ok(hit?.title === '晨会', '多场命中时取开始最早的一场')

// 非法提前量钳制
ok(clampMinutes(0, 5) === 1 && clampMinutes(999, 5) === 120, '提前量钳制到 1-120 分钟')
ok(clampMinutes(undefined, 5) === 5 && clampMinutes('abc', 5) === 5, '非法提前量回退默认值')
ok(meetingTriggerDue({ kind: 'meeting-start', leadMin: 0 }, [meeting], at(9, 59, 30).getTime()) !== null, '提前量 0 被钳制为 1 分钟后仍能命中')

// 非会议触发器交给其它路径
ok(meetingTriggerDue({ kind: 'daily', time: '09:30' }, [meeting], at(9, 56).getTime()) === null, '会议判定不接管其它触发器')

// 去重键保留最近 100 个
const manyKeys = Array.from({ length: 130 }, (_, i) => `k${i}`)
const trimmed = withFiredKey(manyKeys, 'new')
ok(trimmed.length === 100 && trimmed[trimmed.length - 1] === 'new', '去重键只保留最近 100 个')
ok(withFiredKey(['a', 'b'], 'a').length === 2, '重复写入同一键不产生冗余')

// 归一化：新触发器与去重键
const meetingRules = normalizeAutomationRules([
  { id: 'ms', name: '会前准备', enabled: true, trigger: { kind: 'meeting-start', leadMin: 15 }, action: { kind: 'todo', text: '准备议程' } },
  { id: 'me', name: '会后纪要', enabled: true, trigger: { kind: 'meeting-end' }, action: { kind: 'note', text: '纪要' }, firedKeys: ['m1@1', 'm2@2'] },
  { id: 'badlead', name: '脏提前量', enabled: true, trigger: { kind: 'meeting-start', leadMin: 'x' }, action: { kind: 'todo', text: 'x' } }
])
ok(meetingRules[0].trigger.kind === 'meeting-start' && (meetingRules[0].trigger as { leadMin: number }).leadMin === 15, '归一化：会前触发器保留提前量')
ok(meetingRules[2].trigger.kind === 'meeting-start' && (meetingRules[2].trigger as { leadMin: number }).leadMin === 5, '归一化：非法提前量回退 5 分钟')
ok(JSON.stringify(meetingRules[1].firedKeys) === JSON.stringify(['m1@1', 'm2@2']), '归一化：去重键原样保留')
ok(automationTriggerLabel({ kind: 'meeting-start', leadMin: 15 }) === '会议开始前 15 分钟' && automationTriggerLabel({ kind: 'meeting-end' }) === '会议结束后', '文案：会议触发器')

console.log('automation scheduling tests passed')
process.exit(0)
