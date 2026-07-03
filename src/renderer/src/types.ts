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
  createdAt: number
}

export type BlockType = 'h' | 'p' | 'ul' | 'code' | 'note' | 'think'

export interface Block {
  t: BlockType
  text?: string
  items?: string[]
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
  /** 来源（网页链接/文件名，可空） */
  source?: string
  createdAt: number
  updatedAt: number
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
  /** 输入区当前待发送的引用片段 */
  quotes?: QuoteRef[]
  onAddQuote?: (q: { text: string; note?: string }) => void
  onRemoveQuote?: (id: number) => void
}
