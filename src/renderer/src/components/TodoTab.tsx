// 待办 v4 —— 全面重构（设计优先）：
// ① 顶部日历卡：日期问候 + SVG 进度环 + 统计胶囊
// ② 近期日程（7 天，今天/明天/周N 标签 + 一键入会）—— 修复"只显示今天"导致飞书会议不可见
// ③ 统一智能输入胶囊：一个输入框 · ✨AI/手动 双模 · 渐进展开时间/优先级/重复
// ④ 任务分组时间线：优先级色环勾选框 + 元信息 chips + 悬停操作 + 展开详情
//    （子任务：进度条 / 连续快速添加 / ✨AI 一键拆解 / 备注 Markdown / 专注）

import { useMemo, useRef, useState } from 'react'
import type { TodoItem, WorkbenchProject } from '../types'
import type { CalendarEvent } from '../../../shared/protocol'
import { Markdown } from './Markdown'
import { WEEK, PRIO, pad, fmtHM, dayStart, dueLabel, dailyDoneSeries, groupTodos, buildExecutionPlan, projectRollups } from '../logic/todo'
import { stripFence, parseJsonArray, normPrio, parseDue } from '../logic/todoAi'
import { ProjectContextBar } from './ProjectContextBar'

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
  color: 'oklch(0.95 0.01 var(--th))', fontSize: 12.5,
  fontFamily: 'inherit'
}
const chipS = (on: boolean): React.CSSProperties => ({
  padding: '3.5px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  background: on ? 'oklch(0.32 calc(0.06 * var(--cs, 1)) var(--th) / .55)' : 'rgba(255,255,255,.05)',
  border: `1px solid ${on ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.07)'}`,
  color: on ? 'oklch(0.92 calc(0.06 * var(--cs, 1)) var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)'
})
const bulkBtn: React.CSSProperties = { height: 26, padding: '0 9px', borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.05)', color: 'oklch(0.78 0.03 var(--th))', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 9.5, fontWeight: 650 }
const detailInput: React.CSSProperties = { boxSizing: 'border-box', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.24)', color: 'oklch(0.88 0.02 var(--th))', padding: '6px 8px', outline: 'none', fontFamily: 'var(--font)', fontSize: 10 }
const microBtn: React.CSSProperties = { height: 25, padding: '0 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.04)', color: 'oklch(0.7 0.03 var(--th) / .75)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 9, fontWeight: 650 }

/* ---------- 进度环 ---------- */
function ProgressRing({ pct }: { pct: number }): React.JSX.Element {
  const R = 20
  const C = 2 * Math.PI * R
  return (
    <svg width={52} height={52} style={{ flex: 'none' }}>
      <circle cx={26} cy={26} r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={4.5} />
      <circle
        cx={26} cy={26} r={R} fill="none"
        stroke="url(#ring-grad)" strokeWidth={4.5} strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
        transform="rotate(-90 26 26)" style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.22,.61,.36,1)' }}
      />
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          {/* SVG 属性不解析 CSS 变量 → 用 style 的 stopColor（CSS 属性可用 var） */}
          <stop offset="0%" style={{ stopColor: 'oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th))' }} />
          <stop offset="100%" style={{ stopColor: 'oklch(0.65 calc(0.15 * var(--cs, 1)) var(--th2))' }} />
        </linearGradient>
      </defs>
      <text x={26} y={30} textAnchor="middle" style={{ fill: 'oklch(0.94 0.01 var(--th))', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct}</text>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', borderRadius: 16, background: 'linear-gradient(135deg, oklch(0.3 calc(0.05 * var(--cs, 1)) var(--th) / .35), oklch(0.22 calc(0.03 * var(--cs, 1)) var(--th2) / .2))', border: '1px solid oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .25)' }}>
        <ProgressRing pct={pct} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 16, fontWeight: 800, letterSpacing: '.01em' }}>{today.getMonth() + 1} 月 {today.getDate()} 日</span>
            <span style={{ color: 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 11 }}>{WEEK[today.getDay()]}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {overdue > 0 && <span style={{ padding: '2px 9px', borderRadius: 999, background: 'oklch(0.4 0.1 75 / .4)', color: 'oklch(0.88 0.11 75)', fontSize: 10, fontWeight: 700 }}>⏰ 到时 {overdue}</span>}
            <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.82 0.02 var(--th) / .85)', fontSize: 10, fontWeight: 600 }}>今日 {todayCnt + overdue}</span>
            <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.8 calc(0.12 * var(--cs, 1)) var(--th))', fontSize: 10, fontWeight: 600 }}>✓ {doneToday}</span>
            {todayEstimate > 0 && <span title="今日任务预估工时合计" style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.8 0.1 250)', fontSize: 10, fontWeight: 600 }}>⏱ {todayEstimate >= 60 ? `${(todayEstimate / 60).toFixed(1)}h` : `${todayEstimate}m`}</span>}
            {totalSpent > 0 && <span title="累计专注投入" style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.13 300)', fontSize: 10, fontWeight: 600 }}>🌙 {totalSpent >= 60 ? `${(totalSpent / 60).toFixed(1)}h` : `${totalSpent}m`}</span>}
            <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.72 0.02 var(--th) / .65)', fontSize: 10 }}>全部 {active.length}</span>
          </div>
        </div>
        {/* 近 7 天完成趋势迷你柱状 */}
        {trend.some((n) => n > 0) && (() => {
          const max = Math.max(1, ...trend)
          return (
            <div title="近 7 天每日完成数" style={{ flex: 'none', display: 'flex', alignItems: 'flex-end', gap: 3, height: 34, paddingLeft: 4 }}>
              {trend.map((n, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ width: 5, height: `${Math.max(8, (n / max) * 100)}%`, borderRadius: 999, background: i === 6 ? 'oklch(0.8 calc(0.15 * var(--cs, 1)) var(--th))' : 'oklch(0.55 calc(0.08 * var(--cs, 1)) var(--th) / .5)' }} />
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* AI 执行指挥条：规划、排期、风险、汇报形成闭环 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 5 }}>
        {([
          ['plan', '目标拆解', '◎'], ['schedule', '智能排期', '⌁'], ['focus', '今日聚焦', '→'],
          ['risk', '风险诊断', '△'], ['standup', '生成站会', '≡'], ['week', '本周计划', '▦']
        ] as const).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            className="hv"
            onClick={() => openAi(key)}
            title={label}
            style={{ minWidth: 0, height: 36, padding: '0 6px', borderRadius: 8, border: `1px solid ${aiTool === key ? 'oklch(0.72 calc(0.13 * var(--cs, 1)) var(--th) / .55)' : 'rgba(255,255,255,.07)'}`, background: aiTool === key ? 'oklch(0.32 calc(0.06 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.035)', color: 'oklch(0.84 0.03 var(--th))', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontFamily: 'var(--font)' }}
          >
            <span style={{ color: 'oklch(0.82 calc(0.12 * var(--cs, 1)) var(--th))', fontSize: 12 }}>{icon}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9.5, fontWeight: 650 }}>{label}</span>
          </button>
        ))}
      </div>

      {aiTool && (
        <div style={{ padding: 12, borderRadius: 8, background: 'oklch(0.2 calc(0.025 * var(--css, 1)) var(--ths) / .92)', border: '1px solid oklch(0.65 calc(0.1 * var(--cs, 1)) var(--th) / .28)', animation: 'ai-fadein .18s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: aiTool === 'plan' || aiTool === 'clarify' || aiPanel || aiPlanItems ? 9 : 0 }}>
            <span style={{ color: 'oklch(0.9 0.03 var(--th))', fontSize: 11.5, fontWeight: 750 }}>
              {aiTool === 'plan' ? '目标拆解与执行建模' : aiTool === 'schedule' ? '智能排期' : aiTool === 'focus' ? '今日聚焦' : aiTool === 'risk' ? '执行风险诊断' : aiTool === 'standup' ? '站会报告' : aiTool === 'week' ? '本周计划' : 'AI 增强'}
            </span>
            {aiBusy && <span style={{ color: 'oklch(0.78 0.12 150)', fontSize: 9.5 }}>分析中…</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="hv" onClick={() => { setAiTool(null); setAiPanel(null); setAiPlanItems(null) }} title="关闭" style={{ width: 24, height: 24, border: 0, borderRadius: 7, background: 'rgba(255,255,255,.05)', color: 'oklch(0.66 0.02 var(--th) / .65)', cursor: 'pointer' }}>×</button>
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
                style={{ flex: 1, resize: 'none', minWidth: 0, borderRadius: 8, border: '1px solid rgba(255,255,255,.09)', background: 'rgba(0,0,0,.25)', color: 'oklch(0.92 0.02 var(--th))', padding: '8px 9px', outline: 'none', fontFamily: 'var(--font)', fontSize: 11, lineHeight: 1.5 }}
              />
              <button type="button" className="hv" disabled={!aiInput.trim() || aiBusy} onClick={() => void runAi(aiTool, aiInput.trim())} style={{ alignSelf: 'stretch', width: 74, borderRadius: 8, border: 0, background: aiInput.trim() ? 'oklch(0.72 calc(0.14 * var(--cs, 1)) var(--th))' : 'rgba(255,255,255,.06)', color: aiInput.trim() ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.55 0.02 var(--th))', cursor: aiInput.trim() ? 'pointer' : 'default', fontFamily: 'var(--font)', fontSize: 10.5, fontWeight: 750 }}>生成计划</button>
            </div>
          )}
          {aiPlanItems && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {aiPlanItems.map((item, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 8, alignItems: 'start', padding: '8px 9px', borderRadius: 8, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)' }}>
                  <span style={{ color: 'oklch(0.72 0.1 var(--th))', fontSize: 10, fontWeight: 800 }}>{String(i + 1).padStart(2, '0')}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'oklch(0.92 0.02 var(--th))', fontSize: 11.5, fontWeight: 650, lineHeight: 1.4 }}>{item.text}</div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {item.project && <span style={chipS(false)}>项目 · {item.project}</span>}
                      <span style={chipS(false)}>{item.estimate || 30}m</span>
                      <span style={chipS(false)}>{item.energy === 'deep' ? '深度' : item.energy === 'light' ? '轻量' : '常规'}</span>
                      {item.blockedBy && <span style={{ ...chipS(false), color: 'oklch(0.84 0.12 40)' }}>阻塞 · {item.blockedBy}</span>}
                    </div>
                    {item.acceptance && <div style={{ marginTop: 5, color: 'oklch(0.62 0.02 var(--th) / .7)', fontSize: 9.5, lineHeight: 1.45 }}>验收：{item.acceptance}</div>}
                  </div>
                  <span style={{ color: PRIO[(item.priority || 3) as 1 | 2 | 3].color, fontSize: 9.5, fontWeight: 700 }}>P{item.priority || 3}</span>
                </div>
              ))}
              <button type="button" className="hv" onClick={adoptPlan} style={{ alignSelf: 'flex-end', marginTop: 2, padding: '7px 14px', border: 0, borderRadius: 8, background: 'oklch(0.72 calc(0.14 * var(--cs, 1)) var(--th))', color: 'oklch(0.14 0.02 var(--th))', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 10.5, fontWeight: 750 }}>采纳 {aiPlanItems.length} 项</button>
            </div>
          )}
          {aiPanel && <div style={{ color: 'oklch(0.84 0.02 var(--th))', fontSize: 11, lineHeight: 1.55 }}><Markdown text={aiPanel.body} /></div>}
        </div>
      )}

      {/* ② 近期日程（7 天）：飞书日历 */}
      {upcoming.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 3px' }}>
            <span style={{ color: 'oklch(0.68 0.02 var(--th) / .65)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em' }}>📅 近期日程</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.05)' }} />
          </div>
          {upcoming.map((m) => {
            const ongoing = m.start <= now
            return (
              <div key={m.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', borderRadius: 12, background: ongoing ? 'oklch(0.32 0.06 75 / .25)' : 'rgba(255,255,255,.035)', border: `1px solid ${ongoing ? 'oklch(0.8 0.13 75 / .4)' : 'rgba(255,255,255,.05)'}` }}>
                <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 44 }}>
                  <span style={{ color: ongoing ? 'oklch(0.88 0.11 75)' : 'oklch(0.82 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 9.5, fontWeight: 700 }}>{meetDay(m.start)}</span>
                  <span style={{ color: 'oklch(0.88 0.01 var(--th) / .9)', fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.allDay ? '全天' : fmtHM(m.start)}</span>
                </div>
                <div style={{ width: 2.5, alignSelf: 'stretch', borderRadius: 999, background: ongoing ? 'oklch(0.8 0.13 75)' : 'oklch(0.6 calc(0.12 * var(--cs, 1)) var(--th) / .5)', flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'oklch(0.92 0.01 var(--th))', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
                  <div style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 9.5 }}>{ongoing ? '进行中' : `${Math.max(1, Math.round((m.start - now) / 60000)) < 120 ? Math.max(1, Math.round((m.start - now) / 60000)) + ' 分钟后' : meetDay(m.start)}`}{m.location ? ` · ${m.location}` : ''}</div>
                </div>
                {m.link && (
                  <span className="hv" onClick={() => p.onJoinMeeting(m.link!)} style={{ flex: 'none', padding: '5px 13px', borderRadius: 999, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>⏵ 入会</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ③ 统一智能输入胶囊 */}
      <div style={{ borderRadius: 15, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.09)', padding: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* AI / 手动 切换 */}
          <div className="hv" onClick={() => setAiMode((v) => !v)} title={aiMode ? 'AI 智能模式：口语描述自动整理（点击切手动）' : '手动模式（点击切 AI）'} style={{ flex: 'none', width: 30, height: 30, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, background: aiMode ? 'linear-gradient(135deg, oklch(0.8 calc(0.15 * var(--cs, 1)) var(--th)), oklch(0.6 calc(0.14 * var(--cs, 1)) var(--th2)))' : 'rgba(255,255,255,.07)', boxShadow: aiMode ? '0 2px 10px oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .4)' : 'none' }}>
            {aiMode ? '✨' : '✏️'}
          </div>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder={aiMode ? '口语描述，AI 自动拆条 + 定时间：明早9点站会每天提醒…' : '记一条待办，Enter 添加'}
            disabled={busy}
            style={{ ...inputBase, flex: 1, opacity: busy ? 0.6 : 1, padding: '4px 2px' }}
          />
          <div className="hv" onClick={submit} style={{ flex: 'none', padding: '6.5px 15px', borderRadius: 999, cursor: text.trim() && !busy ? 'pointer' : 'default', background: text.trim() && !busy ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: text.trim() && !busy ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11.5, fontWeight: 700 }}>
            {busy ? '…' : aiMode ? 'AI 添加' : '添加'}
          </div>
        </div>
        {/* 手动模式渐进展开：时间/优先级/重复 */}
        {!aiMode && text && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8, animation: 'ai-fadein .2s ease' }}>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: 'oklch(0.9 0.01 var(--th))', colorScheme: 'dark', fontSize: 10.5, padding: '4.5px 8px', outline: 'none', fontFamily: 'ui-monospace,monospace' }} />
            <span className="hv" style={chipS(false)} onClick={() => preset('1h')}>+1小时</span>
            <span className="hv" style={chipS(false)} onClick={() => preset('tonight')}>今晚8点</span>
            <span className="hv" style={chipS(false)} onClick={() => preset('tomorrow')}>明早9点</span>
            <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,.1)' }} />
            {([1, 2, 3] as const).map((pr) => (
              <span key={pr} className="hv" onClick={() => setPriority(pr)} style={{ ...chipS(priority === pr), color: priority === pr ? PRIO[pr].color : undefined }}>{PRIO[pr].label}</span>
            ))}
            <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,.1)' }} />
            {(['none', 'daily', 'weekly'] as const).map((r) => (
              <span key={r} className="hv" onClick={() => setRepeat(r)} style={chipS(repeat === r)}>{r === 'none' ? '不重复' : r === 'daily' ? '每天' : '每周'}</span>
            ))}
          </div>
        )}
        {msg && <div style={{ marginTop: 7, color: msg.startsWith('✓') ? 'oklch(0.8 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 10.5 }}>{msg}</div>}
      </div>

      {/* 视图切换 + 搜索 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 9, background: 'rgba(0,0,0,.25)' }}>
          {(['plan', 'active', 'board', 'done'] as const).map((v) => (
            <span key={v} className="hv" onClick={() => setView(v)} style={{ padding: '4px 12px', borderRadius: 7, fontSize: 11, fontWeight: view === v ? 700 : 500, cursor: 'pointer', background: view === v ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'transparent', color: view === v ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.78 0.02 var(--th) / .7)' }}>
              {v === 'plan' ? '今日计划' : v === 'active' ? `待办 ${active.length}` : v === 'done' ? '已完成' : '看板'}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRadius: 9, background: 'rgba(0,0,0,.22)', border: '1px solid rgba(255,255,255,.06)' }}>
          <span style={{ fontSize: 10, opacity: 0.45 }}>🔍</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索…" style={{ ...inputBase, flex: 1, fontSize: 11, padding: '5.5px 0' }} />
          {query && <span className="hv" onClick={() => setQuery('')} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 10 }}>✕</span>}
        </div>
        {view === 'done' && filtered.length > 0 && (
          <span className="hv" onClick={p.onClearDone} style={{ flex: 'none', padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.05)', color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>清空</span>
        )}
      </div>

      {(view === 'active' || view === 'plan') && (projects.length > 0 || projectStats.some((x) => x.project === '未归属')) && (
        <div className="noscrollbar" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
          <span className="hv" onClick={() => setProjectFilter(null)} style={chipS(projectFilter === null)}>全部项目</span>
          {projectStats.map((x) => (
            <span key={x.project} className="hv" onClick={() => setProjectFilter(projectFilter === x.project ? null : x.project)} style={chipS(projectFilter === x.project)}>{x.project} · {x.total - x.done}</span>
          ))}
        </div>
      )}

      {view === 'active' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {([
            ['all', '全部'], ['today', '今天'], ['week', '本周'], ['noDue', '未排期'], ['high', '高优先'], ['tagged', '有标签']
          ] as const).map(([key, label]) => <span key={key} className="hv" onClick={() => setQuickFilter(key)} style={chipS(quickFilter === key)}>{label}</span>)}
          <span style={{ flex: 1 }} />
          {overdue > 0 && <span className="hv" onClick={deferOverdue} title="顺延全部逾期任务到明早 9 点" style={{ ...chipS(false), color: 'oklch(0.82 0.12 40)' }}>顺延逾期 {overdue}</span>}
          <span className="hv" onClick={() => selecting ? exitSelect() : setSelecting(true)} style={chipS(selecting)}>{selecting ? '退出批量' : '批量'}</span>
        </div>
      )}

      {view === 'active' && selecting && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 8, background: 'oklch(0.28 0.04 var(--th) / .3)', border: '1px solid oklch(0.62 0.1 var(--th) / .25)' }}>
          <span style={{ color: 'oklch(0.82 0.04 var(--th))', fontSize: 10.5, fontWeight: 700 }}>已选 {selected.size}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkDone} style={bulkBtn}>完成</button>
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkTomorrow} style={bulkBtn}>明天</button>
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkArchive} style={bulkBtn}>归档</button>
          <button type="button" className="hv" disabled={!selected.size} onClick={bulkDelete} style={{ ...bulkBtn, color: 'oklch(0.8 0.12 30)' }}>删除</button>
        </div>
      )}

      {/* 今日执行驾驶舱：容量、优先队列、项目负载、阻塞项 */}
      {view === 'plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color: 'oklch(0.92 0.03 var(--th))', fontSize: 12, fontWeight: 750 }}>今日容量</span>
                  <span style={{ color: executionPlan.plannedMinutes > capacityMinutes ? 'oklch(0.82 0.13 40)' : 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{executionPlan.plannedMinutes} / {capacityMinutes} 分钟</span>
                </div>
                <div style={{ marginTop: 7, height: 5, borderRadius: 999, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, executionPlan.plannedMinutes / capacityMinutes * 100)}%`, height: '100%', borderRadius: 999, background: executionPlan.plannedMinutes > capacityMinutes ? 'oklch(0.75 0.14 40)' : 'linear-gradient(90deg, oklch(0.72 0.13 150), oklch(0.78 0.13 75))', transition: 'width .3s ease' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 8, background: 'rgba(0,0,0,.24)' }}>
                {[240, 360, 480].map((m) => <button key={m} type="button" className="hv" onClick={() => setCapacityMinutes(m)} style={{ width: 34, height: 25, border: 0, borderRadius: 6, background: capacityMinutes === m ? 'oklch(0.72 calc(0.13 * var(--cs, 1)) var(--th))' : 'transparent', color: capacityMinutes === m ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.68 0.02 var(--th) / .7)', cursor: 'pointer', fontSize: 9.5, fontWeight: 700 }}>{m / 60}h</button>)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ color: 'oklch(0.72 0.02 var(--th) / .72)', fontSize: 9.5, fontWeight: 750, letterSpacing: '.06em' }}>执行队列 · {executionPlan.planned.length}</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
            {executionPlan.overflow.length > 0 && <span style={{ color: 'oklch(0.64 0.02 var(--th) / .6)', fontSize: 9 }}>容量外 {executionPlan.overflow.length}</span>}
          </div>
          {executionPlan.planned.map((t, i) => {
            const pr = PRIO[(t.priority || 3) as 1 | 2 | 3]
            const isDoing = (t.status || 'todo') === 'doing'
            return (
              <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '9px 10px', borderRadius: 8, background: isDoing ? 'oklch(0.3 0.055 75 / .25)' : 'rgba(255,255,255,.035)', border: `1px solid ${isDoing ? 'oklch(0.72 0.12 75 / .35)' : 'rgba(255,255,255,.06)'}`, borderLeft: `3px solid ${pr.ring}` }}>
                <span style={{ color: isDoing ? 'oklch(0.86 0.12 75)' : 'oklch(0.58 0.03 var(--th) / .7)', fontSize: 11, fontWeight: 850, fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'oklch(0.92 0.02 var(--th))', fontSize: 11.5, fontWeight: 650, lineHeight: 1.4 }}>{t.text}</div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', color: 'oklch(0.62 0.02 var(--th) / .65)', fontSize: 9 }}>
                    <span>{t.estimate || 30}m</span>
                    <span>{t.energy === 'deep' ? '深度工作' : t.energy === 'light' ? '轻量任务' : '常规任务'}</span>
                    {t.project && <span>{t.project}</span>}
                    {t.due && <span>{dueLabel(t.due, now).text}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {!isDoing && <button type="button" className="hv" onClick={() => p.onSetStatus(t.id, 'doing')} title="开始执行" style={{ width: 27, height: 27, borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.05)', color: 'oklch(0.82 0.12 75)', cursor: 'pointer' }}>▶</button>}
                  <button type="button" className="hv" onClick={() => p.onFocus(t)} title="专注 25 分钟" style={{ width: 27, height: 27, borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.05)', color: 'oklch(0.78 0.1 260)', cursor: 'pointer' }}>◐</button>
                  <button type="button" className="hv" onClick={() => p.onToggle(t.id)} title="完成" style={{ width: 27, height: 27, borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.05)', color: 'oklch(0.8 0.12 150)', cursor: 'pointer' }}>✓</button>
                </div>
              </div>
            )
          })}
          {executionPlan.planned.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 10.5 }}>没有可执行任务；新增任务或解除阻塞后会自动进入队列。</div>}

          {projectStats.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              {projectStats.slice(0, 6).map((x) => (
                <div key={x.project} className="hv" onClick={() => setProjectFilter(projectFilter === x.project ? null : x.project)} style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', background: projectFilter === x.project ? 'oklch(0.3 0.05 var(--th) / .38)' : 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'oklch(0.88 0.02 var(--th))', fontSize: 10.5, fontWeight: 700 }}>{x.project}</span>
                    <span style={{ color: 'oklch(0.64 0.02 var(--th) / .65)', fontSize: 9 }}>{x.pct}%</span>
                  </div>
                  <div style={{ marginTop: 6, height: 3, borderRadius: 999, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}><div style={{ width: `${x.pct}%`, height: '100%', background: 'oklch(0.72 0.12 150)' }} /></div>
                  <div style={{ marginTop: 5, display: 'flex', gap: 7, color: 'oklch(0.58 0.02 var(--th) / .6)', fontSize: 8.5 }}><span>进行 {x.doing}</span><span>剩余 {x.remainingMinutes}m</span>{x.blocked > 0 && <span style={{ color: 'oklch(0.82 0.12 40)' }}>阻塞 {x.blocked}</span>}</div>
                </div>
              ))}
            </div>
          )}

          {executionPlan.blocked.length > 0 && (
            <div style={{ padding: '9px 10px', borderRadius: 8, background: 'oklch(0.28 0.055 35 / .18)', border: '1px solid oklch(0.65 0.1 35 / .25)' }}>
              <div style={{ color: 'oklch(0.82 0.12 40)', fontSize: 9.5, fontWeight: 750, marginBottom: 6 }}>阻塞项 · {executionPlan.blocked.length}</div>
              {executionPlan.blocked.slice(0, 5).map((t) => <div key={t.id} style={{ display: 'flex', gap: 7, padding: '3px 0', fontSize: 9.5 }}><span style={{ color: 'oklch(0.75 0.04 var(--th))' }}>{t.text}</span><span style={{ flex: 1, color: 'oklch(0.6 0.02 var(--th) / .6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.blockedBy}</span><button type="button" className="hv" onClick={() => p.onPatch(t.id, { blockedBy: undefined })} style={{ border: 0, background: 'transparent', color: 'oklch(0.72 0.08 150)', cursor: 'pointer', fontSize: 9 }}>解除</button></div>)}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderRadius: 13, background: 'linear-gradient(160deg, rgba(255,255,255,.045), rgba(255,255,255,.02))', border: '1px solid rgba(255,255,255,.06)' }}>
            {/* 完成率环 */}
            <div style={{ position: 'relative', width: 42, height: 42, flex: 'none' }}>
              <svg viewBox="0 0 42 42" style={{ width: 42, height: 42, transform: 'rotate(-90deg)' }}>
                <circle cx="21" cy="21" r="17" fill="none" style={{ stroke: 'rgba(255,255,255,.08)' }} strokeWidth="4" />
                <circle cx="21" cy="21" r="17" fill="none" style={{ stroke: 'oklch(0.78 calc(0.14 * var(--cs, 1)) var(--th))', strokeDasharray: `${(rate / 100) * 107} 107`, transition: 'stroke-dasharray .4s' }} strokeWidth="4" strokeLinecap="round" />
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'oklch(0.92 0.05 var(--th))', fontSize: 11, fontWeight: 800 }}>{rate}%</span>
            </div>
            {[
              { n: openN, l: '未完成', c: 'oklch(0.85 0.02 var(--th))' },
              { n: doing, l: '进行中', c: 'oklch(0.82 0.13 65)' },
              { n: todayDone, l: '今日完成', c: 'oklch(0.8 0.13 150)' },
              { n: overdue, l: '已逾期', c: overdue ? 'oklch(0.78 0.14 30)' : 'oklch(0.6 0.02 var(--th) / .5)' }
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: s.c, fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{s.n}</span>
                <span style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 9 }}>{s.l}</span>
              </div>
            ))}
          </div>
        )
      })()}

      {/* 看板：三栏拖拽（精致玻璃卡片） */}
      {view === 'board' && (() => {
        const colOf = (t: TodoItem): 'todo' | 'doing' | 'done' => t.status || (t.done ? 'done' : 'todo')
        const COLS: [('todo' | 'doing' | 'done'), string, string, string][] = [
          ['todo', '待办', '250', '📋'], ['doing', '进行中', '65', '⚡'], ['done', '已完成', '150', '✓']
        ]
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            {COLS.map(([key, label, hue, icon]) => {
              const items = p.todos.filter((t) => colOf(t) === key).sort((a, b) => (a.priority || 3) - (b.priority || 3))
              const active = dropCol === key
              return (
                <div
                  key={key}
                  onDragOver={(e) => { e.preventDefault(); if (dropCol !== key) setDropCol(key) }}
                  onDragLeave={() => setDropCol((c) => (c === key ? null : c))}
                  onDrop={() => { if (dragId != null) p.onSetStatus(dragId, key); setDragId(null); setDropCol(null) }}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7, padding: 8, borderRadius: 14, minHeight: 180,
                    background: `linear-gradient(180deg, oklch(0.3 0.05 ${hue} / ${active ? '.3' : '.14'}), oklch(0.19 0.03 ${hue} / .06))`,
                    border: active ? `1.5px dashed oklch(0.75 0.13 ${hue} / .7)` : `1px solid oklch(0.6 0.08 ${hue} / .18)`,
                    boxShadow: active ? `inset 0 0 24px oklch(0.6 0.14 ${hue} / .18)` : 'none', transition: 'all .18s'
                  }}
                >
                  {/* 栏头：图标 · 标题 · WIP 徽章 · 快速添加 · 折叠 */}
                  {(() => { const wip = key === 'doing' && items.length > 5; const col = colCollapse[key]; return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
                    <span style={{ width: 20, height: 20, flex: 'none', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, background: `oklch(0.4 0.1 ${hue} / .4)`, color: `oklch(0.88 0.13 ${hue})` }}>{icon}</span>
                    <span style={{ flex: 1, color: `oklch(0.9 0.06 ${hue})`, fontSize: 11.5, fontWeight: 800 }}>{label}</span>
                    {wip && <span title="进行中过多,注意 WIP" style={{ color: 'oklch(0.82 0.14 40)', fontSize: 9 }}>⚠ WIP</span>}
                    <span style={{ flex: 'none', minWidth: 18, textAlign: 'center', padding: '1px 7px', borderRadius: 999, background: wip ? 'oklch(0.5 0.12 40 / .5)' : `oklch(0.4 0.09 ${hue} / .4)`, color: wip ? 'oklch(0.88 0.14 40)' : `oklch(0.9 0.1 ${hue})`, fontSize: 9.5, fontWeight: 700 }}>{items.length}</span>
                    <span className="hv" onClick={() => { setAddingCol(addingCol === key ? null : key); setAddText('') }} title="添加到此栏" style={{ cursor: 'pointer', color: `oklch(0.8 0.1 ${hue})`, fontSize: 13, lineHeight: 1 }}>＋</span>
                    <span className="hv" onClick={() => setColCollapse((c) => ({ ...c, [key]: !c[key] }))} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9, transform: col ? 'rotate(-90deg)' : 'none' }}>▾</span>
                  </div>
                  ) })()}
                  {/* 列内快速添加输入 */}
                  {addingCol === key && (
                    <input
                      autoFocus value={addText} onChange={(e) => setAddText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && addText.trim()) { p.onQuickAdd(addText.trim(), key); setAddText('') } else if (e.key === 'Escape') setAddingCol(null) }}
                      onBlur={() => { if (!addText.trim()) setAddingCol(null) }}
                      placeholder="回车添加 · Esc 取消"
                      style={{ background: 'rgba(0,0,0,.3)', border: `1px solid oklch(0.6 0.1 ${hue} / .4)`, borderRadius: 8, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 10.5, padding: '6px 9px' }}
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
                            padding: '8px 9px', borderRadius: 10, cursor: 'grab', opacity: dragId === t.id ? 0.4 : 1, transform: dragId === t.id ? 'scale(.97)' : 'none',
                            background: dl?.hot && key !== 'done' ? 'oklch(0.3 0.06 35 / .4)' : 'oklch(0.26 0.02 var(--th) / .6)', border: '1px solid rgba(255,255,255,.07)', borderLeft: `3px solid ${pr.ring}`,
                            boxShadow: '0 2px 8px -3px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column', gap: 5, transition: 'transform .12s, opacity .12s'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                            {t.pinned && <span style={{ flex: 'none', fontSize: 9 }}>📌</span>}
                            <span style={{ flex: 1, color: 'oklch(0.92 0.02 var(--th) / .93)', fontSize: 11, lineHeight: 1.45, textDecoration: key === 'done' ? 'line-through' : undefined, opacity: key === 'done' ? 0.55 : 1, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{t.text}</span>
                            {/* 悬停快速推进 */}
                            <div className="row-acts" style={{ flex: 'none', display: 'flex', gap: 4 }}>
                              <span className="hv" title="优先级" onClick={() => p.onCyclePriority(t.id)} style={{ cursor: 'pointer', fontSize: 9, color: pr.color }}>●</span>
                              {key !== 'done' && <span className="hv" title="标记完成" onClick={() => p.onSetStatus(t.id, 'done')} style={{ cursor: 'pointer', fontSize: 10, color: 'oklch(0.8 0.12 145)' }}>✓</span>}
                              {key !== 'todo' && <span className="hv" title="退回待办" onClick={() => p.onSetStatus(t.id, 'todo')} style={{ cursor: 'pointer', fontSize: 10, color: 'oklch(0.6 0.02 var(--th) / .6)' }}>↩</span>}
                            </div>
                          </div>
                          {subs.length > 0 && (
                            <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                              <div style={{ width: `${subPct}%`, height: '100%', borderRadius: 999, background: `oklch(0.72 0.12 ${hue})` }} />
                            </div>
                          )}
                          {(dl || (t.priority || 3) < 3 || subs.length > 0) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              {(t.priority || 3) < 3 && <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: 8, fontWeight: 700, background: 'rgba(255,255,255,.06)', color: pr.color }}>{pr.label}</span>}
                              {dl && <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: 8, fontWeight: 600, background: dl.hot ? 'oklch(0.5 0.12 30 / .35)' : 'rgba(255,255,255,.05)', color: dl.hot ? 'oklch(0.85 0.13 40)' : 'oklch(0.66 0.02 var(--th) / .7)' }}>⏰ {dl.text}</span>}
                              {subs.length > 0 && <span style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 8 }}>☑ {sd}/{subs.length}</span>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {items.length === 0 && (
                      <div className="hv" onClick={() => { setAddingCol(key); setAddText('') }} style={{ flex: 1, minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, border: `1px dashed oklch(0.6 0.06 ${hue} / .2)`, color: `oklch(0.6 0.04 ${hue} / .45)`, fontSize: 9.5, cursor: 'pointer' }}>＋ 拖到这里或点击添加</div>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '26px 14px', borderRadius: 16, background: 'rgba(255,255,255,.025)', border: '1px dashed rgba(255,255,255,.08)' }}>
          <span style={{ fontSize: 22, opacity: 0.6 }}>{query ? '🔍' : view === 'done' ? '🌱' : '🎉'}</span>
          <span style={{ color: 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 11.5 }}>{query ? '没有匹配的任务' : view === 'done' ? '还没有完成的任务' : '全部清空了，享受当下'}</span>
        </div>
      )}

      {/* ④ 分组任务时间线 */}
      {view !== 'board' && view !== 'plan' && groups.map((g) => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="hv" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '0 3px' }}>
            <span style={{ color: g.key === 'over' ? 'oklch(0.86 0.11 75)' : 'oklch(0.68 0.02 var(--th) / .65)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em' }}>
              {g.label} <span style={{ opacity: 0.65 }}>{g.items.length}</span>
            </span>
            {g.key === 'over' && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'oklch(0.8 0.13 75)', animation: 'ai-dotpulse 1.6s ease-in-out infinite' }} />}
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.05)' }} />
            <span style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9, transform: collapsed[g.key] ? 'rotate(-90deg)' : 'none', transition: 'transform .18s' }}>▾</span>
          </div>
          {!collapsed[g.key] && g.items.map((t) => {
            const pr = PRIO[(t.priority || 3) as 1 | 2 | 3]
            const isOpen = openId === t.id
            const subs = t.subs || []
            const subsDone = subs.filter((s) => s.done).length
            const dl = t.due ? dueLabel(t.due, now) : null
            return (
              <div key={t.id} className={isOpen ? undefined : 'ai-card'} style={{ borderRadius: 13, background: isOpen ? 'oklch(0.26 calc(0.03 * var(--cs, 1)) var(--th) / .35)' : 'rgba(255,255,255,.035)', border: `1px solid ${isOpen ? 'oklch(0.65 calc(0.12 * var(--cs, 1)) var(--th) / .4)' : 'rgba(255,255,255,.05)'}`, transition: 'all .2s', animation: 'ai-fadein .22s ease', overflow: 'hidden' }}>
                {/* 主行 */}
                <div className="msg" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9.5px 11px' }}>
                  {selecting && !t.done && (
                    <button type="button" className="hv" onClick={() => toggleSelect(t.id)} title="选择任务" style={{ flex: 'none', width: 18, height: 18, marginTop: 1, borderRadius: 5, border: `1.5px solid ${selected.has(t.id) ? 'oklch(0.72 0.13 var(--th))' : 'rgba(255,255,255,.22)'}`, background: selected.has(t.id) ? 'oklch(0.72 0.13 var(--th))' : 'transparent', color: 'oklch(0.14 0.02 var(--th))', cursor: 'pointer', fontSize: 10, fontWeight: 900 }}>{selected.has(t.id) ? '✓' : ''}</button>
                  )}
                  {/* 优先级色环勾选框 */}
                  <div
                    className="hv"
                    onClick={() => p.onToggle(t.id)}
                    title={t.done ? '标记未完成' : '完成'}
                    style={{ flex: 'none', width: 19, height: 19, borderRadius: 999, marginTop: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${t.done ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th))' : pr.ring}`, background: t.done ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th))' : 'transparent', transition: 'all .18s', animation: t.done ? 'ai-pop .3s ease' : undefined }}
                  >
                    {t.done && <span style={{ color: 'oklch(0.14 0.02 var(--th))', fontSize: 11, fontWeight: 900 }}>✓</span>}
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
                          style={{ ...inputBase, fontSize: 12.5, background: 'rgba(0,0,0,.3)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .45)', borderRadius: 8, padding: '5px 8px' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="datetime-local" value={edit.due} onChange={(e) => setEdit((s) => s && { ...s, due: e.target.value })} style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, color: 'oklch(0.9 0.01 var(--th))', colorScheme: 'dark', fontSize: 10, padding: '3.5px 7px', outline: 'none', fontFamily: 'ui-monospace,monospace' }} />
                          {edit.due && <span className="hv" onClick={() => setEdit((s) => s && { ...s, due: '' })} title="清除时间" style={{ cursor: 'pointer', color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 10 }}>清除时间</span>}
                          <span style={{ flex: 1 }} />
                          <span className="hv" onClick={saveEdit} style={{ padding: '3.5px 12px', borderRadius: 999, cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 10.5, fontWeight: 700 }}>✓ 保存</span>
                          <span className="hv" onClick={() => setEdit(null)} style={{ padding: '3.5px 10px', borderRadius: 999, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 10.5 }}>取消</span>
                        </div>
                      </div>
                    ) : (
                    <span
                      onDoubleClick={() => !t.done && startEdit(t)}
                      title="双击编辑"
                      style={{ color: t.done ? 'oklch(0.62 0.02 var(--th) / .55)' : 'oklch(0.93 0.01 var(--th))', fontSize: 12.5, lineHeight: 1.45, textDecoration: t.done ? 'line-through' : 'none', transition: 'color .3s', wordBreak: 'break-word', cursor: t.done ? undefined : 'text' }}
                    >
                      {t.pinned && <span style={{ marginRight: 4 }}>📌</span>}{t.text}
                    </span>
                    )}
                    {/* 元信息 chips */}
                    {(dl || t.repeat !== 'none' && t.repeat || subs.length > 0 || t.note || t.project || t.energy || t.estimate || t.blockedBy || (t.tags || []).length > 0) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                        {t.project && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, background: 'oklch(0.32 0.06 205 / .3)', color: 'oklch(0.82 0.09 205)' }}>▦ {t.project}</span>}
                        {t.blockedBy && <span title={t.blockedBy} style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '1px 7px', borderRadius: 999, fontSize: 9, background: 'oklch(0.35 0.08 35 / .3)', color: 'oklch(0.84 0.12 40)' }}>△ {t.blockedBy}</span>}
                        {dl && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: dl.hot ? 'oklch(0.4 0.1 75 / .4)' : 'rgba(255,255,255,.06)', color: dl.hot ? 'oklch(0.88 0.11 75)' : 'oklch(0.72 0.02 var(--th) / .7)' }}>⏰ {dl.text}</span>}
                        {t.repeat && t.repeat !== 'none' && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, background: 'rgba(255,255,255,.06)', color: 'oklch(0.72 0.02 var(--th) / .7)' }}>🔁 {t.repeat === 'daily' ? '每天' : '每周'}</span>}
                        {subs.length > 0 && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, background: 'rgba(255,255,255,.06)', color: subsDone === subs.length ? 'oklch(0.8 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.72 0.02 var(--th) / .7)' }}>☑ {subsDone}/{subs.length}</span>}
                        {t.note && <span style={{ fontSize: 9, color: 'oklch(0.65 0.02 var(--th) / .6)' }}>📝</span>}
                        {t.estimate && <span style={{ fontSize: 9, color: 'oklch(0.7 0.06 250)' }}>⏱ {t.estimate}m</span>}
                        {t.energy && <span style={{ fontSize: 9, color: 'oklch(0.68 0.03 var(--th) / .7)' }}>{t.energy === 'deep' ? '深度' : t.energy === 'light' ? '轻量' : '常规'}</span>}
                        {(t.tags || []).map((tag) => <span key={tag} className="hv" onClick={() => setTagFilter(tag)} style={{ fontSize: 8.5, color: 'oklch(0.68 0.04 var(--th) / .7)', cursor: 'pointer' }}>#{tag}</span>)}
                        {(t.priority || 3) < 3 && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: 'rgba(255,255,255,.05)', color: pr.color }}>{pr.label}</span>}
                        {view === 'done' && t.doneAt && <span style={{ fontSize: 9, color: 'oklch(0.6 0.02 var(--th) / .5)' }}>✓ {fmtHM(t.doneAt)}</span>}
                      </div>
                    )}
                  </div>
                  {/* 悬停操作 */}
                  <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none', marginTop: 2 }}>
                    {!t.done && <span className="hv" title="编辑（文字/时间）" onClick={() => startEdit(t)} style={{ cursor: 'pointer', fontSize: 10, color: 'oklch(0.75 0.02 var(--th) / .75)' }}>✎</span>}
                    {!t.done && <span className="hv" title="优先级" onClick={() => p.onCyclePriority(t.id)} style={{ cursor: 'pointer', fontSize: 10, color: pr.color, fontWeight: 800 }}>⚑</span>}
                    {!t.done && <span className="hv" title="顺延到明天" onClick={() => p.onTomorrow(t.id)} style={{ cursor: 'pointer', fontSize: 10, color: 'oklch(0.72 0.02 var(--th) / .7)' }}>⏭</span>}
                    {!t.done && <span className="hv" title="置顶" onClick={() => p.onPin(t.id)} style={{ cursor: 'pointer', fontSize: 10, color: t.pinned ? 'oklch(0.85 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.65 0.02 var(--th) / .6)' }}>📌</span>}
                    <span className="hv" title="删除" onClick={() => p.onDelete(t.id)} style={{ cursor: 'pointer', fontSize: 10, color: 'oklch(0.62 0.06 25 / .8)' }}>✕</span>
                  </div>
                  <span className="hv" onClick={() => { setOpenId(isOpen ? null : t.id); setSubDraft('') }} title="详情（子任务/备注/专注）" style={{ flex: 'none', cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9, marginTop: 4, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
                </div>

                {/* 展开详情 */}
                {isOpen && (
                  <div style={{ padding: '2px 12px 11px 40px', display: 'flex', flexDirection: 'column', gap: 8, animation: 'ai-fadein .2s ease' }}>
                    {/* 子任务：进度条 + 列表 + 连续添加 + AI 拆解 */}
                    {subs.length > 0 && (
                      <div style={{ height: 3.5, borderRadius: 999, background: 'rgba(0,0,0,.3)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${subs.length ? (subsDone / subs.length) * 100 : 0}%`, borderRadius: 999, background: 'linear-gradient(90deg, oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)))', transition: 'width .35s ease' }} />
                      </div>
                    )}
                    {subs.map((s) => (
                      <div key={s.id} className="msg" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="hv" onClick={() => p.onToggleSub(t.id, s.id)} style={{ flex: 'none', width: 14, height: 14, borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${s.done ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th))' : 'rgba(255,255,255,.25)'}`, background: s.done ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th))' : 'transparent' }}>
                          {s.done && <span style={{ color: 'oklch(0.14 0.02 var(--th))', fontSize: 8.5, fontWeight: 900 }}>✓</span>}
                        </span>
                        <span style={{ flex: 1, color: s.done ? 'oklch(0.6 0.02 var(--th) / .5)' : 'oklch(0.85 0.01 var(--th) / .9)', fontSize: 11.5, textDecoration: s.done ? 'line-through' : 'none' }}>{s.text}</span>
                        <span className="row-acts hv" onClick={() => p.onDeleteSub(t.id, s.id)} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9.5 }}>✕</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        ref={subInputRef}
                        value={subDraft}
                        onChange={(e) => setSubDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addSub(t.id) }}
                        placeholder="添加子任务，Enter 连续添加…"
                        style={{ ...inputBase, flex: 1, fontSize: 11, background: 'rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '5.5px 9px' }}
                      />
                      <span className="hv" onClick={() => breakdown(t.id)} title="AI 把这个任务拆解成子步骤" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '0 11px', borderRadius: 8, cursor: 'pointer', background: 'oklch(0.32 calc(0.06 * var(--cs, 1)) var(--th) / .5)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', color: 'oklch(0.88 calc(0.08 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontWeight: 700 }}>
                        {breaking === t.id ? '拆解中…' : '✨ AI 拆解'}
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
                      <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 8, background: 'rgba(0,0,0,.22)' }}>
                        {(['deep', 'normal', 'light'] as const).map((e) => <button key={e} type="button" className="hv" onClick={() => p.onPatch(t.id, { energy: e })} title={e === 'deep' ? '深度工作' : e === 'light' ? '轻量任务' : '常规任务'} style={{ flex: 1, minWidth: 0, height: 24, border: 0, borderRadius: 6, background: (t.energy || 'normal') === e ? 'oklch(0.68 calc(0.11 * var(--cs, 1)) var(--th) / .65)' : 'transparent', color: (t.energy || 'normal') === e ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.62 0.02 var(--th) / .65)', cursor: 'pointer', fontSize: 8.5, fontWeight: 700 }}>{e === 'deep' ? '深' : e === 'light' ? '轻' : '常'}</button>)}
                      </div>
                      <input
                        defaultValue={t.blockedBy || ''}
                        onBlur={(e) => p.onPatch(t.id, { blockedBy: e.target.value.trim() || undefined })}
                        placeholder="阻塞原因 / 前置依赖（非空则移出执行队列）"
                        style={{ ...detailInput, minWidth: 0 }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <input type="number" min={5} max={600} step={5} value={t.estimate || ''} onChange={(e) => p.onPatch(t.id, { estimate: e.target.value ? Math.max(5, Number(e.target.value)) : undefined })} placeholder="估时" style={{ ...detailInput, minWidth: 0, width: 72 }} />
                        <span style={{ color: 'oklch(0.58 0.02 var(--th) / .6)', fontSize: 9 }}>分钟</span>
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
                      <button type="button" className="hv" onClick={() => void aiEstimate(t)} style={microBtn}>{aiEstBusy === t.id ? '估时中…' : 'AI 估时'}</button>
                      <button type="button" className="hv" onClick={() => void aiSmart(t)} style={microBtn}>{aiSmartBusy === t.id ? '改写中…' : 'SMART 改写'}</button>
                      <button type="button" className="hv" onClick={() => void aiAutoTag(t)} style={microBtn}>{aiTagBusy === t.id ? '归类中…' : 'AI 归类'}</button>
                      {(t.tags || []).map((tag) => <button key={tag} type="button" className="hv" onClick={() => toggleTag(t, tag)} title="移除标签" style={{ ...microBtn, color: 'oklch(0.76 0.08 var(--th))' }}>#{tag} ×</button>)}
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
                      style={{ ...inputBase, width: '100%', boxSizing: 'border-box', fontSize: 11, lineHeight: 1.5, background: 'rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '6px 9px', resize: 'none', maxHeight: 80 }}
                    />
                    {t.note && (
                      <div style={{ padding: '6px 9px', borderRadius: 8, background: 'rgba(0,0,0,.18)', fontSize: 11 }}>
                        <Markdown text={t.note} />
                      </div>
                    )}
                    {/* 操作 chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <span className="hv" style={chipS(false)} onClick={() => p.onFocus(t)}>🌙 专注 25 分钟</span>
                      <span className="hv" style={chipS(false)} onClick={() => p.onSnooze(t.id, 10)}>+10 分钟</span>
                      <span className="hv" style={chipS(false)} onClick={() => p.onSnooze(t.id, 60)}>+1 小时</span>
                      <span className="hv" style={chipS(false)} onClick={() => navigator.clipboard?.writeText(t.text + (subs.length ? '\n' + subs.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n') : '')).catch(() => {})}>⧉ 复制</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
