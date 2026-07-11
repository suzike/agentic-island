// 待办纯逻辑：时间/分组/四象限/趋势/优先级常量。
// 无运行时 import（仅 import type），可被 scripts/test-todo.ts 直跑（node --experimental-strip-types）。

import type { TodoItem } from '../types'

export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export const pad = (n: number): string => String(n).padStart(2, '0')
export const fmtHM = (ts: number): string => `${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}`
export const dayStart = (d = new Date()): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** 优先级视觉令牌：色相跨主题固定（P1 红 25 / P2 琥珀 75 / P3 灰走 --th） */
export const PRIO: Record<1 | 2 | 3, { label: string; color: string; ring: string }> = {
  1: { label: '紧急', color: 'oklch(0.72 0.17 25)', ring: 'oklch(0.72 0.17 25)' },
  2: { label: '重要', color: 'oklch(0.8 0.13 75)', ring: 'oklch(0.8 0.13 75)' },
  3: { label: '普通', color: 'oklch(0.7 0.02 var(--th) / .5)', ring: 'oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .6)' }
}

/** 相对时间标签 + 是否"热"（临期/逾期高亮） */
export function dueLabel(due: number, now: number): { text: string; hot: boolean } {
  if (due <= now) return { text: '已到时', hot: true }
  const min = Math.round((due - now) / 60000)
  if (min < 60) return { text: `${min} 分钟后`, hot: min <= 15 }
  const d0 = dayStart(new Date(now))
  if (due < d0 + 86400000) return { text: `今天 ${fmtHM(due)}`, hot: false }
  if (due < d0 + 2 * 86400000) return { text: `明天 ${fmtHM(due)}`, hot: false }
  const dd = new Date(due)
  return { text: `${dd.getMonth() + 1}/${dd.getDate()} ${fmtHM(due)}`, hot: false }
}

/** 近 N 天每日完成数（迷你趋势柱状） */
export function dailyDoneSeries(todos: TodoItem[], days: number, now = Date.now()): number[] {
  const d0 = dayStart(new Date(now))
  const out: number[] = []
  for (let i = days - 1; i >= 0; i--) {
    const s = d0 - i * 86400000
    out.push(todos.filter((t) => t.done && (t.doneAt || 0) >= s && (t.doneAt || 0) < s + 86400000).length)
  }
  return out
}

/* ---------- 四象限（艾森豪威尔）---------- */
export type Quadrant = 'q1' | 'q2' | 'q3' | 'q4'
/** 紧急=有截止且≤今天+1天；重要=priority≤2 */
export function quadrantOf(t: TodoItem, now: number): Quadrant {
  const soon = !!t.due && t.due <= dayStart(new Date(now)) + 2 * 86400000
  const important = (t.priority || 3) <= 2
  if (important && soon) return 'q1'
  if (important && !soon) return 'q2'
  if (!important && soon) return 'q3'
  return 'q4'
}
export const QUADRANTS: { key: Quadrant; label: string; hint: string; hue: string }[] = [
  { key: 'q1', label: '重要且紧急', hint: '马上做', hue: '25' },
  { key: 'q2', label: '重要不紧急', hint: '规划做', hue: '150' },
  { key: 'q3', label: '紧急不重要', hint: '尽快清', hue: '75' },
  { key: 'q4', label: '不重要不紧急', hint: '有空再说', hue: '260' }
]

/* ---------- 排序 & 分组 ---------- */
/** 组内排序：置顶 > 手动 order > 优先级 > 截止时间 */
export function sortTodos(items: TodoItem[]): TodoItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.pinned || 0) - Number(a.pinned || 0) ||
      (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
      (a.priority || 3) - (b.priority || 3) ||
      (a.due || Infinity) - (b.due || Infinity)
  )
}

export interface TodoGroup {
  key: string
  label: string
  items: TodoItem[]
}
/** 时间线分组：已到时/今天/明天/本周/以后/未安排（空组剔除） */
export function groupTodos(items: TodoItem[], now: number): TodoGroup[] {
  const d0 = dayStart(new Date(now))
  const g: TodoGroup[] = [
    { key: 'over', label: '⏰ 已到时', items: [] },
    { key: 'today', label: '今天', items: [] },
    { key: 'tomo', label: '明天', items: [] },
    { key: 'week', label: '本周', items: [] },
    { key: 'later', label: '以后', items: [] },
    { key: 'none', label: '未安排', items: [] }
  ]
  for (const t of items) {
    if (!t.due) g[5].items.push(t)
    else if (t.due <= now) g[0].items.push(t)
    else if (t.due < d0 + 86400000) g[1].items.push(t)
    else if (t.due < d0 + 2 * 86400000) g[2].items.push(t)
    else if (t.due < d0 + 7 * 86400000) g[3].items.push(t)
    else g[4].items.push(t)
  }
  for (const grp of g) grp.items = sortTodos(grp.items)
  return g.filter((x) => x.items.length)
}

/* ---------- 今日统计 ---------- */
export interface TodoStats {
  pct: number
  activeCount: number
  doneToday: number
  todayCnt: number
  overdue: number
}
export function todoStats(todos: TodoItem[], now: number): TodoStats {
  const d0 = dayStart(new Date(now))
  const active = todos.filter((t) => !t.done && !t.archived)
  const doneToday = todos.filter((t) => t.done && (t.doneAt || 0) >= d0).length
  const todayCnt = active.filter((t) => t.due && t.due > now && t.due < d0 + 86400000).length
  const overdue = active.filter((t) => t.due && t.due <= now).length
  const totalToday = todayCnt + overdue + doneToday
  const pct = totalToday > 0 ? Math.round((doneToday / totalToday) * 100) : active.length === 0 ? 100 : 0
  return { pct, activeCount: active.length, doneToday, todayCnt, overdue }
}

/* ---------- 执行规划 ---------- */
export interface ExecutionPlan {
  planned: TodoItem[]
  overflow: TodoItem[]
  blocked: TodoItem[]
  plannedMinutes: number
  capacityMinutes: number
}

/** 本地确定性排序：进行中/逾期/高优先/临期/置顶优先，阻塞项不参与。 */
export function executionScore(t: TodoItem, now: number): number {
  if (t.done || t.archived || t.blockedBy?.trim()) return Number.NEGATIVE_INFINITY
  let score = 0
  if ((t.status || 'todo') === 'doing') score += 90
  if (t.pinned) score += 35
  if ((t.priority || 3) === 1) score += 70
  else if ((t.priority || 3) === 2) score += 35
  if (t.due) {
    const hours = (t.due - now) / 3600000
    if (hours <= 0) score += 120
    else if (hours <= 8) score += 75
    else if (hours <= 24) score += 45
    else if (hours <= 72) score += 20
  }
  if ((t.subs || []).length > 0) score += 8
  if (t.acceptance?.trim()) score += 6
  return score
}

/** 按可用分钟生成今日执行队列；任务不可拆时允许首项或进行中任务超出容量。 */
export function buildExecutionPlan(todos: TodoItem[], now: number, capacityMinutes = 360): ExecutionPlan {
  const active = todos.filter((t) => !t.done && !t.archived)
  const blocked = active.filter((t) => !!t.blockedBy?.trim())
  const ranked = active
    .filter((t) => !t.blockedBy?.trim())
    .sort((a, b) => executionScore(b, now) - executionScore(a, now) || (a.createdAt || 0) - (b.createdAt || 0))
  const planned: TodoItem[] = []
  const overflow: TodoItem[] = []
  let minutes = 0
  for (const t of ranked) {
    const cost = Math.max(5, t.estimate || 30)
    if (minutes + cost <= capacityMinutes || planned.length === 0 || (t.status || 'todo') === 'doing') {
      planned.push(t)
      minutes += cost
    } else overflow.push(t)
  }
  return { planned, overflow, blocked, plannedMinutes: minutes, capacityMinutes }
}

export interface ProjectRollup {
  project: string
  total: number
  done: number
  doing: number
  blocked: number
  remainingMinutes: number
  pct: number
}

/** 项目维度汇总；未指定项目的任务归入“未归属”。 */
export function projectRollups(todos: TodoItem[]): ProjectRollup[] {
  const map = new Map<string, TodoItem[]>()
  for (const t of todos.filter((x) => !x.archived)) {
    const key = t.project?.trim() || '未归属'
    map.set(key, [...(map.get(key) || []), t])
  }
  return [...map.entries()].map(([project, items]) => {
    const done = items.filter((t) => t.done).length
    const doing = items.filter((t) => !t.done && (t.status || 'todo') === 'doing').length
    const blocked = items.filter((t) => !t.done && !!t.blockedBy?.trim()).length
    const remainingMinutes = items.filter((t) => !t.done).reduce((sum, t) => sum + Math.max(5, t.estimate || 30), 0)
    return { project, total: items.length, done, doing, blocked, remainingMinutes, pct: items.length ? Math.round(done / items.length * 100) : 0 }
  }).sort((a, b) => b.blocked - a.blocked || b.doing - a.doing || b.remainingMinutes - a.remainingMinutes)
}

/* ---------- Markdown 导入/导出 ---------- */
/** 待办 → Markdown 复选清单（含子任务缩进、标签、截止） */
export function todosToMarkdown(todos: TodoItem[]): string {
  const d0lines = todos.map((t) => {
    const meta: string[] = []
    if (t.due) meta.push(`@${new Date(t.due).getFullYear()}-${pad(new Date(t.due).getMonth() + 1)}-${pad(new Date(t.due).getDate())} ${fmtHM(t.due)}`)
    if (t.priority && t.priority < 3) meta.push(`!${t.priority}`)
    for (const g of t.tags || []) meta.push(`#${g}`)
    const head = `- [${t.done ? 'x' : ' '}] ${t.text}${meta.length ? '  ' + meta.join(' ') : ''}`
    const subs = (t.subs || []).map((s) => `  - [${s.done ? 'x' : ' '}] ${s.text}`)
    return [head, ...subs].join('\n')
  })
  return `# 待办清单（导出于 ${new Date().toLocaleString('zh-CN')}）\n\n${d0lines.join('\n')}\n`
}

export interface ParsedImport {
  text: string
  done: boolean
  due?: number
  priority?: 1 | 2 | 3
  tags?: string[]
  subs?: { text: string; done: boolean }[]
}
/** Markdown 复选清单 → 待办草稿（宽松解析：- [ ] / - [x]，子项两空格缩进，@时间 !优先级 #标签） */
export function markdownToTodos(md: string): ParsedImport[] {
  const out: ParsedImport[] = []
  for (const raw of md.split(/\r?\n/)) {
    const m = raw.match(/^(\s*)-\s*\[([ xX])\]\s*(.+)$/)
    if (!m) continue
    const indent = m[1].length
    const done = m[3] == null ? false : m[2].toLowerCase() === 'x'
    let body = m[3].trim()
    if (indent >= 2 && out.length) {
      out[out.length - 1].subs = [...(out[out.length - 1].subs || []), { text: body, done }]
      continue
    }
    const tags: string[] = []
    let due: number | undefined
    let priority: 1 | 2 | 3 | undefined
    body = body
      .replace(/@(\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?)/g, (_s, d) => {
        const ts = new Date(String(d).replace(' ', 'T')).getTime()
        if (!Number.isNaN(ts)) due = ts
        return ''
      })
      .replace(/!([123])\b/g, (_s, pr) => {
        priority = Number(pr) as 1 | 2 | 3
        return ''
      })
      .replace(/#(\S+)/g, (_s, g) => {
        tags.push(String(g))
        return ''
      })
      .replace(/\s+/g, ' ')
      .trim()
    if (!body) continue
    out.push({ text: body, done, due, priority, tags: tags.length ? tags : undefined })
  }
  return out
}
