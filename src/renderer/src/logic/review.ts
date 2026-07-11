// 今日复盘 / 周报：把当天(或本周)的客观事实(完成的待办 + Agent 活动 + 代码变更)
// 汇成"事实卡"，再交给 AI 写成叙述性复盘。纯逻辑，可 raw-node 直测。

import type { ActivityEntry, TodoItem } from '../types'

/** 本地日期键 YYYY-MM-DD（按传入时间戳所在自然日） */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 某日 [00:00, 次日00:00) 的毫秒区间 */
export function dayRange(key: string): { start: number; end: number } {
  const [y, m, d] = key.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime()
  return { start, end }
}

export interface DayFacts {
  key: string
  /** 当天完成的待办文本 */
  doneTodos: string[]
  /** 当天涉及的 Agent 活动 */
  activities: ActivityEntry[]
  /** 涉及项目（去重） */
  projects: string[]
  /** 代码变更累计 */
  files: number
  added: number
  removed: number
  /** 提交数（有 commit 的活动条数） */
  commits: number
}

/** 汇总某一天的客观事实（供事实卡展示 + 喂给 AI） */
export function buildFacts(key: string, todos: TodoItem[], activities: ActivityEntry[]): DayFacts {
  const { start, end } = dayRange(key)
  const inDay = (t?: number): boolean => typeof t === 'number' && t >= start && t < end

  const doneTodos = todos
    .filter((t) => t.done && inDay(t.doneAt))
    .sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0))
    .map((t) => t.text.trim())
    .filter(Boolean)

  const acts = activities
    .filter((a) => inDay(a.ts) || inDay(a.updatedAt))
    .sort((a, b) => a.ts - b.ts)

  const projects = [...new Set(acts.map((a) => a.proj).filter(Boolean))]
  let files = 0
  let added = 0
  let removed = 0
  let commits = 0
  for (const a of acts) {
    files += a.files || 0
    added += a.added || 0
    removed += a.removed || 0
    if (a.commit) commits += 1
  }
  return { key, doneTodos, activities: acts, projects, files, added, removed, commits }
}

/** 事实卡是否有任何可复盘的内容 */
export function hasContent(f: DayFacts): boolean {
  return f.doneTodos.length > 0 || f.activities.length > 0
}

function factsBlock(f: DayFacts): string {
  const lines: string[] = []
  lines.push(`日期：${f.key}`)
  if (f.doneTodos.length) {
    lines.push(`\n完成的待办（${f.doneTodos.length}）：`)
    f.doneTodos.forEach((t) => lines.push(`- ${t}`))
  }
  if (f.activities.length) {
    lines.push(`\nAI 编码会话（${f.activities.length}）：`)
    f.activities.forEach((a) => {
      const chg = a.files ? ` · 变更 ${a.files} 文件 +${a.added || 0}/-${a.removed || 0}` : ''
      lines.push(`- [${a.tool}] ${a.proj}：${a.detail || '进行中'}${chg}`)
    })
  }
  if (f.projects.length) lines.push(`\n涉及项目：${f.projects.join('、')}`)
  if (f.files) lines.push(`代码变更合计：${f.files} 文件 +${f.added}/-${f.removed}，${f.commits} 次提交`)
  return lines.join('\n')
}

/** 今日复盘系统提示 */
export const REVIEW_SYSTEM =
  '你是用户的私人工作复盘助理。基于给定的当天客观事实，写一份简洁、真诚、可执行的今日复盘。' +
  '要点：① 不编造事实里没有的内容；② 用第二人称"你"；③ 结构用 Markdown。' +
  '固定四个小节：## 今日小结（2-3 句）、## 关键进展（要点列表）、## 遗留与卡点（若无则写"暂无"）、## 明日建议（2-3 条具体动作）。' +
  '语气克制、不吹捧，字数控制在 400 字内。'

export function reviewPrompt(f: DayFacts): string {
  return `请基于以下今日客观事实写复盘：\n\n${factsBlock(f)}`
}

/** 周报系统提示 */
export const WEEKLY_SYSTEM =
  '你是用户的私人工作复盘助理。基于给定的一周每日事实，写一份周报。' +
  '要点：① 不编造；② Markdown；③ 固定小节：## 本周概览（3-4 句）、## 主线进展（按项目或主题归类的要点）、' +
  '## 数据（完成待办数 / 涉及项目 / 代码变更）、## 下周重点（2-3 条）。语气克制，字数 500 字内。'

/** 晨间简报系统提示 */
export const MORNING_SYSTEM =
  '你是用户的私人晨间助理。基于今天的日程、待办、资讯精选与昨日复盘，写一份简短有力的"今日作战地图"。' +
  '要点：① 只用给定信息，不编造；② 用第二人称"你"，语气积极但不啰嗦；③ Markdown。' +
  '结构：一句今日定调开场 → ## 今日日程（按时间，无则写"今天没有排期会议"）→ ## 优先待办（挑最重要的 2-4 项）→ ' +
  '## 值得一读（资讯精选里挑 1-2 条一句话点出）→ 一句收尾鼓励。总字数 350 字内。'

export interface MorningInput {
  dateLabel: string
  meetings: { title: string; time: string; link?: string }[]
  todos: string[]
  picks: { title: string; brief?: string }[]
  yesterday?: string
}

export function morningPrompt(m: MorningInput): string {
  const lines: string[] = [`今天是 ${m.dateLabel}。`]
  lines.push('\n【今日日程】')
  lines.push(m.meetings.length ? m.meetings.map((e) => `- ${e.time} ${e.title}`).join('\n') : '（无排期）')
  lines.push('\n【未完成待办】')
  lines.push(m.todos.length ? m.todos.map((t) => `- ${t}`).join('\n') : '（无）')
  lines.push('\n【资讯精选】')
  lines.push(m.picks.length ? m.picks.map((p) => `- ${p.title}${p.brief ? `：${p.brief}` : ''}`).join('\n') : '（无）')
  if (m.yesterday) lines.push(`\n【昨日复盘摘录】\n${m.yesterday.slice(0, 400)}`)
  return lines.join('\n')
}

export function weeklyPrompt(days: DayFacts[]): string {
  const withContent = days.filter(hasContent)
  const blocks = withContent.map((f) => factsBlock(f)).join('\n\n————\n\n')
  const totalTodos = withContent.reduce((s, f) => s + f.doneTodos.length, 0)
  const allProjects = [...new Set(withContent.flatMap((f) => f.projects))]
  const files = withContent.reduce((s, f) => s + f.files, 0)
  const added = withContent.reduce((s, f) => s + f.added, 0)
  const removed = withContent.reduce((s, f) => s + f.removed, 0)
  const head = `本周合计：完成待办 ${totalTodos} 项 · 项目 ${allProjects.join('、') || '无'} · 代码 ${files} 文件 +${added}/-${removed}`
  return `请基于以下本周每日事实写周报：\n\n${head}\n\n${blocks || '（本周无记录）'}`
}
