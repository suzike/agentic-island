// 渲染层内部数据模型（聊天/附件/富文本块）。移植自原型的 threads/composers/blocks 结构。

import type { AgentState } from '../../shared/protocol'

/** 岛内 Agent 视图模型：真实快照 + demo 演示态统一表示 */
export interface AgentVM extends AgentState {
  demo?: boolean
}

/** 待办事项：到时自动弹岛提醒 */
export interface TodoItem {
  id: number
  text: string
  /** 截止/提醒时间（毫秒时间戳），可空=无定时 */
  due?: number
  done: boolean
  /** 已弹过提醒（防重复响铃） */
  notified?: boolean
  /** 优先级：1=紧急 2=重要 3=普通（默认） */
  priority?: 1 | 2 | 3
  /** 看板状态：未设时由 done 推导（done→已完成，否则待办） */
  status?: 'todo' | 'doing' | 'done'
  /** 重复提醒：到时后自动顺延 */
  repeat?: 'none' | 'daily' | 'weekly'
  /** 备注/描述（多行，支持链接） */
  note?: string
  /** 子任务清单 */
  subs?: { id: number; text: string; done: boolean }[]
  /** 置顶 */
  pinned?: boolean
  /** 完成时间（用于"已完成"视图展示） */
  doneAt?: number
  /** 标签（分类/项目/@场景） */
  tags?: string[]
  /** 所属项目/工作流；与标签分离，用于项目进度与容量统计 */
  project?: string
  /** 作战台项目稳定标识；project 字段继续保留用于兼容旧数据与展示 */
  projectId?: string
  /** 执行所需精力：深度工作 / 常规 / 轻量 */
  energy?: 'deep' | 'normal' | 'light'
  /** 阻塞原因或前置依赖；非空时不进入自动执行队列 */
  blockedBy?: string
  /** 可验证的完成标准 */
  acceptance?: string
  /** 预估耗时（分钟） */
  estimate?: number
  /** 累计专注/投入时长（分钟） */
  spent?: number
  /** 归档（从主列表隐藏但不删） */
  archived?: boolean
  /** 列表内手动排序权重（越小越靠前；未设时按分组默认排序） */
  order?: number
  createdAt: number
}

export type BlockType = 'h' | 'p' | 'ul' | 'code' | 'note' | 'think' | 'steps'

export interface Block {
  t: BlockType
  text?: string
  items?: string[]
  /** t='steps'：本地 Agent 的工具/技能/MCP 执行步骤（完成态时间线） */
  steps?: AgentStep[]
}

/** 本地 Agent 执行步骤（工具 / 技能 / MCP / 命令） */
export interface AgentStep {
  label: string
  detail?: string
  done?: boolean
}

/** 本地 Agent 流式进行中的实时状态（挂在 agent 消息上，完成后转为 blocks） */
export interface AgentLive {
  engine: 'claude' | 'codex'
  /** 已累计的思考过程（流式）；有正文/步骤后 UI 自动折叠 */
  think: string
  steps: AgentStep[]
  /** 已累计的回答正文（流式） */
  text: string
  /** 端点初始化信息（模型 · 工具数 · MCP 数） */
  status?: string
}

export interface Attachment {
  type: 'screenshot' | 'file'
  name: string
  thumb?: string
  /** 文本文件的真实内容（发送时拼进提问） */
  content?: string
  /** 图片的 dataURL（发给视觉模型） */
  dataUrl?: string
}

/** 引用追问：选中 AI 回复的片段 + 可选疑问，作为下一轮对话的上下文 */
export interface QuoteRef {
  id: number
  /** 选中的原文片段 */
  text: string
  /** 针对该片段的疑问/备注（可空） */
  note?: string
}

export interface ChatMessage {
  role: 'user' | 'agent'
  text?: string
  attachments?: Attachment[]
  blocks?: Block[]
  typing?: boolean
  /** 消息时间戳 */
  ts?: number
  /** 本条用户消息携带的引用片段（发送时从输入区带上） */
  quotes?: QuoteRef[]
  /** 就地追问子线程：嵌套在本条回答气泡内的 Q&A（交替 user/agent），上下文仍含整段主对话 */
  followups?: ChatMessage[]
  /** 本地 Agent 流式进行中：思考/步骤/正文实时更新，完成后此字段清除、转为 blocks */
  live?: AgentLive
}

export interface Composer {
  text: string
  attachments: Attachment[]
  recording: boolean
  recTime: string
}

/** 问答历史会话（归档的对话） */
export interface AskSession {
  id: number
  title: string
  msgs: ChatMessage[]
}

/** 资讯、待办和快捷执行共享的项目上下文。 */
export interface WorkbenchProject {
  id: string
  name: string
  repoPath?: string
  objective?: string
  status: 'active' | 'paused' | 'done'
  colorHue: number
  createdAt: number
  updatedAt: number
}

/** 快捷工作流的一次可追溯执行。 */
export interface WorkflowRun {
  id: string
  shortcutId: string
  shortcutName: string
  projectId?: string
  repoPath?: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  stepCount: number
  completedSteps: number
  summary?: string
}

/** 资讯、待办和快捷运行共同产出的成果引用。 */
export interface WorkArtifact {
  id: string
  projectId?: string
  source: 'news' | 'todo' | 'workflow'
  sourceId: string
  kind: 'brief' | 'signal' | 'plan' | 'decision' | 'report' | 'run-log'
  title: string
  content: string
  createdAt: number
}

/** 问答快捷指令（用户可增删改，持久化） */
export interface QuickPrompt {
  id: number
  icon: string
  label: string
  /** 点击后回填输入框的内容模板 */
  text: string
}

/** 常驻迷你条的自定义配置（持久化） */
export interface BarConfig {
  /** 启用的内容模式：quotes 名言 / exp 开发经验 / custom AI 个性语录 / flow 流动光带 / eq 跳动律动 / neon 霓虹脉冲 / pet 小宠物 */
  modes: string[]
  /** 颜色：theme 跟随主题 / rainbow 多彩 / custom 自定义色相 */
  colorMode: 'theme' | 'rainbow' | 'custom'
  /** 自定义色相（0-360，colorMode=custom 时生效） */
  hue: number
  /** 小宠物 emoji */
  petEmoji: string
  /** AI 生成的个性语录（基于你的问答/便签/待办提炼） */
  customQuotes: string[]
  /** 迷你条宽度（px，240–880，超长文本自动滚动展示） */
  width: number
  /** 用户自定义轮播主题（AI 每 10 分钟按 hint 生成一批内容） */
  customTopics?: { id: number; name: string; hint: string }[]
  /** AI 每 10 分钟自动刷新内容池 */
  aiRefresh?: boolean
}

export const DEFAULT_BAR_CONFIG: BarConfig = {
  modes: ['quotes', 'flow', 'eq'],
  colorMode: 'theme',
  hue: 200,
  petEmoji: '🐈',
  customQuotes: [],
  width: 330
}

/** 剪贴板历史项（文本或图片；tag 自动识别；fav 收藏可持久化，其余仅内存） */
export interface ClipItem {
  id: number
  kind: 'text' | 'image'
  text?: string
  dataUrl?: string
  /** 自动类型：链接 / 代码 / JSON / 报错 / 表格 / 颜色 / 文本 / 图片 */
  tag: string
  fav?: boolean
  ts: number
}

/** RSS 订阅源 */
export interface FeedSource {
  id: string
  name: string
  url: string
  enabled: boolean
}

/** 资讯条目（AI 增强：价值分/一句话点评/自动分类） */
export interface FeedItem {
  /** 链接哈希（去重键） */
  id: string
  sourceName: string
  title: string
  link: string
  pubDate: number
  desc?: string
  /** AI 价值分 0-100 */
  score?: number
  /** AI 一句话有观点的点评 */
  brief?: string
  /** AI 详细总结（流水线基于全文生成，Markdown，缓存） */
  summary?: string
  /** 流水线已处理完（抓全文→评分→总结） */
  processed?: boolean
  /** AI 分类：模型/产品/行业/论文/技巧/开发/其它 */
  tag?: string
  read?: boolean
  fav?: boolean
  /** 项目情报归属；一条资讯可服务多个项目 */
  projectIds?: string[]
  /** 情报处置状态 */
  signalStatus?: 'tracking' | 'actioned' | 'dismissed'
  /** 对当前工作的影响等级与兑现时间 */
  impact?: 'low' | 'medium' | 'high'
  horizon?: 'now' | 'soon' | 'later'
  actionNote?: string
}

/** 资讯观察清单：关键词命中后自动进入观察结果，不影响原订阅和精选。 */
export interface NewsWatch {
  id: string
  name: string
  keywords: string[]
  excludes?: string[]
  projectId?: string
  minScore: number
  enabled: boolean
  createdAt: number
}

/** 灵感便签：AI 生成或手动创建的知识卡片（Markdown 正文 + 标签 + 配色） */
export interface StickyNote {
  id: number
  emoji: string
  title: string
  /** Markdown 正文（支持标题/列表/代码/链接/图片外链） */
  md: string
  /** 配色 key（logic/noteAi.ts 的 NOTE_COLORS） */
  color: string
  tags: string[]
  pinned?: boolean
  /** 收藏星标（与置顶独立） */
  starred?: boolean
  /** 软删除到回收站 */
  trashed?: boolean
  /** 锁定：防误编辑/误删（需先解锁） */
  locked?: boolean
  /** 稍后读队列标记 */
  later?: boolean
  /** 来源（网页链接/文件名，可空） */
  source?: string
  createdAt: number
  updatedAt: number
}

/** 活动流水：Agent 会话在岛内出现时留存一条（易逝快照 → 当天可复盘）。按会话 id 去重、增量更新。 */
export interface ActivityEntry {
  /** Agent 会话 id（backend:sessionId），去重键 */
  id: string
  /** 首次出现时间（毫秒） */
  ts: number
  /** 最近更新时间 */
  updatedAt: number
  /** 展示用工具名，如 "Claude Code CLI" */
  tool: string
  /** 项目短名 */
  proj: string
  /** 最近一句活动描述 */
  detail: string
  /** git 变更小结（若采集到） */
  files?: number
  added?: number
  removed?: number
  commit?: string
}

export const emptyComposer = (): Composer => ({
  text: '',
  attachments: [],
  recording: false,
  recTime: '0:00'
})

/** Island Chat 组件的入参 */
export interface ChatProps {
  messages: ChatMessage[]
  composer: Composer
  placeholder: string
  /** 消息区最大高度（默认 230；问答区更高、大尺寸下自适应） */
  maxH?: number | string
  quickReplies?: string[]
  onQuick?: (t: string) => void
  onText: (v: string) => void
  onSend: () => void
  onAttach: (type: 'screenshot' | 'file', payload?: { name?: string; thumb?: string; content?: string; dataUrl?: string }) => void
  onRecord?: (v: boolean) => void
  onRemoveAtt: (i: number) => void
  /** 引用追问：开启后可框选 AI 回复片段 → 备注 → 作为引用贴入输入区 */
  enableQuote?: boolean
  /** 就地追问：在第 msgIndex 条回答气泡内追问；问答嵌套显示在该气泡内，上下文仍含整段主对话 */
  onFollowUp?: (msgIndex: number, text: string) => void
  /** 输入区当前待发送的引用片段 */
  quotes?: QuoteRef[]
  onAddQuote?: (q: { text: string; note?: string }) => void
  onRemoveQuote?: (id: number) => void
}
