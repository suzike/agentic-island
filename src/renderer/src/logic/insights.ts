// 工作节律洞察（纯逻辑，可 raw-node 直测）：把活动流水 + 完成待办 + 番茄数据
// 汇成"高效时段 / 项目分布 / 本周概况"，供复盘页可视化。不做任何 AI，纯统计。

import type { ActivityEntry, TodoItem } from '../types'
import { dayKey } from './review'

export interface Insights {
  /** 24 小时活跃度（活动更新 + 待办完成，按小时累加） */
  hourly: number[]
  /** 最活跃时段（0-23），无数据为 -1 */
  peakHour: number
  /** 项目分布（按活动次数降序） */
  projects: { proj: string; count: number; added: number; removed: number }[]
  /** 近 N 天每日完成待办数 */
  dailyTodos: { key: string; count: number }[]
  /** 近 N 天每日（完成待办 + 编码会话）活动量，用于趋势 */
  daily: { key: string; todos: number; acts: number }[]
  /** 本周合计 */
  weekTodos: number
  weekPomo: number
  weekFiles: number
  /** 本窗口内活动总数 */
  totalActivities: number
  /** 一句自然语言洞察 */
  headline: string
}

/** 统计近 days 天（含今天）的节律。now 由调用方传入，避免逻辑里取时间。 */
export function buildInsights(
  todos: TodoItem[],
  activities: ActivityEntry[],
  pomoDone: Record<string, number>,
  now: number,
  days = 7
): Insights {
  const since = now - days * 86400_000
  const hourly = new Array(24).fill(0)
  const projMap = new Map<string, { proj: string; count: number; added: number; removed: number }>()

  const acts = activities.filter((a) => a.ts >= since || a.updatedAt >= since)
  for (const a of acts) {
    hourly[new Date(a.ts).getHours()]++
    const p = projMap.get(a.proj) || { proj: a.proj, count: 0, added: 0, removed: 0 }
    p.count++
    p.added += a.added || 0
    p.removed += a.removed || 0
    projMap.set(a.proj, p)
  }

  const doneTodos = todos.filter((t) => t.done && t.doneAt && t.doneAt >= since)
  for (const t of doneTodos) hourly[new Date(t.doneAt!).getHours()]++

  // 近 days 天每日完成待办 + 活动量
  const dailyTodos: { key: string; count: number }[] = []
  const daily: { key: string; todos: number; acts: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(now - i * 86400_000)
    const tc = doneTodos.filter((t) => dayKey(t.doneAt!) === k).length
    const ac = acts.filter((a) => dayKey(a.ts) === k).length
    dailyTodos.push({ key: k, count: tc })
    daily.push({ key: k, todos: tc, acts: ac })
  }

  const peakHour = hourly.some((h) => h > 0) ? hourly.indexOf(Math.max(...hourly)) : -1
  const projects = [...projMap.values()].sort((a, b) => b.count - a.count)
  const weekPomo = Object.entries(pomoDone)
    .filter(([k]) => dayKey(since) <= k)
    .reduce((s, [, v]) => s + v, 0)
  const weekFiles = acts.reduce((s, a) => s + (a.files || 0), 0)

  // 一句洞察
  const parts: string[] = []
  if (peakHour >= 0) parts.push(`你在${hourBand(peakHour)}最高产`)
  if (projects.length) parts.push(`主战场是 ${projects[0].proj}`)
  if (doneTodos.length) parts.push(`本周完成 ${doneTodos.length} 项待办`)
  if (weekPomo) parts.push(`专注 ${weekPomo} 个番茄`)
  const headline = parts.length ? parts.join(' · ') : '开始工作后，这里会浮现你的节律'

  return {
    hourly,
    peakHour,
    projects,
    dailyTodos,
    daily,
    weekTodos: doneTodos.length,
    weekPomo,
    weekFiles,
    totalActivities: acts.length,
    headline
  }
}

/** 时段的口语描述 */
export function hourBand(h: number): string {
  if (h < 0) return '暂无数据'
  if (h < 6) return '凌晨'
  if (h < 9) return '清晨'
  if (h < 12) return '上午'
  if (h < 14) return '午间'
  if (h < 18) return '下午'
  if (h < 22) return '晚间'
  return '深夜'
}
