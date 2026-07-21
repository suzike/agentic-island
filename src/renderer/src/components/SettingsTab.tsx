// Settings 分区 —— 设计系统重做：surface.section 分区卡片 + SectionHeader + 共享 Switch/Slider/Chip/Button/Input。
// 交互逻辑（hooks 接入 / 声效选择 / 显示器选择 / LLM 配置 / 日历 / 迷你条自定义）全部保持不变。

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, CalendarClock, ChevronDown, GlassWater, MessageSquare, Minus, PanelTop, Palette, RefreshCw,
  Moon, Pencil, Play, Plug, Plus, Power, Settings2, Sparkles, Sun, Terminal, TimerReset, TriangleAlert,
  Waves, Wind, Wrench, X, Zap
} from 'lucide-react'
import type { DisplayInfo, RuntimeInfo } from '../../../shared/protocol'
import type { BarConfig } from '../types'
import { SOUNDS, SOUND_TYPES, type SoundMap } from '../logic/sounds'
import { PROVIDERS, providerConfigEquals, type ProviderSettingsSnapshot } from '../logic/providers'
import { normalizeThemeTokens, THEMES, type ThemeDef } from '../logic/themes'
import { Badge, Button, Chip, Group, IconButton, Input, SectionHeader, Segmented, Slider, Switch } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, separatorRow, SP, surface, text } from '../ui/tokens'
import type { LucideIcon } from '../ui/icons'

export interface LlmState extends ProviderSettingsSnapshot {
  open: boolean
  testStatus: 'idle' | 'testing' | 'ok' | 'fail'
  testMsg: string
}

export interface SettingsFlags {
  autostart: boolean
  multiMonitor: boolean
  largeSize: boolean
  sound: boolean
  silentBg: boolean
  autoConnect: boolean
  claudeCli: boolean
  claudeApp: boolean
  codexCli: boolean
  codexApp: boolean
  /** 剪贴板助手（历史仅内存，问答区 📋 面板 AI 一键分析） */
  clipWatch: boolean
  /** 常驻迷你条：岛收起后保留一条小状态条（名言/动态光带轮播）；关闭则完全收回 */
  ambientBar: boolean
  /** 智能勿扰：检测到麦克风/摄像头占用（≈会议中）时自动静默弹窗与提示音 */
  meetingDnd: boolean
  /** 桌面挂件：独立小窗常驻桌面角，速览番茄/待办/Agent/媒体 */
  desktopWidget: boolean
  /** 自动化规则（当X则Y，本地触发） */
  ruleMorning: boolean
  ruleEvening: boolean
  rulePomoCapsule: boolean
  ruleMeetingNote: boolean
}

interface SettingsTabProps {
  runtimeInfo: RuntimeInfo | null
  bridgeConnected: boolean
  activeAgents: number
  totalAgents: number
  settings: SettingsFlags
  onToggle: (k: keyof SettingsFlags) => void
  /** 按通知类型的声效映射（等待回复/一般审批/危险审批/待办会议） */
  soundMap: SoundMap
  soundPickerOpen: boolean
  onToggleSoundPicker: () => void
  onSetSound: (type: keyof SoundMap, key: string) => void
  onPreviewSound: (e: React.MouseEvent, k: string) => void
  activeMonitor: number
  /** 真实显示器列表（主进程 get-displays） */
  displays: DisplayInfo[]
  monitorPreviewOpen: boolean
  onToggleMonitorPreview: () => void
  onSetMonitor: (n: number) => void
  llm: LlmState
  onToggleLlm: () => void
  onSetProvider: (k: string) => void
  onSetLlmField: (f: 'model' | 'baseUrl' | 'apiKey', v: string) => void
  /** 型号列表：新增（并设为当前）/ 删除 / 点选设为当前 */
  onAddModel: (name: string) => void
  onRemoveModel: (name: string) => void
  onPickModel: (name: string) => void
  onSyncLlmModels: () => void
  onTestLlm: () => void
  onSaveLlm: () => void
  onLoadLlm: (id: number) => void
  onDeleteLlm: (id: number) => void
  onInstallHooks: () => void
  onUninstallHooks: () => void
  theme: string
  onSetTheme: (key: string) => void
  /** 用户自定义主题 + 设计器 */
  customThemes: ThemeDef[]
  onOpenThemeDesigner: () => void
  onDeleteCustomTheme: (key: string) => void
  /** 二次编辑自定义主题（打开设计器带入该主题令牌） */
  onEditTheme: (key: string) => void
  /** 飞书日历 ICS 订阅链接 + 同步状态 */
  icsUrl: string
  onSetIcsUrl: (v: string) => void
  calMsg: string
  /** 飞书日历 CalDAV（官方支持的同步方式，主通道） */
  caldav: { server: string; username: string; password: string }
  onSetCaldav: (v: { server: string; username: string; password: string }) => void
  /** 常驻迷你条自定义 */
  barCfg: BarConfig
  onSetBarCfg: (v: BarConfig) => void
  onAiBarQuotes: () => Promise<string>
  /** 立即生成迷你条 AI 内容池（名言/经验/方法论/热管理/自定义主题） */
  onRefreshBarContent: () => Promise<string>
  /** 灵动岛整体宽度（标准模式，380–880；迷你条同步） */
  islandWidth: number
  onSetIslandWidth: (w: number) => void
  /** 界面字体与缩放（清晰度） */
  fontChoice: string
  onSetFontChoice: (k: string) => void
  uiZoom: number
  onSetUiZoom: (z: number) => void
  /** 退出应用（托盘菜单也可退出） */
  onQuitApp: () => void
}

const FONT_OPTIONS: { key: string; label: string }[] = [
  { key: 'default', label: '默认（Segoe UI）' },
  { key: 'yahei', label: '微软雅黑 UI' },
  { key: 'harmony', label: '鸿蒙 / MiSans' },
  { key: 'noto', label: '思源黑体' }
]

/** 迷你条内容模式 */
const BAR_MODES: { key: string; label: string }[] = [
  { key: 'brief', label: '智能简报' },
  { key: 'clock', label: '时钟' },
  { key: 'quotes', label: '名人名言' },
  { key: 'exp', label: '开发经验' },
  { key: 'agent', label: 'AI Agent 方法论' },
  { key: 'thermal', label: '热管理/Simulink' },
  { key: 'github', label: 'GitHub 热门' },
  { key: 'custom', label: '自定义主题' },
  { key: 'music', label: '正在播放 ♪' },
  { key: 'flow', label: '流动光带' },
  { key: 'eq', label: '跳动律动' },
  { key: 'neon', label: '霓虹脉冲' },
  { key: 'pet', label: '小宠物' }
]
const BAR_APPEARANCES = [
  { key: 'glass', label: '玻璃', icon: GlassWater },
  { key: 'solid', label: '实体', icon: PanelTop },
  { key: 'minimal', label: '极简', icon: Minus }
] as const
const BAR_MOTIONS = [
  { key: 'calm', label: '舒缓', icon: Wind },
  { key: 'balanced', label: '平衡', icon: Waves },
  { key: 'lively', label: '灵动', icon: Sparkles }
] as const
const PETS = ['🐈', '🐕', '🦊', '🐰', '🐢', '🦆']

const GENERAL: { key: keyof SettingsFlags; label: string; desc: string }[] = [
  { key: 'autostart', label: '开机自启', desc: '登录 Windows 时自动在后台运行' },
  { key: 'multiMonitor', label: '跟随鼠标所在显示器', desc: '开启后随鼠标切换显示器；关闭则固定在下方选中的显示器' },
  { key: 'largeSize', label: '大尺寸工作台', desc: '更大的面板与内容区，适合待办 / 问答等重度使用' },
  { key: 'sound', label: '声音提醒', desc: '需要处理时播放提示音' },
  { key: 'silentBg', label: '空闲时完全静默', desc: '无待办时隐藏胶囊' },
  { key: 'clipWatch', label: '剪贴板助手', desc: '记录剪贴板历史（仅内存不落盘），问答区 📋 面板可一键翻译/解释/清洗' },
  { key: 'ambientBar', label: '常驻迷你条', desc: '岛收起后保留实时状态舱与动态内容条；关闭则完全收回' },
  { key: 'meetingDnd', label: '智能勿扰（会议自动静默）', desc: '检测到麦克风/摄像头被占用（≈正在开会/录屏）时，自动不弹窗、不响铃；会议结束自动恢复' },
  { key: 'desktopWidget', label: '桌面挂件小窗', desc: '在桌面右下角常驻一个可拖动小窗，速览番茄钟 / 到期待办 / Agent / 正在播放；点「展开」回主岛' }
]

// 自动化规则：当 X 则 Y（本地触发，纯自用不打扰主力工作流）
const AUTOMATION: { key: keyof SettingsFlags; label: string; desc: string }[] = [
  { key: 'ruleMorning', label: '晨间简报 · 每天首次唤醒', desc: '每天第一次展开灵动岛时，自动生成"今日作战地图"晨间简报' },
  { key: 'ruleEvening', label: '晚间复盘草稿 · 每天 20:00', desc: '每天晚上 8 点自动生成今日复盘草稿，等你回来查看' },
  { key: 'rulePomoCapsule', label: '番茄结束记录', desc: '每个专注番茄结束后自动弹出闪念胶囊，趁热记下进展' },
  { key: 'ruleMeetingNote', label: '会议结束提醒', desc: '检测到会议结束时，提示把要点记成便签' }
]

const TOOLS: { key: keyof SettingsFlags; label: string }[] = [
  { key: 'claudeCli', label: 'Claude Code CLI' },
  { key: 'claudeApp', label: 'Claude Code 桌面端' },
  { key: 'codexCli', label: 'Codex CLI' },
  { key: 'codexApp', label: 'Codex 桌面端' }
]

/** 分区卡片：主页面切换时直接显示，避免内部图标随透明度入场闪烁。 */
function Section(props: { icon?: LucideIcon; title: React.ReactNode; extra?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <motion.section
      variants={fadeScaleIn}
      initial={false}
      animate="animate"
      style={{ ...surface.section(), padding: `${SP.md}px ${SP.md + 2}px` }}
    >
      <SectionHeader icon={props.icon} title={props.title} extra={props.extra} style={{ marginBottom: SP.md }} />
      {props.children}
    </motion.section>
  )
}

/** 可折叠分区：整行标题可点击（chevron + 右侧摘要） */
function CollapsibleSection(props: {
  icon?: LucideIcon
  title: React.ReactNode
  summary?: React.ReactNode
  open: boolean
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <motion.section
      variants={fadeScaleIn}
      initial={false}
      animate="animate"
      style={{ ...surface.section(), padding: `${SP.md}px ${SP.md + 2}px` }}
    >
      <div onClick={props.onToggle} style={{ cursor: 'pointer' }}>
        <SectionHeader
          icon={props.icon}
          title={props.title}
          style={{ marginBottom: props.open ? SP.md : 0 }}
          extra={
            <>
              {props.summary}
              <ChevronDown size={12} strokeWidth={2} style={{ color: ink(3), flex: 'none', transition: 'transform .2s', transform: props.open ? 'rotate(180deg)' : undefined }} />
            </>
          }
        />
      </div>
      {props.open && props.children}
    </motion.section>
  )
}

/** 组内小标签 */
const labelSm: React.CSSProperties = { fontSize: FS.tiny, fontWeight: 600, color: ink(2) }
const endpointHost = (baseUrl: string): string => {
  try { return new URL(baseUrl).host || baseUrl }
  catch { return baseUrl }
}

/** 密码类输入框（共享 Input 不支持 type=password）——样式与 surface.inset 对齐 */
const secretInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  ...surface.inset(),
  color: ink(1),
  fontSize: FS.small,
  fontFamily: "'Cascadia Code', Consolas, ui-monospace, monospace",
  padding: '7px 10px',
  outline: 'none'
}

export function SettingsTab(p: SettingsTabProps): React.JSX.Element {
  const [hookMsg, setHookMsg] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  // ICS 链接草稿：点「保存并同步」才生效，避免每敲一个字符就触发拉取
  const [icsDraft, setIcsDraft] = useState(p.icsUrl)
  useEffect(() => setIcsDraft(p.icsUrl), [p.icsUrl])
  const [calOpen, setCalOpen] = useState(false)
  const [barOpen, setBarOpen] = useState(false)
  const [barAiMsg, setBarAiMsg] = useState('')
  const [topicName, setTopicName] = useState('')
  const [topicHint, setTopicHint] = useState('')
  // CalDAV 草稿：点「保存并同步」才生效
  const [cdDraft, setCdDraft] = useState(p.caldav)
  useEffect(() => setCdDraft(p.caldav), [p.caldav])
  const enabledTools = TOOLS.filter((t) => p.settings[t.key]).length
  const activeProvider = PROVIDERS.find((x) => x.key === p.llm.provider) || PROVIDERS[0]
  const providerLabel = activeProvider.label
  const llmSummary = `${providerLabel} · ${p.llm.model || '未设置'}`
  const statusItems = [
    {
      label: 'Agent 桥接',
      ok: p.bridgeConnected,
      detail: p.bridgeConnected ? `${p.activeAgents} 个活动 · ${p.totalAgents} 个会话` : '连接异常'
    },
    {
      label: '安全隔离',
      ok: !!p.runtimeInfo?.security.sandbox && !!p.runtimeInfo?.security.contextIsolation && !p.runtimeInfo?.security.nodeIntegration,
      detail: p.runtimeInfo ? '沙箱与上下文隔离已启用' : '正在读取'
    },
    {
      label: '问答模型',
      ok: !!p.llm.apiKey && !!p.llm.model,
      detail: p.llm.apiKey && p.llm.model ? p.llm.model : '尚未完成配置'
    },
    {
      label: '日历同步',
      ok: !!(p.caldav.server && p.caldav.username && p.caldav.password) || !!p.icsUrl,
      detail: p.caldav.server ? 'CalDAV 已配置' : p.icsUrl ? 'ICS 已配置' : '尚未配置'
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.lg }}>
      {/* 运行状态：把版本和关键链路从后台实现变成用户可见的健康度。 */}
      <Section
        icon={Activity}
        title="运行状态"
        extra={
          <span style={{ ...text.mono(FS.tiny), color: ink(3) }}>
            v{p.runtimeInfo?.version || '…'} · {p.runtimeInfo?.packaged ? '安装版' : '开发版'}
          </span>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px' }}>
          {statusItems.map((item) => {
            const c = item.ok ? sem.calm : sem.warn
            return (
              <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '8px minmax(0, 1fr)', columnGap: 8, alignItems: 'start', minWidth: 0 }}>
                <span style={{ width: 7, height: 7, marginTop: 5, borderRadius: 999, background: c, boxShadow: `0 0 8px ${semBg(c, 0.45)}` }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...text.body(), fontSize: FS.small, fontWeight: 650 }}>{item.label}</div>
                  <div title={item.detail} style={{ ...text.faint(), fontSize: 10, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* 主题 */}
      <Section
        icon={Palette}
        title="灵动岛主题"
        extra={<Button sm variant="ghost" icon={Sparkles} onClick={p.onOpenThemeDesigner}>自定义主题</Button>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP.sm }}>
          {[...p.customThemes, ...THEMES].map((t) => {
            const sel = p.theme === t.key
            const custom = t.key.startsWith('custom-')
            const tk = normalizeThemeTokens(t)
            const light = tk.mode === 'light'
            return (
              <div
                key={t.key}
                className="hv"
                onClick={() => p.onSetTheme(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, minHeight: t.tags?.length ? 68 : 54, padding: '8px 9px', borderRadius: R.lg, cursor: 'pointer', position: 'relative',
                  transition: 'background .18s, box-shadow .18s',
                  background: sel ? semBg(accent(), 0.13) : fill(2),
                  boxShadow: sel ? `0 4px 14px -8px ${accent(0.7, 0.4)}` : 'none'
                }}
              >
                <div style={{ width: 48, height: 38, padding: 4, boxSizing: 'border-box', flex: 'none', borderRadius: R.sm, background: `linear-gradient(${tk.gr}deg, oklch(${Math.min(.96, +tk.bg + .07)} ${tk.sc} ${tk.ths} / ${tk.ga}), oklch(${tk.bg} ${tk.sc} ${tk.ths} / ${tk.ga}))`, border: `0.5px solid ${light ? 'rgba(20,35,65,.12)' : 'rgba(255,255,255,.12)'}`, boxShadow: `0 5px 12px -7px rgba(0,0,0,${Math.min(.5, +tk.sh * .35)})` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, height: '100%' }}>
                    <span style={{ borderRadius: 4, background: `oklch(${light ? '.99' : '.96'} .008 ${tk.th} / ${light ? '.58' : '.12'})` }} />
                    <span style={{ borderRadius: 4, background: `oklch(${light ? '.99' : '.96'} .008 ${tk.th2} / ${light ? '.46' : '.1'})` }} />
                    <span style={{ gridColumn: '1 / -1', height: 5, alignSelf: 'end', borderRadius: R.pill, background: `linear-gradient(90deg, oklch(${tk.l1} ${tk.c1} ${tk.th}), oklch(${tk.l2} ${tk.c2} ${tk.th2}))` }} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: sel ? ink(1) : ink(2), fontSize: FS.body, fontWeight: sel ? 700 : 500 }}>
                    {custom && <Sparkles size={10} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />}
                    {t.label}
                    <span title={light ? '浅色主题' : '深色主题'} style={{ display: 'inline-flex', color: ink(3) }}>{light ? <Sun size={9} /> : <Moon size={9} />}</span>
                    {sel && <span style={{ marginLeft: 2, fontSize: 9.5, fontWeight: 700, color: accent() }}>使用中</span>}
                  </span>
                  {!!t.tags?.length && <span title={t.tags.join(' · ')} style={{ display: 'flex', gap: 4, minWidth: 0, overflow: 'hidden' }}>{t.tags.slice(0, 4).map((tag) => <span key={tag} style={{ color: accent(), fontSize: 8.5, fontWeight: 650, whiteSpace: 'nowrap' }}>#{tag}</span>)}</span>}
                  <span title={`${t.desc} · 透明度 ${Math.round(+tk.ga * 100)}%`} style={{ color: ink(3), fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc} · {Math.round(+tk.ga * 100)}%</span>
                </div>
                {custom && (
                  <span style={{ flex: 'none', display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    <IconButton icon={Pencil} size={22} title="编辑该主题（带入令牌到设计器）" onClick={() => p.onEditTheme(t.key)} />
                    <IconButton icon={X} size={22} color={sem.danger} title="删除自定义主题" onClick={() => p.onDeleteCustomTheme(t.key)} />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* 通用 */}
      <Section icon={Settings2} title="通用">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 灵动岛宽度：标准模式面板宽（大尺寸模式固定 880）；迷你条宽度自动同步 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={text.body()}>灵动岛宽度</span>
              <span style={{ marginLeft: 'auto', ...text.num(FS.small), color: accent(0.78) }}>{p.islandWidth}px</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...text.faint(), fontSize: 9.5, flex: 'none' }}>380</span>
              <Slider min={380} max={880} step={10} value={p.islandWidth} onChange={(v) => p.onSetIslandWidth(v)} style={{ flex: 1 }} />
              <span style={{ ...text.faint(), fontSize: 9.5, flex: 'none' }}>880</span>
            </div>
            <span style={text.faint()}>标准模式生效（大尺寸固定 880）</span>
          </div>
          {/* 界面字体与缩放（清晰度） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={text.body()}>界面字体</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FONT_OPTIONS.map((f) => (
                <Chip key={f.key} active={p.fontChoice === f.key} onClick={() => p.onSetFontChoice(f.key)}>
                  {f.label}
                </Chip>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...text.body(), flex: 'none' }}>界面缩放</span>
              <Slider min={0.9} max={1.3} step={0.05} value={p.uiZoom} onChange={(v) => p.onSetUiZoom(v)} style={{ flex: 1 }} />
              <span style={{ ...text.num(FS.small), color: accent(0.78), flex: 'none' }}>{Math.round(p.uiZoom * 100)}%</span>
            </div>
            <span style={text.faint()}>透明窗口没有亚像素渲染，小字发虚是系统限制——调大缩放 / 换微软雅黑 UI 可明显改善</span>
          </div>
          {/* 开关设置行：iOS inset grouped 分组列表（行间 hairline 分隔） */}
          <Group>
          {GENERAL.map((g) => {
            const isSound = g.key === 'sound'
            const isMonitor = g.key === 'multiMonitor'
            const canExpand = (isSound && p.settings.sound) || isMonitor
            const expanded = (isSound && p.soundPickerOpen) || (isMonitor && p.monitorPreviewOpen)
            return (
              <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, cursor: canExpand ? 'pointer' : undefined }}
                    onClick={() => (isSound ? p.onToggleSoundPicker() : isMonitor ? p.onToggleMonitorPreview() : undefined)}
                  >
                    <span style={{ ...text.body(), display: 'flex', alignItems: 'center', gap: 6 }}>
                      {g.label}
                      {(isSound || isMonitor) && <ChevronDown size={11} strokeWidth={2} style={{ color: ink(3), transition: 'transform .2s', transform: expanded ? 'rotate(180deg)' : undefined }} />}
                    </span>
                    <span style={text.faint()}>{g.desc}</span>
                  </div>
                  <Switch on={p.settings[g.key]} onChange={() => p.onToggle(g.key)} />
                </div>

                {isSound && p.soundPickerOpen && p.settings.sound && (
                  <div style={{ ...surface.inset(), display: 'flex', flexDirection: 'column', gap: 12, padding: SP.md }}>
                    <div style={{ ...text.faint(), fontSize: 10, lineHeight: 1.5 }}>不同类型的通知用不同声效，听声辨事。点音色即选中并试听，▶ 单独试听。</div>
                    {SOUND_TYPES.map((st2) => (
                      <div key={st2.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: st2.key === 'danger' ? sem.danger : ink(1), fontSize: FS.small, fontWeight: 700, flex: 'none' }}>
                            {st2.key === 'danger' && <TriangleAlert size={11} strokeWidth={2} />}{st2.label}
                          </span>
                          <span style={{ ...text.faint(), fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st2.desc}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {SOUNDS.map((snd) => {
                            const sel = p.soundMap[st2.key] === snd.key
                            return (
                              <Chip key={snd.key} active={sel} title={snd.desc} onClick={() => p.onSetSound(st2.key, snd.key)} style={{ fontSize: FS.tiny }}>
                                {snd.label}
                                <span className="hv" onClick={(e) => p.onPreviewSound(e, snd.key)} title="试听" style={{ display: 'inline-flex', color: accent(0.8, 0.85), cursor: 'pointer' }}>
                                  <Play size={8} strokeWidth={2} fill="currentColor" />
                                </span>
                              </Chip>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isMonitor && p.monitorPreviewOpen && (
                  <div style={{ ...surface.inset(), display: 'flex', flexDirection: 'column', gap: 8, padding: SP.md }}>
                    <div style={{ ...text.faint(), color: ink(2) }}>面板会出现在下面选中的显示器顶部中央：</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {(p.displays.length ? p.displays : [{ id: 0, index: 0, label: '主显示器', primary: true, width: 0, height: 0, scaleFactor: 1 }]).map((d) => {
                        const n = d.index + 1
                        const active = p.activeMonitor === n
                        const ar = d.width && d.height ? d.width / d.height : 16 / 10
                        return (
                          <div key={d.id} style={{ flex: '1 1 120px', maxWidth: 220, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center', cursor: 'pointer' }} onClick={() => p.onSetMonitor(n)}>
                            <div style={{ width: '100%', aspectRatio: String(ar), borderRadius: R.sm, background: active ? semBg(accent(), 0.14) : fill(2), border: `0.5px solid ${active ? accent(0.7, 0.55) : hairline(0.06)}`, position: 'relative', transition: 'all .18s' }}>
                              {active && <div style={{ position: 'absolute', top: 5, left: '50%', transform: 'translateX(-50%)', width: '38%', height: 7, borderRadius: '0 0 6px 6px', background: gradient.primary(), boxShadow: `0 0 10px ${accent(0.78, 0.6)}` }} />}
                            </div>
                            <span style={{ color: active ? ink(1) : ink(3), fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                              {d.primary ? '主显示器' : `显示器 ${n}`}
                              {d.width > 0 && <span style={{ ...text.faint(), fontSize: 9 }}>{d.width}×{d.height}{d.scaleFactor !== 1 ? ` · ${Math.round(d.scaleFactor * 100)}%` : ''}</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </Group>
          {/* 自动化规则：当 X 则 Y（inset grouped 行列表） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: accent(0.75, 0.85), fontSize: FS.tiny, fontWeight: 700, letterSpacing: '.04em' }}>
              <Wrench size={11} strokeWidth={2} />自动化 · 当 X 则 Y
            </div>
            <Group>
              {AUTOMATION.map((r) => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={text.body()}>{r.label}</span>
                    <span style={text.faint()}>{r.desc}</span>
                  </div>
                  <Switch on={p.settings[r.key]} onChange={() => p.onToggle(r.key)} />
                </div>
              ))}
            </Group>
          </div>
        </div>
      </Section>

      {/* 问答助手模型 */}
      <CollapsibleSection
        icon={MessageSquare}
        title="问答助手模型"
        open={p.llm.open}
        onToggle={p.onToggleLlm}
        summary={<span style={{ ...text.faint(), color: accent(0.75, 0.85) }}>{llmSummary}</span>}
      >
        <div style={{ ...surface.inset(), borderRadius: R.lg, display: 'flex', flexDirection: 'column', gap: 12, padding: SP.md }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={labelSm}>供应商</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PROVIDERS.map((pr) => (
                <Chip key={pr.key} active={pr.key === p.llm.provider} onClick={() => p.onSetProvider(pr.key)}>
                  {pr.label}
                </Chip>
              ))}
            </div>
            {activeProvider.hint && <div style={{ ...text.faint(), fontSize: 10, lineHeight: 1.45 }}>{activeProvider.hint}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={labelSm}>型号（每家可添加多个 · 点选使用 · 问答界面可随时切换）</div>
              {activeProvider.modelDiscovery === false
                ? <span style={{ ...text.faint(), fontSize: 10, whiteSpace: 'nowrap' }}>官方固定目录</span>
                : <Button sm variant="ghost" icon={RefreshCw} disabled={p.llm.testStatus === 'testing'} onClick={p.onSyncLlmModels}>同步可用模型</Button>}
            </div>
            {(p.llm.modelLists[p.llm.provider] || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(p.llm.modelLists[p.llm.provider] || []).map((m) => {
                  const sel = m === p.llm.model
                  return (
                    <div key={m} onClick={() => p.onPickModel(m)} className="hv" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: R.sm, background: sel ? semBg(accent(), 0.14) : fill(2), border: sel ? `0.5px solid ${accent(0.7, 0.5)}` : 'none', cursor: 'pointer' }}>
                      <span style={{ ...text.mono(11), color: sel ? ink(1) : ink(2) }}>{m}</span>
                      {sel && <span style={{ color: accent(), fontSize: 9, fontWeight: 700 }}>使用中</span>}
                      {activeProvider.modelDiscovery !== false && (
                        <span onClick={(e) => { e.stopPropagation(); p.onRemoveModel(m) }} title="删除此型号" style={{ display: 'inline-flex', color: ink(3), cursor: 'pointer' }}>
                          <X size={11} strokeWidth={2} />
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {activeProvider.modelDiscovery !== false && <div style={{ display: 'flex', gap: 6 }}>
              <Input
                value={modelDraft}
                onChange={setModelDraft}
                onKeyDown={(e) => { if (e.key === 'Enter' && modelDraft.trim()) { p.onAddModel(modelDraft.trim()); setModelDraft('') } }}
                placeholder={`输入 model id 添加，如 ${activeProvider.models[0] || 'your-model-id'}`}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button
                variant="primary"
                icon={Plus}
                disabled={!modelDraft.trim()}
                onClick={() => { if (modelDraft.trim()) { p.onAddModel(modelDraft.trim()); setModelDraft('') } }}
              >
                添加
              </Button>
            </div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={labelSm}>Base URL</div>
            <Input value={p.llm.baseUrl} onChange={(v) => p.onSetLlmField('baseUrl', v)} placeholder="https://api.example.com/v1" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={labelSm}>API Key</div>
            <input value={p.llm.apiKey} onChange={(e) => p.onSetLlmField('apiKey', e.target.value)} type="password" placeholder="sk-••••••••••••" style={secretInput} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button variant="primary" disabled={p.llm.testStatus === 'testing'} onClick={p.onTestLlm}>
              {p.llm.testStatus === 'testing' && <span style={{ display: 'inline-block', width: 11, height: 11, border: '2px solid rgba(0,0,0,.25)', borderTopColor: gradient.onPrimary(), borderRadius: 999, animation: 'ai-ring .7s linear infinite' }} />}
              测试连通性
            </Button>
            {p.llm.testMsg && <span style={{ color: p.llm.testStatus === 'ok' ? accent(0.8) : p.llm.testStatus === 'fail' ? sem.danger : ink(2), fontSize: 11, flex: 1 }}>{p.llm.testMsg}</span>}
          </div>
          <div style={separatorRow()} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={labelSm}>已保存的配置</div>
            <Button sm variant="ghost" icon={Plus} disabled={!p.llm.model.trim() || !p.llm.baseUrl.trim() || !p.llm.apiKey.trim()} onClick={p.onSaveLlm}>保存当前</Button>
          </div>
          {p.llm.saved.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {p.llm.saved.map((c) => {
                const active = providerConfigEquals(c, { provider: p.llm.provider, model: p.llm.model, baseUrl: p.llm.baseUrl, apiKey: p.llm.apiKey })
                return (
                  <div key={c.id} onClick={() => p.onLoadLlm(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: R.sm, background: active ? semBg(accent(), 0.1) : fill(1), border: active ? `0.5px solid ${accent(0.7, 0.4)}` : 'none', cursor: 'pointer' }}>
                    <div style={{ width: 6, height: 6, borderRadius: 999, background: active ? accent() : ink(4), boxShadow: active ? `0 0 6px ${accent()}` : 'none' }} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ ...text.mono(FS.small), color: ink(1), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      <span style={{ ...text.faint(), fontSize: 9 }}>{endpointHost(c.baseUrl)} · 配置 {String(c.id).slice(-4)}</span>
                    </span>
                    {active && <span style={{ color: accent(), fontSize: 10, fontWeight: 700 }}>使用中</span>}
                    <span onClick={(e) => { e.stopPropagation(); p.onDeleteLlm(c.id) }} style={{ display: 'inline-flex', color: ink(3), cursor: 'pointer' }}>
                      <X size={12} strokeWidth={2} />
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ ...text.faint(), fontSize: 10, lineHeight: 1.5 }}>仅用于「问答助手」。每家供应商的模型、地址和密钥独立保留，切换时不会串用；支持发现模型的供应商可读取当前账号的 `/models` 列表。Agent（Claude Code / Codex）的模型仍在各自 CLI 中配置，密钥仅保存在本机。</div>
        </div>
      </CollapsibleSection>

      {/* 飞书日历（CalDAV 主通道 / ICS 备选）—— 可折叠；标题固定横排不换行 */}
      <CollapsibleSection
        icon={CalendarClock}
        title="飞书日历"
        open={calOpen}
        onToggle={() => setCalOpen((v) => !v)}
        summary={
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: FS.tiny, color: p.calMsg.startsWith('同步失败') ? sem.danger : accent(0.75, 0.85) }}>
            {p.caldav.server || p.icsUrl ? (p.calMsg || '已配置') : '未配置'}
          </span>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={labelSm}>CalDAV 同步（推荐 · 飞书官方支持）</div>
          <Input value={cdDraft.server} onChange={(v) => setCdDraft((d) => ({ ...d, server: v }))} placeholder="服务器地址，如 https://caldav.feishu.cn" />
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={cdDraft.username} onChange={(v) => setCdDraft((d) => ({ ...d, username: v }))} placeholder="用户名" style={{ flex: 1, minWidth: 0 }} />
            <input value={cdDraft.password} onChange={(e) => setCdDraft((d) => ({ ...d, password: e.target.value }))} type="password" placeholder="密码" style={{ ...secretInput, flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button variant="primary" onClick={() => p.onSetCaldav({ server: cdDraft.server.trim(), username: cdDraft.username.trim(), password: cdDraft.password })}>
              保存并同步
            </Button>
            {p.calMsg && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: FS.tiny, color: p.calMsg.startsWith('同步失败') ? sem.danger : accent(0.8) }}>{p.calMsg}</span>}
          </div>
          <div style={{ ...text.faint(), fontSize: 10, lineHeight: 1.6 }}>
            获取方式：飞书 PC 端 → 右上角<b style={{ color: ink(2) }}>个人头像 → 设置 → 日历 → CalDAV 同步</b> → 选设备类型（Windows/其他）→ 点「生成」，把 服务器地址/用户名/密码 填到上面。今日会议显示在「待办」页顶部（含一键入会），会前 5 分钟弹岛提醒，每 10 分钟刷新。密码仅加密存本机。
          </div>
          <div style={separatorRow()} />
          <div style={labelSm}>ICS 订阅链接（备选 · 部分企业不开放）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={icsDraft} onChange={setIcsDraft} placeholder="webcal:// 或 https://…/xxx.ics" style={{ flex: 1, minWidth: 0 }} />
            <Button variant="ghost" onClick={() => p.onSetIcsUrl(icsDraft.trim())}>保存</Button>
          </div>
        </div>
      </CollapsibleSection>

      {/* 常驻迷你条自定义 —— 可折叠；标题固定横排 */}
      <CollapsibleSection
        icon={PanelTop}
        title="常驻迷你条"
        open={barOpen}
        onToggle={() => setBarOpen((v) => !v)}
        summary={
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: FS.tiny, color: accent(0.75, 0.85) }}>
            {p.settings.ambientBar ? `已开启 · ${p.barCfg.modes.length} 种内容` : '未开启（在上方通用里开启）'}
          </span>
        }
      >
        <div style={{ ...surface.inset(), borderRadius: R.lg, display: 'flex', flexDirection: 'column', gap: 10, padding: SP.md }}>
          <div style={labelSm}>轮播内容（多选，每 {p.barCfg.rotationSeconds || 12} 秒切换）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {BAR_MODES.map((m) => {
              const on = p.barCfg.modes.includes(m.key)
              return (
                <Chip key={m.key} active={on} onClick={() => p.onSetBarCfg({ ...p.barCfg, modes: on ? p.barCfg.modes.filter((x) => x !== m.key) : [...p.barCfg.modes, m.key] })}>
                  {m.label}
                </Chip>
              )
            })}
          </div>
          <div style={labelSm}>迷你条宽度 · {p.barCfg.width || 340}px（独立于灵动岛宽度；超长文字自动滚动）</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...text.faint(), fontSize: 9.5, flex: 'none' }}>240</span>
            <Slider min={240} max={880} step={10} value={p.barCfg.width || 340} onChange={(v) => p.onSetBarCfg({ ...p.barCfg, width: v })} style={{ flex: 1 }} />
            <span style={{ ...text.faint(), fontSize: 9.5, flex: 'none' }}>880</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
            <div>
              <div style={{ ...labelSm, marginBottom: 6 }}>条体外观</div>
              <Segmented
                options={BAR_APPEARANCES.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))}
                value={p.barCfg.appearance || 'glass'}
                onChange={(k) => p.onSetBarCfg({ ...p.barCfg, appearance: k })}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', justifyItems: 'center', width: '100%' }}
              />
            </div>
            <div>
              <div style={{ ...labelSm, marginBottom: 6 }}>动效强度</div>
              <Segmented
                options={BAR_MOTIONS.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))}
                value={p.barCfg.motion || 'balanced'}
                onChange={(k) => p.onSetBarCfg({ ...p.barCfg, motion: k })}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', justifyItems: 'center', width: '100%' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <TimerReset size={13} strokeWidth={1.75} style={{ color: accent(0.75), flex: 'none' }} />
            <span style={{ ...labelSm, margin: 0, whiteSpace: 'nowrap' }}>轮播节奏 · {p.barCfg.rotationSeconds || 12}s</span>
            <Slider min={6} max={30} step={1} value={p.barCfg.rotationSeconds || 12} onChange={(v) => p.onSetBarCfg({ ...p.barCfg, rotationSeconds: v })} style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([
              ['showStatus', '实时状态舱', Activity],
              ['showProgress', '底部时序轨', Waves]
            ] as const).map(([key, label, Icon]) => {
              const enabled = p.barCfg[key] !== false
              return <button key={key} type="button" onClick={() => p.onSetBarCfg({ ...p.barCfg, [key]: !enabled })} style={{ flex: 1, height: 32, borderRadius: R.md, border: enabled ? `0.5px solid ${accent(0.7, 0.32)}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', color: enabled ? ink(1) : ink(3), background: enabled ? semBg(accent(), 0.14) : fill(1), fontSize: FS.tiny, fontWeight: 600, fontFamily: 'inherit', transition: 'background .15s, color .15s' }}><Icon size={12} strokeWidth={1.75} />{label}<span style={{ opacity: .58 }}>{enabled ? '开' : '关'}</span></button>
            })}
          </div>
          <div style={{ ...text.faint(), fontSize: 10, lineHeight: 1.5 }}>悬停暂停轮播，可手动切换内容；审批、等待回复、到期待办、专注和勿扰状态会实时显示。</div>
          <div style={labelSm}>颜色</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {([['theme', '跟随主题'], ['rainbow', '多彩'], ['custom', '自定义']] as const).map(([k, label]) => (
              <Chip key={k} active={p.barCfg.colorMode === k} onClick={() => p.onSetBarCfg({ ...p.barCfg, colorMode: k })}>
                {label}
              </Chip>
            ))}
            {p.barCfg.colorMode === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 150 }}>
                <input type="range" min={0} max={360} value={p.barCfg.hue} onChange={(e) => p.onSetBarCfg({ ...p.barCfg, hue: Number(e.target.value) })} style={{ flex: 1, accentColor: `oklch(0.7 0.15 ${p.barCfg.hue})` }} />
                <div style={{ width: 16, height: 16, borderRadius: 999, background: `oklch(0.72 0.15 ${p.barCfg.hue})`, boxShadow: `0 0 8px oklch(0.72 0.15 ${p.barCfg.hue})`, flex: 'none' }} />
              </div>
            )}
          </div>
          {p.barCfg.modes.includes('pet') && (
            <>
              <div style={labelSm}>小宠物</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {PETS.map((e) => (
                  <div key={e} className="hv" onClick={() => p.onSetBarCfg({ ...p.barCfg, petEmoji: e })} style={{ width: 30, height: 30, borderRadius: R.sm, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, cursor: 'pointer', background: p.barCfg.petEmoji === e ? semBg(accent(), 0.16) : fill(2), border: p.barCfg.petEmoji === e ? `0.5px solid ${accent(0.7, 0.5)}` : 'none' }}>
                    {e}
                  </div>
                ))}
              </div>
            </>
          )}
          {/* 自定义轮播主题：AI 每 10 分钟按你的描述生成一批内容 */}
          <div style={labelSm}>自定义主题（AI 按描述持续生成内容，聚合进「自定义主题」模式）</div>
          {(p.barCfg.customTopics || []).map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: R.sm, background: fill(2) }}>
              <span style={{ flex: 'none', color: ink(1), fontSize: 11, fontWeight: 700 }}>{t.name}</span>
              <span style={{ ...text.faint(), fontSize: 10, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.hint}</span>
              <span className="hv" onClick={() => p.onSetBarCfg({ ...p.barCfg, customTopics: (p.barCfg.customTopics || []).filter((x) => x.id !== t.id) })} style={{ display: 'inline-flex', cursor: 'pointer', color: ink(3) }}>
                <X size={11} strokeWidth={2} />
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={topicName} onChange={setTopicName} placeholder="主题名，如：Rust 技巧" style={{ width: 130, flex: 'none' }} />
            <Input value={topicHint} onChange={setTopicHint} placeholder="给 AI 的描述：想看什么内容…" style={{ flex: 1, minWidth: 0 }} />
            <Button
              variant="primary"
              icon={Plus}
              disabled={!topicName.trim()}
              onClick={() => {
                if (!topicName.trim()) return
                p.onSetBarCfg({ ...p.barCfg, customTopics: [...(p.barCfg.customTopics || []), { id: Date.now(), name: topicName.trim(), hint: topicHint.trim() || topicName.trim() }], modes: p.barCfg.modes.includes('custom') ? p.barCfg.modes : [...p.barCfg.modes, 'custom'] })
                setTopicName(''); setTopicHint('')
              }}
            >
              添加
            </Button>
          </div>
          {/* AI 10 分钟刷新开关 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ ...text.body(), fontSize: 12 }}>AI 每 10 分钟刷新内容</span>
              <span style={{ ...text.faint(), fontSize: 10 }}>名言/经验/方法论/热管理/自定义主题持续出新（用问答模型，产生调用费用）</span>
            </div>
            <Switch on={p.barCfg.aiRefresh !== false} onChange={() => p.onSetBarCfg({ ...p.barCfg, aiRefresh: p.barCfg.aiRefresh === false ? true : false })} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" icon={Sparkles} onClick={() => { setBarAiMsg('✨ 正在提炼…'); void p.onAiBarQuotes().then(setBarAiMsg) }}>
              AI 生成我的个性语录
            </Button>
            <Button variant="tinted" icon={Zap} onClick={() => { setBarAiMsg('⚡ 正在生成各主题内容…'); void p.onRefreshBarContent().then(setBarAiMsg) }}>
              立即生成主题内容
            </Button>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: FS.tiny, color: barAiMsg.startsWith('✓') ? sem.calm : ink(2) }}>
              {barAiMsg || `个性语录${p.barCfg.customQuotes.length ? `已有 ${p.barCfg.customQuotes.length} 条` : '未生成'}；自定义主题由 AI 持续供给内容`}
            </span>
          </div>
        </div>
      </CollapsibleSection>

      {/* 后端接入 */}
      <Section icon={Plug} title="后端接入">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <span style={text.body()}>自动接入所有 CLI / 终端</span>
            <span style={text.faint()}>开启后，任何 Claude Code / Codex 会话都实时通信</span>
          </div>
          <Switch on={p.settings.autoConnect} onChange={() => p.onToggle('autoConnect')} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button variant="ghost" onClick={() => { p.onInstallHooks(); setHookMsg('已接入 · 全局写入，所有会话的生命周期会实时反映到岛') }} style={{ flex: 1 }}>立即重新接入</Button>
          <Button variant="ghost" onClick={() => { p.onUninstallHooks(); setHookMsg('已断开 · 已从全局配置移除本工具的 hook（可还原）') }} style={{ flex: 1 }}>暂时断开</Button>
        </div>
        {hookMsg && <div style={{ color: accent(0.8), fontSize: FS.tiny, marginTop: 8, lineHeight: 1.5 }}>{hookMsg}</div>}
        <div style={{ ...text.faint(), marginTop: 8, lineHeight: 1.5 }}>全局合并写入 ~/.claude/settings.json 与 ~/.codex/hooks.json（不覆盖已有配置，可随时还原）。覆盖会话开始 / 对话 / 工具活动 / 命令审批 / 完成全生命周期；岛未运行时 CLI 照常工作，零影响。</div>
      </Section>

      {/* 已支持工具 */}
      <Section icon={Terminal} title="已支持的工具" extra={<Badge>{enabledTools}/4 启用</Badge>}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: SP.sm }}>
          {TOOLS.map((t) => {
            const on = p.settings[t.key]
            const isApp = /App$/.test(t.key)
            const dotColor = on ? accent() : ink(4)
            return (
              <div key={t.key} onClick={() => p.onToggle(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: R.md, background: on ? semBg(accent(), 0.1) : fill(1), border: on ? `0.5px solid ${accent(0.7, 0.35)}` : 'none', cursor: 'pointer', transition: 'background .15s' }}>
                {isApp ? (
                  <div style={{ width: 17, height: 17, flex: 'none', borderRadius: 5, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 10, height: 8, border: `1px solid ${dotColor}`, borderRadius: 2, overflow: 'hidden' }}><div style={{ height: 2, background: dotColor }} /></div>
                  </div>
                ) : (
                  <div style={{ width: 17, height: 17, flex: 'none', borderRadius: 5, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: dotColor, fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 9.5, fontWeight: 700 }}>›_</div>
                )}
                <span style={{ color: on ? ink(1) : ink(3), fontSize: FS.small, fontWeight: 500 }}>{t.label}</span>
              </div>
            )
          })}
        </div>
        <div style={{ ...text.faint(), marginTop: 9 }}>当前支持 Claude Code、Codex 的 CLI 与桌面端，共 4 种。</div>
      </Section>

      {/* 退出应用（右下角托盘图标同样可退出/重启） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 10, borderTop: `0.5px solid ${hairline(0.08)}` }}>
        <Button variant="danger" icon={Power} onClick={p.onQuitApp}>退出 Agentic-Island</Button>
        <span style={{ ...text.faint(), fontSize: 10 }}>也可以右键屏幕右下角托盘图标退出 / 重启</span>
      </div>
    </div>
  )
}
