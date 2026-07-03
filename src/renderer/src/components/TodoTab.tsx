// 待办 v4 —— 全面重构（设计优先）：
// ① 顶部日历卡：日期问候 + SVG 进度环 + 统计胶囊
// ② 近期日程（7 天，今天/明天/周N 标签 + 一键入会）—— 修复"只显示今天"导致飞书会议不可见
// ③ 统一智能输入胶囊：一个输入框 · ✨AI/手动 双模 · 渐进展开时间/优先级/重复
// ④ 任务分组时间线：优先级色环勾选框 + 元信息 chips + 悬停操作 + 展开详情
//    （子任务：进度条 / 连续快速添加 / ✨AI 一键拆解 / 备注 Markdown / 专注）

import { useMemo, useRef, useState } from 'react'
import type { TodoItem } from '../types'
import type { CalendarEvent } from '../../../shared/protocol'
import { Markdown } from './Markdown'

interface TodoTabProps {
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
}

/* ---------- 工具 ---------- */
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad = (n: number): string => String(n).padStart(2, '0')
const fmtHM = (ts: number): string => `${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}`
const dayStart = (d = new Date()): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

const PRIO: Record<1 | 2 | 3, { label: string; color: string; ring: string }> = {
  1: { label: '紧急', color: 'oklch(0.72 0.17 25)', ring: 'oklch(0.72 0.17 25)' },
  2: { label: '重要', color: 'oklch(0.8 0.13 75)', ring: 'oklch(0.8 0.13 75)' },
  3: { label: '普通', color: 'oklch(0.7 0.02 var(--th) / .5)', ring: 'oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .6)' }
}

const dueLabel = (due: number, now: number): { text: string; hot: boolean } => {
  if (due <= now) return { text: '已到时', hot: true }
  const min = Math.round((due - now) / 60000)
  if (min < 60) return { text: `${min} 分钟后`, hot: min <= 15 }
  const d0 = dayStart()
  if (due < d0 + 86400000) return { text: `今天 ${fmtHM(due)}`, hot: false }
  if (due < d0 + 2 * 86400000) return { text: `明天 ${fmtHM(due)}`, hot: false }
  const dd = new Date(due)
  return { text: `${dd.getMonth() + 1}/${dd.getDate()} ${fmtHM(due)}`, hot: false }
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
  const [view, setView] = useState<'active' | 'done'>('active')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  // 行内编辑（Electron 里 window.prompt 不可用——之前双击编辑没反应就是这个原因）
  const [edit, setEdit] = useState<{ id: number; text: string; due: string } | null>(null)
  const [subDraft, setSubDraft] = useState('')
  const [breaking, setBreaking] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const subInputRef = useRef<HTMLInputElement>(null)

  /* ---- 统计 ---- */
  const d0 = dayStart()
  const active = p.todos.filter((t) => !t.done)
  const doneToday = p.todos.filter((t) => t.done && (t.doneAt || 0) >= d0).length
  const todayCnt = active.filter((t) => t.due && t.due >= d0 && t.due < d0 + 86400000).length
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

  /* ---- 任务分组 ---- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = p.todos.filter((t) => (view === 'done' ? t.done : !t.done))
    if (!q) return list
    return list.filter((t) => (t.text + (t.note || '') + (t.subs || []).map((s) => s.text).join(' ')).toLowerCase().includes(q))
  }, [p.todos, view, query])

  const groups = useMemo(() => {
    if (view === 'done') return [{ key: 'done', label: '已完成', items: [...filtered].sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)) }]
    const g: { key: string; label: string; items: TodoItem[] }[] = [
      { key: 'over', label: '⏰ 已到时', items: [] },
      { key: 'today', label: '今天', items: [] },
      { key: 'tomo', label: '明天', items: [] },
      { key: 'week', label: '本周', items: [] },
      { key: 'later', label: '以后', items: [] },
      { key: 'none', label: '未安排', items: [] }
    ]
    for (const t of filtered) {
      if (!t.due) g[5].items.push(t)
      else if (t.due <= now) g[0].items.push(t)
      else if (t.due < d0 + 86400000) g[1].items.push(t)
      else if (t.due < d0 + 2 * 86400000) g[2].items.push(t)
      else if (t.due < d0 + 7 * 86400000) g[3].items.push(t)
      else g[4].items.push(t)
    }
    for (const grp of g) grp.items.sort((a, b) => Number(b.pinned || 0) - Number(a.pinned || 0) || (a.priority || 3) - (b.priority || 3) || (a.due || Infinity) - (b.due || Infinity))
    return g.filter((x) => x.items.length)
  }, [filtered, view, now, d0])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ① 顶部日历卡：日期 + 进度环 + 统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', borderRadius: 16, background: 'linear-gradient(135deg, oklch(0.3 calc(0.05 * var(--cs, 1)) var(--th) / .35), oklch(0.22 calc(0.03 * var(--cs, 1)) var(--th2) / .2))', border: '1px solid oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .25)' }}>
        <ProgressRing pct={pct} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 16, fontWeight: 800, letterSpacing: '.01em' }}>{today.getMonth() + 1} 月 {today.getDate()} 日</span>
            <span style={{ color: 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 11 }}>{WEEK[today.getDay()]}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {overdue > 0 && <span style={{ padding: '2px 9px', borderRadius: 999, background: 'oklch(0.4 0.1 75 / .4)', color: 'oklch(0.88 0.11 75)', fontSize: 10, fontWeight: 700 }}>⏰ 到时 {overdue}</span>}
            <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.82 0.02 var(--th) / .85)', fontSize: 10, fontWeight: 600 }}>今日 {todayCnt + overdue}</span>
            <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.8 calc(0.12 * var(--cs, 1)) var(--th))', fontSize: 10, fontWeight: 600 }}>✓ {doneToday}</span>
            <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.72 0.02 var(--th) / .65)', fontSize: 10 }}>全部 {active.length}</span>
          </div>
        </div>
      </div>

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
          {(['active', 'done'] as const).map((v) => (
            <span key={v} className="hv" onClick={() => setView(v)} style={{ padding: '4px 13px', borderRadius: 7, fontSize: 11, fontWeight: view === v ? 700 : 500, cursor: 'pointer', background: view === v ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'transparent', color: view === v ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.78 0.02 var(--th) / .7)' }}>
              {v === 'active' ? `待办 ${active.length}` : `已完成`}
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

      {/* 空态 */}
      {groups.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '26px 14px', borderRadius: 16, background: 'rgba(255,255,255,.025)', border: '1px dashed rgba(255,255,255,.08)' }}>
          <span style={{ fontSize: 22, opacity: 0.6 }}>{query ? '🔍' : view === 'done' ? '🌱' : '🎉'}</span>
          <span style={{ color: 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 11.5 }}>{query ? '没有匹配的任务' : view === 'done' ? '还没有完成的任务' : '全部清空了，享受当下'}</span>
        </div>
      )}

      {/* ④ 分组任务时间线 */}
      {groups.map((g) => (
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
                    {(dl || t.repeat !== 'none' && t.repeat || subs.length > 0 || t.note) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                        {dl && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: dl.hot ? 'oklch(0.4 0.1 75 / .4)' : 'rgba(255,255,255,.06)', color: dl.hot ? 'oklch(0.88 0.11 75)' : 'oklch(0.72 0.02 var(--th) / .7)' }}>⏰ {dl.text}</span>}
                        {t.repeat && t.repeat !== 'none' && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, background: 'rgba(255,255,255,.06)', color: 'oklch(0.72 0.02 var(--th) / .7)' }}>🔁 {t.repeat === 'daily' ? '每天' : '每周'}</span>}
                        {subs.length > 0 && <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 9, background: 'rgba(255,255,255,.06)', color: subsDone === subs.length ? 'oklch(0.8 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.72 0.02 var(--th) / .7)' }}>☑ {subsDone}/{subs.length}</span>}
                        {t.note && <span style={{ fontSize: 9, color: 'oklch(0.65 0.02 var(--th) / .6)' }}>📝</span>}
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
