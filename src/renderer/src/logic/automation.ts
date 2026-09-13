// 定时自动化调度（纯逻辑）：判断规则此刻是否应触发。
// 窗口语义：当日到达时刻之后、宽限窗口（默认 30 分钟）内、且今天尚未触发即触发；
// 应用启动晚点时据此补跑（missed=true 供 UI 标注），超过宽限窗口不再补跑。

import type { AutomationRule } from '../types'

export interface AutomationDue {
  fire: boolean
  /** 非第一时间命中（启动补跑） */
  missed: boolean
}

export const automationDayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function automationDue(rule: Pick<AutomationRule, 'enabled' | 'time' | 'lastRunDay'>, now: Date, graceMin = 30, freshMin = 0.5): AutomationDue {
  if (!rule.enabled) return { fire: false, missed: false }
  const m = /^(\d{1,2}):(\d{2})$/.exec(rule.time || '')
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
