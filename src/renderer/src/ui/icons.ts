// 语义图标表：全岛统一 lucide-react 图标（替换 emoji），尺寸 14/16、strokeWidth 1.75。
// 通过语义名引用，后续换图标只改这里。
import {
  AlarmClock,
  BarChart3,
  Bell,
  Bot,
  Brain,
  Calculator,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Flag,
  FolderGit2,
  History,
  Hourglass,
  Inbox,
  Keyboard,
  LayoutGrid,
  Library,
  Lightbulb,
  ListTodo,
  Loader2,
  MessageSquare,
  Mic,
  Minus,
  Moon,
  Newspaper,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Rss,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Tag,
  Terminal,
  Timer,
  Trash2,
  TrendingUp,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** 语义图标映射：名字即用途 */
export const Ico = {
  // Agent 状态
  running: Loader2, // 运行中（配合 spin 动画）
  waiting: Hourglass, // 等待回复
  approval: ShieldAlert, // 待审批
  done: CheckCircle2, // 已完成
  idle: Circle, // 静默
  agent: Bot, // Agent 会话
  cli: Terminal, // CLI 终端来源

  // 分区
  plan: ClipboardList, // Plan 审阅
  ask: MessageSquare, // 问答
  shortcuts: Zap, // 快捷
  todos: ListTodo, // 待办
  notes: StickyNote, // 灵感便签
  news: Newspaper, // 资讯
  review: BarChart3, // 复盘
  repos: FolderGit2, // 仓库
  term: Terminal, // 终端
  settings: Settings, // 设置

  // 通用动作
  add: Plus,
  close: X,
  minimize: Minus,
  search: Search,
  send: Send,
  attach: Paperclip,
  refresh: RefreshCw,
  copy: Copy,
  edit: Pencil,
  del: Trash2,
  pin: Pin,
  play: Play,
  pause: Pause,
  stop: Square,
  expand: ChevronDown,
  collapse: ChevronRight,
  link: ExternalLink,
  mic: Mic,

  // 语义/修饰
  ai: Sparkles, // AI 能力标识
  magic: Wand2, // 智能编排
  clock: Clock, // 时间
  timer: Timer, // 番茄钟/计时
  alarm: AlarmClock, // 提醒
  calendar: CalendarClock, // 日程
  bell: Bell, // 通知
  flag: Flag, // 优先级
  tag: Tag, // 标签
  dot: CircleDot, // 状态点
  focus: Moon, // 专注模式
  trend: TrendingUp, // 趋势/统计
  idea: Lightbulb, // 灵感
  inbox: Inbox, // 收集箱
  history: History, // 历史
  star: Star, // 收藏/精选
  radar: Radar, // 雷达观察
  rss: Rss, // 订阅源
  brain: Brain, // 知识脑
  kb: Library, // 知识库
  calc: Calculator, // 计算器
  shot: Camera, // 截图
  grid: LayoutGrid, // 看板/布局
  keyboard: Keyboard, // 快捷键
} as const

export type IconName = keyof typeof Ico

export type { LucideIcon }
