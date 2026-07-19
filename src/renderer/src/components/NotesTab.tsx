// 灵感便签：AI 把文章/网页/段落整理成排版优美的知识卡片（自动配色+标签），
// 支持手动新建/编辑（Markdown）、按标签/日期筛选、AI 语义搜索。瀑布流双栏布局。

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3, Bookmark, Bold, Braces, Calendar, CalendarDays, CalendarRange, Check, ChevronLeft,
  ChevronRight, ClipboardType, Code, Combine, Copy, CornerDownRight, Dices, Download, Expand, Eye,
  FileCode, FileText, Heading2, HeartPulse, History, Image, Inbox, Languages, Layers, LayoutGrid,
  LayoutTemplate, Library, Lightbulb, Link, Link2, List, ListChecks, Lock, LockOpen, Merge,
  MessageSquare, MonitorPlay, Network, NotebookPen, Pause, Pencil, PictureInPicture2, Pin, Play,
  Plus, Quote, Save, Search, Settings2, Shuffle, Sparkles, Sprout, SquareCode, Star, StickyNote as StickyNoteIco,
  Tag, Tags, Target, Trash2, TrendingUp, Type, Undo2, Wand2, Wrench, X
} from 'lucide-react'
import type { LucideIcon } from '../ui/icons'
import { Button, Chip, EmptyState, IconButton, Input, Segmented } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, fill, FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'
import type { StickyNote } from '../types'
import { NOTE_COLORS, colorOf } from '../logic/noteAi'
import { imageToCompactDataUrl, selectLocalFiles } from '../logic/files'
import { buildGraph } from '../logic/noteLinks'
import { escHtml, mdToHtml } from '../logic/mdHtml'
import { NOTE_POWER_ACTIONS, runNotePowerAction, type NotePowerGroup } from '../logic/notePower'
import { island } from '../bridge'
import { Markdown, Collapsible } from './Markdown'

/** 便签模板：一键起草结构化便签 */
const TEMPLATES = [
  { label: '会议纪要', emoji: '📝', color: 'sky', title: '会议纪要 · ', tags: ['会议'], md: '## 主题\n\n## 参会\n\n## 结论\n- \n\n## 行动项\n- [ ] \n' },
  { label: '技术决策', emoji: '⚖️', color: 'violet', title: '决策 · ', tags: ['决策', 'ADR'], md: '## 背景\n\n## 决策\n\n## 理由\n\n## 影响 / 取舍\n' },
  { label: 'Bug 记录', emoji: '🐛', color: 'amber', title: 'Bug · ', tags: ['bug'], md: '## 现象\n\n## 复现步骤\n1. \n\n## 根因\n\n## 修复\n' },
  { label: '日报', emoji: '☀️', color: 'emerald', title: '日报 · ', tags: ['日报'], md: '## 昨天\n- \n\n## 今天\n- \n\n## 阻塞\n- \n' }
]

interface NotesTabProps {
  notes: StickyNote[]
  onAdd: () => void
  onUpdate: (n: StickyNote) => void
  onDelete: (id: number) => void
  onTogglePin: (id: number) => void
  /** AI 生成：输入文本或 URL，返回反馈文案 */
  onAiCreate: (input: string) => Promise<string>
  /** AI 语义搜索：返回匹配 id 列表（null=AI 不可用，调用方回退关键词） */
  onAiSearch: (query: string) => Promise<number[] | null>
  /** 从模板新建（整条便签直接入库） */
  onAddNote: (n: StickyNote) => void
  /** 钉屏：把便签钉成桌面浮贴 */
  onPinDesktop: (n: StickyNote) => void
  /** 在全屏 Markdown 工作台里编辑 */
  onOpenStudio: (n: StickyNote) => void
  /** 收藏星标 */
  onStar: (id: number) => void
  /** 回收站：恢复 / 彻底删除 */
  onRestore: (id: number) => void
  onPurge: (id: number) => void
  /** 批量：改色 / 移入回收站 */
  onBatchColor: (ids: number[], color: string) => void
  onBatchTrash: (ids: number[]) => void
  /** 通用 AI（单便签增强 / 周回顾 / 问便签 / 合并） */
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  /** 提取行动项 → 一键进待办 */
  onQuickTodo: (text: string) => void
}

/** 单便签 AI 增强动作 */
const NOTE_AI: { key: string; Icon: LucideIcon; label: string; hint: string }[] = [
  { key: 'summary', Icon: FileText, label: '摘要', hint: '生成 2-3 句摘要插到顶部' },
  { key: 'tags', Icon: Tag, label: '自动标签', hint: 'AI 补全标签' },
  { key: 'polish', Icon: Sparkles, label: '润色', hint: '全文改写更通顺清晰' },
  { key: 'continue', Icon: CornerDownRight, label: '续写', hint: '顺着结尾续写一段' },
  { key: 'translate', Icon: Languages, label: '翻译', hint: '追加中英互译小节' },
  { key: 'todos', Icon: ListChecks, label: '提行动项', hint: '提取行动项直接进待办' },
  { key: 'title', Icon: Type, label: '起标题', hint: 'AI 重起标题+emoji' },
  { key: 'quotes', Icon: Quote, label: '提金句', hint: '提炼金句成引用块' },
  { key: 'similar', Icon: Link2, label: '找相似', hint: '从其它便签找相关并建双链' },
  { key: 'dig', Icon: Sprout, label: '深挖3问', hint: '生成三个追问引导你想下去' },
  { key: 'poster', Icon: Image, label: '金句海报', hint: '提金句渲染成分享卡片' }
]

/** 全库级 AI 工具箱（超越单便签的 AI 能力） */
const NOTE_TOOLS: { key: string; Icon: LucideIcon; label: string; hint: string }[] = [
  { key: 'prompt', Icon: Lightbulb, label: '灵感引导', hint: '基于你近期的便签主题，出一个思考引导问题' },
  { key: 'batchtag', Icon: Tags, label: '批量标签', hint: '给所有无标签便签自动打标签' },
  { key: 'collide', Icon: Combine, label: '灵感碰撞', hint: '随机抽两条便签，碰撞出新点子存为新便签' },
  { key: 'insight', Icon: TrendingUp, label: '创作洞察', hint: '分析全部便签：主题分布/思考倾向/盲区' },
  { key: 'weekplan', Icon: CalendarRange, label: '想法转周计划', hint: '从近期便签提取可执行项直接进待办' },
  { key: 'health', Icon: HeartPulse, label: '健康度体检', hint: '找出过短/重复/过时便签，给清理建议' },
  { key: 'linkall', Icon: Network, label: '批量建双链', hint: 'AI 扫描全库找隐含关联，自动补 [[双链]]' }
]

/** 从 Markdown 提取任务行（卡上直接勾选用） */
const extractTasks = (md: string): { line: number; done: boolean; text: string }[] => {
  const out: { line: number; done: boolean; text: string }[] = []
  md.split('\n').forEach((l, i) => {
    const m = l.match(/^\s*- \[( |x)\]\s*(.+)/)
    if (m) out.push({ line: i, done: m[1] === 'x', text: m[2].slice(0, 40) })
  })
  return out
}
/** 提取正文里第一张图（画廊形态用） */
const firstImage = (md: string): string | null => md.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1] || null
const dayKey = (ts: number): string => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }

const fmtDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const dayLabel = (ts: number): string => {
  const d = new Date(ts)
  const today = new Date()
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= t0) return '今天'
  if (ts >= t0 - 86400000) return '昨天'
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 卡片配色：便签用户数据色（note.color → 色相 h）→ 玻璃渐变填充 + 标题色（填充制，无描边；pinned 填充更深） */
const cardStyle = (h: number, pinned?: boolean): React.CSSProperties => ({
  breakInside: 'avoid',
  marginBottom: SP.sm + 1,
  padding: `${SP.md - 1}px ${SP.md}px`,
  borderRadius: R.lg,
  background: pinned
    ? `linear-gradient(160deg, oklch(0.36 0.06 ${h} / .52), oklch(0.24 0.04 ${h} / .36))`
    : `linear-gradient(160deg, oklch(0.33 0.055 ${h} / .4), oklch(0.22 0.035 ${h} / .28))`,
  display: 'flex',
  flexDirection: 'column',
  gap: 6
})

/** 标签小胶囊（跟随便签色相） */
const chip = (h: number): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: R.pill,
  background: `oklch(0.4 0.07 ${h} / .35)`,
  color: `oklch(0.85 0.08 ${h})`,
  fontSize: FS.tiny - 1,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
})

/** 行内操作小图标（row-acts 悬停浮现） */
const Act = ({ icon: Icon, title, onClick, color, busy }: { icon: LucideIcon; title: string; onClick: (e: React.MouseEvent) => void; color?: string; busy?: boolean }): React.JSX.Element => (
  <span className="hv" title={title} onClick={onClick} style={{ cursor: 'pointer', color: busy ? ink(4) : color || ink(2), display: 'inline-flex', alignItems: 'center', padding: 1 }}>
    <Icon size={12.5} strokeWidth={1.9} />
  </span>
)

const inputBase: React.CSSProperties = {
  boxSizing: 'border-box',
  ...surface.inset(),
  color: ink(1),
  fontSize: FS.small,
  padding: '7px 10px',
  outline: 'none',
  fontFamily: 'inherit'
}

/** AI 区块面板：主题色浅底 + 发型线描边（工具箱/问便签/生成） */
const aiPanel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: SP.sm - 1,
  padding: SP.md - 2,
  borderRadius: R.lg,
  background: semBg(accent(), 0.08),
  border: `0.5px solid ${hairline(0.1)}`
}

export function NotesTab(p: NotesTabProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [aiIds, setAiIds] = useState<number[] | null>(null) // AI 搜索结果（null=未启用）
  const [aiBusy, setAiBusy] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genInput, setGenInput] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState<StickyNote | null>(null)
  const [preview, setPreview] = useState(false)
  const [tplOpen, setTplOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [focusId, setFocusId] = useState<number | null>(null)
  const [clipMsg, setClipMsg] = useState('')
  // +10：视图 / 排序 / 收藏筛选 / 颜色筛选 / 批量选择 / 回收站
  const [layout, setLayout] = useState<'grid' | 'list' | 'timeline' | 'gallery'>('grid')
  const [sortBy, setSortBy] = useState<'created' | 'updated' | 'title'>('created')
  const [starOnly, setStarOnly] = useState(false)
  const [colorFilter, setColorFilter] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showTrash, setShowTrash] = useState(false)
  // AI 增强：单便签 AI 菜单 / 忙碌标记；周回顾 / 问便签 / 合并
  const [aiMenuId, setAiMenuId] = useState<number | null>(null)
  const [noteAiBusy, setNoteAiBusy] = useState('')
  const [weekBusy, setWeekBusy] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [askQ, setAskQ] = useState('')
  const [askA, setAskA] = useState('')
  const [mergeBusy, setMergeBusy] = useState(false)
  // 功能补全：阅读浮层 / 近7天 / 无标签筛选
  const [readNote, setReadNote] = useState<StickyNote | null>(null)
  const [recentOnly, setRecentOnly] = useState(false)
  const [noTagOnly, setNoTagOnly] = useState(false)
  // 多形态：灵感追加 / 速记收集箱 / 闪卡复习 / 放映 / 统计 / 稍后读 / AI 工具箱 / 金句海报
  const [appendId, setAppendId] = useState<number | null>(null)
  const [appendText, setAppendText] = useState('')
  const [appendBusy, setAppendBusy] = useState(false)
  const [inbox, setInbox] = useState('')
  const [flashOpen, setFlashOpen] = useState(false)
  const [flashIdx, setFlashIdx] = useState(0)
  const [flashBack, setFlashBack] = useState(false)
  const [showOpen, setShowOpen] = useState(false)
  const [showIdx, setShowIdx] = useState(0)
  const [showAuto, setShowAuto] = useState(true)
  const [statsOpen, setStatsOpen] = useState(false)
  const [laterOnly, setLaterOnly] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [powerOpen, setPowerOpen] = useState(false)
  const [powerGroup, setPowerGroup] = useState<NotePowerGroup>('整理')
  const [powerOut, setPowerOut] = useState<{ title: string; content: string } | null>(null)
  const [powerBusy, setPowerBusy] = useState('')
  const [toolBusy, setToolBusy] = useState('')
  const [toolOut, setToolOut] = useState('')
  const [topicQ, setTopicQ] = useState('')
  const [poster, setPoster] = useState<{ note: StickyNote; quote: string } | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 放映：自动翻页
  useEffect(() => {
    if (!showOpen || !showAuto) return
    const t = setInterval(() => setShowIdx((i) => i + 1), 8000)
    return () => clearInterval(t)
  }, [showOpen, showAuto])

  // ===== 灵感追加：直接追加 / AI 增强追加 =====
  const stamp = (): string => { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const appendRaw = (n: StickyNote): void => {
    const t = appendText.trim(); if (!t) return
    p.onUpdate({ ...n, md: `${n.md.trimEnd()}\n\n---\n💡 **${stamp()} 追加**：${t}`, updatedAt: Date.now() })
    setAppendText(''); setAppendId(null); flash('✓ 已追加')
  }
  const appendAi = async (n: StickyNote): Promise<void> => {
    const t = appendText.trim(); if (!t || appendBusy) return
    setAppendBusy(true)
    const r = await p.onAI(
      '用户在给一条已有便签追加新灵感碎片。把碎片扩写成 2-4 句成型的想法（承接便签主题、补充具体化），只输出扩写结果。',
      `便签《${n.title}》：\n${n.md.slice(0, 1500)}\n\n新碎片：${t}`
    )
    setAppendBusy(false)
    if (r.ok && r.text) {
      p.onUpdate({ ...n, md: `${n.md.trimEnd()}\n\n---\n💡 **${stamp()} 追加**（✨增强）：\n\n${r.text.trim()}`, updatedAt: Date.now() })
      setAppendText(''); setAppendId(null); flash('✓ AI 已增强并追加')
    } else flash(r.error || '增强失败')
  }
  // 速记收集箱：回车即存碎片便签
  const quickCapture = (): void => {
    const t = inbox.trim(); if (!t) return
    const now = Date.now()
    p.onAddNote({ id: now, emoji: '💡', title: t.slice(0, 14), md: t, color: 'amber', tags: ['碎片'], createdAt: now, updatedAt: now })
    setInbox(''); flash('✓ 已入收集箱')
  }
  // 今日日记：已有则打开编辑，没有则从模板创建
  const openDiary = (): void => {
    const d = new Date()
    const title = `日记 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const exist = p.notes.find((n) => !n.trashed && n.title === title)
    if (exist) { startEdit(exist); return }
    const now = Date.now()
    const n: StickyNote = { id: now, emoji: '📔', title, md: '## 今天\n\n## 想法\n\n## 感恩\n- \n', color: 'emerald', tags: ['日记'], createdAt: now, updatedAt: now }
    p.onAddNote(n); setEditId(n.id); setDraft({ ...n }); setPreview(false)
  }
  // 卡上任务直接勾选：改写 md 里第 line 行的 [ ]/[x]
  const toggleTask = (n: StickyNote, line: number): void => {
    const lines = n.md.split('\n')
    lines[line] = lines[line].includes('- [ ]') ? lines[line].replace('- [ ]', '- [x]') : lines[line].replace('- [x]', '- [ ]')
    p.onUpdate({ ...n, md: lines.join('\n'), updatedAt: Date.now() })
  }
  // 合集成文：当前标签下全部便签装订成一篇文档进工作台
  const bindCollection = (): void => {
    const list = p.notes.filter((n) => !n.trashed && n.tags.includes(tagFilter))
    if (!list.length) return
    const md = list.map((n) => `# ${n.emoji} ${n.title}\n\n${n.md}`).join('\n\n---\n\n')
    const now = Date.now()
    p.onOpenStudio({ id: now, emoji: '📚', title: `合集 · ${tagFilter}`, md, color: 'violet', tags: [tagFilter], createdAt: now, updatedAt: now })
  }
  // 金句海报：AI 提金句 → canvas 渲染
  const makePoster = async (n: StickyNote): Promise<void> => {
    const r = await p.onAI('从下面的内容里选出最有力量的一句金句（≤40 字），只输出这一句，不带引号。', n.md.slice(0, 3000))
    if (r.ok && r.text) setPoster({ note: n, quote: r.text.trim().split('\n')[0].slice(0, 60) })
    else flash(r.error || '提取金句失败')
  }
  const renderPoster = (): string => {
    if (!poster) return ''
    const W = 1080, H = 720
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    const h = colorOf(poster.note.color)
    const hex = (l: number, ch: number): string => `oklch(${l} ${ch} ${h})` // canvas 支持 oklch（Chromium 111+）
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, hex(0.32, 0.09)); g.addColorStop(1, hex(0.16, 0.05))
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    const orb = ctx.createRadialGradient(W * 0.85, H * 0.15, 0, W * 0.85, H * 0.15, 420)
    orb.addColorStop(0, 'rgba(255,255,255,.14)'); orb.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = orb; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = hex(0.8, 0.13); ctx.font = '700 44px "Segoe UI"'; ctx.fillText('❝', 80, 160)
    ctx.fillStyle = 'rgba(255,255,255,.94)'; ctx.font = '600 52px "Segoe UI","Microsoft YaHei"'
    // 手动换行（每行 ~16 中文字符宽）
    const words = [...poster.quote]; const lines: string[] = []; let cur = ''
    for (const ch of words) { cur += ch; if (ctx.measureText(cur).width > W - 200) { lines.push(cur); cur = '' } }
    if (cur) lines.push(cur)
    lines.slice(0, 5).forEach((l, i) => ctx.fillText(l, 96, 250 + i * 78))
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '400 26px "Segoe UI"'
    ctx.fillText(`—— ${poster.note.emoji} ${poster.note.title}`, 96, H - 90)
    ctx.fillStyle = hex(0.75, 0.1); ctx.font = '600 22px "Segoe UI"'
    ctx.fillText('Agentic-Island · 灵感便签', 96, H - 48)
    return c.toDataURL('image/png')
  }

  // ===== AI 工具箱（全库级）=====
  const runTool = async (key: string): Promise<void> => {
    if (toolBusy) return
    const live = p.notes.filter((n) => !n.trashed)
    setToolBusy(key); setToolOut('')
    try {
      if (key === 'prompt') {
        const topics = live.slice(0, 20).map((n) => n.title).join('、')
        const r = await p.onAI('你是灵感教练。基于用户最近记录的主题，出一个能激发深入思考的引导问题（一句话），再给一句为什么值得想。格式：**问题**\n为什么值得想。', `近期主题：${topics || '（还没有便签）'}`)
        if (r.ok && r.text) setToolOut(r.text.trim())
      } else if (key === 'batchtag') {
        const untagged = live.filter((n) => n.tags.length === 0).slice(0, 10)
        if (!untagged.length) { flash('没有无标签的便签'); return }
        const body = untagged.map((n) => `${n.id}｜${n.title}｜${n.md.slice(0, 150)}`).join('\n')
        const r = await p.onAI('为每条便签生成 1-3 个中文标签（≤4字）。只输出 JSON 数组：[{"id":数字,"tags":["a","b"]}]', body)
        if (r.ok && r.text) {
          try {
            const arr = JSON.parse(r.text.replace(/^```(json)?\s*|\s*```$/g, '')) as { id: number; tags: string[] }[]
            let cnt = 0
            arr.forEach((x) => { const n = untagged.find((u) => u.id === x.id); if (n && Array.isArray(x.tags)) { p.onUpdate({ ...n, tags: x.tags.slice(0, 3) }); cnt++ } })
            flash(`✓ 已为 ${cnt} 条便签打标签`)
          } catch { setToolOut(r.text.trim()) }
        }
      } else if (key === 'collide') {
        if (live.length < 2) { flash('便签太少，攒一攒再碰'); return }
        const a = live[Math.floor(Math.random() * live.length)]
        let b = live[Math.floor(Math.random() * live.length)]
        if (b.id === a.id) b = live[(live.indexOf(a) + 1) % live.length]
        const r = await p.onAI('把两条不相干的便签碰撞出一个新点子：先一句说出它们的隐秘联系，再给出 1 个可执行的新想法（2-4 句）。Markdown。', `A《${a.title}》：${a.md.slice(0, 500)}\n\nB《${b.title}》：${b.md.slice(0, 500)}`)
        if (r.ok && r.text) {
          const now = Date.now()
          p.onAddNote({ id: now, emoji: '🔮', title: `碰撞：${a.title.slice(0, 6)} × ${b.title.slice(0, 6)}`, md: r.text.trim() + `\n\n> 源自 [[${a.title}]] × [[${b.title}]]`, color: 'violet', tags: ['碰撞'], createdAt: now, updatedAt: now })
          flash('✓ 新点子已存为便签')
        }
      } else if (key === 'insight') {
        const body = live.slice(0, 40).map((n) => `${n.title}｜${n.tags.join(',')}｜${n.md.length}字`).join('\n')
        const r = await p.onAI('你是知识管理顾问。基于便签清单（标题|标签|字数）输出「创作洞察」：## 你在想什么（主题分布）## 思考习惯（长短/频率特征）## 盲区与建议（2-3 条）。Markdown，具体不空泛。', body || '（空）')
        if (r.ok && r.text) setToolOut(r.text.trim())
      } else if (key === 'weekplan') {
        const recent = live.filter((n) => n.createdAt > Date.now() - 7 * 86400_000).slice(0, 15)
        if (!recent.length) { flash('近 7 天没有便签'); return }
        const r = await p.onAI('从便签里提取本周可执行的行动项（≤6 条），每行一条，不要序号符号，只输出行动项。', recent.map((n) => `《${n.title}》${n.md.slice(0, 300)}`).join('\n\n'))
        if (r.ok && r.text) {
          const items = r.text.trim().split('\n').map((l) => l.replace(/^[-*•\d.\s[\]x]+/, '').trim()).filter(Boolean).slice(0, 6)
          items.forEach((t) => p.onQuickTodo(t))
          flash(`✓ ${items.length} 条已进待办`)
        }
      } else if (key === 'health') {
        const body = live.slice(0, 40).map((n) => `${n.id}｜${n.title}｜${n.md.length}字｜${Math.round((Date.now() - n.updatedAt) / 86400_000)}天未更新`).join('\n')
        const r = await p.onAI('你是便签库管家。基于清单（id|标题|字数|多久没更新）给出体检报告：## 建议清理（太短/疑似重复/太久）## 建议深化（有潜力但太薄）## 一句总评。提到便签用《标题》。Markdown。', body || '（空）')
        if (r.ok && r.text) setToolOut(r.text.trim())
      } else if (key === 'linkall') {
        const pool = live.slice(0, 25)
        const r = await p.onAI('从标题清单里找出 2-4 对主题相关的便签。只输出 JSON：[{"a":"标题1","b":"标题2"}]，标题必须一字不差照抄。没有就输出 []', pool.map((n) => n.title).join('\n'))
        if (r.ok && r.text) {
          try {
            const pairs = JSON.parse(r.text.replace(/^```(json)?\s*|\s*```$/g, '')) as { a: string; b: string }[]
            let cnt = 0
            pairs.slice(0, 4).forEach(({ a, b }) => {
              const na = pool.find((n) => n.title.trim() === a?.trim()); const nb = pool.find((n) => n.title.trim() === b?.trim())
              if (na && nb && !na.md.includes(`[[${nb.title}]]`)) { p.onUpdate({ ...na, md: `${na.md.trimEnd()}\n\n> 🔗 相关：[[${nb.title}]]`, updatedAt: Date.now() }); cnt++ }
            })
            flash(cnt ? `✓ 已补 ${cnt} 条双链（看关系图）` : '没找到值得建链的关联')
          } catch { setToolOut(r.text.trim()) }
        }
      } else if (key === 'topic') {
        const q = topicQ.trim(); if (!q) { flash('先输入要追踪的主题'); return }
        const hits = live.filter((n) => (n.title + n.md + n.tags.join('')).toLowerCase().includes(q.toLowerCase())).slice(0, 12)
        if (!hits.length) { flash('没有该主题的便签'); return }
        const body = hits.map((n) => `[${new Date(n.createdAt).toLocaleDateString('zh-CN')}]《${n.title}》${n.md.slice(0, 300)}`).join('\n\n')
        const r = await p.onAI('梳理用户对某主题的想法演进：按时间线总结观点如何变化/深化，最后给「下一步值得想的问题」。Markdown，含日期。', `主题：${q}\n\n${body}`)
        if (r.ok && r.text) setToolOut(r.text.trim())
      }
    } finally { setToolBusy('') }
  }

  const runPowerTool = async (id: string): Promise<void> => {
    if (powerBusy) return
    setPowerBusy(id)
    try {
      const result = runNotePowerAction(id, p.notes)
      if (result.kind === 'updates' && result.updates) {
        result.updates.forEach(p.onUpdate)
        flash(`✓ ${result.title} · ${result.updates.length} 条`)
      } else if (result.kind === 'document' && result.content) {
        const now2 = Date.now()
        p.onAddNote({ id: now2, emoji: '📚', title: result.title, md: result.content, color: 'sky', tags: ['索引'], createdAt: now2, updatedAt: now2 })
        flash(`✓ 已生成《${result.title}》`)
      } else if (result.kind === 'export' && result.content && result.ext) {
        const saved = await island.saveText(result.content, result.title, result.ext)
        flash(saved.ok ? `✓ 已导出 ${result.ext.toUpperCase()}` : '已取消导出')
      } else if (result.content) {
        setPowerOut({ title: result.title, content: result.content })
      }
    } finally { setPowerBusy('') }
  }

  // 阅读浮层打开时捕获 Esc（capture 阶段拦下，避免触发岛的全局 Esc 收起）
  useEffect(() => {
    if (!readNote) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); setReadNote(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [readNote])

  const flash = (m: string): void => { setClipMsg(m); setTimeout(() => setClipMsg(''), 2600) }

  // ===== 单便签 AI 增强：按动作组 prompt → 结果落回便签 =====
  const runNoteAi = async (n: StickyNote, key: string): Promise<void> => {
    if (noteAiBusy) return
    setNoteAiBusy(`${n.id}:${key}`)
    setAiMenuId(null)
    const done = (): void => setNoteAiBusy('')
    const strip = (t: string): string => t.trim().replace(/^```(?:markdown|md|json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    try {
      if (key === 'summary') {
        const r = await p.onAI('为下面的便签写 2-3 句中文摘要，只输出摘要文字。', n.md.slice(0, 4000))
        if (r.ok && r.text) { p.onUpdate({ ...n, md: `> 📄 **摘要**：${strip(r.text).replace(/\n+/g, ' ')}\n\n${n.md}`, updatedAt: Date.now() }); flash('✓ 已插入摘要') } else flash(r.error || '生成失败')
      } else if (key === 'tags') {
        const r = await p.onAI('为下面的便签生成 2-4 个中文标签（每个 ≤4 字），逗号分隔，只输出标签。', `${n.title}\n${n.md.slice(0, 2000)}`)
        if (r.ok && r.text) { const tags = [...new Set([...n.tags, ...strip(r.text).split(/[,，、\s]+/).filter(Boolean)])].slice(0, 4); p.onUpdate({ ...n, tags, updatedAt: Date.now() }); flash('✓ 标签：' + tags.join(' / ')) } else flash(r.error || '生成失败')
      } else if (key === 'polish') {
        const r = await p.onAI('把下面的便签正文改写得更通顺、清晰、有条理，保持原意与 Markdown 结构，只输出结果。', n.md.slice(0, 6000))
        if (r.ok && r.text) { p.onUpdate({ ...n, md: strip(r.text), updatedAt: Date.now() }); flash('✓ 已润色') } else flash(r.error || '润色失败')
      } else if (key === 'continue') {
        const r = await p.onAI('顺着下面的便签内容自然地继续写一小段（3-6 句），风格一致，只输出续写部分。', n.md.slice(-3000))
        if (r.ok && r.text) { p.onUpdate({ ...n, md: n.md.trimEnd() + '\n\n' + strip(r.text), updatedAt: Date.now() }); flash('✓ 已续写') } else flash(r.error || '续写失败')
      } else if (key === 'translate') {
        const r = await p.onAI('翻译下面的内容：中文→英文，英文→中文，保留 Markdown 结构，只输出译文。', n.md.slice(0, 4000))
        if (r.ok && r.text) { p.onUpdate({ ...n, md: n.md.trimEnd() + '\n\n## 🌐 译文\n\n' + strip(r.text), updatedAt: Date.now() }); flash('✓ 已追加译文') } else flash(r.error || '翻译失败')
      } else if (key === 'todos') {
        const r = await p.onAI('从下面的便签里提取可执行的行动项（没有就输出"无"）。每行一条，不要序号/符号，只输出行动项。', n.md.slice(0, 4000))
        if (r.ok && r.text) {
          const items = strip(r.text).split('\n').map((l) => l.replace(/^[-*•\d.\s[\]x]+/, '').trim()).filter((l) => l && l !== '无').slice(0, 8)
          if (!items.length) { flash('没有提取到行动项') } else { items.forEach((t) => p.onQuickTodo(t)); flash(`✓ ${items.length} 条已加入待办`) }
        } else flash(r.error || '提取失败')
      } else if (key === 'title') {
        const r = await p.onAI('为下面的便签起一个简洁有力的标题（≤16 字）和一个贴切的 emoji。输出格式：emoji|标题，只输出这一行。', n.md.slice(0, 2000))
        if (r.ok && r.text) { const [em, ...rest] = strip(r.text).split('|'); const t = rest.join('|').trim(); p.onUpdate({ ...n, emoji: (em || '').trim().slice(0, 4) || n.emoji, title: t || n.title, updatedAt: Date.now() }); flash('✓ 已更新标题') } else flash(r.error || '生成失败')
      } else if (key === 'quotes') {
        const r = await p.onAI('从下面的内容里提炼 1-3 句最有价值的金句（原句或轻度改写），每句一行，只输出金句。', n.md.slice(0, 4000))
        if (r.ok && r.text) { const qs = strip(r.text).split('\n').filter(Boolean).map((l) => `> ❝ ${l.replace(/^[->\s❝"]+/, '')}`).join('\n'); p.onUpdate({ ...n, md: n.md.trimEnd() + '\n\n' + qs, updatedAt: Date.now() }); flash('✓ 已提炼金句') } else flash(r.error || '提炼失败')
      } else if (key === 'dig') {
        const r = await p.onAI('针对下面的想法，提出 3 个能推动它往下走的追问（具体、尖锐、可回答），输出 Markdown 有序列表，只输出列表。', n.md.slice(0, 3000))
        if (r.ok && r.text) { p.onUpdate({ ...n, md: n.md.trimEnd() + '\n\n## 🌱 深挖\n' + strip(r.text), updatedAt: Date.now() }); flash('✓ 已生成深挖三问') } else flash(r.error || '生成失败')
      } else if (key === 'poster') {
        await makePoster(n)
      } else if (key === 'similar') {
        const others = p.notes.filter((x) => !x.trashed && x.id !== n.id).slice(0, 40)
        if (!others.length) { flash('没有其它便签可关联'); done(); return }
        const list = others.map((x) => `- ${x.title}`).join('\n')
        const r = await p.onAI('从候选便签标题里挑出与目标便签最相关的 1-3 个，只输出标题本身，每行一个，一字不差地照抄候选里的标题。没有相关的就输出"无"。', `目标便签：${n.title}\n${n.md.slice(0, 1500)}\n\n候选：\n${list}`)
        if (r.ok && r.text) {
          const titles = strip(r.text).split('\n').map((l) => l.replace(/^[-*\s]+/, '').trim()).filter((t) => t && t !== '无' && others.some((x) => x.title.trim() === t)).slice(0, 3)
          if (!titles.length) { flash('没找到相关便签') } else { p.onUpdate({ ...n, md: n.md.trimEnd() + '\n\n## 🔗 相关\n' + titles.map((t) => `- [[${t}]]`).join('\n'), updatedAt: Date.now() }); flash(`✓ 已关联 ${titles.length} 条（看关系图）`) }
        } else flash(r.error || '查找失败')
      }
    } finally { done() }
  }

  // ===== 全局 AI：周回顾 / 问便签 / 合并选中 =====
  const weekReview = async (): Promise<void> => {
    if (weekBusy) return
    const recent = p.notes.filter((n) => !n.trashed && n.createdAt > Date.now() - 7 * 86400_000)
    if (recent.length < 2) { flash('近 7 天便签太少，攒一攒再来'); return }
    setWeekBusy(true)
    const body = recent.slice(0, 25).map((n) => `【${n.title}】${n.md.slice(0, 400)}`).join('\n\n')
    const r = await p.onAI('下面是用户近一周的灵感便签。写一篇「本周灵感回顾」：## 本周主线（2-3 句）、## 值得深挖的想法（要点）、## 下周行动建议（要点）。简体中文 Markdown，只输出正文。', body.slice(0, 12000))
    setWeekBusy(false)
    if (r.ok && r.text) {
      const now = Date.now(); const d = new Date()
      p.onAddNote({ id: now, emoji: '🗂', title: `本周灵感回顾 ${d.getMonth() + 1}/${d.getDate()}`, md: r.text.trim(), color: 'violet', tags: ['周回顾'], createdAt: now, updatedAt: now })
      flash('✓ 周回顾已生成（置顶查看）')
    } else flash(r.error || '生成失败')
  }
  const askNotes = async (): Promise<void> => {
    const q = askQ.trim(); if (!q) return
    setAskA('思考中…')
    const pool = p.notes.filter((n) => !n.trashed)
    const kw = q.toLowerCase()
    const ranked = [...pool].sort((a, b) => Number((b.title + b.md).toLowerCase().includes(kw)) - Number((a.title + a.md).toLowerCase().includes(kw))).slice(0, 12)
    const body = ranked.map((n, i) => `【${i + 1} · ${n.title}】${n.md.slice(0, 500)}`).join('\n\n')
    const r = await p.onAI('你是用户的便签问答助手。只依据下面的便签内容回答问题，引用时提及便签标题；没有相关内容就直说。简洁，Markdown。', `问题：${q}\n\n便签：\n${body.slice(0, 10000)}`)
    setAskA(r.ok && r.text ? r.text.trim() : (r.error || '回答失败'))
  }
  const mergeSelected = async (): Promise<void> => {
    const list = p.notes.filter((n) => selected.has(n.id) && !n.trashed)
    if (list.length < 2 || mergeBusy) { flash('先多选 2 条以上再合并'); return }
    setMergeBusy(true)
    const body = list.map((n) => `【${n.title}】\n${n.md}`).join('\n\n---\n\n')
    const r = await p.onAI('把下面几条主题相近的便签合并成一条：去重、归纳、保留全部有效信息，结构清晰的 Markdown。第一行输出合并后的标题（# 开头），之后是正文。', body.slice(0, 10000))
    setMergeBusy(false)
    if (r.ok && r.text) {
      const out = r.text.trim()
      const first = out.split('\n')[0].replace(/^#+\s*/, '').trim()
      const now = Date.now()
      p.onAddNote({ id: now, emoji: '🧬', title: first.slice(0, 30) || '合并便签', md: out.split('\n').slice(1).join('\n').trim(), color: list[0].color, tags: [...new Set(list.flatMap((n) => n.tags))].slice(0, 4), createdAt: now, updatedAt: now })
      p.onBatchTrash(list.map((n) => n.id))
      setSelectMode(false); setSelected(new Set())
      flash(`✓ ${list.length} 条已合并为「${first.slice(0, 14)}…」，原便签进回收站`)
    } else flash(r.error || '合并失败')
  }

  // ===== 功能补全：副本 / 复制 MD / 单条导出 / 锁定 =====
  const duplicate = (n: StickyNote): void => {
    const now = Date.now()
    p.onAddNote({ ...n, id: now, title: n.title + ' 副本', pinned: false, createdAt: now, updatedAt: now })
    flash('✓ 已创建副本')
  }
  const copyMd = (n: StickyNote): void => {
    void navigator.clipboard?.writeText(`# ${n.emoji} ${n.title}\n\n${n.md}`).catch(() => {})
    flash('✓ 已复制 Markdown')
  }
  const exportOne = async (n: StickyNote): Promise<void> => {
    const r = await island.saveMdFile(`# ${n.emoji} ${n.title}\n\n${n.md}\n\n${n.tags.map((t) => '#' + t).join(' ')}`, n.title || '便签')
    if (r.ok) flash('✓ 已导出 ' + (r.name || ''))
  }
  const toggleLock = (n: StickyNote): void => { p.onUpdate({ ...n, locked: !n.locked }); flash(n.locked ? '🔓 已解锁' : '🔒 已锁定（防误编辑/误删）') }

  const toggleSel = (id: number): void => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // 导出选中/全部为单个 .md 文件
  const exportMd = async (ids?: number[]): Promise<void> => {
    const list = (ids && ids.length ? p.notes.filter((n) => ids.includes(n.id)) : p.notes.filter((n) => !n.trashed))
    if (!list.length) return
    const md = list.map((n) => `# ${n.emoji} ${n.title}\n\n${n.md}\n\n${n.tags.map((t) => '#' + t).join(' ')}`).join('\n\n---\n\n')
    const r = await island.saveMdFile(md, `灵感便签导出_${list.length}条`)
    if (r.ok) { setClipMsg(`✓ 已导出 ${list.length} 条`); setTimeout(() => setClipMsg(''), 2500); setSelectMode(false); setSelected(new Set()) }
  }
  // 随机漫步：翻出一条旧便签
  const randomWalk = (): void => {
    const pool = p.notes.filter((n) => !n.trashed)
    if (!pool.length) return
    const n = pool[Math.floor(Math.random() * pool.length)]
    setQuery(''); setAiIds(null); setTagFilter(''); setColorFilter(''); setStarOnly(false); setShowTrash(false)
    setFocusId(n.id); setTimeout(() => setFocusId(null), 2600)
    setTimeout(() => document.getElementById('note-' + n.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }

  // ④ 双链跳转：按标题定位便签并高亮滚动
  const jumpToTitle = (title: string): void => {
    const target = p.notes.find((n) => n.title.trim().toLowerCase() === title.trim().toLowerCase())
    if (!target) { setClipMsg(`没有名为「${title}」的便签`); setTimeout(() => setClipMsg(''), 2500); return }
    setQuery(''); setAiIds(null); setTagFilter(''); setGraphOpen(false)
    setFocusId(target.id); setTimeout(() => setFocusId(null), 2200)
    setTimeout(() => document.getElementById('note-' + target.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 70)
  }

  // ⑤ 从模板新建并立即进入编辑
  const useTemplate = (tpl: (typeof TEMPLATES)[number]): void => {
    const now = Date.now()
    const n: StickyNote = { id: now, emoji: tpl.emoji, title: tpl.title, md: tpl.md, color: tpl.color, tags: [...tpl.tags], createdAt: now, updatedAt: now }
    p.onAddNote(n)
    setEditId(n.id); setDraft({ ...n }); setPreview(false); setTplOpen(false)
  }

  // ⑭ 复制富文本（粘进飞书/Word 保留排版）
  const copyRich = (n: StickyNote): void => {
    const html = `<h3>${escHtml(n.emoji)} ${escHtml(n.title)}</h3>` + mdToHtml(n.md)
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([`# ${n.title}\n\n${n.md}`], { type: 'text/plain' })
      })
      void navigator.clipboard.write([item]).catch(() => {})
      setClipMsg('✓ 已复制富文本'); setTimeout(() => setClipMsg(''), 2000)
    } catch {
      void navigator.clipboard?.writeText(`# ${n.title}\n\n${n.md}`).catch(() => {})
    }
  }

  // ③ 一键剪藏：读剪贴板里的网址，直接抓正文成便签
  const clipUrl = async (): Promise<void> => {
    try {
      const t = (await navigator.clipboard.readText()).trim()
      if (!/^https?:\/\/\S+$/i.test(t)) { setClipMsg('剪贴板里没有网址'); setTimeout(() => setClipMsg(''), 2500); return }
      setClipMsg('✨ 正在剪藏网页…')
      const msg = await p.onAiCreate(t)
      setClipMsg(msg); setTimeout(() => setClipMsg(''), 3000)
    } catch { setClipMsg('无法读取剪贴板'); setTimeout(() => setClipMsg(''), 2500) }
  }

  const graph = useMemo(() => buildGraph(p.notes), [p.notes])

  // 富文本工具栏：对选区包裹/插入 Markdown（用户无需手写语法）
  const wrapSel = (before: string, after = '', placeholder = '文字'): void => {
    const ta = taRef.current
    if (!ta || !draft) return
    const s = ta.selectionStart ?? draft.md.length
    const e = ta.selectionEnd ?? draft.md.length
    const sel = draft.md.slice(s, e) || placeholder
    const md = draft.md.slice(0, s) + before + sel + after + draft.md.slice(e)
    setDraft({ ...draft, md })
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length) })
  }
  const insertLine = (text: string): void => {
    const ta = taRef.current
    if (!draft) return
    const s = ta?.selectionStart ?? draft.md.length
    const pre = draft.md.slice(0, s)
    const md = pre + (pre && !pre.endsWith('\n') ? '\n' : '') + text + '\n' + draft.md.slice(s)
    setDraft({ ...draft, md })
  }
  // 🖼 插图：本地图片压缩为 dataURL（≈720px JPEG）嵌入便签
  const pickImage = (): void => {
    void selectLocalFiles('image/*').then((files) => {
      const f = files[0]
      if (!f) return
      imageToCompactDataUrl(f).then((url) => {
        if (url) insertLine(`![${f.name}](${url})`)
      })
    })
  }

  // 全部标签（按出现频次）
  const allTags = useMemo(() => {
    const cnt = new Map<string, number>()
    p.notes.filter((n) => !n.trashed).forEach((n) => n.tags.forEach((t) => cnt.set(t, (cnt.get(t) || 0) + 1)))
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12)
  }, [p.notes])
  const usedColors = useMemo(() => [...new Set(p.notes.filter((n) => !n.trashed).map((n) => n.color))], [p.notes])
  const trashCount = useMemo(() => p.notes.filter((n) => n.trashed).length, [p.notes])
  const stats = useMemo(() => {
    const live = p.notes.filter((n) => !n.trashed)
    return { total: live.length, star: live.filter((n) => n.starred).length, words: live.reduce((s, n) => s + n.md.length, 0) }
  }, [p.notes])

  // 过滤：回收站 / AI 结果 / 关键词 / 标签 / 颜色 / 收藏，再排序
  const filtered = useMemo(() => {
    let list = p.notes.filter((n) => (showTrash ? n.trashed : !n.trashed))
    if (!showTrash) {
      if (aiIds) list = aiIds.map((id) => list.find((n) => n.id === id)).filter(Boolean) as StickyNote[]
      else if (query.trim()) {
        const q = query.trim().toLowerCase()
        list = list.filter((n) => (n.title + n.md + n.tags.join(' ')).toLowerCase().includes(q))
      }
      if (tagFilter) list = list.filter((n) => n.tags.includes(tagFilter))
      if (colorFilter) list = list.filter((n) => n.color === colorFilter)
      if (starOnly) list = list.filter((n) => n.starred)
      if (recentOnly) list = list.filter((n) => n.createdAt > Date.now() - 7 * 86400_000)
      if (noTagOnly) list = list.filter((n) => n.tags.length === 0)
      if (laterOnly) list = list.filter((n) => n.later)
      if (layout === 'gallery') list = list.filter((n) => firstImage(n.md))
    }
    if (!aiIds) {
      const cmp = sortBy === 'title' ? (a: StickyNote, b: StickyNote) => a.title.localeCompare(b.title)
        : sortBy === 'updated' ? (a: StickyNote, b: StickyNote) => b.updatedAt - a.updatedAt
          : (a: StickyNote, b: StickyNote) => b.createdAt - a.createdAt
      list = [...list].sort((a, b) => Number(b.pinned || 0) - Number(a.pinned || 0) || cmp(a, b))
    }
    return list
  }, [p.notes, query, aiIds, tagFilter, colorFilter, starOnly, showTrash, sortBy, recentOnly, noTagOnly, laterOnly, layout])

  const aiSearch = (): void => {
    if (!query.trim() || aiBusy) return
    setAiBusy(true)
    p.onAiSearch(query.trim()).then((ids) => {
      setAiBusy(false)
      setAiIds(ids) // null = AI 不可用 → 保持关键词过滤
    })
  }

  const doGenerate = (): void => {
    if (!genInput.trim() || genBusy) return
    setGenBusy(true)
    setGenMsg('✨ AI 正在阅读并整理…')
    p.onAiCreate(genInput.trim()).then((msg) => {
      setGenBusy(false)
      setGenMsg(msg)
      if (msg.startsWith('✓')) setGenInput('')
    })
  }

  const startEdit = (n: StickyNote): void => { setEditId(n.id); setDraft({ ...n }); setPreview(false) }
  const saveEdit = (): void => {
    if (draft) p.onUpdate({ ...draft, updatedAt: Date.now() })
    setEditId(null); setDraft(null); setPreview(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {/* 顶栏：搜索 + AI 搜 + 生成/新建 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Input
            value={query}
            onChange={(v) => { setQuery(v); setAiIds(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') aiSearch() }}
            icon={Search}
            placeholder="搜索便签…（Enter = AI 语义搜索）"
          />
          {query && (
            <span className="hv" onClick={() => { setQuery(''); setAiIds(null) }} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: ink(3), display: 'flex' }}>
              <X size={11} strokeWidth={2} />
            </span>
          )}
        </div>
        <Button sm variant={aiIds ? 'tinted' : undefined} icon={Sparkles} onClick={aiSearch} title="AI 语义搜索（不只是关键词匹配）">
          {aiBusy ? '…' : 'AI 搜'}
        </Button>
        <Button sm variant="primary" icon={Wand2} onClick={() => setGenOpen((v) => !v)} title="AI 生成便签（丢文章/链接/段落进来）">生成</Button>
        <IconButton icon={Plus} onClick={p.onAdd} title="手动新建空白便签" size={30} />
      </div>

      {/* 速记收集箱：一行闪念，回车即存（碎片形态） */}
      <div style={{ display: 'flex', gap: 6 }}>
        <Input
          value={inbox}
          onChange={setInbox}
          onKeyDown={(e) => { if (e.key === 'Enter') quickCapture() }}
          icon={Inbox}
          placeholder="闪念收集箱：一句话灵感，回车即存（不打断心流）"
          style={{ flex: 1, background: semBg(sem.warn, 0.09), border: 'none' }}
        />
        {inbox.trim() && <Button sm variant="warn" onClick={quickCapture}>存</Button>}
      </div>

      {/* 次级工具条：剪藏 / 模板 / 关系图 / 周回顾 / 问便签 / 日记 / 闪卡 / 放映 / 统计 / 工具箱 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        {([
          [Link, '剪藏网址', '把剪贴板里的网址抓成便签', () => void clipUrl(), false],
          [LayoutTemplate, '模板', '从模板新建结构化便签', () => setTplOpen((v) => !v), tplOpen],
          [Network, '关系图', '便签双链关系图', () => setGraphOpen((v) => !v), graphOpen],
          [CalendarRange, weekBusy ? '生成中…' : '周回顾', 'AI 把近 7 天便签合成一篇回顾', () => void weekReview(), weekBusy],
          [MessageSquare, '问便签', '跨全部便签问答（AI 只依据你的便签回答）', () => setAskOpen((v) => !v), askOpen],
          [NotebookPen, '今日日记', '每天一条日记（已有则直接打开）', openDiary, false],
          [Layers, '闪卡', '闪卡形态复习便签（翻面记忆）', () => { setFlashIdx(0); setFlashBack(false); setFlashOpen(true) }, false],
          [MonitorPlay, '放映', '全屏轮播浏览便签', () => { setShowIdx(0); setShowOpen(true) }, false],
          [BarChart3, '统计', '创作热力图 / 标签分布', () => setStatsOpen((v) => !v), statsOpen],
          [Wand2, 'AI 工具箱', '全库级 AI：洞察/碰撞/体检/批量整理…', () => setToolsOpen((v) => !v), toolsOpen],
          [Settings2, `管理工具 ${NOTE_POWER_ACTIONS.length}`, '批量规范、质量审计、索引、洞察和结构化导出', () => setPowerOpen((v) => !v), powerOpen]
        ] as [LucideIcon, string, string, () => void, boolean][]).map(([Icon, label, title, fn, active]) => (
          <Chip key={label} icon={Icon} active={active} onClick={fn} title={title}>{label}</Chip>
        ))}
        {tagFilter && <Chip icon={Library} active color={sem.focus} onClick={bindCollection} title={`把「${tagFilter}」下全部便签装订成一篇文档进工作台`}>合集成文</Chip>}
        {clipMsg && <span style={{ flex: 1, minWidth: 120, color: clipMsg.startsWith('✓') || clipMsg.startsWith('✨') ? accent(0.82, 0.9) : ink(3), fontSize: FS.tiny - 0.5 }}>{clipMsg}</span>}
      </div>

      {/* AI 工具箱：全库级智能 */}
      {toolsOpen && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={aiPanel}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 5 }}>
            {NOTE_TOOLS.map((t) => (
              <div key={t.key} className="hv" title={t.hint} onClick={() => void runTool(t.key)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '9px 4px', borderRadius: R.md, cursor: 'pointer', background: toolBusy === t.key ? semBg(accent(), 0.16) : fill(2), border: toolBusy === t.key ? `0.5px solid ${accent(0.7, 0.3)}` : 'none' }}>
                <t.Icon size={15} strokeWidth={1.75} style={{ color: accent(0.82, toolBusy === t.key ? 1 : 0.7) }} />
                <span style={{ color: ink(1), fontSize: FS.tiny - 1, fontWeight: 600 }}>{toolBusy === t.key ? '…' : t.label}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={topicQ} onChange={setTopicQ} onKeyDown={(e) => { if (e.key === 'Enter') void runTool('topic') }} icon={Target} placeholder="主题追踪：输入主题，AI 梳理你对它的想法演进…" style={{ flex: 1 }} />
            <Button sm variant="primary" onClick={() => void runTool('topic')}>{toolBusy === 'topic' ? '…' : '追踪'}</Button>
          </div>
          {toolOut && (
            <div className="ai-scroll" style={{ maxHeight: 220, overflowY: 'auto', padding: '9px 11px', ...surface.inset(), fontSize: FS.small, lineHeight: 1.6 }}>
              <Markdown text={toolOut} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button sm icon={Pin} onClick={() => { const now = Date.now(); p.onAddNote({ id: now, emoji: '🧠', title: toolOut.split('\n')[0].replace(/^#+\s*|\*+/g, '').slice(0, 16) || 'AI 洞察', md: toolOut, color: 'violet', tags: ['洞察'], createdAt: now, updatedAt: now }); flash('✓ 已存为便签') }}>存为便签</Button>
                <Button sm icon={X} onClick={() => setToolOut('')}>清除</Button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* 非 AI 高级工具：所有动作均可本地完成 */}
      {powerOpen && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: SP.sm - 1, padding: SP.md - 2, ...surface.section() }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <Wrench size={12} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
            <span style={{ ...text.overline(), marginRight: 4 }}>便签库管理</span>
            {(['整理', '质检', '索引', '洞察', '导出'] as NotePowerGroup[]).map((group) => (
              <Chip key={group} active={powerGroup === group} onClick={() => setPowerGroup(group)}>{group} · {NOTE_POWER_ACTIONS.filter((x) => x.group === group).length}</Chip>
            ))}
            <span style={{ flex: 1 }} />
            <span style={text.faint()}>本地处理 · {NOTE_POWER_ACTIONS.length} 项</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 5 }}>
            {NOTE_POWER_ACTIONS.filter((x) => x.group === powerGroup).map((action) => (
              <button key={action.id} type="button" className="hv" onClick={() => void runPowerTool(action.id)} title={action.hint} style={{ height: 30, minWidth: 0, padding: '0 6px', borderRadius: R.sm, border: powerBusy === action.id ? `0.5px solid ${accent(0.7, 0.3)}` : 'none', background: powerBusy === action.id ? semBg(accent(), 0.16) : fill(2), color: ink(1), cursor: 'pointer', fontFamily: 'inherit', fontSize: FS.tiny - 1, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{powerBusy === action.id ? '处理中…' : action.label}</button>
            ))}
          </div>
          {powerOut && (
            <div className="ai-scroll" style={{ maxHeight: 220, overflowY: 'auto', padding: '9px 11px', ...surface.inset(), fontSize: FS.small, lineHeight: 1.6 }}>
              <Markdown text={powerOut.content} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button sm icon={Pin} onClick={() => { const now2 = Date.now(); p.onAddNote({ id: now2, emoji: '📋', title: powerOut.title, md: powerOut.content, color: 'violet', tags: ['审计'], createdAt: now2, updatedAt: now2 }); flash('✓ 报告已存为便签') }}>存为便签</Button>
                <Button sm icon={X} onClick={() => setPowerOut(null)}>关闭报告</Button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* 📊 统计仪表盘：12 周创作热力图 + 标签分布 */}
      {statsOpen && (() => {
        const live = p.notes.filter((n) => !n.trashed)
        const byDay = new Map<string, number>()
        live.forEach((n) => byDay.set(dayKey(n.createdAt), (byDay.get(dayKey(n.createdAt)) || 0) + 1))
        const weeks = 12
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const start = new Date(today.getTime() - (weeks * 7 - 1) * 86400_000)
        start.setDate(start.getDate() - start.getDay()) // 对齐周日
        const cells: { k: string; n: number }[] = []
        for (let i = 0; i < weeks * 7; i++) { const d = new Date(start.getTime() + i * 86400_000); if (d > today) break; cells.push({ k: dayKey(d.getTime()), n: byDay.get(dayKey(d.getTime())) || 0 }) }
        const tagCnt = new Map<string, number>()
        live.forEach((n) => n.tags.forEach((t) => tagCnt.set(t, (tagCnt.get(t) || 0) + 1)))
        const topTags = [...tagCnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        const maxTag = topTags[0]?.[1] || 1
        return (
          <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: SP.sm + 1, padding: SP.md - 1, ...surface.section() }}>
            <div style={{ display: 'flex', gap: 14, ...text.dim(), fontSize: FS.tiny - 0.5 }}>
              <span>共 <b style={{ color: accent(0.85) }}>{live.length}</b> 条</span>
              <span>收藏 <b style={{ color: sem.warn }}>{live.filter((n) => n.starred).length}</b></span>
              <span>本周新增 <b style={{ color: sem.calm }}>{live.filter((n) => n.createdAt > Date.now() - 7 * 86400_000).length}</b></span>
              <span>累计 <b style={{ color: ink(1) }}>{Math.round(live.reduce((s, n) => s + n.md.length, 0) / 1000)}k</b> 字</span>
            </div>
            <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 9px)', gridAutoFlow: 'column', gap: 2.5 }}>
              {cells.map((c, i) => (
                <span key={i} title={`${c.k} · ${c.n} 条`} style={{ width: 9, height: 9, borderRadius: 2.5, background: c.n === 0 ? fill(2) : `oklch(${0.45 + Math.min(3, c.n) * 0.12} calc(0.13 * var(--cs, 1)) var(--th) / ${0.5 + Math.min(3, c.n) * 0.16})` }} />
              ))}
            </div>
            {topTags.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {topTags.map(([t, n]) => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 56, flex: 'none', color: ink(2), fontSize: FS.tiny - 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}># {t}</span>
                    <div style={{ flex: 1, height: 7, borderRadius: R.pill, background: fill(1), overflow: 'hidden' }}>
                      <div style={{ width: `${(n / maxTag) * 100}%`, height: '100%', borderRadius: R.pill, background: 'linear-gradient(90deg, oklch(0.7 calc(0.13 * var(--cs, 1)) var(--th)), oklch(0.6 calc(0.12 * var(--cs, 1)) var(--th2)))' }} />
                    </div>
                    <span style={{ width: 22, flex: 'none', ...text.num(9), color: ink(3) }}>{n}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )
      })()}

      {/* 问便签：跨全部便签问答 */}
      {askOpen && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={aiPanel}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={askQ} onChange={setAskQ} onKeyDown={(e) => { if (e.key === 'Enter') void askNotes() }} icon={MessageSquare} placeholder="问你的便签库：我之前关于 X 记了什么？" style={{ flex: 1 }} />
            <Button sm variant="primary" onClick={() => void askNotes()}>问</Button>
          </div>
          {askA && <div className="ai-scroll" style={{ maxHeight: 180, overflowY: 'auto', padding: '9px 11px', ...surface.inset(), fontSize: FS.small, lineHeight: 1.6 }}><Markdown text={askA} /></div>}
        </motion.div>
      )}

      {/* 模板选择 */}
      {tplOpen && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: SP.sm + 1, ...surface.inset(), borderRadius: R.lg }}>
          {TEMPLATES.map((t) => (
            <div key={t.label} className="hv" onClick={() => useTemplate(t)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: R.md, cursor: 'pointer', background: `oklch(0.35 0.07 ${colorOf(t.color)} / .4)`, color: ink(1), fontSize: FS.small, fontWeight: 600 }}>
              <span>{t.emoji}</span>{t.label}
            </div>
          ))}
        </motion.div>
      )}

      {/* 双链关系图 */}
      {graphOpen && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ padding: SP.md - 2, ...surface.section() }}>
          {graph.nodes.length ? (
            <svg viewBox="0 0 300 200" style={{ width: '100%', height: 190 }}>
              {(() => {
                const cx = 150, cy = 100, rad = 78
                const pos = new Map(graph.nodes.map((n, i) => {
                  const a = (i / graph.nodes.length) * Math.PI * 2 - Math.PI / 2
                  return [n.id, { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) }]
                }))
                return (
                  <>
                    {graph.edges.map((e, i) => {
                      const a = pos.get(e.from), b = pos.get(e.to)
                      if (!a || !b) return null
                      return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: 'oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .35)', strokeWidth: 1 }} />
                    })}
                    {graph.nodes.map((n) => {
                      const pt = pos.get(n.id)!
                      const h = colorOf(n.color)
                      const r = 5 + Math.min(6, n.deg * 1.5)
                      return (
                        <g key={n.id} className="hv" onClick={() => jumpToTitle(n.title)} style={{ cursor: 'pointer' }}>
                          <circle cx={pt.x} cy={pt.y} r={r} style={{ fill: `oklch(0.7 0.13 ${h})` }} />
                          <text x={pt.x} y={pt.y - r - 3} textAnchor="middle" style={{ fill: 'oklch(0.85 0.02 var(--th) / .85)', fontSize: 7.5 }}>{n.title.slice(0, 8)}</text>
                        </g>
                      )
                    })}
                  </>
                )
              })()}
            </svg>
          ) : (
            <div style={{ ...text.faint(), padding: '14px 4px', textAlign: 'center', lineHeight: 1.6 }}>还没有双链。在便签正文里用 <code style={{ background: fill(3), padding: '1px 5px', borderRadius: 4 }}>[[另一条便签的标题]]</code> 建立关联，这里会长出关系图。</div>
          )}
        </motion.div>
      )}

      {/* AI 生成面板 */}
      {genOpen && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={aiPanel}>
          <textarea
            value={genInput}
            onChange={(e) => setGenInput(e.target.value)}
            placeholder={'粘贴任意内容，AI 整理成排版优美的知识便签：\n· 一段文字 / 整篇文章\n· 网页链接（自动抓取正文）\n· 本地 md/txt 直接拖进问答后复制过来\n（Word/PDF 暂不支持解析，可复制其中文字）'}
            rows={4}
            className="ai-scroll"
            style={{ ...inputBase, width: '100%', resize: 'none', lineHeight: 1.55, maxHeight: 120 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button sm variant="primary" icon={Wand2} onClick={doGenerate} disabled={!genInput.trim() || genBusy}>
              {genBusy ? '整理中…' : '整理成便签'}
            </Button>
            {genMsg && <span style={{ flex: 1, color: genMsg.startsWith('✓') ? accent(0.82, 0.9) : ink(2), fontSize: FS.tiny }}>{genMsg}</span>}
          </div>
        </motion.div>
      )}

      {/* 标签筛选 */}
      {allTags.length > 0 && (
        <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
          {allTags.map((t) => (
            <Chip key={t} active={tagFilter === t} onClick={() => setTagFilter(tagFilter === t ? '' : t)} style={{ flex: 'none' }}># {t}</Chip>
          ))}
        </div>
      )}
      {aiIds && <div style={{ color: accent(0.8, 0.9), fontSize: FS.tiny - 0.5 }}><Sparkles size={10} strokeWidth={2} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3 }} />AI 找到 {filtered.length} 条相关便签（<span className="hv" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setAiIds(null)}>返回全部</span>）</div>}

      {/* 控制条：视图 / 排序 / 收藏 / 颜色 / 随机 / 导出 / 多选 / 回收站 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <Segmented
          options={[
            { key: 'grid', label: '瀑布', icon: LayoutGrid },
            { key: 'list', label: '列表', icon: List },
            { key: 'timeline', label: '时间线', icon: History },
            { key: 'gallery', label: '画廊', icon: Image }
          ]}
          value={layout}
          onChange={(k) => setLayout(k)}
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} style={{ ...surface.inset(), color: ink(1), fontSize: FS.tiny, padding: '4px 7px', outline: 'none', fontFamily: 'inherit' }}>
          <option value="created">最新创建</option><option value="updated">最近更新</option><option value="title">标题</option>
        </select>
        <Chip icon={Star} active={starOnly} onClick={() => setStarOnly((v) => !v)} title="只看收藏">星标 {stats.star || ''}</Chip>
        <Chip icon={Bookmark} active={laterOnly} onClick={() => setLaterOnly((v) => !v)} title="稍后读队列（卡片上点书签图标加入）">稍后读 {p.notes.filter((n) => !n.trashed && n.later).length || ''}</Chip>
        <Chip icon={CalendarDays} active={recentOnly} onClick={() => setRecentOnly((v) => !v)} title="只看近 7 天新增">近7天</Chip>
        <Chip icon={Tag} active={noTagOnly} onClick={() => setNoTagOnly((v) => !v)} title="只看还没打标签的（方便补标签）">无标签</Chip>
        <Chip icon={Dices} onClick={randomWalk} title="随机翻一条旧便签">漫步</Chip>
        <Chip icon={ListChecks} active={selectMode} onClick={() => { setSelectMode((v) => !v); setSelected(new Set()) }} title="批量选择">多选</Chip>
        <Chip icon={Download} onClick={() => void exportMd()} title="导出全部为 .md">导出</Chip>
        <span style={{ flex: 1 }} />
        <span style={{ ...text.faint(), fontSize: FS.tiny - 1 }}>{stats.total} 条 · {stats.words > 1000 ? (stats.words / 1000).toFixed(1) + 'k' : stats.words} 字</span>
        {trashCount > 0 && <Chip icon={Trash2} active={showTrash} color={sem.danger} onClick={() => setShowTrash((v) => !v)} title="回收站">{trashCount}</Chip>}
      </div>

      {/* 颜色筛选 */}
      {usedColors.length > 1 && !showTrash && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {usedColors.map((c) => (
            <span key={c} className="hv" onClick={() => setColorFilter(colorFilter === c ? '' : c)} title={NOTE_COLORS.find((x) => x.key === c)?.label} style={{ width: 16, height: 16, borderRadius: R.pill, cursor: 'pointer', background: `oklch(0.6 0.13 ${colorOf(c)})`, border: colorFilter === c ? '2px solid #fff' : '2px solid transparent', boxSizing: 'border-box' }} />
          ))}
          {colorFilter && <span className="hv" onClick={() => setColorFilter('')} style={{ color: ink(3), fontSize: FS.tiny - 0.5, cursor: 'pointer' }}>清除</span>}
        </div>
      )}

      {/* 批量操作条 */}
      {selectMode && selected.size > 0 && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', borderRadius: R.lg, background: semBg(accent(), 0.1), border: `0.5px solid ${accent(0.7, 0.3)}`, flexWrap: 'wrap' }}>
          <span style={{ color: ink(1), fontSize: FS.small, fontWeight: 700 }}>已选 {selected.size}</span>
          <span style={{ flex: 1 }} />
          <span style={text.faint()}>改色</span>
          {NOTE_COLORS.map((c) => <span key={c.key} className="hv" onClick={() => { p.onBatchColor([...selected], c.key); setSelectMode(false); setSelected(new Set()) }} style={{ width: 15, height: 15, borderRadius: R.pill, cursor: 'pointer', background: `oklch(0.6 0.13 ${c.h})` }} />)}
          <Button sm icon={Download} onClick={() => void exportMd([...selected])}>导出</Button>
          {selected.size >= 2 && <Button sm icon={Merge} onClick={() => void mergeSelected()} title="AI 把选中的几条相似便签合并成一条（原便签进回收站）">{mergeBusy ? '合并中…' : 'AI 合并'}</Button>}
          <Button sm variant="danger" icon={Trash2} onClick={() => { p.onBatchTrash([...selected]); setSelectMode(false); setSelected(new Set()) }}>删除</Button>
        </motion.div>
      )}
      {showTrash && <div style={{ ...text.dim(), fontSize: FS.tiny }}><Trash2 size={10} strokeWidth={2} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3, color: ink(3) }} />回收站 · {trashCount} 条（<span className="hv" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setShowTrash(false)}>返回便签</span>）</div>}

      {/* 空态 */}
      {filtered.length === 0 && (
        <EmptyState
          icon={p.notes.length === 0 ? StickyNoteIco : Search}
          title={p.notes.length === 0 ? '还没有便签' : '没有匹配的便签'}
          desc={p.notes.length === 0 ? '点「生成」丢一篇文章/链接给 AI，每天积累一点碎片化知识' : undefined}
        />
      )}

      {/* 瀑布流双栏 / 列表·时间线单栏 / 画廊双栏 */}
      <div style={{ columnCount: layout === 'list' || layout === 'timeline' ? 1 : 2, columnGap: 9 }}>
        {filtered.map((n, idx) => {
          const h = colorOf(n.color)
          const editing = editId === n.id && draft
          // 时间线形态：日期变化处插分组头
          const dayHead = layout === 'timeline' && !showTrash && (idx === 0 || dayKey(filtered[idx - 1].createdAt) !== dayKey(n.createdAt))
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px 4px' }}><span style={{ ...text.overline(), color: accent(0.8, 0.9) }}>{dayLabel(n.createdAt)}</span><span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} /></div>
            : null
          if (editing) {
            return (
              <motion.div key={n.id} variants={fadeScaleIn} initial="initial" animate="animate" style={{ ...cardStyle(h), boxShadow: `0 0 0 1.5px oklch(0.75 0.13 ${h} / .7)` }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  <input value={draft.emoji} onChange={(e) => setDraft((d) => d && { ...d, emoji: e.target.value })} style={{ ...inputBase, width: 38, textAlign: 'center', padding: '5px 2px' }} />
                  <input value={draft.title} onChange={(e) => setDraft((d) => d && { ...d, title: e.target.value })} placeholder="标题" style={{ ...inputBase, flex: 1, fontWeight: 700 }} />
                </div>
                {/* 富文本工具栏：点按钮即可排版，无需手写 Markdown */}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {([
                    [Bold, '加粗', (): void => wrapSel('**', '**')],
                    [Heading2, '小标题', (): void => insertLine('## 小标题')],
                    [List, '要点列表', (): void => insertLine('- 要点')],
                    [Quote, '引用', (): void => insertLine('> 引用一句话')],
                    [Code, '代码', (): void => wrapSel('`', '`', 'code')],
                    [SquareCode, '代码块', (): void => insertLine('```\n代码\n```')],
                    [Link2, '链接', (): void => wrapSel('[', '](https://)', '链接文字')],
                    [Braces, '双链到另一条便签', (): void => wrapSel('[[', ']]', '便签标题')],
                    [Image, '插入图片', pickImage],
                    [Calendar, '插入今天日期', (): void => { const d = new Date(); insertLine(`**${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}**`) }]
                  ] as [LucideIcon, string, () => void][]).map(([Icon, title, fn]) => (
                    <IconButton key={title} icon={Icon} title={title} onClick={fn} size={24} color={ink(1)} />
                  ))}
                  <span style={{ flex: 1 }} />
                  <div className="hv" title="预览排版效果" onClick={() => setPreview((v) => !v)} style={{ height: 22, padding: '0 9px', borderRadius: R.sm, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: preview ? `oklch(0.45 0.1 ${h} / .5)` : fill(3), color: ink(1), fontSize: FS.tiny - 0.5, fontWeight: 700 }}>
                    {preview ? <Pencil size={10} strokeWidth={2} /> : <Eye size={10} strokeWidth={2} />}{preview ? '编辑' : '预览'}
                  </div>
                </div>
                {preview ? (
                  <div className="ai-scroll" style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 9px', ...surface.inset() }}>
                    <Markdown text={draft.md} />
                  </div>
                ) : (
                  <textarea ref={taRef} value={draft.md} onChange={(e) => setDraft((d) => d && { ...d, md: e.target.value })} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit() } else if (e.key === 'Escape') { e.stopPropagation(); setEditId(null); setDraft(null) } }} placeholder="正文…（Ctrl+Enter 保存 · Esc 取消）" rows={8} className="ai-scroll" style={{ ...inputBase, width: '100%', resize: 'none', lineHeight: 1.55, fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: FS.tiny, maxHeight: 220 }} />
                )}
                <input value={draft.tags.join(' ')} onChange={(e) => setDraft((d) => d && { ...d, tags: e.target.value.split(/[\s,，、]+/).filter(Boolean).slice(0, 4) })} placeholder="标签（空格分隔）" style={{ ...inputBase, fontSize: FS.tiny }} />
                {/* 配色盘 */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {NOTE_COLORS.map((c) => (
                    <div key={c.key} title={c.label} className="hv" onClick={() => setDraft((d) => d && { ...d, color: c.key })} style={{ width: 17, height: 17, borderRadius: R.pill, cursor: 'pointer', background: `oklch(0.6 0.13 ${c.h})`, border: draft.color === c.key ? '2px solid #fff' : '2px solid transparent', boxSizing: 'border-box' }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button sm variant="primary" icon={Check} onClick={saveEdit} style={{ flex: 1 }}>保存</Button>
                  <Button sm onClick={() => { setEditId(null); setDraft(null) }}>取消</Button>
                </div>
              </motion.div>
            )
          }
          const sel = selected.has(n.id)
          const tasks = extractTasks(n.md)
          const cover = layout === 'gallery' ? firstImage(n.md) : null
          return (
            <motion.div key={n.id} variants={fadeScaleIn} initial="initial" animate="animate" style={{ breakInside: 'avoid' }}>
            {dayHead}
            <div id={'note-' + n.id} className="ai-card" onClick={selectMode ? () => toggleSel(n.id) : undefined} style={{ ...cardStyle(h, n.pinned), cursor: selectMode ? 'pointer' : undefined, ...(sel ? { boxShadow: `0 0 0 1.5px oklch(0.85 0.14 ${h}), 0 0 0 4px oklch(0.82 0.14 ${h} / .3)` } : focusId === n.id ? { boxShadow: `0 0 0 1.5px oklch(0.82 0.14 ${h} / .9), 0 0 0 4px oklch(0.8 0.14 ${h} / .28)` } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                {selectMode && <span style={{ flex: 'none', width: 15, height: 15, borderRadius: 5, border: `1.5px solid oklch(0.7 0.1 ${h} / .6)`, background: sel ? `oklch(0.7 0.13 ${h})` : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>{sel && <Check size={9} strokeWidth={3.5} />}</span>}
                <span style={{ fontSize: 15, lineHeight: 1.2 }}>{n.emoji}</span>
                <span style={{ flex: 1, color: `oklch(0.92 0.04 ${h})`, fontSize: FS.body - 0.5, fontWeight: 700, lineHeight: 1.35 }}>{n.pinned && <Pin size={10} strokeWidth={2.25} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 3, color: `oklch(0.8 0.12 ${h})` }} />}{n.title}</span>
                {!showTrash && <span className="hv" title={n.starred ? '取消收藏' : '收藏'} onClick={(e) => { e.stopPropagation(); p.onStar(n.id) }} style={{ flex: 'none', cursor: 'pointer', color: n.starred ? sem.warn : ink(4), display: 'inline-flex', marginTop: 1 }}><Star size={12.5} strokeWidth={2} fill={n.starred ? sem.warn : 'none'} /></span>}
              </div>
              {(layout === 'grid' || layout === 'timeline') && (
                <div style={{ fontSize: FS.small }}>
                  <Collapsible collapsedHeight={110}>
                    <Markdown text={n.md} onWikiLink={jumpToTitle} />
                  </Collapsible>
                </div>
              )}
              {layout === 'list' && <div style={{ color: ink(2), fontSize: FS.tiny, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{n.md.replace(/[#*`>[\]!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}</div>}
              {layout === 'gallery' && cover && (
                <img src={cover} alt="" onClick={(e) => { e.stopPropagation(); setReadNote(n) }} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: R.sm, cursor: 'zoom-in', border: `0.5px solid ${hairline(0.1)}` }} />
              )}
              {/* 卡上任务直接勾选（便签即轻待办） */}
              {!showTrash && layout !== 'gallery' && tasks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: R.sm, background: 'rgba(0,0,0,.18)' }} onClick={(e) => e.stopPropagation()}>
                  {tasks.slice(0, 4).map((t) => (
                    <div key={t.line} className="hv" onClick={() => toggleTask(n, t.line)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <span style={{ flex: 'none', width: 12, height: 12, borderRadius: 4, border: `1.5px solid oklch(0.7 0.1 ${h} / .6)`, background: t.done ? `oklch(0.7 0.13 ${h})` : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.done && <Check size={8} strokeWidth={3.5} />}</span>
                      <span style={{ flex: 1, minWidth: 0, color: t.done ? ink(4) : ink(1), fontSize: FS.tiny - 0.5, textDecoration: t.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
                    </div>
                  ))}
                  <span style={{ color: ink(4), fontSize: 8.5 }}><Check size={8} strokeWidth={2.5} style={{ display: 'inline', verticalAlign: '-0.5px', marginRight: 2 }} />{tasks.filter((t) => t.done).length}/{tasks.length}{tasks.length > 4 ? ` · 展开看全部` : ''}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {n.tags.map((t) => (
                  <span key={t} onClick={(e) => { e.stopPropagation(); setTagFilter(tagFilter === t ? '' : t) }} style={chip(h)}># {t}</span>
                ))}
                <span style={{ marginLeft: 'auto', color: ink(4), fontSize: 9 }}>{n.md.length} 字 · {dayLabel(sortBy === 'updated' ? n.updatedAt : n.createdAt)}</span>
              </div>
              {/* 操作：回收站态 = 恢复/彻底删；正常态 = 全套 */}
              <div className="row-acts" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                {showTrash ? (
                  <>
                    <Act icon={Undo2} title="恢复" onClick={() => p.onRestore(n.id)} color={sem.calm} />
                    <Act icon={Trash2} title="彻底删除" onClick={() => p.onPurge(n.id)} color={semBg(sem.danger, 0.85)} />
                  </>
                ) : (
                  <>
                    {(() => { const bl = graph.edges.filter((e) => e.to === n.id).length; return bl > 0 ? <span title={`被 ${bl} 条便签引用（[[双链]]）`} style={{ marginRight: 'auto', fontSize: 9, color: `oklch(0.75 0.09 ${h} / .8)` }}>← {bl} 引用</span> : null })()}
                    <Act icon={Sparkles} title="AI 增强（摘要/标签/润色/翻译/行动项…）" onClick={() => setAiMenuId(aiMenuId === n.id ? null : n.id)} color={`oklch(0.85 0.12 ${h})`} busy={noteAiBusy.startsWith(n.id + ':')} />
                    <Act icon={Plus} title="灵感追加（可 AI 增强）" onClick={() => { setAppendId(appendId === n.id ? null : n.id); setAppendText('') }} color={appendId === n.id ? `oklch(0.88 0.13 ${h})` : undefined} />
                    <Act icon={Bookmark} title={n.later ? '移出稍后读' : '加入稍后读队列'} onClick={() => p.onUpdate({ ...n, later: !n.later })} color={n.later ? sem.run : ink(4)} />
                    <Act icon={Eye} title="阅读模式（大屏浮层）" onClick={() => setReadNote(n)} />
                    <Act icon={Pin} title={n.pinned ? '取消置顶' : '置顶'} onClick={() => p.onTogglePin(n.id)} />
                    <Act icon={Pencil} title={n.locked ? '已锁定：点击解锁' : '编辑'} onClick={() => { if (n.locked) { flash('🔒 便签已锁定，先点 🔒 解锁'); return } startEdit(n) }} color={n.locked ? ink(4) : undefined} />
                    <Act icon={Expand} title="在 Markdown 工作台里打开" onClick={() => p.onOpenStudio(n)} />
                    <Act icon={PictureInPicture2} title="钉到桌面（浮贴）" onClick={() => p.onPinDesktop(n)} />
                    <Act icon={ClipboardType} title="复制富文本" onClick={() => copyRich(n)} color={accent(0.8, 0.85)} />
                    <Act icon={FileCode} title="复制 Markdown 源码" onClick={() => copyMd(n)} />
                    <Act icon={Download} title="导出为 .md 文件" onClick={() => void exportOne(n)} />
                    <Act icon={Copy} title="创建副本" onClick={() => duplicate(n)} />
                    <Act icon={n.locked ? Lock : LockOpen} title={n.locked ? '解锁' : '锁定（防误编辑/误删）'} onClick={() => toggleLock(n)} color={n.locked ? sem.warn : ink(3)} />
                    <Act icon={Trash2} title={n.locked ? '已锁定，先解锁' : '移入回收站'} onClick={() => { if (n.locked) { flash('🔒 便签已锁定，先解锁再删'); return } p.onDelete(n.id) }} color={n.locked ? ink(4) : semBg(sem.danger, 0.8)} />
                  </>
                )}
              </div>
              {/* AI 增强菜单 */}
              {aiMenuId === n.id && !showTrash && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, padding: 7, borderRadius: R.md, background: 'rgba(0,0,0,.32)' }} onClick={(e) => e.stopPropagation()}>
                  {NOTE_AI.map((a) => (
                    <div key={a.key} className="hv" title={a.hint} onClick={() => void runNoteAi(n, a.key)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: R.sm, cursor: 'pointer', background: fill(1), color: ink(1), fontSize: FS.tiny - 1, fontWeight: 600 }}>
                      <a.Icon size={11} strokeWidth={1.9} style={{ flex: 'none', color: `oklch(0.85 0.1 ${h} / .85)` }} />{a.label}
                    </div>
                  ))}
                </div>
              )}
              {/* 灵感追加：直接追加 or AI 增强追加 */}
              {appendId === n.id && !showTrash && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 7, borderRadius: R.md, background: 'rgba(0,0,0,.26)' }} onClick={(e) => e.stopPropagation()}>
                  <textarea
                    autoFocus
                    value={appendText}
                    onChange={(e) => setAppendText(e.target.value)}
                    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); appendRaw(n) } else if (e.key === 'Escape') { e.stopPropagation(); setAppendId(null) } }}
                    placeholder="补一条新灵感…（Ctrl+Enter 直接追加 · Esc 取消）"
                    rows={2}
                    className="ai-scroll"
                    style={{ ...inputBase, width: '100%', resize: 'none', fontSize: FS.tiny, lineHeight: 1.5, maxHeight: 90 }}
                  />
                  <div style={{ display: 'flex', gap: 5 }}>
                    <Button sm icon={Plus} onClick={() => appendRaw(n)} style={{ flex: 1 }}>直接追加</Button>
                    <Button sm variant="primary" icon={Sparkles} onClick={() => void appendAi(n)} style={{ flex: 1 }}>{appendBusy ? '增强中…' : 'AI 增强追加'}</Button>
                  </div>
                </div>
              )}
            </div>
            </motion.div>
          )
        })}
      </div>

      {/* 阅读模式浮层：大屏舒适排版（data-solid 保证命中检测放行点击） */}
      {readNote && (
        <motion.div data-solid onMouseDown={() => setReadNote(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} style={{ position: 'fixed', inset: 0, zIndex: 230, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.08 0.02 var(--ths) / .6)', backdropFilter: 'blur(5px)' }}>
          <motion.div onMouseDown={(e) => e.stopPropagation()} variants={overlayPop} initial="initial" animate="animate" style={{ width: 'min(680px, 88vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', borderRadius: R.overlay, overflow: 'hidden', background: `linear-gradient(165deg, oklch(0.24 0.045 ${colorOf(readNote.color)} / .98), oklch(0.16 0.03 ${colorOf(readNote.color)} / .99))`, border: `0.5px solid oklch(0.65 0.11 ${colorOf(readNote.color)} / .45)`, boxShadow: '0 24px 60px -18px rgba(0,0,0,.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 18px', borderBottom: `0.5px solid ${hairline(0.09)}` }}>
              <span style={{ fontSize: 19 }}>{readNote.emoji}</span>
              <span style={{ flex: 1, ...text.title(), fontWeight: 800 }}>{readNote.title}</span>
              <span style={{ ...text.faint(), fontSize: FS.tiny - 1 }}>{readNote.md.length} 字 · {dayLabel(readNote.createdAt)}</span>
              <Act icon={Pencil} title="编辑" onClick={() => { setReadNote(null); startEdit(readNote) }} color={ink(1)} />
              <Act icon={X} title="关闭" onClick={() => setReadNote(null)} color={ink(3)} />
            </div>
            <div className="ai-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 26px 26px', fontSize: FS.subtitle, lineHeight: 1.75 }}>
              <Markdown text={readNote.md} reader onWikiLink={(t) => { setReadNote(null); jumpToTitle(t) }} />
              {readNote.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
                  {readNote.tags.map((t) => <span key={t} style={chip(colorOf(readNote.color))}># {t}</span>)}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* 闪卡复习：正面标题、点击翻面看正文（把便签当记忆卡） */}
      {flashOpen && (() => {
        const pool = p.notes.filter((n) => !n.trashed)
        if (!pool.length) return null
        const n = pool[flashIdx % pool.length]; const h = colorOf(n.color)
        return (
          <motion.div data-solid onMouseDown={() => setFlashOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} style={{ position: 'fixed', inset: 0, zIndex: 230, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'oklch(0.08 0.02 var(--ths) / .7)', backdropFilter: 'blur(6px)' }}>
            <motion.div onMouseDown={(e) => e.stopPropagation()} onClick={() => setFlashBack((v) => !v)} variants={overlayPop} initial="initial" animate="animate" style={{ width: 'min(520px, 86vw)', minHeight: 300, maxHeight: '62vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: '30px 28px', borderRadius: R.overlay, cursor: 'pointer', background: `linear-gradient(165deg, oklch(0.3 0.06 ${h} / .96), oklch(0.17 0.035 ${h} / .99))`, border: `0.5px solid oklch(0.65 0.12 ${h} / .5)`, boxShadow: '0 24px 60px -18px rgba(0,0,0,.55)' }} className="ai-scroll">
              {!flashBack ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 34 }}>{n.emoji}</div>
                  <div style={{ color: ink(1), fontSize: 20, fontWeight: 800, marginTop: 12 }}>{n.title}</div>
                  <div style={{ ...text.faint(), marginTop: 18 }}>点击卡片翻面 →</div>
                </div>
              ) : (
                <div style={{ fontSize: FS.subtitle - 0.5, lineHeight: 1.7 }}><Markdown text={n.md} reader /></div>
              )}
            </motion.div>
            <div onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <IconButton icon={ChevronLeft} size={30} color={ink(1)} onClick={() => { setFlashIdx((i) => (i - 1 + pool.length) % pool.length); setFlashBack(false) }} />
              <span style={{ ...text.num(FS.small), color: ink(2) }}>{(flashIdx % pool.length) + 1} / {pool.length}</span>
              <IconButton icon={ChevronRight} size={30} color={ink(1)} onClick={() => { setFlashIdx((i) => (i + 1) % pool.length); setFlashBack(false) }} />
              <IconButton icon={Shuffle} size={30} color={ink(1)} title="随机" onClick={() => { setFlashIdx(Math.floor(Math.random() * pool.length)); setFlashBack(false) }} />
              <Button sm onClick={() => setFlashOpen(false)} icon={X}>退出</Button>
            </div>
          </motion.div>
        )
      })()}

      {/* 放映：全屏轮播浏览便签（8s 自动翻页） */}
      {showOpen && (() => {
        const pool = filtered.length ? filtered : p.notes.filter((n) => !n.trashed)
        if (!pool.length) return null
        const n = pool[showIdx % pool.length]; const h = colorOf(n.color)
        return (
          <motion.div data-solid initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} style={{ position: 'fixed', inset: 0, zIndex: 231, display: 'flex', flexDirection: 'column', background: `radial-gradient(120% 90% at 50% 0%, oklch(0.28 0.06 ${h} / .5), oklch(0.06 0.02 var(--ths)) 70%)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px' }}>
              <span style={{ ...text.num(FS.small), color: ink(2) }}>{(showIdx % pool.length) + 1} / {pool.length}</span>
              <Button sm icon={showAuto ? Pause : Play} onClick={() => setShowAuto((v) => !v)} style={showAuto ? { color: sem.calm } : undefined}>{showAuto ? '暂停' : '自动'}</Button>
              <span style={{ flex: 1 }} />
              <Button sm icon={X} onClick={() => setShowOpen(false)}>退出放映</Button>
            </div>
            <div className="ai-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 8vw 40px' }}>
              <motion.div key={showIdx} variants={fadeScaleIn} initial="initial" animate="animate" style={{ maxWidth: 760, width: '100%' }}>
                <div style={{ fontSize: 42, textAlign: 'center' }}>{n.emoji}</div>
                <div style={{ color: ink(1), fontSize: 30, fontWeight: 900, textAlign: 'center', margin: '10px 0 26px', lineHeight: 1.3 }}>{n.title}</div>
                <div style={{ fontSize: 16, lineHeight: 1.85 }}><Markdown text={n.md} reader onWikiLink={(t) => { setShowOpen(false); jumpToTitle(t) }} /></div>
              </motion.div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '10px 0 20px' }}>
              <IconButton icon={ChevronLeft} size={34} color={ink(1)} onClick={() => setShowIdx((i) => (i - 1 + pool.length) % pool.length)} />
              <IconButton icon={ChevronRight} size={34} color={ink(1)} onClick={() => setShowIdx((i) => (i + 1) % pool.length)} />
            </div>
          </motion.div>
        )
      })()}

      {/* 金句海报预览 + 保存 */}
      {poster && (() => {
        const url = renderPoster()
        return (
          <motion.div data-solid onMouseDown={() => setPoster(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} style={{ position: 'fixed', inset: 0, zIndex: 232, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: 'oklch(0.08 0.02 var(--ths) / .7)', backdropFilter: 'blur(6px)' }}>
            <motion.img onMouseDown={(e) => e.stopPropagation()} variants={overlayPop} initial="initial" animate="animate" src={url} alt="金句海报" style={{ maxWidth: 'min(620px, 84vw)', maxHeight: '64vh', borderRadius: R.lg, boxShadow: '0 16px 50px rgba(0,0,0,.5)' }} />
            <div onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 10 }}>
              <Button icon={Copy} onClick={() => { island.copyImage(url); flash('✓ 海报已复制') }}>复制</Button>
              <Button variant="primary" icon={Save} onClick={() => { void island.saveImage(url, `金句_${poster.note.title.slice(0, 10)}`).then((r) => { if (r.ok) flash('✓ 已保存海报') }) }}>保存 PNG</Button>
              <Button onClick={() => setPoster(null)}>关闭</Button>
            </div>
          </motion.div>
        )
      })()}
    </div>
  )
}
