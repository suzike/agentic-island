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
  /** 模型名（Codex rollout 可得；Claude Code hooks 无） */
  model?: string
  /** 累计 token 用量（Codex token_count 事件） */
  tokens?: number
  /** 当前上下文占用 token（Codex token_count 事件的 last/context） */
  contextTokens?: number
  updatedAt: number
}

/** 主进程 → 渲染进程 推送的完整快照 */
export interface IslandSnapshot {
  agents: AgentState[]
}

/** 当前桌面应用的只读运行信息，用于设置页状态中心。 */
export interface RuntimeInfo {
  version: string
  packaged: boolean
  security: {
    sandbox: boolean
    contextIsolation: boolean
    nodeIntegration: boolean
  }
}

/** 渲染进程 → 主进程：用户对某请求的裁决 */
export interface DecisionMessage {
  requestId: string
  decision: Decision
  /** deny 时把这句话回传给 CLI 作为理由，实现真正的接力 steer */
  reason?: string
}

/** GitHub 仓库（trending / 我的仓库共用） */
export interface GitHubRepo {
  fullName: string
  owner: string
  avatar?: string
  name: string
  desc: string
  stars: number
  forks: number
  language: string
  url: string
  createdAt?: string
  updatedAt?: string
  topics: string[]
}

/** 知识库源（本地文件夹/文件/网页），docCount 为已索引块数 */
export interface KbSourceView {
  id: string
  kind: 'folder' | 'files' | 'url'
  target: string
  label: string
  addedAt: number
  docCount: number
}
/** 本地 Agent CLI 流式事件（claude -p stream-json / codex exec --json 归一化） */
export interface AgentCliEvent {
  kind: 'status' | 'think' | 'text' | 'tool' | 'tool-done' | 'result' | 'error'
  /** status/think/text/result/error 的文本内容 */
  text?: string
  /** tool：展示标签（含 🔌 MCP / ⚡ 技能 标注） */
  name?: string
  /** tool：输入摘要（命令/路径/查询等一行） */
  detail?: string
}

/** 知识库检索命中片段 */
export interface KbHit {
  title: string
  source: string
  path: string
  text: string
  score: number
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
  getRuntimeInfo: () => Promise<RuntimeInfo>
  onSnapshot: (cb: (snap: IslandSnapshot) => void) => () => void
  getSnapshot: () => Promise<IslandSnapshot>
  decide: (msg: DecisionMessage) => void
  jumpToTerminal: (agentId: string) => Promise<boolean>
  /** 外部文件/网页/会议即将打开：收起完整面板并让出窗口层级 */
  onExternalYield: (cb: () => void) => () => void
  /** Chromium 文件选择器显示期间暂停主窗口置顶，关闭后恢复 */
  setNativeDialogOpen: (active: boolean) => void
  setIgnoreMouse: (ignore: boolean) => void
  playSound: (key: string) => void
  setAutostart: (on: boolean) => void
  reposition: (opts: { follow: boolean; monitorIndex: number }) => void
  setSizeMode: (large: boolean) => void
  /** 全屏模式：窗口铺满当前显示器 */
  setFullMode: (full: boolean) => void
  /** 灵动岛整体宽度（标准模式面板宽 380–880） */
  setIslandWidth: (w: number) => void
  /** 界面缩放（0.9–1.3，提升小字清晰度） */
  setZoom: (z: number) => void
  /** GitHub 本周热门仓库（迷你条轮播） */
  githubTrending: () => Promise<{ ok: boolean; items?: string[]; error?: string }>
  /** GitHub 结构化 trending：日/周/月高星新仓库 */
  githubTrendingRepos: (range: string, token?: string) => Promise<{ ok: boolean; repos?: GitHubRepo[]; error?: string }>
  /** GitHub 我的账号 + 仓库（需 token） */
  githubMyRepos: (token: string) => Promise<{ ok: boolean; user?: { login: string; avatar?: string; repos?: number; followers?: number; following?: number }; repos?: GitHubRepo[]; error?: string }>
  /** 搜索 GitHub 仓库 */
  githubSearch: (q: string, token?: string) => Promise<{ ok: boolean; repos?: GitHubRepo[]; error?: string }>
  /** 拉取仓库 README（供 AI 解读） */
  githubReadme: (owner: string, repo: string, token?: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  /** RSS 资讯：抓取并解析单个订阅源 */
  rssFetch: (url: string) => Promise<{ ok: boolean; items?: { title: string; link: string; pubDate: number; desc: string }[]; error?: string }>
  /** 闪念胶囊：全局热键唤出（主进程 → 渲染层）/ 关闭后通知主进程还原点击穿透 */
  onCapsuleToggle: (cb: () => void) => () => void
  capsuleClosed: () => void
  /** 全局命令面板：热键唤出（主进程 → 渲染层） */
  onPaletteToggle: (cb: () => void) => () => void
  /** 第二大脑检索：热键唤出（主进程 → 渲染层） */
  onBrainToggle: (cb: () => void) => () => void
  /** 会议检测：麦克风/摄像头占用变化（主进程 → 渲染层） */
  onDnd: (cb: (active: boolean) => void) => () => void
  /** 智能勿扰：把最终勿扰态告知主进程（真则不自动弹窗/响铃） */
  setDnd: (active: boolean) => void
  /** 桌面挂件：开关独立小窗 */
  toggleWidget: (active: boolean) => void
  /** 桌面挂件：主渲染层推送速览数据（番茄/待办/Agent/媒体） */
  widgetPush: (data: Record<string, unknown>) => void
  /** 桌面挂件：请求展开主岛 */
  widgetReveal: () => void
  /** 桌面挂件：接收主渲染层的数据（挂件窗口用） */
  onWidgetData: (cb: (data: Record<string, unknown>) => void) => () => void
  /** 钉屏便利贴：开关某条便签的桌面浮贴 */
  toggleSticky: (note: Record<string, unknown>) => void
  /** 钉屏便利贴：更新已钉便签的内容 */
  stickyPush: (note: Record<string, unknown>) => void
  /** 钉屏便利贴：关闭指定浮贴（浮贴窗口用） */
  closeSticky: (id: number) => void
  /** 钉屏便利贴：接收便签数据（浮贴窗口用） */
  onStickyData: (cb: (note: Record<string, unknown>) => void) => () => void
  /** 智能截图：框选完成后主进程把图片 dataURL 推给渲染层 */
  onScreenshot: (cb: (dataUrl: string) => void) => () => void
  installHooks: () => Promise<{ ok: boolean; error?: string }>
  uninstallHooks: () => Promise<{ ok: boolean; error?: string }>
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
  /** 文本向量化（第二大脑本地 RAG）；cfg.model = 向量模型名 */
  llmEmbed: (cfg: LlmRequestConfig, texts: string[]) => Promise<{ ok: boolean; vectors?: number[][]; error?: string }>
  /** 知识库（本地 RAG）：列出已接入的源 */
  kbList: () => Promise<KbSourceView[]>
  /** 添加本地文件夹（弹目录选择框，遍历+切块+向量化） */
  kbAddFolder: (cfg: LlmRequestConfig) => Promise<{ ok: boolean; added?: number; skipped?: number; canceled?: boolean; error?: string }>
  /** 添加本地文件（弹多选文件框，支持 pdf/docx/文本/代码） */
  kbAddFiles: (cfg: LlmRequestConfig) => Promise<{ ok: boolean; added?: number; skipped?: number; canceled?: boolean; error?: string }>
  /** 添加网页（抓正文+切块+向量化） */
  kbAddUrl: (cfg: LlmRequestConfig, url: string) => Promise<{ ok: boolean; added?: number; error?: string }>
  /** 移除某个源及其全部块 */
  kbRemove: (id: string) => Promise<{ ok: boolean }>
  /** 增量重扫所有文件夹源（按 mtime 只重嵌变更/新增） */
  kbReindex: (cfg: LlmRequestConfig) => Promise<{ ok: boolean; changed: number; error?: string }>
  /** 语义检索：返回 top-k 命中片段（供问答"知识库模式"作答） */
  kbSearch: (cfg: LlmRequestConfig, query: string, k?: number) => Promise<{ ok: boolean; hits?: KbHit[]; error?: string }>
  /** 代表性取样片段（供 LLM 合成"知识总览/Wiki"）；sourceId 省略=全库 */
  kbSampleChunks: (max?: number, sourceId?: string) => Promise<{ ok: boolean; chunks?: { title: string; text: string }[]; error?: string }>
  /** 读取已合成的持久化 wiki 页（key='overview' 或 sourceId → {md, at}） */
  kbGetWiki: () => Promise<Record<string, { md: string; at: number }>>
  /** 保存一页合成 wiki（编译一次、长期复用） */
  kbSaveWiki: (key: string, md: string) => Promise<{ ok: boolean }>
  /** 本地 Agent CLI 可用性探测（claude / codex 是否已装并可调） */
  agentCliCheck: (engine: 'claude' | 'codex') => Promise<{ ok: boolean; version?: string }>
  /** 本地 Agent 流式问答：调本机 claude -p / codex exec（JSONL 流），事件经 onAgentCliEvent 持续推送；cont=续聊（仅 claude） */
  agentCliStream: (engine: 'claude' | 'codex', prompt: string, cwd?: string, cont?: boolean) => Promise<{ ok: boolean; runId?: string; error?: string }>
  /** 停止当前引擎进行中的请求 */
  agentCliCancel: (engine: 'claude' | 'codex') => void
  /** 订阅本地 Agent 流式事件（runId 区分批次；每次运行保证以 result 或 error 收尾） */
  onAgentCliEvent: (cb: (p: { runId: string; ev: AgentCliEvent }) => void) => () => void
  /** 快捷指令：跑一段 PowerShell（60s 超时，UTF-8 输出） */
  shortcutShell: (cmd: string, cwd?: string) => Promise<{ ok: boolean; output?: string; error?: string }>
  /** 快捷指令：万能打开（http→浏览器；路径→资源管理器/默认程序） */
  shortcutOpen: (target: string) => Promise<{ ok: boolean; error?: string }>
  /** 剪贴板文本读/写（主进程 clipboard，无焦点也可用） */
  clipReadText: () => Promise<string>
  clipWriteText: (t: string) => void
  /** 截图工坊：主动拉起框选截图（结果仍走 onScreenshot 事件） */
  triggerScreenshot: () => void
  /** 图片写剪贴板（PNG 无损） */
  copyImage: (dataUrl: string) => void
  /** 图片存盘（PNG 无损，弹保存框） */
  saveImage: (dataUrl: string, name: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** 拉取并解析飞书日历 ICS 订阅链接 */
  fetchCalendar: (url: string) => Promise<{ ok: boolean; events?: CalendarEvent[]; error?: string }>
  /** 抓取网页正文纯文本（灵感便签：丢链接给 AI 整理） */
  fetchUrlText: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  /** 飞书日历 CalDAV 同步（官方支持：设置→日历→CalDAV 同步生成账号） */
  fetchCaldav: (cfg: { server: string; username: string; password: string }) => Promise<{ ok: boolean; events?: CalendarEvent[]; error?: string }>
  /** 屏幕理解：截取主屏返回 dataURL（先自动藏岛） */
  captureScreen: () => Promise<{ ok: boolean; dataUrl?: string }>
  /** 打开本地 Markdown 文件 */
  openMdFile: () => Promise<{ ok: boolean; path?: string; name?: string; content?: string; error?: string }>
  /** 保存 Markdown 到本地（existingPath 为空则弹另存为） */
  saveMdFile: (content: string, suggestName: string, existingPath?: string) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  /** 导出 PDF（传入完整 HTML） */
  exportPdf: (html: string, name: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  /** 导出任意文本文件（HTML/TXT 等） */
  saveText: (content: string, name: string, ext: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  /** 多仓库仪表盘：读本地仓库 git 状态（只读） */
  gitStatus: (dir: string) => Promise<{ ok: boolean; branch?: string; dirty?: number; commit?: string; subject?: string; when?: string; ahead?: number; behind?: number; error?: string }>
  /** 在资源管理器打开文件夹 */
  openFolder: (dir: string) => void
  /** 系统正在播放的媒体（SMTC：标题/歌手/播放态/封面），无播放返回 null */
  mediaInfo: () => Promise<{ title: string; artist: string; playing: boolean; thumb: string } | null>
  /** 按曲名+歌手拉取 LRC 歌词（lrclib.net，失败返回 ok:false） */
  lyricsFetch: (title: string, artist: string) => Promise<{ ok: boolean; lrc?: string; plain?: string }>
  /** 媒体键：playpause / next / prev / volup / voldown */
  mediaKey: (cmd: string) => void
  /** 内嵌真 PTY 终端（ConPTY PowerShell，多标签）：与本地终端同源，TUI/交互式 CLI 原生支持 */
  ptyEnsure: (id: string, cols: number, rows: number) => Promise<boolean>
  ptyInput: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  onPtyData: (cb: (id: string, data: string) => void) => () => void
  /** 剪贴板变化推送（clipWatch 开启时主进程轮询文本与图片） */
  onClipboard: (cb: (item: { kind: 'text' | 'image'; text?: string; dataUrl?: string }) => void) => () => void
  /** 托盘"展开灵动岛"事件 */
  onReveal: (cb: () => void) => () => void
  /** 退出应用 */
  quitApp: () => void
  // 配置持久化
  loadState: () => Promise<Record<string, unknown> | null>
  saveState: (state: Record<string, unknown>) => void
}
