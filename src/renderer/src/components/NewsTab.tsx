// 资讯工作台：订阅聚合、观察清单、情报处置、AI 综合与项目沉淀。
// 逐条流水线：抓全文 → 严格评分 → 详细总结（300-500 字）→ 达标进精选；低分只留「全部」。
// 精选默认展示今天（按天时间线可回顾往日）；主题=七大分类聚合；日报按天缓存。
// 视觉层已重做至 ui/ 设计系统（tokens + components + motion），功能逻辑保持不变。

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, ArrowUpRight, Check, ChevronDown, Copy, Crosshair, ExternalLink, EyeOff, FileText, Flame, Heart, Inbox, Library, ListTodo, Newspaper, Plus, Radar, RefreshCw, Settings, Sparkles, Star, StickyNote, Tag, Telescope, X, Zap, type LucideIcon } from 'lucide-react'
import type { FeedItem, FeedSource, NewsWatch, WorkArtifact, WorkbenchProject } from '../types'
import { FEED_TAGS, parseDaily } from '../logic/rssAi'
import { intelligenceTrend, relatedItems, watchMatches } from '../logic/newsIntel'
import { Markdown, Collapsible } from './Markdown'
import { island } from '../bridge'
import { ProjectContextBar } from './ProjectContextBar'
import { Button, Chip, EmptyState, Group, IconButton, Input, Segmented, Slider, Switch } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, accent2, fill, FS, gradient, hairline, ink, MOTION, R, sem, semBg, surface, text, transition } from '../ui/tokens'

interface NewsTabProps {
  projects: WorkbenchProject[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, repoPath?: string) => void
  watches: NewsWatch[]
  onChangeWatches: (watches: NewsWatch[]) => void
  artifacts: WorkArtifact[]
  sources: FeedSource[]
  items: FeedItem[]
  refreshing: boolean
  lastRefresh: number
  aiEnrich: boolean
  onToggleAiEnrich: () => void
  minScore: number
  onSetMinScore: (n: number) => void
  interests: string
  onSetInterests: (s: string) => void
  /** 流水线状态 */
  proc: { active: boolean; current: string; done: number; total: number }
  onProcessNow: () => void
  /** 按天缓存的 AI 日报 */
  dailies: Record<string, string>
  onRefresh: () => void
  onToggleSource: (id: string) => void
  onAddSource: (name: string, url: string) => void
  onRemoveSource: (id: string) => void
  onMarkRead: (id: string) => void
  onToggleFav: (id: string) => void
  onHide: (id: string) => void
  onDaily: () => Promise<string>
  onSaveDailyToNotes: (md: string) => void
  /** 把单条资讯（详细总结）存为灵感便签 */
  onSaveItemToNotes: (it: FeedItem) => void
  onPatchItem: (id: string, patch: Partial<FeedItem>) => void
  onItemToTodo: (item: FeedItem) => void
  onSynthesize: (items: FeedItem[]) => Promise<string>
  onSaveArtifact: (title: string, content: string, sourceId: string, kind?: 'brief' | 'signal') => void
}

const pad = (n: number): string => String(n).padStart(2, '0')
const fmtHM = (ts: number): string => `${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}`
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const dayKey = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
const dayLabel = (ts: number): string => {
  const d = new Date(ts)
  const t0 = new Date(); const today = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()).getTime()
  if (ts >= today) return `今天 ${d.getMonth() + 1}月${d.getDate()}日`
  if (ts >= today - 86400000) return `昨天 ${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEK[d.getDay()]}`
}

/** AI 价值分徽标：高分走主题 accent 浅底，其余中性墨色阶梯 */
const scoreStyle = (s?: number): React.CSSProperties => {
  const hi = s !== undefined && s >= 75
  const mid = s !== undefined && s >= 60
  return {
    flex: 'none', minWidth: 24, textAlign: 'center', padding: '1.5px 6px', borderRadius: R.sm,
    fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
    background: hi ? semBg(accent(), 0.16) : mid ? fill(2) : fill(1),
    border: `0.5px solid ${hi ? accent(0.7, 0.32) : 'transparent'}`,
    color: s === undefined ? ink(3) : hi ? accent(0.88) : mid ? ink(2) : ink(3)
  }
}

/** 结构化日报 → Markdown（存便签/复制用） */
const dailyToMd = (stored: string): string => {
  const r = parseDaily(stored)
  if (!r) return stored
  return `${r.intro}\n\n${r.highlights.map((h, i) => `## ${i + 1}. ${h.headline}\n${h.insight}`).join('\n\n')}\n\n> 🔭 ${r.outlook}`
}

type View = 'picks' | 'signals' | 'radar' | 'all' | 'daily' | 'topics' | 'favs'
const VIEWS: { key: View; label: string; icon: LucideIcon }[] = [
  { key: 'picks', label: '精选', icon: Star },
  { key: 'signals', label: '信号', icon: Activity },
  { key: 'radar', label: '雷达', icon: Radar },
  { key: 'all', label: '全部', icon: Inbox },
  { key: 'daily', label: '日报', icon: Newspaper },
  { key: 'topics', label: '主题', icon: Tag },
  { key: 'favs', label: '收藏', icon: Heart }
]

export function NewsTab(p: NewsTabProps): React.JSX.Element {
  const [view, setView] = useState<View>('picks')
  const [topicTag, setTopicTag] = useState('模型')
  const [manage, setManage] = useState(false)
  const [srcName, setSrcName] = useState('')
  const [srcUrl, setSrcUrl] = useState('')
  const [dailyBusy, setDailyBusy] = useState(false)
  const [dailyErr, setDailyErr] = useState('')
  const [savedTip, setSavedTip] = useState(false)
  const [expandId, setExpandId] = useState<string | null>(null)
  const [interestDraft, setInterestDraft] = useState(p.interests)
  const [dayFilter, setDayFilter] = useState('all') // 'all' 或 dayKey：浏览指定日期
  const [flashId, setFlashId] = useState<string | null>(null) // 日报定位时的高亮
  const [savedItemId, setSavedItemId] = useState<string | null>(null)
  const [showWatches, setShowWatches] = useState(false)
  const [watchDraft, setWatchDraft] = useState({ name: '', keywords: '', excludes: '', minScore: 60 })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [synthesisBusy, setSynthesisBusy] = useState(false)
  const [synthesis, setSynthesis] = useState('')

  const t0 = new Date()
  const todayTs = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()).getTime()
  const todayKey = dayKey(Date.now())

  // 精选池 = 过阈值的高质量条目（收藏永远保留）
  const picks = useMemo(() => p.items.filter((i) => i.fav || (i.score !== undefined && i.score >= p.minScore)), [p.items, p.minScore])
  const watchMap = useMemo(() => watchMatches(p.items, p.watches), [p.items, p.watches])
  const trend = useMemo(() => intelligenceTrend(p.items, 7), [p.items])
  const activeProject = useMemo(() => p.projects.find((project) => project.id === p.activeProjectId), [p.projects, p.activeProjectId])
  const unprocessed = p.items.filter((i) => !i.processed).length

  // 今日热点 TOP3（精选内按分）
  const top3 = useMemo(() => picks.filter((i) => i.pubDate >= todayTs && i.score !== undefined).sort((a, b) => b.score! - a.score!).slice(0, 3), [picks, todayTs])

  // 当前视图的数据集（dayFilter 可只看某一天，浏览历史）
  const listData = useMemo(() => {
    let list: FeedItem[]
    if (view === 'picks') list = picks
    else if (view === 'signals') list = p.items.filter((item) => item.signalStatus === 'tracking' || item.signalStatus === 'actioned' || watchMap.has(item.id)).filter((item) => !p.activeProjectId || item.projectIds?.includes(p.activeProjectId) || (watchMap.get(item.id) || []).some((id) => p.watches.find((watch) => watch.id === id)?.projectId === p.activeProjectId))
    else if (view === 'all') list = p.items
    else if (view === 'favs') list = p.items.filter((i) => i.fav)
    else if (view === 'topics') list = picks.filter((i) => (i.tag || '其它') === topicTag)
    else list = []
    if (dayFilter !== 'all') list = list.filter((i) => dayKey(i.pubDate) === dayFilter)
    return [...list].sort((a, b) => b.pubDate - a.pubDate)
  }, [view, picks, p.items, p.activeProjectId, p.watches, watchMap, topicTag, dayFilter])

  // 可浏览的日期（库里实际存在的天）
  const availableDays = useMemo(() => {
    const set = new Map<string, number>()
    for (const i of p.items) { const k = dayKey(i.pubDate); if (!set.has(k)) set.set(k, i.pubDate) }
    return [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  }, [p.items])

  // 日报"→ 定位"：切到条目实际所在的视图（精选池里就去精选，否则落到全部，保证一定能定位到）
  // + 展开该条 + 平滑滚动 + 高亮闪烁
  const jumpToItem = (id: string): void => {
    setView(picks.some((i) => i.id === id) ? 'picks' : 'all')
    setDayFilter('all')
    setTimeout(() => setLimit(1000), 0) // 目标条目可能在首屏 30 条之外——放开增量渲染上限再定位（等 view 切换后的 reset 先跑）
    setExpandId(id)
    p.onMarkRead(id)
    setFlashId(id)
    setTimeout(() => document.getElementById('feed-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
    setTimeout(() => setFlashId(null), 2600)
  }

  // 增量渲染：首屏只挂载 30 条（每条都带 Markdown/折叠，全量挂载几百条会让切标签卡一大帧、出现半绘制）
  const [limit, setLimit] = useState(30)
  useEffect(() => { setLimit(30) }, [view, topicTag, dayFilter])
  const visibleData = useMemo(() => listData.slice(0, limit), [listData, limit])

  // 按天分组（精选/全部/主题/收藏都走时间线，可回顾往日）
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: FeedItem[] }>()
    for (const it of visibleData) {
      const k = dayKey(it.pubDate)
      if (!map.has(k)) map.set(k, { key: k, label: dayLabel(it.pubDate), items: [] })
      map.get(k)!.items.push(it)
    }
    return [...map.values()]
  }, [visibleData])

  const genDaily = (): void => {
    if (dailyBusy) return
    setDailyBusy(true)
    setDailyErr('')
    void p.onDaily().then((md) => { setDailyBusy(false); if (md.startsWith('✗')) setDailyErr(md) })
  }

  const toggleExpand = (it: FeedItem): void => {
    const next = expandId === it.id ? null : it.id
    setExpandId(next)
    if (next) p.onMarkRead(it.id)
  }

  const addWatch = (): void => {
    const keywords = watchDraft.keywords.split(/[,，\s]+/).map((word) => word.trim()).filter(Boolean)
    if (!watchDraft.name.trim() || !keywords.length) return
    p.onChangeWatches([...p.watches, { id: `watch-${Date.now()}`, name: watchDraft.name.trim().slice(0, 40), keywords, excludes: watchDraft.excludes.split(/[,，\s]+/).map((word) => word.trim()).filter(Boolean), projectId: p.activeProjectId || undefined, minScore: watchDraft.minScore, enabled: true, createdAt: Date.now() }])
    setWatchDraft({ name: '', keywords: '', excludes: '', minScore: 60 })
  }

  const toggleSelected = (id: string): void => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else if (next.size < 8) next.add(id)
    return next
  })

  const runSynthesis = async (): Promise<void> => {
    const selected = p.items.filter((item) => selectedIds.has(item.id))
    if (selected.length < 2 || synthesisBusy) return
    setSynthesisBusy(true)
    const result = await p.onSynthesize(selected)
    setSynthesisBusy(false)
    setSynthesis(result)
  }

  /* ---- 图文日报渲染：hero 导语 + 编号要点卡（来源 + → 定位精选）+ 展望；旧纯文本日报兜底 ---- */
  const renderDaily = (stored: string, rich: boolean): React.JSX.Element => {
    const report = parseDaily(stored)
    if (!report) return <div style={{ padding: 12, ...surface.card() }}><Markdown text={stored} /></div>
    const d = new Date()
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Hero：日期 + 导语 */}
        <div style={{ padding: '14px 15px', borderRadius: R.lg, background: `linear-gradient(135deg, ${semBg(accent(), 0.18)}, ${semBg(accent2(), 0.09)})`, border: `0.5px solid ${accent(0.7, 0.25)}` }}>
          {rich && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
              <span style={{ color: ink(1), fontSize: FS.big, fontWeight: 700, letterSpacing: '-0.022em' }}>{d.getMonth() + 1} 月 {d.getDate()} 日</span>
              <span style={{ color: accent(0.82, 0.85), fontSize: FS.tiny, fontWeight: 700, letterSpacing: '.15em' }}>AI 日报</span>
            </div>
          )}
          <div style={{ color: ink(1), fontSize: FS.body, lineHeight: 1.7 }}>{report.intro}</div>
        </div>
        {/* 要点卡片 */}
        {report.highlights.map((h, i) => {
          const src = p.items.find((x) => x.id === h.id)
          return (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', ...surface.card() }}>
              <span style={{ flex: 'none', width: 22, height: 22, borderRadius: R.sm, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, background: gradient.brand(), color: gradient.onPrimary() }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: ink(1), fontSize: FS.body, fontWeight: 800, lineHeight: 1.4 }}>{h.headline}</div>
                <div style={{ color: ink(2), fontSize: FS.small, lineHeight: 1.65, marginTop: 4 }}>{h.insight}</div>
                {src && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: ink(3), fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                      <FileText size={10} strokeWidth={1.75} style={{ flex: 'none' }} />{src.title}
                    </span>
                    {src.score !== undefined && <span style={scoreStyle(src.score)}>{src.score}</span>}
                    <Chip icon={ArrowUpRight} onClick={() => jumpToItem(src.id)} style={{ padding: '2.5px 9px', fontSize: 9.5 }}>定位到精选</Chip>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {report.outlook && (
          <div style={{ ...surface.inset(), padding: '9px 13px', display: 'flex', alignItems: 'flex-start', gap: 7, color: accent(0.8, 0.85), fontSize: FS.small, fontStyle: 'italic', lineHeight: 1.6 }}>
            <Telescope size={12} strokeWidth={1.75} style={{ flex: 'none', marginTop: 2 }} />
            <span>{report.outlook}</span>
          </div>
        )}
      </div>
    )
  }

  /* ---- 条目渲染（精选/全部/主题/收藏共用） ---- */
  const renderItem = (it: FeedItem): React.JSX.Element => {
    const open = expandId === it.id
    const flash = flashId === it.id
    const tracking = it.signalStatus === 'tracking'
    return (
      <motion.div
        key={it.id}
        id={'feed-' + it.id}
        variants={fadeScaleIn}
        initial={false}
        animate="animate"
        className={open ? undefined : 'msg ai-card'}
        style={{
          borderRadius: R.lg,
          background: flash ? semBg(accent(), 0.16) : open ? semBg(accent(), 0.07) : fill(1),
          border: flash ? `0.5px solid ${accent(0.75, 0.5)}` : open ? `0.5px solid ${accent(0.7, 0.3)}` : 'none',
          opacity: it.read && !open ? 0.62 : 1,
          transition: transition('background, border-color, opacity', MOTION.base),
          overflow: 'hidden'
        }}
      >
        <div className="msg" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px', cursor: 'pointer' }} onClick={() => toggleExpand(it)}>
          <span style={{ flex: 'none', ...text.mono(9.5), color: ink(3), fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtHM(it.pubDate)}</span>
          <span title="AI 价值分（按你的口味严格评审）" style={scoreStyle(it.score)}>{it.score ?? '…'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: it.read && !open ? ink(2) : ink(1), fontSize: FS.body - 0.5, fontWeight: 600, lineHeight: 1.45, wordBreak: 'break-word' }}>
              {it.fav && <Star size={11} strokeWidth={2} style={{ color: sem.warn, fill: sem.warn, verticalAlign: -1.5, marginRight: 4 }} />}{it.title}
            </div>
            {it.brief && <div style={{ color: ink(2), fontSize: FS.tiny, lineHeight: 1.5, marginTop: 2 }}>{it.brief}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3, fontSize: 9, color: ink(3) }}>
              <span>{it.sourceName}</span>
              {it.tag && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Tag size={8.5} strokeWidth={2} />{it.tag}</span>}
              {it.summary && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2.5, color: accent(0.82, 0.75) }}><Sparkles size={9} strokeWidth={2} />有详细总结</span>}
              {watchMap.has(it.id) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2.5, color: sem.calm }}><Crosshair size={9} strokeWidth={2} />命中 {watchMap.get(it.id)?.length} 个观察</span>}
              {it.signalStatus && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: it.signalStatus === 'actioned' ? sem.calm : tracking ? sem.run : ink(3) }}>
                  <span style={{ width: 4, height: 4, borderRadius: 999, background: 'currentColor', boxShadow: it.signalStatus === 'dismissed' ? 'none' : `0 0 5px currentColor` }} />
                  {it.signalStatus === 'actioned' ? '已行动' : tracking ? '跟踪中' : '已忽略'}
                </span>
              )}
            </div>
          </div>
          <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none', marginTop: 2 }}>
            <span className="hv" title={selectedIds.has(it.id) ? '移出综合选择' : '加入多条综合（最多 8 条）'} onClick={(e) => { e.stopPropagation(); toggleSelected(it.id) }} style={{ cursor: 'pointer', width: 13, height: 13, borderRadius: 4, border: `0.5px solid ${selectedIds.has(it.id) ? accent(0.75) : hairline(0.35)}`, background: selectedIds.has(it.id) ? accent(0.75) : 'transparent', color: gradient.onPrimary(), display: 'flex', alignItems: 'center', justifyContent: 'center', transition: transition('background, border-color') }}>
              {selectedIds.has(it.id) && <Check size={9} strokeWidth={3.5} />}
            </span>
            <span className="hv" title={it.fav ? '取消收藏' : '收藏'} onClick={(e) => { e.stopPropagation(); p.onToggleFav(it.id) }} style={{ cursor: 'pointer', display: 'inline-flex', color: it.fav ? sem.warn : ink(3) }}>
              <Star size={12} strokeWidth={1.75} style={{ fill: it.fav ? sem.warn : 'none' }} />
            </span>
            <span className="hv" title="隐藏这条" onClick={(e) => { e.stopPropagation(); p.onHide(it.id) }} style={{ cursor: 'pointer', display: 'inline-flex', color: ink(3) }}>
              <EyeOff size={12} strokeWidth={1.75} />
            </span>
          </div>
          <span style={{ flex: 'none', display: 'inline-flex', color: ink(3), marginTop: 4, transform: open ? 'rotate(180deg)' : 'none', transition: transition('transform', MOTION.fast) }}>
            <ChevronDown size={11} strokeWidth={2} />
          </span>
        </div>
        {open && (
          <div style={{ padding: '0 12px 11px 44px', display: 'flex', flexDirection: 'column', gap: 8, animation: 'ai-fadein .2s ease' }}>
            {it.summary ? (
              <div style={{ padding: '9px 11px', borderRadius: R.md, background: semBg(accent(), 0.07), border: `0.5px solid ${accent(0.65, 0.22)}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: accent(0.88), fontSize: 10, fontWeight: 800, marginBottom: 5 }}>
                  <Sparkles size={11} strokeWidth={2} />AI 详细总结（基于全文）
                </div>
                <div style={{ fontSize: FS.small }}>
                  <Collapsible collapsedHeight={220}>
                    <Markdown text={it.summary} />
                  </Collapsible>
                </div>
              </div>
            ) : it.desc ? (
              <div style={{ ...surface.inset(), padding: '7px 10px', color: ink(2), fontSize: FS.tiny, lineHeight: 1.6 }}>
                <span style={{ opacity: 0.55, fontWeight: 700 }}>原文摘要　</span>{it.desc}
                <div style={{ marginTop: 5, fontSize: 9.5, color: it.processed ? ink(3) : sem.warn }}>{it.processed ? '（低于阈值，未生成详细总结）' : '排队等流水线处理（抓全文 → 评分 → 详细总结）'}</div>
              </div>
            ) : (
              <div style={{ color: it.processed ? ink(3) : sem.warn, fontSize: FS.tiny }}>{it.processed ? '（无摘要）' : '排队等流水线处理…'}</div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip active icon={ExternalLink} onClick={() => island.openExternal(it.link)} style={{ padding: '5px 13px' }}>打开原文</Chip>
              {it.summary && (
                <Chip icon={savedItemId === it.id ? Check : StickyNote} active={savedItemId === it.id} onClick={() => { p.onSaveItemToNotes(it); setSavedItemId(it.id); setTimeout(() => setSavedItemId(null), 2000) }}>
                  {savedItemId === it.id ? '已存' : '添加到灵感便签'}
                </Chip>
              )}
              <Chip icon={Copy} onClick={() => navigator.clipboard?.writeText(`${it.title}\n${it.link}`).catch(() => {})}>复制链接</Chip>
              <Chip icon={Crosshair} color={sem.run} active={tracking} onClick={() => p.onPatchItem(it.id, { signalStatus: tracking ? undefined : 'tracking', projectIds: p.activeProjectId ? [...new Set([...(it.projectIds || []), p.activeProjectId])] : it.projectIds })}>{tracking ? '跟踪中' : '跟踪信号'}</Chip>
              <Chip icon={ListTodo} color={sem.calm} onClick={() => p.onItemToTodo(it)}>转待办</Chip>
              <Chip icon={Library} onClick={() => p.onSaveArtifact(it.title, `${it.summary || it.brief || it.desc || ''}\n\n来源：[${it.sourceName}](${it.link})`, it.id, 'signal')}>存项目情报</Chip>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ ...text.faint(), fontSize: 9 }}>影响</span>
              {(['low', 'medium', 'high'] as const).map((impact) => <Chip key={impact} active={it.impact === impact} color={impact === 'high' ? sem.warn : undefined} onClick={() => p.onPatchItem(it.id, { impact })} style={{ padding: '2px 8px', fontSize: 9 }}>{impact === 'low' ? '低' : impact === 'medium' ? '中' : '高'}</Chip>)}
              <span style={{ ...text.faint(), fontSize: 9, marginLeft: 5 }}>时间</span>
              {(['now', 'soon', 'later'] as const).map((horizon) => <Chip key={horizon} active={it.horizon === horizon} onClick={() => p.onPatchItem(it.id, { horizon })} style={{ padding: '2px 8px', fontSize: 9 }}>{horizon === 'now' ? '立即' : horizon === 'soon' ? '近期' : '观察'}</Chip>)}
            </div>
            {relatedItems(it, p.items, 3).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ flex: 'none', ...text.faint(), fontSize: 9 }}>相关</span>
                {relatedItems(it, p.items, 3).map((related) => (
                  <button key={related.id} type="button" className="hv" onClick={() => jumpToItem(related.id)} title={related.title} style={{ minWidth: 0, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '3px 8px', borderRadius: R.sm, border: 'none', background: fill(1), color: ink(2), cursor: 'pointer', fontFamily: 'inherit', fontSize: 9 }}>{related.title}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </motion.div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ProjectContextBar projects={p.projects} activeProjectId={p.activeProjectId} onSelect={p.onSelectProject} onCreate={p.onCreateProject} label="情报项目" detail="观察清单、跟踪信号、简报和行动项使用当前项目归属" />
      {/* 资讯消费、情报处置与趋势复盘视图 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div className="ai-scroll" style={{ maxWidth: '100%', overflowX: 'auto' }}>
          <Segmented options={VIEWS} value={view} onChange={setView} />
        </div>
        <span style={{ flex: 1 }} />
        <Chip icon={Crosshair} active={showWatches} onClick={() => setShowWatches((value) => !value)} title="管理关键词观察清单">观察 {p.watches.filter((watch) => watch.enabled).length}</Chip>
        <Chip onClick={p.onRefresh} title="拉取订阅源">
          {p.refreshing && <RefreshCw size={11} strokeWidth={2} style={{ animation: 'ai-ring 1s linear infinite' }} />}
          {p.refreshing ? '拉取中' : p.lastRefresh ? fmtHM(p.lastRefresh) : '刷新'}
        </Chip>
        <IconButton icon={Settings} active={manage} onClick={() => setManage((v) => !v)} title="源与口味管理" />
      </div>

      {showWatches && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 11, ...surface.section() }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,.7fr) minmax(150px,1.2fr) minmax(110px,.8fr) 72px auto', gap: 6, alignItems: 'center' }}>
            <Input value={watchDraft.name} onChange={(v) => setWatchDraft((draft) => ({ ...draft, name: v }))} placeholder="观察名称" />
            <Input value={watchDraft.keywords} onChange={(v) => setWatchDraft((draft) => ({ ...draft, keywords: v }))} placeholder="关键词，逗号分隔" />
            <Input value={watchDraft.excludes} onChange={(v) => setWatchDraft((draft) => ({ ...draft, excludes: v }))} placeholder="排除词（可选）" />
            <input type="number" min={0} max={100} value={watchDraft.minScore} onChange={(e) => setWatchDraft((draft) => ({ ...draft, minScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} title="最低价值分" style={{ ...surface.inset(), boxSizing: 'border-box', width: '100%', height: 32, color: ink(1), outline: 'none', padding: '0 9px', fontFamily: 'inherit', fontSize: FS.small }} />
            <Button sm variant="primary" icon={Plus} onClick={addWatch} disabled={!watchDraft.name.trim() || !watchDraft.keywords.trim()} style={{ height: 32 }}>创建观察</Button>
          </div>
          {p.watches.length > 0 && (
            <Group>
              {p.watches.map((watch) => {
                const hits = [...watchMap.values()].filter((ids) => ids.includes(watch.id)).length
                return (
                  <div key={watch.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
                    <Switch on={watch.enabled} onChange={() => p.onChangeWatches(p.watches.map((item) => item.id === watch.id ? { ...item, enabled: !item.enabled } : item))} />
                    <span style={{ color: ink(1), fontSize: FS.tiny, fontWeight: 700 }}>{watch.name}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ink(3), fontSize: 9.5 }}>{watch.keywords.join(' · ')}</span>
                    {watch.projectId && <span style={{ color: sem.calm, fontSize: 9 }}>{p.projects.find((project) => project.id === watch.projectId)?.name || '未知项目'}</span>}
                    <span style={{ color: sem.warn, fontSize: 9.5, fontVariantNumeric: 'tabular-nums' }}>命中 {hits}</span>
                    <IconButton icon={X} size={22} color={sem.danger} onClick={() => p.onChangeWatches(p.watches.filter((item) => item.id !== watch.id))} title="删除观察" />
                  </div>
                )
              })}
            </Group>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: R.md, background: semBg(sem.focus, 0.12), border: `0.5px solid ${semBg(sem.focus, 0.3)}` }}>
          <span style={{ color: sem.focus, fontSize: FS.tiny, fontWeight: 700 }}>已选 {selectedIds.size} 条</span>
          <span style={{ flex: 1 }} />
          <Button sm variant="primary" icon={Sparkles} onClick={() => void runSynthesis()} disabled={selectedIds.size < 2 || synthesisBusy}>{synthesisBusy ? '综合中…' : 'AI 多源综合'}</Button>
          <Button sm variant="ghost" onClick={() => { setSelectedIds(new Set()); setSynthesis('') }}>清除</Button>
        </div>
      )}
      {synthesis && (
        <div style={{ padding: '10px 11px', ...surface.card() }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <span style={{ color: sem.focus, fontSize: FS.small, fontWeight: 750 }}>多源情报简报</span>
            <span style={{ flex: 1 }} />
            <Button sm variant="ghost" icon={Library} onClick={() => p.onSaveArtifact(`${activeProject?.name || '未归属'} · 多源情报简报`, synthesis, [...selectedIds].join(','), 'brief')}>保存简报</Button>
          </div>
          <Collapsible collapsedHeight={260}><Markdown text={synthesis} /></Collapsible>
        </div>
      )}

      {/* 流水线状态条：一条一条处理，处理完即时进精选 */}
      {(p.proc.active || unprocessed > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', borderRadius: R.md, background: semBg(accent(), 0.08), border: `0.5px solid ${accent(0.7, 0.25)}` }}>
          {p.proc.active ? (
            <>
              <span style={{ display: 'inline-block', width: 11, height: 11, border: `2px solid ${accent(0.7, 0.25)}`, borderTopColor: accent(0.8), borderRadius: 999, animation: 'ai-ring .8s linear infinite', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ink(1), fontSize: FS.small }}>
                逐条审稿中 {p.proc.done + 1}/{p.proc.total} · {p.proc.current}
              </span>
            </>
          ) : (
            <>
              <span style={{ flex: 1, color: ink(2), fontSize: FS.small }}>还有 {unprocessed} 条待审（抓全文 → 严格评分 → 详细总结）</span>
              <Button sm variant="primary" icon={Zap} onClick={p.onProcessNow}>继续处理</Button>
            </>
          )}
        </div>
      )}

      {/* 源与口味管理 */}
      {manage && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, ...surface.section() }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {p.sources.map((s) => (
              <Chip key={s.id} active={s.enabled} onClick={() => p.onToggleSource(s.id)} title={s.url}>
                {s.name}
                {s.id.startsWith('u') && (
                  <span className="hv" onClick={(e) => { e.stopPropagation(); p.onRemoveSource(s.id) }} style={{ display: 'inline-flex', opacity: 0.65 }}>
                    <X size={9} strokeWidth={2.5} />
                  </span>
                )}
              </Chip>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Input value={srcName} onChange={setSrcName} placeholder="源名称" style={{ width: 116 }} />
            <Input value={srcUrl} onChange={setSrcUrl} placeholder="RSS/Atom 链接（技术博客也行）" style={{ flex: 1 }} />
            <IconButton icon={Plus} size={32} active={!!srcUrl.trim()} onClick={() => { if (srcUrl.trim()) { p.onAddSource(srcName.trim() || '自定义源', srcUrl.trim()); setSrcName(''); setSrcUrl('') } }} title="添加订阅源" />
          </div>
          <div style={{ ...text.dim(), fontWeight: 700 }}>我的口味（AI 按此严格评审）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <textarea value={interestDraft} onChange={(e) => setInterestDraft(e.target.value)} rows={2} className="ai-scroll" style={{ ...surface.inset(), flex: 1, color: ink(1), fontSize: FS.small, lineHeight: 1.5, padding: '7px 10px', outline: 'none', resize: 'none', fontFamily: 'inherit', maxHeight: 64 }} />
            {interestDraft.trim() !== p.interests && <Button sm variant="primary" onClick={() => p.onSetInterests(interestDraft.trim())} style={{ alignSelf: 'flex-start' }}>保存</Button>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ ...text.dim(), flex: 'none' }}>精选门槛 <b style={{ color: accent() }}>{p.minScore}</b> 分</span>
            <div style={{ flex: 1, minWidth: 110 }}><Slider min={40} max={85} step={5} value={p.minScore} onChange={p.onSetMinScore} /></div>
            <span style={{ ...text.dim(), flex: 'none' }}>AI 流水线</span>
            <Switch on={p.aiEnrich} onChange={() => p.onToggleAiEnrich()} />
          </div>
          <div style={{ ...text.faint(), lineHeight: 1.5 }}>逐条处理需调用问答模型（每条约 1-2 次调用：抓全文+评审）。低于门槛的只出现在「全部」，不进精选。</div>
        </div>
      )}

      {view === 'radar' && (() => {
        const max = Math.max(1, ...trend.map((point) => point.total))
        const tagTotals = FEED_TAGS.map((tag) => ({ tag, count: trend.reduce((sum, point) => sum + (point.tags[tag] || 0), 0) })).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count)
        const projectArtifacts = p.artifacts.filter((artifact) => artifact.source === 'news' && (!p.activeProjectId || artifact.projectId === p.activeProjectId)).slice(0, 8)
        return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(180px,.7fr)', gap: 9 }}>
            <div style={{ padding: '11px 12px', ...surface.card() }}>
              <div style={{ ...text.overline(), marginBottom: 10 }}>7 日信号强度</div>
              <div style={{ height: 105, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                {trend.map((point) => (
                  <div key={point.day} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    <span style={{ color: ink(3), fontSize: 8, fontVariantNumeric: 'tabular-nums' }}>{point.total}</span>
                    <div title={`高价值 ${point.high}`} style={{ width: '70%', minHeight: 3, height: `${Math.max(3, point.total / max * 72)}px`, borderRadius: 4, background: point.high ? `linear-gradient(180deg, ${sem.calm}, ${semBg(sem.calm, 0.45)})` : `linear-gradient(180deg, ${accent(0.78)}, ${accent(0.48)})` }} />
                    <span style={{ color: ink(3), fontSize: 8 }}>{point.day}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '11px 12px', ...surface.card() }}>
              <div style={{ ...text.overline(), marginBottom: 9 }}>主题热度</div>
              {tagTotals.slice(0, 7).map((entry) => (
                <div key={entry.tag} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                  <span style={{ width: 42, color: ink(2), fontSize: 9 }}>{entry.tag}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: R.pill, background: fill(2), overflow: 'hidden' }}>
                    <div style={{ width: `${entry.count / Math.max(1, tagTotals[0]?.count || 1) * 100}%`, height: '100%', borderRadius: R.pill, background: sem.warn }} />
                  </div>
                  <span style={{ color: ink(3), fontSize: 8.5, fontVariantNumeric: 'tabular-nums' }}>{entry.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <div style={{ padding: '10px 11px', ...surface.inset() }}>
              <div style={{ color: sem.calm, fontSize: FS.tiny, fontWeight: 750, marginBottom: 6 }}>观察命中</div>
              {p.watches.filter((watch) => watch.enabled && (!p.activeProjectId || watch.projectId === p.activeProjectId)).map((watch) => (
                <div key={watch.id} style={{ display: 'flex', gap: 6, padding: '3px 0', fontSize: 9.5 }}>
                  <span style={{ flex: 1, color: ink(2) }}>{watch.name}</span>
                  <span style={{ color: sem.warn, fontVariantNumeric: 'tabular-nums' }}>{[...watchMap.values()].filter((ids) => ids.includes(watch.id)).length}</span>
                </div>
              ))}
              {p.watches.length === 0 && <span style={{ color: ink(3), fontSize: 9.5 }}>暂无观察清单</span>}
            </div>
            <div style={{ padding: '10px 11px', ...surface.inset() }}>
              <div style={{ color: sem.focus, fontSize: FS.tiny, fontWeight: 750, marginBottom: 6 }}>项目情报资产 · {projectArtifacts.length}</div>
              {projectArtifacts.map((artifact) => (
                <div key={artifact.id} title={artifact.content} style={{ display: 'flex', gap: 6, padding: '3px 0', fontSize: 9.5 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ink(2) }}>{artifact.title}</span>
                  <span style={{ color: ink(3) }}>{artifact.kind === 'brief' ? '简报' : '信号'}</span>
                </div>
              ))}
              {projectArtifacts.length === 0 && <span style={{ color: ink(3), fontSize: 9.5 }}>尚未沉淀项目情报</span>}
            </div>
          </div>
        </div>
      })()}

      {/* ===== 日报视图 ===== */}
      {view === 'daily' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Newspaper size={14} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
            <span style={text.subtitle()}>AI 日报</span>
            <span style={{ flex: 1 }} />
            {p.dailies[todayKey] && !dailyBusy && (
              <>
                <Chip icon={savedTip ? Check : StickyNote} active={savedTip} onClick={() => { p.onSaveDailyToNotes(dailyToMd(p.dailies[todayKey])); setSavedTip(true); setTimeout(() => setSavedTip(false), 2000) }}>{savedTip ? '已存' : '存为灵感便签'}</Chip>
                <IconButton icon={Copy} onClick={() => navigator.clipboard?.writeText(dailyToMd(p.dailies[todayKey])).catch(() => {})} title="复制日报 Markdown" />
              </>
            )}
            <Button sm variant="primary" icon={p.dailies[todayKey] && !dailyBusy ? RefreshCw : Sparkles} onClick={genDaily}>{dailyBusy ? '生成中…' : p.dailies[todayKey] ? '重新生成' : '生成今日日报'}</Button>
          </div>
          {dailyErr && <div style={{ color: sem.danger, fontSize: FS.small }}>{dailyErr}</div>}
          {p.dailies[todayKey] ? renderDaily(p.dailies[todayKey], true) : !dailyBusy && !dailyErr ? (
            <div style={{ ...text.dim(), padding: '14px 4px' }}>基于今天精选中的高分内容生成一份图文日报（导语 + 要点卡片 + 来源直达 + 展望）。</div>
          ) : null}
          {/* 往日日报回顾 */}
          {Object.keys(p.dailies).filter((k) => k !== todayKey).sort().reverse().slice(0, 7).map((k) => (
            <div key={k} style={{ padding: 12, ...surface.card() }}>
              <div style={{ ...text.overline(), marginBottom: 7 }}>{k.split('-').slice(1).join('/')} 日报</div>
              <Collapsible collapsedHeight={110}>{renderDaily(p.dailies[k], false)}</Collapsible>
            </div>
          ))}
        </div>
      )}

      {/* 日期导航：只抓当天，但已入库的往日可回顾 */}
      {view !== 'daily' && view !== 'radar' && availableDays.length > 1 && (
        <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
          <Chip active={dayFilter === 'all'} onClick={() => setDayFilter('all')}>全部日期</Chip>
          {availableDays.map(([k, ts]) => (
            <Chip key={k} active={dayFilter === k} onClick={() => setDayFilter(dayFilter === k ? 'all' : k)}>
              {k === todayKey ? '今天' : `${new Date(ts).getMonth() + 1}/${new Date(ts).getDate()}`}
            </Chip>
          ))}
        </div>
      )}

      {/* ===== 主题视图：分类聚合（精选池内） ===== */}
      {view === 'topics' && (
        <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
          {FEED_TAGS.map((t) => {
            const n = picks.filter((i) => (i.tag || '其它') === t).length
            return <Chip key={t} active={topicTag === t} onClick={() => setTopicTag(t)}>{t}{n > 0 && <span style={{ opacity: 0.65, marginLeft: 2, fontVariantNumeric: 'tabular-nums' }}>{n}</span>}</Chip>
          })}
        </div>
      )}

      {/* ===== 精选视图：今日热点 TOP ===== */}
      {view === 'picks' && top3.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 3px' }}>
            <Flame size={12} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
            <span style={{ ...text.overline(), color: accent(0.85, 0.9) }}>今日热点 TOP</span>
            <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
          </div>
          {top3.map((it, i) => (
            <motion.div
              key={it.id}
              variants={fadeScaleIn}
              initial={false}
              animate="animate"
              className="hv ai-card"
              onClick={() => toggleExpand(it)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', cursor: 'pointer', background: `linear-gradient(135deg, ${semBg(accent(), 0.13)}, ${semBg(accent2(), 0.06)})`, border: `0.5px solid ${accent(0.65, 0.25)}`, borderRadius: R.lg }}
            >
              <span style={{ flex: 'none', fontSize: 15, fontWeight: 900, color: accent(0.85 - i * 0.08), fontStyle: 'italic', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: ink(1), fontSize: FS.body, fontWeight: 700, lineHeight: 1.4 }}>{it.title}</div>
                {it.brief && <div style={{ color: ink(2), fontSize: FS.tiny, lineHeight: 1.5, marginTop: 3 }}>{it.brief}</div>}
                <div style={{ display: 'flex', gap: 7, marginTop: 4, fontSize: 9, color: ink(3) }}>
                  <span>{it.sourceName}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHM(it.pubDate)}</span>{it.tag && <span># {it.tag}</span>}
                </div>
              </div>
              <span style={scoreStyle(it.score)}>{it.score}</span>
            </motion.div>
          ))}
        </div>
      )}

      {/* 空态 */}
      {view !== 'daily' && view !== 'radar' && listData.length === 0 && (
        <EmptyState
          icon={view === 'favs' ? Star : Radar}
          title={view === 'favs' ? '还没有收藏' : view === 'picks' ? (p.items.length ? '精选还在路上——流水线正在逐条审稿' : '还没有资讯') : '暂无内容'}
          desc={view === 'picks' && p.items.length === 0 ? '点右上角刷新按钮拉取订阅源' : undefined}
        />
      )}

      {/* 时间线（按天，可回顾往日） */}
      {view !== 'daily' && view !== 'radar' && grouped.map((g) => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 3px 0' }}>
            <span style={text.overline()}>{g.label}</span>
            <span style={{ ...text.faint(), fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>{g.items.length} 条</span>
            <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
          </div>
          {g.items.map(renderItem)}
        </div>
      ))}
      {view !== 'daily' && view !== 'radar' && listData.length > limit && (
        <div className="hv" onClick={() => setLimit((l) => l + 50)} style={{ textAlign: 'center', padding: '9px 0', borderRadius: R.md, cursor: 'pointer', background: fill(1), border: `0.5px dashed ${hairline(0.16)}`, color: ink(2), fontSize: FS.small, fontWeight: 600, transition: transition('background, border-color') }}>
          显示更多（还有 {listData.length - limit} 条）
        </div>
      )}
    </div>
  )
}
