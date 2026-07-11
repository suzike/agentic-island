// 资讯工作台：订阅聚合、观察清单、情报处置、AI 综合与项目沉淀。
// 逐条流水线：抓全文 → 严格评分 → 详细总结（300-500 字）→ 达标进精选；低分只留「全部」。
// 精选默认展示今天（按天时间线可回顾往日）；主题=七大分类聚合；日报按天缓存。

import { useEffect, useMemo, useState } from 'react'
import type { FeedItem, FeedSource, NewsWatch, WorkArtifact, WorkbenchProject } from '../types'
import { FEED_TAGS, parseDaily } from '../logic/rssAi'
import { intelligenceTrend, relatedItems, watchMatches } from '../logic/newsIntel'
import { Markdown, Collapsible } from './Markdown'
import { island } from '../bridge'
import { ProjectContextBar } from './ProjectContextBar'

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

const scoreStyle = (s?: number): React.CSSProperties => ({
  flex: 'none', minWidth: 24, textAlign: 'center', padding: '1px 5px', borderRadius: 7,
  fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
  background: s === undefined ? 'rgba(255,255,255,.05)' : s >= 75 ? 'oklch(0.35 calc(0.09 * var(--cs, 1)) var(--th) / .6)' : s >= 60 ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.04)',
  color: s === undefined ? 'oklch(0.55 0.02 var(--th) / .5)' : s >= 75 ? 'oklch(0.88 calc(0.14 * var(--cs, 1)) var(--th))' : s >= 60 ? 'oklch(0.8 0.02 var(--th) / .8)' : 'oklch(0.62 0.02 var(--th) / .55)'
})

const chip = (on: boolean): React.CSSProperties => ({
  flex: 'none', padding: '3.5px 11px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  background: on ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.07)',
  color: on ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.76 0.02 var(--th) / .75)'
})

const watchInput: React.CSSProperties = { boxSizing: 'border-box', width: '100%', minWidth: 0, height: 28, borderRadius: 7, border: '1px solid rgba(255,255,255,.09)', background: 'rgba(0,0,0,.24)', color: 'oklch(0.9 0.02 var(--th))', outline: 'none', padding: '0 8px', fontFamily: 'var(--font)', fontSize: 9.5 }

/** 结构化日报 → Markdown（存便签/复制用） */
const dailyToMd = (stored: string): string => {
  const r = parseDaily(stored)
  if (!r) return stored
  return `${r.intro}\n\n${r.highlights.map((h, i) => `## ${i + 1}. ${h.headline}\n${h.insight}`).join('\n\n')}\n\n> 🔭 ${r.outlook}`
}

type View = 'picks' | 'signals' | 'radar' | 'all' | 'daily' | 'topics' | 'favs'
const VIEWS: { key: View; label: string }[] = [
  { key: 'picks', label: '精选' },
  { key: 'signals', label: '信号' },
  { key: 'radar', label: '雷达' },
  { key: 'all', label: '全部' },
  { key: 'daily', label: '日报' },
  { key: 'topics', label: '主题' },
  { key: 'favs', label: '收藏' }
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
    if (!report) return <div style={{ padding: 12, borderRadius: 13, background: 'rgba(255,255,255,.03)' }}><Markdown text={stored} /></div>
    const d = new Date()
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Hero：日期 + 导语 */}
        <div style={{ padding: '14px 15px', borderRadius: 15, background: 'linear-gradient(135deg, oklch(0.32 calc(0.06 * var(--cs, 1)) var(--th) / .45), oklch(0.22 calc(0.04 * var(--cs, 1)) var(--th2) / .25))', border: '1px solid oklch(0.65 calc(0.12 * var(--cs, 1)) var(--th) / .35)' }}>
          {rich && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
              <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 17, fontWeight: 900, letterSpacing: '.02em' }}>{d.getMonth() + 1} 月 {d.getDate()} 日</span>
              <span style={{ color: 'oklch(0.78 calc(0.1 * var(--cs, 1)) var(--th) / .85)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.15em' }}>AI 日报</span>
            </div>
          )}
          <div style={{ color: 'oklch(0.88 0.01 var(--th) / .92)', fontSize: 12, lineHeight: 1.7 }}>{report.intro}</div>
        </div>
        {/* 要点卡片 */}
        {report.highlights.map((h, i) => {
          const src = p.items.find((x) => x.id === h.id)
          return (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 13, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.055)' }}>
              <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, background: 'linear-gradient(135deg, oklch(0.8 calc(0.15 * var(--cs, 1)) var(--th)), oklch(0.6 calc(0.14 * var(--cs, 1)) var(--th2)))', color: 'oklch(0.14 0.02 var(--th))' }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'oklch(0.94 0.01 var(--th))', fontSize: 12.5, fontWeight: 800, lineHeight: 1.4 }}>{h.headline}</div>
                <div style={{ color: 'oklch(0.8 0.01 var(--th) / .85)', fontSize: 11, lineHeight: 1.65, marginTop: 4 }}>{h.insight}</div>
                {src && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>📄 {src.title}</span>
                    {src.score !== undefined && <span style={scoreStyle(src.score)}>{src.score}</span>}
                    <span className="hv" onClick={() => jumpToItem(src.id)} style={{ ...chip(false), padding: '2.5px 10px', fontSize: 9.5, color: 'oklch(0.88 calc(0.1 * var(--cs, 1)) var(--th))' }}>→ 定位到精选</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {report.outlook && (
          <div style={{ padding: '9px 13px', borderRadius: 11, background: 'rgba(0,0,0,.22)', color: 'oklch(0.78 calc(0.06 * var(--cs, 1)) var(--th) / .85)', fontSize: 11, fontStyle: 'italic', lineHeight: 1.6 }}>
            🔭 {report.outlook}
          </div>
        )}
      </div>
    )
  }

  /* ---- 条目渲染（精选/全部/主题/收藏共用） ---- */
  const renderItem = (it: FeedItem): React.JSX.Element => {
    const open = expandId === it.id
    const flash = flashId === it.id
    return (
      <div key={it.id} id={'feed-' + it.id} className={open ? undefined : 'msg ai-card'} style={{ borderRadius: 11, background: flash ? 'oklch(0.35 calc(0.09 * var(--cs, 1)) var(--th) / .45)' : open ? 'oklch(0.26 calc(0.03 * var(--cs, 1)) var(--th) / .3)' : 'rgba(255,255,255,.03)', border: `1px solid ${flash ? 'oklch(0.8 calc(0.15 * var(--cs, 1)) var(--th) / .7)' : open ? 'oklch(0.65 calc(0.12 * var(--cs, 1)) var(--th) / .4)' : 'rgba(255,255,255,.045)'}`, opacity: it.read && !open ? 0.62 : 1, transition: 'all .35s', overflow: 'hidden' }}>
        <div className="msg" style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px', cursor: 'pointer' }} onClick={() => toggleExpand(it)}>
          <span style={{ flex: 'none', color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtHM(it.pubDate)}</span>
          <span title="AI 价值分（按你的口味严格评审）" style={scoreStyle(it.score)}>{it.score ?? '…'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: it.read && !open ? 'oklch(0.75 0.01 var(--th) / .75)' : 'oklch(0.92 0.01 var(--th))', fontSize: 12, fontWeight: 600, lineHeight: 1.45, wordBreak: 'break-word' }}>
              {it.fav && '⭐ '}{it.title}
            </div>
            {it.brief && <div style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 10.5, lineHeight: 1.5, marginTop: 2 }}>{it.brief}</div>}
            <div style={{ display: 'flex', gap: 7, marginTop: 3, fontSize: 9, color: 'oklch(0.58 0.02 var(--th) / .5)' }}>
              <span>{it.sourceName}</span>{it.tag && <span># {it.tag}</span>}{it.summary && <span style={{ color: 'oklch(0.7 calc(0.1 * var(--cs, 1)) var(--th) / .7)' }}>✨ 有详细总结</span>}{watchMap.has(it.id) && <span style={{ color: 'oklch(0.78 0.1 150)' }}>命中 {watchMap.get(it.id)?.length} 个观察</span>}{it.signalStatus && <span style={{ color: it.signalStatus === 'actioned' ? 'oklch(0.76 0.1 150)' : 'oklch(0.8 0.11 75)' }}>{it.signalStatus === 'actioned' ? '已行动' : it.signalStatus === 'tracking' ? '跟踪中' : '已忽略'}</span>}
            </div>
          </div>
          <div className="row-acts" style={{ display: 'flex', gap: 7, flex: 'none', marginTop: 2 }}>
            <span className="hv" title={selectedIds.has(it.id) ? '移出综合选择' : '加入多条综合（最多 8 条）'} onClick={(e) => { e.stopPropagation(); toggleSelected(it.id) }} style={{ cursor: 'pointer', width: 12, height: 12, borderRadius: 4, border: `1px solid ${selectedIds.has(it.id) ? 'oklch(0.78 0.13 150)' : 'rgba(255,255,255,.25)'}`, background: selectedIds.has(it.id) ? 'oklch(0.65 0.13 150)' : 'transparent', color: 'oklch(0.14 0.02 150)', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{selectedIds.has(it.id) ? '✓' : ''}</span>
            <span className="hv" title={it.fav ? '取消收藏' : '收藏'} onClick={(e) => { e.stopPropagation(); p.onToggleFav(it.id) }} style={{ cursor: 'pointer', fontSize: 10, color: it.fav ? 'oklch(0.85 0.12 75)' : 'oklch(0.65 0.02 var(--th) / .6)' }}>⭐</span>
            <span className="hv" title="隐藏这条" onClick={(e) => { e.stopPropagation(); p.onHide(it.id) }} style={{ cursor: 'pointer', fontSize: 10, color: 'oklch(0.6 0.02 var(--th) / .5)' }}>✕</span>
          </div>
          <span style={{ flex: 'none', color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 8.5, marginTop: 4, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
        </div>
        {open && (
          <div style={{ padding: '0 12px 11px 44px', display: 'flex', flexDirection: 'column', gap: 8, animation: 'ai-fadein .2s ease' }}>
            {it.summary ? (
              <div style={{ padding: '9px 11px', borderRadius: 9, background: 'oklch(0.24 0.03 var(--th) / .35)', border: '1px solid oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .22)' }}>
                <div style={{ color: 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10, fontWeight: 800, marginBottom: 5 }}>✨ AI 详细总结（基于全文）</div>
                <div style={{ fontSize: 11 }}>
                  <Collapsible collapsedHeight={220}>
                    <Markdown text={it.summary} />
                  </Collapsible>
                </div>
              </div>
            ) : it.desc ? (
              <div style={{ padding: '7px 10px', borderRadius: 9, background: 'rgba(0,0,0,.22)', color: 'oklch(0.75 0.01 var(--th) / .8)', fontSize: 10.5, lineHeight: 1.6 }}>
                <span style={{ opacity: 0.55, fontWeight: 700 }}>原文摘要　</span>{it.desc}
                <div style={{ marginTop: 5, color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5 }}>{it.processed ? '（低于阈值，未生成详细总结）' : '⏳ 排队等流水线处理（抓全文 → 评分 → 详细总结）'}</div>
              </div>
            ) : (
              <div style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10.5 }}>{it.processed ? '（无摘要）' : '⏳ 排队等流水线处理…'}</div>
            )}
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <span className="hv" onClick={() => island.openExternal(it.link)} style={{ ...chip(true), padding: '5px 14px' }}>↗ 打开原文</span>
              {it.summary && (
                <span className="hv" onClick={() => { p.onSaveItemToNotes(it); setSavedItemId(it.id); setTimeout(() => setSavedItemId(null), 2000) }} style={{ ...chip(false), color: 'oklch(0.88 calc(0.1 * var(--cs, 1)) var(--th))' }}>
                  {savedItemId === it.id ? '✓ 已存' : '＋ 添加到灵感便签'}
                </span>
              )}
              <span className="hv" onClick={() => navigator.clipboard?.writeText(`${it.title}\n${it.link}`).catch(() => {})} style={chip(false)}>⧉ 复制链接</span>
              <span className="hv" onClick={() => p.onPatchItem(it.id, { signalStatus: it.signalStatus === 'tracking' ? undefined : 'tracking', projectIds: p.activeProjectId ? [...new Set([...(it.projectIds || []), p.activeProjectId])] : it.projectIds })} style={{ ...chip(it.signalStatus === 'tracking'), color: it.signalStatus === 'tracking' ? undefined : 'oklch(0.84 0.1 75)' }}>{it.signalStatus === 'tracking' ? '✓ 跟踪中' : '◎ 跟踪信号'}</span>
              <span className="hv" onClick={() => p.onItemToTodo(it)} style={{ ...chip(false), color: 'oklch(0.82 0.1 150)' }}>☑ 转待办</span>
              <span className="hv" onClick={() => p.onSaveArtifact(it.title, `${it.summary || it.brief || it.desc || ''}\n\n来源：[${it.sourceName}](${it.link})`, it.id, 'signal')} style={chip(false)}>▣ 存项目情报</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: 'oklch(0.58 0.02 var(--th) / .6)', fontSize: 9 }}>影响</span>
              {(['low', 'medium', 'high'] as const).map((impact) => <span key={impact} className="hv" onClick={() => p.onPatchItem(it.id, { impact })} style={{ ...chip(it.impact === impact), padding: '2px 8px', fontSize: 9 }}>{impact === 'low' ? '低' : impact === 'medium' ? '中' : '高'}</span>)}
              <span style={{ color: 'oklch(0.58 0.02 var(--th) / .6)', fontSize: 9, marginLeft: 5 }}>时间</span>
              {(['now', 'soon', 'later'] as const).map((horizon) => <span key={horizon} className="hv" onClick={() => p.onPatchItem(it.id, { horizon })} style={{ ...chip(it.horizon === horizon), padding: '2px 8px', fontSize: 9 }}>{horizon === 'now' ? '立即' : horizon === 'soon' ? '近期' : '观察'}</span>)}
            </div>
            {relatedItems(it, p.items, 3).length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><span style={{ flex: 'none', color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9 }}>相关</span>{relatedItems(it, p.items, 3).map((related) => <button key={related.id} type="button" className="hv" onClick={() => jumpToItem(related.id)} title={related.title} style={{ minWidth: 0, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '3px 7px', borderRadius: 6, border: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.035)', color: 'oklch(0.68 0.04 var(--th))', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 8.5 }}>{related.title}</button>)}</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ProjectContextBar projects={p.projects} activeProjectId={p.activeProjectId} onSelect={p.onSelectProject} onCreate={p.onCreateProject} label="情报项目" detail="观察清单、跟踪信号、简报和行动项使用当前项目归属" />
      {/* 资讯消费、情报处置与趋势复盘视图 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 9, background: 'rgba(0,0,0,.25)' }}>
          {VIEWS.map((v) => (
            <span key={v.key} className="hv" onClick={() => setView(v.key)} style={{ padding: '4px 12px', borderRadius: 7, fontSize: 11, fontWeight: view === v.key ? 700 : 500, cursor: 'pointer', background: view === v.key ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'transparent', color: view === v.key ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.78 0.02 var(--th) / .7)' }}>
              {v.label}
            </span>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <div className="hv" onClick={() => setShowWatches((value) => !value)} title="管理关键词观察清单" style={chip(showWatches)}>◎ 观察 {p.watches.filter((watch) => watch.enabled).length}</div>
        <div className="hv" onClick={p.onRefresh} style={{ ...chip(false), display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', animation: p.refreshing ? 'ai-ring 1s linear infinite' : undefined }}>↻</span>
          {p.refreshing ? '拉取中' : p.lastRefresh ? fmtHM(p.lastRefresh) : '刷新'}
        </div>
        <div className="hv" onClick={() => setManage((v) => !v)} style={chip(manage)}>⚙</div>
      </div>

      {showWatches && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '9px 10px', borderRadius: 8, background: 'rgba(0,0,0,.2)', border: '1px solid rgba(255,255,255,.07)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,.7fr) minmax(150px,1.2fr) minmax(110px,.8fr) 72px auto', gap: 6 }}>
            <input value={watchDraft.name} onChange={(e) => setWatchDraft((draft) => ({ ...draft, name: e.target.value }))} placeholder="观察名称" style={watchInput} />
            <input value={watchDraft.keywords} onChange={(e) => setWatchDraft((draft) => ({ ...draft, keywords: e.target.value }))} placeholder="关键词，逗号分隔" style={watchInput} />
            <input value={watchDraft.excludes} onChange={(e) => setWatchDraft((draft) => ({ ...draft, excludes: e.target.value }))} placeholder="排除词（可选）" style={watchInput} />
            <input type="number" min={0} max={100} value={watchDraft.minScore} onChange={(e) => setWatchDraft((draft) => ({ ...draft, minScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} title="最低价值分" style={watchInput} />
            <button type="button" className="hv" onClick={addWatch} disabled={!watchDraft.name.trim() || !watchDraft.keywords.trim()} style={{ height: 28, padding: '0 10px', borderRadius: 7, border: 0, background: watchDraft.name.trim() && watchDraft.keywords.trim() ? 'oklch(0.72 0.14 var(--th))' : 'rgba(255,255,255,.07)', color: watchDraft.name.trim() && watchDraft.keywords.trim() ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.55 0.02 var(--th))', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 9.5, fontWeight: 700 }}>创建观察</button>
          </div>
          {p.watches.map((watch) => {
            const hits = [...watchMap.values()].filter((ids) => ids.includes(watch.id)).length
            return <div key={watch.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 7, background: 'rgba(255,255,255,.03)' }}><input type="checkbox" checked={watch.enabled} onChange={() => p.onChangeWatches(p.watches.map((item) => item.id === watch.id ? { ...item, enabled: !item.enabled } : item))} /><span style={{ color: 'oklch(0.86 0.03 var(--th))', fontSize: 10, fontWeight: 700 }}>{watch.name}</span><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'oklch(0.62 0.02 var(--th) / .62)', fontSize: 9 }}>{watch.keywords.join(' · ')}</span>{watch.projectId && <span style={{ color: 'oklch(0.68 0.08 150)', fontSize: 8.5 }}>{p.projects.find((project) => project.id === watch.projectId)?.name || '未知项目'}</span>}<span style={{ color: 'oklch(0.76 0.1 75)', fontSize: 9 }}>命中 {hits}</span><button type="button" className="hv" onClick={() => p.onChangeWatches(p.watches.filter((item) => item.id !== watch.id))} title="删除观察" style={{ width: 24, height: 24, border: 0, background: 'transparent', color: 'oklch(0.7 0.1 25)', cursor: 'pointer' }}>×</button></div>
          })}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 8, background: 'oklch(0.28 0.05 260 / .28)', border: '1px solid oklch(0.62 0.1 260 / .28)' }}><span style={{ color: 'oklch(0.82 0.07 260)', fontSize: 10, fontWeight: 700 }}>已选 {selectedIds.size} 条</span><span style={{ flex: 1 }} /><button type="button" className="hv" onClick={() => void runSynthesis()} disabled={selectedIds.size < 2 || synthesisBusy} style={{ ...chip(selectedIds.size >= 2), border: 0 }}>{synthesisBusy ? '综合中…' : 'AI 多源综合'}</button><button type="button" className="hv" onClick={() => { setSelectedIds(new Set()); setSynthesis('') }} style={{ ...chip(false), border: 0 }}>清除</button></div>
      )}
      {synthesis && (
        <div style={{ padding: '10px 11px', borderRadius: 8, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}><span style={{ color: 'oklch(0.86 0.08 260)', fontSize: 10.5, fontWeight: 750 }}>多源情报简报</span><span style={{ flex: 1 }} /><button type="button" className="hv" onClick={() => p.onSaveArtifact(`${activeProject?.name || '未归属'} · 多源情报简报`, synthesis, [...selectedIds].join(','), 'brief')} style={chip(false)}>▣ 保存简报</button></div><Collapsible collapsedHeight={260}><Markdown text={synthesis} /></Collapsible></div>
      )}

      {/* 流水线状态条：一条一条处理，处理完即时进精选 */}
      {(p.proc.active || unprocessed > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 10, background: 'oklch(0.26 0.04 var(--th) / .25)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .25)' }}>
          {p.proc.active ? (
            <>
              <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .3)', borderTopColor: 'oklch(0.8 calc(0.14 * var(--cs, 1)) var(--th))', borderRadius: 999, animation: 'ai-ring .8s linear infinite', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'oklch(0.85 0.02 var(--th) / .9)', fontSize: 10.5 }}>
                逐条审稿中 {p.proc.done + 1}/{p.proc.total} · {p.proc.current}
              </span>
            </>
          ) : (
            <>
              <span style={{ flex: 1, color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 10.5 }}>还有 {unprocessed} 条待审（抓全文 → 严格评分 → 详细总结）</span>
              <span className="hv" onClick={p.onProcessNow} style={{ ...chip(true), padding: '4px 13px' }}>⚡ 继续处理</span>
            </>
          )}
        </div>
      )}

      {/* ⚙ 源与口味管理 */}
      {manage && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 11, borderRadius: 13, background: 'rgba(0,0,0,.22)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {p.sources.map((s) => (
              <div key={s.id} className="hv" onClick={() => p.onToggleSource(s.id)} title={s.url} style={{ ...chip(s.enabled), display: 'flex', alignItems: 'center', gap: 5 }}>
                {s.name}
                {s.id.startsWith('u') && <span className="hv" onClick={(e) => { e.stopPropagation(); p.onRemoveSource(s.id) }} style={{ opacity: 0.65, fontSize: 9 }}>✕</span>}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="源名称" style={{ width: 100, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: 'oklch(0.95 0.01 var(--th))', fontSize: 11, padding: '6px 9px', outline: 'none' }} />
            <input value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="RSS/Atom 链接（技术博客也行）" style={{ flex: 1, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: 'oklch(0.95 0.01 var(--th))', fontSize: 11, padding: '6px 9px', outline: 'none', fontFamily: 'ui-monospace,monospace' }} />
            <div className="hv" onClick={() => { if (srcUrl.trim()) { p.onAddSource(srcName.trim() || '自定义源', srcUrl.trim()); setSrcName(''); setSrcUrl('') } }} style={{ ...chip(!!srcUrl.trim()), padding: '6px 13px' }}>＋</div>
          </div>
          <div style={{ color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5, fontWeight: 700 }}>我的口味（AI 按此严格评审）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <textarea value={interestDraft} onChange={(e) => setInterestDraft(e.target.value)} rows={2} className="ai-scroll" style={{ flex: 1, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: 'oklch(0.9 0.01 var(--th))', fontSize: 10.5, lineHeight: 1.5, padding: '6px 9px', outline: 'none', resize: 'none', fontFamily: 'inherit', maxHeight: 64 }} />
            {interestDraft.trim() !== p.interests && <div className="hv" onClick={() => p.onSetInterests(interestDraft.trim())} style={{ ...chip(true), alignSelf: 'flex-start', padding: '6px 12px' }}>保存</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5, fontWeight: 700, flex: 'none' }}>精选门槛 {p.minScore} 分</span>
            <input type="range" min={40} max={85} step={5} value={p.minScore} onChange={(e) => p.onSetMinScore(Number(e.target.value))} style={{ flex: 1, minWidth: 100, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }} />
            <div className="hv" onClick={p.onToggleAiEnrich} style={chip(p.aiEnrich)}>AI 流水线 {p.aiEnrich ? '开' : '关'}</div>
          </div>
          <div style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 10, lineHeight: 1.5 }}>逐条处理需调用问答模型（每条约 1-2 次调用：抓全文+评审）。低于门槛的只出现在「全部」，不进精选。</div>
        </div>
      )}

      {view === 'radar' && (() => {
        const max = Math.max(1, ...trend.map((point) => point.total))
        const tagTotals = FEED_TAGS.map((tag) => ({ tag, count: trend.reduce((sum, point) => sum + (point.tags[tag] || 0), 0) })).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count)
        const projectArtifacts = p.artifacts.filter((artifact) => artifact.source === 'news' && (!p.activeProjectId || artifact.projectId === p.activeProjectId)).slice(0, 8)
        return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(180px,.7fr)', gap: 9 }}>
            <div style={{ padding: '10px 11px', borderRadius: 8, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)' }}><div style={{ color: 'oklch(0.84 0.04 var(--th))', fontSize: 10.5, fontWeight: 750, marginBottom: 9 }}>7 日信号强度</div><div style={{ height: 105, display: 'flex', alignItems: 'flex-end', gap: 8 }}>{trend.map((point) => <div key={point.day} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}><span style={{ color: 'oklch(0.68 0.02 var(--th) / .65)', fontSize: 8 }}>{point.total}</span><div title={`高价值 ${point.high}`} style={{ width: '70%', minHeight: 3, height: `${Math.max(3, point.total / max * 72)}px`, borderRadius: 4, background: `linear-gradient(180deg, oklch(0.78 0.14 ${point.high ? '150' : '250'}), oklch(0.48 0.09 var(--th)))` }} /><span style={{ color: 'oklch(0.58 0.02 var(--th) / .58)', fontSize: 8 }}>{point.day}</span></div>)}</div></div>
            <div style={{ padding: '10px 11px', borderRadius: 8, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)' }}><div style={{ color: 'oklch(0.84 0.04 var(--th))', fontSize: 10.5, fontWeight: 750, marginBottom: 8 }}>主题热度</div>{tagTotals.slice(0, 7).map((entry) => <div key={entry.tag} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}><span style={{ width: 42, color: 'oklch(0.7 0.03 var(--th))', fontSize: 9 }}>{entry.tag}</span><div style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}><div style={{ width: `${entry.count / Math.max(1, tagTotals[0]?.count || 1) * 100}%`, height: '100%', background: 'oklch(0.7 0.12 75)' }} /></div><span style={{ color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 8.5 }}>{entry.count}</span></div>)}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <div style={{ padding: '9px 10px', borderRadius: 8, background: 'rgba(0,0,0,.18)', border: '1px solid rgba(255,255,255,.055)' }}><div style={{ color: 'oklch(0.8 0.04 150)', fontSize: 10, fontWeight: 750, marginBottom: 6 }}>观察命中</div>{p.watches.filter((watch) => watch.enabled && (!p.activeProjectId || watch.projectId === p.activeProjectId)).map((watch) => <div key={watch.id} style={{ display: 'flex', gap: 6, padding: '3px 0', fontSize: 9 }}><span style={{ flex: 1, color: 'oklch(0.72 0.03 var(--th))' }}>{watch.name}</span><span style={{ color: 'oklch(0.76 0.1 75)' }}>{[...watchMap.values()].filter((ids) => ids.includes(watch.id)).length}</span></div>)}{p.watches.length === 0 && <span style={{ color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9 }}>暂无观察清单</span>}</div>
            <div style={{ padding: '9px 10px', borderRadius: 8, background: 'rgba(0,0,0,.18)', border: '1px solid rgba(255,255,255,.055)' }}><div style={{ color: 'oklch(0.8 0.04 260)', fontSize: 10, fontWeight: 750, marginBottom: 6 }}>项目情报资产 · {projectArtifacts.length}</div>{projectArtifacts.map((artifact) => <div key={artifact.id} title={artifact.content} style={{ display: 'flex', gap: 6, padding: '3px 0', fontSize: 9 }}><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'oklch(0.72 0.03 var(--th))' }}>{artifact.title}</span><span style={{ color: 'oklch(0.55 0.02 var(--th) / .55)' }}>{artifact.kind === 'brief' ? '简报' : '信号'}</span></div>)}{projectArtifacts.length === 0 && <span style={{ color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9 }}>尚未沉淀项目情报</span>}</div>
          </div>
        </div>
      })()}

      {/* ===== 日报视图 ===== */}
      {view === 'daily' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ color: 'oklch(0.92 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 12.5, fontWeight: 800 }}>🗞️ AI 日报</span>
            <span style={{ flex: 1 }} />
            {p.dailies[todayKey] && !dailyBusy && (
              <>
                <span className="hv" onClick={() => { p.onSaveDailyToNotes(dailyToMd(p.dailies[todayKey])); setSavedTip(true); setTimeout(() => setSavedTip(false), 2000) }} style={chip(false)}>{savedTip ? '✓ 已存' : '存为灵感便签'}</span>
                <span className="hv" onClick={() => navigator.clipboard?.writeText(dailyToMd(p.dailies[todayKey])).catch(() => {})} style={chip(false)}>⧉</span>
              </>
            )}
            <span className="hv" onClick={genDaily} style={chip(true)}>{dailyBusy ? '✨ 生成中…' : p.dailies[todayKey] ? '↺ 重新生成' : '✨ 生成今日日报'}</span>
          </div>
          {dailyErr && <div style={{ color: 'oklch(0.75 0.1 30)', fontSize: 11 }}>{dailyErr}</div>}
          {p.dailies[todayKey] ? renderDaily(p.dailies[todayKey], true) : !dailyBusy && !dailyErr ? (
            <div style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 11, padding: '14px 4px' }}>基于今天精选中的高分内容生成一份图文日报（导语 + 要点卡片 + 来源直达 + 展望）。</div>
          ) : null}
          {/* 往日日报回顾 */}
          {Object.keys(p.dailies).filter((k) => k !== todayKey).sort().reverse().slice(0, 7).map((k) => (
            <div key={k} style={{ padding: 12, borderRadius: 13, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 10.5, fontWeight: 700, marginBottom: 6 }}>{k.split('-').slice(1).join('/')} 日报</div>
              <Collapsible collapsedHeight={110}>{renderDaily(p.dailies[k], false)}</Collapsible>
            </div>
          ))}
        </div>
      )}

      {/* 日期导航：只抓当天，但已入库的往日可回顾 */}
      {view !== 'daily' && view !== 'radar' && availableDays.length > 1 && (
        <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
          <div className="hv" onClick={() => setDayFilter('all')} style={chip(dayFilter === 'all')}>全部日期</div>
          {availableDays.map(([k, ts]) => (
            <div key={k} className="hv" onClick={() => setDayFilter(dayFilter === k ? 'all' : k)} style={chip(dayFilter === k)}>
              {k === todayKey ? '今天' : `${new Date(ts).getMonth() + 1}/${new Date(ts).getDate()}`}
            </div>
          ))}
        </div>
      )}

      {/* ===== 主题视图：分类聚合（精选池内） ===== */}
      {view === 'topics' && (
        <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
          {FEED_TAGS.map((t) => {
            const n = picks.filter((i) => (i.tag || '其它') === t).length
            return <div key={t} className="hv" onClick={() => setTopicTag(t)} style={chip(topicTag === t)}>{t} {n > 0 && <span style={{ opacity: 0.7 }}>{n}</span>}</div>
          })}
        </div>
      )}

      {/* ===== 精选视图：今日热点 TOP ===== */}
      {view === 'picks' && top3.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 3px' }}>
            <span style={{ color: 'oklch(0.85 calc(0.12 * var(--cs, 1)) var(--th))', fontSize: 10, fontWeight: 800, letterSpacing: '.1em' }}>🔥 今日热点 TOP</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.05)' }} />
          </div>
          {top3.map((it, i) => (
            <div key={it.id} className="hv ai-card" onClick={() => toggleExpand(it)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 13, cursor: 'pointer', background: 'linear-gradient(135deg, oklch(0.3 calc(0.05 * var(--cs, 1)) var(--th) / .35), oklch(0.22 calc(0.03 * var(--cs, 1)) var(--th2) / .18))', border: '1px solid oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .3)' }}>
              <span style={{ flex: 'none', fontSize: 15, fontWeight: 900, color: `oklch(${0.85 - i * 0.08} calc(0.14 * var(--cs, 1)) var(--th))`, fontStyle: 'italic' }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'oklch(0.94 0.01 var(--th))', fontSize: 12.5, fontWeight: 700, lineHeight: 1.4 }}>{it.title}</div>
                {it.brief && <div style={{ color: 'oklch(0.72 0.02 var(--th) / .75)', fontSize: 10.5, lineHeight: 1.5, marginTop: 3 }}>{it.brief}</div>}
                <div style={{ display: 'flex', gap: 7, marginTop: 4, fontSize: 9, color: 'oklch(0.6 0.02 var(--th) / .55)' }}>
                  <span>{it.sourceName}</span><span>{fmtHM(it.pubDate)}</span>{it.tag && <span># {it.tag}</span>}
                </div>
              </div>
              <span style={scoreStyle(it.score)}>{it.score}</span>
            </div>
          ))}
        </div>
      )}

      {/* 空态 */}
      {view !== 'daily' && view !== 'radar' && listData.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '26px 14px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.09)' }}>
          <span style={{ fontSize: 22, opacity: 0.6 }}>{view === 'favs' ? '⭐' : '📡'}</span>
          <span style={{ color: 'oklch(0.8 0.02 var(--th) / .85)', fontSize: 12, fontWeight: 600 }}>
            {view === 'favs' ? '还没有收藏' : view === 'picks' ? (p.items.length ? '精选还在路上——流水线正在逐条审稿' : '还没有资讯') : '暂无内容'}
          </span>
          <span style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 10.5 }}>{view === 'picks' && p.items.length === 0 ? '点右上 ↻ 拉取订阅源' : ''}</span>
        </div>
      )}

      {/* 时间线（按天，可回顾往日） */}
      {view !== 'daily' && view !== 'radar' && grouped.map((g) => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 3px 0' }}>
            <span style={{ color: 'oklch(0.68 0.02 var(--th) / .65)', fontSize: 10, fontWeight: 700, letterSpacing: '.08em' }}>{g.label}</span>
            <span style={{ color: 'oklch(0.55 0.02 var(--th) / .45)', fontSize: 9 }}>{g.items.length} 条</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.05)' }} />
          </div>
          {g.items.map(renderItem)}
        </div>
      ))}
      {view !== 'daily' && view !== 'radar' && listData.length > limit && (
        <div className="hv" onClick={() => setLimit((l) => l + 50)} style={{ textAlign: 'center', padding: '9px 0', borderRadius: 10, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.1)', color: 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 11, fontWeight: 600 }}>
          显示更多（还有 {listData.length - limit} 条）
        </div>
      )}
    </div>
  )
}
