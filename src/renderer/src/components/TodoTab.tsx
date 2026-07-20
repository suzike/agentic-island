// 待办 v5 —— 设计系统重做（ui/tokens 层级表面 + lucide 语义图标，功能零改动）：
// ① 顶部日历卡：日期问候 + SVG 进度环 + 统计胶囊
// ② 近期日程（7 天，今天/明天/周N 标签 + 一键入会）
// ③ 统一智能输入胶囊：一个输入框 · AI/手动 双模 · 渐进展开时间/优先级/重复
// ④ 任务分组时间线：优先级色环勾选框（ai-pop 保留）+ 元信息 chips + 悬停操作 + 展开详情
//    （子任务：进度条 / 连续快速添加 / AI 一键拆解 / 备注 Markdown / 专注）

import { useMemo, useRef, useState } from 'react'
import { Check, SkipForward, Undo2 } from 'lucide-react'
import type { TodoItem, WorkbenchProject } from '../types'
import type { CalendarEvent } from '../../../shared/protocol'
import { Markdown } from './Markdown'
import { WEEK, PRIO, pad, fmtHM, dayStart, dueLabel, dailyDoneSeries, groupTodos, buildExecutionPlan, projectRollups } from '../logic/todo'
import { stripFence, parseJsonArray, normPrio, parseDue } from '../logic/todoAi'
import { ProjectContextBar } from './ProjectContextBar'
import { Button, Chip, EmptyState, Group, IconButton, Segmented } from '../ui/components'
import { Ico } from '../ui/icons'
import { accent, accent2, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text as txt, transition } from '../ui/tokens'

interface TodoTabProps {
  projects: WorkbenchProject[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, repoPath?: string) => void
  todos: TodoItem[]
  meetings: CalendarEvent[]
  onJoinMeeting: (link: string) => void
  onAdd: (text: string, due?: number, priority?: 1 | 2 | 3, repeat?: TodoItem['repeat']) => void
  onAiAdd: (input: string) => Promise<string>
  onAiBreakdown: (id: number) => Promise<string>
  onToggle: (id: number) => void
  onEdit: (id: number, text: string, due?: number) => void
  onDelete: (id: number) => void
  onSnooze: (id: number, minutes: number) => void
  onCyclePriority: (id: number) => void
  onClearDone: () => void
  onSetNote: (id: number, note: string) => void
  onAddSub: (id: number, text: string) => void
  onToggleSub: (id: number, subId: number) => void
  onDeleteSub: (id: number, subId: number) => void
  onFocus: (t: TodoItem) => void
  onPin: (id: number) => void
  onTomorrow: (id: number) => void
  /** 看板：设置任务状态（待办/进行中/已完成） */
  onSetStatus: (id: number, status: 'todo' | 'doing' | 'done') => void
  /** 看板列内快速添加到指定状态 */
  onQuickAdd: (text: string, status: 'todo' | 'doing' | 'done') => void
  /** 通用补丁更新（标签/预估/归档/投入时长等新功能统一走这条） */
  onPatch: (id: number, patch: Partial<TodoItem>) => void
  /** 批量新增（AI 规划/日程编排一次进多条） */
  onBulkAdd: (items: Array<Pick<TodoItem, 'text'> & Partial<TodoItem>>) => void
  /** 通用 AI（子任务外的全部 AI 增强） */
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  llmReady: boolean
}

const inputBase: React.CSSProperties = {
  background: 'transparent', border: 'none', outline: 'none',
  color: ink(1), fontSize: FS.body,
  fontFamily: 'inherit'
}
/** 筛选/操作 chip：设计系统令牌版（active 时可用语义色描边） */
const chipS = (on: boolean, color?: string): React.CSSProperties => {
  const c = color || accent()
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3.5px 10px', borderRadius: R.pill, fontSize: FS.tiny, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
    background: on ? semBg(c, 0.16) : fill(2),
    border: `0.5px solid ${on ? c : hairline(0.07)}`,
    color: on ? c : ink(2),
    transition: transition('background, border-color, color')
  }
}
/** 顶部日历卡统计胶囊 */
const statPill = (color?: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 9px', borderRadius: R.pill,
  background: color ? semBg(color, 0.16) : fill(2),
  color: color || ink(2), fontSize: FS.tiny, fontWeight: 600
})
const bulkBtn: React.CSSProperties = { height: 26, padding: '0 9px', borderRadius: R.sm, border: `0.5px solid ${hairline(0.09)}`, background: fill(2), color: ink(1), cursor: 'pointer', fontFamily: 'var(--font)', fontSize: FS.tiny, fontWeight: 650 }
const detailInput: React.CSSProperties = { boxSizing: 'border-box', borderRadius: R.sm, border: `0.5px solid ${hairline(0.08)}`, background: surface.inset().background, color: ink(1), padding: '6px 8px', outline: 'none', fontFamily: 'var(--font)', fontSize: FS.tiny }
const microBtn: React.CSSProperties = { height: 25, padding: '0 8px', borderRadius: R.sm, border: `0.5px solid ${hairline(0.07)}`, background: fill(1), color: ink(2), cursor: 'pointer', fontFamily: 'var(--font)', fontSize: FS.tiny, fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 3 }

/* ---------- 进度环 ---------- */
function ProgressRing({ pct }: { pct: number }): React.JSX.Element {
  const R = 20
  const C = 2 * Math.PI * R
  return (
    <svg width={52} height={52} style={{ flex: 'none' }}>
      <circle cx={26} cy={26} r={R} fill="none" strokeWidth={4.5} style={{ stroke: fill(3) }} />
      <circle
        cx={26} cy={26} r={R} fill="none"
        stroke="url(#ring-grad)" strokeWidth={4.5} strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
        transform="rotate(-90 26 26)" style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.22,.61,.36,1)' }}
      />
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          {/* SVG 属性不解析 CSS 变量 → 用 style 的 stopColor（CSS 属性可用 var） */}
          <stop offset="0%" style={{ stopColor: accent(0.82) }} />
          <stop offset="100%" style={{ stopColor: accent2(0.65) }} />
        </linearGradient>
      </defs>
      <text x={26} y={30} textAnchor="middle" style={{ fill: ink(1), fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct}</text>
    </svg>
  )
}

/* ================= 主组件 ================= */
export function TodoTab(p: TodoTabProps): React.JSX.Element {
  const now = Date.now()
  const [text, setText] = useState('')
  const [aiMode, setAiMode] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<1 | 2 | 3>(3)
  const [repeat, setRepeat] = useState<TodoItem['repeat']>('none')
  const [view, setView] = useState<'plan' | 'active' | 'done' | 'board'>('active')
  const [capacityMinutes, setCapacityMinutes] = useState(360)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropCol, setDropCol] = useState<string | null>(null)
  // 看板列内快速添加 + 列折叠
  const [addingCol, setAddingCol] = useState<'todo' | 'doing' | 'done' | null>(null)
  const [addText, setAddText] = useState('')
  const [colCollapse, setColCollapse] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  // 行内编辑（Electron 里 window.prompt 不可用——之前双击编辑没反应就是这个原因）
  const [edit, setEdit] = useState<{ id: number; text: string; due: string } | null>(null)
  const [subDraft, setSubDraft] = useState('')
  const [breaking, setBreaking] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const subInputRef = useRef<HTMLInputElement>(null)

  /* ---- 新增功能 state ---- */
  const [tagFilter, setTagFilter] = useState<string | null>(null) // 标签筛选
  const [quickFilter, setQuickFilter] = useState<'all' | 'today' | 'week' | 'noDue' | 'high' | 'tagged'>('all') // 快速筛选
  const [selecting, setSelecting] = useState(false) // 批量多选模式
  const [selected, setSelected] = useState<Set<number>>(new Set()) // 已选 id
  const [showArchive, setShowArchive] = useState(false) // 归档视图开关
  const [tagDraft, setTagDraft] = useState<{ id: number; text: string } | null>(null) // 行内加标签
  const [aiEstBusy, setAiEstBusy] = useState<number | null>(null) // 单任务 AI 估时中
  const [aiTagBusy, setAiTagBusy] = useState<number | null>(null) // 单任务 AI 打标签中
  const [aiSmartBusy, setAiSmartBusy] = useState<number | null>(null) // 单任务 SMART 化中

  // AI 面板：一段话规划 / 聚焦 / 站会 / 逾期诊断 / 周计划 / 澄清 —— 结果统一进 aiPanel
  const [aiTool, setAiTool] = useState<'plan' | 'schedule' | 'focus' | 'standup' | 'review' | 'diagnose' | 'risk' | 'week' | 'clarify' | 'merge' | null>(null)
  const [aiInput, setAiInput] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPanel, setAiPanel] = useState<{ title: string; body: string } | null>(null)
  const [aiPlanItems, setAiPlanItems] = useState<Array<Pick<TodoItem, 'text'> & Partial<TodoItem>> | null>(null)

  const flash = (m: string): void => { setMsg(m); setTimeout(() => setMsg(''), 2600) }
  const needLLM = (): boolean => {
    if (!p.llmReady) { flash('请先在设置里配置模型'); return true }
    return false
  }

  /* ---- 统计 ---- */
  const d0 = dayStart(new Date(now))
  const active = p.todos.filter((t) => !t.done)
  const doneToday = p.todos.filter((t) => t.done && (t.doneAt || 0) >= d0).length
  const todayCnt = active.filter((t) => t.due && t.due > now && t.due < d0 + 86400000).length
  const overdue = active.filter((t) => t.due && t.due <= now).length
  const totalToday = todayCnt + overdue + doneToday
  const pct = totalToday > 0 ? Math.round((doneToday / totalToday) * 100) : active.length === 0 ? 100 : 0
  const today = new Date()

  /* ---- 近期日程（7 天）---- */
  const upcoming = p.meetings.filter((m) => m.end > now).slice(0, 5)
  const meetDay = (ts: number): string => {
    if (ts < d0 + 86400000) return '今天'
    if (ts < d0 + 2 * 86400000) return '明天'
    return `${WEEK[new Date(ts).getDay()]} ${new Date(ts).getMonth() + 1}/${new Date(ts).getDate()}`
  }

  /* ---- 全部标签 + 今日工时汇总 + 7 天趋势 ---- */
  const allTags = useMemo(() => {
    const s = new Set<string>()
    for (const t of p.todos) for (const g of t.tags || []) s.add(g)
    return [...s].sort()
  }, [p.todos])
  const todayEstimate = useMemo(
    () => active.filter((t) => t.due && t.due >= d0 && t.due < d0 + 86400000 || (t.due && t.due <= now)).reduce((a, t) => a + (t.estimate || 0), 0),
    [active, d0, now]
  )
  const totalSpent = useMemo(() => p.todos.reduce((a, t) => a + (t.spent || 0), 0), [p.todos])
  const trend = useMemo(() => dailyDoneSeries(p.todos, 7, now), [p.todos, now])
  const archivedList = useMemo(() => p.todos.filter((t) => t.archived), [p.todos])
  const projects = useMemo(() => [...new Set(p.todos.map((t) => t.project?.trim()).filter((x): x is string => !!x))].sort(), [p.todos])
  const activeContextProject = useMemo(() => p.projects.find((x) => x.id === p.activeProjectId), [p.projects, p.activeProjectId])
  const executionPlan = useMemo(() => buildExecutionPlan(p.todos, now, capacityMinutes), [p.todos, now, capacityMinutes])
  const projectStats = useMemo(() => projectRollups(p.todos), [p.todos])

  /* ---- 任务分组 ---- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = p.todos.filter((t) => !t.archived && (view === 'done' ? t.done : !t.done))
    // 快速筛选条
    if (quickFilter === 'today') list = list.filter((t) => t.due && t.due < d0 + 86400000)
    else if (quickFilter === 'week') list = list.filter((t) => t.due && t.due < d0 + 7 * 86400000)
    else if (quickFilter === 'noDue') list = list.filter((t) => !t.due)
    else if (quickFilter === 'high') list = list.filter((t) => (t.priority || 3) <= 2)
    else if (quickFilter === 'tagged') list = list.filter((t) => (t.tags || []).length > 0)
    // 标签筛选
    if (tagFilter) list = list.filter((t) => (t.tags || []).includes(tagFilter))
    if (projectFilter) list = list.filter((t) => (t.project?.trim() || '未归属') === projectFilter)
    if (p.activeProjectId) list = list.filter((t) => t.projectId === p.activeProjectId || (!!activeContextProject && t.project === activeContextProject.name))
    if (!q) return list
    return list.filter((t) => (t.text + (t.note || '') + (t.tags || []).join(' ') + (t.subs || []).map((s) => s.text).join(' ')).toLowerCase().includes(q))
  }, [p.todos, p.activeProjectId, activeContextProject, view, query, quickFilter, tagFilter, projectFilter, d0])

  const groups = useMemo(() => {
    if (view === 'done') return [{ key: 'done', label: '已完成', items: [...filtered].sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)) }]
    if (view === 'plan') return []
    return groupTodos(filtered, now)
  }, [filtered, view, now])

  /* ---- 提交 ---- */
  const submit = (): void => {
    const v = text.trim()
    if (!v || busy) return
    if (aiMode) {
      setBusy(true)
      setMsg('✨ AI 正在整理…')
      void p.onAiAdd(v).then((r) => { setBusy(false); setMsg(r); if (r.startsWith('✓')) setText('') })
    } else {
      p.onAdd(v, due ? new Date(due).getTime() : undefined, priority, repeat)
      setText(''); setDue(''); setPriority(3); setRepeat('none'); setMsg('✓ 已添加')
      setTimeout(() => setMsg(''), 2000)
    }
  }
  const preset = (k: string): void => {
    const d = new Date()
    if (k === '1h') d.setHours(d.getHours() + 1)
    else if (k === 'tonight') { d.setHours(20, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1) }
    else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0) }
    setDue(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }
  const addSub = (id: number): void => {
    const v = subDraft.trim()
    if (!v) return
    p.onAddSub(id, v)
    setSubDraft('')
    requestAnimationFrame(() => subInputRef.current?.focus()) // 连续快速添加
  }
  const breakdown = (id: number): void => {
    setBreaking(id)
    void p.onAiBreakdown(id).then((r) => { setBreaking(null); setMsg(r); setTimeout(() => setMsg(''), 2500) })
  }

  // 行内编辑：进入/保存
  const startEdit = (t: TodoItem): void => {
    const d = t.due ? new Date(t.due) : null
    setEdit({ id: t.id, text: t.text, due: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '' })
  }
  const saveEdit = (): void => {
    if (!edit) return
    const v = edit.text.trim()
    if (v) p.onEdit(edit.id, v, edit.due ? new Date(edit.due).getTime() : undefined)
    setEdit(null)
  }

  /* ---------- 功能类：标签 / 批量 / 归档 / 顺延 ---------- */
  const toggleTag = (t: TodoItem, tag: string): void => {
    const cur = t.tags || []
    p.onPatch(t.id, { tags: cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag] })
  }
  const commitTagDraft = (): void => {
    if (!tagDraft) return
    const t = p.todos.find((x) => x.id === tagDraft.id)
    const v = tagDraft.text.trim().replace(/^#/, '')
    if (t && v && !(t.tags || []).includes(v)) p.onPatch(t.id, { tags: [...(t.tags || []), v] })
    setTagDraft(null)
  }
  const toggleSelect = (id: number): void =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const exitSelect = (): void => { setSelecting(false); setSelected(new Set()) }
  const bulkDone = (): void => { selected.forEach((id) => { const t = p.todos.find((x) => x.id === id); if (t && !t.done) p.onToggle(id) }); exitSelect() }
  const bulkDelete = (): void => { selected.forEach((id) => p.onDelete(id)); exitSelect() }
  const bulkArchive = (): void => { selected.forEach((id) => p.onPatch(id, { archived: true })); exitSelect() }
  const bulkTomorrow = (): void => { selected.forEach((id) => p.onTomorrow(id)); exitSelect() }
  const bulkTag = (tag: string): void => { selected.forEach((id) => { const t = p.todos.find((x) => x.id === id); if (t) p.onPatch(id, { tags: [...new Set([...(t.tags || []), tag])] }) }) }
  /** 一键顺延全部逾期到明早 9 点 */
  const deferOverdue = (): void => {
    const base = dayStart(new Date(now)) + 86400000 + 9 * 3600000
    let n = 0
    p.todos.filter((t) => !t.done && !t.archived && t.due && t.due <= now).forEach((t) => { p.onPatch(t.id, { due: base }); n++ })
    flash(n ? `✓ 已顺延 ${n} 条逾期任务到明早` : '没有逾期任务')
  }
  /** 复制任务（连子任务，Markdown 清单） */
  const copyTask = (t: TodoItem): void => {
    const subs = t.subs || []
    const md = t.text + (subs.length ? '\n' + subs.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n') : '')
    navigator.clipboard?.writeText(md).then(() => flash('✓ 已复制')).catch(() => {})
  }

  /* ---------- AI 类：单任务增强 ---------- */
  const aiEstimate = async (t: TodoItem): Promise<void> => {
    if (needLLM()) return
    setAiEstBusy(t.id)
    const r = await p.onAI('你是时间管理专家。为下面这条任务估算完成所需分钟数，只回一个整数分钟数，不要任何其它文字。', t.text)
    setAiEstBusy(null)
    if (!r.ok) return flash(r.error || 'AI 估时失败')
    const m = (r.text || '').match(/\d+/)
    if (m) { p.onPatch(t.id, { estimate: Math.min(600, Math.max(5, Number(m[0]))) }); flash(`✓ 预估 ${m[0]} 分钟`) }
    else flash('未能解析估时结果')
  }
  const aiAutoTag = async (t: TodoItem): Promise<void> => {
    if (needLLM()) return
    setAiTagBusy(t.id)
    const r = await p.onAI(`你是任务归类助手。为任务生成 1-3 个简短中文标签（每个 2-6 字，如"工作/学习/健康/家庭/紧急"）。只回 JSON 数组，如 ["工作","会议"]。${allTags.length ? '优先复用已有标签：' + allTags.join('、') : ''}`, t.text)
    setAiTagBusy(null)
    if (!r.ok) return flash(r.error || 'AI 打标签失败')
    const arr = parseJsonArray(r.text || '')
    if (arr && arr.length) {
      const tags = arr.map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean).slice(0, 3)
      p.onPatch(t.id, { tags: [...new Set([...(t.tags || []), ...tags])] })
      flash(`✓ 已加标签 ${tags.join('、')}`)
    } else flash('未能解析标签')
  }
  const aiSmart = async (t: TodoItem): Promise<void> => {
    if (needLLM()) return
    setAiSmartBusy(t.id)
    const r = await p.onAI('你是执行力教练。把任务改写得更清晰可执行（SMART：具体、可衡量、有动作动词），保持简洁一行。只回改写后的一句话，不要引号和解释。', t.text)
    setAiSmartBusy(null)
    if (!r.ok) return flash(r.error || 'AI 改写失败')
    const v = stripFence(r.text || '').replace(/^["「]|["」]$/g, '').trim()
    if (v) { p.onEdit(t.id, v, t.due); flash('✓ 已优化为可执行描述') }
    else flash('未能解析改写结果')
  }

  /* ---------- AI 类：面板级（规划/排期/聚焦/站会/复盘/诊断/周计划/澄清/合并） ---------- */
  const openAi = (tool: typeof aiTool): void => {
    if (needLLM()) return
    setAiTool(tool); setAiInput(''); setAiPanel(null); setAiPlanItems(null)
    // 无需输入的工具直接执行
    if (tool && tool !== 'plan' && tool !== 'clarify') void runAi(tool, '')
  }
  const briefTasks = (list: TodoItem[]): string =>
    list.slice(0, 30).map((t) => `- ${t.text}${t.due ? `（截止 ${dueLabel(t.due, now).text}）` : ''}${(t.priority || 3) < 3 ? `【${PRIO[t.priority as 1 | 2].label}】` : ''}`).join('\n') || '（无）'

  const runAi = async (tool: NonNullable<typeof aiTool>, input: string): Promise<void> => {
    if (needLLM()) return
    setAiBusy(true); setAiPanel(null); setAiPlanItems(null)
    const doneList = p.todos.filter((t) => t.done && (t.doneAt || 0) >= d0)
    const openList = active
    const overdueList = active.filter((t) => t.due && t.due <= now)
    try {
      if (tool === 'plan') {
        const r = await p.onAI(
          '你是资深工程项目规划助手。把目标拆成可独立验收的执行任务，只回 JSON 数组。每项字段：text（动作+对象）、project（所属项目/工作流）、due（自然语言时间或空）、priority（1紧急/2重要/3普通）、estimate（5-480分钟）、energy（deep|normal|light）、acceptance（可验证完成标准）、blockedBy（明确前置依赖，无则空）、tags（1-3个）。任务顺序要体现依赖，避免“完成项目”这类空泛描述。',
          input
        )
        if (!r.ok) throw new Error(r.error)
        const arr = parseJsonArray(r.text || '')
        if (!arr || !arr.length) { setAiPanel({ title: '规划结果', body: '未能解析成任务，AI 原文：\n\n' + (r.text || '') }); return }
        const items = arr.map((x) => {
          const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
          const energy: TodoItem['energy'] = o.energy === 'deep' || o.energy === 'light' ? o.energy : 'normal'
          const estimate = Math.min(480, Math.max(5, Number(o.estimate) || 30))
          return {
            text: String(o.text || o.title || x).trim(), due: parseDue(o.due, now), priority: normPrio(o.priority),
            tags: Array.isArray(o.tags) ? o.tags.map(String) : undefined,
            project: String(o.project || '').trim() || undefined,
            energy,
            estimate,
            acceptance: String(o.acceptance || '').trim() || undefined,
            blockedBy: String(o.blockedBy || '').trim() || undefined
          }
        }).filter((x) => x.text)
        setAiPlanItems(items)
      } else if (tool === 'schedule') {
        const noDue = openList.filter((t) => !t.due)
        if (!noDue.length) { setAiPanel({ title: '智能排期', body: '当前没有"未安排时间"的任务。' }); return }
        const r = await p.onAI(
          '你是日程规划师。为下列无期限任务安排到今天/明天/后天的合理时段（工作时间 9-18 点，高优先在前）。只回 JSON 数组 [{"i":序号从0开始,"due":"明天14:00"}]。',
          noDue.map((t, i) => `${i}. ${t.text}${(t.priority || 3) < 3 ? `【${PRIO[t.priority as 1 | 2].label}】` : ''}`).join('\n')
        )
        if (!r.ok) throw new Error(r.error)
        const arr = parseJsonArray(r.text || '')
        let n = 0
        if (arr) for (const x of arr) {
          const o = x as Record<string, unknown>
          const idx = Number(o.i)
          const due = parseDue(o.due, now)
          if (noDue[idx] && due) { p.onPatch(noDue[idx].id, { due }); n++ }
        }
        setAiPanel({ title: '智能排期', body: n ? `✓ 已为 ${n} 条任务智能安排时间，可在列表中查看。` : '未能解析排期结果，请重试。' })
      } else if (tool === 'focus') {
        const r = await p.onAI('你是效率教练。从我的待办里选出现在最该做的 3 件事，每件一句话说明为什么。用简洁中文 Markdown 有序列表。', briefTasks(openList))
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '🎯 今日聚焦建议', body: r.text || '' })
      } else if (tool === 'standup') {
        const r = await p.onAI('你是敏捷教练。基于今天已完成和待办，生成一段中文站会小结：昨日/今日进展、今天计划、可能的阻塞。简洁 Markdown。', `已完成：\n${briefTasks(doneList)}\n\n待办：\n${briefTasks(openList)}`)
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '🧑‍💻 每日站会', body: r.text || '' })
      } else if (tool === 'review') {
        const r = await p.onAI('你是复盘教练。基于今天完成情况做一段温和有洞见的每日复盘：完成亮点、可改进点、给明天的一条建议。简洁中文 Markdown。', `今日已完成 ${doneList.length} 条：\n${briefTasks(doneList)}\n\n仍待办：\n${briefTasks(openList)}`)
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '🌙 每日复盘', body: r.text || '' })
      } else if (tool === 'diagnose') {
        if (!overdueList.length) { setAiPanel({ title: '逾期诊断', body: '太棒了，当前没有逾期任务。' }); return }
        const r = await p.onAI('你是拖延症教练。分析这些逾期任务为什么被拖延，给出针对性的破局建议（如拆小、换时段、降低门槛）。简洁中文 Markdown。', briefTasks(overdueList))
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '⏰ 逾期诊断', body: r.text || '' })
      } else if (tool === 'risk') {
        const riskInput = openList.map((t) => {
          const meta = [t.project && `项目:${t.project}`, t.blockedBy && `阻塞:${t.blockedBy}`, t.estimate && `估时:${t.estimate}m`, t.acceptance && `验收:${t.acceptance}`, t.status && `状态:${t.status}`].filter(Boolean).join('；')
          return `- ${t.text}${meta ? `（${meta}）` : ''}`
        }).join('\n') || '（无）'
        const r = await p.onAI('你是工程项目风险经理。识别任务组合中的阻塞链、WIP 过载、关键任务缺少验收标准、估时失衡、截止冲突和项目资源冲突。按“立即处理/本周关注/信息待确认”输出，每项给具体动作。不要编造。简洁中文 Markdown。', riskInput)
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '⚠ 执行风险诊断', body: r.text || '' })
      } else if (tool === 'week') {
        const r = await p.onAI('你是周计划顾问。基于我的待办，给出一份本周（周一到周日）的合理安排建议，按天分配重点任务。简洁中文 Markdown。', briefTasks(openList))
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '📅 本周计划', body: r.text || '' })
      } else if (tool === 'merge') {
        const r = await p.onAI('你是任务整理助手。找出下列任务里语义重复或可合并的组，给出合并建议（哪些合成一条、新描述）。若无重复就说明。简洁中文 Markdown。', briefTasks(openList))
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '🧹 合并建议', body: r.text || '' })
      } else if (tool === 'clarify') {
        const r = await p.onAI('用户给了一个模糊目标。先用 2-3 个澄清问题帮他想清楚，再给出初步的任务拆解建议。简洁中文 Markdown。', input)
        if (!r.ok) throw new Error(r.error)
        setAiPanel({ title: '💬 目标澄清', body: r.text || '' })
      }
    } catch (e) {
      setAiPanel({ title: '出错了', body: (e instanceof Error && e.message) || 'AI 调用失败，请重试。' })
    } finally {
      setAiBusy(false)
    }
  }
  /** 采纳 AI 规划：一次进多条 */
  const adoptPlan = (): void => {
    if (!aiPlanItems || !aiPlanItems.length) return
    p.onBulkAdd(aiPlanItems)
    flash(`✓ 已添加 ${aiPlanItems.length} 条任务`)
    setAiTool(null); setAiPlanItems(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ProjectContextBar
        projects={p.projects}
        activeProjectId={p.activeProjectId}
        onSelect={p.onSelectProject}
        onCreate={p.onCreateProject}
        label="执行项目"
        detail="新建任务自动进入当前项目，旧任务保持原归属"
      />
      {/* ① 顶部日历卡：日期 + 进度环 + 统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, padding: `${SP.md}px ${SP.lg - 1}px`, ...surface.card(), background: `linear-gradient(135deg, ${accent(0.7, 0.16)}, ${accent2(0.6, 0.1)})`, border: `0.5px solid ${accent(0.6, 0.3)}` }}>
        <ProgressRing pct={pct} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...txt.title(), fontSize: 17, fontWeight: 800 }}>{today.getMonth() + 1} 月 {today.getDate()} 日</span>
            <span style={txt.dim()}>{WEEK[today.getDay()]}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {overdue > 0 && <span style={statPill(sem.warn)}><Ico.alarm size={10} strokeWidth={2} />到时 {overdue}</span>}
            <span style={statPill()}>今日 {todayCnt + overdue}</span>
            <span style={statPill(accent())}><Check size={10} strokeWidth={2.5} />{doneToday}</span>
            {todayEstimate > 0 && <span title="今日任务预估工时合计" style={statPill(sem.run)}><Ico.timer size={10} strokeWidth={2} />{todayEstimate >= 60 ? `${(todayEstimate / 60).toFixed(1)}h` : `${todayEstimate}m`}</span>}
            {totalSpent > 0 && <span title="累计专注投入" style={statPill(sem.focus)}><Ico.focus size={10} strokeWidth={2} />{totalSpent >= 60 ? `${(totalSpent / 60).toFixed(1)}h` : `${totalSpent}m`}</span>}
            <span style={{ ...statPill(), color: ink(3) }}>全部 {active.length}</span>
          </div>
        </div>
        {/* 近 7 天完成趋势迷你柱状 */}
        {trend.some((n) => n > 0) && (() => {
          const max = Math.max(1, ...trend)
          return (
            <div title="近 7 天每日完成数" style={{ flex: 'none', display: 'flex', alignItems: 'flex-end', gap: 3, height: 34, paddingLeft: 4 }}>
              {trend.map((n, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ width: 5, height: `${Math.max(8, (n / max) * 100)}%`, borderRadius: R.pill, background: i === 6 ? accent() : accent(0.55, 0.45) }} />
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* AI 执行指挥条：规划、排期、风险、汇报形成闭环 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 5 }}>
        {([
          ['plan', '目标拆解', Ico.plan], ['schedule', '智能排期', Ico.calendar], ['focus', '今日聚焦', Ico.focus],
          ['risk', '风险诊断', Ico.approval], ['standup', '生成站会', Ico.review], ['week', '本周计划', Ico.grid]
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            className="hv"
            onClick={() => openAi(key)}
            title={label}
            style={{ minWidth: 0, height: 34, padding: '0 6px', borderRadius: R.md, border: `0.5px solid ${aiTool === key ? accent(0.72, 0.5) : hairline(0.07)}`, background: aiTool === key ? semBg(accent(), 0.2) : fill(1), color: ink(1), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'var(--font)', transition: transition('background, border-color') }}
          >
            <Icon size={12} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9.5, fontWeight: 650 }}>{label}</span>
          </button>
        ))}
      </div>

      {aiTool && (
        <div style={{ padding: SP.md, ...surface.card(), border: `0.5px solid ${accent(0.65, 0.35)}`, animation: 'ai-fadein .18s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: aiTool === 'plan' || aiTool === 'clarify' || aiPanel || aiPlanItems ? 9 : 0 }}>
            <Ico.ai size={13} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
            <span style={txt.subtitle()}>
              {aiTool === 'plan' ? '目标拆解与执行建模' : aiTool === 'schedule' ? '智能排期' : aiTool === 'focus' ? '今日聚焦' : aiTool === 'risk' ? '执行风险诊断' : aiTool === 'standup' ? '站会报告' : aiTool === 'week' ? '本周计划' : 'AI 增强'}
            </span>
            {aiBusy && <span style={{ color: sem.calm, fontSize: 9.5 }}>分析中…</span>}
            <span style={{ flex: 1 }} />
            <IconButton icon={Ico.close} size={22} onClick={() => { setAiTool(null); setAiPanel(null); setAiPlanItems(null) }} title="关闭" />
          </div>
          {(aiTool === 'plan' || aiTool === 'clarify') && !aiPlanItems && !aiPanel && (
            <div style={{ display: 'flex', gap: 7 }}>
              <textarea
                autoFocus
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder={aiTool === 'plan' ? '描述目标、交付物、期限和约束，AI 会拆成带项目/估时/精力/验收标准的任务…' : '描述需要澄清的目标…'}
                rows={3}
                className="ai-scroll"
                style={{ flex: 1, resize: 'none', minWidth: 0, ...surface.inset(), borderRadius: R.sm, color: ink(1), padding: '8px 9px', outline: 'none', fontFamily: 'var(--font)', fontSize: FS.small, lineHeight: 1.5 }}
              />
              <button type="button" className="hv" disabled={!aiInput.trim() || aiBusy} onClick={() => void runAi(aiTool, aiInput.trim())} style={{ alignSelf: 'stretch', width: 74, borderRadius: R.md, border: 0, background: aiInput.trim() ? gradient.primary() : fill(3), color: aiInput.trim() ? gradient.onPrimary() : ink(3), cursor: aiInput.trim() ? 'pointer' : 'default', fontFamily: 'var(--font)', fontSize: 10.5, fontWeight: 750 }}>生成计划</button>
            </div>
          )}
          {aiPlanItems && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {aiPlanItems.map((item, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 8, alignItems: 'start', padding: '8px 9px', borderRadius: R.md, background: fill(1), border: `0.5px solid ${hairline(0.05)}` }}>
                  <span style={{ ...txt.num(10), color: accent(0.72) }}>{String(i + 1).padStart(2, '0')}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: ink(1), fontSize: FS.small, fontWeight: 650, lineHeight: 1.4 }}>{item.text}</div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {item.project && <span style={chipS(false)}>项目 · {item.project}</span>}
                      <span style={chipS(false)}>{item.estimate || 30}m</span>
                      <span style={chipS(false)}>{item.energy === 'deep' ? '深度' : item.energy === 'light' ? '轻量' : '常规'}</span>
                      {item.blockedBy && <span style={{ ...chipS(false), border: `0.5px solid ${semBg(sem.warn, 0.45)}`, background: semBg(sem.warn, 0.12), color: sem.warn }}>阻塞 · {item.blockedBy}</span>}
                    </div>
                    {item.acceptance && <div style={{ marginTop: 5, ...txt.faint(), lineHeight: 1.45 }}>验收：{item.acceptance}</div>}
                  </div>
                  <span style={{ color: PRIO[(item.priority || 3) as 1 | 2 | 3].color, fontSize: 9.5, fontWeight: 700 }}>P{item.priority || 3}</span>
                </div>
              ))}
              <Button variant="primary" onClick={adoptPlan} style={{ alignSelf: 'flex-end', marginTop: 2 }}>采纳 {aiPlanItems.length} 项</Button>
            </div>
          )}
          {aiPanel && <div style={{ color: ink(1), fontSize: FS.small, lineHeight: 1.55 }}><Markdown text={aiPanel.body} /></div>}
        </div>
      )}

      {/* ② 近期日程（7 天）：飞书日历 */}
      {upcoming.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 3px' }}>
            <Ico.calendar size={11} strokeWidth={2} style={{ color: ink(3), flex: 'none' }} />
            <span style={txt.overline()}>近期日程</span>
            <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
          </div>
          {upcoming.map((m) => {
            const ongoing = m.start <= now
            return (
              <div key={m.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', borderRadius: R.md, background: ongoing ? semBg(sem.warn, 0.14) : fill(1), border: `0.5px solid ${ongoing ? semBg(sem.warn, 0.45) : hairline(0.06)}` }}>
                <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 }}>
                  <span style={{ color: ongoing ? sem.warn : accent(), fontSize: 9.5, fontWeight: 700 }}>{meetDay(m.start)}</span>
                  <span style={{ color: ink(1), fontSize: FS.small, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.allDay ? '全天' : fmtHM(m.start)}</span>
                </div>
                <div style={{ width: 2.5, alignSelf: 'stretch', borderRadius: R.pill, background: ongoing ? sem.warn : accent(0.6, 0.5), flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: ink(1), fontSize: FS.body, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
                  <div style={{ ...txt.faint(), fontSize: 9.5 }}>{ongoing ? '进行中' : `${Math.max(1, Math.round((m.start - now) / 60000)) < 120 ? Math.max(1, Math.round((m.start - now) / 60000)) + ' 分钟后' : meetDay(m.start)}`}{m.location ? ` · ${m.location}` : ''}</div>
                </div>
                {m.link && (
                  <Button sm variant="primary" icon={Ico.play} onClick={() => p.onJoinMeeting(m.link!)} style={{ flex: 'none' }}>入会</Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ③ 统一智能输入胶囊 */}
      <div style={{ ...surface.inset(), borderRadius: R.lg, padding: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* AI / 手动 切换 */}
          <div className="hv" onClick={() => setAiMode((v) => !v)} title={aiMode ? 'AI 智能模式：口语描述自动整理（点击切手动）' : '手动模式（点击切 AI）'} style={{ flex: 'none', width: 30, height: 30, borderRadius: R.md, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: aiMode ? gradient.brand() : fill(3), color: aiMode ? gradient.onPrimary() : ink(2), boxShadow: aiMode ? `0 2px 10px ${accent(0.7, 0.4)}` : 'none', transition: transition('background, box-shadow') }}>
            {aiMode ? <Ico.ai size={14} strokeWidth={2} /> : <Ico.edit size={13} strokeWidth={2} />}
          </div>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder={aiMode ? '口语描述，AI 自动拆条 + 定时间：明早9点站会每天提醒…' : '记一条待办，Enter 添加'}
            disabled={busy}
            style={{ ...inputBase, flex: 1, opacity: busy ? 0.6 : 1, padding: '4px 2px' }}
          />
          <div className="hv" onClick={submit} style={{ flex: 'none', padding: '6.5px 15px', borderRadius: R.pill, cursor: text.trim() && !busy ? 'pointer' : 'default', background: text.trim() && !busy ? gradient.primary() : fill(3), color: text.trim() && !busy ? gradient.onPrimary() : ink(3), fontSize: FS.small, fontWeight: 700, transition: transition('background, color') }}>
            {busy ? '…' : aiMode ? 'AI 添加' : '添加'}
          </div>
        </div>
        {/* 手动模式渐进展开：时间/优先级/重复 */}
        {!aiMode && text && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8, animation: 'ai-fadein .2s ease' }}>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={{ background: fill(2), border: `0.5px solid ${hairline(0.1)}`, borderRadius: R.sm, color: ink(1), colorScheme: 'dark', fontSize: 10.5, padding: '4.5px 8px', outline: 'none', fontFamily: 'ui-monospace,monospace' }} />
            <span className="hv" style={chipS(false)} onClick={() => preset('1h')}>+1小时</span>
            <span className="hv" style={chipS(false)} onClick={() => preset('tonight')}>今晚8点</span>
            <span className="hv" style={chipS(false)} onClick={() => preset('tomorrow')}>明早9点</span>
            <span style={{ width: 0.5, height: 14, background: hairline(0.14) }} />
            {([1, 2, 3] as const).map((pr) => (
              <span key={pr} className="hv" onClick={() => setPriority(pr)} style={chipS(priority === pr, PRIO[pr].color)}>{PRIO[pr].label}</span>
            ))}
            <span style={{ width: 0.5, height: 14, background: hairline(0.14) }} />
            {(['none', 'daily', 'weekly'] as const).map((r) => (
              <span key={r} className="hv" onClick={() => setRepeat(r)} style={chipS(repeat === r)}>{r === 'none' ? '不重复' : r === 'daily' ? '每天' : '每周'}</span>
            ))}
          </div>
        )}
        {msg && <div style={{ marginTop: 7, color: msg.startsWith('✓') ? accent() : ink(2), fontSize: 10.5 }}>{msg}</div>}
      </div>

      {/* 视图切换 + 搜索 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Segmented
          options={[
            { key: 'plan', label: '今日计划', icon: Ico.flag },
            { key: 'active', label: `待办 ${active.length}`, icon: Ico.todos },
            { key: 'board', label: '看板', icon: Ico.grid },
            { key: 'done', label: '已完成', icon: Ico.done }
          ]}
          value={view}
          onChange={setView}
          style={{ flex: 'none' }}
        />
        <div style={{ ...surface.inset(), flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRadius: R.pill }}>
          <Ico.search size={12} strokeWidth={2} style={{ color: ink(3), flex: 'none' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索…" style={{ ...inputBase, flex: 1, fontSize: FS.small, padding: '5.5px 0' }} />
          {query && <span className="hv" onClick={() => setQuery('')} style={{ cursor: 'pointer', color: ink(3), display: 'flex' }}><Ico.close size={11} strokeWidth={2} /></span>}
        </div>
        {view === 'done' && filtered.length > 0 && (
          <Chip onClick={p.onClearDone} style={{ flex: 'none' }}>清空</Chip>
        )}
      </div>

      {(view === 'active' || view === 'plan') && (projects.length > 0 || projectStats.some((x) => x.project === '未归属')) && (
        <div className="noscrollbar" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
          <Chip active={projectFilter === null} onClick={() => setProjectFilter(null)}>全部项目</Chip>
          {projectStats.map((x) => (
            <Chip key={x.project} active={projectFilter === x.project} onClick={() => setProjectFilter(projectFilter === x.project ? null : x.project)}>{x.project} · {x.total - x.done}</Chip>
          ))}
        </div>
      )}

      {view === 'active' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {([
            ['all', '全部'], ['today', '今天'], ['week', '本周'], ['noDue', '未排期'], ['high', '高优先'], ['tagged', '有标签']
          ] as const).map(([key, label]) => <Chip key={key} active={quickFilter === key} onClick={() => setQuickFilter(key)}>{label}</Chip>)}
          <span style={{ flex: 1 }} />
          {overdue > 0 && <Chip icon={Ico.alarm} color={sem.warn} onClick={deferOverdue} title="顺延全部逾期任务到明早 9 点">顺延逾期 {overdue}</Chip>}
          <Chip active={selecting} onClick={() => selecting ? exitSelect() : setSelecting(true)}>{selecting ? '退出批量' : '批量'}</Chip>
        </div>
      )}

      {view === 'active' && selecting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: R.md, background: semBg(accent(), 0.1), border: `0.5px solid ${accent(0.62, 0.3)}` }}>
          <span style={{ color: accent(0.88), fontSize: 10.5, fontWeight: 700 }}>已选 {selected.size}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkDone} style={bulkBtn}>完成</button>
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkTomorrow} style={bulkBtn}>明天</button>
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkArchive} style={bulkBtn}>归档</button>
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkDelete} style={{ ...bulkBtn, color: sem.danger }}>删除</button>
        </div>
      )}

      {/* 今日执行驾驶舱：容量、优先队列、项目负载、阻塞项 */}
      {view === 'plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ padding: '10px 12px', ...surface.card() }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ ...txt.subtitle(), fontSize: FS.body }}>今日容量</span>
                  <span style={{ color: executionPlan.plannedMinutes > capacityMinutes ? sem.warn : ink(2), fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{executionPlan.plannedMinutes} / {capacityMinutes} 分钟</span>
                </div>
                <div style={{ marginTop: 7, height: 5, borderRadius: R.pill, background: fill(3), overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, executionPlan.plannedMinutes / capacityMinutes * 100)}%`, height: '100%', borderRadius: R.pill, background: executionPlan.plannedMinutes > capacityMinutes ? sem.warn : `linear-gradient(90deg, ${sem.calm}, ${accent()})`, transition: 'width .3s ease' }} />
                </div>
              </div>
              <Segmented
                options={([240, 360, 480] as const).map((m) => ({ key: String(m) as '240' | '360' | '480', label: `${m / 60}h` }))}
                value={String(capacityMinutes) as '240' | '360' | '480'}
                onChange={(k) => setCapacityMinutes(Number(k))}
                style={{ flex: 'none' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={txt.overline()}>执行队列 · {executionPlan.planned.length}</span>
            <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
            {executionPlan.overflow.length > 0 && <span style={txt.faint()}>容量外 {executionPlan.overflow.length}</span>}
          </div>
          {executionPlan.planned.map((t, i) => {
            const pr = PRIO[(t.priority || 3) as 1 | 2 | 3]
            const isDoing = (t.status || 'todo') === 'doing'
            return (
              <div key={t.id} className="ai-card" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '9px 10px', borderRadius: R.md, background: isDoing ? semBg(sem.warn, 0.13) : fill(1), border: `0.5px solid ${isDoing ? semBg(sem.warn, 0.45) : hairline(0.06)}`, borderLeft: `3px solid ${pr.ring}` }}>
                <span style={{ ...txt.num(11), color: isDoing ? sem.warn : ink(3) }}>{String(i + 1).padStart(2, '0')}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: ink(1), fontSize: FS.small, fontWeight: 650, lineHeight: 1.4 }}>{t.text}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', ...txt.faint(), fontSize: 9 }}>
                    <span>{t.estimate || 30}m</span>
                    <span>{t.energy === 'deep' ? '深度工作' : t.energy === 'light' ? '轻量任务' : '常规任务'}</span>
                    {t.project && <span>{t.project}</span>}
                    {t.due && <span>{dueLabel(t.due, now).text}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {!isDoing && <IconButton icon={Ico.play} size={27} color={sem.warn} onClick={() => p.onSetStatus(t.id, 'doing')} title="开始执行" />}
                  <IconButton icon={Ico.focus} size={27} color={sem.focus} onClick={() => p.onFocus(t)} title="专注 25 分钟" />
                  <IconButton icon={Check} size={27} color={sem.calm} onClick={() => p.onToggle(t.id)} title="完成" />
                </div>
              </div>
            )
          })}
          {executionPlan.planned.length === 0 && <div style={{ padding: 18, textAlign: 'center', ...txt.faint(), fontSize: 10.5 }}>没有可执行任务；新增任务或解除阻塞后会自动进入队列。</div>}

          {projectStats.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              {projectStats.slice(0, 6).map((x) => (
                <div key={x.project} className="hv" onClick={() => setProjectFilter(projectFilter === x.project ? null : x.project)} style={{ padding: '9px 10px', borderRadius: R.md, cursor: 'pointer', background: projectFilter === x.project ? semBg(accent(), 0.14) : fill(1), border: `0.5px solid ${projectFilter === x.project ? accent(0.6, 0.35) : hairline(0.06)}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ink(1), fontSize: 10.5, fontWeight: 700 }}>{x.project}</span>
                    <span style={{ ...txt.faint(), fontSize: 9 }}>{x.pct}%</span>
                  </div>
                  <div style={{ marginTop: 6, height: 3, borderRadius: R.pill, background: fill(3), overflow: 'hidden' }}><div style={{ width: `${x.pct}%`, height: '100%', background: sem.calm }} /></div>
                  <div style={{ marginTop: 5, display: 'flex', gap: 7, ...txt.faint(), fontSize: 8.5 }}><span>进行 {x.doing}</span><span>剩余 {x.remainingMinutes}m</span>{x.blocked > 0 && <span style={{ color: sem.warn }}>阻塞 {x.blocked}</span>}</div>
                </div>
              ))}
            </div>
          )}

          {executionPlan.blocked.length > 0 && (
            <div style={{ padding: '9px 10px', borderRadius: R.md, background: semBg(sem.danger, 0.08), border: `0.5px solid ${semBg(sem.danger, 0.3)}` }}>
              <div style={{ color: sem.danger, fontSize: 9.5, fontWeight: 750, marginBottom: 6 }}>阻塞项 · {executionPlan.blocked.length}</div>
              {executionPlan.blocked.slice(0, 5).map((t) => <div key={t.id} style={{ display: 'flex', gap: 7, padding: '3px 0', fontSize: 9.5 }}><span style={{ color: ink(1) }}>{t.text}</span><span style={{ flex: 1, color: ink(3), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.blockedBy}</span><button type="button" className="hv" onClick={() => p.onPatch(t.id, { blockedBy: undefined })} style={{ border: 0, background: 'transparent', color: sem.calm, cursor: 'pointer', fontSize: 9 }}>解除</button></div>)}
            </div>
          )}
        </div>
      )}

      {/* 统计概览：完成率环 + 今日完成 + 逾期 + 进度分布 */}
      {view !== 'plan' && (() => {
        const t0 = dayStart(new Date(now))
        const openN = p.todos.filter((t) => !t.done).length
        const doneN = p.todos.filter((t) => t.done).length
        const totalN = openN + doneN
        const rate = totalN ? Math.round((doneN / totalN) * 100) : 0
        const todayDone = p.todos.filter((t) => t.done && t.doneAt && t.doneAt >= t0).length
        const overdue = p.todos.filter((t) => !t.done && t.due && t.due <= now).length
        const doing = p.todos.filter((t) => (t.status || (t.done ? 'done' : 'todo')) === 'doing').length
        if (totalN === 0) return null
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `9px ${SP.md + 1}px`, ...surface.card() }}>
            {/* 完成率环 */}
            <div style={{ position: 'relative', width: 42, height: 42, flex: 'none' }}>
              <svg viewBox="0 0 42 42" style={{ width: 42, height: 42, transform: 'rotate(-90deg)' }}>
                <circle cx="21" cy="21" r="17" fill="none" style={{ stroke: fill(3) }} strokeWidth="4" />
                <circle cx="21" cy="21" r="17" fill="none" style={{ stroke: accent(0.78), strokeDasharray: `${(rate / 100) * 107} 107`, transition: 'stroke-dasharray .4s' }} strokeWidth="4" strokeLinecap="round" />
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...txt.num(11) }}>{rate}%</span>
            </div>
            {[
              { n: openN, l: '未完成', c: ink(1) },
              { n: doing, l: '进行中', c: sem.run },
              { n: todayDone, l: '今日完成', c: sem.calm },
              { n: overdue, l: '已逾期', c: overdue ? sem.danger : ink(4) }
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: s.c, fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{s.n}</span>
                <span style={{ ...txt.faint(), fontSize: 9 }}>{s.l}</span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* 看板：三栏拖拽（精致玻璃卡片） */}
      {view === 'board' && (() => {
        const colOf = (t: TodoItem): 'todo' | 'doing' | 'done' => t.status || (t.done ? 'done' : 'todo')
        const COLS: [('todo' | 'doing' | 'done'), string, string, typeof Ico.inbox][] = [
          ['todo', '待办', sem.run, Ico.inbox], ['doing', '进行中', sem.warn, Ico.shortcuts], ['done', '已完成', sem.calm, Ico.done]
        ]
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            {COLS.map(([key, label, col, ColIcon]) => {
              const items = p.todos.filter((t) => colOf(t) === key).sort((a, b) => (a.priority || 3) - (b.priority || 3))
              const active = dropCol === key
              return (
                <div
                  key={key}
                  onDragOver={(e) => { e.preventDefault(); if (dropCol !== key) setDropCol(key) }}
                  onDragLeave={() => setDropCol((c) => (c === key ? null : c))}
                  onDrop={() => { if (dragId != null) p.onSetStatus(dragId, key); setDragId(null); setDropCol(null) }}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7, padding: 8, borderRadius: R.lg, minHeight: 180,
                    background: `linear-gradient(180deg, ${semBg(col, active ? 0.2 : 0.09)}, ${semBg(col, 0.03)})`,
                    border: active ? `1.5px dashed ${semBg(col, 0.7)}` : `0.5px solid ${semBg(col, 0.2)}`,
                    boxShadow: active ? `inset 0 0 24px ${semBg(col, 0.16)}` : 'none', transition: 'all .18s'
                  }}
                >
                  {/* 栏头：图标 · 标题 · WIP 徽章 · 快速添加 · 折叠 */}
                  {(() => { const wip = key === 'doing' && items.length > 5; const ccol = colCollapse[key]; return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
                    <span style={{ width: 20, height: 20, flex: 'none', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: semBg(col, 0.2), color: col }}><ColIcon size={11} strokeWidth={2} /></span>
                    <span style={{ flex: 1, color: col, fontSize: FS.small, fontWeight: 800 }}>{label}</span>
                    {wip && <span title="进行中过多,注意 WIP" style={{ color: sem.warn, fontSize: 9, display: 'inline-flex', alignItems: 'center', gap: 2 }}><Ico.approval size={9} strokeWidth={2} />WIP</span>}
                    <span style={{ flex: 'none', minWidth: 18, textAlign: 'center', padding: '1px 7px', borderRadius: R.pill, background: wip ? semBg(sem.warn, 0.3) : semBg(col, 0.2), color: wip ? sem.warn : col, fontSize: 9.5, fontWeight: 700 }}>{items.length}</span>
                    <span className="hv" onClick={() => { setAddingCol(addingCol === key ? null : key); setAddText('') }} title="添加到此栏" style={{ cursor: 'pointer', color: col, display: 'flex' }}><Ico.add size={13} strokeWidth={2.25} /></span>
                    <span className="hv" onClick={() => setColCollapse((c) => ({ ...c, [key]: !c[key] }))} style={{ cursor: 'pointer', color: ink(3), display: 'flex', transform: ccol ? 'rotate(-90deg)' : 'none', transition: 'transform .18s' }}><Ico.expand size={10} strokeWidth={2} /></span>
                  </div>
                  ) })()}
                  {/* 列内快速添加输入 */}
                  {addingCol === key && (
                    <input
                      autoFocus value={addText} onChange={(e) => setAddText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && addText.trim()) { p.onQuickAdd(addText.trim(), key); setAddText('') } else if (e.key === 'Escape') setAddingCol(null) }}
                      onBlur={() => { if (!addText.trim()) setAddingCol(null) }}
                      placeholder="回车添加 · Esc 取消"
                      style={{ background: surface.inset().background, border: `0.5px solid ${semBg(col, 0.45)}`, borderRadius: R.sm, outline: 'none', color: ink(1), fontSize: 10.5, padding: '6px 9px' }}
                    />
                  )}
                  {/* 卡片 */}
                  {!colCollapse[key] && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    {items.map((t) => {
                      const pr = PRIO[(t.priority || 3) as 1 | 2 | 3]
                      const subs = t.subs || []
                      const sd = subs.filter((s) => s.done).length
                      const dl = t.due ? dueLabel(t.due, now) : null
                      const subPct = subs.length ? (sd / subs.length) * 100 : 0
                      return (
                        <div
                          key={t.id}
                          className="ai-card"
                          draggable
                          onDragStart={() => setDragId(t.id)}
                          onDragEnd={() => { setDragId(null); setDropCol(null) }}
                          style={{
                            padding: '8px 9px', borderRadius: R.md, cursor: 'grab', opacity: dragId === t.id ? 0.4 : 1, transform: dragId === t.id ? 'scale(.97)' : 'none',
                            background: dl?.hot && key !== 'done' ? semBg(sem.danger, 0.13) : fill(2), border: `0.5px solid ${hairline(0.06)}`, borderLeft: `3px solid ${pr.ring}`,
                            boxShadow: '0 2px 8px -3px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column', gap: 5, transition: 'transform .12s, opacity .12s'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                            {t.pinned && <Ico.pin size={9} strokeWidth={2} style={{ flex: 'none', color: accent(), marginTop: 2 }} />}
                            <span style={{ flex: 1, color: ink(1), fontSize: FS.small, lineHeight: 1.45, textDecoration: key === 'done' ? 'line-through' : undefined, opacity: key === 'done' ? 0.55 : 1, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{t.text}</span>
                            {/* 悬停快速推进 */}
                            <div className="row-acts" style={{ flex: 'none', display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span className="hv" title="优先级" onClick={() => p.onCyclePriority(t.id)} style={{ cursor: 'pointer', color: pr.color, display: 'flex' }}><Ico.flag size={10} strokeWidth={2} /></span>
                              {key !== 'done' && <span className="hv" title="标记完成" onClick={() => p.onSetStatus(t.id, 'done')} style={{ cursor: 'pointer', color: sem.calm, display: 'flex' }}><Check size={11} strokeWidth={2.5} /></span>}
                              {key !== 'todo' && <span className="hv" title="退回待办" onClick={() => p.onSetStatus(t.id, 'todo')} style={{ cursor: 'pointer', color: ink(3), display: 'flex' }}><Undo2 size={10} strokeWidth={2} /></span>}
                            </div>
                          </div>
                          {subs.length > 0 && (
                            <div style={{ height: 4, borderRadius: R.pill, background: fill(3), overflow: 'hidden' }}>
                              <div style={{ width: `${subPct}%`, height: '100%', borderRadius: R.pill, background: col }} />
                            </div>
                          )}
                          {(dl || (t.priority || 3) < 3 || subs.length > 0) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              {(t.priority || 3) < 3 && <span style={{ padding: '1px 6px', borderRadius: R.pill, fontSize: 8, fontWeight: 700, background: fill(2), color: pr.color }}>{pr.label}</span>}
                              {dl && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: R.pill, fontSize: 8, fontWeight: 600, background: dl.hot ? semBg(sem.warn, 0.2) : fill(2), color: dl.hot ? sem.warn : ink(2) }}><Ico.alarm size={8} strokeWidth={2} />{dl.text}</span>}
                              {subs.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, ...txt.faint(), fontSize: 8 }}><Ico.todos size={8} strokeWidth={2} />{sd}/{subs.length}</span>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {items.length === 0 && (
                      <div className="hv" onClick={() => { setAddingCol(key); setAddText('') }} style={{ flex: 1, minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: R.md, border: `1px dashed ${semBg(col, 0.25)}`, color: semBg(col, 0.55), fontSize: 9.5, cursor: 'pointer' }}><Ico.add size={10} strokeWidth={2} />拖到这里或点击添加</div>
                    )}
                  </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* 空态 */}
      {view !== 'board' && view !== 'plan' && groups.length === 0 && (
        <EmptyState
          icon={query ? Ico.search : view === 'done' ? Ico.notes : Ico.star}
          title={query ? '没有匹配的任务' : view === 'done' ? '还没有完成的任务' : '全部清空了，享受当下'}
        />
      )}

      {/* ④ 分组任务时间线 */}
      {view !== 'board' && view !== 'plan' && groups.map((g) => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="hv" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '0 3px' }}>
            <span style={{ ...txt.overline(), color: g.key === 'over' ? sem.warn : ink(3) }}>
              {g.label} <span style={{ opacity: 0.65 }}>{g.items.length}</span>
            </span>
            {g.key === 'over' && <span style={{ width: 5, height: 5, borderRadius: R.pill, background: sem.warn, animation: 'ai-dotpulse 1.6s ease-in-out infinite' }} />}
            <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
            <span style={{ color: ink(3), display: 'flex', transform: collapsed[g.key] ? 'rotate(-90deg)' : 'none', transition: 'transform .18s' }}><Ico.expand size={10} strokeWidth={2} /></span>
          </div>
          {!collapsed[g.key] && (
          <Group>
          {g.items.map((t) => {
            const pr = PRIO[(t.priority || 3) as 1 | 2 | 3]
            const isOpen = openId === t.id
            const subs = t.subs || []
            const subsDone = subs.filter((s) => s.done).length
            const dl = t.due ? dueLabel(t.due, now) : null
            return (
              <div key={t.id} className={isOpen ? undefined : 'ai-card'} style={{ background: isOpen ? semBg(accent(), 0.1) : 'transparent', transition: 'background .2s', animation: 'ai-fadein .22s ease' }}>
                {/* 主行 */}
                <div className="msg" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8.5px 11px' }}>
                  {selecting && !t.done && (
                    <button type="button" className="hv" onClick={() => toggleSelect(t.id)} title="选择任务" style={{ flex: 'none', width: 18, height: 18, marginTop: 1, borderRadius: 5, border: `1.5px solid ${selected.has(t.id) ? accent(0.72) : hairline(0.28)}`, background: selected.has(t.id) ? accent(0.72) : 'transparent', color: gradient.onPrimary(), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{selected.has(t.id) && <Check size={11} strokeWidth={3} />}</button>
                  )}
                  {/* 优先级色环勾选框 */}
                  <div
                    className="hv"
                    onClick={() => p.onToggle(t.id)}
                    title={t.done ? '标记未完成' : '完成'}
                    style={{ flex: 'none', width: 19, height: 19, borderRadius: R.pill, marginTop: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${t.done ? accent(0.7) : pr.ring}`, background: t.done ? accent(0.7) : 'transparent', transition: 'all .18s', animation: t.done ? 'ai-pop .3s ease' : undefined }}
                  >
                    {t.done && <Check size={11} strokeWidth={3} style={{ color: gradient.onPrimary() }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {edit?.id === t.id ? (
                      /* 行内编辑：改文字 + 改时间，Enter/✓ 保存，Esc 取消 */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, animation: 'ai-fadein .15s ease' }}>
                        <input
                          autoFocus
                          value={edit.text}
                          onChange={(e) => setEdit((s) => s && { ...s, text: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEdit(null) }}
                          style={{ ...inputBase, fontSize: FS.body, background: surface.inset().background, border: `0.5px solid ${accent(0.7, 0.5)}`, borderRadius: R.sm, padding: '5px 8px' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="datetime-local" value={edit.due} onChange={(e) => setEdit((s) => s && { ...s, due: e.target.value })} style={{ background: fill(2), border: `0.5px solid ${hairline(0.1)}`, borderRadius: R.sm, color: ink(1), colorScheme: 'dark', fontSize: 10, padding: '3.5px 7px', outline: 'none', fontFamily: 'ui-monospace,monospace' }} />
                          {edit.due && <span className="hv" onClick={() => setEdit((s) => s && { ...s, due: '' })} title="清除时间" style={{ cursor: 'pointer', color: ink(3), fontSize: 10 }}>清除时间</span>}
                          <span style={{ flex: 1 }} />
                          <span className="hv" onClick={saveEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3.5px 12px', borderRadius: R.pill, cursor: 'pointer', background: gradient.primary(), color: gradient.onPrimary(), fontSize: 10.5, fontWeight: 700 }}><Check size={11} strokeWidth={2.5} />保存</span>
                          <span className="hv" onClick={() => setEdit(null)} style={{ padding: '3.5px 10px', borderRadius: R.pill, cursor: 'pointer', background: fill(3), color: ink(2), fontSize: 10.5 }}>取消</span>
                        </div>
                      </div>
                    ) : (
                    <span
                      onDoubleClick={() => !t.done && startEdit(t)}
                      title="双击编辑"
                      style={{ color: t.done ? ink(3) : ink(1), fontSize: FS.body, lineHeight: 1.45, textDecoration: t.done ? 'line-through' : 'none', transition: 'color .3s', wordBreak: 'break-word', cursor: t.done ? undefined : 'text' }}
                    >
                      {t.pinned && <Ico.pin size={10} strokeWidth={2} style={{ color: accent(), marginRight: 4, verticalAlign: -1 }} />}{t.text}
                    </span>
                    )}
                    {/* 元信息 chips */}
                    {(dl || t.repeat !== 'none' && t.repeat || subs.length > 0 || t.note || t.project || t.energy || t.estimate || t.blockedBy || (t.tags || []).length > 0) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                        {t.project && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: R.pill, fontSize: 9, background: semBg(sem.run, 0.14), color: sem.run }}><Ico.repos size={8.5} strokeWidth={2} />{t.project}</span>}
                        {t.blockedBy && <span title={t.blockedBy} style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: R.pill, fontSize: 9, background: semBg(sem.danger, 0.13), color: sem.danger }}><Ico.approval size={8.5} strokeWidth={2} style={{ flex: 'none' }} />{t.blockedBy}</span>}
                        {dl && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: R.pill, fontSize: 9, fontWeight: 700, background: dl.hot ? semBg(sem.warn, 0.2) : fill(2), color: dl.hot ? sem.warn : ink(2) }}><Ico.alarm size={8.5} strokeWidth={2} />{dl.text}</span>}
                        {t.repeat && t.repeat !== 'none' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: R.pill, fontSize: 9, background: fill(2), color: ink(2) }}><Ico.refresh size={8.5} strokeWidth={2} />{t.repeat === 'daily' ? '每天' : '每周'}</span>}
                        {subs.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: R.pill, fontSize: 9, background: fill(2), color: subsDone === subs.length ? accent() : ink(2) }}><Ico.todos size={8.5} strokeWidth={2} />{subsDone}/{subs.length}</span>}
                        {t.note && <Ico.notes size={10} strokeWidth={2} style={{ color: ink(3) }} />}
                        {t.estimate && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, color: sem.run }}><Ico.timer size={9} strokeWidth={2} />{t.estimate}m</span>}
                        {t.energy && <span style={{ fontSize: 9, color: ink(3) }}>{t.energy === 'deep' ? '深度' : t.energy === 'light' ? '轻量' : '常规'}</span>}
                        {(t.tags || []).map((tag) => <span key={tag} className="hv" onClick={() => setTagFilter(tag)} style={{ fontSize: 8.5, color: ink(3), cursor: 'pointer' }}>#{tag}</span>)}
                        {(t.priority || 3) < 3 && <span style={{ padding: '1px 7px', borderRadius: R.pill, fontSize: 9, fontWeight: 700, background: fill(2), color: pr.color }}>{pr.label}</span>}
                        {view === 'done' && t.doneAt && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, color: ink(4) }}><Check size={9} strokeWidth={2.5} />{fmtHM(t.doneAt)}</span>}
                      </div>
                    )}
                  </div>
                  {/* 悬停操作 */}
                  <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none', marginTop: 2 }}>
                    {!t.done && <span className="hv" title="编辑（文字/时间）" onClick={() => startEdit(t)} style={{ cursor: 'pointer', color: ink(2), display: 'flex' }}><Ico.edit size={12} strokeWidth={1.75} /></span>}
                    {!t.done && <span className="hv" title="优先级" onClick={() => p.onCyclePriority(t.id)} style={{ cursor: 'pointer', color: pr.color, display: 'flex' }}><Ico.flag size={12} strokeWidth={1.75} /></span>}
                    {!t.done && <span className="hv" title="顺延到明天" onClick={() => p.onTomorrow(t.id)} style={{ cursor: 'pointer', color: ink(2), display: 'flex' }}><SkipForward size={12} strokeWidth={1.75} /></span>}
                    {!t.done && <span className="hv" title="置顶" onClick={() => p.onPin(t.id)} style={{ cursor: 'pointer', color: t.pinned ? accent() : ink(3), display: 'flex' }}><Ico.pin size={12} strokeWidth={1.75} /></span>}
                    <span className="hv" title="删除" onClick={() => p.onDelete(t.id)} style={{ cursor: 'pointer', color: sem.danger, display: 'flex' }}><Ico.del size={12} strokeWidth={1.75} /></span>
                  </div>
                  <span className="hv" onClick={() => { setOpenId(isOpen ? null : t.id); setSubDraft('') }} title="详情（子任务/备注/专注）" style={{ flex: 'none', cursor: 'pointer', color: ink(3), display: 'flex', marginTop: 4, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><Ico.expand size={11} strokeWidth={2} /></span>
                </div>

                {/* 展开详情 */}
                {isOpen && (
                  <div style={{ padding: '2px 12px 11px 40px', display: 'flex', flexDirection: 'column', gap: 8, animation: 'ai-fadein .2s ease' }}>
                    {/* 子任务：进度条 + 列表 + 连续添加 + AI 拆解 */}
                    {subs.length > 0 && (
                      <div style={{ height: 3.5, borderRadius: R.pill, background: fill(3), overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${subs.length ? (subsDone / subs.length) * 100 : 0}%`, borderRadius: R.pill, background: `linear-gradient(90deg, ${accent(0.7)}, ${accent(0.82)})`, transition: 'width .35s ease' }} />
                      </div>
                    )}
                    {subs.map((s) => (
                      <div key={s.id} className="msg" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="hv" onClick={() => p.onToggleSub(t.id, s.id)} style={{ flex: 'none', width: 14, height: 14, borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${s.done ? accent(0.7) : hairline(0.3)}`, background: s.done ? accent(0.7) : 'transparent' }}>
                          {s.done && <Check size={9} strokeWidth={3} style={{ color: gradient.onPrimary() }} />}
                        </span>
                        <span style={{ flex: 1, color: s.done ? ink(3) : ink(1), fontSize: FS.small, textDecoration: s.done ? 'line-through' : 'none' }}>{s.text}</span>
                        <span className="row-acts hv" onClick={() => p.onDeleteSub(t.id, s.id)} style={{ cursor: 'pointer', color: ink(3), display: 'flex' }}><Ico.close size={10} strokeWidth={2} /></span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        ref={subInputRef}
                        value={subDraft}
                        onChange={(e) => setSubDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addSub(t.id) }}
                        placeholder="添加子任务，Enter 连续添加…"
                        style={{ ...inputBase, flex: 1, fontSize: FS.small, background: surface.inset().background, border: `0.5px solid ${hairline(0.09)}`, borderRadius: R.sm, padding: '5.5px 9px' }}
                      />
                      <span className="hv" onClick={() => breakdown(t.id)} title="AI 把这个任务拆解成子步骤" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '0 11px', borderRadius: R.sm, cursor: 'pointer', background: semBg(accent(), 0.18), border: `0.5px solid ${accent(0.7, 0.4)}`, color: accent(0.88), fontSize: 10.5, fontWeight: 700 }}>
                        <Ico.ai size={11} strokeWidth={2} />{breaking === t.id ? '拆解中…' : 'AI 拆解'}
                      </span>
                    </div>
                    {/* 执行属性：项目、精力、估时、阻塞、验收 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 6 }}>
                      <input
                        list="todo-project-list"
                        defaultValue={t.project || ''}
                        onBlur={(e) => p.onPatch(t.id, { project: e.target.value.trim() || undefined })}
                        placeholder="所属项目 / 工作流"
                        style={{ ...detailInput, minWidth: 0 }}
                      />
                      <Segmented
                        options={([['deep', '深'], ['normal', '常'], ['light', '轻']] as const).map(([k, label]) => ({ key: k, label }))}
                        value={t.energy || 'normal'}
                        onChange={(e) => p.onPatch(t.id, { energy: e })}
                      />
                      <input
                        defaultValue={t.blockedBy || ''}
                        onBlur={(e) => p.onPatch(t.id, { blockedBy: e.target.value.trim() || undefined })}
                        placeholder="阻塞原因 / 前置依赖（非空则移出执行队列）"
                        style={{ ...detailInput, minWidth: 0 }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <input type="number" min={5} max={600} step={5} value={t.estimate || ''} onChange={(e) => p.onPatch(t.id, { estimate: e.target.value ? Math.max(5, Number(e.target.value)) : undefined })} placeholder="估时" style={{ ...detailInput, minWidth: 0, width: 72 }} />
                        <span style={{ color: ink(3), fontSize: 9 }}>分钟</span>
                      </div>
                    </div>
                    <datalist id="todo-project-list">{projects.map((x) => <option key={x} value={x} />)}</datalist>
                    <textarea
                      defaultValue={t.acceptance || ''}
                      onBlur={(e) => p.onPatch(t.id, { acceptance: e.target.value.trim() || undefined })}
                      placeholder="验收标准：完成到什么程度才算真正结束？"
                      rows={2}
                      style={{ ...detailInput, width: '100%', resize: 'none', lineHeight: 1.45 }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <button type="button" className="hv" onClick={() => void aiEstimate(t)} style={microBtn}><Ico.timer size={10} strokeWidth={2} />{aiEstBusy === t.id ? '估时中…' : 'AI 估时'}</button>
                      <button type="button" className="hv" onClick={() => void aiSmart(t)} style={microBtn}><Ico.magic size={10} strokeWidth={2} />{aiSmartBusy === t.id ? '改写中…' : 'SMART 改写'}</button>
                      <button type="button" className="hv" onClick={() => void aiAutoTag(t)} style={microBtn}><Ico.tag size={10} strokeWidth={2} />{aiTagBusy === t.id ? '归类中…' : 'AI 归类'}</button>
                      {(t.tags || []).map((tag) => <button key={tag} type="button" className="hv" onClick={() => toggleTag(t, tag)} title="移除标签" style={{ ...microBtn, color: accent(0.76) }}>#{tag} ×</button>)}
                      {tagDraft?.id === t.id
                        ? <input autoFocus value={tagDraft.text} onChange={(e) => setTagDraft({ id: t.id, text: e.target.value })} onBlur={commitTagDraft} onKeyDown={(e) => { if (e.key === 'Enter') commitTagDraft(); if (e.key === 'Escape') setTagDraft(null) }} placeholder="标签" style={{ ...detailInput, width: 80, padding: '4px 7px' }} />
                        : <button type="button" className="hv" onClick={() => setTagDraft({ id: t.id, text: '' })} style={microBtn}>+ 标签</button>}
                    </div>
                    {/* 备注 */}
                    <textarea
                      defaultValue={t.note || ''}
                      onBlur={(e) => p.onSetNote(t.id, e.target.value)}
                      placeholder="备注（支持 Markdown，失焦保存）…"
                      rows={2}
                      className="ai-scroll"
                      style={{ ...inputBase, width: '100%', boxSizing: 'border-box', fontSize: FS.small, lineHeight: 1.5, background: surface.inset().background, border: `0.5px solid ${hairline(0.09)}`, borderRadius: R.sm, padding: '6px 9px', resize: 'none', maxHeight: 80 }}
                    />
                    {t.note && (
                      <div style={{ padding: '6px 9px', borderRadius: R.sm, background: fill(2), fontSize: FS.small }}>
                        <Markdown text={t.note} />
                      </div>
                    )}
                    {/* 操作 chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span className="hv" style={chipS(false)} onClick={() => p.onFocus(t)}><Ico.focus size={10} strokeWidth={2} style={{ color: sem.focus }} />专注 25 分钟</span>
                      <span className="hv" style={chipS(false)} onClick={() => p.onSnooze(t.id, 10)}>+10 分钟</span>
                      <span className="hv" style={chipS(false)} onClick={() => p.onSnooze(t.id, 60)}>+1 小时</span>
                      <span className="hv" style={chipS(false)} onClick={() => navigator.clipboard?.writeText(t.text + (subs.length ? '\n' + subs.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n') : '')).catch(() => {})}><Ico.copy size={10} strokeWidth={2} />复制</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </Group>
          )}
        </div>
      ))}
    </div>
  )
}
