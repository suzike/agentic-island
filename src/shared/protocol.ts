// 主进程 / 预加载 / 渲染进程三端共用的数据契约。
// 这是"hook 转发脚本 ↔ 本地桥 ↔ 岛面板"整条链路的类型基准。

export type Backend = 'claude-code' | 'codex'

export type AgentStatus = 'running' | 'needs_approval' | 'done' | 'waiting'

export type ScreenshotTarget = 'ask' | 'studio'
/** 钉屏截图窗口的载荷：图片 + 原始像素尺寸（主进程按它算初始窗口比例）。 */
export interface PinnedShotPayload {
  id: string
  dataUrl: string
  name: string
  width: number
  height: number
}

/** 应用内框选出来的区域（DIP，相对被截显示器左上角）+ 该屏的 DPI 缩放。 */
export interface ScreenshotSnipRegion {
  x: number
  y: number
  width: number
  height: number
  /** 叠层所在显示器的 scaleFactor：抓到的帧是物理像素，裁剪必须按它换算 */
  scaleFactor?: number
  /** 框选用途：`snip` 单张（默认），`scroll` 进入滚动长截图 */
  mode?: 'snip' | 'scroll'
}

/** 滚动截图的进度状态（小窗显示用）。 */
export interface ScrollHudState {
  state: 'capturing' | 'done' | 'canceled'
  segments: number
  height: number
  message?: string
}

export interface ScreenshotCapture {
  dataUrl: string
  target: ScreenshotTarget
}

/** 截图历史：抓到的每一张都会先归档到应用自己的历史目录，再进入工坊。 */
export interface ScreenshotHistoryEntry {
  path: string
  name: string
  thumb: string
  width: number
  height: number
  bytes: number
  mtime: number
}

/** 截图前的准备结果：主进程已藏岛并挑好采集源，取像素由渲染层用媒体流完成（原生尺寸）。 */
export interface ScreenCapturePrepare {
  ok: boolean
  sourceId?: string
  /** 实际要抓的显示器（按光标所在屏选择），用于调用方按真实目标屏校验尺寸 */
  displayId?: string
  display?: { width: number; height: number; scaleFactor: number }
  error?: string
}

export type RecordingSourceKind = 'screen' | 'window'
export type RecordingAnimeModel = 'handdrawn' | 'portrait' | 'comic'
export interface RecordingSource {
  id: string
  name: string
  kind: RecordingSourceKind
  displayId?: string
  thumbnail: string
  appIcon?: string
  /** 当前是否有可用画面；最小化或受保护窗口可能没有缩略图。 */
  available?: boolean
  unavailableReason?: string
  displayLabel?: string
  aspectRatio?: number
  bounds?: { x: number; y: number; width: number; height: number }
  scaleFactor?: number
  displayIndex?: number
  isPrimary?: boolean
  rotation?: number
  workArea?: { x: number; y: number; width: number; height: number }
  nativeSize?: { width: number; height: number }
  sourceOrder?: number
}

export interface RecordingCursorPoint {
  x: number
  y: number
  displayId: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  /** 自上次轮询以来累积的鼠标点击 */
  clicks?: Array<{ at: number; x: number; y: number; button: 'left' | 'right' | 'middle' }>
  /**
   * 自上次轮询以来累积的**快捷键/导航键**（角标用）。
   * 可打印字符一律不采集——这里拿到的是 `Ctrl+S`、`Enter` 这类标签，不含任何正文内容。
   */
  keys?: Array<{ at: number; label: string }>
}

export type RecordingExportFormat = 'webm' | 'mp4' | 'gif' | 'mp3'
export type RecordingExportQuality = 'original' | 'compact' | 'balanced' | 'near-lossless' | 'lossless'
export interface RecordingEditSegment {
  id: string
  startMs: number
  endMs: number
  enabled?: boolean
  label?: string
}
export interface RecordingEditSettings {
  segments?: RecordingEditSegment[]
  speed?: number
  crop?: { left: number; top: number; right: number; bottom: number }
  rotation?: 0 | 90 | 180 | 270
  flipHorizontal?: boolean
  flipVertical?: boolean
  brightness?: number
  contrast?: number
  saturation?: number
  gamma?: number
  sharpen?: number
  denoise?: number
  audioVolume?: number
  muteAudio?: boolean
  fadeInMs?: number
  fadeOutMs?: number
}
export interface RecordingExportRequest {
  jobId: string
  name: string
  format: RecordingExportFormat
  quality: RecordingExportQuality
  durationMs: number
  trimStartMs?: number
  trimEndMs?: number
  width: number
  height: number
  fps: number
  hasAudio?: boolean
  outputWidth?: number
  outputHeight?: number
  outputFps?: number
  subtitle?: { mode: 'none' | 'embedded'; language: 'auto' | 'zh' | 'en'; segments: RecordingTranscriptSegment[] }
  /** 主进程生成的临时字幕路径，渲染层传入值无效。 */
  subtitleFilePath?: string
  edit?: RecordingEditSettings
  /**
   * 素材画幅与输出画幅不一致时的重组方式：`contain` 补黑边、`cover` 裁切。
   * 原始画面采集按屏幕原始画幅录制，这个字段决定它怎么落到用户选的画幅上。
   */
  fit?: 'contain' | 'cover'
  /**
   * 导出期运镜：按**成片帧序**给出的相机路径，由渲染层从工程的光标轨迹重建。
   *
   * 之所以在渲染层建：只有渲染层知道剪辑段（保留哪些区间、什么速度），而主进程只需要把
   * 这条路径压成 FFmpeg 表达式。为 null 时按原样导出（运镜已在录制期合成进画面）。
   */
  motion?: RecordingMotionTrack | null
  /**
   * 导出期光标光晕：按成片帧序的光标轨迹 + 光斑尺寸。
   * 光斑是"又大又软"的圆，所以能用折线航点表达式跟随（细光环不行，那需要逐帧精确跟踪）。
   *
   * `pngDataUrl` 是渲染层传来的光斑图，主进程会先落盘成临时文件并把路径写进 `filePath` 再拼参数——
   * `buildRecordingFfmpegArgs` 是**纯函数**（离线测试重度依赖），不能在里面做文件写入。
   */
  glow?: { pngDataUrl?: string; filePath?: string; path: Array<{ x: number; y: number }>; fps: number; size: number } | null
  /**
   * 导出期按键角标：`t` 为成片时间轴毫秒，x/y 归一化（角标画在该位置左上角）。
   * 只可能来自录制期采到的快捷键/导航键，不含可打印字符。
   */
  badges?: Array<{ t: number; label: string; x: number; y: number }> | null
}

/**
 * 导出期运镜的单帧相机状态。x/y 是**归一化画面中心**（0..1），zoom ≥ 1（1 表示不放大）。
 * 时间轴由帧序隐含：第 i 项就是成片第 i 帧，主进程按 `fps` 把它换算成 zoompan 的 `in`。
 */
export interface RecordingMotionFrame {
  x: number
  y: number
  zoom: number
}
/** 人工（可编辑）的运镜点：t 是**素材时间轴**偏移，x/y 归一化，zoom >= 1。 */
export interface RecordingMotionKeyframe {
  t: number
  x: number
  y: number
  zoom: number
}

export interface RecordingMotionTrack {
  frames: RecordingMotionFrame[]
  fps: number
  /**
   * 源画面需要先做的"铺满"裁切窗口（归一化）。源画幅 ≠ 目标画幅时由渲染层算好放进来：
   * `zoompan` 的取景窗口保持输入宽高比，画幅不一致会拉伸，所以先裁齐再取景。
   * 同画幅时为 undefined（主进程不做任何裁切）。
   */
  crop?: { x: number; y: number; width: number; height: number }
}

/**
 * 导出结果 + **成品自检**结论。
 *
 * `check` 来自"读回写出的文件再与请求对照"，而不是"FFmpeg 正常退出"——本项目被
 * "导出画面飞快跑完"这类事故咬过两次，两次都是文件写成功、只有内容不对。
 */
export interface RecordingExportResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
  check?: { ok: boolean; summary: string; warnings: string[] }
}

export interface RecordingExportProgress {
  jobId: string
  phase: 'preparing' | 'encoding' | 'done' | 'error' | 'canceled'
  progress: number
  message?: string
}

export type RecordingSessionStatus = 'recording' | 'interrupted' | 'ready'
export interface RecordingSessionManifest {
  id: string
  name: string
  mimeType: string
  sourceName: string
  sourceKind: RecordingSourceKind
  width: number
  height: number
  fps: number
  hasAudio: boolean
  status: RecordingSessionStatus
  createdAt: number
  updatedAt: number
  durationMs: number
  bytes: number
  chunks: number
  fileName: string
}
export interface RecordingSessionCreateInput {
  name: string
  mimeType: string
  sourceName: string
  sourceKind: RecordingSourceKind
  width: number
  height: number
  fps: number
  hasAudio: boolean
}
export interface RecordingTranscriptSegment { startMs: number; endMs: number; text: string }

export type RecordingTimelineEventType = 'start' | 'pause' | 'resume' | 'marker' | 'keyframe' | 'end'
export interface RecordingProjectTimelineEvent {
  at: number
  type: RecordingTimelineEventType
  label: string
}
export interface RecordingProjectAiResult {
  id: number
  label: string
  text: string
  error?: boolean
}

/**
 * 录制期采集的光标轨迹点——"拍摄与后期分离"的事件日志。
 *
 * 录制时只做**观测**（不动画面）：运镜、光标美化、剪除空白都在剪辑/导出期按这份日志重建。
 * 好处是运镜参数改了不必重录，且运镜不再受录制帧率影响（掉帧时以前会跟着变慢）。
 * t 为相对录制开始的毫秒偏移（暂停期间不推进），x/y 为相对录制来源区域的归一化坐标。
 */
export interface RecordingCursorSample {
  t: number
  x: number
  y: number
  /** 归一化瞬时移动速度（导出期重建缩放强度用；缺省按 0 处理） */
  s?: number
}
export interface RecordingProjectDocument {
  schema: 'agentic-island-recording-project/v2'
  id: string
  sessionId: string
  name: string
  createdAt: number
  updatedAt: number
  source: { name: string; kind: RecordingSourceKind; displayId?: string } | null
  durationMs: number
  size: { width: number; height: number }
  fps: number
  hasAudio: boolean
  edit: RecordingEditSettings & { segments: RecordingEditSegment[] }
  timeline: RecordingProjectTimelineEvent[]
  transcript: { model: string; language: 'auto' | 'zh' | 'en'; segments: RecordingTranscriptSegment[] }
  cursorTrack: RecordingCursorSample[]
  /** 录制期采到的鼠标点击（只左/右/中键，不监听键盘）。事后无法补录，供剪除空白与导出期效果使用。 */
  clickTrack: RecordingCursorSample[]
  /** 用户编辑过的运镜点；为空表示按光标轨迹自动运镜。 */
  motionKeyframes: RecordingMotionKeyframe[]
  /** 录制期采到的快捷键/导航键（角标用）。与点击同理：事后无法补录。 */
  keyTrack: Array<{ t: number; label: string }>
  /**
   * 这段素材能不能在导出期重建运镜。
   *
   * 只有录制时**没有**把运镜合成进画面（运镜=关闭，所以画面是稳定的）才为 true：否则录制像素里
   * 已经带着当时的推近/平移，导出再套一层就是双重运镜。真正的"拍摄与后期分离"（录原始画面、
   * 运镜完全留给导出）是下一步，这里先如实标注能力边界。
   */
  exportMotionReady: boolean
  workspace: {
    timelineZoom: number
    timelineSnap: boolean
    videoTrackLocked: boolean
    markerTrackLocked: boolean
    aiEditMode: 'conservative' | 'tutorial' | 'dynamic'
  }
  aiResults: RecordingProjectAiResult[]
}
export type RecordingProjectSaveInput = Omit<RecordingProjectDocument, 'id' | 'createdAt' | 'updatedAt' | 'cursorTrack' | 'clickTrack' | 'keyTrack' | 'motionKeyframes' | 'exportMotionReady'> & { id?: string; cursorTrack?: RecordingCursorSample[]; clickTrack?: RecordingCursorSample[]; keyTrack?: Array<{ t: number; label: string }>; motionKeyframes?: RecordingMotionKeyframe[]; exportMotionReady?: boolean }
export interface RecordingProjectSummary {
  id: string
  sessionId: string
  name: string
  createdAt: number
  updatedAt: number
  durationMs: number
  width: number
  height: number
  hasAudio: boolean
  segmentCount: number
  transcriptCount: number
}

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
  /** 模型名（Stop 时从 transcript 尾部提取；Codex rollout 原生携带） */
  model?: string
  /** 当前上下文占用 token（输入+缓存；Stop 时从 transcript 尾部提取，Codex 来自 token_count） */
  contextTokens?: number
  /** 本轮 Agent 的最终回复全文（Stop/task_complete 携带，供验收台留档） */
  lastReply?: string
  /** 刚执行完的一条验证/构建命令结果（Claude PostToolUse / Codex function_call_output） */
  check?: CommandRun
}

/** 任务完成时的变更小结 */
export interface ChangeSummary {
  files: number
  added: number
  removed: number
  commit: string
  /** 变更文件清单（相对仓库根，最多 200 条；由 git status 得到，非 git/无改动时为空） */
  paths?: { path: string; status: string; committed?: boolean }[]
  /** 会话期间产生的提交数（>0 时清单只覆盖工作区，已提交内容不在其中） */
  commits?: number
}

/**
 * 一次命令执行的真实结果（验收台的"验证证据"）。
 * 只记录能拿到的事实：退出码/耗时可能缺失（Claude Code 的钩子不回传退出码），缺失就不填。
 */
export interface CommandRun {
  command: string
  at: number
  /** 退出码（Codex rollout 可从输出解析；Claude 钩子拿不到时缺省） */
  exitCode?: number
  /** 实测耗时（毫秒） */
  ms?: number
  /** 明确的失败信号：非零退出码 / 用户中断 / 工具报错 */
  ok?: boolean
  /** 失败时的输出尾部，最多 400 字 */
  outputTail?: string
}

/** 一个 Agent 会话在岛内的展示态（服务端权威） */
export interface AgentState {
  id: string
  backend: Backend
  /** 展示用工具名，如 "Claude Code CLI" */
  tool: string
  /** 项目路径（cwd 的短名） */
  proj: string
  /** 会话工作目录（续会话/补验证时需要） */
  cwd?: string
  /** 岛是在会话已经跑起来之后才接上的：工作区基线必然晚于会话开始，改动清单可能不完整 */
  baselineLate?: boolean
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
  /** 模型名（Codex rollout / Claude Stop 事件的 transcript 均可得） */
  model?: string
  /** 累计 token 用量（Codex token_count 事件） */
  tokens?: number
  /** 当前上下文占用 token（Codex token_count 的 last/context；Claude 为最近一次 API 调用的输入+缓存） */
  contextTokens?: number
  /** 本次会话执行过的验证/构建命令结果（验收台证据，最多 12 条） */
  checks?: CommandRun[]
  /** 最近一轮的最终回复（会话结束前保留，供验收台留档） */
  lastReply?: string
  /** 计划模式提交的计划全文（ExitPlanMode）；批准/打回后仍保留，供验收对照 */
  plan?: { text: string; at: number; decision?: Decision; reason?: string }
  updatedAt: number
}

/** 跳转终端的兜底线索（会话已结束、Agent 已从快照移除时由验收记录提供） */
export interface TerminalJumpHint {
  termHwnd?: string
  ppid?: number
  proj?: string
  backend?: Backend
}

/** 让原会话继续补验证：走 CLI 的 resume，提示词从 stdin 喂入 */
export interface FollowupRequest {
  /** 渲染层用来对号入座这一次续跑的流事件 */
  runId: string
  engine: 'claude' | 'codex'
  sessionId: string
  cwd: string
  prompt: string
}

export interface FollowupEvent {
  runId: string
  kind: 'start' | 'output' | 'done' | 'error'
  text?: string
  /** done 时的真实退出码 */
  exitCode?: number
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

/** 自动更新状态机（electron-updater 事件归一化后推送给渲染层） */
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
export interface UpdateState {
  status: UpdateStatus
  /** 新版本号（available / downloaded 时有值） */
  version?: string
  /** 下载进度百分比（downloading 时有值） */
  percent?: number
  /** 失败原因（error 时有值，已截断） */
  error?: string
}

/** 审批策略：用户自定义放行规则，主进程在阻塞审批前强制执行并记审计。
 *  匹配器与默认值在 src/main/approval-policy.ts（raw-node 可加载），本文件只声明类型。 */
export interface ApprovalPolicy {
  enabled: boolean
  /** 放行规则：对命令原文做子串匹配（大小写不敏感），例如 "git status"、"npm run test" */
  rules: string[]
}

/** 一次自动放行的审计记录（scope: rule=命中策略规则 · session=本会话放行命令） */
export interface ApprovalAuditEntry {
  ts: number
  command: string
  rule: string
  scope: 'rule' | 'session'
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
  kind: 'folder' | 'files' | 'url' | 'conversation'
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

/** 显示器信息（getDisplays；index = getAllDisplays() 枚举序号，reposition 的 monitorIndex 即它） */
export interface DisplayInfo {
  /** Electron display.id（跨枚举稳定） */
  id: number
  /** getAllDisplays() 枚举序号（0 起） */
  index: number
  label: string
  primary: boolean
  width: number
  height: number
  scaleFactor: number
}

export type TerminalShellProfile = 'powershell' | 'pwsh' | 'cmd' | 'wsl'

export interface TerminalSavedSession {
  id: string
  name: string
  cwd?: string
  profile: TerminalShellProfile
  projectId?: string
  pinned?: boolean
  createdAt: number
  lastActiveAt: number
  commandCount: number
  lastCommand?: string
  lastExitCode?: number
  lastDurationMs?: number
  outputSnapshot?: string
  outputSavedAt?: number
  handoff?: string
  envProfileId?: string
}

export interface TerminalCommandRecord {
  id: number
  sessionId: string
  sessionName: string
  command: string
  cwd?: string
  ts: number
  exitCode?: number
  durationMs?: number
}

export interface TerminalStartupTask {
  id: string
  label: string
  command: string
  cwd?: string
  enabled: boolean
  createdAt: number
}

export interface TerminalWorkspaceGroup {
  id: string
  name: string
  cwd: string
  pinned?: boolean
  lastOpenedAt: number
}

export interface TerminalEnvironmentProfile {
  id: string
  name: string
  variables: { key: string; value: string }[]
  createdAt: number
}

export interface TerminalWorkspaceSettings {
  restoreMode: 'prompt' | 'auto' | 'fresh'
  captureOutput: boolean
  redactOutput: boolean
  retentionDays: number
  maxSnapshotChars: number
}

export interface TerminalWorkspaceState {
  version: 2
  sessions: TerminalSavedSession[]
  activeSessionId?: string
  history: TerminalCommandRecord[]
  favorites: string[]
  startupTasks: TerminalStartupTask[]
  groups: TerminalWorkspaceGroup[]
  envProfiles: TerminalEnvironmentProfile[]
  settings: TerminalWorkspaceSettings
  updatedAt: number
}

export interface TerminalProjectTask {
  id: string
  label: string
  command: string
  source: 'package' | 'vscode' | 'make' | 'python' | 'dotnet' | 'rust' | 'generic'
}

export interface TerminalProjectInspection {
  ok: boolean
  cwd: string
  name: string
  kind: string[]
  packageManager?: string
  tasks: TerminalProjectTask[]
  checks: { label: string; status: 'ok' | 'warn' | 'info'; detail: string }[]
  error?: string
}

// ===== Super-Agent（后台自主循环：监控 + 拍板）=====
// 归一化模型：任何"后台自主跑、拿不准才找人"的循环（首个提供方 agent-autoloop，未来 dsh-superagent）
// 都折算成下面这组视图模型，渲染层只消费归一化数据、不感知提供方细节。
// 注意：卡片/事件文本来自外部系统，属不可信输入——只渲染、不执行；链接必须显式点击打开。

/** 待拍板卡片：autoloop 的 ask（带选项）/ notice（通知，可结案） */
export interface SuperDecision {
  /** provider 域内唯一，如 'autoloop:56' */
  id: string
  provider: string
  /** provider 原生卡片编号（动作回传用） */
  cardId: number
  kind: 'ask' | 'notice'
  title: string
  text: string
  options: string[]
  /** 推荐选项下标（可能缺省） */
  recommend: number | null
  /** 来源规则名 */
  rule: string | null
  /** 所在事项（parallel 规则按对象分事项） */
  lane: string | null
  /** 提问时留给接着干那一轮的说明 */
  about: string | null
  link: string | null
  /** 创建时间（ms；中台未提供时为 0，不显示年龄） */
  createdAt: number
  /** 该卡片的投递状态：中台 `channels[].lastFailure` 命中的最近一张卡片（没送达=你可能根本不知道它存在） */
  deliveryFailed?: { tries: number; error: string; givenUp: boolean } | null
}

/** 进行中/排队/不确定的一轮 */
export interface SuperWork {
  id: string
  provider: string
  runId: number
  rule: string
  lane: string | null
  /** 执行该轮的 Agent 名（autoloop 可接任意 CLI Agent，不假设后端） */
  agent: string | null
  state: 'queued' | 'claimed' | 'unknown'
  /** 已重试次数（>0 表示失败过；queued+attempts>0 = 等重试） */
  attempts: number
  error: string | null
  summary: string | null
  manual: boolean
  /** 本人已请求停止、进程尚未确认（cancel_at 已置） */
  stopping: boolean
  /** 下次重试的最早时刻（attempts>0 时；显示"为什么不动"） */
  notBefore: number | null
  /** 打开该轮 Agent 会话的链接（http(s) 可直开；claude:// 等自定义协议仅复制） */
  link: string | null
  /** 会话编号（回执/接续时上报） */
  session: string | null
}

/** 已结束的近几轮 */
export interface SuperHistoryItem {
  id: string
  provider: string
  runId: number
  rule: string
  agent: string | null
  outcome: 'done' | 'nothing' | 'cancelled'
  finishedAt: number | null
  summary: string | null
  /** usage.input+output；Agent 未上报时为 null（如实显示"未上报"而非 0） */
  tokens: number | null
  costUsd: number | null
  link: string | null
  session: string | null
}

/** 规则行（含暂停状态与暂停期间跳过的事件数） */
export interface SuperRule {
  provider: string
  name: string
  agent: string | null
  /** 定时的人话描述（如"每天 08:00"）；事件规则为 null */
  every: string | null
  /** 事件规则：来源 id；定时规则为 null */
  sourceType: string | null
  /** 定时规则的下次运行时刻 */
  next: number | null
  paused: boolean
  pauseReason: string | null
  pausedSince: number | null
  /** 暂停期间跳过、尚未补跑的事件数 */
  skippedCount: number
  /** 该规则的今日统计（中台 lines[].totals 的 tally）；缺失时为 null */
  today: { done: number; nothing: number; retrying: number; running: number; queued: number } | null
}

/** 暂停期间被跳过的事件（state.skipped）：恢复后可原样补跑，所以必须让用户看到丢了什么 */
export interface SuperSkippedEvent {
  id: number
  source: string
  type: string
  subject: string | null
  summary: string | null
  at: number | null
  /** 收到时因为暂停没接这条事件的规则 */
  rules: string[]
}

/** elsewhere：托管在别处的定时任务（中台不启动，只列出；写了 cwd 的也能回问） */
export interface SuperElsewhere {
  name: string
  source: string
  agent: string
  cron: string
  every: string | null
  next: number | null
  where: string | null
}

/** 未来复查（later 约定的到期提醒） */
export interface SuperTimer {
  provider: string
  rule: string
  lane: string | null
  key: string
  about: string
  at: number
}

/** 用量窗口：未上报的轮数单列（诚实显示，不折算成 0） */
export interface SuperSpendWindow {
  rounds: number
  tokens: number | null
  cached: number | null
  costUsd: number | null
  missingTokens: number
  missingCost: number
}

export interface SuperSpend {
  today: SuperSpendWindow
  week: SuperSpendWindow
}

/** 中台部件在线状态：Agent 接单程序 / 通知通道 / 事件源（事件源无心跳概念，online 为 null） */
export interface SuperComponent {
  kind: 'agent' | 'channel' | 'source'
  name: string
  online: boolean | null
  detail: string | null
}

/** 单个提供方（后台循环系统）的连接状态 */
export interface SuperProviderStatus {
  id: string
  label: string
  connected: boolean
  /** SSE 增量流在线：变更秒级可见，此时轮询退为兜底 */
  live: boolean
  /** 本机发现该循环的安装痕迹（如 ~/.agent-autoloop/） */
  hubDetected: boolean
  /** http=本人密钥直连 · cli=命令行只读兜底 · off=无可用通道 */
  mode: 'http' | 'cli' | 'off'
  url: string | null
  /** 离线原因 / 连接方式说明 */
  detail: string | null
  keyConfigured: boolean
  updatedAt: number | null
}

/** 一条真实事实（SSE /v1/stream 的 fact）：type 是上游输入类型，例如 ingest / started / result / createCard / ask / resolve / tick / rules。
 *  rule/lane/source 从 fact 的 changes 里提取（这条事实真实作用的规则与事项）——流水线据此把动画精确落到对应规则行。 */
export interface SuperFactPulse {
  seq: number
  type: string
  at: number
  /** 事实作用的规则名（runs/cards 表的 row.rule） */
  rule?: string | null
  /** 事项（parallel 规则的 lane） */
  lane?: string | null
  /** 事件来源（events 表的 row.source） */
  source?: string | null
}

/** 流水线各阶段的真实计数（中台 totals + timers/rules 派生），用于可视化管道点亮 */
export interface SuperPipeline {
  /** 已登记来源数 */
  sources: number
  /** 规则总数 / 暂停中 */
  rules: number
  pausedRules: number
  /** 排队（含等重试） */
  queued: number
  retrying: number
  /** 执行中的轮次 */
  running: number
  /** 状态不确定（接单程序失联） */
  unknown: number
  /** 今日完成 / 今日没事可做 */
  doneToday: number
  nothingToday: number
  /** 待拍板卡片（需人工） */
  attention: number
  /** 约定中的复查 */
  timers: number
}

/** Super-Agent 板块的完整快照（主进程权威，事件推送） */
export interface SuperAgentSnapshot {
  providers: SuperProviderStatus[]
  /** open 卡片，ask 在前、同 kind 按年龄从老到新（老的最该先处理） */
  decisions: SuperDecision[]
  work: SuperWork[]
  rules: SuperRule[]
  history: SuperHistoryItem[]
  timers: SuperTimer[]
  spend: SuperSpend | null
  components: SuperComponent[]
  pipeline: SuperPipeline
  /** 暂停期间跳过、尚未补跑的事件（最近 20 条） */
  skipped: SuperSkippedEvent[]
  /** 托管在别处的定时任务 */
  elsewhere: SuperElsewhere[]
  /** 最近的真实事实流（SSE 增量，最多 12 条，按 seq 升序）——渲染层据此播放流动动画 */
  facts: SuperFactPulse[]
  updatedAt: number
}

// ===== Autoloop 规则文件（可视化编排读写的对象；上游用严格 JSON.parse，写前须 check 校验） =====

/** 一个 Agent 定义（rules.json 的 agents[id]；任意 CLI Agent 一行接入） */
export interface AutoloopAgentDef {
  /** 展示名 */
  name?: string
  /** 内置插件：claude / codex / acp / command / dsh 等 */
  use?: string
  /** use=command 时的命令数组，{prompt} 作为独立参数 */
  command?: string[]
  /** 只跑在哪台接单程序（多机时） */
  worker?: string
  model?: string
  effort?: string
  /** 服务档位（如 Codex priority） */
  tier?: string
  /** read | edit | full（默认 edit） */
  access?: string
  /** 替换启动程序（设环境变量再 exec 的脚本） */
  program?: string
  /** 该 Agent 跨规则同时领取上限 */
  maxActive?: number
}

/** 一个事件来源定义 */
export interface AutoloopSourceDef {
  name?: string
  /** Webhook 适配器（plugins/<adapter>/source.ts） */
  adapter?: string
  [key: string]: unknown
}

/** 一个通知通道定义 */
export interface AutoloopChannelDef {
  name?: string
  /** 允许拍板的人（飞书 open_id 等） */
  answerers?: string[]
  [key: string]: unknown
}

/** 规则的 when：定时（cron）或事件（来源+类型），二选一 */
export interface AutoloopRuleWhen {
  cron?: string
  source?: string
  types?: string[]
}

/** 一条规则 = 一次回路定义：什么事件 → 交给谁 → 哪个目录 → 什么 skill/提示词 → 怎么并行/续会话 */
export interface AutoloopRuleDef {
  name: string
  when: AutoloopRuleWhen
  to: string
  cwd?: string
  skill?: string
  prompt?: string
  /** 会话标题模板（{id} / {subject}） */
  title?: string
  /** 同组串行（默认=规则名） */
  group?: string
  /** 按对象分事项后的并发上限 */
  parallel?: number
  /** 该规则同时领取上限 */
  maxActive?: number
  /** 同一事项接着上一轮的会话 */
  resume?: boolean
  /** always / needed / never */
  tell?: string
  /** 回执里允许发的事件 */
  emits?: { source: string; types: string[] }
  /** 卡片/通知只发到这些通道 */
  channels?: string[]
}

/** 托管在别处的定时任务（中台不启动，只列出；可回问） */
export interface AutoloopElsewhereDef {
  name: string
  source: string
  to: string
  cron: string
  where?: string
  model?: string
  effort?: string
  cwd?: string
  skill?: string
  prompt?: string
}

/** rules.json 全文（可视化编排的编辑对象） */
export interface AutoloopRules {
  timezone?: string
  askFirst?: string[]
  sources: Record<string, AutoloopSourceDef>
  agents: Record<string, AutoloopAgentDef>
  channels?: Record<string, AutoloopChannelDef>
  defaultChannels?: string[]
  rules: AutoloopRuleDef[]
  elsewhere?: AutoloopElsewhereDef[]
}

/** 规则文件读写结果 */
export interface SuperRulesResult {
  ok: boolean
  /** 文件绝对路径 */
  path: string
  rules?: AutoloopRules
  /** 读取/解析/校验失败原因（人话） */
  error?: string
  /** 保存时生成的备份路径 */
  backupPath?: string
}

/** 一轮的来龙去脉时间线（agent-autoloop why） */
export interface SuperWhyLine {
  at: number | null
  text: string
}

/** Super-Agent 动作统一结果 */
export interface SuperActionResult {
  ok: boolean
  error?: string
  message?: string
}

/** Super-Agent 板块连接配置（随 save-state 持久化，密钥落 DPAPI 加密的 config.json） */
export interface SuperAgentSettings {
  enabled: boolean
  /** 中台地址；空 = 从本机 ~/.agent-autoloop/config.json 自动发现 */
  url: string
  /** 本人（owner）密钥；为空则只读兜底、无法拍板 */
  ownerKey: string
  /** 轮询间隔（秒，5–120） */
  pollMs: number
}

/** preload 通过 contextBridge 暴露给渲染进程的 API */
export interface IslandBridgeApi {
  getRuntimeInfo: () => Promise<RuntimeInfo>
  /** 手动检查更新（设置页"检查更新"按钮） */
  checkForUpdates: () => void
  /** 下载完成后退出并安装更新 */
  installUpdate: () => void
  /** 更新状态推送（检查中/发现新版本/下载进度/已就绪/失败） */
  onUpdateState: (cb: (s: UpdateState) => void) => () => void
  /** 本会话放行：同一 Agent 会话内相同命令不再询问（当前请求仍需单独 decide） */
  approvalSessionAllow: (agentId: string, command: string) => void
  /** 自动放行审计流水推送（主进程每次按策略放行时推一条） */
  onApprovalAudit: (cb: (entry: ApprovalAuditEntry) => void) => () => void
  onSnapshot: (cb: (snap: IslandSnapshot) => void) => () => void
  getSnapshot: () => Promise<IslandSnapshot>
  decide: (msg: DecisionMessage) => void
  jumpToTerminal: (agentId: string, hint?: TerminalJumpHint) => Promise<boolean>
  /** 续跑原会话补验证（claude --resume / codex exec resume），结果经 onFollowupEvent 推送 */
  startFollowup: (req: FollowupRequest) => Promise<{ ok: boolean; error?: string }>
  cancelFollowup: (runId: string) => void
  onFollowupEvent: (cb: (ev: FollowupEvent) => void) => () => void
  /** 外部文件/网页/会议即将打开：收起完整面板并让出窗口层级 */
  onExternalYield: (cb: () => void) => () => void
  /** Chromium 文件选择器显示期间暂停主窗口置顶，关闭后恢复 */
  setNativeDialogOpen: (active: boolean) => void
  setIgnoreMouse: (ignore: boolean) => void
  /** 主进程按面板实际矩形兜底命中，解决面板刚出现/展开时首击穿透 */
  setInteractiveRegion: (state: { open: boolean; overlay: boolean; rect: { x: number; y: number; width: number; height: number } | null }) => void
  playSound: (key: string) => void
  setAutostart: (on: boolean) => void
  reposition: (opts: { follow: boolean; monitorIndex: number }) => void
  setSizeMode: (large: boolean) => void
  /** 全屏模式：窗口铺满当前显示器（含任务栏区域，主进程切 display.bounds） */
  setFullMode: (full: boolean) => void
  /** 真实显示器列表（设置页选择用；index 与 reposition 的 monitorIndex 对应） */
  getDisplays: () => Promise<DisplayInfo[]>
  /** 灵动岛整体宽度（标准模式面板宽 380–880） */
  setIslandWidth: (w: number) => void
  /** 界面缩放（0.9–1.3，提升小字清晰度） */
  setZoom: (z: number) => void
  /** GitHub 本周热门仓库（迷你条轮播） */
  githubTrending: () => Promise<{ ok: boolean; items?: string[]; error?: string }>
  /** GitHub 结构化 trending：日/周/月高星新仓库 */
  githubTrendingRepos: (range: string, token?: string, requestId?: string) => Promise<{ ok: boolean; repos?: GitHubRepo[]; error?: string }>
  /** GitHub 我的账号 + 仓库（需 token） */
  githubMyRepos: (token: string) => Promise<{ ok: boolean; user?: { login: string; avatar?: string; repos?: number; followers?: number; following?: number }; repos?: GitHubRepo[]; error?: string }>
  /** 搜索 GitHub 仓库 */
  githubSearch: (q: string, token?: string, requestId?: string) => Promise<{ ok: boolean; repos?: GitHubRepo[]; error?: string }>
  /** 取消进行中的 GitHub 请求（慢网/切换范围）。 */
  githubCancel: (requestId: string) => Promise<{ ok: boolean }>
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
  /** 智能截图：框选完成后主进程把图片及明确去向推给渲染层 */
  onScreenshot: (cb: (capture: ScreenshotCapture) => void) => () => void
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
  /** 从当前 OpenAI 兼容端点读取账号实际可用的模型。 */
  llmListModels: (cfg: LlmRequestConfig) => Promise<{ ok: boolean; models?: string[]; error?: string }>
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
  /** 将对话/回答直接作为文本知识源写入本地向量库。sourceKey 用于同一来源覆盖更新。 */
  kbAddText: (cfg: LlmRequestConfig, title: string, text: string, sourceKey: string) => Promise<{ ok: boolean; added?: number; error?: string }>
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
  triggerScreenshot: (target?: ScreenshotTarget) => void
  /** 录屏：枚举可捕获的显示器和窗口。 */
  recordingSources: () => Promise<{ ok: boolean; sources?: RecordingSource[]; error?: string }>
  /** 录屏智能运镜：读取当前鼠标与所在显示器坐标。 */
  recordingCursor: () => Promise<RecordingCursorPoint>
  /** 录制期间开关鼠标点击采集（只跟随录制生命周期，平时不监听输入）。 */
  setRecordingClickLog: (active: boolean) => Promise<{ ok: boolean }>
  /** 录屏期间禁止灵动岛被桌面采集器录入。 */
  setRecordingProtection: (active: boolean) => void
  /** 读取随安装包分发的本地人物动漫化 ONNX 模型。 */
  recordingAnimeModel: (model?: RecordingAnimeModel) => Promise<{ ok: boolean; data?: ArrayBuffer; name?: string; error?: string }>
  /** 将录制数据写入受控临时文件，避免 file:// 沙箱拒绝 blob: 预览。 */
  prepareRecordingPreview: (data: ArrayBuffer) => Promise<{ ok: boolean; id?: string; url?: string; error?: string }>
  releaseRecordingPreview: (id: string) => void
  /** 创建持久录制会话；MediaRecorder 分片将直接写入主进程文件。 */
  createRecordingSession: (input: RecordingSessionCreateInput) => Promise<{ ok: boolean; session?: RecordingSessionManifest; error?: string }>
  appendRecordingChunk: (id: string, index: number, data: ArrayBuffer) => Promise<{ ok: boolean; session?: RecordingSessionManifest; error?: string }>
  finalizeRecordingSession: (id: string, durationMs: number) => Promise<{ ok: boolean; session?: RecordingSessionManifest; url?: string; error?: string }>
  listRecordingSessions: () => Promise<{ ok: boolean; sessions?: RecordingSessionManifest[]; error?: string }>
  recoverRecordingSession: (id: string) => Promise<{ ok: boolean; session?: RecordingSessionManifest; url?: string; error?: string }>
  discardRecordingSession: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** 保存或用内置 FFmpeg 转码录制结果。 */
  exportRecording: (data: ArrayBuffer, request: RecordingExportRequest) => Promise<RecordingExportResult>
  exportRecordingSession: (id: string, request: RecordingExportRequest) => Promise<RecordingExportResult>
  transcribeRecordingSession: (id: string, cfg: LlmRequestConfig, model: string, language: 'auto' | 'zh' | 'en') => Promise<{ ok: boolean; text?: string; segments?: RecordingTranscriptSegment[]; error?: string }>
  saveRecordingProject: (input: RecordingProjectSaveInput) => Promise<{ ok: boolean; project?: RecordingProjectDocument; error?: string }>
  listRecordingProjects: () => Promise<{ ok: boolean; projects?: RecordingProjectSummary[]; error?: string }>
  loadRecordingProject: (id: string) => Promise<{ ok: boolean; project?: RecordingProjectDocument; error?: string }>
  duplicateRecordingProject: (id: string) => Promise<{ ok: boolean; project?: RecordingProjectDocument; error?: string }>
  deleteRecordingProject: (id: string) => Promise<{ ok: boolean; error?: string }>
  cancelRecordingExport: (jobId: string) => void
  onRecordingExportProgress: (cb: (progress: RecordingExportProgress) => void) => () => void
  /** 为成品生成局域网临时链接（随机 token、1 小时自动过期、只读单文件）。 */
  shareFile: (path: string) => Promise<{ ok: boolean; url?: string; expiresAt?: number; error?: string }>
  /** 虚拟摄像头 MJPEG 服务：启停与推帧。 */
  startMjpeg: () => Promise<{ ok: boolean; url?: string; token?: string; port?: number; error?: string }>
  pushMjpegFrame: (dataUrl: string) => void
  stopMjpeg: () => Promise<{ ok: boolean }>
  /** 通过 OBS WebSocket 启动/停止 OBS Virtual Camera。 */
  startVirtualCamera: (options: { streamUrl: string; width: number; height: number; obsUrl?: string; password?: string }) => Promise<{ ok: boolean; scene?: string; launched?: boolean; error?: string }>
  stopVirtualCamera: (options: { obsUrl?: string; password?: string }) => Promise<{ ok: boolean; error?: string }>
  /** 图片写剪贴板 */
  copyImage: (dataUrl: string) => Promise<{ ok: boolean; error?: string }>
  /** 图片存盘（PNG/JPEG/WebP，弹保存框） */
  saveImage: (dataUrl: string, name: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** 本地离线 OCR：走 Windows 自带引擎（不出网、不新增依赖）。 */
  ocrImageLocal: (dataUrl: string) => Promise<{ ok: boolean; text?: string; language?: string; error?: string }>
  /** 批量美化：多选图片并直接读成 dataUrl（单张上限 160MB，最多 50 张）。 */
  selectImagesForBatch: () => Promise<{ ok: boolean; images?: Array<{ name: string; dataUrl: string }>; error?: string }>
  /** 把一张图贴到屏幕最上层（可拖动/缩放/调透明度），返回窗口 id。 */
  pinScreenshot: (input: { dataUrl: string; name?: string; width?: number; height?: number }) => Promise<{ ok: boolean; id?: string; error?: string }>
  closePinnedShot: (id: string) => void
  /** 拉起框选叠层并进入滚动长截图模式（用户停手后自动拼成一张长图）。 */
  triggerScrollCapture: (target?: ScreenshotTarget) => void
  /** 应用内框选：确认/取消（叠层窗口自己调）。 */
  completeSnip: (region: ScreenshotSnipRegion) => void
  cancelSnip: () => void
  /** 叠层渲染层挂载完成后再取配置，避免 did-finish-load 早于 React listener 导致首帧丢配置。 */
  snipReady: () => void
  onSnipConfig: (cb: (config: { displayId: string; scaleFactor: number; width: number; height: number; mode?: 'snip' | 'scroll' }) => void) => () => void
  /** 滚动截图：开进度小窗、上报进度、接收小窗动作、小窗订阅状态。 */
  openScrollHud: () => void
  updateScrollHud: (state: ScrollHudState) => void
  onScrollHudState: (cb: (state: ScrollHudState) => void) => () => void
  onScrollHudAction: (cb: (action: 'finish' | 'cancel') => void) => () => void
  /** 小窗上的完成/取消按钮。 */
  scrollHudAction: (action: 'finish' | 'cancel') => void
  /** 钉屏窗口接收载荷（浮窗是"主渲染层算、浮窗只显示"的推送模式）。 */
  onPinnedShot: (cb: (payload: PinnedShotPayload) => void) => () => void
  /** 免对话框快速保存：直接落到「图片/Agentic-Island」，并在同一次操作里可复制。 */
  saveImageQuick: (dataUrl: string, name: string, format: string) => Promise<{ ok: boolean; path?: string; width?: number; height?: number; error?: string }>
  /** 把截图放进应用历史（不占「图片」目录，重启后仍可回看）。 */
  archiveScreenshot: (dataUrl: string, name: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  /** 最近截图（缩略图 + 原始像素尺寸），供工坊历史条使用。 */
  screenshotHistory: (limit?: number) => Promise<{ ok: boolean; entries?: ScreenshotHistoryEntry[]; dir?: string; error?: string }>
  /** 按历史路径读回原图（仅限历史目录内的图片）。 */
  readScreenshotHistory: (path: string) => Promise<{ ok: boolean; dataUrl?: string; name?: string; error?: string }>
  /** 在资源管理器中定位历史截图。 */
  revealScreenshotHistory: (path: string) => Promise<{ ok: boolean; error?: string }>
  /** 从本地选择一张图片进入截图工坊 */
  openImageFile: () => Promise<{ ok: boolean; dataUrl?: string; name?: string; error?: string }>
  /** 从系统剪贴板读取图片 */
  readClipboardImage: () => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  /** 拉取并解析飞书日历 ICS 订阅链接 */
  fetchCalendar: (url: string) => Promise<{ ok: boolean; events?: CalendarEvent[]; error?: string }>
  /** 抓取网页正文纯文本（灵感便签：丢链接给 AI 整理） */
  fetchUrlText: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  /** 飞书日历 CalDAV 同步（官方支持：设置→日历→CalDAV 同步生成账号） */
  fetchCaldav: (cfg: { server: string; username: string; password: string }) => Promise<{ ok: boolean; events?: CalendarEvent[]; error?: string }>
  /** 屏幕理解：截取主屏返回 dataURL（先自动藏岛） */
  /** 截图第一步：藏岛 + 严格匹配"光标所在显示器"的采集源（不匹配就报错，不静默换屏）。 */
  prepareScreenCapture: () => Promise<ScreenCapturePrepare>
  /** 截图第二步：还原岛的显示状态（成功失败都要调）。 */
  finishScreenCapture: () => Promise<{ ok: boolean }>
  /** 全局热键请求截图：主进程只转发，抓帧在渲染层。 */
  onScreenCaptureRequested: (cb: (capture: { target: ScreenshotTarget; region?: ScreenshotSnipRegion }) => void) => () => void
  /** 全局热键直接打开录屏工坊（Ctrl+Alt+R）。 */
  onOpenRecorder: (cb: () => void) => () => void
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
  /** 使用系统目录选择器选择工作文件夹 */
  pickDirectory: (initialPath?: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** 系统正在播放的媒体（SMTC：标题/歌手/播放态/封面），无播放返回 null */
  mediaInfo: () => Promise<{ title: string; artist: string; playing: boolean; thumb: string } | null>
  /** 按曲名+歌手拉取 LRC 歌词（lrclib.net，失败返回 ok:false） */
  lyricsFetch: (title: string, artist: string) => Promise<{ ok: boolean; lrc?: string; plain?: string }>
  /** 媒体键：playpause / next / prev / volup / voldown */
  mediaKey: (cmd: string) => void
  /** 内嵌真 PTY 终端（ConPTY PowerShell，多标签）：与本地终端同源，TUI/交互式 CLI 原生支持 */
  ptyEnsure: (id: string, cols: number, rows: number, cwd?: string, profile?: TerminalShellProfile, env?: Record<string, string>) => Promise<boolean>
  ptyInput: (id: string, data: string) => void
  ptyResize: (id: string, cols: number, rows: number) => void
  ptyKill: (id: string) => void
  onPtyData: (cb: (id: string, data: string) => void) => () => void
  /** 加密持久化的终端开发现场（标签、目录、历史、可选输出快照）。 */
  loadTerminalWorkspace: () => Promise<TerminalWorkspaceState>
  saveTerminalWorkspace: (state: TerminalWorkspaceState) => void
  clearTerminalSnapshots: () => Promise<TerminalWorkspaceState>
  /** 结构化扫描当前项目可运行任务与基础健康状态。 */
  inspectTerminalProject: (cwd: string) => Promise<TerminalProjectInspection>
  exportTerminalWorkspace: (state: TerminalWorkspaceState) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  importTerminalWorkspace: () => Promise<{ ok: boolean; state?: TerminalWorkspaceState; canceled?: boolean; error?: string }>
  /** Electron 35+ 中从拖入的 File 安全获取本地路径。 */
  pathForFile: (file: unknown) => string
  /** 剪贴板变化推送（clipWatch 开启时主进程轮询文本与图片） */
  onClipboard: (cb: (item: { kind: 'text' | 'image'; text?: string; dataUrl?: string }) => void) => () => void
  /** 托盘"展开灵动岛"事件 */
  onReveal: (cb: () => void) => () => void
  /** 退出应用 */
  quitApp: () => void
  // ===== Super-Agent（后台自主循环：监控 + 拍板）=====
  /** 拉取当前快照（也用于手动刷新） */
  superSnapshot: () => Promise<SuperAgentSnapshot>
  /** 快照变化推送（主进程事件驱动，渲染层零轮询） */
  onSuperSnapshot: (cb: (snap: SuperAgentSnapshot) => void) => () => void
  /** 回答待拍板卡片：choice=选项下标，或 text=自由回答 */
  superAnswer: (provider: string, cardId: number, choice?: number, text?: string) => Promise<SuperActionResult>
  /** 结案一张卡片（无需决定） */
  superResolve: (provider: string, cardId: number, reason: string) => Promise<SuperActionResult>
  /** 停掉进行中的一轮 */
  superStopRun: (provider: string, runId: number) => Promise<SuperActionResult>
  /** 规则动作：暂停/恢复/立即运行（run 会触发真实 Agent 执行，渲染层须二次确认） */
  superRuleAction: (provider: string, rule: string, action: 'pause' | 'resume' | 'run', opts?: { reason?: string }) => Promise<SuperActionResult>
  /** 补跑：把暂停期间跳过、尚未补跑的事件原样交给这条规则（since = 那次暂停的起点） */
  superRuleReplay: (provider: string, rule: string, since: string) => Promise<SuperActionResult>
  /** 历史分页：加载更早的轮次（中台一次给 60 轮，首页之外按 nextBefore 往前翻） */
  superHistoryMore: (provider: string) => Promise<{ ok: boolean; items?: SuperHistoryItem[]; nextBefore?: number | null; error?: string }>
  /** 一轮的来龙去脉时间线 */
  superWhy: (provider: string, runId: number) => Promise<{ ok: boolean; lines?: SuperWhyLine[]; error?: string }>
  // ===== 可视化编排（读写 rules.json，官方 check 校验）=====
  /** 读规则文件（本机中台；远程中台不支持文件编辑） */
  superRulesRead: () => Promise<SuperRulesResult>
  /** 用官方 `agent-autoloop check` 校验一份草稿（不碰运行中的中台） */
  superRulesValidate: (json: string) => Promise<{ ok: boolean; error?: string }>
  /** 保存规则（写前自动 check + 备份原文件；几秒内中台自动生效） */
  superRulesSave: (json: string) => Promise<SuperRulesResult>
  /** 新建一份最小规则模板（拒绝覆盖已存在的文件） */
  superRulesCreate: () => Promise<SuperRulesResult>
  // 配置持久化
  loadState: () => Promise<Record<string, unknown> | null>
  saveState: (state: Record<string, unknown>) => void
}
