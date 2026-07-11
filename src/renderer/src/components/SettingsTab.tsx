// Settings 分区 —— 移植自原型 Agentic-Island.dc.html:229-355 + 相关 renderVals。
// 通用开关(声音展开选择器 / 多显示器展开选择) + 问答助手模型配置 + 已支持工具网格。

import { useEffect, useState } from 'react'
import type { RuntimeInfo } from '../../../shared/protocol'
import type { BarConfig } from '../types'
import { SOUNDS, SOUND_TYPES, type SoundMap } from '../logic/sounds'
import { PROVIDERS } from '../logic/providers'
import { THEMES, type ThemeDef } from '../logic/themes'

export interface LlmState {
  open: boolean
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  testStatus: 'idle' | 'testing' | 'ok' | 'fail'
  testMsg: string
  saved: { id: number; provider: string; model: string; baseUrl: string; apiKey: string; name: string }[]
  /** 每家厂商的型号列表（用户可增删；问答头部可自由切换），key=provider */
  modelLists: Record<string, string[]>
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
const PETS = ['🐈', '🐕', '🦊', '🐰', '🐢', '🦆']

const GENERAL: { key: keyof SettingsFlags; label: string; desc: string }[] = [
  { key: 'autostart', label: '开机自启', desc: '登录 Windows 时自动在后台运行' },
  { key: 'multiMonitor', label: '跟随鼠标所在显示器', desc: '开启后随鼠标切换显示器；关闭则固定在下方选中的显示器' },
  { key: 'largeSize', label: '大尺寸工作台', desc: '更大的面板与内容区，适合待办 / 问答等重度使用' },
  { key: 'sound', label: '声音提醒', desc: '需要处理时播放提示音' },
  { key: 'silentBg', label: '空闲时完全静默', desc: '无待办时隐藏胶囊' },
  { key: 'clipWatch', label: '剪贴板助手', desc: '记录剪贴板历史（仅内存不落盘），问答区 📋 面板可一键翻译/解释/清洗' },
  { key: 'ambientBar', label: '常驻迷你条', desc: '岛收起后保留一条小状态条，轮播名人名言与动态光带；关闭则完全收回' },
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

const sectionTitle: React.CSSProperties = {
  font: "600 10.5px 'Segoe UI',sans-serif",
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'oklch(0.65 0.02 var(--th) / .6)',
  marginBottom: 9
}

const track = (on: boolean): React.CSSProperties => ({
  width: 38,
  height: 22,
  borderRadius: 999,
  position: 'relative',
  cursor: 'pointer',
  transition: 'background .2s',
  background: on ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.12)'
})
const knob = (on: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 2,
  left: on ? undefined : 2,
  right: on ? 2 : undefined,
  width: 18,
  height: 18,
  borderRadius: 999,
  background: on ? '#fff' : 'rgba(255,255,255,.7)',
  transition: 'all .2s',
  boxShadow: '0 2px 5px rgba(0,0,0,.3)'
})
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 9,
  color: 'oklch(0.95 0.01 var(--th))',
  fontSize: 12,
  fontFamily: 'ui-monospace,monospace',
  padding: '8px 10px',
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
  const providerLabel = (PROVIDERS.find((x) => x.key === p.llm.provider) || {}).label
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 运行状态：把版本和关键链路从后台实现变成用户可见的健康度。 */}
      <div style={{ paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={sectionTitle}>运行状态</div>
          <span style={{ marginLeft: 'auto', color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5, fontFamily: 'ui-monospace,monospace' }}>
            v{p.runtimeInfo?.version || '…'} · {p.runtimeInfo?.packaged ? '安装版' : '开发版'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px' }}>
          {statusItems.map((item) => (
            <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '8px minmax(0, 1fr)', columnGap: 8, alignItems: 'start', minWidth: 0 }}>
              <span style={{ width: 7, height: 7, marginTop: 4, borderRadius: 999, background: item.ok ? 'oklch(0.78 0.14 150)' : 'oklch(0.75 0.13 75)', boxShadow: item.ok ? '0 0 8px oklch(0.72 0.14 150 / .45)' : '0 0 8px oklch(0.75 0.13 75 / .35)' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'oklch(0.9 0.02 var(--th))', fontSize: 11.5, fontWeight: 650 }}>{item.label}</div>
                <div title={item.detail} style={{ marginTop: 2, color: 'oklch(0.62 0.02 var(--th) / .65)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 主题 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={sectionTitle}>灵动岛主题</div>
          <span style={{ flex: 1 }} />
          <div className="hv" onClick={p.onOpenThemeDesigner} style={{ padding: '4px 11px', borderRadius: 8, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, background: 'oklch(0.35 0.07 var(--th) / .5)', color: 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))' }}>🎨 自定义主题</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          {[...p.customThemes, ...THEMES].map((t) => {
            const sel = p.theme === t.key
            const custom = t.key.startsWith('custom-')
            return (
              <div
                key={t.key}
                className="hv"
                onClick={() => p.onSetTheme(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 11, cursor: 'pointer', position: 'relative',
                  background: sel ? 'oklch(0.3 0.05 var(--th) / .35)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${sel ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.07)'}`
                }}
              >
                <div style={{ width: 16, height: 16, flex: 'none', borderRadius: 999, background: t.dot, boxShadow: `0 0 8px ${t.dot}`, border: '1px solid rgba(255,255,255,.25)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                  <span style={{ color: sel ? 'oklch(0.95 0.01 var(--th))' : 'oklch(0.85 0.02 var(--th) / .85)', fontSize: 12, fontWeight: sel ? 700 : 500 }}>
                    {custom ? '✨ ' : ''}{t.label}
                    {sel && <span style={{ marginLeft: 6, fontSize: 9.5, color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' }}>使用中</span>}
                  </span>
                  <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.desc}</span>
                </div>
                {custom && (
                  <span style={{ flex: 'none', display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    <span className="hv" title="编辑该主题（带入令牌到设计器）" onClick={() => p.onEditTheme(t.key)} style={{ padding: '4px 7px', borderRadius: 7, color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 11.5, cursor: 'pointer' }}>✎</span>
                    <span className="hv" title="删除自定义主题" onClick={() => p.onDeleteCustomTheme(t.key)} style={{ padding: '4px 7px', borderRadius: 7, color: 'oklch(0.65 0.08 25 / .9)', fontSize: 11.5, cursor: 'pointer', background: 'rgba(255,255,255,.04)' }}>✕</span>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 通用 */}
      <div>
        <div style={sectionTitle}>通用</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {/* 灵动岛宽度：标准模式面板宽（大尺寸模式固定 880）；迷你条宽度自动同步 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 12.5, flex: 'none', whiteSpace: 'nowrap' }}>灵动岛宽度</span>
              <span style={{ marginLeft: 'auto', color: 'oklch(0.75 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{p.islandWidth}px</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, flex: 'none' }}>380</span>
              <input type="range" min={380} max={880} step={10} value={p.islandWidth} onChange={(e) => p.onSetIslandWidth(Number(e.target.value))} style={{ flex: 1, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }} />
              <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, flex: 'none' }}>880</span>
            </div>
            <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10.5 }}>标准模式生效（大尺寸固定 880）</span>
          </div>
          {/* 界面字体与缩放（清晰度） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 12.5 }}>界面字体</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FONT_OPTIONS.map((f) => (
                <div key={f.key} className="hv" onClick={() => p.onSetFontChoice(f.key)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: p.fontChoice === f.key ? 'oklch(0.3 0.05 var(--th) / .5)' : 'rgba(255,255,255,.05)', border: `1px solid ${p.fontChoice === f.key ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.08)'}`, color: 'oklch(0.86 0.02 var(--th) / .9)' }}>
                  {f.label}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 12.5, flex: 'none' }}>界面缩放</span>
              <input type="range" min={0.9} max={1.3} step={0.05} value={p.uiZoom} onChange={(e) => p.onSetUiZoom(Number(e.target.value))} style={{ flex: 1, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }} />
              <span style={{ color: 'oklch(0.75 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 11, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{Math.round(p.uiZoom * 100)}%</span>
            </div>
            <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10.5 }}>透明窗口没有亚像素渲染，小字发虚是系统限制——调大缩放 / 换微软雅黑 UI 可明显改善</span>
          </div>
          {GENERAL.map((g) => {
            const isSound = g.key === 'sound'
            const isMonitor = g.key === 'multiMonitor'
            const canExpand = (isSound && p.settings.sound) || isMonitor
            const expanded = (isSound && p.soundPickerOpen) || (isMonitor && p.monitorPreviewOpen)
            return (
              <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 1, cursor: canExpand ? 'pointer' : undefined }}
                    onClick={() => (isSound ? p.onToggleSoundPicker() : isMonitor ? p.onToggleMonitorPreview() : undefined)}
                  >
                    <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {g.label}
                      {(isSound || isMonitor) && <span style={{ color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 10, transition: 'transform .2s', transform: expanded ? 'rotate(180deg)' : undefined }}>▾</span>}
                    </span>
                    <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10.5 }}>{g.desc}</span>
                  </div>
                  <div style={track(p.settings[g.key])} onClick={() => p.onToggle(g.key)}>
                    <div style={knob(p.settings[g.key])} />
                  </div>
                </div>

                {isSound && p.soundPickerOpen && p.settings.sound && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 11, borderRadius: 13, background: 'rgba(0,0,0,.22)' }}>
                    <div style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 10, lineHeight: 1.5 }}>不同类型的通知用不同声效，听声辨事。点音色即选中并试听，▶ 单独试听。</div>
                    {SOUND_TYPES.map((st2) => (
                      <div key={st2.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                          <span style={{ color: st2.key === 'danger' ? 'oklch(0.82 0.14 30)' : 'oklch(0.9 0.01 var(--th))', fontSize: 11.5, fontWeight: 700, flex: 'none' }}>
                            {st2.key === 'danger' ? '⚠ ' : ''}{st2.label}
                          </span>
                          <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st2.desc}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {SOUNDS.map((snd) => {
                            const sel = p.soundMap[st2.key] === snd.key
                            return (
                              <div key={snd.key} className="hv" onClick={() => p.onSetSound(st2.key, snd.key)} title={snd.desc} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3.5px 9px', borderRadius: 999, cursor: 'pointer', background: sel ? 'oklch(0.32 calc(0.06 * var(--cs, 1)) var(--th) / .55)' : 'rgba(255,255,255,.04)', border: `1px solid ${sel ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.07)'}` }}>
                                <span style={{ color: sel ? 'oklch(0.94 0.01 var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 10.5, fontWeight: sel ? 700 : 500 }}>{snd.label}</span>
                                <span className="hv" onClick={(e) => p.onPreviewSound(e, snd.key)} title="试听" style={{ color: 'oklch(0.8 calc(0.1 * var(--cs, 1)) var(--th) / .8)', fontSize: 8.5, cursor: 'pointer' }}>▶</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isMonitor && p.monitorPreviewOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 11, borderRadius: 13, background: 'rgba(0,0,0,.22)' }}>
                    <div style={{ color: 'oklch(0.68 0.02 var(--th) / .7)', fontSize: 10.5 }}>面板会出现在下面选中的显示器顶部中央：</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {[1, 2].map((n) => {
                        const active = p.activeMonitor === n
                        return (
                          <div key={n} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center', cursor: 'pointer' }} onClick={() => p.onSetMonitor(n)}>
                            <div style={{ width: '100%', aspectRatio: '16/10', borderRadius: 7, background: active ? 'oklch(0.28 0.05 var(--th) / .5)' : 'rgba(255,255,255,.04)', border: `1.5px solid ${active ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .55)' : 'rgba(255,255,255,.08)'}`, position: 'relative', transition: 'all .18s' }}>
                              {active && <div style={{ position: 'absolute', top: 5, left: '50%', transform: 'translateX(-50%)', width: '38%', height: 7, borderRadius: '0 0 6px 6px', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.6 calc(0.15 * var(--cs, 1)) var(--th)))', boxShadow: '0 0 10px oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .6)' }} />}
                            </div>
                            <span style={{ color: active ? 'oklch(0.88 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 11, fontWeight: 500 }}>{n === 1 ? '主显示器' : '副显示器'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {/* 自动化规则：当 X 则 Y */}
          <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: 'oklch(0.7 calc(0.08 * var(--cs, 1)) var(--th) / .8)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em' }}>⚙ 自动化 · 当 X 则 Y</div>
            {AUTOMATION.map((r) => (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 12.5 }}>{r.label}</span>
                  <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10.5 }}>{r.desc}</span>
                </div>
                <div style={track(p.settings[r.key])} onClick={() => p.onToggle(r.key)}>
                  <div style={knob(p.settings[r.key])} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 问答助手模型 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 9 }} onClick={p.onToggleLlm}>
          <div style={{ font: "600 10.5px 'Segoe UI',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase', color: 'oklch(0.65 0.02 var(--th) / .6)' }}>问答助手模型</div>
          <span style={{ color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 10, transition: 'transform .2s', transform: p.llm.open ? 'rotate(180deg)' : undefined }}>▾</span>
          <span style={{ marginLeft: 'auto', color: 'oklch(0.72 calc(0.08 * var(--cs, 1)) var(--th) / .8)', fontSize: 10.5 }}>{llmSummary}</span>
        </div>
        {p.llm.open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 14, background: 'rgba(0,0,0,.22)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={labelSm}>供应商</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PROVIDERS.map((pr) => {
                  const sel = pr.key === p.llm.provider
                  return (
                    <div key={pr.key} onClick={() => p.onSetProvider(pr.key)} style={{ padding: '6px 11px', borderRadius: 9, background: sel ? 'oklch(0.3 0.05 var(--th) / .4)' : 'rgba(255,255,255,.04)', border: `1px solid ${sel ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.08)'}`, color: sel ? 'oklch(0.94 0.01 var(--th))' : 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 11.5, fontWeight: 500, cursor: 'pointer', transition: 'all .15s' }}>
                      {pr.label}
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={labelSm}>型号（每家可添加多个 · 点选使用 · 问答界面可随时切换）</div>
              {(p.llm.modelLists[p.llm.provider] || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(p.llm.modelLists[p.llm.provider] || []).map((m) => {
                    const sel = m === p.llm.model
                    return (
                      <div key={m} onClick={() => p.onPickModel(m)} className="hv" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 8, background: sel ? 'oklch(0.3 0.05 var(--th) / .4)' : 'rgba(255,255,255,.04)', border: `1px solid ${sel ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.08)'}`, cursor: 'pointer' }}>
                        <span style={{ color: sel ? 'oklch(0.94 0.01 var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 11, fontFamily: 'ui-monospace,monospace' }}>{m}</span>
                        {sel && <span style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', fontSize: 9, fontWeight: 700 }}>使用中</span>}
                        <span onClick={(e) => { e.stopPropagation(); p.onRemoveModel(m) }} title="删除此型号" style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11, cursor: 'pointer' }}>✕</span>
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={modelDraft}
                  onChange={(e) => setModelDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && modelDraft.trim()) { p.onAddModel(modelDraft.trim()); setModelDraft('') } }}
                  placeholder="输入 model id 添加，如 deepseek-v4-pro"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <div
                  className="hv"
                  onClick={() => { if (modelDraft.trim()) { p.onAddModel(modelDraft.trim()); setModelDraft('') } }}
                  style={{ padding: '8px 14px', borderRadius: 9, background: modelDraft.trim() ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: modelDraft.trim() ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 12, fontWeight: 700, cursor: modelDraft.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
                >
                  ＋ 添加
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={labelSm}>Base URL</div>
              <input value={p.llm.baseUrl} onChange={(e) => p.onSetLlmField('baseUrl', e.target.value)} placeholder="https://api.example.com/v1" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={labelSm}>API Key</div>
              <input value={p.llm.apiKey} onChange={(e) => p.onSetLlmField('apiKey', e.target.value)} type="password" placeholder="sk-••••••••••••" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div onClick={p.onTestLlm} style={{ padding: '7px 14px', borderRadius: 999, background: p.llm.testStatus === 'testing' ? 'oklch(0.7 calc(0.06 * var(--cs, 1)) var(--th))' : 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {p.llm.testStatus === 'testing' && <span style={{ display: 'inline-block', width: 11, height: 11, border: '2px solid oklch(0.14 0.02 var(--th) / .3)', borderTopColor: 'oklch(0.14 0.02 var(--th))', borderRadius: 999, animation: 'ai-ring .7s linear infinite' }} />}
                测试连通性
              </div>
              {p.llm.testMsg && <span style={{ color: p.llm.testStatus === 'ok' ? 'oklch(0.8 calc(0.14 * var(--cs, 1)) var(--th))' : p.llm.testStatus === 'fail' ? 'oklch(0.72 0.15 30)' : 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 11, flex: 1 }}>{p.llm.testMsg}</span>}
            </div>
            <div style={{ height: 1, background: 'rgba(255,255,255,.07)' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={labelSm}>已保存的配置</div>
              <div onClick={p.onSaveLlm} style={{ padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.85 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>＋ 保存当前</div>
            </div>
            {p.llm.saved.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {p.llm.saved.map((c) => {
                  const active = c.provider === p.llm.provider && c.model === p.llm.model && c.baseUrl === p.llm.baseUrl
                  return (
                    <div key={c.id} onClick={() => p.onLoadLlm(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: active ? 'oklch(0.3 0.05 var(--th) / .3)' : 'rgba(255,255,255,.03)', border: `1px solid ${active ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .4)' : 'rgba(255,255,255,.06)'}`, cursor: 'pointer' }}>
                      <div style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' : 'oklch(0.5 0.02 var(--th) / .5)' }} />
                      <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 11.5, fontFamily: "ui-monospace,'Cascadia Code',monospace", flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      {active && <span style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', fontSize: 10, fontWeight: 700 }}>使用中</span>}
                      <span onClick={(e) => { e.stopPropagation(); p.onDeleteLlm(c.id) }} style={{ color: 'oklch(0.65 0.02 var(--th) / .55)', fontSize: 12, cursor: 'pointer' }}>✕</span>
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 10, lineHeight: 1.5 }}>仅用于「问答助手」。Agent（Claude Code / Codex）的模型在各自 CLI 中已配置，此处不涉及。兼容 OpenAI Chat Completions 协议的服务均可接入，密钥仅保存在本机。</div>
          </div>
        )}
      </div>

      {/* 飞书日历（CalDAV 主通道 / ICS 备选）—— 可折叠；标题固定横排不换行 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: calOpen ? 9 : 0, minWidth: 0 }} onClick={() => setCalOpen((v) => !v)}>
          <div style={{ flex: 'none', whiteSpace: 'nowrap', font: "600 10.5px 'Segoe UI',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase', color: 'oklch(0.65 0.02 var(--th) / .6)' }}>飞书日历</div>
          <span style={{ flex: 'none', color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 10, transition: 'transform .2s', transform: calOpen ? 'rotate(180deg)' : undefined }}>▾</span>
          <span style={{ marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p.calMsg.startsWith('同步失败') ? 'oklch(0.72 0.15 30)' : 'oklch(0.72 calc(0.08 * var(--cs, 1)) var(--th) / .8)', fontSize: 10.5 }}>
            {p.caldav.server || p.icsUrl ? (p.calMsg || '已配置') : '未配置'}
          </span>
        </div>
        {calOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={labelSm}>CalDAV 同步（推荐 · 飞书官方支持）</div>
          <input value={cdDraft.server} onChange={(e) => setCdDraft((d) => ({ ...d, server: e.target.value }))} placeholder="服务器地址，如 https://caldav.feishu.cn" style={inputStyle} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={cdDraft.username} onChange={(e) => setCdDraft((d) => ({ ...d, username: e.target.value }))} placeholder="用户名" style={{ ...inputStyle, flex: 1 }} />
            <input value={cdDraft.password} onChange={(e) => setCdDraft((d) => ({ ...d, password: e.target.value }))} type="password" placeholder="密码" style={{ ...inputStyle, flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              className="hv"
              onClick={() => p.onSetCaldav({ server: cdDraft.server.trim(), username: cdDraft.username.trim(), password: cdDraft.password })}
              style={{ padding: '7px 16px', borderRadius: 999, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              保存并同步
            </div>
            {p.calMsg && <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p.calMsg.startsWith('同步失败') ? 'oklch(0.72 0.15 30)' : 'oklch(0.78 calc(0.14 * var(--cs, 1)) var(--th))', fontSize: 10.5 }}>{p.calMsg}</span>}
          </div>
          <div style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 10, lineHeight: 1.6 }}>
            获取方式：飞书 PC 端 → 右上角<b style={{ color: 'oklch(0.75 0.02 var(--th) / .8)' }}>个人头像 → 设置 → 日历 → CalDAV 同步</b> → 选设备类型（Windows/其他）→ 点「生成」，把 服务器地址/用户名/密码 填到上面。今日会议显示在「待办」页顶部（含一键入会），会前 5 分钟弹岛提醒，每 10 分钟刷新。密码仅加密存本机。
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,.06)' }} />
          <div style={labelSm}>ICS 订阅链接（备选 · 部分企业不开放）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={icsDraft} onChange={(e) => setIcsDraft(e.target.value)} placeholder="webcal:// 或 https://…/xxx.ics" style={{ ...inputStyle, flex: 1 }} />
            <div className="hv" onClick={() => p.onSetIcsUrl(icsDraft.trim())} style={{ padding: '8px 12px', borderRadius: 9, background: 'rgba(255,255,255,.06)', color: 'oklch(0.8 0.02 var(--th) / .85)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>保存</div>
          </div>
        </div>
        )}
      </div>

      {/* 常驻迷你条自定义 —— 可折叠；标题固定横排 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: barOpen ? 9 : 0, minWidth: 0 }} onClick={() => setBarOpen((v) => !v)}>
          <div style={{ flex: 'none', whiteSpace: 'nowrap', font: "600 10.5px 'Segoe UI',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase', color: 'oklch(0.65 0.02 var(--th) / .6)' }}>常驻迷你条</div>
          <span style={{ flex: 'none', color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 10, transition: 'transform .2s', transform: barOpen ? 'rotate(180deg)' : undefined }}>▾</span>
          <span style={{ marginLeft: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'oklch(0.72 calc(0.08 * var(--cs, 1)) var(--th) / .8)', fontSize: 10.5 }}>
            {p.settings.ambientBar ? `已开启 · ${p.barCfg.modes.length} 种内容` : '未开启（在上方通用里开启）'}
          </span>
        </div>
        {barOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 14, background: 'rgba(0,0,0,.22)' }}>
            <div style={labelSm}>轮播内容（多选，每 11 秒切换）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BAR_MODES.map((m) => {
                const on = p.barCfg.modes.includes(m.key)
                return (
                  <div
                    key={m.key}
                    className="hv"
                    onClick={() => p.onSetBarCfg({ ...p.barCfg, modes: on ? p.barCfg.modes.filter((x) => x !== m.key) : [...p.barCfg.modes, m.key] })}
                    style={{ padding: '5px 11px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: on ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', color: on ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)' }}
                  >
                    {m.label}
                  </div>
                )
              })}
            </div>
            <div style={labelSm}>迷你条宽度 · {p.barCfg.width || 340}px（独立于灵动岛宽度；超长文字自动滚动）</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, flex: 'none' }}>240</span>
              <input type="range" min={240} max={880} step={10} value={p.barCfg.width || 340} onChange={(e) => p.onSetBarCfg({ ...p.barCfg, width: Number(e.target.value) })} style={{ flex: 1, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }} />
              <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, flex: 'none' }}>880</span>
            </div>
            <div style={{ color: 'oklch(0.55 0.02 var(--th) / .55)', fontSize: 10, lineHeight: 1.5 }}>文字一律白色，彩色只用于光效；文字/时钟/音乐可与小宠物叠加显示。</div>
            <div style={labelSm}>颜色</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {([['theme', '跟随主题'], ['rainbow', '多彩'], ['custom', '自定义']] as const).map(([k, label]) => (
                <div key={k} className="hv" onClick={() => p.onSetBarCfg({ ...p.barCfg, colorMode: k })} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: p.barCfg.colorMode === k ? 'oklch(0.3 0.05 var(--th) / .5)' : 'rgba(255,255,255,.05)', border: `1px solid ${p.barCfg.colorMode === k ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.08)'}`, color: 'oklch(0.85 0.02 var(--th) / .9)' }}>
                  {label}
                </div>
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
                    <div key={e} className="hv" onClick={() => p.onSetBarCfg({ ...p.barCfg, petEmoji: e })} style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, cursor: 'pointer', background: p.barCfg.petEmoji === e ? 'oklch(0.3 0.05 var(--th) / .5)' : 'rgba(255,255,255,.05)', border: `1px solid ${p.barCfg.petEmoji === e ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .5)' : 'rgba(255,255,255,.08)'}` }}>
                      {e}
                    </div>
                  ))}
                </div>
              </>
            )}
            {/* 自定义轮播主题：AI 每 10 分钟按你的描述生成一批内容 */}
            <div style={labelSm}>自定义主题（AI 按描述持续生成内容，聚合进「自定义主题」模式）</div>
            {(p.barCfg.customTopics || []).map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 9, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ flex: 'none', color: 'oklch(0.9 0.02 var(--th))', fontSize: 11, fontWeight: 700 }}>{t.name}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 10 }}>{t.hint}</span>
                <span className="hv" onClick={() => p.onSetBarCfg({ ...p.barCfg, customTopics: (p.barCfg.customTopics || []).filter((x) => x.id !== t.id) })} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 11 }}>✕</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={topicName} onChange={(e) => setTopicName(e.target.value)} placeholder="主题名，如：Rust 技巧" style={{ ...inputStyle, width: 120, fontFamily: "'Segoe UI',sans-serif", fontSize: 11, padding: '6px 9px' }} />
              <input value={topicHint} onChange={(e) => setTopicHint(e.target.value)} placeholder="给 AI 的描述：想看什么内容…" style={{ ...inputStyle, flex: 1, fontFamily: "'Segoe UI',sans-serif", fontSize: 11, padding: '6px 9px' }} />
              <div
                className="hv"
                onClick={() => {
                  if (!topicName.trim()) return
                  p.onSetBarCfg({ ...p.barCfg, customTopics: [...(p.barCfg.customTopics || []), { id: Date.now(), name: topicName.trim(), hint: topicHint.trim() || topicName.trim() }], modes: p.barCfg.modes.includes('custom') ? p.barCfg.modes : [...p.barCfg.modes, 'custom'] })
                  setTopicName(''); setTopicHint('')
                }}
                style={{ padding: '6px 13px', borderRadius: 9, background: topicName.trim() ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: topicName.trim() ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ＋ 添加
              </div>
            </div>
            {/* AI 10 分钟刷新开关 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 12 }}>AI 每 10 分钟刷新内容</span>
                <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10 }}>名言/经验/方法论/热管理/自定义主题持续出新（用问答模型，产生调用费用）</span>
              </div>
              <div style={track(p.barCfg.aiRefresh !== false)} onClick={() => p.onSetBarCfg({ ...p.barCfg, aiRefresh: p.barCfg.aiRefresh === false ? true : false })}>
                <div style={knob(p.barCfg.aiRefresh !== false)} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div className="hv" onClick={() => { setBarAiMsg('✨ 正在提炼…'); void p.onAiBarQuotes().then(setBarAiMsg) }} style={{ padding: '6px 14px', borderRadius: 999, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ✨ AI 生成我的个性语录
              </div>
              <div className="hv" onClick={() => { setBarAiMsg('⚡ 正在生成各主题内容…'); void p.onRefreshBarContent().then(setBarAiMsg) }} style={{ padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,.06)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .4)', color: 'oklch(0.88 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ⚡ 立即生成主题内容
              </div>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: barAiMsg.startsWith('✓') ? 'oklch(0.8 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5 }}>
                {barAiMsg || `个性语录${p.barCfg.customQuotes.length ? `已有 ${p.barCfg.customQuotes.length} 条` : '未生成'}；自定义主题由 AI 持续供给内容`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 后端接入 */}
      <div>
        <div style={sectionTitle}>后端接入</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 12.5 }}>自动接入所有 CLI / 终端</span>
            <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10.5 }}>开启后，任何 Claude Code / Codex 会话都实时通信</span>
          </div>
          <div style={track(p.settings.autoConnect)} onClick={() => p.onToggle('autoConnect')}>
            <div style={knob(p.settings.autoConnect)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <div onClick={() => { p.onInstallHooks(); setHookMsg('已接入 · 全局写入，所有会话的生命周期会实时反映到岛') }} style={{ flex: 1, textAlign: 'center', padding: '8px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.82 0.02 var(--th) / .85)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>立即重新接入</div>
          <div onClick={() => { p.onUninstallHooks(); setHookMsg('已断开 · 已从全局配置移除本工具的 hook（可还原）') }} style={{ flex: 1, textAlign: 'center', padding: '8px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .7)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>暂时断开</div>
        </div>
        {hookMsg && <div style={{ color: 'oklch(0.78 calc(0.14 * var(--cs, 1)) var(--th))', fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>{hookMsg}</div>}
        <div style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>全局合并写入 ~/.claude/settings.json 与 ~/.codex/hooks.json（不覆盖已有配置，可随时还原）。覆盖会话开始 / 对话 / 工具活动 / 命令审批 / 完成全生命周期；岛未运行时 CLI 照常工作，零影响。</div>
      </div>

      {/* 已支持工具 */}
      <div>
        <div style={sectionTitle}>已支持的工具 · {enabledTools}/4 启用</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TOOLS.map((t) => {
            const on = p.settings[t.key]
            const isApp = /App$/.test(t.key)
            const dotColor = on ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' : 'oklch(0.5 0.02 var(--th) / .5)'
            return (
              <div key={t.key} onClick={() => p.onToggle(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 11, background: on ? 'oklch(0.3 0.05 var(--th) / .3)' : 'rgba(255,255,255,.03)', border: `1px solid ${on ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)' : 'rgba(255,255,255,.06)'}`, cursor: 'pointer' }}>
                {isApp ? (
                  <div style={{ width: 17, height: 17, flex: 'none', borderRadius: 5, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 10, height: 8, border: `1px solid ${dotColor}`, borderRadius: 2, overflow: 'hidden' }}><div style={{ height: 2, background: dotColor }} /></div>
                  </div>
                ) : (
                  <div style={{ width: 17, height: 17, flex: 'none', borderRadius: 5, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: dotColor, fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 9.5, fontWeight: 700 }}>›_</div>
                )}
                <span style={{ color: on ? 'oklch(0.92 0.01 var(--th))' : 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 11.5, fontWeight: 500 }}>{t.label}</span>
              </div>
            )
          })}
        </div>
        <div style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 10.5, marginTop: 9 }}>当前支持 Claude Code、Codex 的 CLI 与桌面端，共 4 种。</div>
      </div>

      {/* 退出应用（右下角托盘图标同样可退出/重启） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <div className="hv" onClick={p.onQuitApp} style={{ padding: '7px 18px', borderRadius: 999, background: 'oklch(0.32 0.09 25 / .35)', border: '1px solid oklch(0.6 0.13 25 / .4)', color: 'oklch(0.85 0.1 25)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
          ⏻ 退出 Agentic-Island
        </div>
        <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 10 }}>也可以右键屏幕右下角托盘图标退出 / 重启</span>
      </div>
    </div>
  )
}

const labelSm: React.CSSProperties = { color: 'oklch(0.68 0.02 var(--th) / .7)', fontSize: 10.5, fontWeight: 600 }
