import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { AgentCliEvent, CalendarEvent, DisplayInfo, GitHubRepo, IslandSnapshot, KbSourceView, LlmRequestConfig, RuntimeInfo } from '../../shared/protocol'
import type { ActivityEntry, AgentLive, AgentVM, AnswerAnalysisAction, AskBranchMeta, AskSession, Block, ChatMessage, ChatProps, ClipItem, Composer, FeedItem, FeedSource, NewsWatch, QuickPrompt, QuoteRef, StickyNote, TodoItem, WorkArtifact, WorkbenchProject, WorkflowRun } from './types'
import type { BarConfig } from './types'
import { emptyComposer, DEFAULT_BAR_CONFIG } from './types'
import { DEFAULT_QUICK_PROMPTS } from './logic/prompts'
import { readAttachment, attachmentsToPrompt, downscaleDataUrl } from './logic/files'
import { tagOf } from './logic/clip'
import { CLUSTER_SYSTEM, clusterPrompt, parseClusters } from './logic/clipCluster'
import { noteSystemPrompt, parseAiNote, noteSearchPrompt, parseSearchIds } from './logic/noteAi'
import { BUILTIN_POOLS, barRefreshPrompt, parseBarRefresh } from './logic/barContent'
import { ambientTextWindow, buildAmbientTextDeck, clampBarRotation, deriveAmbientStatus, type AmbientTextItem } from './logic/ambientBar'
import { PRESET_FEEDS, DEFAULT_FEED_INTERESTS, linkId, dailyPrompt, parseDaily, processPrompt, parseProcess, titleBlocked } from './logic/rssAi'
import { capsuleSystemPrompt, parseCapsule, type CapsuleResult } from './logic/capsuleAi'
import { Capsule } from './components/Capsule'
import { ScreenshotAsk } from './components/ScreenshotAsk'
import { ScreenshotStudio } from './components/ScreenshotStudio'
import { CommandPalette, type Command } from './components/CommandPalette'
import { BrainSearch } from './components/BrainSearch'
import { KnowledgePanel } from './components/KnowledgePanel'
import { KB_SYSTEM, kbGroundPrompt, citeSources } from './logic/kbAsk'
import { MarkdownStudio } from './components/MarkdownStudio'
import { riskOf } from './logic/risk'
import { playSound, DEFAULT_SOUND_MAP, type SoundMap } from './logic/sounds'
import { PROVIDERS, loadProviderSettings, migrateEmbeddingSettings, migrateProviderSettings, patchProviderDraft, providerConfigEquals, providerModelChoices, saveProviderSettings, switchProviderSettings } from './logic/providers'
import { ADVANCE_PROMPTS, branchMergePrompt, buildAgentContextPrompt, buildQuotedPrompt, compactChatMessages, conversationBusy, conversationTitle, conversationToMarkdown, forkConversation, historyFromThread, looseBlocks, parseBlocks, systemFor, upsertAnswerAnalysis } from './logic/chat'
import { applyThemeAny, makeCustomTheme, normalizeThemeTokens, THEMES, type ThemeDef } from './logic/themes'
import { ThemeDesigner, type Tokens } from './components/ThemeDesigner'
import { CalcSheet } from './components/CalcSheet'
import { LearnCenter, type RadarItem } from './components/LearnCenter'
import { schedule, NEW_CARD, type SrsCard, type Grade } from './logic/srs'
import { dayKey, buildFacts, hasContent, reviewPrompt, REVIEW_SYSTEM, morningPrompt, MORNING_SYSTEM, type MorningInput } from './logic/review'
import { DEFAULT_POMO, POMO_IDLE, nextPhase, startWork, phaseLabel, remainSecs, fmtMMSS, type PomoState, type PomoConfig } from './logic/pomodoro'
import { todoSystemPrompt, parseAiTodos } from './logic/todoAi'
import { AgentsTab } from './components/AgentsTab'
import { PlanTab } from './components/PlanTab'
import { AskTab } from './components/AskTab'
import { TodoTab } from './components/TodoTab'
import { NotesTab } from './components/NotesTab'
import { NewsTab } from './components/NewsTab'
import { ReviewTab } from './components/ReviewTab'
import { ReposTab } from './components/ReposTab'
import { TerminalTab } from './components/TerminalTab'
import { AmbientBar, type BarMedia } from './components/AmbientBar'
import { SettingsTab, type LlmState, type SettingsFlags } from './components/SettingsTab'
import { ShortcutsTab } from './components/ShortcutsTab'
import { PRESET_SHORTCUTS, type ShortcutDef } from './logic/shortcuts'
import { migrateProjects, newProject } from './logic/workbench'
import { synthesisPrompt } from './logic/newsIntel'
import { island } from './bridge'
import { motion } from 'framer-motion'
import { ArrowUpRight, BellOff, Camera, Check, ChevronDown, Download, Expand, Maximize2, Minimize2, Moon, Pin, Shrink, Timer, Video, Waves, X } from 'lucide-react'
import { accent, fill, gradient, hairline, ink } from './ui/tokens'
import { Ico } from './ui/icons'

type Tab = 'agents' | 'plan' | 'ask' | 'shortcuts' | 'todos' | 'notes' | 'news' | 'review' | 'repos' | 'term' | 'settings'
const TABS: { key: Tab; label: string; icon: (typeof Ico)[keyof typeof Ico] }[] = [
  { key: 'agents', label: 'Agents', icon: Ico.agent },
  { key: 'plan', label: 'Plan', icon: Ico.plan },
  { key: 'ask', label: '问答', icon: Ico.ask },
  { key: 'shortcuts', label: '快捷', icon: Ico.shortcuts },
  { key: 'todos', label: '待办', icon: Ico.todos },
  { key: 'notes', label: '灵感便签', icon: Ico.notes },
  { key: 'news', label: '资讯', icon: Ico.news },
  { key: 'review', label: '复盘', icon: Ico.review },
  { key: 'repos', label: '仓库', icon: Ico.repos },
  { key: 'term', label: '终端', icon: Ico.term },
  { key: 'settings', label: '设置', icon: Ico.settings }
]
const DEFAULT_LLM_SETTINGS = migrateProviderSettings({ provider: 'deepseek' })
const llmModelLabel = (state: Pick<LlmState, 'provider' | 'model'>): string => {
  const provider = PROVIDERS.find((item) => item.key === state.provider)
  return `${provider?.label || state.provider} · ${state.model || '未设置'}`
}
const AMBIENT_SUGGESTION_LABELS: Record<string, string> = {
  quotes: '名言', exp: '经验', agent: 'Agent', thermal: '热管理', github: 'GitHub', custom: '自定义', brief: '工作简报'
}

const ambientSuggestionPrompt = (item: AmbientTextItem): string => {
  if (item.mode === 'brief') return `请根据这条实时工作状态，帮我判断优先级并给出下一步行动：\n${item.text}`
  if (item.mode === 'github') return `请介绍并评估这条 GitHub 热门内容，说明它是否值得我进一步关注：\n${item.text}`
  return `请结合软件开发和我的实际工作场景，展开这条灵感，并给出 3 条可执行建议：\n${item.text}`
}

const ANSWER_ANALYSIS_LABELS: Record<Exclude<AnswerAnalysisAction, 'council'>, string> = {
  critique: '检查漏洞',
  assumptions: '检查前提',
  alternatives: '替代方案',
  decompose: '执行步骤',
  socratic: '澄清问题',
  ground: '资料核对',
  suggest: '下一步问题'
}

const newAskBranch = (title = '新会话', parentId?: number, forkAt?: number): AskBranchMeta => {
  const now = Date.now()
  return { id: now * 100 + Math.floor(Math.random() * 100), title, parentId, forkAt, createdAt: now, updatedAt: now, memory: '', instruction: '' }
}

// 桌面挂件「AI 速览」系统提示：只回一句极短中文提点
const WIDGET_BRIEF_SYSTEM =
  '你是桌面挂件里的贴身助理。根据用户当下的时间、待办、日程与 Agent 状态，用一句不超过 22 个汉字的中文，' +
  '给出此刻最值得做的一件事或一句恰当提点（可略带鼓励）。只输出这一句话，不要引号、不要解释、不要标点堆砌。'

const RECORDING_STUDIO_CONTEXT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNkYGD4z8DAwMDEAAUADikBA7xgG3sAAAAASUVORK5CYII='

export function App(): React.JSX.Element {
  // 真实快照（唯一 Agent 数据源）
  const [snap, setSnap] = useState<IslandSnapshot>({ agents: [] })
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [bridgeConnected, setBridgeConnected] = useState(false)

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
  // 番茄钟：状态机 + 每日完成计数（喂复盘/洞察）；配置暂用默认
  const [pomo, setPomo] = useState<PomoState>(POMO_IDLE)
  const [pomoCfg] = useState<PomoConfig>(DEFAULT_POMO)
  const [pomoDone, setPomoDone] = useState<Record<string, number>>({})
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState<string | null>(null)
  const [jumpToast, setJumpToast] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const dropTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // 面板实际矩形（keepOpen 热区按它算，而非硬编码 260px）+ 最近一次面板内点击时间（点击后 1.2s 防误收起——
  // 点按钮导致内容收缩、光标瞬间落到面板外时，岛不再"回缩又弹回"地抖）
  const panelRef = useRef<HTMLDivElement>(null)
  const lastClickRef = useRef(0)
  const keyboardFocusRef = useRef(false)
  const releasePanelKeyboardFocus = useCallback((): void => {
    keyboardFocusRef.current = false
    const active = document.activeElement
    if (active instanceof HTMLElement && panelRef.current?.contains(active)) active.blur()
  }, [])
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
  const [newsWatches, setNewsWatches] = useState<NewsWatch[]>([])
  const feedSourcesRef = useRef(feedSources); feedSourcesRef.current = feedSources
  const feedItemsRef = useRef(feedItems); feedItemsRef.current = feedItems
  const feedHiddenRef = useRef(feedHidden); feedHiddenRef.current = feedHidden
  const feedAiRef = useRef(feedAiEnrich); feedAiRef.current = feedAiEnrich
  const feedBusyRef = useRef(false)
  // 正在播放的媒体（迷你条音乐模式启用时轮询 SMTC）
  const [media, setMedia] = useState<BarMedia | null>(null)
  // 闪念胶囊（全局热键 Ctrl+Alt+Space 唤出）
  const [capsuleOpen, setCapsuleOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [brainOpen, setBrainOpen] = useState(false)
  // 第二大脑向量连接与问答模型完全独立，避免切换聊天供应商后破坏 RAG。
  const [embedConfig, setEmbedConfig] = useState<LlmRequestConfig>({ baseUrl: '', apiKey: '', model: '' })
  const embedModel = embedConfig.model
  const setEmbedModel = useCallback((model: string): void => setEmbedConfig((value) => ({ ...value, model })), [])
  // 知识库（本地 RAG）：管理浮层 + 问答"知识库模式"开关 + 已接入源（供问答计数/检索）
  const [kbOpen, setKbOpen] = useState(false)
  const [kbMode, setKbMode] = useState(false)
  const [kbSources, setKbSources] = useState<KbSourceView[]>([])
  const kbModeRef = useRef(false); kbModeRef.current = kbMode
  const embedConfigRef = useRef(embedConfig); embedConfigRef.current = embedConfig
  const refreshKb = useCallback((): void => { void island.kbList().then(setKbSources) }, [])
  // 问答引擎：llm=云端模型；claude/codex=本机 CLI 无头模式（继承本地全部技能/工具/MCP 配置）
  const [askEngine, setAskEngine] = useState<'llm' | 'claude' | 'codex'>('llm')
  const [agentCwd, setAgentCwd] = useState('')
  const askEngineRef = useRef<'llm' | 'claude' | 'codex'>('llm'); askEngineRef.current = askEngine
  const agentCwdRef = useRef(''); agentCwdRef.current = agentCwd
  // Markdown 工作台：id=null 为草稿(保存时新建便签)，否则回写该便签
  const [studio, setStudio] = useState<{ id: number | null; title: string; md: string } | null>(null)
  // 主题设计器 + 用户自定义主题
  const [customThemes, setCustomThemes] = useState<ThemeDef[]>([])
  const [themeDesignerOpen, setThemeDesignerOpen] = useState(false)
  // 二次编辑自定义主题：非空 = 设计器处于"编辑该 key"模式（保存原地更新而非新建）
  const [themeEditKey, setThemeEditKey] = useState<string | null>(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const [calcSheet, setCalcSheet] = useState('# 工程计算 · 变量可跨行引用\nr = 0.05\narea = PI * r**2\ncToK(90)\navg(23, 25, 27)')
  // 多仓库仪表盘：钉的本地仓库 + GitHub Token（本机加密存储）
  const [repos, setRepos] = useState<{ path: string }[]>([])
  const [githubToken, setGithubToken] = useState('')
  const [repoBookmarks, setRepoBookmarks] = useState<GitHubRepo[]>([])
  // ⚡ 快捷指令：首装播种预置；有存档则整体覆盖（删除即真删，「恢复预置」可找回）
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(PRESET_SHORTCUTS)
  const [shortcutRunId, setShortcutRunId] = useState<string | null>(null)
  // 学习中心：SRS 复习状态 + 技术雷达
  const [learnOpen, setLearnOpen] = useState(false)
  const [srsState, setSrsState] = useState<Record<number, SrsCard>>({})
  const [radar, setRadar] = useState<RadarItem[]>([])
  // 剪贴板 AI 聚类：id → 组名（仅内存）
  const [clipGroups, setClipGroups] = useState<Record<number, string>>({})
  const [clipClustering, setClipClustering] = useState(false)
  // 智能截图问 AI（全局热键 Ctrl+Alt+S 框选后弹出）
  const [shotImg, setShotImg] = useState<string | null>(null)
  // 截图工坊：截图目标由主进程随结果回传，不依赖取消后可能残留的渲染层 ref。
  const [shotStudio, setShotStudio] = useState<string | null>(null)
  const [shotStudioMode, setShotStudioMode] = useState<'image' | 'record'>('image')
  // 迷你条动态内容池：AI 每 10 分钟刷新 + GitHub 热门（内存态，重启重新拉）
  const [aiPools, setAiPools] = useState<Record<string, string[]>>({})
  const [ghItems, setGhItems] = useState<string[]>([])
  const [askSuggestionCursor, setAskSuggestionCursor] = useState(() => Math.floor(Math.random() * 997))
  // 问答历史会话（归档）
  const [askSessions, setAskSessions] = useState<AskSession[]>([])
  const [activeAskBranch, setActiveAskBranch] = useState<AskBranchMeta>(() => newAskBranch())
  // 项目工作台：资讯、待办和快捷执行共享项目、运行记录与成果物
  const [workbenchProjects, setWorkbenchProjects] = useState<WorkbenchProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([])
  const [workArtifacts, setWorkArtifacts] = useState<WorkArtifact[]>([])

  // 设置
  const [settings, setSettings] = useState<SettingsFlags>({
    autostart: true, multiMonitor: false, sound: true, silentBg: false, autoConnect: true, largeSize: false,
    claudeCli: true, claudeApp: true, codexCli: true, codexApp: true, clipWatch: true, ambientBar: false, meetingDnd: false,
    ruleMorning: false, ruleEvening: false, rulePomoCapsule: false, ruleMeetingNote: false, desktopWidget: false
  })
  // 智能勿扰：主进程会议检测态
  const [meetingActive, setMeetingActive] = useState(false)
  // 飞书日历：CalDAV（官方支持，主通道）或 ICS 订阅（备选）+ 解析所得会议 + 剪贴板历史（仅内存）
  const [icsUrl, setIcsUrl] = useState('')
  const [caldav, setCaldav] = useState({ server: '', username: '', password: '' })
  const [calMsg, setCalMsg] = useState('')
  const [meetings, setMeetings] = useState<CalendarEvent[]>([])
  const [clips, setClips] = useState<ClipItem[]>([])
  // 复盘：Agent 活动流水（易逝快照 → 当天可复盘）+ 已生成的复盘/周报（键 d:/w: 前缀）
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([])
  const [reviews, setReviews] = useState<Record<string, string>>({})
  // Tab 栏横滑：隐藏滚动条，用边缘渐隐暗示两侧还有可滑内容
  const [tabFade, setTabFade] = useState<{ l: boolean; r: boolean }>({ l: false, r: false })
  // 灵动岛整体宽度（标准模式面板宽，380–880）
  const [islandWidth, setIslandWidth] = useState(468)
  // 全屏模式：窗口 + 面板铺满当前显示器
  const [fullscreen, setFullscreen] = useState(false)
  // 界面字体与缩放（清晰度：透明窗口无亚像素渲染，缩放+换字体可显著改善）
  const [fontChoice, setFontChoice] = useState('default')
  const [uiZoom, setUiZoom] = useState(1)
  // 按通知类型的声效映射（等待回复/一般审批/危险审批/待办会议）
  const [soundMap, setSoundMap] = useState<SoundMap>(DEFAULT_SOUND_MAP)
  const [soundPickerOpen, setSoundPickerOpen] = useState(false)
  const [monitorPreviewOpen, setMonitorPreviewOpen] = useState(false)
  const [activeMonitor, setActiveMonitor] = useState(1)
  // 真实显示器列表（设置页选择用；展开预览时刷新）
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  useEffect(() => { island.getDisplays().then(setDisplays).catch(() => { /* 忽略 */ }) }, [])
  const [llm, setLlm] = useState<LlmState>({
    open: false, ...DEFAULT_LLM_SETTINGS, testStatus: 'idle', testMsg: ''
  })

  const llmRef = useRef(llm)
  llmRef.current = llm
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  const quotesRef = useRef(quotes)
  quotesRef.current = quotes
  const activeAskBranchRef = useRef(activeAskBranch)
  activeAskBranchRef.current = activeAskBranch
  // 自动化规则用：始终读到最新的 reviews / 复盘素材，避免闭包陈旧
  const reviewsRef = useRef(reviews)
  reviewsRef.current = reviews
  const factsRef = useRef({ todos, activityLog })
  factsRef.current = { todos, activityLog }
  const waitStartRef = useRef<Record<string, number>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastIgnore = useRef<boolean>(true)
  const tabBarRef = useRef<HTMLDivElement>(null)

  // 托盘"展开灵动岛"
  useEffect(() => island.onReveal(() => setRevealed(true)), [])

  const hydrated = useRef(false)
  useEffect(() => {
    island.getRuntimeInfo().then(setRuntimeInfo).catch(() => setRuntimeInfo(null))
    island.getSnapshot().then((next) => { setSnap(next); setBridgeConnected(true) }).catch(() => setBridgeConnected(false))
    const off = island.onSnapshot((next) => { setSnap(next); setBridgeConnected(true) })
    // 载入持久化配置
    island.loadState().then((s) => {
      // 只水合一次：React StrictMode(dev) 会双调用本 effect，之前的"前插合并"会导致每次重启待办翻倍
      if (hydrated.current) return
      hydrated.current = true
      if (s) {
        const hydratedLlm = s.llm ? migrateProviderSettings(s.llm) : DEFAULT_LLM_SETTINGS
        if (s.settings) setSettings((v) => ({ ...v, ...(s.settings as Partial<SettingsFlags>) }))
        if (s.soundMap && typeof s.soundMap === 'object') setSoundMap((v) => ({ ...v, ...(s.soundMap as Partial<SoundMap>) }))
        if (typeof s.activeMonitor === 'number') setActiveMonitor(s.activeMonitor)
        // 覆盖（不是合并）：启动水合时持久化数据是唯一真源
        if (Array.isArray(s.todos)) setTodos(s.todos as TodoItem[])
        if (typeof s.theme === 'string') setTheme(s.theme)
        if (Array.isArray(s.customThemes)) setCustomThemes(s.customThemes as ThemeDef[])
        if (typeof s.calcSheet === 'string') setCalcSheet(s.calcSheet)
        if (Array.isArray(s.repos)) setRepos(s.repos as { path: string }[])
        if (typeof s.githubToken === 'string') setGithubToken(s.githubToken)
        if (Array.isArray(s.repoBookmarks)) setRepoBookmarks(s.repoBookmarks as GitHubRepo[])
        if (Array.isArray(s.shortcuts)) setShortcuts(s.shortcuts as ShortcutDef[])
        if (s.askEngine === 'llm' || s.askEngine === 'claude' || s.askEngine === 'codex') setAskEngine(s.askEngine)
        if (typeof s.agentCwd === 'string') setAgentCwd(s.agentCwd)
        if (s.srsState && typeof s.srsState === 'object') setSrsState(s.srsState as Record<number, SrsCard>)
        if (Array.isArray(s.radar)) setRadar(s.radar as RadarItem[])
        setEmbedConfig(migrateEmbeddingSettings(s.embeddingConfig, s.embedModel, hydratedLlm))
        if (Array.isArray(s.askThread)) {
          const askThread = s.askThread as ChatMessage[]
          setThreads((th) => ({ ...th, ask: askThread }))
          // 旧版只有 askThread、没有活动分支元数据：首次升级时从首问生成稳定根分支标题。
          if (!s.activeAskBranch) setActiveAskBranch({ ...newAskBranch(conversationTitle(askThread)), createdAt: askThread[0]?.ts || Date.now() })
        }
        if (Array.isArray(s.askSessions)) setAskSessions(s.askSessions as AskSession[])
        if (s.activeAskBranch && typeof s.activeAskBranch === 'object') setActiveAskBranch((v) => ({ ...v, ...(s.activeAskBranch as Partial<AskBranchMeta>) }))
        const migratedProjects = migrateProjects(s)
        setWorkbenchProjects(migratedProjects)
        if (typeof s.activeProjectId === 'string' && migratedProjects.some((p) => p.id === s.activeProjectId)) setActiveProjectId(s.activeProjectId)
        if (Array.isArray(s.workflowRuns)) setWorkflowRuns((s.workflowRuns as WorkflowRun[]).slice(0, 100))
        if (Array.isArray(s.workArtifacts)) setWorkArtifacts((s.workArtifacts as WorkArtifact[]).slice(0, 100))
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
        if (Array.isArray(s.clipFavs)) setClips(s.clipFavs as ClipItem[])
        if (Array.isArray(s.activityLog)) setActivityLog(s.activityLog as ActivityEntry[])
        if (s.reviews && typeof s.reviews === 'object') setReviews(s.reviews as Record<string, string>)
        if (s.pomoDone && typeof s.pomoDone === 'object') setPomoDone(s.pomoDone as Record<string, number>)
        if (s.pomo && typeof s.pomo === 'object' && (s.pomo as PomoState).endsAt > Date.now()) setPomo(s.pomo as PomoState)
        if (typeof s.feedInterests === 'string' && s.feedInterests.trim()) setFeedInterests(s.feedInterests)
        if (typeof s.feedMinScore === 'number') setFeedMinScore(Math.max(0, Math.min(90, s.feedMinScore)))
        if (s.feedDailies && typeof s.feedDailies === 'object') setFeedDailies(s.feedDailies as Record<string, string>)
        if (Array.isArray(s.newsWatches)) setNewsWatches((s.newsWatches as NewsWatch[]).slice(0, 50))
        if (typeof s.islandWidth === 'number') setIslandWidth(Math.max(380, Math.min(880, s.islandWidth)))
        if (typeof s.fullscreen === 'boolean') setFullscreen(s.fullscreen)
        if (typeof s.fontChoice === 'string') setFontChoice(s.fontChoice)
        if (typeof s.uiZoom === 'number') setUiZoom(Math.max(0.9, Math.min(1.3, s.uiZoom)))
        if (s.llm) setLlm((v) => ({ ...v, ...hydratedLlm, open: false, testStatus: 'idle', testMsg: '' }))
      }
      // 权威同步一次多屏偏好：主进程默认 follow=true，与渲染层默认 multiMonitor=false 不一致，
      // 以水合后的持久化值为准纠正岛所在屏（修复"设置显示固定主屏、实际岛却跟鼠标跳屏"）
      island.reposition({
        follow: (s?.settings as Partial<SettingsFlags> | undefined)?.multiMonitor ?? false,
        monitorIndex: (typeof s?.activeMonitor === 'number' ? s.activeMonitor : 1) - 1
      })
    })
    return off
  }, [])

  const agents: AgentVM[] = useMemo(() => snap.agents.map((a) => ({ ...a })), [snap])
  const activeProject = useMemo(() => workbenchProjects.find((p) => p.id === activeProjectId), [workbenchProjects, activeProjectId])

  const createWorkbenchProject = useCallback((name: string, repoPath = ''): void => {
    const existing = workbenchProjects.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase() || (!!repoPath.trim() && p.repoPath?.toLowerCase() === repoPath.trim().toLowerCase()))
    if (existing) {
      setActiveProjectId(existing.id)
      return
    }
    const project = newProject(name, repoPath, workbenchProjects.length)
    setWorkbenchProjects((list) => [...list, project])
    setActiveProjectId(project.id)
  }, [workbenchProjects])

  const selectWorkbenchProject = useCallback((id: string | null): void => {
    setActiveProjectId(id)
  }, [])

  const recordWorkflowRun = useCallback((run: WorkflowRun): void => {
    setWorkflowRuns((list) => [run, ...list.filter((x) => x.id !== run.id)].slice(0, 100))
    if (run.summary) {
      const artifact: WorkArtifact = {
        id: `artifact-${run.id}`,
        projectId: run.projectId,
        source: 'workflow',
        sourceId: run.id,
        kind: 'run-log',
        title: `${run.shortcutName} · ${run.status === 'succeeded' ? '执行完成' : '执行异常'}`,
        content: run.summary || '',
        createdAt: run.finishedAt || Date.now()
      }
      setWorkArtifacts((list) => [artifact, ...list].slice(0, 100))
    }
  }, [])

  const pending = useMemo(() => agents.filter((a) => a.status === 'needs_approval'), [agents])
  const hasPending = pending.length > 0
  // 等待你回复（Agent 反问/需补充信息）—— 也算"需要处理"，同样弹出+响铃
  const waiting = useMemo(() => agents.filter((a) => a.status === 'waiting'), [agents])
  const hasWaiting = waiting.length > 0
  const attentionCount = pending.length + waiting.length

  // 复盘骨架数据：Agent 快照易逝（done 3min 自动隐藏），在此把出现过的会话增量落进活动流水。
  // 按会话 id 去重、仅在展示/事实字段变化时更新，避免快照心跳造成无谓重渲染。
  useEffect(() => {
    if (!snap.agents.length) return
    setActivityLog((prev) => {
      const map = new Map(prev.map((e) => [e.id, e]))
      let changed = false
      for (const a of snap.agents) {
        if (!a.proj) continue
        const cur = map.get(a.id)
        const s = a.summary
        const next: ActivityEntry = {
          id: a.id,
          ts: cur?.ts || a.startedAt || Date.now(),
          updatedAt: Date.now(),
          tool: a.tool || cur?.tool || 'Agent',
          proj: a.proj,
          detail: a.detail || cur?.detail || '',
          files: s?.files ?? cur?.files,
          added: s?.added ?? cur?.added,
          removed: s?.removed ?? cur?.removed,
          commit: s?.commit ?? cur?.commit
        }
        if (!cur || cur.detail !== next.detail || cur.tool !== next.tool || cur.files !== next.files || cur.added !== next.added || cur.removed !== next.removed || cur.commit !== next.commit) {
          map.set(a.id, next)
          changed = true
        }
      }
      if (!changed) return prev
      return [...map.values()].sort((x, y) => y.ts - x.ts).slice(0, 300)
    })
  }, [snap])

  // Tab 栏溢出探测：据当前滚动位置决定左右渐隐（隐藏滚动条后靠此暗示可横滑）
  const measureTabs = useCallback((): void => {
    const el = tabBarRef.current
    if (!el) return
    const l = el.scrollLeft > 2
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setTabFade((p) => (p.l === l && p.r === r ? p : { l, r }))
  }, [])
  useEffect(() => {
    measureTabs()
    const on = (): void => measureTabs()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [measureTabs, islandWidth, tab, settings.largeSize, fullscreen, revealed])

  const focusActive = focusUntil > 0 && now < focusUntil
  const focusRemaining = focusActive ? Math.max(0, Math.ceil((focusUntil - now) / 1000)) : 0
  const focusMMSS = `${String(Math.floor(focusRemaining / 60)).padStart(2, '0')}:${String(focusRemaining % 60).padStart(2, '0')}`
  // 番茄钟专注阶段同样静默通知（与专注模式一致）
  const pomoWorking = pomo.phase === 'work' && now < pomo.endsAt
  const pomoMMSS = fmtMMSS(remainSecs(pomo, now))
  // 智能勿扰：会议检测 + 用户开关 → 最终勿扰态（静默弹窗与提示音，同专注）
  const dndActive = settings.meetingDnd && meetingActive

  const hasDueTodo = dueCount > 0
  const ambientStatus = useMemo(() => deriveAmbientStatus({
    pending: pending.length,
    waiting: waiting.length,
    dueTodos: dueCount,
    runningAgents: agents.filter((agent) => agent.status !== 'done').length,
    project: (pending[0] || waiting[0] || agents.find((agent) => agent.status === 'running'))?.proj,
    focusLabel: pomoWorking ? `番茄 ${pomoMMSS}` : focusActive ? focusMMSS : undefined,
    dnd: dndActive
  }), [pending, waiting, dueCount, agents, pomoWorking, pomoMMSS, focusActive, focusMMSS, dndActive])
  // 暂时收起：正在开会等场景，允许把"有待处理"的岛收回去；出现**新的**请求（签名变化）会重新弹出
  const [snoozeSig, setSnoozeSig] = useState('')
  const attentionSig = [
    ...pending.map((p) => p.requestId || p.id),
    ...waiting.map((w) => w.id),
    ...todos.filter((t) => !t.done && t.due && t.due <= now).map((t) => String(t.id))
  ].join('|')
  const snoozed = snoozeSig !== '' && snoozeSig === attentionSig
  const forceAttention = (hasPending || hasWaiting || hasDueTodo) && !focusActive && !pomoWorking && !dndActive && !snoozed

  const isShown = revealed || forceAttention || pinned
  useEffect(() => {
    if (!isShown) releasePanelKeyboardFocus()
  }, [isShown, releasePanelKeyboardFocus])
  const attentionSigRef = useRef(''); attentionSigRef.current = attentionSig
  const snoozeNow = useCallback((): void => {
    releasePanelKeyboardFocus()
    setSnoozeSig(attentionSigRef.current)
    setPinned(false)
    setRevealed(false)
  }, [releasePanelKeyboardFocus])

  // 打开文件夹、网页、会议或外部终端前主动让位：完整面板收起，当前提醒静默到下一条新事件。
  // 主进程同时会临时取消 screen-saver 级置顶；这里同步 lastIgnore，避免下次唤出时缓存与真实窗口状态失步。
  useEffect(() => island.onExternalYield(() => {
    const recordingWorkspaceOpen = !!document.querySelector('[data-recording-studio], [data-recording-compact]')
    releasePanelKeyboardFocus()
    setSnoozeSig(attentionSigRef.current)
    setPinned(false)
    setRevealed(false)
    setCapsuleOpen(false)
    setPaletteOpen(false)
    setBrainOpen(false)
    setKbOpen(false)
    setStudio(null)
    setThemeDesignerOpen(false)
    setCalcOpen(false)
    setLearnOpen(false)
    setShotImg(null)
    // 录制会话必须跨外部文件/网页/会议操作持续存在；让位只降低窗口层级，不能卸载录制器。
    if (!recordingWorkspaceOpen) setShotStudio(null)
    setDropActive(false)
    if (!recordingWorkspaceOpen) lastIgnore.current = true
  }), [releasePanelKeyboardFocus])

  // 供 mousemove 处理器读取的最新值（处理器只注册一次）
  const forcedRef = useRef(false); forcedRef.current = forceAttention || pinned
  const pinnedRef = useRef(false); pinnedRef.current = pinned
  const pendingRef = useRef(false); pendingRef.current = forceAttention
  const revealedRef = useRef(false); revealedRef.current = revealed
  // 全屏覆盖层（截图问AI / 闪念胶囊 / 命令面板）打开时，窗口必须保持可点击，
  // 否则 onMove 会把它翻回点击穿透 → 覆盖层收不到点击 = 界面"卡死"。
  const anyOverlay = capsuleOpen || paletteOpen || brainOpen || kbOpen || !!studio || themeDesignerOpen || calcOpen || learnOpen || !!shotImg || !!shotStudio
  const overlayRef = useRef(false); overlayRef.current = anyOverlay
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

  // 番茄钟节拍：逐秒刷新 + 阶段自然结束时切换（专注完成计一次 → 喂复盘/洞察）
  useEffect(() => {
    if (pomo.phase === 'idle') return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= pomo.endsAt) {
        if (pomo.phase === 'work') {
          const k = dayKey(n)
          setPomoDone((d) => ({ ...d, [k]: (d[k] || 0) + 1 }))
          if (settings.sound) playSound('done')
          showToast('🍅 专注完成一轮 · 休息一下')
          // 规则③：番茄结束 → 弹闪念胶囊趁热记进展
          if (settings.rulePomoCapsule) { setRevealed(true); setCapsuleOpen(true) }
        } else {
          if (settings.sound) playSound('blip')
          showToast('☕ 休息结束 · 开始下一轮专注')
        }
        setPomo((s) => nextPhase(s, pomoCfg, Date.now()))
      }
    }, 1000)
    return () => clearInterval(t)
  }, [pomo.phase, pomo.endsAt, pomoCfg, settings.sound, settings.rulePomoCapsule])

  // 配置持久化：任一相关设置变化后写回本机（加密存储）
  useEffect(() => {
    if (!hydrated.current) return
    island.saveState({
      settings,
      soundMap,
      activeMonitor,
      todos,
      theme,
      customThemes,
      calcSheet,
      repos,
      githubToken,
      repoBookmarks,
      shortcuts,
      askEngine,
      agentCwd,
      srsState,
      radar,
      embedModel,
      embeddingConfig: embedConfig,
      // 问答历史持久化（截尾 60 条、剔除 typing 占位与本地 Agent 进行中的 live 消息，含就地追问子线程）+ 归档会话
      askThread: compactChatMessages(threads['ask'] || []),
      askSessions: askSessions.slice(0, 40).map((session) => ({ ...session, msgs: compactChatMessages(session.msgs) })),
      activeAskBranch,
      workbenchProjects,
      activeProjectId,
      workflowRuns: workflowRuns.slice(0, 100),
      workArtifacts: workArtifacts.slice(0, 100),
      quickPrompts,
      icsUrl,
      caldav,
      barCfg,
      islandWidth,
      fullscreen,
      fontChoice,
      uiZoom,
      feedSources,
      feedItems: feedItems.slice(0, 200),
      feedHidden: feedHidden.slice(0, 300),
      feedAiEnrich,
      feedInterests,
      feedMinScore,
      feedDailies,
      newsWatches: newsWatches.slice(0, 50),
      clipFavs: clips.filter((c) => c.fav).slice(0, 40),
      // 复盘：活动流水（近 14 天封顶 300 条）+ 已生成的复盘/周报
      activityLog: activityLog.filter((a) => a.ts >= Date.now() - 14 * 86400_000).slice(0, 300),
      reviews,
      // 番茄钟：进行中的计时（跨重启续上）+ 每日完成计数
      pomo: pomo.phase === 'idle' ? undefined : pomo,
      pomoDone,
      notes: notes.slice(0, 400),
      llm: {
        provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, apiKey: llm.apiKey,
        saved: llm.saved, modelLists: llm.modelLists, profiles: llm.profiles,
        providerCatalogVersion: llm.providerCatalogVersion
      }
    })
  }, [settings, soundMap, activeMonitor, todos, theme, threads, askSessions, activeAskBranch, workbenchProjects, activeProjectId, workflowRuns, workArtifacts, quickPrompts, icsUrl, caldav, barCfg, islandWidth, fullscreen, fontChoice, uiZoom, feedSources, feedItems, feedHidden, feedAiEnrich, feedInterests, feedMinScore, feedDailies, newsWatches, clips, activityLog, reviews, pomo, pomoDone, customThemes, calcSheet, repos, githubToken, repoBookmarks, shortcuts, askEngine, agentCwd, srsState, radar, embedConfig, notes, llm.provider, llm.model, llm.baseUrl, llm.apiKey, llm.saved, llm.modelLists, llm.profiles, llm.providerCatalogVersion])

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
  useEffect(() => applyThemeAny(theme, customThemes), [theme, customThemes])

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

  // ===== 闪念胶囊：全局热键唤出/收起 =====
  useEffect(() => island.onCapsuleToggle(() => setCapsuleOpen((v) => !v)), [])
  const closeCapsule = useCallback((): void => { setCapsuleOpen(false); island.capsuleClosed() }, [])

  // ===== 全局命令面板：热键唤出（展开岛 + 开面板）+ 岛内 Ctrl+K =====
  useEffect(() => island.onPaletteToggle(() => { setRevealed(true); setPaletteOpen(true) }), [])
  useEffect(() => island.onBrainToggle(() => { setRevealed(true); setBrainOpen(true) }), [])
  // 会议检测态：主进程推送
  useEffect(() => island.onDnd(setMeetingActive), [])

  // 全屏模式：主进程把窗口从工作区切到整个物理显示器（display.bounds，盖住任务栏）；
  // 面板/覆盖层 100vw/100vh 随之真正铺满。非全屏时窗口恒定铺满工作区。
  useEffect(() => {
    island.setFullMode(fullscreen)
    if (fullscreen) setRevealed(true)
  }, [fullscreen])

  // 启动时载入知识库已接入的源（供问答"知识库模式"计数与检索）
  useEffect(() => { refreshKb() }, [refreshKb])

  // ===== 桌面挂件：开关 + 每秒推送速览数据（时钟/番茄/待办/日程/Agent/媒体 + AI 速览）=====
  useEffect(() => { island.toggleWidget(settings.desktopWidget) }, [settings.desktopWidget])
  const [widgetBrief, setWidgetBrief] = useState('')
  const widgetSrcRef = useRef({ pomo, todos, agents, pending, media, theme, customThemes, meetings, brief: widgetBrief })
  widgetSrcRef.current = { pomo, todos, agents, pending, media, theme, customThemes, meetings, brief: widgetBrief }
  useEffect(() => {
    if (!settings.desktopWidget) return
    const push = (): void => {
      const s = widgetSrcRef.current
      const nowMs = Date.now()
      const open = s.todos.filter((t) => !t.done)
      const nextM = s.meetings.filter((m) => m.start > nowMs).sort((a, b) => a.start - b.start)[0]
      // 下一个要做的：置顶优先 → 优先级(1紧急最靠前) → 最近截止
      const focus = [...open].sort((a, b) => Number(b.pinned || 0) - Number(a.pinned || 0) || (a.priority || 3) - (b.priority || 3) || (a.due || Infinity) - (b.due || Infinity))[0]
      const widgetTheme = normalizeThemeTokens([...s.customThemes, ...THEMES].find((t) => t.key === s.theme) || THEMES[0])
      island.widgetPush({
        clock: new Date(nowMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
        date: new Date(nowMs).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }),
        pomoPhase: s.pomo.phase,
        pomoMMSS: fmtMMSS(remainSecs(s.pomo, nowMs)),
        dueTodos: open.filter((t) => t.due && t.due <= nowMs).length,
        openTodos: open.length,
        focusTodo: focus?.text || '',
        nextMeetingTitle: nextM?.title || '',
        nextMeetingMMSS: nextM ? fmtMMSS(Math.max(0, Math.floor((nextM.start - nowMs) / 1000))) : '',
        nextMeetingLink: nextM?.link || '',
        agents: s.agents.filter((a) => a.status !== 'done').length,
        agentsWaiting: s.agents.filter((a) => a.status === 'waiting' || a.status === 'needs_approval').length,
        pending: s.pending.length,
        mediaTitle: s.media ? `${s.media.title}${s.media.artist ? ' · ' + s.media.artist : ''}` : '',
        mediaPlaying: !!s.media?.playing,
        brief: s.brief,
        theme: widgetTheme
      })
    }
    push()
    const t = setInterval(push, 1000)
    return () => clearInterval(t)
  }, [settings.desktopWidget])
  // 挂件「AI 速览」：模型就绪时定期生成一句极短的当下提点（启用即生成，之后每 10 分钟刷新）
  // 注：此处内联判定 llm 是否就绪，因为 llmReady 常量在本效果之后才声明（避免 TDZ）
  useEffect(() => {
    if (!settings.desktopWidget || !(llm.apiKey && llm.model)) { setWidgetBrief(''); return }
    const gen = (): void => {
      const s = widgetSrcRef.current
      const nowMs = Date.now()
      const open = s.todos.filter((t) => !t.done)
      const due = open.filter((t) => t.due && t.due <= nowMs)
      const nextM = s.meetings.filter((m) => m.start > nowMs).sort((a, b) => a.start - b.start)[0]
      const ctx =
        `现在 ${new Date(nowMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}；未完成待办 ${open.length} 项（其中 ${due.length} 已到期）；` +
        (nextM ? `下个日程「${nextM.title}」约 ${Math.max(1, Math.round((nextM.start - nowMs) / 60000))} 分钟后；` : '暂无日程；') +
        `活跃 Agent ${s.agents.filter((a) => a.status !== 'done').length} 个。` +
        (open[0] ? `最该做的可能是「${open[0].text}」。` : '')
      island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, WIDGET_BRIEF_SYSTEM, ctx, false).then((r) => {
        if (r.ok && r.text) setWidgetBrief(r.text.trim().replace(/^["「'"]+|["」'"]+$/g, '').slice(0, 44))
      })
    }
    gen()
    const t = setInterval(gen, 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [settings.desktopWidget, llm.apiKey, llm.model])
  // 最终勿扰态变化 → 告知主进程（真则不自动弹窗/响铃）+ 进入时提示一次
  useEffect(() => {
    island.setDnd(dndActive)
    if (dndActive) { setToast('🔕 检测到会议 · 已进入勿扰（不弹窗/不响铃）'); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4000) }
  }, [dndActive])

  // 规则④：会议结束（检测态 true→false）→ 提示把要点记成便签
  const wasMeetingRef = useRef(false)
  useEffect(() => {
    if (wasMeetingRef.current && !meetingActive && settings.ruleMeetingNote) {
      setToast('🗒 会议结束 · 要把要点记成便签吗？到「灵感便签」新建一条')
      clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 5000)
    }
    wasMeetingRef.current = meetingActive
  }, [meetingActive, settings.ruleMeetingNote])
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      // 岛内 Ctrl+K 快捷唤出；避开输入框/终端（xterm 用 textarea，Ctrl+K 是其控制键）——全局 Ctrl+Alt+K 不受此限
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setRevealed(true); setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  // 提交：AI 判断意图 → 路由到 待办/便签/问答
  const capsuleSubmit = useCallback(async (text: string): Promise<{ result: CapsuleResult; feedback: string } | { error: string }> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return { error: '请先在 设置 › 问答助手模型 配置 Key' }
    const now2 = new Date()
    const nowText = `${now2.getFullYear()}-${now2.getMonth() + 1}-${now2.getDate()} ${String(now2.getHours()).padStart(2, '0')}:${String(now2.getMinutes()).padStart(2, '0')} 周${'日一二三四五六'[now2.getDay()]}`
    const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, capsuleSystemPrompt(nowText), text, false)
    const parsed = res.ok ? parseCapsule(res.text) : null
    // AI 不可用/解析失败 → 兜底当待办
    const r: CapsuleResult = parsed || { kind: 'todo', text }
    if (r.kind === 'todo') {
      const dueTs = r.due ? new Date(r.due.replace(' ', 'T')).getTime() : undefined
      todoAdd(r.text, Number.isFinite(dueTs) ? dueTs : undefined, r.priority ?? 3, 'none')
      return { result: r, feedback: `已加入待办${r.due ? ` · ${r.due}` : ''}` }
    }
    if (r.kind === 'note') {
      const n3 = Date.now()
      setNotes((l) => [{ id: n3, emoji: r.emoji || '💡', title: r.text.slice(0, 40), md: text, color: 'amber', tags: r.tags || [], createdAt: n3, updatedAt: n3 }, ...l].slice(0, 400))
      return { result: r, feedback: `已存为灵感便签` }
    }
    // ask：切到问答并发送
    setTab('ask')
    setRevealed(true)
    sendPreset('ask', r.text, askMode === 'deep')
    return { result: r, feedback: `已到问答，AI 正在回答…` }
  }, [askMode])

  // ===== 智能截图问 AI：框选完成 → 弹出截图问答卡 =====
  useEffect(() => island.onScreenshot(({ dataUrl, target }) => {
    setRevealed(true)
    if (target === 'studio') { setShotStudioMode('image'); setShotStudio(dataUrl) }
    else setShotImg(dataUrl)
  }), [])
  const shotAsk = useCallback((prompt: string, dataUrl: string): void => {
    setShotImg(null)
    island.capsuleClosed() // 还原点击穿透 + blur（复用同一还原逻辑）
    setTab('ask')
    setRevealed(true)
    // 降采样后作为图片附件走多模态问答
    void downscaleDataUrl(dataUrl, 1280, 0.85).then((small) => {
      pushAndReply('ask', prompt, [{ type: 'screenshot', name: '截图', thumb: small, dataUrl: small }], askMode === 'deep')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askMode])

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

  const ambientBrief = useMemo(() => [
    ...(meetings.filter((meeting) => meeting.start > Date.now()).slice(0, 1).map((meeting) => `⏰ ${new Date(meeting.start).getHours()}:${String(new Date(meeting.start).getMinutes()).padStart(2, '0')} ${meeting.title}（${Math.max(1, Math.round((meeting.start - Date.now()) / 60000))} 分钟后）`)),
    ...(todos.filter((todo) => !todo.done && todo.due && todo.due <= Date.now()).length ? [`⏳ ${todos.filter((todo) => !todo.done && todo.due && todo.due <= Date.now()).length} 项待办已到时`] : []),
    ...(agents.filter((agent) => agent.status !== 'done').length ? [`🤖 ${agents.filter((agent) => agent.status !== 'done').length} 个 Agent 会话活动中`] : []),
    ...(todos.filter((todo) => !todo.done).length ? [`📝 今日还剩 ${todos.filter((todo) => !todo.done).length} 项待办`] : [])
  ], [meetings, todos, agents])
  const ambientSuggestionDeck = useMemo(
    () => buildAmbientTextDeck(barCfg.modes, barPools, ambientBrief),
    [barCfg.modes, barPools, ambientBrief]
  )
  const ambientSuggestions = useMemo(
    () => ambientTextWindow(ambientSuggestionDeck, askSuggestionCursor, 2),
    [ambientSuggestionDeck, askSuggestionCursor]
  )
  useEffect(() => {
    if (tab !== 'ask' || (threads['ask']?.length || 0) > 0) return
    const timer = setInterval(() => setAskSuggestionCursor((cursor) => cursor + 1), clampBarRotation(barCfg.rotationSeconds) * 1000)
    return () => clearInterval(timer)
  }, [tab, threads['ask']?.length, barCfg.rotationSeconds])

  // ===== 剪贴板助手：主进程推送（文本/图片）→ 记录历史（收藏项持久化，其余仅内存）=====
  const clipSeq = useRef(0)
  useEffect(() => {
    if (!settings.clipWatch) return
    return island.onClipboard((item) => {
      setClips((l) => {
        // 去重：文本按内容、图片按 dataUrl
        const dup = l.find((c) => (item.kind === 'text' ? c.text === item.text : c.dataUrl === item.dataUrl))
        const rest = l.filter((c) => c !== dup)
        const next: ClipItem = dup
          ? { ...dup, ts: Date.now() }
          : item.kind === 'image'
            ? { id: Date.now() * 100 + (clipSeq.current++ % 100), kind: 'image', dataUrl: item.dataUrl, tag: '图片', ts: Date.now() }
            : { id: Date.now() * 100 + (clipSeq.current++ % 100), kind: 'text', text: item.text, tag: tagOf(item.text || ''), ts: Date.now() }
        // 收藏项永远保留，非收藏项最多 30 条
        const favs = rest.filter((c) => c.fav)
        const others = rest.filter((c) => !c.fav)
        return [next, ...favs.filter((f) => f.id !== next.id), ...others].slice(0, 60)
      })
      if (item.kind === 'text' && (item.text || '').length > 40 && /(\berror\b|exception|traceback|panic|FAILED|错误|异常|失败)/i.test(item.text || '')) {
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
    const clearHideTimer = (): void => {
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = undefined }
    }
    const panelHasKeyboardFocus = (): boolean => {
      const active = document.activeElement
      return !!active && !!panelRef.current?.contains(active)
    }
    const scheduleHide = (delay: number): void => {
      if (hideTimer.current) return
      hideTimer.current = setTimeout(() => {
        hideTimer.current = undefined
        if (panelHasKeyboardFocus() || keyboardFocusRef.current || forcedRef.current || pendingRef.current || overlayRef.current) return
        setRevealed(false)
      }, delay)
    }
    const onMove = (e: MouseEvent): void => {
      const compactRecording = !!document.querySelector('[data-recording-compact]')
      if (compactRecording) {
        const overRecordingControl = !!document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-recording-control]')
        setIgnore(!overRecordingControl)
        return
      }
      const cx = window.innerWidth / 2
      // 触发区：只有贴着屏幕最顶边、且靠近中央时才唤出（避免提前弹出）
      const atTopEdge = e.clientY <= 6 && Math.abs(e.clientX - cx) <= 120
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const overSolid = !!el?.closest('[data-solid]')
      const overAmbient = !!el?.closest('[data-ambient-bar]')
      const edgeReveal = atTopEdge && !overAmbient
      // 键盘焦点只能维持已经展开的面板，不能把用户刚收起的面板重新唤出。
      const forced = forcedRef.current || pendingRef.current || (revealedRef.current && keyboardFocusRef.current)
      // 已经打开时的"保持区"：按面板实际矩形外扩 48px 判定（面板可高达 1020px，硬编码 260 会在下半区点按钮时误收起）；
      // 面板内点击后 1.2s 内一律保持（内容收缩把光标"甩出"面板的瞬间不触发回缩）
      const recentClick = Date.now() - lastClickRef.current < 1200
      const pr = revealedRef.current ? panelRef.current?.getBoundingClientRect() : undefined
      const keepOpen = revealedRef.current && (recentClick || (pr
        ? e.clientY <= pr.bottom + 48 && e.clientX >= pr.left - 48 && e.clientX <= pr.right + 48
        : e.clientY <= 260 && Math.abs(e.clientX - cx) <= window.innerWidth / 2 - 10))
      // overlayRef：覆盖层打开时始终可点击（但不强制展开主面板，交由覆盖层自己的层级承接）
      const interactive = edgeReveal || overSolid || forced || keepOpen || overlayRef.current

      setIgnore(!interactive)

      if (edgeReveal || (overSolid && !overAmbient) || forced) {
        clearHideTimer()
        if (!revealedRef.current) setRevealed(true)
      } else if (interactive) {
        // keepOpen 区内：维持显示，取消隐藏计时
        clearHideTimer()
      } else if (!hideTimer.current) {
        scheduleHide(260)
      }
    }
    // 鼠标移出窗口：若非强制态，恢复穿透并延时隐藏（兜底，避免状态卡住）；点击后 1.2s 内同样豁免
    const onLeave = (): void => {
      if (document.querySelector('[data-recording-compact]')) { setIgnore(true); return }
      if (keyboardFocusRef.current || panelHasKeyboardFocus() || forcedRef.current || pendingRef.current || overlayRef.current || Date.now() - lastClickRef.current < 1200) return
      setIgnore(true)
      scheduleHide(400)
    }
    const onFocusIn = (event: FocusEvent): void => {
      if (!revealedRef.current || !panelRef.current?.contains(event.target as Node)) return
      keyboardFocusRef.current = true
      clearHideTimer()
      setIgnore(false)
    }
    const onFocusOut = (): void => {
      setTimeout(() => {
        if (panelHasKeyboardFocus()) return
        keyboardFocusRef.current = false
        if (!forcedRef.current && !pendingRef.current && !overlayRef.current) scheduleHide(400)
      }, 0)
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      clearHideTimer()
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // 主面板展开（贴住/待审批/已显示）或任一覆盖层打开时 → "无条件"取消穿透（窗口可交互），无需先晃鼠标。
  // 无条件是关键：主进程在热键唤出（openCapsule/openScreenAnalyze…）与关闭（capsule-closed）时会**直接** setIgnoreMouseEvents，
  // 渲染层缓存的 lastIgnore 信念会与真实窗口失步；若仍按 lastIgnore 守卫，就会漏修 →
  // 出现"覆盖层/面板可见却点击穿透到桌面"的卡死。这里覆盖三种情形：覆盖层开、覆盖层关但面板仍开、面板展开。
  useEffect(() => {
    if (isShown || anyOverlay) {
      lastIgnore.current = false
      island.setIgnoreMouse(false)
    }
  }, [isShown, anyOverlay])

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
      else if (e.key === 'Escape') {
        // 有覆盖层先关覆盖层（安全兜底：任何情况都能退出，杜绝卡死）；否则收起岛
        if (anyOverlay) { setCapsuleOpen(false); setPaletteOpen(false); setBrainOpen(false); setKbOpen(false); setStudio(null); setThemeDesignerOpen(false); setCalcOpen(false); setLearnOpen(false); setShotImg(null); setShotStudio(null); island.capsuleClosed() }
        else if (!pinned) snoozeNow()
      }
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
  // ===== 本地 Agent 流式管线：runId → sink 分发；每次运行以 result/error 收尾 =====
  const agentSinks = useRef(new Map<string, (ev: AgentCliEvent) => void>())
  useEffect(() => island.onAgentCliEvent(({ runId, ev }) => agentSinks.current.get(runId)?.(ev)), [])
  /**
   * 启动一次本地 Agent 流式问答：patch 把"活"消息写进目标位置（主线程/追问子线程），done 以最终 blocks 收尾。
   * 事件节流 80ms 刷一次 UI（token 级事件频率高，逐条 setState 会拖垮渲染）。
   */
  const runAgentStream = useCallback(async (eng: 'claude' | 'codex', prompt: string, cont: boolean, imagesIgnored: boolean, patch: (m: ChatMessage) => void, done: (blocks: Block[]) => void): Promise<void> => {
    let r: Awaited<ReturnType<typeof island.agentCliStream>>
    try {
      r = await island.agentCliStream(eng, prompt, agentCwdRef.current, cont)
    } catch (error) {
      done([{ t: 'note', text: `本地 ${eng === 'claude' ? 'Claude Code' : 'Codex'} 启动失败：${String(error)}` }])
      return
    }
    if (!r.ok || !r.runId) { done([{ t: 'note', text: `本地 ${eng === 'claude' ? 'Claude Code' : 'Codex'} 启动失败：${r.error || '未知错误'}` }]); return }
    const runId = r.runId
    const live: AgentLive = { engine: eng, think: '', steps: [], text: '' }
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const flush = (): void => { flushTimer = undefined; patch({ role: 'agent', live: { ...live, steps: live.steps.map((s) => ({ ...s })) } }) }
    const schedule = (): void => { if (!flushTimer) flushTimer = setTimeout(flush, 80) }
    flush() // 立即挂出活气泡（替换 typing 占位）
    agentSinks.current.set(runId, (ev) => {
      if (ev.kind === 'status') live.status = ev.text
      else if (ev.kind === 'think') live.think += ev.text || ''
      else if (ev.kind === 'text') live.text += ev.text || ''
      else if (ev.kind === 'tool') live.steps.push({ label: ev.name || '工具', detail: ev.detail, done: false })
      else if (ev.kind === 'tool-done') { const s = live.steps.find((x) => !x.done); if (s) s.done = true }
      else {
        // result / error：收尾——思考折叠为 think 块，步骤转完成态时间线，正文走 Markdown
        agentSinks.current.delete(runId)
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined }
        const blocks: Block[] = []
        if (live.think.trim()) blocks.push({ t: 'think', text: live.think.trim() })
        if (live.steps.length) blocks.push({ t: 'steps', steps: live.steps.map((s) => ({ label: s.label, detail: s.detail })) })
        if (ev.kind === 'result') blocks.push(...looseBlocks(ev.text))
        else blocks.push({ t: 'note', text: `本地 Agent：${ev.text || '执行失败'}` })
        if (imagesIgnored) blocks.push({ t: 'note', text: '⚠ 本地 Agent 模式暂不支持图片附件，本轮图片已忽略。' })
        done(blocks)
        return
      }
      schedule()
    })
  }, [])

  const patchAskBranchMessages = useCallback((branchId: number, patch: (messages: ChatMessage[]) => ChatMessage[]): void => {
    if (activeAskBranchRef.current.id === branchId) {
      setThreads((all) => ({ ...all, ask: patch(all.ask || []) }))
      return
    }
    setAskSessions((sessions) => sessions.map((session) => session.id === branchId
      ? { ...session, msgs: patch(session.msgs), updatedAt: Date.now() }
      : session))
  }, [])

  const patchAskBranchMeta = useCallback((branchId: number, patch: (branch: AskBranchMeta) => AskBranchMeta): void => {
    if (activeAskBranchRef.current.id === branchId) {
      setActiveAskBranch((branch) => {
        const next = patch(branch)
        activeAskBranchRef.current = next
        return next
      })
      return
    }
    setAskSessions((sessions) => sessions.map((session) => {
      if (session.id !== branchId) return session
      const { msgs, ...meta } = session
      return { ...patch(meta), msgs }
    }))
  }, [])

  // 拉取 AI 回复（带多轮上下文）：history 为"本轮提问之前"的对话历史
  const fetchReply = useCallback((key: string, text: string, atts: Composer['attachments'], deep: boolean, history: { role: 'user' | 'assistant'; content: string }[], branchId?: number): void => {
    const L = llmRef.current
    const cfg = { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }
    const requestModelLabel = llmModelLabel(L)
    const finish = (reply: ChatMessage): void => {
      const patch = (messages: ChatMessage[]): ChatMessage[] => [...messages.filter((message) => !message.typing && !message.live), { ...reply, ts: Date.now() }]
      if (key === 'ask' && branchId !== undefined) patchAskBranchMessages(branchId, patch)
      else setThreads((all) => ({ ...all, [key]: patch(all[key] || []) }))
    }

    // 本地 Agent 引擎不依赖云端 Key；仅云端模式做配置校验
    const useLocalAgent = key === 'ask' && askEngineRef.current !== 'llm'
    if (!useLocalAgent && (!cfg.apiKey || !cfg.model)) {
      finish({ role: 'agent', blocks: [{ t: 'note', text: '请先在 Settings › 问答助手模型 里配置端点、型号与 API Key。' }] })
      return
    }
    // 附件真实注入：文本文件内容拼进提问；图片作为多模态 parts（需模型支持视觉，否则 API 会报错并如实显示）
    const fileText = attachmentsToPrompt(atts)
    const images = atts.filter((a) => a.dataUrl)
    const fullText = (text || (atts.length ? '请分析附带的内容。' : '（用户未输入文字）')) + fileText
    // 本地 Agent 引擎（仅问答区）：流式——思考/工具/技能/MCP 步骤实时进气泡，与终端里工作方式一致
    if (useLocalAgent) {
      const eng = askEngineRef.current as 'claude' | 'codex'
      const instruction = activeAskBranchRef.current.instruction?.trim() || ''
      const prompt = buildAgentContextPrompt(history, fullText, instruction)
      const patch = (message: ChatMessage): void => finish(message)
      void runAgentStream(eng, prompt, false, images.length > 0, patch, (blocks) => patch({ role: 'agent', blocks }))
      return
    }
    const userPayload: string | Array<Record<string, unknown>> = images.length
      ? [{ type: 'text', text: fullText }, ...images.map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl! } }))]
      : fullText
    const instruction = key === 'ask' ? activeAskBranchRef.current.instruction?.trim() : ''
    const system = systemFor(key, deep) + (instruction ? `\n\n本会话额外指令（持续生效）：\n${instruction}` : '')
    island.llmComplete(cfg, system, userPayload, deep, history).then((res) => {
      if (res.ok) {
        let blocks = parseBlocks(res.text) || looseBlocks(res.text)
        // 推理型模型单独返回的思维链，作为 think block 置于最前
        if (res.reasoning) blocks = [{ t: 'think' as const, text: res.reasoning }, ...blocks]
        finish({ role: 'agent', blocks, modelLabel: requestModelLabel })
      } else {
        finish({ role: 'agent', blocks: [{ t: 'note', text: '请求失败：' + (res.error || '未知错误') }], modelLabel: requestModelLabel })
      }
    }).catch((error) => finish({ role: 'agent', blocks: [{ t: 'note', text: '请求失败：' + String(error) }], modelLabel: requestModelLabel }))
  }, [patchAskBranchMessages, runAgentStream])

  // 知识库检索式作答（RAG）：向量检索 top-k → 只依据命中片段作答 → 末尾附出处。settle 收敛到调用方的气泡。
  const runKbReply = useCallback(async (query: string, deep: boolean, history: { role: 'user' | 'assistant'; content: string }[], instruction: string, settle: (blocks: ChatMessage['blocks']) => void): Promise<void> => {
    const L = llmRef.current
    const cfg = { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }
    if (!cfg.apiKey || !cfg.model) { settle([{ t: 'note', text: '请先在 设置 › 问答助手模型 里配置端点、型号与 API Key。' }]); return }
    const em = embedConfigRef.current
    if (!em.baseUrl.trim() || !em.apiKey.trim() || !em.model.trim()) { settle([{ t: 'note', text: '知识库检索需要独立的向量连接：请打开知识库面板，填写 Base URL、Embedding 模型和 API Key。' }]); return }
    const sr = await island.kbSearch(em, query, 8)
    if (!sr.ok || !sr.hits?.length) { settle([{ t: 'note', text: '📚 ' + (sr.error || '知识库里没有检索到相关内容，可在知识库面板添加更多资料。') }]); return }
    const system = KB_SYSTEM + (instruction.trim() ? `\n\n本会话额外指令（持续生效）：\n${instruction.trim()}` : '')
    const res = await island.llmComplete(cfg, system, kbGroundPrompt(query, sr.hits), deep, history)
    if (!res.ok) { settle([{ t: 'note', text: '请求失败：' + (res.error || '未知错误') }]); return }
    let blocks = parseBlocks(res.text) || looseBlocks(res.text)
    if (res.reasoning) blocks = [{ t: 'think' as const, text: res.reasoning }, ...blocks]
    blocks = [...(blocks || []), { t: 'note' as const, text: '📚 依据知识库：' + citeSources(sr.hits) }]
    settle(blocks)
  }, [])

  // 核心发送：显式 text/atts/quotes；自动携带该线程的多轮上下文（AI 记得上文，可追问）
  // 引用片段：气泡里作为卡片单独展示；发给模型的文本把引用+疑问组装进上下文
  const pushAndReply = useCallback((key: string, text: string, atts: Composer['attachments'], deep = false, qs: QuoteRef[] = []): void => {
    if (!text && atts.length === 0 && qs.length === 0) return
    const currentMessages = threadsRef.current[key] || []
    if (key === 'ask' && conversationBusy(currentMessages)) { showToast('当前回答尚未完成，请等待完成或停止本机 Agent 后再发送'); return }
    const branchId = key === 'ask' ? activeAskBranchRef.current.id : undefined
    if (key === 'ask') setActiveAskBranch((branch) => ({ ...branch, title: branch.title === '新会话' ? (text.trim().replace(/\s+/g, ' ').slice(0, 28) || '附件会话') : branch.title, updatedAt: Date.now() }))
    const memory = key === 'ask' ? activeAskBranchRef.current.memory || '' : ''
    const history = historyFromThread(currentMessages, 12, memory)
    const llmText = qs.length ? buildQuotedPrompt(qs, text) : text
    setThreads((th) => ({ ...th, [key]: [...(th[key] || []), { role: 'user', text, attachments: atts, quotes: qs.length ? qs : undefined, ts: Date.now() }, { role: 'agent', typing: true }] }))
    setComposers((c) => ({ ...c, [key]: emptyComposer() }))
    if (qs.length) setQuotes((q) => ({ ...q, [key]: [] }))
    // 问答区开启"知识库模式"→ 走 RAG 接地作答（本地 Agent 引擎自带工具与上下文，跳过 KB）；其余照常
    if (key === 'ask' && kbModeRef.current && askEngineRef.current === 'llm') {
      const requestModelLabel = llmModelLabel(llmRef.current)
      const settle = (blocks: ChatMessage['blocks']): void => patchAskBranchMessages(branchId!, (messages) => [...messages.filter((message) => !message.typing && !message.live), { role: 'agent', blocks, modelLabel: requestModelLabel, ts: Date.now() }])
      const instruction = activeAskBranchRef.current.instruction || ''
      void runKbReply(llmText, deep, history, instruction, settle).catch((error) => settle([{ t: 'note', text: '知识库问答失败：' + String(error) }]))
    } else {
      fetchReply(key, llmText, atts, deep, history, branchId)
    }
  }, [fetchReply, patchAskBranchMessages, runKbReply, showToast])

  // 引用追问：添加/移除待发送引用片段
  const addQuote = useCallback((key: string, q: { text: string; note?: string }): void => {
    setQuotes((all) => ({ ...all, [key]: [...(all[key] || []), { id: Date.now() * 100 + ((all[key]?.length || 0) % 100), text: q.text, note: q.note }] }))
  }, [])
  const removeQuote = useCallback((key: string, id: number): void => {
    setQuotes((all) => ({ ...all, [key]: (all[key] || []).filter((x) => x.id !== id) }))
  }, [])

  // ===== 问答分支树：稳定分支 id + 父子关系 + 分支级长期记忆/指令 =====
  const archiveCurrentAsk = useCallback((): AskSession | null => {
    const msgs = threadsRef.current['ask'] || []
    if (!msgs.some((message) => !message.typing && !message.live)) return null
    return {
      ...activeAskBranch,
      title: activeAskBranch.title === '新会话' ? conversationTitle(msgs) : activeAskBranch.title,
      msgs: compactChatMessages(msgs),
      updatedAt: Date.now()
    }
  }, [activeAskBranch])
  const askNew = useCallback((): void => {
    const arch = archiveCurrentAsk()
    if (arch) setAskSessions((list) => [arch, ...list.filter((item) => item.id !== arch.id)].slice(0, 40))
    const next = newAskBranch()
    activeAskBranchRef.current = next
    setActiveAskBranch(next)
    setThreads((th) => ({ ...th, ask: [] }))
  }, [archiveCurrentAsk])
  const askSwitch = useCallback((id: number): void => {
    if (id === activeAskBranch.id) return
    const target = askSessions.find((session) => session.id === id)
    if (!target) return
    const arch = archiveCurrentAsk()
    setAskSessions((list) => {
      const rest = list.filter((session) => session.id !== id && session.id !== arch?.id)
      return arch ? [arch, ...rest].slice(0, 40) : rest
    })
    const { msgs, ...meta } = target
    activeAskBranchRef.current = meta
    setActiveAskBranch(meta)
    setThreads((th) => ({ ...th, ask: msgs }))
  }, [activeAskBranch.id, archiveCurrentAsk, askSessions])
  const askDelete = useCallback((id: number): void => {
    const deleted = askSessions.find((session) => session.id === id)
    if (!deleted) return
    setAskSessions((list) => list
      .filter((session) => session.id !== id)
      .map((session) => session.parentId === id ? { ...session, parentId: deleted.parentId, updatedAt: Date.now() } : session))
    setActiveAskBranch((branch) => {
      if (branch.parentId !== id) return branch
      const next = { ...branch, parentId: deleted.parentId, updatedAt: Date.now() }
      activeAskBranchRef.current = next
      return next
    })
  }, [askSessions])

  const askFork = useCallback((msgIndex: number): void => {
    const msgs = threadsRef.current.ask || []
    const forked = forkConversation(msgs, msgIndex)
    if (!forked.length) return
    const original = archiveCurrentAsk()
    if (original) setAskSessions((list) => [original, ...list.filter((item) => item.id !== original.id)].slice(0, 40))
    const title = `${conversationTitle(forked)} · 分支`
    const next = { ...newAskBranch(title, activeAskBranch.id, msgIndex), memory: activeAskBranch.memory || '', instruction: activeAskBranch.instruction || '' }
    activeAskBranchRef.current = next
    setActiveAskBranch(next)
    setThreads((all) => ({ ...all, ask: forked }))
    showToast('已从当前节点 Fork，新分支继承此前上下文')
  }, [activeAskBranch.id, archiveCurrentAsk, showToast])

  const renameAskBranch = useCallback((title: string): void => {
    const next = title.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (next) setActiveAskBranch((branch) => ({ ...branch, title: next, updatedAt: Date.now() }))
  }, [])

  const sendMessage = useCallback((key: string, deep = false): void => {
    const cur = getComposer(key)
    pushAndReply(key, (cur.text || '').trim(), cur.attachments, deep, quotesRef.current[key] || [])
  }, [getComposer, pushAndReply])
  const sendPreset = useCallback((key: string, text: string, deep = false): void => {
    pushAndReply(key, text, [], deep)
  }, [pushAndReply])

  // 剪贴板 AI 聚类：文本片段按主题聚成集（组名 → id）
  const clusterClips = useCallback((): void => {
    const items = clips.filter((c) => c.kind === 'text' && c.text).slice(0, 40).map((c) => ({ id: c.id, text: c.text! }))
    if (items.length < 2) { setToast('剪贴板文本太少，无法聚类'); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3000); return }
    setClipClustering(true)
    const L = llmRef.current
    island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, CLUSTER_SYSTEM, clusterPrompt(items), false).then((res) => {
      setClipClustering(false)
      const groups = res.ok ? parseClusters(res.text) : null
      if (!groups) { setToast('聚类失败，请检查模型配置'); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 3000); return }
      const map: Record<number, string> = {}
      for (const g of groups) for (const id of g.ids) map[id] = g.name
      setClipGroups(map)
    })
  }, [clips])

  // 自动化：生成一份复盘/简报到 reviews[storeKey]（已存在则跳过；未配模型则静默）
  const genReview = useCallback((storeKey: string, system: string, user: string, deep: boolean): void => {
    if (reviewsRef.current[storeKey]) return
    const L = llmRef.current
    if (!L.apiKey || !L.model) return
    island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, system, user, deep).then((res) => {
      if (res.ok && res.text) setReviews((r) => ({ ...r, [storeKey]: res.text!.trim() }))
    })
  }, [])

  // 就地追问：问答与回答都嵌套在第 msgIndex 条回答气泡内（子线程），上下文含主对话到该条为止 + 该气泡已有子线程
  const followUpReply = useCallback((key: string, msgIndex: number, text: string, deep = false): void => {
    const t = text.trim()
    if (!t) return
    const branchId = key === 'ask' ? activeAskBranchRef.current.id : undefined
    const patchFollow = (fn: (fu: ChatMessage[]) => ChatMessage[]): void =>
      branchId === undefined
        ? setThreads((th) => {
            const list = th[key] || []
            if (!list[msgIndex]) return th
            return { ...th, [key]: list.map((m, i) => (i === msgIndex ? { ...m, followups: fn(m.followups || []) } : m)) }
          })
        : patchAskBranchMessages(branchId, (list) => list[msgIndex]
          ? list.map((m, i) => (i === msgIndex ? { ...m, followups: fn(m.followups || []) } : m))
          : list)

    // 1) 追问 + typing 占位挂进子线程
    patchFollow((fu) => [...fu, { role: 'user', text: t, ts: Date.now() }, { role: 'agent', typing: true }])

    const L = llmRef.current
    const cfg = { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }
    const requestModelLabel = llmModelLabel(L)
    const settle = (blocks: ChatMessage['blocks']): void =>
      patchFollow((fu) => [...fu.filter((m) => !m.typing), { role: 'agent', blocks, modelLabel: cfg.apiKey && cfg.model ? requestModelLabel : undefined, ts: Date.now() }])

    // 2) 上下文：主线程到该条为止 + 该气泡已有子线程（此刻 ref 尚未含新追问，正合适）
    const base = threadsRef.current[key] || []
    const history = [
      ...historyFromThread(base.slice(0, msgIndex + 1), 12, key === 'ask' ? activeAskBranchRef.current.memory || '' : ''),
      ...historyFromThread(base[msgIndex]?.followups || [])
    ]

    // 本地 Agent 引擎的追问显式注入岛内上下文，不使用 CLI 全局“最近会话”。
    if (key === 'ask' && askEngineRef.current !== 'llm') {
      const eng = askEngineRef.current as 'claude' | 'codex'
      const instruction = activeAskBranchRef.current.instruction?.trim() || ''
      const prompt = buildAgentContextPrompt(history, t, instruction)
      const patchLive = (m: ChatMessage): void => patchFollow((fu) => [...fu.filter((x) => !x.typing && !x.live), { ...m, ts: Date.now() }])
      void runAgentStream(eng, prompt, false, false, patchLive, (blocks) => patchLive({ role: 'agent', blocks }))
      return
    }
    if (!cfg.apiKey || !cfg.model) {
      settle([{ t: 'note', text: '请先在 Settings › 问答助手模型 里配置端点、型号与 API Key。' }])
      return
    }
    // 知识库模式下的追问同样走 RAG 接地
    if (key === 'ask' && kbModeRef.current) {
      const instruction = activeAskBranchRef.current.instruction || ''
      void runKbReply(t, deep, history, instruction, settle).catch((error) => settle([{ t: 'note', text: '知识库追问失败：' + String(error) }]))
      return
    }
    const instruction = key === 'ask' ? activeAskBranchRef.current.instruction?.trim() : ''
    const system = systemFor(key, deep) + (instruction ? `\n\n本会话额外指令（持续生效）：\n${instruction}` : '')
    island.llmComplete(cfg, system, t, deep, history).then((res) => {
      if (res.ok) {
        let blocks = parseBlocks(res.text) || looseBlocks(res.text)
        if (res.reasoning) blocks = [{ t: 'think' as const, text: res.reasoning }, ...blocks]
        settle(blocks)
      } else {
        settle([{ t: 'note', text: '请求失败：' + (res.error || '未知错误') }])
      }
    }).catch((error) => settle([{ t: 'note', text: '请求失败：' + String(error) }]))
  }, [patchAskBranchMessages, runKbReply, runAgentStream])

  const setAskContextMode = useCallback((msgIndex: number, mode: NonNullable<ChatMessage['contextMode']>): void => {
    setThreads((all) => ({
      ...all,
      ask: (all.ask || []).map((message, index) => index === msgIndex ? { ...message, contextMode: mode } : message)
    }))
  }, [])

  const compressAskContext = useCallback((): void => {
    const msgs = (threadsRef.current.ask || []).filter((message) => !message.typing && !message.live)
    if (msgs.length < 4) { showToast('当前会话还不需要压缩上下文'); return }
    const L = llmRef.current
    if (!L.apiKey || !L.model) { showToast('请先配置可用的问答模型'); return }
    const branchId = activeAskBranchRef.current.id
    showToast('正在压缩为长期会话记忆…')
    const system = '你是会话记忆压缩器。输出简体中文 Markdown，只保留后续对话必须记住的事实、偏好、约束、已确认结论、分歧和未解决问题；不要复述过程，不要添加新信息。'
    void island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, system, conversationToMarkdown(msgs).slice(0, 40000), false).then((res) => {
      if (!res.ok || !res.text?.trim()) { showToast(res.error || '会话记忆压缩失败'); return }
      patchAskBranchMeta(branchId, (branch) => ({ ...branch, memory: res.text!.trim(), updatedAt: Date.now() }))
      showToast(activeAskBranchRef.current.id === branchId ? '长期会话记忆已更新，后续轮次会持续携带' : '记忆压缩已完成，结果保存在发起操作的会话分支')
    }).catch((error) => showToast('会话记忆压缩失败：' + String(error)))
  }, [patchAskBranchMeta, showToast])

  const mergeAskBranch = useCallback((id: number): void => {
    const source = askSessions.find((session) => session.id === id)
    if (!source) return
    const L = llmRef.current
    if (!L.apiKey || !L.model) { showToast('请先配置可用的问答模型'); return }
    const targetBranchId = activeAskBranchRef.current.id
    showToast(`正在合并分支「${source.title}」…`)
    const system = '你是会话分支合并器。只输出可直接放进长期会话记忆的简体中文 Markdown，不要寒暄，不要编造。'
    void island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, system, branchMergePrompt(source.title, source.msgs), false).then((res) => {
      if (!res.ok || !res.text?.trim()) { showToast(res.error || '分支合并失败'); return }
      patchAskBranchMeta(targetBranchId, (branch) => ({
        ...branch,
        memory: [branch.memory?.trim(), `## 合并自「${source.title}」\n${res.text!.trim()}`].filter(Boolean).join('\n\n'),
        updatedAt: Date.now()
      }))
      showToast(activeAskBranchRef.current.id === targetBranchId ? '分支结论已合并进当前会话记忆' : '分支合并已完成，结果保存在发起操作的目标分支')
    }).catch((error) => showToast('分支合并失败：' + String(error)))
  }, [askSessions, patchAskBranchMeta, showToast])

  const saveAskKnowledge = useCallback(async (scope: 'message' | 'conversation' | 'selection', msgIndex?: number, selectedText?: string): Promise<{ ok: boolean; message: string }> => {
    const embed = embedConfigRef.current
    if (!embed.baseUrl.trim() || !embed.apiKey.trim() || !embed.model.trim()) return { ok: false, message: '请先在知识库面板配置完整的向量连接' }
    const msgs = threadsRef.current.ask || []
    let title = activeAskBranchRef.current.title || '问答会话'
    let content = ''
    let sourceKey = `${activeAskBranchRef.current.id}:conversation`
    if (scope === 'selection') {
      content = selectedText?.trim() || ''
      title += ' · 摘录'
      sourceKey = `${activeAskBranchRef.current.id}:selection:${Date.now()}`
    } else if (scope === 'message' && msgIndex != null && msgs[msgIndex]) {
      content = conversationToMarkdown([msgs[msgIndex]])
      title += msgs[msgIndex].role === 'agent' ? ' · 回答' : ' · 提问'
      sourceKey = `${activeAskBranchRef.current.id}:message:${msgIndex}`
    } else {
      content = [activeAskBranchRef.current.instruction ? `# 会话指令\n${activeAskBranchRef.current.instruction}` : '', activeAskBranchRef.current.memory ? `# 长期记忆\n${activeAskBranchRef.current.memory}` : '', conversationToMarkdown(msgs)].filter(Boolean).join('\n\n')
    }
    if (!content.trim()) return { ok: false, message: '没有可保存的会话内容' }
    try {
      const result = await island.kbAddText(embed, title, content, sourceKey)
      if (!result.ok) return { ok: false, message: result.error || '写入知识库失败' }
      refreshKb()
      return { ok: true, message: `已写入本地知识库 · ${result.added || 0} 个向量块` }
    } catch (error) {
      return { ok: false, message: '写入知识库失败：' + String(error) }
    }
  }, [refreshKb])

  const advanceAsk = useCallback(async (msgIndex: number, action: keyof typeof ADVANCE_PROMPTS, deep: boolean): Promise<void> => {
    const msgs = threadsRef.current.ask || []
    if (!msgs[msgIndex] || msgs[msgIndex].role !== 'agent') return
    const branchId = activeAskBranchRef.current.id
    const target = conversationToMarkdown([msgs[msgIndex]]).slice(0, 18000)
    const prompt = `${ADVANCE_PROMPTS[action]}\n\n【本次要处理的目标回答】\n${target}`
    const attachAnalysis = (blocks: Block[]): void => {
      const createdAt = Date.now()
      patchAskBranchMessages(branchId, (messages) => upsertAnswerAnalysis(messages, msgIndex, {
        id: `${action}:${createdAt}`, action, label: ANSWER_ANALYSIS_LABELS[action], blocks, createdAt
      }))
    }
    if (action === 'suggest') {
      const L = llmRef.current
      if (!L.apiKey || !L.model) { showToast('请先配置可用的问答模型'); return }
      const history = historyFromThread(msgs.slice(0, msgIndex + 1), 16, activeAskBranchRef.current.memory || '')
      const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, '只输出一个 JSON 字符串数组，不要解释。', prompt, false, history)
      if (!res.ok || !res.text) { showToast(res.error || '下一问生成失败'); return }
      let suggestions: string[] = []
      try {
        const start = res.text.indexOf('['), end = res.text.lastIndexOf(']')
        const parsed = JSON.parse(start >= 0 && end > start ? res.text.slice(start, end + 1) : res.text)
        if (Array.isArray(parsed)) suggestions = parsed.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 4)
      } catch { suggestions = res.text.split(/\r?\n/).map((line) => line.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 4) }
      patchAskBranchMessages(branchId, (messages) => messages.map((message, index) => index === msgIndex ? { ...message, suggestions } : message))
      return
    }
    const history = historyFromThread(msgs.slice(0, msgIndex + 1), 16, activeAskBranchRef.current.memory || '')
    const branchInstruction = activeAskBranchRef.current.instruction || ''
    if (action === 'ground') {
      try {
        await new Promise<void>((resolve, reject) => {
          void runKbReply(prompt, deep, history, branchInstruction, (blocks) => { attachAnalysis(blocks || []); resolve() }).catch(reject)
        })
      } catch (error) { showToast('知识库核验失败：' + String(error)) }
      return
    }
    const L = llmRef.current
    if (!L.apiKey || !L.model) { showToast('请先配置可用的问答模型'); return }
    const system = '你是回答分析助手。只处理用户指定的目标回答，输出简体中文 Markdown；不要假装这是一次新的用户提问。' + (branchInstruction.trim() ? `\n\n本会话规则：\n${branchInstruction.trim()}` : '')
    const res = await island.llmComplete({ baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model }, system, prompt, deep, history)
    if (!res.ok || !res.text) { showToast(res.error || `${ANSWER_ANALYSIS_LABELS[action]}失败`); return }
    let blocks = parseBlocks(res.text) || looseBlocks(res.text)
    if (res.reasoning) blocks = [{ t: 'think' as const, text: res.reasoning }, ...blocks]
    attachAnalysis(blocks)
  }, [patchAskBranchMessages, runKbReply, showToast])

  const councilModels = useMemo(() => {
    const currentConfig = { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, apiKey: llm.apiKey }
    const current = llm.apiKey && llm.model ? [{ id: 'current', label: llmModelLabel(llm) }] : []
    const saved = llm.saved
      .filter((config) => config.apiKey && config.model && !providerConfigEquals(config, currentConfig))
      .map((config) => ({ id: `saved:${config.id}`, label: config.name }))
    return [...current, ...saved].slice(0, 8)
  }, [llm.apiKey, llm.baseUrl, llm.model, llm.provider, llm.saved])

  const runAskCouncil = useCallback(async (mode: 'parallel' | 'consensus' | 'debate', modelIds: string[], deep: boolean): Promise<void> => {
    const branchId = activeAskBranchRef.current.id
    const stableMessages = (threadsRef.current.ask || []).map((message, index) => ({ message, index })).filter(({ message }) => !message.typing && !message.live)
    const msgs = stableMessages.map(({ message }) => message)
    const lastUserEntry = [...stableMessages].reverse().find(({ message }) => message.role === 'user' && message.text?.trim())
    const lastUser = lastUserEntry?.message
    if (!lastUser?.text) { showToast('先提出一个问题，再启动多模型讨论'); return }
    const L = llmRef.current
    const allConfigs = [
      { id: 'current', label: llmModelLabel(L), provider: L.provider, baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model },
      ...L.saved.map((config) => ({ id: `saved:${config.id}`, label: config.name, provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }))
    ]
    const configs = modelIds
      .map((id) => allConfigs.find((config) => config.id === id))
      .filter((config): config is NonNullable<typeof config> => !!config?.apiKey && !!config.model)
      .filter((config, index, values) => values.findIndex((candidate) => providerConfigEquals(candidate, config)) === index)
    if (configs.length < 2) { showToast('多模型讨论至少需要两个已配置模型'); return }
    const lastUserStableIndex = stableMessages.indexOf(lastUserEntry!)
    const targetAgentEntry = stableMessages.find(({ message }, index) => index > lastUserStableIndex && message.role === 'agent')
    if (!targetAgentEntry) { showToast('当前问题还没有可附着的回答'); return }
    const history = historyFromThread(msgs.slice(0, lastUserStableIndex), 16, activeAskBranchRef.current.memory || '')
    const instruction = activeAskBranchRef.current.instruction?.trim()
    const system = systemFor('ask', deep) + (instruction ? `\n\n本会话额外指令：\n${instruction}` : '')
    try {
      const variants = await Promise.all(configs.map(async (config) => {
        const result = await island.llmComplete(config, system, lastUser.text!, deep, history)
        let blocks = result.ok ? (parseBlocks(result.text) || looseBlocks(result.text)) : [{ t: 'note' as const, text: result.error || `${config.label} 请求失败` }]
        if (result.reasoning) blocks = [{ t: 'think' as const, text: result.reasoning }, ...blocks]
        return { id: config.id, label: config.label, blocks }
      }))
      let summaryBlocks: Block[] | undefined
      if (mode !== 'parallel') {
        const body = variants.map((variant, index) => `【候选 ${index + 1} · ${variant.label}】\n${conversationToMarkdown([{ role: 'agent', blocks: variant.blocks }])}`).join('\n\n')
        const moderator = mode === 'consensus'
          ? '比较这些候选回答，提炼共识，保留必要分歧，给出一份更可靠且可执行的最终回答。'
          : '主持一轮模型辩论：指出候选答案的核心分歧、各自最强论据、共同盲区，并给出你的裁决。'
        // 当前设置可能在讨论期间被清空或未被选中；主持请求使用本轮已校验的第一个配置。
        const moderatorConfig = configs[0]
        const result = await island.llmComplete(moderatorConfig, system, `${moderator}\n\n原问题：${lastUser.text}\n\n${body.slice(0, 45000)}`, deep, history)
        summaryBlocks = result.ok ? (parseBlocks(result.text) || looseBlocks(result.text)) : [{ t: 'note', text: result.error || '主持模型请求失败' }]
      }
      const createdAt = Date.now()
      patchAskBranchMessages(branchId, (messages) => {
        const withVariants = messages.map((message, index) => index === targetAgentEntry.index ? { ...message, variants } : message)
        return summaryBlocks
          ? upsertAnswerAnalysis(withVariants, targetAgentEntry.index, { id: `council:${createdAt}`, action: 'council', label: mode === 'consensus' ? '多模型汇总' : '分歧比较', blocks: summaryBlocks, createdAt })
          : withVariants
      })
      showToast(activeAskBranchRef.current.id === branchId
        ? (mode === 'parallel' ? '候选回答已附加到原回答' : '多模型结论已附加到原回答')
        : '多模型讨论已完成，结果保存在发起讨论的会话分支')
    } catch (error) {
      showToast(`多模型讨论失败：${String(error)}`)
    }
  }, [patchAskBranchMessages, showToast])

  const adoptAskVariant = useCallback((msgIndex: number, variantId: string): void => {
    setThreads((all) => ({
      ...all,
      ask: (all.ask || []).map((message, index) => {
        if (index !== msgIndex) return message
        const variant = message.variants?.find((item) => item.id === variantId)
        return variant ? { ...message, blocks: variant.blocks } : message
      })
    }))
    showToast('已采用该模型回答，后续对话将以它作为主上下文')
  }, [showToast])

  const convFor = useCallback((key: string, placeholder: string, quick?: string[], deep = false): ChatProps => ({
    messages: threads[key] || [],
    composer: getComposer(key),
    placeholder,
    quickReplies: quick,
    // 问答区消息历史更高：标准 420px，大尺寸 620px 固定，仅真全屏才绑 100vh（覆盖层铺满窗口时 100vh 会突变，不能用）。
    // 全屏扣除量收紧到 305px（头部工具条 ~44 + 输入区峰值 ~130 + 头/尾余量）——让气泡区吃满高度、输入框下移贴底，消除底部空白。
    maxH: key === 'ask' ? (fullscreen ? 'calc(100vh - 305px)' : settings.largeSize ? 620 : 420) : undefined,
    onQuick: (t) => sendPreset(key, t, deep),
    onText: (v) => patchComposer(key, { text: v }),
    onSend: () => sendMessage(key, deep),
    onAttach: (type, payload) => onAttach(key, type, payload),
    onRemoveAtt: (i) => onRemoveAtt(key, i),
    // 引用追问仅问答区开启（框选 AI 回复 → 备注 → 贴入输入区）
    enableQuote: key === 'ask',
    // 就地追问仅问答区开启：问答嵌套在该条回答气泡内，上下文仍含整段主对话
    onFollowUp: key === 'ask' ? (mi: number, text: string): void => followUpReply(key, mi, text, deep) : undefined,
    quotes: quotes[key] || [],
    onAddQuote: (q) => addQuote(key, q),
    onRemoveQuote: (id) => removeQuote(key, id),
    branch: key === 'ask' ? {
      activeId: activeAskBranch.id,
      title: activeAskBranch.title,
      parentId: activeAskBranch.parentId,
      branches: [
        { id: activeAskBranch.id, title: activeAskBranch.title, parentId: activeAskBranch.parentId, forkAt: activeAskBranch.forkAt, active: true },
        ...askSessions.map((session) => ({ id: session.id, title: session.title, parentId: session.parentId, forkAt: session.forkAt }))
      ]
    } : undefined,
    onFork: key === 'ask' ? askFork : undefined,
    onSwitchBranch: key === 'ask' ? askSwitch : undefined,
    onRenameBranch: key === 'ask' ? renameAskBranch : undefined,
    onMergeBranch: key === 'ask' ? mergeAskBranch : undefined,
    memory: key === 'ask' ? activeAskBranch.memory || '' : undefined,
    instruction: key === 'ask' ? activeAskBranch.instruction || '' : undefined,
    onSetMemory: key === 'ask' ? (memory) => setActiveAskBranch((branch) => ({ ...branch, memory, updatedAt: Date.now() })) : undefined,
    onSetInstruction: key === 'ask' ? (instruction) => setActiveAskBranch((branch) => ({ ...branch, instruction, updatedAt: Date.now() })) : undefined,
    onCompressContext: key === 'ask' ? compressAskContext : undefined,
    onSetContextMode: key === 'ask' ? setAskContextMode : undefined,
    onSaveKnowledge: key === 'ask' ? saveAskKnowledge : undefined,
    councilModels: key === 'ask' ? councilModels : undefined,
    onCouncil: key === 'ask' ? (mode, ids) => runAskCouncil(mode, ids, deep) : undefined,
    onAdoptVariant: key === 'ask' ? adoptAskVariant : undefined,
    onAdvance: key === 'ask' ? (index, action) => advanceAsk(index, action, deep) : undefined,
    onUseSuggestion: key === 'ask' ? (value) => patchComposer(key, { text: value }) : undefined,
    busy: key === 'ask' ? conversationBusy(threads[key] || []) : undefined
  }), [threads, quotes, getComposer, sendPreset, followUpReply, patchComposer, sendMessage, onAttach, onRemoveAtt, addQuote, removeQuote, settings.largeSize, fullscreen, activeAskBranch, askSessions, askFork, askSwitch, renameAskBranch, mergeAskBranch, compressAskContext, setAskContextMode, saveAskKnowledge, councilModels, runAskCouncil, adoptAskVariant, advanceAsk])

  // ===== LLM 设置 =====
  const setLlmField = (f: 'model' | 'baseUrl' | 'apiKey', v: string): void => setLlm((s) => ({
    ...s,
    ...patchProviderDraft(s, { [f]: v }),
    testStatus: 'idle',
    testMsg: ''
  }))
  const setProvider = (k: string): void => {
    setLlm((s) => ({ ...s, ...switchProviderSettings(s, k), testStatus: 'idle', testMsg: '' }))
  }
  // ===== 型号列表：新增（并设为当前）/ 删除 / 点选 =====
  const addModel = (name: string): void =>
    setLlm((s) => {
      const list = s.modelLists[s.provider] || []
      const next = { ...s, modelLists: list.includes(name) ? s.modelLists : { ...s.modelLists, [s.provider]: [...list, name] } }
      return { ...next, ...patchProviderDraft(next, { model: name }), testStatus: 'idle', testMsg: '' }
    })
  const removeModel = (name: string): void =>
    setLlm((s) => {
      const list = (s.modelLists[s.provider] || []).filter((m) => m !== name)
      const next = { ...s, modelLists: { ...s.modelLists, [s.provider]: list } }
      return s.model === name
        ? { ...next, ...patchProviderDraft(next, { model: list[0] || '' }), testStatus: 'idle', testMsg: '' }
        : next
    })
  const pickModel = (name: string): void => setLlm((s) => ({ ...s, ...patchProviderDraft(s, { model: name }), testStatus: 'idle', testMsg: '' }))
  const syncLlmModels = (): void => {
    const { provider, baseUrl, apiKey, model } = llm
    setLlm((s) => ({ ...s, testStatus: 'testing', testMsg: '正在读取可用模型…' }))
    island.llmListModels({ baseUrl, apiKey, model }).then((r) => {
      setLlm((s) => {
        // 用户可能在请求期间切换了供应商，旧请求不得污染新面板。
        if (s.provider !== provider || s.baseUrl !== baseUrl || s.apiKey !== apiKey) return s
        if (!r.ok || !r.models?.length) {
          return { ...s, testStatus: 'fail', testMsg: r.error || '未读取到可用模型' }
        }
        const list = [...new Set([...r.models, ...(s.modelLists[provider] || [])])]
        const next = { ...s, modelLists: { ...s.modelLists, [provider]: list } }
        const selected = list.includes(s.model) ? s.model : list[0] || ''
        return {
          ...next,
          ...patchProviderDraft(next, { model: selected }),
          testStatus: 'ok',
          testMsg: `已同步 ${r.models.length} 个可用模型`
        }
      })
    }).catch((e: unknown) => {
      setLlm((s) => s.provider === provider && s.baseUrl === baseUrl && s.apiKey === apiKey
        ? { ...s, testStatus: 'fail', testMsg: String(e) }
        : s)
    })
  }
  const testLlm = (): void => {
    const { provider, baseUrl, apiKey, model } = llm
    setLlm((s) => ({ ...s, testStatus: 'testing', testMsg: '正在连接…' }))
    island.llmTest({ baseUrl, apiKey, model }).then((r) => {
      setLlm((s) => s.provider === provider && s.baseUrl === baseUrl && s.apiKey === apiKey && s.model === model
        ? { ...s, testStatus: r.ok ? 'ok' : 'fail', testMsg: r.msg }
        : s)
    }).catch((e: unknown) => {
      setLlm((s) => s.provider === provider && s.baseUrl === baseUrl && s.apiKey === apiKey && s.model === model
        ? { ...s, testStatus: 'fail', testMsg: String(e) }
        : s)
    })
  }
  const saveLlm = (): void => setLlm((s) => ({ ...s, ...saveProviderSettings(s), testStatus: 'idle', testMsg: '' }))
  const loadLlm = (id: number): void => setLlm((s) => ({ ...s, ...loadProviderSettings(s, id), testStatus: 'idle', testMsg: '' }))
  const deleteLlm = (id: number): void => setLlm((s) => ({ ...s, saved: s.saved.filter((x) => x.id !== id) }))

  // ===== 灵感便签：AI 生成 / AI 语义搜索 / 手动增删改 =====
  const noteAdd = useCallback((): void => {
    const now2 = Date.now()
    setNotes((l) => [{ id: now2, emoji: '📝', title: '新便签', md: '在这里写下你的灵感…\n\n- 支持 **Markdown**\n- 代码块 / 链接 / 图片外链', color: 'emerald', tags: [], createdAt: now2, updatedAt: now2 }, ...l].slice(0, 400))
  }, [])
  const noteUpdate = useCallback((n: StickyNote): void => {
    setNotes((l) => l.map((x) => (x.id === n.id ? n : x)))
    // 若该便签已钉屏，同步更新浮贴
    island.stickyPush({ id: n.id, emoji: n.emoji, title: n.title, md: n.md, color: n.color })
  }, [])
  const noteAddFull = useCallback((n: StickyNote): void => setNotes((l) => [n, ...l].slice(0, 400)), [])
  const pinNoteDesktop = useCallback((n: StickyNote): void => {
    island.toggleSticky({ id: n.id, emoji: n.emoji, title: n.title, md: n.md, color: n.color })
  }, [])
  const openStudioNote = useCallback((n: StickyNote): void => { setRevealed(true); setStudio({ id: n.id, title: n.title, md: n.md }) }, [])
  const noteDelete = useCallback((id: number): void => setNotes((l) => l.map((x) => (x.id === id ? { ...x, trashed: true, updatedAt: Date.now() } : x))), []) // 软删到回收站
  const noteTogglePin = useCallback((id: number): void => setNotes((l) => l.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x))), [])
  const noteStar = useCallback((id: number): void => setNotes((l) => l.map((x) => (x.id === id ? { ...x, starred: !x.starred } : x))), [])
  const noteRestore = useCallback((id: number): void => setNotes((l) => l.map((x) => (x.id === id ? { ...x, trashed: false } : x))), [])
  const notePurge = useCallback((id: number): void => setNotes((l) => l.filter((x) => x.id !== id)), [])
  const noteBatchColor = useCallback((ids: number[], color: string): void => setNotes((l) => l.map((x) => (ids.includes(x.id) ? { ...x, color, updatedAt: Date.now() } : x))), [])
  const noteBatchTrash = useCallback((ids: number[]): void => setNotes((l) => l.map((x) => (ids.includes(x.id) ? { ...x, trashed: true } : x))), [])
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

  const patchNewsItem = useCallback((id: string, patch: Partial<FeedItem>): void => {
    setFeedItems((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [])

  const synthesizeNews = useCallback(async (items: FeedItem[]): Promise<string> => {
    const L = llmRef.current
    if (!L.apiKey || !L.model) return '✗ 请先配置模型'
    if (items.length < 2) return '✗ 至少选择 2 条资讯'
    const result = await island.llmComplete(
      { baseUrl: L.baseUrl, apiKey: L.apiKey, model: L.model },
      '你是技术情报分析师。严格依据输入材料输出结构清晰、可追溯的中文 Markdown，不得补写材料中不存在的事实。',
      synthesisPrompt(items.slice(0, 8), activeProject?.name),
      true
    )
    return result.ok && result.text ? result.text.trim() : `✗ ${result.error || '综合失败'}`
  }, [activeProject])

  const saveNewsArtifact = useCallback((title: string, content: string, sourceId: string, kind: 'brief' | 'signal' = 'brief'): void => {
    if (!content.trim()) return
    const artifact: WorkArtifact = { id: `artifact-news-${Date.now()}`, projectId: activeProjectId || undefined, source: 'news', sourceId, kind, title: title.trim().slice(0, 80) || '项目情报简报', content: content.trim(), createdAt: Date.now() }
    setWorkArtifacts((items) => [artifact, ...items].slice(0, 100))
    showToast(activeProject ? `已保存到项目「${activeProject.name}」` : '已保存为未归属情报')
  }, [activeProject, activeProjectId])

  const newsItemToTodo = useCallback((item: FeedItem): void => {
    const now = Date.now()
    const priority: 1 | 2 | 3 = item.impact === 'high' ? 1 : item.impact === 'medium' ? 2 : 3
    setTodos((list) => [...list, { id: now * 100 + (todoSeq.current++ % 100), text: `跟进：${item.title}`.slice(0, 200), note: `${item.brief || item.summary || ''}\n\n来源：${item.link}`.trim(), projectId: activeProject?.id, project: activeProject?.name, priority, done: false, status: 'todo', createdAt: now }])
    patchNewsItem(item.id, { signalStatus: 'actioned', projectIds: activeProjectId ? [...new Set([...(item.projectIds || []), activeProjectId])] : item.projectIds })
    showToast('资讯已转为待办')
  }, [activeProject, activeProjectId, patchNewsItem])

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
    setTodos((l) => [...l, { id: Date.now() * 100 + (todoSeq.current++ % 100), text, due, done: false, notified: false, priority, repeat, projectId: activeProject?.id, project: activeProject?.name, createdAt: Date.now() }])
  // 看板列内快速添加：直接落到指定状态
  const todoQuickAdd = (text: string, status: 'todo' | 'doing' | 'done'): void => {
    const now = Date.now()
    setTodos((l) => [...l, { id: now * 100 + (todoSeq.current++ % 100), text, done: status === 'done', status, priority: 3, projectId: activeProject?.id, project: activeProject?.name, createdAt: now, doneAt: status === 'done' ? now : undefined }])
  }

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
  }, [activeProject])
  const todoToggle = (id: number): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : undefined } : t)))
  const todoPin = (id: number): void => setTodos((l) => l.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)))
  // 看板：设状态并同步 done（已完成→done=true 记时间）
  const todoSetStatus = (id: number, status: 'todo' | 'doing' | 'done'): void =>
    setTodos((l) => l.map((t) => (t.id === id ? { ...t, status, done: status === 'done', doneAt: status === 'done' ? (t.doneAt || Date.now()) : undefined } : t)))
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
  // 通用补丁更新（新增待办功能统一走这条：标签/预估/归档/投入时长等）
  const todoPatch = (id: number, patch: Partial<TodoItem>): void => setTodos((l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  // 批量新增（AI 规划/拆解一次进多条）
  const todoBulkAdd = (items: Array<Pick<TodoItem, 'text'> & Partial<TodoItem>>): void =>
    setTodos((l) => [...items.map((it, i) => ({ ...it, id: Date.now() + i, text: it.text, done: false, status: it.status || 'todo', projectId: it.projectId || activeProject?.id, project: it.project || activeProject?.name, createdAt: Date.now() + i })), ...l])
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

  // 晨间简报素材（复盘页 + 晨间自动化规则共用）
  const morningInput: MorningInput = useMemo(() => ({
    dateLabel: new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
    meetings: meetings
      .filter((m) => dayKey(m.start) === dayKey(Date.now()))
      .sort((a, b) => a.start - b.start)
      .map((m) => ({ title: m.title, time: m.allDay ? '全天' : new Date(m.start).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), link: m.link })),
    todos: todos.filter((t) => !t.done).sort((a, b) => (a.priority || 3) - (b.priority || 3)).slice(0, 8).map((t) => t.text),
    picks: feedItems.filter((i) => i.score !== undefined && i.score >= feedMinScore).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4).map((i) => ({ title: i.title, brief: i.brief })),
    yesterday: reviews[`d:${dayKey(Date.now() - 86400_000)}`]
  }), [meetings, todos, feedItems, feedMinScore, reviews])

  // 规则①：每天首次唤醒 → 自动生成晨间简报
  const morningFiredRef = useRef('')
  useEffect(() => {
    if (!revealed || !settings.ruleMorning) return
    const k = dayKey(Date.now())
    if (morningFiredRef.current === k) return
    morningFiredRef.current = k
    genReview(`m:${k}`, MORNING_SYSTEM, morningPrompt(morningInput), false)
  }, [revealed, settings.ruleMorning, morningInput, genReview])

  // 规则②：每天 20:00 后 → 自动生成今日复盘草稿（有素材才生成）
  const eveningFiredRef = useRef('')
  useEffect(() => {
    if (!settings.ruleEvening) return
    const check = (): void => {
      const k = dayKey(Date.now())
      if (new Date().getHours() >= 20 && eveningFiredRef.current !== k) {
        eveningFiredRef.current = k
        const facts = buildFacts(k, factsRef.current.todos, factsRef.current.activityLog)
        if (hasContent(facts)) genReview(`d:${k}`, REVIEW_SYSTEM, reviewPrompt(facts), true)
      }
    }
    check()
    const t = setInterval(check, 60000)
    return () => clearInterval(t)
  }, [settings.ruleEvening, genReview])

  const clock = new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const askEmpty = !(threads['ask'] && threads['ask'].length)
  const askModelLabel = `${(PROVIDERS.find((p) => p.key === llm.provider) || {}).label} · ${llm.model || '未设置'}`

  // 命令面板的命令集：跳分区 + 快捷动作 + 切主题（run 里直接调 App 的动作）
  const goTab = (k: Tab): void => { setRevealed(true); setTab(k) }
  const paletteCommands: Command[] = [
    ...TABS.map((t): Command => ({ id: 'tab:' + t.key, title: '前往 · ' + t.label, hint: '切换到' + t.label + '分区', icon: '📂', group: '分区', keywords: t.key, run: () => goTab(t.key) })),
    { id: 'act:ask', title: '新提问', hint: '打开问答分区', icon: '💬', group: '动作', keywords: 'ask wenda tiwen', run: () => goTab('ask') },
    { id: 'act:note', title: '新建灵感便签', hint: '新建一张便签并前往', icon: '💡', group: '动作', keywords: 'note bianqian xinjian', run: () => { noteAdd(); goTab('notes') } },
    { id: 'act:studio', title: 'Markdown 工作台', hint: '全屏编辑/阅读 Markdown 文档', icon: '✍️', group: '动作', keywords: 'markdown studio wendang bianji', run: () => { setRevealed(true); setStudio({ id: null, title: '未命名文档', md: '' }) } },
    { id: 'act:openmd', title: '打开本地 Markdown', hint: '从磁盘打开 .md 文件到工作台', icon: '📂', group: '动作', keywords: 'open markdown file bendi wenjian', run: () => { island.openMdFile().then((r) => { if (r.ok && typeof r.content === 'string') { setRevealed(true); setStudio({ id: null, title: (r.name || '').replace(/\.(md|markdown|txt|mdx)$/i, ''), md: r.content }) } }) } },
    { id: 'act:calc', title: '工程计算', hint: '逐行计算 · 变量贯穿 · 单位/温度助手', icon: '🧮', group: '动作', keywords: 'calc jisuan gongcheng', run: () => { setRevealed(true); setCalcOpen(true) } },
    { id: 'act:learn', title: '学习中心', hint: '间隔重复复习便签 + 技术雷达', icon: '🎓', group: '动作', keywords: 'learn srs radar fuxi leida', run: () => { setRevealed(true); setLearnOpen(true) } },
    { id: 'act:capsule', title: '闪念胶囊', hint: '唤出快速记录输入框', icon: '⚡', group: '动作', keywords: 'capsule shannian jilu', run: () => { setRevealed(true); setCapsuleOpen(true) } },
    { id: 'act:brain', title: '第二大脑检索', hint: '跨便签/问答/复盘/资讯/剪贴板搜索', icon: '🧠', group: '动作', keywords: 'brain dinao search sousuo', run: () => { setRevealed(true); setBrainOpen(true) } },
    { id: 'act:screen', title: '分析当前屏幕', hint: '截整屏交给视觉模型（Ctrl+Alt+A）', icon: '🖥️', group: '动作', keywords: 'screen fenxi pingmu understand', run: () => { island.captureScreen().then((r) => { if (r.ok && r.dataUrl) void downscaleDataUrl(r.dataUrl, 1600).then((s) => { setRevealed(true); setShotImg(s) }) }) } },
    { id: 'act:review', title: '今日复盘 / 周报', hint: '前往复盘分区', icon: '📝', group: '动作', keywords: 'review fupan zhoubao', run: () => goTab('review') },
    { id: 'act:daily', title: '今日 AI 日报', hint: '前往资讯分区', icon: '🗞️', group: '动作', keywords: 'daily ribao zixun', run: () => goTab('news') },
    { id: 'act:focus', title: (focusActive ? '退出' : '进入') + '专注模式', hint: '静默 25 分钟', icon: '🌙', group: '动作', keywords: 'focus zhuanzhu', run: () => toggleFocus() },
    { id: 'act:pomo', title: (pomo.phase === 'idle' ? '开始' : '停止') + '番茄钟', hint: '专注 25 / 小憩 5,自动循环', icon: '🍅', group: '动作', keywords: 'pomodoro fanqiezhong', run: () => setPomo((s) => (s.phase === 'idle' ? startWork(pomoCfg, Date.now()) : POMO_IDLE)) },
    { id: 'act:bar', title: (settings.ambientBar ? '关闭' : '开启') + '常驻迷你条', hint: '底部迷你状态条', icon: '〰', group: '动作', keywords: 'bar miniao', run: () => toggleSetting('ambientBar') },
    { id: 'act:size', title: (settings.largeSize ? '切回标准尺寸' : '切到大尺寸工作台'), hint: '面板大小', icon: '⤢', group: '动作', keywords: 'size chicun', run: () => toggleSetting('largeSize') },
    { id: 'act:full', title: (fullscreen ? '退出全屏' : '全屏模式'), hint: '铺满当前显示器', icon: '⛶', group: '动作', keywords: 'fullscreen quanping', run: () => setFullscreen((v) => !v) },
    { id: 'act:shot', title: '截图工坊', hint: '无损截图 + 高级边框美化', icon: '📸', group: '动作', keywords: 'screenshot jietu gongfang', run: () => island.triggerScreenshot('studio') },
    { id: 'act:record', title: '录屏工坊', hint: '鼠标跟随运镜 · 高清录制 · AI 后期', icon: '🎥', group: '动作', keywords: 'record screen video luping', run: () => { setRevealed(true); setShotStudioMode('record'); setShotStudio(RECORDING_STUDIO_CONTEXT) } },
    { id: 'act:kb', title: '知识库管理', hint: '接入文件夹/文件/网页 · 本地 RAG', icon: '📚', group: '动作', keywords: 'knowledge zhishiku rag', run: () => { setRevealed(true); setKbOpen(true) } },
    // ⚡ 每条快捷指令都可从命令面板直接运行（切到分区后自动执行）
    ...shortcuts.map((s): Command => ({ id: 'sc:' + s.id, title: '⚡ ' + s.name, hint: s.desc || `${s.steps.length} 步快捷指令`, icon: s.icon, group: '快捷指令', keywords: 'shortcut kuaijie zhiling ' + s.name, run: () => { goTab('shortcuts'); setShortcutRunId(s.id) } })),
    { id: 'act:themedesign', title: '主题设计器', hint: '拖动令牌自定义主题', icon: '🎨', group: '动作', keywords: 'theme designer zhuti sheji', run: () => { setRevealed(true); setThemeDesignerOpen(true) } },
    ...customThemes.map((t): Command => ({ id: 'theme:' + t.key, title: '主题 · ' + t.label, hint: t.desc, icon: '🎨', group: '主题', keywords: `theme zhuti custom ${t.key} ${(t.tags || []).join(' ')}`, run: () => setTheme(t.key) })),
    ...THEMES.map((t): Command => ({ id: 'theme:' + t.key, title: '主题 · ' + t.label, hint: t.desc, icon: '🎨', group: '主题', keywords: 'theme zhuti ' + t.key, run: () => setTheme(t.key) }))
  ]

  return (
    <>
      {settings.ambientBar && !isShown && (
        <AmbientBar
          cfg={barCfg}
          media={media}
          pools={barPools}
          width={barCfg.width || 340}
          status={ambientStatus}
          brief={ambientBrief}
          onMediaKey={(cmd) => island.mediaKey(cmd)}
          onOpen={() => setRevealed(true)}
          onOpenTarget={(target) => { setTab(target); setRevealed(true) }}
          fetchLyrics={(title, artist) => island.lyricsFetch(title, artist)}
        />
      )}
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
        {/* 顶部两角的凹弧：把面板融进屏幕上边缘，形成「内角过渡」的灵动一体感 */}
        <div style={{ ...flareBase(isShown), left: -21, background: 'radial-gradient(circle at 0% 100%, transparent 0 21px, oklch(var(--panel-l) calc(0.02 * var(--css, 1)) var(--ths) / var(--glass-a)) 21.5px)' }} />
        <div style={{ ...flareBase(isShown), right: -21, background: 'radial-gradient(circle at 100% 100%, transparent 0 21px, oklch(var(--panel-l) calc(0.02 * var(--css, 1)) var(--ths) / var(--glass-a)) 21.5px)' }} />

        {/* 岛面板：从屏幕上边缘「内弧」滑出，顶部与屏幕齐平、底部圆弧，营造灵动一体感 */}
        <div
          data-solid
          ref={panelRef}
          onMouseDownCapture={() => { lastClickRef.current = Date.now() }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!dropActive) setDropActive(true)
            // dragleave 在经过子元素/快速拖离时经常不触发（提示层卡死的根因）——改用 dragover 心跳：450ms 无心跳自动收起
            if (dropTimer.current) clearTimeout(dropTimer.current)
            dropTimer.current = setTimeout(() => { dropTimer.current = undefined; setDropActive(false) }, 450)
          }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setDropActive(false) }}
          onDrop={onDrop}
          style={{
            position: 'relative', width: fullscreen ? '100vw' : settings.largeSize ? 880 : islandWidth,
            height: fullscreen ? '100vh' : undefined,
            transformOrigin: 'top center',
            transform: isShown ? 'translateY(0)' : 'translateY(-101%)',
            opacity: isShown ? 1 : 0,
            pointerEvents: isShown ? 'auto' : 'none',
            overflow: 'hidden',
            borderRadius: fullscreen ? 0 : '0 0 28px 28px',
            // 材质三层：顶部极光氛围光（主色相）+ 右上副色相补光 + 玻璃底
            background: `radial-gradient(125% 60% at 50% 0%, ${accent(0.62, 0.14)} 0%, transparent 64%), radial-gradient(90% 42% at 88% 0%, oklch(calc(0.62 + var(--accent2-l-shift, 0)) var(--accent2-c) var(--th2) / 0.1) 0%, transparent 62%), oklch(var(--panel-l) var(--surface-c) var(--ths) / var(--glass-a))`,
            backdropFilter: 'blur(var(--glass-blur)) saturate(180%)',
            // Apple 式发型线边缘（0.5px 高明度线），不再用彩色 1px 描边
            borderLeft: `0.5px solid ${hairline(0.14)}`, borderRight: `0.5px solid ${hairline(0.14)}`,
            borderBottom: `0.5px solid ${hairline(0.18)}`, borderTop: 'none',
            // 顶部与屏幕齐平：向下弥散深影 + 淡淡主题色环境光，让岛"浮"在桌面上；全屏时无投影
            boxShadow: fullscreen ? 'none' : isShown ? '0 24px 50px -18px rgb(0 0 0 / calc(.55 * var(--shadow-k))), 0 10px 80px -24px oklch(calc(0.6 + var(--accent1-l-shift, 0)) var(--accent-c) var(--th) / 0.22)' : 'none',
            // 平缓缓出、无回弹，避免"蹦一下"
            transition: 'transform .5s cubic-bezier(.22,.61,.36,1), opacity .4s ease',
            boxSizing: 'border-box'
          }}
        >
          {/* 玻璃颗粒噪点层（胶片质感，极淡） */}
          <div className="ui-noise" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.045, mixBlendMode: 'overlay', borderRadius: 'inherit' }} />
          {/* 底部边缘渐变高光（收边精致感） */}
          {!fullscreen && (
            <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: 0, height: 1, zIndex: 1, pointerEvents: 'none', background: 'linear-gradient(90deg, transparent, oklch(0.75 var(--accent-c) var(--th) / 0.32), transparent)' }} />
          )}
          {dropActive && (
            <div style={{ position: 'absolute', inset: 6, zIndex: 20, borderRadius: 16, border: `2px dashed ${accent(.78, .7)}`, background: 'oklch(var(--overlay-l) var(--surface-c) var(--ths) / .86)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
              <Download size={26} strokeWidth={1.5} style={{ color: accent() }} />
              <div style={{ color: ink(1), fontSize: 13, fontWeight: 600 }}>松手投喂到问答助手</div>
              <div style={{ color: ink(3), fontSize: 11 }}>图片 / 文件都可以</div>
            </div>
          )}

          {/* header */}
          <div style={{ padding: '16px 16px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
              <div style={{ width: 24, height: 24, borderRadius: 8, background: gradient.brand(), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 3px 10px -2px ${accent(0.7, 0.5)}, inset 0 1px 0 rgba(255,255,255,0.35)` }}>
                {/* 岛标：胶囊岛 + 脉搏点（SVG 渐变不解析 var()，用 stopColor 内联） */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <rect x="2.5" y="8.5" width="19" height="8" rx="4" fill="oklch(0.2 0.02 var(--th))" fillOpacity="0.85" />
                  <circle cx="8.5" cy="12.5" r="1.6" fill="oklch(0.92 0.05 var(--th))" />
                  <path d="M12 12.5h2l1.2-2.2 1.6 4 1.2-1.8h1.5" stroke="oklch(0.92 0.05 var(--th))" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.2, background: gradient.brand(), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Agentic-Island</span>
              <div
                className="hv"
                title="查看运行状态"
                onClick={() => setTab('settings')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, cursor: 'pointer', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,0.06)', color: ink(3), fontSize: 9.5, fontFamily: 'ui-monospace,monospace' }}
              >
                <span style={{ width: 5, height: 5, borderRadius: 999, background: bridgeConnected ? 'oklch(0.78 0.14 150)' : 'oklch(0.75 0.13 75)', boxShadow: bridgeConnected ? '0 0 6px oklch(0.72 0.14 150 / .45)' : undefined }} />
                v{runtimeInfo?.version || '…'}
              </div>
              <span style={{ marginLeft: 'auto', color: ink(3), fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{clock}</span>
              <HeaderBtn title="截图工坊（无损截图 + 高级边框美化）" onClick={() => island.triggerScreenshot('studio')}>
                <Camera size={13} strokeWidth={1.75} />
              </HeaderBtn>
              <HeaderBtn title="录屏工坊（智能运镜 + 高清录制 + AI 后期）" onClick={() => { setShotStudioMode('record'); setShotStudio(RECORDING_STUDIO_CONTEXT) }}>
                <Video size={13} strokeWidth={1.75} />
              </HeaderBtn>
              <HeaderBtn title={settings.largeSize ? '切回标准尺寸' : '切到大尺寸工作台'} active={settings.largeSize} onClick={() => toggleSetting('largeSize')}>
                {settings.largeSize ? <Minimize2 size={13} strokeWidth={1.75} /> : <Maximize2 size={13} strokeWidth={1.75} />}
              </HeaderBtn>
              <HeaderBtn title={fullscreen ? '退出全屏' : '全屏（铺满当前显示器）'} active={fullscreen} onClick={() => setFullscreen((v) => !v)}>
                {fullscreen ? <Shrink size={13} strokeWidth={1.75} /> : <Expand size={13} strokeWidth={1.75} />}
              </HeaderBtn>
              {dndActive && (
                <div title="智能勿扰中（检测到会议）· 不弹窗/不响铃" style={{ height: 26, padding: '0 9px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 4, background: 'oklch(0.45 0.09 30 / .45)', color: 'oklch(0.85 0.11 40)' }}>
                  <BellOff size={13} strokeWidth={1.75} />
                </div>
              )}
              {/* 番茄钟：空闲点击开始专注；进行中显示阶段+倒计时，点击停止（今日已完成 N 个） */}
              <div
                title={pomo.phase === 'idle' ? '开始一个番茄钟（专注 25 分钟）' : `${phaseLabel(pomo.phase)}中 · 点击停止 · 今日已完成 ${pomoDone[dayKey(now)] || 0} 个`}
                onClick={() => setPomo((s) => (s.phase === 'idle' ? startWork(pomoCfg, Date.now()) : POMO_IDLE))}
                style={{ height: 26, padding: '0 9px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', transition: 'all .18s', background: pomo.phase === 'work' ? 'oklch(0.5 0.13 25 / .5)' : pomo.phase !== 'idle' ? 'oklch(0.45 0.09 150 / .45)' : 'rgba(255,255,255,.05)', color: pomo.phase === 'work' ? 'oklch(0.85 0.12 30)' : pomo.phase !== 'idle' ? 'oklch(0.82 0.11 150)' : ink(3) }}
              >
                <Timer size={13} strokeWidth={1.75} />{pomo.phase !== 'idle' && <span style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{pomoMMSS}</span>}
              </div>
              <div title="专注模式（静默 25 分钟）" onClick={toggleFocus} style={{ height: 26, padding: '0 9px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', transition: 'all .18s', background: focusActive ? 'oklch(0.4 0.08 260 / .5)' : 'rgba(255,255,255,.05)', color: focusActive ? 'oklch(0.82 0.1 260)' : ink(3) }}>
                <Moon size={13} strokeWidth={1.75} />{focusActive && <span style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{focusMMSS}</span>}
              </div>
              <HeaderBtn title="贴住 / 取消贴住" active={pinned} onClick={() => { setPinned((v) => !v); setRevealed(true) }}>
                <Pin size={13} strokeWidth={1.75} style={{ transform: pinned ? 'rotate(0deg)' : 'rotate(38deg)', transition: 'transform .2s ease' }} />
              </HeaderBtn>
              {/* 一键开关常驻迷你条（避免遮挡工作界面时快速关掉） */}
              <HeaderBtn title={settings.ambientBar ? '关闭常驻迷你条' : '开启常驻迷你条'} active={settings.ambientBar} onClick={() => toggleSetting('ambientBar')}>
                <Waves size={13} strokeWidth={1.75} />
              </HeaderBtn>
              {/* 收起：即使有待处理也能收回（开会等场景）；有新请求会重新弹出。快捷键 Esc */}
              <HeaderBtn title="收起（Esc）· 有新请求会重新弹出" onClick={snoozeNow}>
                <ChevronDown size={14} strokeWidth={2} />
              </HeaderBtn>
            </div>
            {/* Tab 栏：窄屏不换行不变形；隐藏滚动条，滚轮/拖拽横滑，边缘渐隐暗示更多 */}
            <div
              ref={tabBarRef}
              className="noscrollbar"
              role="tablist"
              aria-label="主功能"
              onScroll={measureTabs}
              onWheel={(e) => { const el = tabBarRef.current; if (el && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY }}
              style={{
                display: 'flex', gap: 5, marginBottom: 14, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2,
                WebkitMaskImage: tabFade.l && tabFade.r
                  ? 'linear-gradient(to right, transparent, #000 22px, #000 calc(100% - 22px), transparent)'
                  : tabFade.r
                    ? 'linear-gradient(to right, #000 calc(100% - 22px), transparent)'
                    : tabFade.l
                      ? 'linear-gradient(to right, transparent, #000 22px)'
                      : undefined
              }}
            >
              {TABS.map(({ key, label, icon: TabIcon }) => {
                const active = tab === key
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="main-tab-panel"
                    data-main-tab={key}
                    className={active ? undefined : 'ui-tab'}
                    onClick={() => setTab(key)}
                    style={tabStyle(active)}
                  >
                    {active && (
                      <motion.span
                        layoutId="tab-active-pill"
                        transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                        style={{
                          position: 'absolute', inset: 0, borderRadius: 999,
                          background: gradient.primary(),
                          boxShadow: `0 3px 12px -4px ${accent(0.7, 0.5)}, inset 0 1px 0 rgba(255,255,255,0.28)`
                        }}
                      />
                    )}
                    <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <TabIcon size={12} strokeWidth={1.9} style={{ flex: 'none' }} />
                      {label}
                      {key === 'agents' && (hasPending || hasWaiting) && <span className="ui-sonar" style={{ marginLeft: 2, display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 75)', verticalAlign: 'middle' }} />}
                      {key === 'plan' && pending.some((a) => a.isPlan) && <span className="ui-sonar" style={{ marginLeft: 2, display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 75)', verticalAlign: 'middle' }} />}
                      {key === 'todos' && hasDueTodo && <span className="ui-sonar" style={{ marginLeft: 2, display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 75)', verticalAlign: 'middle' }} />}
                      {key === 'todos' && !hasDueTodo && todos.filter((t) => !t.done).length > 0 && (
                        <span style={{ marginLeft: 2, fontSize: 9.5, opacity: 0.75 }}>{todos.filter((t) => !t.done).length}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            {/* 签名分割线：Tab 栏下一道主题渐变光线（岛的"记忆点"） */}
            <div style={{ height: 1, margin: '-6px 6px 10px', background: 'linear-gradient(90deg, transparent 2%, oklch(0.72 var(--accent-c) var(--th) / 0.34) 30%, oklch(0.72 var(--accent2-c) var(--th2) / 0.3) 68%, transparent 98%)', pointerEvents: 'none' }} />
          </div>
          <div className="ai-scroll" style={{ padding: '0 8px 16px 16px', margin: '0 4px 0 0', maxHeight: fullscreen ? 'calc(100vh - 130px)' : settings.largeSize ? 'min(844px, calc(100vh - 175px))' : 500, overflowY: 'auto' }}>
            <div id="main-tab-panel" role="tabpanel" data-main-tab-content>
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
                models={providerModelChoices(llm)}
                onSwitchModel={(id) => (id.startsWith('m:') ? pickModel(id.slice(2)) : loadLlm(Number(id.slice(2))))}
                empty={askEmpty}
                mode={askMode} onSetMode={setAskMode}
                kbMode={kbMode} onToggleKb={() => setKbMode((v) => !v)} onManageKb={() => setKbOpen(true)} kbCount={kbSources.reduce((a, s) => a + s.docCount, 0)}
                engine={askEngine} onSetEngine={setAskEngine} agentCwd={agentCwd} onSetAgentCwd={setAgentCwd}
                suggestions={ambientSuggestions.map((item) => ({
                  id: item.id,
                  label: item.text,
                  source: AMBIENT_SUGGESTION_LABELS[item.mode] || '灵感',
                  go: () => sendPreset('ask', ambientSuggestionPrompt(item), askMode === 'deep')
                }))}
                conv={convFor('ask', askMode === 'deep' ? '深度思考模式 · 提问后展示思维链…' : '有问题随时问，支持追问（AI 记得上文）…', undefined, askMode === 'deep')}
                sessions={askSessions.map((s) => ({ id: s.id, title: s.title, busy: conversationBusy(s.msgs) }))}
                onNew={askNew} onSwitch={askSwitch} onDeleteSession={askDelete}
                prompts={quickPrompts}
                onSavePrompt={promptSave} onDeletePrompt={promptDelete} onResetPrompts={promptsReset}
                clips={clips}
                onRemoveClip={(id) => setClips((l) => l.filter((c) => c.id !== id))}
                onClearClips={() => setClips((l) => l.filter((c) => c.fav))}
                onToggleClipFav={(id) => setClips((l) => l.map((c) => (c.id === id ? { ...c, fav: !c.fav } : c)))}
                onSendClip={(text) => sendPreset('ask', text, askMode === 'deep')}
                onAskClipImage={(dataUrl) => setShotImg(dataUrl)}
                onClusterClips={clusterClips}
                clipGroups={clipGroups}
                clipClustering={clipClustering}
              />
            )}
            {tab === 'todos' && (
              <TodoTab
                projects={workbenchProjects} activeProjectId={activeProjectId}
                onSelectProject={selectWorkbenchProject} onCreateProject={createWorkbenchProject}
                todos={todos} onAdd={todoAdd} onAiAdd={aiAddTodo} onToggle={todoToggleWithSound} onEdit={todoEdit} onDelete={todoDelete}
                onSnooze={todoSnooze} onCyclePriority={todoCyclePriority} onClearDone={todoClearDone}
                onSetNote={todoSetNote} onAddSub={todoAddSub} onToggleSub={todoToggleSub} onDeleteSub={todoDeleteSub} onFocus={todoFocus}
                onPin={todoPin} onTomorrow={todoTomorrow} onSetStatus={todoSetStatus} onQuickAdd={todoQuickAdd}
                onAiBreakdown={aiBreakdown}
                onPatch={todoPatch} onBulkAdd={todoBulkAdd}
                onAI={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
                llmReady={llmReady}
                meetings={meetings} onJoinMeeting={(link) => island.openExternal(link)}
              />
            )}
            {tab === 'notes' && (
              <NotesTab
                notes={notes}
                onAdd={noteAdd} onUpdate={noteUpdate} onDelete={noteDelete} onTogglePin={noteTogglePin}
                onAiCreate={aiCreateNote} onAiSearch={aiSearchNotes}
                onAddNote={noteAddFull} onPinDesktop={pinNoteDesktop} onOpenStudio={openStudioNote}
                onStar={noteStar} onRestore={noteRestore} onPurge={notePurge} onBatchColor={noteBatchColor} onBatchTrash={noteBatchTrash}
                onAI={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
                onQuickTodo={(text) => todoQuickAdd(text, 'todo')}
              />
            )}
            {tab === 'news' && (
              <NewsTab
                projects={workbenchProjects} activeProjectId={activeProjectId}
                onSelectProject={selectWorkbenchProject} onCreateProject={createWorkbenchProject}
                watches={newsWatches} onChangeWatches={setNewsWatches}
                artifacts={workArtifacts}
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
                onPatchItem={patchNewsItem}
                onItemToTodo={newsItemToTodo}
                onSynthesize={synthesizeNews}
                onSaveArtifact={saveNewsArtifact}
              />
            )}
            {tab === 'review' && (
              <ReviewTab
                todos={todos}
                activities={activityLog}
                pomoDone={pomoDone}
                morning={morningInput}
                reviews={reviews}
                onSaveReview={(k, md) => setReviews((r) => ({ ...r, [k]: md }))}
                onGenerate={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, true)}
                onSaveToNotes={(md) => {
                  const d = new Date()
                  const now3 = Date.now()
                  setNotes((l) => [{ id: now3, emoji: '📝', title: `复盘 ${d.getMonth() + 1}/${d.getDate()}`, md, color: 'violet', tags: ['复盘'], createdAt: now3, updatedAt: now3 }, ...l].slice(0, 400))
                }}
                llmReady={llmReady}
                onOpenLlmSettings={() => { setTab('settings'); setLlm((s) => ({ ...s, open: true })) }}
              />
            )}
            {tab === 'repos' && (
              <ReposTab
                repos={repos}
                onAdd={(path) => setRepos((l) => (l.some((r) => r.path === path) ? l : [...l, { path }]))}
                onRemove={(path) => setRepos((l) => l.filter((r) => r.path !== path))}
                githubToken={githubToken}
                onSetToken={setGithubToken}
                onAI={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
                interests={feedInterests}
                llmReady={llmReady}
                bookmarks={repoBookmarks}
                onToggleBookmark={(r) => setRepoBookmarks((l) => (l.some((b) => b.fullName === r.fullName) ? l.filter((b) => b.fullName !== r.fullName) : [r, ...l]))}
              />
            )}
            {tab === 'shortcuts' && (
              <ShortcutsTab
                projects={workbenchProjects} activeProjectId={activeProjectId}
                onSelectProject={selectWorkbenchProject} onCreateProject={createWorkbenchProject}
                workflowRuns={workflowRuns} onRunComplete={recordWorkflowRun}
                shortcuts={shortcuts}
                onChange={setShortcuts}
                onAI={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
                llmReady={llmReady}
                islandAction={(action, args) => {
                  if (action === 'todo') { todoQuickAdd(args.slice(0, 200), 'todo'); return '✓ 已加入待办' }
                  if (action === 'note') {
                    const lines = args.split('\n')
                    const title = (lines[0] || '快捷便签').slice(0, 30)
                    const md = lines.slice(1).join('\n').trim() || args
                    const now3 = Date.now()
                    noteAddFull({ id: now3, emoji: '⚡', title, md, color: 'sky', tags: ['快捷'], createdAt: now3, updatedAt: now3 })
                    return `✓ 已存为便签「${title}」`
                  }
                  sendPreset('ask', args, false)
                  setTab('ask')
                  return '✓ 已发送到问答'
                }}
                repos={repos}
                autoRunId={shortcutRunId}
                onAutoRunDone={() => setShortcutRunId(null)}
              />
            )}
            {tab === 'term' && <TerminalTab tall={settings.largeSize || fullscreen} full={fullscreen} agents={agents} llm={{ model: llm.model, baseUrl: llm.baseUrl, apiKey: llm.apiKey }} />}
            {tab === 'settings' && (
              <SettingsTab
                runtimeInfo={runtimeInfo} bridgeConnected={bridgeConnected}
                activeAgents={agents.filter((a) => a.status !== 'done').length} totalAgents={agents.length}
                settings={settings} onToggle={toggleSetting}
                soundMap={soundMap} soundPickerOpen={soundPickerOpen} onToggleSoundPicker={() => settings.sound && setSoundPickerOpen((v) => !v)} onSetSound={setSoundFor} onPreviewSound={previewSound}
                activeMonitor={activeMonitor} displays={displays} monitorPreviewOpen={monitorPreviewOpen} onToggleMonitorPreview={() => { setMonitorPreviewOpen((v) => !v); island.getDisplays().then(setDisplays).catch(() => { /* 忽略 */ }) }} onSetMonitor={changeMonitor}
                llm={llm} onToggleLlm={() => setLlm((s) => ({ ...s, open: !s.open }))} onSetProvider={setProvider} onSetLlmField={setLlmField} onSyncLlmModels={syncLlmModels} onTestLlm={testLlm} onSaveLlm={saveLlm} onLoadLlm={loadLlm} onDeleteLlm={deleteLlm}
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
                customThemes={customThemes} onOpenThemeDesigner={() => { setThemeEditKey(null); setThemeDesignerOpen(true) }}
                onDeleteCustomTheme={(key) => { setCustomThemes((l) => l.filter((x) => x.key !== key)); if (theme === key) setTheme('aurora') }}
                onEditTheme={(key) => { setThemeEditKey(key); setThemeDesignerOpen(true) }}
              />
            )}
            </div>
          </div>
        </div>
      </div>

      {/* toasts */}
      {toast && (
        <div data-solid style={toastStyle}>
          <div style={{ width: 20, height: 20, borderRadius: 999, background: gradient.primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', color: gradient.onPrimary(), boxShadow: `0 0 10px ${accent(0.7, 0.4)}` }}>
            <Check size={12} strokeWidth={3} />
          </div>
          <span style={{ color: ink(1), fontSize: 12.5, fontWeight: 500 }}>{toast}</span>
          <X size={13} strokeWidth={2} style={{ color: ink(3), cursor: 'pointer' }} onClick={() => setToast(null)} />
        </div>
      )}
      {jumpToast && (
        <div style={{ position: 'fixed', top: 'calc(100vh - 78px)', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 999, background: 'oklch(var(--overlay-l) calc(0.02 * var(--css, 1)) var(--ths) / var(--glass-a))', backdropFilter: 'blur(var(--glass-blur))', border: `1px solid ${accent(.7, .3)}`, color: ink(1), fontSize: 12, boxShadow: '0 14px 34px rgb(0 0 0 / calc(.5 * var(--shadow-k)))' }}>
          <ArrowUpRight size={13} strokeWidth={2} style={{ color: accent() }} />{jumpToast}
        </div>
      )}
      {capsuleOpen && <Capsule onSubmit={capsuleSubmit} onClose={closeCapsule} />}
      {shotImg && <ScreenshotAsk dataUrl={shotImg} onAsk={shotAsk} onClose={() => { setShotImg(null); island.capsuleClosed() }} />}
      {shotStudio && (
        <ScreenshotStudio
          dataUrl={shotStudio}
          initialMode={shotStudioMode}
          onClose={() => { setShotStudio(null); island.capsuleClosed() }}
          llmReady={llmReady}
          llmConfig={{ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }}
          onAskImage={(du: string) => { setShotStudio(null); setShotImg(du) }}
          onAIVision={(system: string, dataUrl2: string, prompt: string) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl2 } }], false)}
          onRetake={() => { setShotStudioMode('image'); island.triggerScreenshot('studio') }}
          onCreateTodo={(text: string) => {
            const items = text.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|[-*]\s*\[[ xX]\]\s*)/, '').trim()).filter(Boolean).slice(0, 30)
            todoBulkAdd((items.length ? items : [text.trim()]).map((item) => ({ text: item.slice(0, 200) })))
            setToast(`已从截图结果创建 ${Math.max(1, items.length)} 项待办`)
          }}
          onCreateNote={(title: string, text: string) => {
            const now = Date.now()
            setNotes((list) => [{ id: now, emoji: '📸', title: title.slice(0, 40), md: text, color: 'blue', tags: ['截图识别'], createdAt: now, updatedAt: now }, ...list].slice(0, 400))
            setToast('截图识别结果已存入灵感便签')
          }}
        />
      )}
      <CommandPalette open={paletteOpen} commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
      <BrainSearch
        open={brainOpen}
        sources={{ notes: notes.filter((n) => !n.trashed), ask: threads['ask'] || [], reviews, feed: feedItems, clips }}
        onClose={() => setBrainOpen(false)}
        onGenerate={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
        onJump={(t) => { setRevealed(true); setTab(t) }}
        llmReady={llmReady}
        embedModel={embedModel}
        onSetEmbedModel={setEmbedModel}
        onEmbed={(texts) => island.llmEmbed(embedConfig, texts).then((r) => (r.ok && r.vectors ? r.vectors : null))}
      />
      <KnowledgePanel
        open={kbOpen}
        onClose={() => setKbOpen(false)}
        embedCfg={embedConfig}
        onSetEmbedConfig={(patch) => setEmbedConfig((value) => ({ ...value, ...patch }))}
        onChanged={refreshKb}
        onAI={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
        llmReady={llmReady}
      />
      {studio && (
        <MarkdownStudio
          open
          initial={{ title: studio.title, md: studio.md }}
          onClose={() => setStudio(null)}
          llmReady={llmReady}
          onAI={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
          onSave={(title, md) => {
            if (studio.id != null) {
              const id = studio.id
              const cur = notes.find((x) => x.id === id)
              setNotes((l) => l.map((x) => (x.id === id ? { ...x, title, md, updatedAt: Date.now() } : x)))
              island.stickyPush({ id, emoji: cur?.emoji || '📄', title, md, color: cur?.color || 'sky' })
              setStudio((s) => (s ? { ...s, title, md } : s))
            } else {
              const now = Date.now()
              setNotes((l) => [{ id: now, emoji: '📄', title: title || '未命名文档', md, color: 'sky', tags: [], createdAt: now, updatedAt: now }, ...l].slice(0, 400))
              setStudio((s) => (s ? { ...s, id: now, title, md } : s))
            }
          }}
        />
      )}
      <ThemeDesigner
        open={themeDesignerOpen}
        seed={(() => {
          const d = normalizeThemeTokens([...customThemes, ...THEMES].find((x) => x.key === (themeEditKey || theme)) || THEMES[0])
          return {
            th: +d.th, th2: +d.th2, ths: +d.ths, cs: +d.cs, css: +d.css, pl: +d.pl,
            mode: d.mode, bg: +d.bg, ga: +d.ga, fi: +d.fi, bl: +d.bl, sh: +d.sh,
            c1: +d.c1, c2: +d.c2, sc: +d.sc, l1: +d.l1, l2: +d.l2, tx: +d.tx, gr: +d.gr
          } as Tokens
        })()}
        seedName={themeEditKey ? customThemes.find((x) => x.key === themeEditKey)?.label : undefined}
        seedDescription={themeEditKey ? customThemes.find((x) => x.key === themeEditKey)?.desc : undefined}
        seedTags={themeEditKey ? customThemes.find((x) => x.key === themeEditKey)?.tags : undefined}
        editKey={themeEditKey || undefined}
        onSave={(name, tk, metadata, editKey) => {
          const tokens = {
            th: String(Math.round(tk.th)), th2: String(Math.round(tk.th2)), ths: String(Math.round(tk.ths)),
            cs: String(Number(tk.cs.toFixed(2))), css: String(Number(tk.css.toFixed(2))), pl: String(Number(tk.pl.toFixed(2))),
            mode: tk.mode, bg: String(Number(tk.bg.toFixed(2))), ga: String(Number(tk.ga.toFixed(2))),
            fi: String(Number(tk.fi.toFixed(2))), bl: String(Math.round(tk.bl)), sh: String(Number(tk.sh.toFixed(2))),
            c1: String(Number(tk.c1.toFixed(3))), c2: String(Number(tk.c2.toFixed(3))), sc: String(Number(tk.sc.toFixed(3))),
            l1: String(Number(tk.l1.toFixed(2))), l2: String(Number(tk.l2.toFixed(2))), tx: String(Number(tk.tx.toFixed(2))), gr: String(Math.round(tk.gr))
          }
          if (editKey) {
            // 二次编辑：原地更新（key 不变，历史引用/当前选中都不受影响）
            setCustomThemes((l) => l.map((x) => (x.key === editKey ? makeCustomTheme(editKey, name, tokens, metadata) : x)))
            setTheme(editKey)
          } else {
            const key = 'custom-' + Date.now()
            setCustomThemes((l) => [...l, makeCustomTheme(key, name, tokens, metadata)])
            setTheme(key)
          }
          setThemeEditKey(null)
          setThemeDesignerOpen(false)
        }}
        onClose={() => { setThemeEditKey(null); setThemeDesignerOpen(false); applyThemeAny(theme, customThemes) }}
        onAI={(system, user) => island.llmComplete({ baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model }, system, user, false)}
        llmReady={llmReady}
      />
      <CalcSheet open={calcOpen} value={calcSheet} onChange={setCalcSheet} onClose={() => setCalcOpen(false)} />
      <LearnCenter
        open={learnOpen}
        onClose={() => setLearnOpen(false)}
        notes={notes.filter((n) => !n.trashed)}
        srsState={srsState}
        onGrade={(id, g: Grade) => setSrsState((s) => ({ ...s, [id]: schedule(s[id] || NEW_CARD, g, Date.now()) }))}
        radar={radar}
        onAddRadar={(name, ring) => setRadar((l) => [...l, { id: Date.now(), name, ring }])}
        onCycleRadar={(id) => setRadar((l) => l.map((it) => { if (it.id !== id) return it; const order = ['adopt', 'trial', 'assess', 'hold'] as const; return { ...it, ring: order[(order.indexOf(it.ring) + 1) % 4] } }))}
        onRemoveRadar={(id) => setRadar((l) => l.filter((it) => it.id !== id))}
      />
    </>
  )
}

const islandWrap: React.CSSProperties = {
  position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  fontFamily: 'var(--font)'
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
  padding: '11px 16px', borderRadius: 999, background: 'oklch(var(--panel-l) calc(0.02 * var(--css, 1)) var(--ths) / var(--glass-a))', backdropFilter: 'blur(var(--glass-blur)) saturate(160%)',
  border: `1px solid ${accent(.7, .35)}`, boxShadow: '0 18px 40px rgb(0 0 0 / calc(.5 * var(--shadow-k)))', animation: 'ai-toast .34s cubic-bezier(.34,1.3,.64,1)'
}
function tabStyle(active: boolean): React.CSSProperties {
  return {
    position: 'relative',
    appearance: 'none', border: 0, background: 'transparent',
    padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 650, fontFamily: 'var(--font)', cursor: 'pointer',
    transition: 'color .18s ease',
    flex: 'none', whiteSpace: 'nowrap', // 窄屏下不许换行/压缩变形
    color: active ? gradient.onPrimary() : ink(2)
  }
}

/** 头部右侧图标按钮：统一 26px 方钮 + 物理按压反馈 */
function HeaderBtn(props: { title: string; active?: boolean; onClick?: () => void; children: React.ReactNode }): React.JSX.Element {
  const { title, active, onClick, children } = props
  return (
    <motion.div
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      title={title}
      onClick={onClick}
      style={{
        width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        background: active ? accent(0.78, .22) : fill(1),
        border: active ? `1px solid ${accent(0.7, 0.3)}` : '1px solid transparent',
        color: active ? accent(0.85) : ink(3),
        transition: 'background .18s ease, color .18s ease'
      }}
    >
      {children}
    </motion.div>
  )
}
