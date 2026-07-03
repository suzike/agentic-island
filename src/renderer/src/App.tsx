import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { CalendarEvent, IslandSnapshot } from '../../shared/protocol'
import type { AgentVM, AskSession, ChatMessage, ChatProps, Composer, FeedItem, FeedSource, QuickPrompt, QuoteRef, StickyNote, TodoItem } from './types'
import type { BarConfig } from './types'
import { emptyComposer, DEFAULT_BAR_CONFIG } from './types'
import { DEFAULT_QUICK_PROMPTS } from './logic/prompts'
import { readAttachment, attachmentsToPrompt } from './logic/files'
import { noteSystemPrompt, parseAiNote, noteSearchPrompt, parseSearchIds } from './logic/noteAi'
import { BUILTIN_POOLS, barRefreshPrompt, parseBarRefresh } from './logic/barContent'
import { PRESET_FEEDS, DEFAULT_FEED_INTERESTS, linkId, dailyPrompt, parseDaily, processPrompt, parseProcess, titleBlocked } from './logic/rssAi'
import { riskOf } from './logic/risk'
import { playSound, DEFAULT_SOUND_MAP, type SoundMap } from './logic/sounds'
import { PROVIDERS } from './logic/providers'
import { systemFor, parseBlocks, historyFromThread, buildQuotedPrompt } from './logic/chat'
import { applyTheme } from './logic/themes'
import { todoSystemPrompt, parseAiTodos } from './logic/todoAi'
import { AgentsTab } from './components/AgentsTab'
import { PlanTab } from './components/PlanTab'
import { AskTab } from './components/AskTab'
import { TodoTab } from './components/TodoTab'
import { NotesTab } from './components/NotesTab'
import { NewsTab } from './components/NewsTab'
import { TerminalTab } from './components/TerminalTab'
import { AmbientBar, type BarMedia } from './components/AmbientBar'
import { SettingsTab, type LlmState, type SettingsFlags } from './components/SettingsTab'
import { island } from './bridge'

type Tab = 'agents' | 'plan' | 'ask' | 'todos' | 'notes' | 'news' | 'term' | 'settings'
const TABS: { key: Tab; label: string }[] = [
  { key: 'agents', label: 'Agents' },
  { key: 'plan', label: 'Plan' },
  { key: 'ask', label: '问答' },
  { key: 'todos', label: '待办' },
  { key: 'notes', label: '灵感便签' },
  { key: 'news', label: '资讯' },
  { key: 'term', label: '终端' },
  { key: 'settings', label: '设置' }
]

export function App(): React.JSX.Element {
  // 真实快照（唯一 Agent 数据源）
  const [snap, setSnap] = useState<IslandSnapshot>({ agents: [] })

  const [tab, setTab] = useState<Tab>('agents')
  const [theme, setTheme] = useState('aurora')
  const [askMode, setAskMode] = useState<'fast' | 'deep'>('fast')
  const [revealed, setRevealed] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [armed, setArmed] = useState<Record<string, boolean>>({})
  const [autoAllowSafe, setAutoAllowSafe] = useState(false)
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({})
  const [composers, setComposers] = useState<Record<string, Composer>>({})
  // 引用追问：各对话待发送的引用片段（发送后清空并落到用户消息上）
  const [quotes, setQuotes] = useState<Record<string, QuoteRef[]>>({})
  // 快捷指令：用户可增删改，持久化；默认出厂 6 条
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>(DEFAULT_QUICK_PROMPTS)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [focusUntil, setFocusUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState<string | null>(null)
  const [jumpToast, setJumpToast] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  // 待办
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [dueCount, setDueCount] = useState(0)
  const todosRef = useRef(todos)
  todosRef.current = todos
  // 灵感便签（AI 知识卡片，持久化）
  const [notes, setNotes] = useState<StickyNote[]>([])
  const notesRef = useRef(notes)
  notesRef.current = notes
  // 常驻迷你条自定义配置（持久化）
  const [barCfg, setBarCfg] = useState<BarConfig>(DEFAULT_BAR_CONFIG)
  // RSS 资讯（源/条目/隐藏列表持久化；AI 增强开关）
  const [feedSources, setFeedSources] = useState<FeedSource[]>(PRESET_FEEDS)
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [feedHidden, setFeedHidden] = useState<string[]>([])
  const [feedAiEnrich, setFeedAiEnrich] = useState(true)
  const [feedRefreshing, setFeedRefreshing] = useState(false)
  const [feedLastRefresh, setFeedLastRefresh] = useState(0)
  // 关注方向画像（注入评分提示词）+ 最低分阈值（低于即不进精选）
  const [feedInterests, setFeedInterests] = useState(DEFAULT_FEED_INTERESTS)
  const [feedMinScore, setFeedMinScore] = useState(60)
  const feedInterestsRef = useRef(feedInterests); feedInterestsRef.current = feedInterests
  const feedMinRef = useRef(feedMinScore); feedMinRef.current = feedMinScore
  // 逐条流水线状态（当前处理条目/进度）+ 按天的 AI 日报缓存
  const [feedProc, setFeedProc] = useState<{ active: boolean; current: string; done: number; total: number }>({ active: false, current: '', done: 0, total: 0 })
  const [feedDailies, setFeedDailies] = useState<Record<string, string>>({})
  const feedSourcesRef = useRef(feedSources); feedSourcesRef.current = feedSources
  const feedItemsRef = useRef(feedItems); feedItemsRef.current = feedItems
  const feedHiddenRef = useRef(feedHidden); feedHiddenRef.current = feedHidden
  const feedAiRef = useRef(feedAiEnrich); feedAiRef.current = feedAiEnrich
  const feedBusyRef = useRef(false)
  // 正在播放的媒体（迷你条音乐模式启用时轮询 SMTC）
  const [media, setMedia] = useState<BarMedia | null>(null)
  // 迷你条动态内容池：AI 每 10 分钟刷新 + GitHub 热门（内存态，重启重新拉）
  const [aiPools, setAiPools] = useState<Record<string, string[]>>({})
  const [ghItems, setGhItems] = useState<string[]>([])
  // 问答历史会话（归档）
  const [askSessions, setAskSessions] = useState<AskSession[]>([])

  // 设置
  const [settings, setSettings] = useState<SettingsFlags>({
    autostart: true, multiMonitor: false, sound: true, silentBg: false, autoConnect: true, largeSize: false,
    claudeCli: true, claudeApp: true, codexCli: true, codexApp: true, clipWatch: true, ambientBar: false
  })
  // 飞书日历：CalDAV（官方支持，主通道）或 ICS 订阅（备选）+ 解析所得会议 + 剪贴板历史（仅内存）
  const [icsUrl, setIcsUrl] = useState('')
  const [caldav, setCaldav] = useState({ server: '', username: '', password: '' })
  const [calMsg, setCalMsg] = useState('')
  const [meetings, setMeetings] = useState<CalendarEvent[]>([])
  const [clips, setClips] = useState<string[]>([])
  // 灵动岛整体宽度（标准模式面板宽，380–880）
  const [islandWidth, setIslandWidth] = useState(468)
  // 界面字体与缩放（清晰度：透明窗口无亚像素渲染，缩放+换字体可显著改善）
  const [fontChoice, setFontChoice] = useState('default')
  const [uiZoom, setUiZoom] = useState(1)
  // 按通知类型的声效映射（等待回复/一般审批/危险审批/待办会议）
  const [soundMap, setSoundMap] = useState<SoundMap>(DEFAULT_SOUND_MAP)
  const [soundPickerOpen, setSoundPickerOpen] = useState(false)
  const [monitorPreviewOpen, setMonitorPreviewOpen] = useState(false)
  const [activeMonitor, setActiveMonitor] = useState(1)
  const [llm, setLlm] = useState<LlmState>({
    open: false, provider: 'deepseek', model: '', baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '', testStatus: 'idle', testMsg: '', saved: [],
    // 每家厂商的型号列表：以官方预设为种子，用户可增删（持久化）
    modelLists: Object.fromEntries(PROVIDERS.map((pr): [string, string[]] => [pr.key, [...pr.models]]))
  })

  const llmRef = useRef(llm)
  llmRef.current = llm
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const quotesRef = useRef(quotes)
  quotesRef.current = quotes
  const waitStartRef = useRef<Record<string, number>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastIgnore = useRef<boolean>(true)

  // 托盘"展开灵动岛"
  useEffect(() => island.onReveal(() => setRevealed(true)), [])

  const hydrated = useRef(false)
  useEffect(() => {
    island.getSnapshot().then(setSnap)
    const off = island.onSnapshot(setSnap)
    // 载入持久化配置
    island.loadState().then((s) => {
      // 只水合一次：React StrictMode(dev) 会双调用本 effect，之前的"前插合并"会导致每次重启待办翻倍
      if (hydrated.current) return
      hydrated.current = true
      if (s) {
        if (s.settings) setSettings((v) => ({ ...v, ...(s.settings as Partial<SettingsFlags>) }))
        if (s.soundMap && typeof s.soundMap === 'object') setSoundMap((v) => ({ ...v, ...(s.soundMap as Partial<SoundMap>) }))
        if (typeof s.activeMonitor === 'number') setActiveMonitor(s.activeMonitor)
        // 覆盖（不是合并）：启动水合时持久化数据是唯一真源
        if (Array.isArray(s.todos)) setTodos(s.todos as TodoItem[])
        if (typeof s.theme === 'string') setTheme(s.theme)
        if (Array.isArray(s.askThread)) setThreads((th) => ({ ...th, ask: s.askThread as ChatMessage[] }))
        if (Array.isArray(s.askSessions)) setAskSessions(s.askSessions as AskSession[])
        if (Array.isArray(s.quickPrompts) && s.quickPrompts.length) setQuickPrompts(s.quickPrompts as QuickPrompt[])
        if (typeof s.icsUrl === 'string') setIcsUrl(s.icsUrl)
        if (s.caldav && typeof s.caldav === 'object') setCaldav((v) => ({ ...v, ...(s.caldav as typeof v) }))
        if (Array.isArray(s.notes)) setNotes(s.notes as StickyNote[])
        if (s.barCfg && typeof s.barCfg === 'object') setBarCfg((v) => ({ ...v, ...(s.barCfg as Partial<BarConfig>) }))
        // 资讯：持久化的源与预设合并（保留用户启停/自定义源，补上新增预设）
        if (Array.isArray(s.feedSources)) {
          const saved = s.feedSources as FeedSource[]
          const merged = [...saved, ...PRESET_FEEDS.filter((pf) => !saved.some((x) => x.id === pf.id))]
          setFeedSources(merged)
        }
        if (Array.isArray(s.feedItems)) setFeedItems(s.feedItems as FeedItem[])
        if (Array.isArray(s.feedHidden)) setFeedHidden(s.feedHidden as string[])
        if (typeof s.feedAiEnrich === 'boolean') setFeedAiEnrich(s.feedAiEnrich)
        if (typeof s.feedInterests === 'string' && s.feedInterests.trim()) setFeedInterests(s.feedInterests)
        if (typeof s.feedMinScore === 'number') setFeedMinScore(Math.max(0, Math.min(90, s.feedMinScore)))
        if (s.feedDailies && typeof s.feedDailies === 'object') setFeedDailies(s.feedDailies as Record<string, string>)
        if (typeof s.islandWidth === 'number') setIslandWidth(Math.max(380, Math.min(880, s.islandWidth)))
        if (typeof s.fontChoice === 'string') setFontChoice(s.fontChoice)
        if (typeof s.uiZoom === 'number') setUiZoom(Math.max(0.9, Math.min(1.3, s.uiZoom)))
        if (s.llm) setLlm((v) => ({ ...v, ...(s.llm as Partial<LlmState>), open: false, testStatus: 'idle', testMsg: '' }))
      }
    })
    return off
  }, [])

  const agents: AgentVM[] = useMemo(() => snap.agents.map((a) => ({ ...a })), [snap])

  const pending = useMemo(() => agents.filter((a) => a.status === 'needs_approval'), [agents])
  const hasPending = pending.length > 0
  // 等待你回复（Agent 反问/需补充信息）—— 也算"需要处理"，同样弹出+响铃
  const waiting = useMemo(() => agents.filter((a) => a.status === 'waiting'), [agents])
  const hasWaiting = waiting.length > 0
  const attentionCount = pending.length + waiting.length

  const focusActive = focusUntil > 0 && now < focusUntil
  const focusRemaining = focusActive ? Math.max(0, Math.ceil((focusUntil - now) / 1000)) : 0
  const focusMMSS = `${String(Math.floor(focusRemaining / 60)).padStart(2, '0')}:${String(focusRemaining % 60).padStart(2, '0')}`

  const hasDueTodo = dueCount > 0
  // 暂时收起：正在开会等场景，允许把"有待处理"的岛收回去；出现**新的**请求（签名变化）会重新弹出
  const [snoozeSig, setSnoozeSig] = useState('')
  const attentionSig = [
    ...pending.map((p) => p.requestId || p.id),
    ...waiting.map((w) => w.id),
    ...todos.filter((t) => !t.done && t.due && t.due <= now).map((t) => String(t.id))
  ].join('|')
  const snoozed = snoozeSig !== '' && snoozeSig === attentionSig
  const forceAttention = (hasPending || hasWaiting || hasDueTodo) && !focusActive && !snoozed

  const isShown = revealed || forceAttention || pinned
  const attentionSigRef = useRef(''); attentionSigRef.current = attentionSig
  const snoozeNow = useCallback((): void => {
    setSnoozeSig(attentionSigRef.current)
    setPinned(false)
    setRevealed(false)
  }, [])

  // 供 mousemove 处理器读取的最新值（处理器只注册一次）
  const forcedRef = useRef(false); forcedRef.current = forceAttention || pinned
  const pinnedRef = useRef(false); pinnedRef.current = pinned
  const pendingRef = useRef(false); pendingRef.current = forceAttention
  const revealedRef = useRef(false); revealedRef.current = revealed
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // 记录每个待审批请求的起始时间
  useEffect(() => {
    const ws = waitStartRef.current
    pending.forEach((a) => {
      if (a.requestId && !ws[a.requestId]) ws[a.requestId] = Date.now()
    })
  }, [pending])
  const waitSecs = useMemo(() => {
    const out: Record<string, number> = {}
    pending.forEach((a) => {
      if (a.requestId && waitStartRef.current[a.requestId]) {
        out[a.requestId] = Math.floor((now - waitStartRef.current[a.requestId]) / 1000)
      }
    })
    return out
  }, [pending, now])

  // 逐秒计时：仅在专注或有待处理时触发重渲染（避免 PRD §18 的 max-height 卡顿坑）
  useEffect(() => {
    const t = setInterval(() => {
      if (focusActive || hasPending) setNow(Date.now())
      if (focusUntil > 0 && Date.now() >= focusUntil) {
        setFocusUntil(0)
        showToast(pending.length ? `专注结束 · 期间累积 ${pending.length} 个待处理请求` : '专注结束 · 期间无待处理请求')
      }
    }, 1000)
    return () => clearInterval(t)
  }, [focusActive, hasPending, focusUntil, pending.length])

  // 配置持久化：任一相关设置变化后写回本机（加密存储）
  useEffect(() => {
    if (!hydrated.current) return
    island.saveState({
      settings,
      soundMap,
      activeMonitor,
      todos,
      theme,
      // 问答历史持久化（截尾 60 条、剔除 typing 占位）+ 归档会话
      askThread: (threads['ask'] || []).filter((m) => !m.typing).slice(-60),
      askSessions: askSessions.slice(0, 12),
      quickPrompts,
      icsUrl,
      caldav,
      barCfg,
      islandWidth,
      fontChoice,
      uiZoom,
      feedSources,
      feedItems: feedItems.slice(0, 200),
      feedHidden: feedHidden.slice(0, 300),
      feedAiEnrich,
      feedInterests,
      feedMinScore,
      feedDailies,
      notes: notes.slice(0, 400),
      llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, apiKey: llm.apiKey, saved: llm.saved, modelLists: llm.modelLists }
    })
  }, [settings, soundMap, activeMonitor, todos, theme, threads, askSessions, quickPrompts, icsUrl, caldav, barCfg, islandWidth, fontChoice, uiZoom, feedSources, feedItems, feedHidden, feedAiEnrich, feedInterests, feedMinScore, feedDailies, notes, llm.provider, llm.model, llm.baseUrl, llm.apiKey, llm.saved, llm.modelLists])

  // 字体与缩放应用（--font 变量 + 主进程 zoomFactor）
  useEffect(() => {
    const FONTS: Record<string, string> = {
      default: "'Segoe UI','PingFang SC','Microsoft YaHei UI','Microsoft YaHei',system-ui,sans-serif",
      yahei: "'Microsoft YaHei UI','Microsoft YaHei',system-ui,sans-serif",
      harmony: "'HarmonyOS Sans SC','MiSans','Microsoft YaHei UI',system-ui,sans-serif",
      noto: "'Source Han Sans SC','Noto Sans SC','Microsoft YaHei UI',system-ui,sans-serif"
    }
    document.documentElement.style.setProperty('--font', FONTS[fontChoice] || FONTS.default)
  }, [fontChoice])
  useEffect(() => {
    if (!hydrated.current) return
    island.setZoom(uiZoom)
  }, [uiZoom])

  // 宽度变化 → 通知主进程调窗口（防抖，拖滑杆不狂发 IPC）
  useEffect(() => {
    if (!hydrated.current) return
    const t = setTimeout(() => island.setIslandWidth(islandWidth), 150)
    return () => clearTimeout(t)
  }, [islandWidth])

  // 应用主题（切换即全局换装）
  useEffect(() => applyTheme(theme), [theme])

  // ===== 待办到时提醒：15s 轮询，到点 → 弹岛 + 响铃 + 切到待办 =====
  useEffect(() => {
    const check = (): void => {
      const nowMs = Date.now()
      const due = todos.filter((t) => !t.done && t.due && t.due <= nowMs)
      setDueCount(due.length)
      const fresh = due.filter((t) => !t.notified)
      if (fresh.length > 0) {
        setTodos((list) =>
          list.map((t) => {
            if (!fresh.some((f) => f.id === t.id)) return t
            // 重复待办：提醒后自动顺延到下一周期（保持未完成）
            if (t.repeat === 'daily' || t.repeat === 'weekly') {
              const period = t.repeat === 'daily' ? 86400000 : 604800000
              let next = t.due || nowMs
              while (next <= nowMs) next += period
              return { ...t, due: next, notified: false }
            }
            return { ...t, notified: true }
          })
        )
        if (settings.sound) island.playSound(soundMap.todo)
        setRevealed(true)
        setTab('todos')
        setToast(`⏰ 待办到时：${fresh[0].text}${fresh.length > 1 ? ` 等 ${fresh.length} 项` : ''}`)
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 6000)
      }
    }
    check()
    const t = setInterval(check, 15000)
    return () => clearInterval(t)
  }, [todos, settings.sound, soundMap.todo])

  // ===== 飞书日历：CalDAV（主通道）或 ICS 订阅（备选），配置后立即 + 每 10 分钟刷新 =====
  const caldavReady = !!(caldav.server && caldav.username && caldav.password)
  useEffect(() => {
    if (!caldavReady && !icsUrl.trim()) { setMeetings([]); setCalMsg(''); return }
    let dead = false
    const load = (): void => {
      const req = caldavReady ? island.fetchCaldav(caldav) : island.fetchCalendar(icsUrl.trim())
      req.then((r) => {
        if (dead) return
        if (r.ok) { setMeetings(r.events || []); setCalMsg(`已同步 · ${(r.events || []).length} 个日程（未来 7 天，${caldavReady ? 'CalDAV' : 'ICS'}）`) }
        else setCalMsg(`同步失败：${r.error || '未知错误'}`)
      })
    }
    load()
    const t = setInterval(load, 600000)
    return () => { dead = true; clearInterval(t) }
  }, [icsUrl, caldav, caldavReady])

  // ===== 会议提醒：开始前 5 分钟弹岛 + 响铃 + 一键入会 =====
  const remindedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const check = (): void => {
      const nowMs = Date.now()
      for (const m of meetings) {
        if (m.allDay || remindedRef.current.has(m.id)) continue
        const lead = m.start - nowMs
        if (lead > 0 && lead <= 300000) {
          remindedRef.current.add(m.id)
          if (settings.sound) island.playSound(soundMap.todo)
          setRevealed(true)
          setTab('todos')
          setToast(`📅 ${Math.max(1, Math.round(lead / 60000))} 分钟后开会：${m.title}`)
          clearTimeout(toastTimer.current)
          toastTimer.current = setTimeout(() => setToast(null), 8000)
        }
      }
    }
    check()
    const t = setInterval(check, 20000)
    return () => clearInterval(t)
  }, [meetings, settings.sound, soundMap.todo])

  // ===== 正在播放的媒体：迷你条音乐模式启用时每 4s 轮询 SMTC =====
  const musicOn = settings.ambientBar && barCfg.modes.includes('music')
  useEffect(() => {
    if (!musicOn) { setMedia(null); return }
    let dead = false
    const load = (): void => { island.mediaInfo().then((m) => { if (!dead) setMedia(m) }) }
    load()
    const t = setInterval(load, 4000)
    return () => { dead = true; clearInterval(t) }
  }, [musicOn])

  // ===== 迷你条：GitHub 本周热门（30 分钟刷新） =====
  const ghOn = settings.ambientBar && barCfg.modes.includes('github')
  useEffect(() => {
    if (!ghOn) return
    let dead = false
    const load = (): void => { island.githubTrending().then((r) => { if (!dead && r.ok) setGhItems(r.items || []) }) }
    load()
    const t = setInterval(load, 1800000)
    return () => { dead = true; clearInterval(t) }
  }, [ghOn])

  // ===== 迷你条：AI 内容池刷新 =====
  // 教训：一次生成全部主题会撞输出 token 上限 → JSON 截断解析失败 → 池子永远空（用户"从没见过自定义主题"的根因）。
  // 现在：每次调用只生成 2 个主题（deep 模式），逐块落池；Key 就绪即触发（不再等 10 分钟）。
  const barGenBusyRef = useRef(false)
  const refreshBarPools = useCallback(async (): Promise<string> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return '✗ 请先配置问答模型的端点与 Key'
    if (barGenBusyRef.current) return '正在生成中…'
    barGenBusyRef.current = true
    try {
      const TOPIC_DESC: Record<string, string> = {
        quotes: '编程/工程/人生的名人名言与隽语',
        exp: '软件开发实战经验法则（一句话）',
        agent: 'AI Agent / 与 AI 结对编程的方法论要点',
        thermal: '汽车热管理应用层软件开发（Simulink/Stateflow/AUTOSAR/标定）的知识点与技巧'
      }
      const cfg = barCfgRef.current
      const topics = [
        ...['quotes', 'exp', 'agent', 'thermal'].filter((k) => cfg.modes.includes(k)).map((k) => ({ key: k, desc: TOPIC_DESC[k] })),
        ...(cfg.customTopics || []).map((t) => ({ key: 'ct' + t.id, desc: t.hint || t.name }))
      ]
      if (!topics.length) return '✗ 没有启用任何文字主题'
      let okCount = 0
      // 每次 2 个主题，避免输出截断
      for (let i = 0; i < topics.length; i += 2) {
        const chunk = topics.slice(i, i + 2)
        const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, '你是精炼的内容策展人，只输出 JSON。', barRefreshPrompt(chunk), true)
        if (!res.ok) continue
        const parsed = parseBarRefresh(res.text, chunk.map((t) => t.key))
        if (parsed) { setAiPools((p) => ({ ...p, ...parsed })); okCount += Object.keys(parsed).length }
      }
      return okCount > 0 ? `✓ 已生成 ${okCount} 个主题的新内容` : '✗ 生成失败，请重试'
    } finally {
      barGenBusyRef.current = false
    }
  }, [])
  const barCfgRef = useRef(barCfg); barCfgRef.current = barCfg
  const llmReady = !!(llm.apiKey && llm.model)
  const aiTopicsKey = ['quotes', 'exp', 'agent', 'thermal'].filter((k) => barCfg.modes.includes(k)).join(',') + '|' + (barCfg.customTopics || []).map((t) => t.id).join(',')
  useEffect(() => {
    if (!settings.ambientBar || barCfg.aiRefresh === false || !llmReady) return
    void refreshBarPools()
    const t = setInterval(() => { void refreshBarPools() }, 600000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ambientBar, barCfg.aiRefresh, aiTopicsKey, llmReady])

  // 内容池合并：AI 刷新批次优先轮到，内置库保底；自定义主题聚合进 custom
  const barPools = useMemo(() => {
    const merge = (k: string): string[] => [...(aiPools[k] || []), ...(BUILTIN_POOLS[k] || [])]
    const customAgg = [
      ...(barCfg.customTopics || []).flatMap((t) => aiPools['ct' + t.id] || []),
      ...barCfg.customQuotes
    ]
    return { quotes: merge('quotes'), exp: merge('exp'), agent: merge('agent'), thermal: merge('thermal'), github: ghItems, custom: customAgg }
  }, [aiPools, ghItems, barCfg.customTopics, barCfg.customQuotes])

  // ===== 剪贴板助手：主进程推送 → 记录历史（仅内存，最多 30 条）+ 报错检测提示 =====
  useEffect(() => {
    if (!settings.clipWatch) return
    return island.onClipboard((text) => {
      setClips((l) => [text, ...l.filter((c) => c !== text)].slice(0, 30))
      // 疑似报错 → 轻提示（不打断），去问答·剪贴板一键分析
      if (text.length > 40 && /(\berror\b|exception|traceback|panic|FAILED|错误|异常|失败)/i.test(text)) {
        setToast('📋 检测到疑似报错 · 到问答区剪贴板面板可一键分析')
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), 5000)
      }
    })
  }, [settings.clipWatch])

  // 统一的悬浮/穿透处理器（只注册一次，用 ref 读最新状态）：
  // 顶部热区或实体内容或强制展开 → 捕获鼠标并显示；离开后带 400ms 滞后再隐藏，杜绝闪烁。
  useEffect(() => {
    const setIgnore = (ig: boolean): void => {
      if (ig !== lastIgnore.current) { lastIgnore.current = ig; island.setIgnoreMouse(ig) }
    }
    const onMove = (e: MouseEvent): void => {
      const cx = window.innerWidth / 2
      // 触发区：只有贴着屏幕最顶边、且靠近中央时才唤出（避免提前弹出）
      const atTopEdge = e.clientY <= 6 && Math.abs(e.clientX - cx) <= 120
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const overSolid = !!el?.closest('[data-solid]')
      const forced = forcedRef.current || pendingRef.current
      // 已经打开时，顶部中央一片较大的"保持区"避免动画途中误判收起（防止蹦一下又回去）
      const keepOpen = revealedRef.current && e.clientY <= 260 && Math.abs(e.clientX - cx) <= window.innerWidth / 2 - 10
      const interactive = atTopEdge || overSolid || forced || keepOpen

      setIgnore(!interactive)

      if (atTopEdge || overSolid || forced) {
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = undefined }
        if (!revealedRef.current) setRevealed(true)
      } else if (interactive) {
        // keepOpen 区内：维持显示，取消隐藏计时
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = undefined }
      } else if (!hideTimer.current) {
        hideTimer.current = setTimeout(() => { hideTimer.current = undefined; setRevealed(false) }, 260)
      }
    }
    // 鼠标移出窗口：若非强制态，恢复穿透并延时隐藏（兜底，避免状态卡住）
    const onLeave = (): void => {
      if (forcedRef.current || pendingRef.current) return
      setIgnore(true)
      if (!hideTimer.current) hideTimer.current = setTimeout(() => { hideTimer.current = undefined; setRevealed(false) }, 400)
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => { window.removeEventListener('mousemove', onMove); document.removeEventListener('mouseleave', onLeave) }
  }, [])

  // 强制态（贴住/待审批）或已显示时立即取消穿透，无需先晃鼠标
  useEffect(() => {
    if (isShown) {
      if (lastIgnore.current) { lastIgnore.current = false; island.setIgnoreMouse(false) }
    }
  }, [isShown])

  // 新的待审批/等待到达时的提示音由主进程直接播放（见 main/index.ts），渲染层不再触发，避免链路失效/双响

  // 「本会话自动允许只读/测试类命令」：勾选后，安全命令到达即自动放行（此前只是个摆设）
  useEffect(() => {
    if (!autoAllowSafe) return
    pending.forEach((a) => {
      if (a.requestId && !a.isPlan && riskOf(a.command).level === 'safe') {
        island.decide({ requestId: a.requestId, decision: 'allow' })
      }
    })
  }, [pending, autoAllowSafe])

  // 快捷键 Y/N/Esc/Ctrl+\
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if ((e.key === 'y' || e.key === 'Y') && pending.length) { e.preventDefault(); decide(pending[0], 'allow') }
      else if ((e.key === 'n' || e.key === 'N') && pending.length) { e.preventDefault(); decide(pending[0], 'deny') }
      else if (e.key === 'Escape') { if (!pinned) { snoozeNow() } } // Esc = 收起（含待处理时的暂时静默，新请求会再弹）
      else if ((e.key === '\\' || e.key === '`') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setRevealed((v) => !v) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const showToast = useCallback((text: string): void => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
    if (settings.sound) playSound(soundMap.todo)
  }, [settings.sound, soundMap.todo])

  // ===== 审批裁决 =====
  const decide = useCallback((a: AgentVM, d: 'allow' | 'deny'): void => {
    if (!a.requestId) return
    const risk = riskOf(a.command)
    // 计划审阅不做危险两步确认（command 是计划全文而非命令）
    if (!a.isPlan && risk.level === 'danger' && d === 'allow' && !armed[a.requestId]) {
      setArmed((m) => ({ ...m, [a.requestId!]: true }))
      return
    }
    setArmed((m) => { const n = { ...m }; delete n[a.requestId!]; return n })
    island.decide({ requestId: a.requestId, decision: d })
  }, [armed])

  // ===== 聊天 =====
  const getComposer = useCallback((key: string): Composer => composers[key] || emptyComposer(), [composers])
  const patchComposer = useCallback((key: string, patch: Partial<Composer>): void => {
    setComposers((c) => ({ ...c, [key]: { ...(c[key] || emptyComposer()), ...patch } }))
  }, [])
  const onAttach = useCallback((key: string, type: 'screenshot' | 'file', payload?: { name?: string; thumb?: string; content?: string; dataUrl?: string }): void => {
    setComposers((c) => {
      const cur = c[key] || emptyComposer()
      const name = payload?.name || (type === 'screenshot' ? '截图' : '文件')
      // content/dataUrl = 附件的真实内容（文本注入提问 / 图片发视觉模型）
      return { ...c, [key]: { ...cur, attachments: [...cur.attachments, { type, name, thumb: payload?.thumb, content: payload?.content, dataUrl: payload?.dataUrl }] } }
    })
  }, [])
  const onRemoveAtt = useCallback((key: string, idx: number): void => {
    setComposers((c) => {
      const cur = c[key] || emptyComposer()
      return { ...c, [key]: { ...cur, attachments: cur.attachments.filter((_, i) => i !== idx) } }
    })
  }, [])
  // 拉取 AI 回复（带多轮上下文）：history 为"本轮提问之前"的对话历史
  const fetchReply = useCallback((key: string, text: string, atts: Composer['attachments'], deep: boolean, history: { role: 'user' | 'assistant'; content: string }[]): void => {
    const L = llmRef.current
    const cfg = { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }
    const finish = (reply: ChatMessage): void =>
      setThreads((th) => ({ ...th, [key]: [...(th[key] || []).filter((m) => !m.typing), { ...reply, ts: Date.now() }] }))

    if (!cfg.apiKey || !cfg.model) {
      finish({ role: 'agent', blocks: [{ t: 'note', text: '请先在 Settings › 问答助手模型 里配置端点、型号与 API Key。' }] })
      return
    }
    // 附件真实注入：文本文件内容拼进提问；图片作为多模态 parts（需模型支持视觉，否则 API 会报错并如实显示）
    const fileText = attachmentsToPrompt(atts)
    const images = atts.filter((a) => a.dataUrl)
    const fullText = (text || (atts.length ? '请分析附带的内容。' : '（用户未输入文字）')) + fileText
    const userPayload: string | Array<Record<string, unknown>> = images.length
      ? [{ type: 'text', text: fullText }, ...images.map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl! } }))]
      : fullText
    island.llmComplete(cfg, systemFor(key, deep), userPayload, deep, history).then((res) => {
      if (res.ok) {
        let blocks = parseBlocks(res.text) || [{ t: 'p' as const, text: res.text || '' }]
        // 推理型模型单独返回的思维链，作为 think block 置于最前
        if (res.reasoning) blocks = [{ t: 'think' as const, text: res.reasoning }, ...blocks]
        finish({ role: 'agent', blocks })
      } else {
        finish({ role: 'agent', blocks: [{ t: 'note', text: '请求失败：' + (res.error || '未知错误') }] })
      }
    })
  }, [])

  // 核心发送：显式 text/atts/quotes；自动携带该线程的多轮上下文（AI 记得上文，可追问）
  // 引用片段：气泡里作为卡片单独展示；发给模型的文本把引用+疑问组装进上下文
  const pushAndReply = useCallback((key: string, text: string, atts: Composer['attachments'], deep = false, qs: QuoteRef[] = []): void => {
    if (!text && atts.length === 0 && qs.length === 0) return
    const history = historyFromThread(threadsRef.current[key] || [])
    const llmText = qs.length ? buildQuotedPrompt(qs, text) : text
    setThreads((th) => ({ ...th, [key]: [...(th[key] || []), { role: 'user', text, attachments: atts, quotes: qs.length ? qs : undefined, ts: Date.now() }, { role: 'agent', typing: true }] }))
    setComposers((c) => ({ ...c, [key]: emptyComposer() }))
    if (qs.length) setQuotes((q) => ({ ...q, [key]: [] }))
    fetchReply(key, llmText, atts, deep, history)
  }, [fetchReply])

  // 引用追问：添加/移除待发送引用片段
  const addQuote = useCallback((key: string, q: { text: string; note?: string }): void => {
    setQuotes((all) => ({ ...all, [key]: [...(all[key] || []), { id: Date.now() * 100 + ((all[key]?.length || 0) % 100), text: q.text, note: q.note }] }))
  }, [])
  const removeQuote = useCallback((key: string, id: number): void => {
    setQuotes((all) => ({ ...all, [key]: (all[key] || []).filter((x) => x.id !== id) }))
  }, [])

  // 重试：丢弃最后一轮 AI 回复，用同一问题重新生成
  const retryLast = useCallback((key: string, deep = false): void => {
    const msgs = (threadsRef.current[key] || []).filter((m) => !m.typing)
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf('user')
    if (lastUserIdx === -1) return
    const lastUser = msgs[lastUserIdx]
    const kept = msgs.slice(0, lastUserIdx + 1)
    // 重试时保留原引用上下文
    const retryText = lastUser.quotes?.length ? buildQuotedPrompt(lastUser.quotes, (lastUser.text || '').trim()) : (lastUser.text || '').trim()
    setThreads((th) => ({ ...th, [key]: [...kept, { role: 'agent', typing: true }] }))
    fetchReply(key, retryText, lastUser.attachments || [], deep, historyFromThread(msgs.slice(0, lastUserIdx)))
  }, [fetchReply])
  // ===== 问答多会话：归档当前 → 新建/切换/删除 =====
  const archiveCurrentAsk = useCallback((): AskSession | null => {
    const msgs = (threadsRef.current['ask'] || []).filter((m) => !m.typing)
    if (msgs.length === 0) return null
    const firstUser = msgs.find((m) => m.role === 'user')
    const title = (firstUser?.text || '未命名对话').slice(0, 20)
    return { id: Date.now(), title, msgs: msgs.slice(-60) }
  }, [])
  const askNew = useCallback((): void => {
    const arch = archiveCurrentAsk()
    if (arch) setAskSessions((l) => [arch, ...l].slice(0, 12))
    setThreads((th) => ({ ...th, ask: [] }))
  }, [archiveCurrentAsk])
  const askSwitch = useCallback((id: number): void => {
    setAskSessions((l) => {
      const target = l.find((s) => s.id === id)
      if (!target) return l
      const rest = l.filter((s) => s.id !== id)
      const arch = archiveCurrentAsk()
      setThreads((th) => ({ ...th, ask: target.msgs }))
      return arch ? [arch, ...rest].slice(0, 12) : rest
    })
  }, [archiveCurrentAsk])
  const askDelete = useCallback((id: number): void => setAskSessions((l) => l.filter((s) => s.id !== id)), [])

  const sendMessage = useCallback((key: string, deep = false): void => {
    const cur = getComposer(key)
    pushAndReply(key, (cur.text || '').trim(), cur.attachments, deep, quotesRef.current[key] || [])
  }, [getComposer, pushAndReply])
  const sendPreset = useCallback((key: string, text: string, deep = false): void => {
    pushAndReply(key, text, [], deep)
  }, [pushAndReply])

  const convFor = useCallback((key: string, placeholder: string, quick?: string[], deep = false): ChatProps => ({
    messages: threads[key] || [],
    composer: getComposer(key),
    placeholder,
    quickReplies: quick,
    // 问答区消息历史更高：标准 420px，大尺寸下自适应撑满（其余对话保持默认 230）
    maxH: key === 'ask' ? (settings.largeSize ? 'calc(100vh - 400px)' : 420) : undefined,
    onQuick: (t) => sendPreset(key, t, deep),
    onText: (v) => patchComposer(key, { text: v }),
    onSend: () => sendMessage(key, deep),
    onAttach: (type, payload) => onAttach(key, type, payload),
    onRemoveAtt: (i) => onRemoveAtt(key, i),
    // 引用追问仅问答区开启（框选 AI 回复 → 备注 → 贴入输入区）
    enableQuote: key === 'ask',
    quotes: quotes[key] || [],
    onAddQuote: (q) => addQuote(key, q),
    onRemoveQuote: (id) => removeQuote(key, id)
  }), [threads, quotes, getComposer, sendPreset, patchComposer, sendMessage, onAttach, onRemoveAtt, addQuote, removeQuote, settings.largeSize])

  // ===== LLM 设置 =====
  const setLlmField = (f: 'model' | 'baseUrl' | 'apiKey', v: string): void => setLlm((s) => ({ ...s, [f]: v, testStatus: 'idle', testMsg: '' }))
  const setProvider = (k: string): void => {
    const pr = PROVIDERS.find((x) => x.key === k) || PROVIDERS[0]
    // 切厂商时自动选中该家型号列表的第一个（若当前型号不在其列表里）
    setLlm((s) => {
      const list = s.modelLists[k] || []
      const model = list.includes(s.model) ? s.model : list[0] || ''
      return { ...s, provider: k, model, baseUrl: pr.baseUrl || s.baseUrl, testStatus: 'idle', testMsg: '' }
    })
  }
  // ===== 型号列表：新增（并设为当前）/ 删除 / 点选 =====
  const addModel = (name: string): void =>
    setLlm((s) => {
      const list = s.modelLists[s.provider] || []
      if (list.includes(name)) return { ...s, model: name }
      return { ...s, model: name, modelLists: { ...s.modelLists, [s.provider]: [...list, name] } }
    })
  const removeModel = (name: string): void =>
    setLlm((s) => {
      const list = (s.modelLists[s.provider] || []).filter((m) => m !== name)
      return { ...s, model: s.model === name ? list[0] || '' : s.model, modelLists: { ...s.modelLists, [s.provider]: list } }
    })
  const pickModel = (name: string): void => setLlm((s) => ({ ...s, model: name, testStatus: 'idle', testMsg: '' }))
  const testLlm = (): void => {
    const { baseUrl, apiKey, model } = llm
    setLlm((s) => ({ ...s, testStatus: 'testing', testMsg: '正在连接…' }))
    island.llmTest({ baseUrl, apiKey, model }).then((r) => {
      setLlm((s) => ({ ...s, testStatus: r.ok ? 'ok' : 'fail', testMsg: r.msg }))
    })
  }
  const saveLlm = (): void => setLlm((s) => {
    const label = (PROVIDERS.find((x) => x.key === s.provider) || {}).label || s.provider
    const cfg = { id: now + Math.floor(focusRemaining), provider: s.provider, model: s.model, baseUrl: s.baseUrl, apiKey: s.apiKey, name: label + ' · ' + (s.model || '未命名') }
    const saved = s.saved.filter((c) => !(c.provider === s.provider && c.model === s.model && c.baseUrl === s.baseUrl))
    // 上限 12：支持每家厂商保存多个模型，在问答头部下拉自由切换
    return { ...s, saved: [cfg, ...saved].slice(0, 12) }
  })
  const loadLlm = (id: number): void => setLlm((s) => {
    const c = s.saved.find((x) => x.id === id)
    return c ? { ...s, provider: c.provider, model: c.model, baseUrl: c.baseUrl, apiKey: c.apiKey, testStatus: 'idle', testMsg: '' } : s
  })
  const deleteLlm = (id: number): void => setLlm((s) => ({ ...s, saved: s.saved.filter((x) => x.id !== id) }))

  // ===== 灵感便签：AI 生成 / AI 语义搜索 / 手动增删改 =====
  const noteAdd = useCallback((): void => {
    const now2 = Date.now()
    setNotes((l) => [{ id: now2, emoji: '📝', title: '新便签', md: '在这里写下你的灵感…\n\n- 支持 **Markdown**\n- 代码块 / 链接 / 图片外链', color: 'emerald', tags: [], createdAt: now2, updatedAt: now2 }, ...l].slice(0, 400))
  }, [])
  const noteUpdate = useCallback((n: StickyNote): void => setNotes((l) => l.map((x) => (x.id === n.id ? n : x))), [])
  const noteDelete = useCallback((id: number): void => setNotes((l) => l.filter((x) => x.id !== id)), [])
  const noteTogglePin = useCallback((id: number): void => setNotes((l) => l.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x))), [])
  // AI 生成：文本直接整理；URL 先抓正文再整理
  const aiCreateNote = useCallback(async (input: string): Promise<string> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return '请先在 Settings › 问答助手模型 配置端点与 Key'
    let content = input
    let source: string | undefined
    if (/^https?:\/\/\S+$/i.test(input)) {
      const r = await island.fetchUrlText(input)
      if (!r.ok || !r.text) return `抓取网页失败：${r.error || '未知错误'}`
      content = r.text
      source = input
    }
    const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, noteSystemPrompt(), content.slice(0, 24000), true)
    if (!res.ok) return `AI 请求失败：${res.error || '未知错误'}`
    const parsed = parseAiNote(res.text)
    if (!parsed) return 'AI 返回的格式无法解析，请重试一次'
    const now2 = Date.now()
    setNotes((l) => [{ id: now2, ...parsed, source, createdAt: now2, updatedAt: now2 }, ...l].slice(0, 400))
    return `✓ 已生成「${parsed.title}」`
  }, [])
  // AI 语义搜索：返回匹配 id；AI 不可用返回 null（界面回退关键词过滤）
  const aiSearchNotes = useCallback(async (q: string): Promise<number[] | null> => {
    const L = llmRef.current
    const list = notesRef.current
    if (!L.apiKey || !L.model || list.length === 0) return null
    const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, '你是精准的检索助手，只输出 JSON 数组，不输出任何其它文字。', noteSearchPrompt(list, q), false)
    if (!res.ok) return null
    return parseSearchIds(res.text)
  }, [])

  // ===== RSS 资讯：逐条流水线（照参考站的做法）=====
  // 每条依次：抓正文全文 → 单条 LLM（严格评分 + 分类 + 点评 + 基于全文的 300-500 字详细总结）→ 落地。
  // 达到阈值的进「精选」，低分的只留在「全部」。今天的优先处理；单轮最多 20 条控费。
  const procBusyRef = useRef(false)
  const processPipeline = useCallback(async (): Promise<void> => {
    const L = llmRef.current
    if (procBusyRef.current || !feedAiRef.current || !L.apiKey || !L.model) return
    procBusyRef.current = true
    try {
      const d0 = new Date(); const today = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()
      // 队列：未处理的，今天的排前（新→旧），其后按时间新→旧
      const queue = feedItemsRef.current
        .filter((i) => !i.processed)
        .sort((a, b) => Number(b.pubDate >= today) - Number(a.pubDate >= today) || b.pubDate - a.pubDate)
        .slice(0, 20)
      setFeedProc({ active: true, current: '', done: 0, total: queue.length })
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i]
        setFeedProc({ active: true, current: item.title.slice(0, 40), done: i, total: queue.length })
        // ① 抓正文（失败回退 RSS 摘要，如实降级）
        let fullText = item.desc || ''
        try {
          const r = await island.fetchUrlText(item.link)
          if (r.ok && r.text && r.text.length > (item.desc?.length || 0)) fullText = r.text
        } catch { /* 保底用摘要 */ }
        // ② 单条评审（严格把关 + 达标才写详细总结）
        const res = await island.llmComplete(
          { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model },
          '你是严格的科技主编，只输出 JSON。',
          processPrompt(item, fullText || '（未能获取正文，仅凭标题判断，从严打分）', feedInterestsRef.current, feedMinRef.current),
          true
        )
        const parsed = res.ok ? parseProcess(res.text) : null
        // ③ 逐条落地。低于门槛 = 不满足要求 → 直接清出（进 hidden 防回流），收藏例外
        if (parsed && parsed.score < feedMinRef.current && !feedItemsRef.current.find((x) => x.id === item.id)?.fav) {
          setFeedItems((list) => list.filter((it) => it.id !== item.id))
          setFeedHidden((h) => [item.id, ...h].slice(0, 500))
        } else {
          setFeedItems((list) => list.map((it) => (it.id === item.id ? { ...it, processed: true, ...(parsed ? { score: parsed.score, tag: parsed.tag, brief: parsed.brief, summary: parsed.summary || undefined } : {}) } : it)))
        }
        await new Promise((r) => setTimeout(r, 250))
      }
    } finally {
      procBusyRef.current = false
      setFeedProc((s) => ({ ...s, active: false, current: '' }))
    }
  }, [])

  const refreshFeeds = useCallback(async (): Promise<void> => {
    if (feedBusyRef.current) return
    feedBusyRef.current = true
    setFeedRefreshing(true)
    try {
      // 存量清扫：历史遗留的已评低分条目一并清出（收藏例外）——"全部"里不再显示与需求无关的
      const min = feedMinRef.current
      const purged = feedItemsRef.current.filter((i) => !i.fav && i.score !== undefined && i.score < min).map((i) => i.id)
      if (purged.length) {
        setFeedItems((list) => list.filter((i) => !purged.includes(i.id)))
        setFeedHidden((h) => [...purged, ...h].slice(0, 500))
      }
      const enabled = feedSourcesRef.current.filter((s) => s.enabled)
      const results = await Promise.all(enabled.map((s) => island.rssFetch(s.url).then((r) => ({ s, r }))))
      const known = new Set(feedItemsRef.current.map((i) => i.id))
      const hidden = new Set(feedHiddenRef.current)
      const d0 = new Date(); const todayStart = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()
      const fresh: FeedItem[] = []
      const blocked: string[] = []
      for (const { s, r } of results) {
        if (!r.ok) continue
        for (const it of r.items || []) {
          const id = linkId(it.link)
          if (known.has(id) || hidden.has(id)) continue
          // 只收当天发表的（历史文章不进库；往日内容靠已入库的积累回顾）
          if (it.pubDate < todayStart) continue
          // 规则预筛：融资/商业/人事/营销类标题直接拒收（进 hidden 防明天重试）
          if (titleBlocked(it.title)) { blocked.push(id); continue }
          known.add(id)
          fresh.push({ id, sourceName: s.name, title: it.title, link: it.link, pubDate: it.pubDate, desc: it.desc })
        }
      }
      if (blocked.length) setFeedHidden((h) => [...blocked, ...h].slice(0, 500))
      if (fresh.length) {
        setFeedItems((list) => [...fresh, ...list].sort((a, b) => b.pubDate - a.pubDate).slice(0, 400))
      }
      setFeedLastRefresh(Date.now())
    } finally {
      feedBusyRef.current = false
      setFeedRefreshing(false)
    }
    // 刷新后启动逐条流水线（今天的优先）
    setTimeout(() => { void processPipeline() }, 400)
  }, [processPipeline])

  // 启动后首刷 + 每 30 分钟自动刷新
  useEffect(() => {
    const t0 = setTimeout(() => { void refreshFeeds() }, 4000)
    const t = setInterval(() => { void refreshFeeds() }, 1800000)
    return () => { clearTimeout(t0); clearInterval(t) }
  }, [refreshFeeds])

  // AI 日报：今天的精选（过阈值）→ Markdown，按天缓存持久化
  const feedDaily = useCallback(async (): Promise<string> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return '✗ 请先在 设置 › 问答助手模型 配置端点与 Key'
    const d0 = new Date(); const today = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()
    const pool = feedItemsRef.current.filter((i) => i.pubDate >= today && (i.score ?? 0) >= feedMinRef.current)
    const picked = (pool.length >= 3 ? pool : feedItemsRef.current.filter((i) => i.pubDate >= Date.now() - 24 * 3600000))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 25)
    if (picked.length === 0) return '✗ 今天还没有资讯（先点刷新，等流水线处理完）'
    const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, '你是犀利的科技日报主编，只输出 JSON。', dailyPrompt(picked), true)
    if (!res.ok) return `✗ AI 请求失败：${res.error || '未知错误'}`
    const report = parseDaily(res.text)
    if (!report) return '✗ AI 返回格式无法解析，请重试'
    const json = JSON.stringify(report)
    const key = `${d0.getFullYear()}-${d0.getMonth() + 1}-${d0.getDate()}`
    setFeedDailies((m) => { const next = { ...m, [key]: json }; const keys = Object.keys(next).sort(); while (keys.length > 14) delete next[keys.shift()!]; return next })
    return json
  }, [])

  // ===== 待办：AI 拆解子任务 =====
  const aiBreakdown = useCallback(async (id: number): Promise<string> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return '请先在 设置 › 问答助手模型 配置端点与 Key'
    const target = todosRef.current.find((t) => t.id === id)
    if (!target) return '任务不存在'
    const res = await island.llmComplete(
      { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model },
      '你是任务规划助手。把用户的任务拆解成 3-6 个具体可执行的子步骤，每步 ≤ 20 字、动词开头。只输出 JSON 字符串数组。',
      `任务：${target.text}${target.note ? `\n补充：${target.note}` : ''}`,
      false
    )
    if (!res.ok) return `AI 请求失败：${res.error || '未知错误'}`
    try {
      const m = String(res.text || '').match(/\[[\s\S]*\]/)
      const arr = m ? (JSON.parse(m[0]) as unknown[]) : []
      const subs = arr.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 6)
      if (!subs.length) return 'AI 未返回有效步骤'
      setTodos((l) => l.map((t) => (t.id === id ? { ...t, subs: [...(t.subs || []), ...subs.map((text, i) => ({ id: Date.now() * 10 + i, text, done: false }))] } : t)))
      return `✓ 已拆解为 ${subs.length} 个子步骤`
    } catch {
      return 'AI 返回无法解析'
    }
  }, [])

  // ===== 常驻迷你条：AI 个性语录（基于你的问答/便签/待办提炼经验与格言） =====
  const aiGenBarQuotes = useCallback(async (): Promise<string> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return '请先在 Settings › 问答助手模型 配置端点与 Key'
    const askText = (threadsRef.current['ask'] || []).filter((m) => m.role === 'user' && m.text).map((m) => m.text).slice(-20).join('\n')
    const noteText = notesRef.current.map((n) => `${n.title}：${n.tags.join(',')}`).slice(0, 30).join('\n')
    const ctx = `最近的提问：\n${askText || '（无）'}\n\n积累的便签：\n${noteText || '（无）'}`
    const res = await island.llmComplete(
      { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model },
      '你是一位睿智的工程导师。根据用户近期的关注点，提炼/创作 10 条一句话语录（可以是相关领域的经验法则、名人名言、方法论箴言），每条 ≤ 36 字，实用且有味道。只输出 JSON 字符串数组。',
      ctx.slice(0, 8000),
      false
    )
    if (!res.ok) return `AI 请求失败：${res.error || '未知错误'}`
    try {
      const m = String(res.text || '').match(/\[[\s\S]*\]/)
      const arr = m ? (JSON.parse(m[0]) as unknown[]) : []
      const quotes = arr.map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 12)
      if (!quotes.length) return 'AI 未返回有效语录，请重试'
      setBarCfg((c) => ({ ...c, customQuotes: quotes, modes: c.modes.includes('custom') ? c.modes : [...c.modes, 'custom'] }))
      return `✓ 已生成 ${quotes.length} 条个性语录（模式已启用）`
    } catch {
      return 'AI 返回无法解析，请重试'
    }
  }, [])

  // ===== 快捷指令：增删改 + 恢复默认（持久化） =====
  const promptSave = (q: { id?: number; icon: string; label: string; text: string }): void =>
    setQuickPrompts((l) =>
      q.id
        ? l.map((x) => (x.id === q.id ? { ...x, icon: q.icon, label: q.label, text: q.text } : x))
        : [...l, { id: Date.now(), icon: q.icon, label: q.label, text: q.text }]
    )
  const promptDelete = (id: number): void => setQuickPrompts((l) => l.filter((x) => x.id !== id))
  const promptsReset = (): void => setQuickPrompts(DEFAULT_QUICK_PROMPTS)

  // ===== 其它交互 =====
  const toggleSetting = (k: keyof SettingsFlags): void => {
    if (k === 'sound' && settings.sound) setSoundPickerOpen(false)
    const next = !settings[k]
    setSettings((s) => ({ ...s, [k]: next }))
    // 副作用接系统
    if (k === 'autostart') island.setAutostart(next)
    if (k === 'multiMonitor') island.reposition({ follow: next, monitorIndex: activeMonitor - 1 })
    if (k === 'autoConnect') { if (next) island.installHooks(); else island.uninstallHooks() }
    if (k === 'largeSize') island.setSizeMode(next)
  }

  // ===== 待办操作 =====
  const todoSeq = useRef(0)
  const todoAdd = (text: string, due?: number, priority: 1 | 2 | 3 = 3, repeat: TodoItem['repeat'] = 'none'): void =>
    // id 加自增偏移：AI 批量添加在同一毫秒内不会撞 id
    setTodos((l) => [...l, { id: Date.now() * 100 + (todoSeq.current++ % 100), text, due, done: false, notified: false, priority, repeat, createdAt: Date.now() }])

  // AI 智能添加：口语 → LLM 解析为结构化待办（可一次多条），返回反馈文案
  const aiAddTodo = useCallback(async (input: string): Promise<string> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return '请先在 Settings › 问答助手模型 配置端点、型号与 API Key'
    const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, todoSystemPrompt(), input, false)
    if (!res.ok) return '解析失败：' + (res.error || '未知错误')
    const items = parseAiTodos(res.text)
    if (items.length === 0) {
      todoAdd(input)
      return '未能解析出结构化信息，已按原文添加为普通待办'
    }
    items.forEach((it) => todoAdd(it.text, it.due, it.priority ?? 3, it.repeat ?? 'none'))
    const withTime = items.filter((i) => i.due).length
    return `✓ 已添加 ${items.length} 条待办${withTime ? `（${withTime} 条带定时提醒）` : ''}`
  }, [])
  const todoToggle = (id: number): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : undefined } : t)))
  const todoPin = (id: number): void => setTodos((l) => l.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)))
  // 顺延到明天：有定时则保留原时刻，无定时按明早 9 点
  const todoTomorrow = (id: number): void =>
    setTodos((l) =>
      l.map((t) => {
        if (t.id !== id) return t
        const base = t.due ? new Date(t.due) : new Date(new Date().setHours(9, 0, 0, 0))
        const next = new Date(Date.now() + 86400000)
        next.setHours(base.getHours(), base.getMinutes(), 0, 0)
        return { ...t, due: next.getTime(), notified: false }
      })
    )
  const todoEdit = (id: number, text: string, due?: number): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, text, due, notified: due && due > Date.now() ? false : t.notified } : t)))
  const todoDelete = (id: number): void => setTodos((l) => l.filter((t) => t.id !== id))
  const todoSnooze = (id: number, minutes: number): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, due: Date.now() + minutes * 60000, notified: false } : t)))
  const todoCyclePriority = (id: number): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, priority: (((t.priority || 3) % 3) + 1) as 1 | 2 | 3 } : t)))
  const todoClearDone = (): void => setTodos((l) => l.filter((t) => !t.done))
  const todoSetNote = (id: number, note: string): void => setTodos((l) => l.map((t) => (t.id === id ? { ...t, note } : t)))
  const todoAddSub = (id: number, text: string): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, subs: [...(t.subs || []), { id: Date.now(), text, done: false }] } : t)))
  const todoToggleSub = (id: number, subId: number): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, subs: (t.subs || []).map((s) => (s.id === subId ? { ...s, done: !s.done } : s)) } : t)))
  const todoDeleteSub = (id: number, subId: number): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, subs: (t.subs || []).filter((s) => s.id !== subId) } : t)))
  // 对某个待办开始 25 分钟专注（联动现有专注模式）
  const todoFocus = (t: TodoItem): void => {
    setFocusUntil(Date.now() + 25 * 60 * 1000)
    showToast(`🌙 已开始专注 25 分钟：${t.text.slice(0, 24)}`)
  }
  // 完成待办时来一声轻快提示音
  const todoToggleWithSound = (id: number): void => {
    const target = todos.find((t) => t.id === id)
    if (target && !target.done && settings.sound) playSound('blip')
    todoToggle(id)
  }
  const changeMonitor = (n: number): void => {
    setActiveMonitor(n)
    island.reposition({ follow: settings.multiMonitor, monitorIndex: n - 1 })
  }
  // 选择音效后不关闭选择器，方便逐个试听；顺便播放所选
  // 为某一类通知选声效（选中即试听）
  const setSoundFor = (type: keyof SoundMap, k: string): void => { setSoundMap((m) => ({ ...m, [type]: k })); playSound(k) }
  const previewSound = (e: React.MouseEvent, k: string): void => { e.stopPropagation(); playSound(k) }
  const jump = (a: AgentVM): void => {
    island.jumpToTerminal(a.id).then((ok) => {
      setJumpToast(ok ? `已聚焦到 ${a.tool} 的终端窗口 · ${a.proj}` : `未找到 ${a.proj} 的终端窗口`)
      clearTimeout(jumpTimer.current)
      jumpTimer.current = setTimeout(() => setJumpToast(null), 2400)
    })
  }
  const copyCommit = (id: string, commit: string): void => {
    navigator.clipboard?.writeText(commit).catch(() => {})
    setCopiedId(id)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedId(null), 1800)
  }
  const toggleFocus = (): void => setFocusUntil((f) => (f > 0 && Date.now() < f ? 0 : Date.now() + 25 * 60 * 1000))

  // 拖拽投喂到问答
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    // 真实读取拖入的文件（文本→内容注入提问；图片→dataURL 发视觉模型）
    Array.from(e.dataTransfer?.files || []).forEach((f) => {
      readAttachment(f).then((att) => onAttach('ask', att.type, att))
    })
    setDropActive(false); setRevealed(true); setTab('ask')
  }

  const clock = new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const askEmpty = !(threads['ask'] && threads['ask'].length)
  const askModelLabel = `${(PROVIDERS.find((p) => p.key === llm.provider) || {}).label} · ${llm.model || '未设置'}`

  return (
    <>
      <div style={islandWrap}>
        {/* 静默态：贴住屏幕上边缘的极简指示条（也是悬浮唤出目标）；开启常驻迷你条时由迷你条替代 */}
        <div
          data-solid
          style={{
            position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
            width: isShown ? 240 : 132, height: 5, borderRadius: '0 0 6px 6px',
            background: focusActive ? 'oklch(0.6 0.08 260 / .7)' : hasPending || hasWaiting || hasDueTodo ? 'oklch(0.8 0.13 75 / .85)' : 'oklch(0.6 calc(0.12 * var(--cs, 1)) var(--th) / .5)',
            opacity: isShown || settings.ambientBar ? 0 : 1, transition: 'all .3s ease', pointerEvents: 'none'
          }}
        />
        {/* 常驻迷你条：收起后保留的小状态条（多模式轮播，可自定义），点击展开 */}
        {settings.ambientBar && !isShown && (
          <AmbientBar
            cfg={barCfg}
            media={media}
            pools={barPools}
            width={barCfg.width || 340}
            brief={[
              ...(meetings.filter((m) => m.start > Date.now()).slice(0, 1).map((m) => `⏰ ${new Date(m.start).getHours()}:${String(new Date(m.start).getMinutes()).padStart(2, '0')} ${m.title}（${Math.max(1, Math.round((m.start - Date.now()) / 60000))} 分钟后）`)),
              ...(todos.filter((t) => !t.done && t.due && t.due <= Date.now()).length ? [`⏳ ${todos.filter((t) => !t.done && t.due && t.due <= Date.now()).length} 项待办已到时`] : []),
              ...(agents.filter((a) => a.status !== 'done').length ? [`🤖 ${agents.filter((a) => a.status !== 'done').length} 个 Agent 会话活动中`] : []),
              ...(todos.filter((t) => !t.done).length ? [`📝 今日还剩 ${todos.filter((t) => !t.done).length} 项待办`] : [])
            ]}
            onMediaKey={(cmd) => island.mediaKey(cmd)}
            onOpen={() => setRevealed(true)}
          />
        )}

        {/* 顶部两角的凹弧：把面板融进屏幕上边缘，形成「内角过渡」的灵动一体感 */}
        <div style={{ ...flareBase(isShown), left: -21, background: 'radial-gradient(circle at 0% 100%, transparent 0 21px, oklch(calc(0.15 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.97) 21.5px)' }} />
        <div style={{ ...flareBase(isShown), right: -21, background: 'radial-gradient(circle at 100% 100%, transparent 0 21px, oklch(calc(0.15 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.97) 21.5px)' }} />

        {/* 岛面板：从屏幕上边缘「内弧」滑出，顶部与屏幕齐平、底部圆弧，营造灵动一体感 */}
        <div
          data-solid
          onDragOver={(e) => { e.preventDefault(); if (!dropActive) setDropActive(true) }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDropActive(false) }}
          onDrop={onDrop}
          style={{
            position: 'relative', width: settings.largeSize ? 880 : islandWidth,
            transformOrigin: 'top center',
            transform: isShown ? 'translateY(0)' : 'translateY(-101%)',
            opacity: isShown ? 1 : 0,
            pointerEvents: isShown ? 'auto' : 'none',
            overflow: 'hidden',
            borderRadius: '0 0 26px 26px',
            background: 'oklch(calc(0.15 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.97)', backdropFilter: 'blur(26px) saturate(160%)',
            borderLeft: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / 0.22)', borderRight: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / 0.22)',
            borderBottom: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / 0.28)', borderTop: 'none',
            boxShadow: isShown ? '0 16px 44px -12px rgba(0,0,0,.55)' : 'none',
            // 平缓缓出、无回弹，避免"蹦一下"
            transition: 'transform .5s cubic-bezier(.22,.61,.36,1), opacity .4s ease',
            boxSizing: 'border-box'
          }}
        >
          {dropActive && (
            <div style={{ position: 'absolute', inset: 6, zIndex: 20, borderRadius: 16, border: '2px dashed oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .7)', background: 'oklch(0.2 calc(0.03 * var(--css, 1)) var(--ths) / .82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
              <div style={{ fontSize: 26 }}>📥</div>
              <div style={{ color: 'oklch(0.92 0.03 var(--th))', fontSize: 13, fontWeight: 600 }}>松手投喂到问答助手</div>
              <div style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 11 }}>图片 / 文件都可以</div>
            </div>
          )}

          {/* header */}
          <div style={{ padding: '16px 16px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
              <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.62 calc(0.15 * var(--cs, 1)) var(--th2)))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🝔</div>
              <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 13.5, fontWeight: 600 }}>Agentic-Island</span>
              <span style={{ marginLeft: 'auto', color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 11 }}>{clock}</span>
              <div className="hv" title={settings.largeSize ? '切回标准尺寸' : '切到大尺寸工作台'} onClick={() => toggleSetting('largeSize')} style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12, background: settings.largeSize ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .22)' : 'rgba(255,255,255,.05)', color: settings.largeSize ? 'oklch(0.85 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.7 0.02 var(--th) / .55)' }}>
                {settings.largeSize ? '⤡' : '⤢'}
              </div>
              <div title="专注模式（静默 25 分钟）" onClick={toggleFocus} style={{ height: 26, padding: '0 9px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', transition: 'all .18s', background: focusActive ? 'oklch(0.4 0.08 260 / .5)' : 'rgba(255,255,255,.05)', color: focusActive ? 'oklch(0.82 0.1 260)' : 'oklch(0.7 0.02 var(--th) / .55)', fontSize: 12 }}>
                🌙{focusActive && <span style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{focusMMSS}</span>}
              </div>
              <div title="贴住 / 取消贴住" onClick={() => { setPinned((v) => !v); setRevealed(true) }} style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, transition: 'all .18s', background: pinned ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .22)' : 'rgba(255,255,255,.05)', color: pinned ? 'oklch(0.85 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.7 0.02 var(--th) / .55)', transform: pinned ? 'rotate(0deg)' : 'rotate(38deg)' }}>📌</div>
              {/* 一键开关常驻迷你条（避免遮挡工作界面时快速关掉） */}
              <div className="hv" title={settings.ambientBar ? '关闭常驻迷你条' : '开启常驻迷你条'} onClick={() => toggleSetting('ambientBar')} style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12, background: settings.ambientBar ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .22)' : 'rgba(255,255,255,.05)', color: settings.ambientBar ? 'oklch(0.85 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.7 0.02 var(--th) / .55)' }}>〰</div>
              {/* 收起：即使有待处理也能收回（开会等场景）；有新请求会重新弹出。快捷键 Esc */}
              <div className="hv" title="收起（Esc）· 有新请求会重新弹出" onClick={snoozeNow} style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, background: 'rgba(255,255,255,.05)', color: 'oklch(0.7 0.02 var(--th) / .55)' }}>⌄</div>
            </div>
            {/* Tab 栏：窄屏不换行不变形，横向滚动兜底 */}
            <div className="ai-scroll" style={{ display: 'flex', gap: 5, marginBottom: 14, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
              {TABS.map(({ key, label }) => (
                <div key={key} className="hv" onClick={() => setTab(key)} style={tabStyle(tab === key)}>
                  {label}
                  {key === 'agents' && (hasPending || hasWaiting) && <span style={{ marginLeft: 5, display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 75)', verticalAlign: 'middle' }} />}
                  {key === 'plan' && pending.some((a) => a.isPlan) && <span style={{ marginLeft: 5, display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 75)', verticalAlign: 'middle' }} />}
                  {key === 'todos' && hasDueTodo && <span style={{ marginLeft: 5, display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 75)', verticalAlign: 'middle' }} />}
                  {key === 'todos' && !hasDueTodo && todos.filter((t) => !t.done).length > 0 && (
                    <span style={{ marginLeft: 5, fontSize: 9.5, opacity: 0.75 }}>{todos.filter((t) => !t.done).length}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="ai-scroll" style={{ padding: '0 8px 16px 16px', margin: '0 4px 0 0', maxHeight: settings.largeSize ? 'calc(100vh - 130px)' : 500, overflowY: 'auto' }}>
            {tab === 'agents' && (
              <AgentsTab
                agents={agents} armed={armed} autoAllowSafe={autoAllowSafe} onToggleAutoAllow={() => setAutoAllowSafe((v) => !v)}
                onDecide={decide}
                onJump={jump} onCopyCommit={copyCommit} copiedId={copiedId} waitSecs={waitSecs}
              />
            )}
            {tab === 'plan' && <PlanTab plans={pending.filter((a) => a.isPlan)} onDecide={decide} onJump={jump} waitSecs={waitSecs} />}
            {tab === 'ask' && (
              <AskTab
                modelLabel={askModelLabel} onOpenLlmSettings={() => { setTab('settings'); setLlm((s) => ({ ...s, open: true })) }}
                models={[
                  // 当前厂商的型号列表：同端点同 Key，切换零成本
                  ...(llm.modelLists[llm.provider] || []).map((m) => ({ id: 'm:' + m, name: m, active: m === llm.model })),
                  // 已保存的跨厂商配置（排除与当前端点重复的）
                  ...llm.saved.filter((c) => !(c.provider === llm.provider && c.baseUrl === llm.baseUrl)).map((c) => ({ id: 'c:' + c.id, name: c.name, active: false }))
                ]}
                onSwitchModel={(id) => (id.startsWith('m:') ? pickModel(id.slice(2)) : loadLlm(Number(id.slice(2))))}
                empty={askEmpty}
                mode={askMode} onSetMode={setAskMode}
                suggestions={[
                  { label: '如何安全地做 git rebase？', go: () => sendPreset('ask', '如何安全地做 git rebase？', askMode === 'deep') },
                  { label: '怎么精简 Docker 镜像体积？', go: () => sendPreset('ask', '怎么精简 Docker 镜像体积？', askMode === 'deep') }
                ]}
                conv={convFor('ask', askMode === 'deep' ? '深度思考模式 · 提问后展示思维链…' : '有问题随时问，支持追问（AI 记得上文）…', undefined, askMode === 'deep')}
                sessions={askSessions.map((s) => ({ id: s.id, title: s.title }))}
                onNew={askNew} onSwitch={askSwitch} onDeleteSession={askDelete}
                onRetry={() => retryLast('ask', askMode === 'deep')}
                prompts={quickPrompts}
                onSavePrompt={promptSave} onDeletePrompt={promptDelete} onResetPrompts={promptsReset}
                clips={clips}
                onRemoveClip={(i) => setClips((l) => l.filter((_, x) => x !== i))}
                onClearClips={() => setClips([])}
                onSendClip={(text) => sendPreset('ask', text, askMode === 'deep')}
              />
            )}
            {tab === 'todos' && (
              <TodoTab
                todos={todos} onAdd={todoAdd} onAiAdd={aiAddTodo} onToggle={todoToggleWithSound} onEdit={todoEdit} onDelete={todoDelete}
                onSnooze={todoSnooze} onCyclePriority={todoCyclePriority} onClearDone={todoClearDone}
                onSetNote={todoSetNote} onAddSub={todoAddSub} onToggleSub={todoToggleSub} onDeleteSub={todoDeleteSub} onFocus={todoFocus}
                onPin={todoPin} onTomorrow={todoTomorrow}
                onAiBreakdown={aiBreakdown}
                meetings={meetings} onJoinMeeting={(link) => island.openExternal(link)}
              />
            )}
            {tab === 'notes' && (
              <NotesTab
                notes={notes}
                onAdd={noteAdd} onUpdate={noteUpdate} onDelete={noteDelete} onTogglePin={noteTogglePin}
                onAiCreate={aiCreateNote} onAiSearch={aiSearchNotes}
              />
            )}
            {tab === 'news' && (
              <NewsTab
                sources={feedSources}
                items={feedItems}
                refreshing={feedRefreshing}
                lastRefresh={feedLastRefresh}
                aiEnrich={feedAiEnrich}
                onToggleAiEnrich={() => setFeedAiEnrich((v) => !v)}
                minScore={feedMinScore}
                onSetMinScore={setFeedMinScore}
                interests={feedInterests}
                onSetInterests={setFeedInterests}
                proc={feedProc}
                onProcessNow={() => void processPipeline()}
                dailies={feedDailies}
                onRefresh={() => void refreshFeeds()}
                onToggleSource={(id) => {
                  const src = feedSources.find((s) => s.id === id)
                  setFeedSources((l) => l.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
                  // 停用源 → 立即清掉它已入库的条目（收藏例外）——修复"取消了源但内容还在"
                  if (src?.enabled) setFeedItems((l) => l.filter((i) => i.fav || i.sourceName !== src.name))
                }}
                onAddSource={(name, url) => setFeedSources((l) => [...l, { id: 'u' + Date.now(), name, url, enabled: true }])}
                onRemoveSource={(id) => setFeedSources((l) => l.filter((s) => s.id !== id))}
                onMarkRead={(id) => setFeedItems((l) => l.map((i) => (i.id === id ? { ...i, read: true } : i)))}
                onToggleFav={(id) => setFeedItems((l) => l.map((i) => (i.id === id ? { ...i, fav: !i.fav } : i)))}
                onHide={(id) => { setFeedItems((l) => l.filter((i) => i.id !== id)); setFeedHidden((h) => [id, ...h].slice(0, 300)) }}
                onDaily={feedDaily}
                onSaveDailyToNotes={(md) => {
                  const d = new Date()
                  const now3 = Date.now()
                  setNotes((l) => [{ id: now3, emoji: '🗞️', title: `AI 日报 ${d.getMonth() + 1}/${d.getDate()}`, md, color: 'sky', tags: ['日报', '资讯'], createdAt: now3, updatedAt: now3 }, ...l].slice(0, 400))
                }}
                onSaveItemToNotes={(it) => {
                  const now3 = Date.now()
                  const md = `${it.summary || it.brief || ''}\n\n> 来源：${it.sourceName} · [打开原文](${it.link})`
                  setNotes((l) => [{ id: now3, emoji: '📰', title: it.title.slice(0, 40), md, color: 'sky', tags: ['资讯', it.tag || '其它'], source: it.link, createdAt: now3, updatedAt: now3 }, ...l].slice(0, 400))
                }}
              />
            )}
            {tab === 'term' && <TerminalTab tall={settings.largeSize} />}
            {tab === 'settings' && (
              <SettingsTab
                settings={settings} onToggle={toggleSetting}
                soundMap={soundMap} soundPickerOpen={soundPickerOpen} onToggleSoundPicker={() => settings.sound && setSoundPickerOpen((v) => !v)} onSetSound={setSoundFor} onPreviewSound={previewSound}
                activeMonitor={activeMonitor} monitorPreviewOpen={monitorPreviewOpen} onToggleMonitorPreview={() => setMonitorPreviewOpen((v) => !v)} onSetMonitor={changeMonitor}
                llm={llm} onToggleLlm={() => setLlm((s) => ({ ...s, open: !s.open }))} onSetProvider={setProvider} onSetLlmField={setLlmField} onTestLlm={testLlm} onSaveLlm={saveLlm} onLoadLlm={loadLlm} onDeleteLlm={deleteLlm}
                onAddModel={addModel} onRemoveModel={removeModel} onPickModel={pickModel}
                icsUrl={icsUrl} onSetIcsUrl={setIcsUrl} calMsg={calMsg}
                caldav={caldav} onSetCaldav={setCaldav}
                barCfg={barCfg} onSetBarCfg={setBarCfg} onAiBarQuotes={aiGenBarQuotes} onRefreshBarContent={refreshBarPools}
                islandWidth={islandWidth} onSetIslandWidth={setIslandWidth}
                fontChoice={fontChoice} onSetFontChoice={setFontChoice}
                uiZoom={uiZoom} onSetUiZoom={setUiZoom}
                onQuitApp={() => island.quitApp()}
                onInstallHooks={() => island.installHooks()} onUninstallHooks={() => island.uninstallHooks()}
                theme={theme} onSetTheme={setTheme}
              />
            )}
          </div>
        </div>
      </div>

      {/* toasts */}
      {toast && (
        <div data-solid style={toastStyle}>
          <div style={{ width: 20, height: 20, borderRadius: 999, background: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'oklch(0.14 0.02 var(--th))', fontSize: 12, fontWeight: 800 }}>✓</div>
          <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 12.5, fontWeight: 500 }}>{toast}</span>
          <span style={{ color: 'oklch(0.7 0.02 var(--th) / .55)', fontSize: 11, cursor: 'pointer' }} onClick={() => setToast(null)}>✕</span>
        </div>
      )}
      {jumpToast && (
        <div style={{ position: 'fixed', top: 'calc(100vh - 78px)', left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', borderRadius: 999, background: 'oklch(calc(0.18 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.9)', backdropFilter: 'blur(20px)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / 0.3)', color: 'oklch(0.9 0.02 var(--th))', fontSize: 12, boxShadow: '0 14px 34px rgba(0,0,0,.5)' }}>↗ {jumpToast}</div>
      )}
    </>
  )
}

const islandWrap: React.CSSProperties = {
  position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  fontFamily: "'Segoe UI',system-ui,-apple-system,sans-serif"
}
const flareBase = (shown: boolean): React.CSSProperties => ({
  position: 'absolute', top: 0, width: 22, height: 22, zIndex: 1,
  transform: shown ? 'translateY(0)' : 'translateY(-101%)',
  opacity: shown ? 1 : 0,
  transition: 'transform .5s cubic-bezier(.22,.61,.36,1), opacity .4s ease',
  pointerEvents: 'none'
})
const toastStyle: React.CSSProperties = {
  position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10,
  padding: '11px 16px', borderRadius: 999, background: 'oklch(calc(0.15 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.95)', backdropFilter: 'blur(22px) saturate(160%)',
  border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / 0.35)', boxShadow: '0 18px 40px rgba(0,0,0,.5)', animation: 'ai-toast .34s cubic-bezier(.34,1.3,.64,1)'
}
function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 999, font: "600 12px 'Segoe UI',sans-serif", cursor: 'pointer', transition: 'all .16s',
    flex: 'none', whiteSpace: 'nowrap', // 窄屏下不许换行/压缩变形

    background: active ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.05)',
    color: active ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.78 0.02 var(--th) / .7)'
  }
}
