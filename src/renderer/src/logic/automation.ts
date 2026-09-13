// 定时自动化调度（纯逻辑）：判断规则此刻是否应触发。
// 窗口语义：当日到达时刻之后、宽限窗口（默认 30 分钟）内、且今天尚未触发即触发；
// 应用启动晚点时据此补跑（missed=true 供 UI 标注），超过宽限窗口不再补跑。

import type { AutomationRule, AutomationTrigger } from '../types'
import type { PomoPhase } from './pomodoro'

export interface AutomationDue {
  fire: boolean
  /** 非第一时间命中（启动补跑） */
  missed: boolean
}

export const automationDayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function automationDue(rule: Pick<AutomationRule, 'enabled' | 'trigger' | 'lastRunDay'>, now: Date, graceMin = 30, freshMin = 0.5): AutomationDue {
  if (!rule.enabled) return { fire: false, missed: false }
  // 事件触发器不由时间轮询驱动（由对应的状态边沿直接触发）
  if (rule.trigger?.kind !== 'daily') return { fire: false, missed: false }
  const m = /^(\d{1,2}):(\d{2})$/.exec(rule.trigger.time || '')
  if (!m) return { fire: false, missed: false }
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (hh > 23 || mm > 59) return { fire: false, missed: false }
  if (rule.lastRunDay === automationDayKey(now)) return { fire: false, missed: false }
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
  const deltaMin = (now.getTime() - due.getTime()) / 60_000
  // 宽限窗口内触发；超出 freshMin（一个轮询周期量级）视为启动补跑，供 UI 标注
  if (deltaMin >= 0 && deltaMin <= graceMin) return { fire: true, missed: deltaMin > freshMin }
  return { fire: false, missed: false }
}

/** 触发器文案（设置页与触发提示共用） */
export function automationTriggerLabel(trigger: AutomationTrigger): string {
  if (trigger.kind === 'daily') return `每日 ${trigger.time}`
  if (trigger.kind === 'agent-end') return 'Agent 会话结束'
  if (trigger.kind === 'pomo-end') return '番茄钟专注结束'
  if (trigger.kind === 'meeting-start') return `会议开始前 ${trigger.leadMin} 分钟`
  return '会议结束后'
}

/**
 * 归一化持久化的自动化规则：把旧版（只有 time、无 trigger）迁移为每日定时触发器，
 * 丢弃结构非法项。水合与写入边界都走它，旧数据不会因新增事件触发器而失效。
 */
export function normalizeAutomationRules(input: unknown): AutomationRule[] {
  if (!Array.isArray(input)) return []
  const out: AutomationRule[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    const action = item.action as AutomationRule['action'] | undefined
    if (!id || !action || typeof action !== 'object' || typeof action.kind !== 'string') continue
    if (action.kind !== 'shortcut' && action.kind !== 'todo' && action.kind !== 'note') continue
    let trigger: AutomationTrigger
    const t = item.trigger as Record<string, unknown> | undefined
    if (t && typeof t === 'object' && typeof t.kind === 'string') {
      if (t.kind === 'daily') trigger = { kind: 'daily', time: typeof t.time === 'string' ? t.time : '09:30' }
      else if (t.kind === 'agent-end' || t.kind === 'pomo-end') trigger = { kind: t.kind }
      else if (t.kind === 'meeting-start') trigger = { kind: 'meeting-start', leadMin: clampMinutes(t.leadMin, 5) }
      else if (t.kind === 'meeting-end') trigger = { kind: 'meeting-end' }
      else continue
    } else if (typeof item.time === 'string') {
      trigger = { kind: 'daily', time: item.time } // 旧版迁移
    } else {
      continue
    }
    const firedKeys = Array.isArray(item.firedKeys)
      ? item.firedKeys.filter((k): k is string => typeof k === 'string').slice(-100)
      : undefined
    out.push({
      id,
      name: typeof item.name === 'string' ? item.name : '自动化任务',
      enabled: item.enabled !== false,
      trigger,
      action,
      lastRunDay: typeof item.lastRunDay === 'string' ? item.lastRunDay : undefined,
      firedKeys
    })
  }
  return out
}

/** 会话结束判定：上一轮快照里有、这一轮消失的 Agent 会话 id */
export function disappearedAgents(previousIds: string[], currentIds: string[]): string[] {
  const live = new Set(currentIds)
  return previousIds.filter((id) => !live.has(id))
}

/** 番茄钟"专注结束"边沿：仅 work → 非 work 视为一轮专注结束（休息结束不触发） */
export function pomoFocusEnded(previous: PomoPhase, current: PomoPhase): boolean {
  return previous === 'work' && current !== 'work'
}

/** 提前量钳制：1–120 分钟，非法值回退默认值 */
export function clampMinutes(value: unknown, fallback: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(120, Math.max(1, n))
}

/** 会议触发器判定所需的日历事件字段（结构化类型：便于测试注入） */
export interface MeetingLike {
  id: string
  title: string
  start: number
  end: number
  allDay?: boolean
}

export interface MeetingTriggerHit {
  key: string
  title: string
  /** 事件驱动的动作提示，如「会议开始前 5 分钟」 */
  label: string
}

/**
 * 会议触发器判定（纯函数）：
 * · 会前触发：进入 [start - leadMin, start) 窗口即命中；
 * · 会后触发：进入 [end, end + graceMin] 窗口即命中（宽限用于跨重启补触发）；
 * · 全天事件不参与；已触发过的实例（firedKeys 里的 `${id}@${时间戳}`）不再命中；
 * · 若同时命中多场，返回开始最早的一场，由调用方按 tick 依次推进。
 */
export function meetingTriggerDue(
  trigger: AutomationTrigger,
  meetings: MeetingLike[],
  now: number,
  firedKeys: readonly string[] = [],
  endGraceMin = 10
): MeetingTriggerHit | null {
  if (trigger.kind !== 'meeting-start' && trigger.kind !== 'meeting-end') return null
  const fired = new Set(firedKeys)
  const leadMs = trigger.kind === 'meeting-start' ? clampMinutes(trigger.leadMin, 5) * 60_000 : 0
  let best: MeetingTriggerHit | null = null
  let bestStart = Number.POSITIVE_INFINITY
  for (const m of meetings) {
    if (!m || m.allDay || !m.id) continue
    if (trigger.kind === 'meeting-start') {
      if (now < m.start - leadMs || now >= m.start) continue
      const key = `${m.id}@${m.start}`
      if (fired.has(key)) continue
      if (m.start < bestStart) { bestStart = m.start; best = { key, title: m.title, label: `会议开始前 ${clampMinutes(trigger.leadMin, 5)} 分钟` } }
    } else {
      if (now < m.end || now > m.end + endGraceMin * 60_000) continue
      const key = `${m.id}@${m.end}`
      if (fired.has(key)) continue
      if (m.start < bestStart) { bestStart = m.start; best = { key, title: m.title, label: '会议结束' } }
    }
  }
  return best
}

/** 记录一个已触发键（保留最近 100 个，避免规则数据无界增长） */
export function withFiredKey(firedKeys: readonly string[] | undefined, key: string): string[] {
  const next = [...(firedKeys || []).filter((k) => k !== key), key]
  return next.slice(-100)
}
