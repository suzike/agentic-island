// 主进程 / 预加载 / 渲染进程三端共用的数据契约。
// 这是"hook 转发脚本 ↔ 本地桥 ↔ 岛面板"整条链路的类型基准。

export type Backend = 'claude-code' | 'codex'

export type AgentStatus = 'running' | 'needs_approval' | 'done' | 'waiting'

/** 权限决定：与 Claude Code hook 的 permissionDecision 对齐 */
export type Decision = 'allow' | 'deny' | 'ask'

/**
 * hook 转发脚本 POST /event 的载荷。覆盖会话全生命周期：
 * - permission：危险/命令类，阻塞等待审批
 * - session：会话开始
 * - prompt：用户提交了一轮对话
 * - activity：正在使用某工具（读/写/检索/联网等，非阻塞）
 * - stop：一轮/任务完成
 * - notification：需要注意
 */
export interface BridgeEvent {
  token: string
  backend: Backend
  kind: 'permission' | 'stop' | 'notification' | 'session' | 'prompt' | 'activity' | 'end' | 'terminfo'
  sessionId: string
  cwd: string
  /** 工具名，如 Bash / Edit */
  tool?: string
  /** 待审批命令原文（Bash 场景） */
  command?: string
  /** 一句动作/状态描述 */
  detail?: string
  /** 调用本 hook 的父进程 PID（= CLI 进程），跳转时据此按需反查终端窗口 */
  ppid?: number
  /** CLAUDE_CODE_ENTRYPOINT 环境变量（cli / 其它），用于区分 CLI 与桌面端 */
  entry?: string
  /** 终端窗口句柄（kind='terminfo' 时携带，hook 存活期间异步解析所得） */
  termHwnd?: string
  /** 该权限请求是"计划审阅"（ExitPlanMode），command 里是计划全文 */
  isPlan?: boolean
  /** 一轮对话结束（触发 git 变更小结采集） */
  turnEnd?: boolean
}

/** 任务完成时的变更小结 */
export interface ChangeSummary {
  files: number
  added: number
  removed: number
  commit: string
}

/** 一个 Agent 会话在岛内的展示态（服务端权威） */
export interface AgentState {
  id: string
  backend: Backend
  /** 展示用工具名，如 "Claude Code CLI" */
  tool: string
  /** 项目路径（cwd 的短名） */
  proj: string
  status: AgentStatus
  detail: string
  command?: string
  /** 当前待审批请求的 id（status=needs_approval 时） */
  requestId?: string
  /** 完成时的变更小结（M3 由 Stop 事件填充） */
  summary?: ChangeSummary
  /** CLI 进程 PID，用于"跳转到终端"时反查终端窗口 */
  ppid?: number
  /** 该会话所在终端窗口句柄（跳转首选，比进程反查可靠） */
  termHwnd?: string
  /** 当前待审批是"计划审阅"（command 是计划全文，按钮为批准计划/继续规划） */
  isPlan?: boolean
  /** 会话首次出现时间（展示"运行 N 分钟"） */
  startedAt?: number
  /** 最近活动轨迹（状态描述变化的时间线，最多 10 条） */
  history?: { ts: number; text: string }[]
  updatedAt: number
}

/** 主进程 → 渲染进程 推送的完整快照 */
export interface IslandSnapshot {
  agents: AgentState[]
}

/** 渲染进程 → 主进程：用户对某请求的裁决 */
export interface DecisionMessage {
  requestId: string
  decision: Decision
  /** deny 时把这句话回传给 CLI 作为理由，实现真正的接力 steer */
  reason?: string
}

/** 调用 OpenAI 兼容端点所需的最小配置 */
export interface LlmRequestConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** 日历事件（飞书 ICS 订阅解析所得） */
export interface CalendarEvent {
  id: string
  title: string
  /** 开始/结束（毫秒时间戳） */
  start: number
  end: number
  allDay?: boolean
  /** 会议链接（vc.feishu.cn 等），一键入会用 */
  link?: string
  location?: string
}

/** preload 通过 contextBridge 暴露给渲染进程的 API */
export interface IslandBridgeApi {
  onSnapshot: (cb: (snap: IslandSnapshot) => void) => () => void
  getSnapshot: () => Promise<IslandSnapshot>
  decide: (msg: DecisionMessage) => void
  jumpToTerminal: (agentId: string) => Promise<boolean>
  setIgnoreMouse: (ignore: boolean) => void
  playSound: (key: string) => void
  setAutostart: (on: boolean) => void
  reposition: (opts: { follow: boolean; monitorIndex: number }) => void
  setSizeMode: (large: boolean) => void
  /** 灵动岛整体宽度（标准模式面板宽 380–880） */
  setIslandWidth: (w: number) => void
  /** 界面缩放（0.9–1.3，提升小字清晰度） */
  setZoom: (z: number) => void
  /** GitHub 本周热门仓库（迷你条轮播） */
  githubTrending: () => Promise<{ ok: boolean; items?: string[]; error?: string }>
  /** RSS 资讯：抓取并解析单个订阅源 */
  rssFetch: (url: string) => Promise<{ ok: boolean; items?: { title: string; link: string; pubDate: number; desc: string }[]; error?: string }>
  installHooks: () => Promise<{ ok: boolean }>
  uninstallHooks: () => Promise<{ ok: boolean }>
  // 真实 Q&A 后端（deep=深度思考；history=多轮上下文；user 可为多模态 parts 数组=带图提问）
  llmComplete: (
    cfg: LlmRequestConfig,
    system: string,
    user: string | Array<Record<string, unknown>>,
    deep?: boolean,
    history?: { role: 'user' | 'assistant'; content: string }[]
  ) => Promise<{ ok: boolean; text?: string; reasoning?: string; error?: string }>
  /** 在系统默认浏览器打开链接（仅 http/https） */
  openExternal: (url: string) => void
  llmTest: (cfg: LlmRequestConfig) => Promise<{ ok: boolean; msg: string }>
  /** 拉取并解析飞书日历 ICS 订阅链接 */
  fetchCalendar: (url: string) => Promise<{ ok: boolean; events?: CalendarEvent[]; error?: string }>
  /** 抓取网页正文纯文本（灵感便签：丢链接给 AI 整理） */
  fetchUrlText: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  /** 飞书日历 CalDAV 同步（官方支持：设置→日历→CalDAV 同步生成账号） */
  fetchCaldav: (cfg: { server: string; username: string; password: string }) => Promise<{ ok: boolean; events?: CalendarEvent[]; error?: string }>
  /** 系统正在播放的媒体（SMTC：标题/歌手/播放态/封面），无播放返回 null */
  mediaInfo: () => Promise<{ title: string; artist: string; playing: boolean; thumb: string } | null>
  /** 媒体键：playpause / next / prev / volup / voldown */
  mediaKey: (cmd: string) => void
  /** 内嵌真 PTY 终端（ConPTY PowerShell，多标签）：与本地终端同源，TUI/交互式 CLI 原生支持 */
  ptyEnsure: (id: string, cols: number, rows: number) => Promise<boolean>
  ptyInput: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  onPtyData: (cb: (id: string, data: string) => void) => () => void
  /** 剪贴板变化推送（clipWatch 开启时主进程轮询） */
  onClipboard: (cb: (text: string) => void) => () => void
  /** 托盘"展开灵动岛"事件 */
  onReveal: (cb: () => void) => () => void
  /** 退出应用 */
  quitApp: () => void
  // 配置持久化
  loadState: () => Promise<Record<string, unknown> | null>
  saveState: (state: Record<string, unknown>) => void
}
