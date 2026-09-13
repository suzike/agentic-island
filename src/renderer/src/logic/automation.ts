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
  return '番茄钟专注结束'
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
      else continue
    } else if (typeof item.time === 'string') {
      trigger = { kind: 'daily', time: item.time } // 旧版迁移
    } else {
      continue
    }
    out.push({
      id,
      name: typeof item.name === 'string' ? item.name : '自动化任务',
      enabled: item.enabled !== false,
      trigger,
      action,
      lastRunDay: typeof item.lastRunDay === 'string' ? item.lastRunDay : undefined
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
