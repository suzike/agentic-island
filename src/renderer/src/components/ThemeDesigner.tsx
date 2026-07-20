// 主题设计器 v3：独立 OKLCH 通道、模块预览、通道锁定、可访问性审计与 AI/JSON 工作流。

import { useEffect, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import {
  BatteryCharging, Bluetooth, Check, ClipboardPaste, Code2, Contrast, Copy, Dices,
  LayoutGrid, ListTodo, Lock, MessageCircle, Monitor, Moon, Palette, Redo2,
  ShieldCheck, Sparkles, Sun, Undo2, Unlock, Volume2, WandSparkles, Wifi, X
} from 'lucide-react'
import {
  applyThemeTokens, hexToOklch, huesForHarmony, normalizeThemeIdentity, normalizeThemeTokens, oklchToHex,
  parseThemeIdentity, themeContrastRatios, type ThemeHarmony, type ThemeIdentity, type ThemeMode, type ThemeTokenInput
} from '../logic/themes'
import { Button, Chip, IconButton, Input, Segmented, Slider } from '../ui/components'
import { overlayPop } from '../ui/motion'
import { accent, accent2, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'

export interface Tokens {
  th: number
  th2: number
  ths: number
  cs: number
  css: number
  pl: number
  mode: ThemeMode
  bg: number
  ga: number
  fi: number
  bl: number
  sh: number
  c1: number
  c2: number
  sc: number
  l1: number
  l2: number
  tx: number
  gr: number
}

type HueChannel = 'th' | 'th2' | 'ths'
type PreviewMode = 'control' | 'workspace' | 'data' | 'terminal'

const toInput = (t: Tokens): ThemeTokenInput => ({
  th: String(Math.round(t.th)), th2: String(Math.round(t.th2)), ths: String(Math.round(t.ths)),
  cs: String(Number(t.cs.toFixed(2))), css: String(Number(t.css.toFixed(2))), pl: String(Number(t.pl.toFixed(2))),
  mode: t.mode, bg: String(Number(t.bg.toFixed(2))), ga: String(Number(t.ga.toFixed(2))),
  fi: String(Number(t.fi.toFixed(2))), bl: String(Math.round(t.bl)), sh: String(Number(t.sh.toFixed(2))),
  c1: String(Number(t.c1.toFixed(3))), c2: String(Number(t.c2.toFixed(3))), sc: String(Number(t.sc.toFixed(3))),
  l1: String(Number(t.l1.toFixed(2))), l2: String(Number(t.l2.toFixed(2))), tx: String(Number(t.tx.toFixed(2))), gr: String(Math.round(t.gr))
})

const fromInput = (input: Partial<ThemeTokenInput>): Tokens | null => {
  if (input.th === undefined && input.th2 === undefined && input.ths === undefined) return null
  const t = normalizeThemeTokens(input)
  return {
    th: +t.th, th2: +t.th2, ths: +t.ths, cs: +t.cs, css: +t.css, pl: +t.pl,
    mode: t.mode, bg: +t.bg, ga: +t.ga, fi: +t.fi, bl: +t.bl, sh: +t.sh,
    c1: +t.c1, c2: +t.c2, sc: +t.sc, l1: +t.l1, l2: +t.l2, tx: +t.tx, gr: +t.gr
  }
}

const preset = (input: ThemeTokenInput): Tokens => fromInput(input)!
const HUES = Array.from({ length: 24 }, (_, i) => i * 15)
const HUE_TRACK = 'linear-gradient(90deg, oklch(.72 .16 0), oklch(.72 .16 45), oklch(.78 .15 90), oklch(.72 .16 135), oklch(.72 .14 180), oklch(.7 .15 225), oklch(.68 .17 270), oklch(.7 .17 315), oklch(.72 .16 360))'

const PRESETS: { label: string; t: Tokens }[] = [
  { label: '冰川', t: preset({ th: '252', th2: '210', ths: '244', cs: '1.05', css: '1.55', mode: 'light', bg: '.82', ga: '.9', fi: '1.22', bl: '38', sh: '.62', c1: '.168', c2: '.145', sc: '.031', l1: '.54', l2: '.61', tx: '.16', gr: '145' }) },
  { label: '晨雾', t: preset({ th: '195', th2: '165', ths: '205', cs: '.72', css: '1.2', mode: 'light', bg: '.88', ga: '.86', fi: '1.05', bl: '42', sh: '.42', c1: '.115', c2: '.1', sc: '.024', l1: '.54', l2: '.58', tx: '.14', gr: '120' }) },
  { label: '森林', t: preset({ th: '150', th2: '110', ths: '160', cs: '.85', css: '1', mode: 'dark', bg: '.14', ga: '.95', fi: '1', bl: '30', sh: '.9', c1: '.136', c2: '.12', sc: '.02', l1: '.8', l2: '.78', tx: '.96', gr: '150' }) },
  { label: '深海', t: preset({ th: '220', th2: '190', ths: '230', cs: '.9', css: '1.2', mode: 'dark', bg: '.12', ga: '.97', fi: '.92', bl: '34', sh: '1.1', c1: '.144', c2: '.13', sc: '.024', l1: '.82', l2: '.78', tx: '.97', gr: '165' }) },
  { label: '熔岩', t: preset({ th: '35', th2: '5', ths: '20', cs: '1.2', css: '1.3', mode: 'dark', bg: '.13', ga: '.96', fi: '1.1', bl: '26', sh: '1.15', c1: '.192', c2: '.18', sc: '.026', l1: '.8', l2: '.74', tx: '.96', gr: '115' }) },
  { label: '薰衣草', t: preset({ th: '300', th2: '260', ths: '290', cs: '.7', css: '.9', mode: 'light', bg: '.86', ga: '.88', fi: '1.15', bl: '40', sh: '.5', c1: '.112', c2: '.105', sc: '.018', l1: '.54', l2: '.58', tx: '.16', gr: '140' }) },
  { label: '石墨', t: preset({ th: '250', th2: '250', ths: '250', cs: '.25', css: '.4', mode: 'dark', bg: '.105', ga: '.99', fi: '.75', bl: '22', sh: '1.2', c1: '.04', c2: '.038', sc: '.008', l1: '.8', l2: '.76', tx: '.96', gr: '180' }) }
]

const HARMONIES: { key: ThemeHarmony; label: string }[] = [
  { key: 'analogous', label: '邻近' }, { key: 'complementary', label: '互补' },
  { key: 'split', label: '分裂互补' }, { key: 'triadic', label: '三角色' }
]

const MATERIAL_SLIDERS: { key: keyof Pick<Tokens, 'ga' | 'fi' | 'bl' | 'sh' | 'gr'>; label: string; min: number; max: number; step: number }[] = [
  { key: 'ga', label: '主题透明度', min: .25, max: 1, step: .01 },
  { key: 'fi', label: '层级强度', min: .45, max: 1.8, step: .02 },
  { key: 'bl', label: '背景模糊', min: 8, max: 56, step: 1 },
  { key: 'sh', label: '阴影强度', min: 0, max: 1.5, step: .02 },
  { key: 'gr', label: '渐变方向', min: 0, max: 360, step: 1 }
]

const sameTokens = (a: Tokens, b: Tokens): boolean => JSON.stringify(a) === JSON.stringify(b)
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const tile: CSSProperties = { background: fill(3), borderRadius: R.md, padding: '8px 9px', minHeight: 35 }
const previewShell: CSSProperties = {
  minHeight: 218, borderRadius: R.xl, padding: 10,
  background: 'linear-gradient(155deg, oklch(var(--panel-hi-l) var(--surface-c) var(--ths) / calc(var(--preview-glass-a, var(--glass-a)) * .98)), oklch(var(--panel-low-l) var(--surface-c) var(--ths) / var(--preview-glass-a, var(--glass-a))))',
  boxShadow: '0 16px 32px -18px rgb(0 0 0 / calc(.55 * var(--shadow-k)))',
  border: `0.5px solid ${hairline(.15)}`, backdropFilter: 'blur(var(--glass-blur))'
}

function ControlPreview({ mode }: { mode: ThemeMode }): React.JSX.Element {
  const row = { ...tile, display: 'flex', alignItems: 'center', gap: 7 } as CSSProperties
  const icon = { width: 23, height: 23, borderRadius: R.pill, display: 'grid', placeItems: 'center', color: ink(1), background: fill(4), flex: 'none' } as CSSProperties
  const activeIcon = { ...icon, color: gradient.onPrimary(), background: gradient.primary() }
  return <div style={previewShell}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
      <div style={row}><span style={activeIcon}><Wifi size={12} /></span><div><div style={{ ...text.dim(), color: ink(1), fontWeight: 650 }}>网络</div><div style={text.faint()}>已连接</div></div></div>
      <div style={row}><span style={activeIcon}><Bluetooth size={12} /></span><div><div style={{ ...text.dim(), color: ink(1), fontWeight: 650 }}>蓝牙</div><div style={text.faint()}>开启</div></div></div>
      <div style={row}><span style={icon}><Monitor size={12} /></span><div><div style={{ ...text.dim(), color: ink(1), fontWeight: 650 }}>工作区</div><div style={text.faint()}>标准</div></div></div>
      <div style={row}><span style={icon}>{mode === 'light' ? <Sun size={12} /> : <Moon size={12} />}</span><div><div style={{ ...text.dim(), color: ink(1), fontWeight: 650 }}>外观</div><div style={text.faint()}>{mode === 'light' ? '浅色' : '深色'}</div></div></div>
    </div>
    <div style={{ ...tile, marginTop: 7 }}><div style={{ ...text.dim(), color: ink(1), fontWeight: 650 }}>显示</div><div style={{ height: 7, borderRadius: R.pill, marginTop: 8, background: fill(4), overflow: 'hidden' }}><div style={{ width: '72%', height: '100%', background: gradient.brand() }} /></div></div>
    <div style={{ ...row, marginTop: 7 }}><span style={icon}><Volume2 size={12} /></span><div style={{ flex: 1 }}><div style={{ ...text.dim(), color: ink(1), fontWeight: 650 }}>声音</div><div style={{ height: 5, borderRadius: R.pill, marginTop: 5, background: fill(4), overflow: 'hidden' }}><div style={{ width: '63%', height: '100%', background: accent(.78) }} /></div></div><BatteryCharging size={13} color={accent()} /></div>
  </div>
}

function WorkspacePreview(): React.JSX.Element {
  return <div style={{ ...previewShell, display: 'flex', flexDirection: 'column', gap: 7 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ ...text.subtitle(), flex: 1 }}>今日工作台</span><span style={{ ...text.faint(), color: accent() }}>3 个进行中</span></div>
    {['修复浅色主题兼容', '整理版本发布清单', '审核 Agent 运行记录'].map((label, i) => <div key={label} style={{ ...tile, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 15, height: 15, borderRadius: R.pill, border: `2px solid ${i ? hairline(.25) : accent()}`, background: i ? 'transparent' : semBg(accent(), .2) }} /><div style={{ flex: 1 }}><div style={{ ...text.dim(), color: ink(1) }}>{label}</div><div style={text.faint()}>{i === 0 ? '高优先级 · 今天' : '项目任务 · 本周'}</div></div><span style={{ width: 5, height: 22, borderRadius: R.pill, background: i === 1 ? accent2() : accent() }} /></div>)}
    <div style={{ display: 'flex', gap: 6 }}><Button sm variant="primary">开始专注</Button><Button sm variant="ghost">AI 拆解</Button></div>
  </div>
}

function DataPreview(): React.JSX.Element {
  const bars = [46, 68, 54, 82, 64, 91, 76]
  return <div style={{ ...previewShell, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', gap: 8 }}>{[['完成率', '78%'], ['专注', '4.2h'], ['待处理', '12']].map(([k, v], i) => <div key={k} style={{ ...tile, flex: 1 }}><div style={text.faint()}>{k}</div><div style={{ ...text.num(FS.title), color: i === 2 ? accent2() : ink(1), marginTop: 3 }}>{v}</div></div>)}</div>
    <div style={{ ...tile, flex: 1 }}><div style={{ ...text.dim(), color: ink(1), fontWeight: 650 }}>近 7 天执行趋势</div><div style={{ height: 92, display: 'flex', alignItems: 'end', gap: 8, paddingTop: 10 }}>{bars.map((height, i) => <div key={i} style={{ flex: 1, height: `${height}%`, minWidth: 8, borderRadius: '5px 5px 2px 2px', background: i === bars.length - 1 ? gradient.primary() : `color-mix(in oklch, ${i % 2 ? accent2() : accent()} 58%, ${fill(3)})` }} />)}</div></div>
  </div>
}

function TerminalPreview(): React.JSX.Element {
  return <div style={{ ...previewShell, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: fill(2), borderBottom: `0.5px solid ${hairline(.1)}` }}><span style={{ width: 8, height: 8, borderRadius: R.pill, background: sem.danger }} /><span style={{ width: 8, height: 8, borderRadius: R.pill, background: sem.warn }} /><span style={{ width: 8, height: 8, borderRadius: R.pill, background: sem.calm }} /><span style={{ ...text.faint(), marginLeft: 4 }}>PowerShell · 项目终端</span></div>
    <div style={{ flex: 1, padding: 13, background: 'oklch(.095 .015 var(--ths))', color: 'oklch(.92 .01 var(--th))', font: "11px/1.75 'Cascadia Code', monospace" }}><div><span style={{ color: accent() }}>PS</span> npm run typecheck</div><div style={{ color: sem.calm }}>✓ renderer types passed</div><div style={{ color: sem.calm }}>✓ node types passed</div><div style={{ color: 'oklch(.72 .02 var(--th))' }}>ready in 1.84s</div><div><span style={{ color: accent2() }}>PS</span> <span style={{ opacity: .7 }}>_</span></div></div>
  </div>
}

function ThemePreview({ mode, view }: { mode: ThemeMode; view: PreviewMode }): React.JSX.Element {
  if (view === 'workspace') return <WorkspacePreview />
  if (view === 'data') return <DataPreview />
  if (view === 'terminal') return <TerminalPreview />
  return <ControlPreview mode={mode} />
}

export function ThemeDesigner({ open, seed, seedName, seedDescription, seedTags, editKey, onSave, onClose, onAI, llmReady }: {
  open: boolean
  seed: Tokens
  seedName?: string
  seedDescription?: string
  seedTags?: string[]
  editKey?: string
  onSave: (name: string, t: Tokens, metadata: Pick<ThemeIdentity, 'desc' | 'tags'>, editKey?: string) => void
  onClose: () => void
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  llmReady: boolean
}): React.JSX.Element | null {
  const [t, setT] = useState<Tokens>(seed)
  const [name, setName] = useState('我的主题')
  const [description, setDescription] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [channel, setChannel] = useState<HueChannel>('th')
  const [preview, setPreview] = useState<PreviewMode>('control')
  const [locks, setLocks] = useState<Record<HueChannel, boolean>>({ th: false, th2: false, ths: false })
  const [history, setHistory] = useState<Tokens[]>([])
  const [future, setFuture] = useState<Tokens[]>([])
  const [aiDesc, setAiDesc] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [namingBusy, setNamingBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // seed 是 App 每次渲染都会重建的对象，只应在浮层开启的瞬间读取。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setT(seed); setName(seedName || '我的主题'); setDescription(seedDescription || ''); setTagsText((seedTags || []).join('，')); setChannel('th'); setPreview('control'); setLocks({ th: false, th2: false, ths: false }); setHistory([]); setFuture([]); setAiDesc(''); setMsg(''); setNamingBusy(false) } }, [open])
  useEffect(() => { if (open) applyThemeTokens(toInput(t)) }, [t, open])

  if (!open) return null

  const flash = (message: string): void => { setMsg(message); setTimeout(() => setMsg(''), 2400) }
  const commit = (next: Tokens): void => {
    if (sameTokens(next, t)) return
    setHistory((items) => [...items, t].slice(-40)); setFuture([]); setT(next)
  }
  const patch = (next: Partial<Tokens>): void => commit({ ...t, ...next })
  const undo = (): void => { const previous = history.at(-1); if (!previous) return; setHistory((items) => items.slice(0, -1)); setFuture((items) => [t, ...items].slice(0, 40)); setT(previous) }
  const redo = (): void => { const next = future[0]; if (!next) return; setFuture((items) => items.slice(1)); setHistory((items) => [...items, t].slice(-40)); setT(next) }
  const setMode = (mode: ThemeMode): void => {
    if (mode === t.mode) return
    patch(mode === 'light'
      ? { mode, bg: Math.max(.76, t.bg), tx: .16, l1: Math.min(.54, t.l1), l2: Math.min(.58, t.l2), ga: Math.min(.94, t.ga), fi: Math.max(1.05, t.fi), sh: Math.min(.75, t.sh) }
      : { mode, bg: Math.min(.24, t.bg), tx: .96, l1: Math.max(.76, t.l1), l2: Math.max(.74, t.l2), ga: Math.max(.9, t.ga), fi: Math.min(1.25, t.fi), sh: Math.max(.75, t.sh) })
  }
  const applyHarmony = (harmony: ThemeHarmony): void => {
    const related = huesForHarmony(t.th, harmony)
    patch({ ...(locks.th2 ? {} : { th2: related.th2 }), ...(locks.ths ? {} : { ths: related.ths }) })
  }
  const randomize = (): void => {
    const primary = locks.th ? t.th : Math.floor(Math.random() * 360)
    const harmony = HARMONIES[Math.floor(Math.random() * HARMONIES.length)].key
    const related = huesForHarmony(primary, harmony)
    const next = { ...t }
    if (!locks.th) Object.assign(next, { th: primary, c1: Number((.09 + Math.random() * .12).toFixed(3)) })
    if (!locks.th2) Object.assign(next, { th2: related.th2, c2: Number((.08 + Math.random() * .12).toFixed(3)) })
    if (!locks.ths) Object.assign(next, { ths: related.ths, sc: Number((.01 + Math.random() * .035).toFixed(3)) })
    next.cs = Number((next.c1 / .16).toFixed(2)); next.css = Number((next.sc / .02).toFixed(2)); commit(next)
  }
  const channelValues = channel === 'th'
    ? { h: t.th, c: t.c1, l: t.l1, cKey: 'c1' as const, lKey: 'l1' as const }
    : channel === 'th2'
      ? { h: t.th2, c: t.c2, l: t.l2, cKey: 'c2' as const, lKey: 'l2' as const }
      : { h: t.ths, c: t.sc, l: t.bg, cKey: 'sc' as const, lKey: 'bg' as const }
  const patchChannel = (values: { h?: number; c?: number; l?: number }): void => {
    const next: Partial<Tokens> = {}
    if (values.h !== undefined) next[channel] = values.h
    if (values.c !== undefined) {
      next[channelValues.cKey] = values.c
      if (channel === 'th') next.cs = clamp(values.c / .16, .1, 1.4)
      if (channel === 'ths') next.css = clamp(values.c / .02, .1, 2)
    }
    if (values.l !== undefined) next[channelValues.lKey] = values.l
    patch(next)
  }
  const useHex = (hex: string): void => { const color = hexToOklch(hex); if (color) patchChannel({ h: color.h, c: color.c, l: color.l }) }
  const applyVariant = (kind: 'soft' | 'vivid' | 'bright' | 'deep' | 'swap'): void => {
    if (kind === 'swap') {
      if (locks.th || locks.th2) { flash('先解锁主色与副色'); return }
      patch({ th: t.th2, th2: t.th, c1: t.c2, c2: t.c1, l1: t.l2, l2: t.l1 }); return
    }
    const factor = kind === 'soft' ? .72 : kind === 'vivid' ? 1.18 : 1
    const delta = kind === 'bright' ? .05 : kind === 'deep' ? -.05 : 0
    patch({
      ...(locks.th ? {} : { c1: clamp(t.c1 * factor, .01, .28), l1: clamp(t.l1 + delta, .38, .94) }),
      ...(locks.th2 ? {} : { c2: clamp(t.c2 * factor, .01, .28), l2: clamp(t.l2 + delta, .38, .94) }),
      ...(locks.ths ? {} : { sc: clamp(t.sc * factor, .002, .09), bg: clamp(t.bg + delta, t.mode === 'light' ? .68 : .07, t.mode === 'light' ? .94 : .3) })
    })
  }
  const ratios = themeContrastRatios(toInput(t))
  const fixContrast = (): void => {
    const next = { ...t }
    if (ratios.text < 4.5) next.tx = t.mode === 'light' ? .11 : .98
    if (ratios.primary < 4.5) next.l1 = t.mode === 'light' ? .54 : .82
    commit(next); flash('已按 WCAG AA 修正关键对比度')
  }
  const aiGenerate = async (): Promise<void> => {
    const description = aiDesc.trim()
    if (!description || aiBusy) return
    if (!llmReady) { flash('请先在设置里配置问答模型'); return }
    setAiBusy(true)
    const result = await onAI(
      '你是数字产品主题设计师。根据描述输出 Agentic-Island OKLCH 主题令牌 JSON，只输出 JSON：' +
      '{"th":主色相0-360,"th2":副色相0-360,"ths":面板色相0-360,"c1":主色彩度0.01-0.28,"c2":副色彩度0.01-0.28,"sc":面板彩度0.002-0.09,' +
      '"l1":主色明度0.38-0.94,"l2":副色明度0.38-0.94,"tx":文字明度,"mode":"dark或light","bg":面板明度,"ga":主题不透明度0.25-1,"fi":层级强度0.45-1.8,"bl":模糊8-56,"sh":阴影0-1.5,"gr":渐变方向0-360}。' +
      '色相覆盖完整色轮，并保证正文和主按钮达到 WCAG AA。', description)
    setAiBusy(false)
    if (!result.ok || !result.text) { flash(result.error || 'AI 生成失败'); return }
    try {
      const match = result.text.match(/\{[\s\S]*\}/)
      const parsed = fromInput(JSON.parse(match ? match[0] : result.text) as Partial<ThemeTokenInput>)
      if (!parsed) { flash('AI 返回的令牌不完整'); return }
      commit(parsed); flash('已生成，可继续微调')
    } catch { flash('AI 返回的不是有效主题 JSON') }
  }
  const aiNameTheme = async (): Promise<void> => {
    if (namingBusy) return
    if (!llmReady) { flash('请先在设置里配置问答模型'); return }
    setNamingBusy(true)
    const result = await onAI(
      '你是品牌色彩与界面主题命名专家。分析给定的 Agentic-Island OKLCH 主题令牌，为它生成独特、具体且有画面感的中文主题身份。' +
      '只输出 JSON：{"name":"2到8个汉字的主题名","tags":["3到5个简短特征标签"],"desc":"20到50字的主题特征介绍"}。' +
      '名称不能使用“我的主题”“自定义主题”等泛称；标签应覆盖色彩、明暗、材质和氛围，不要重复名称；介绍应说明主副色关系、玻璃质感和适用感受。',
      JSON.stringify({ tokens: toInput(t), contrast: ratios, currentPreview: preview })
    )
    setNamingBusy(false)
    if (!result.ok || !result.text) { flash(result.error || 'AI 命名失败'); return }
    const identity = parseThemeIdentity(result.text)
    if (!identity) { flash('AI 返回的主题身份格式无效'); return }
    setName(identity.name); setTagsText(identity.tags.join('，')); setDescription(identity.desc); flash('主题名称与特征介绍已生成')
  }
  const copyTokens = (): void => { void navigator.clipboard?.writeText(JSON.stringify({ version: 3, ...toInput(t) }, null, 2)).catch(() => {}); flash('主题令牌已复制') }
  const importTokens = async (): Promise<void> => {
    try { const parsed = fromInput(JSON.parse((await navigator.clipboard.readText()).trim()) as Partial<ThemeTokenInput>); if (!parsed) { flash('剪贴板里不是主题令牌 JSON'); return }; commit(parsed); flash('主题令牌已导入') }
    catch { flash('剪贴板里不是主题令牌 JSON') }
  }

  const bgRange = t.mode === 'light' ? { min: .68, max: .94 } : { min: .07, max: .3 }
  const lightRange = channel === 'ths' ? bgRange : { min: .38, max: .94 }
  const chromaMax = channel === 'ths' ? .09 : .28
  const currentHex = oklchToHex({ l: channelValues.l, c: channelValues.c, h: channelValues.h })
  const ratioStyle = (ratio: number): CSSProperties => ({ color: ratio >= 4.5 ? sem.calm : ratio >= 3 ? sem.warn : sem.danger, fontWeight: 750 })
  const identity = normalizeThemeIdentity({ name, desc: description, tags: tagsText.split(/[,，、|]/) }, name.trim() || '自定义')

  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: .15 } }} onMouseDown={onClose}
    style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(var(--overlay-mask-l) .01 var(--ths) / .58)', backdropFilter: 'blur(5px)' }}>
    <motion.div variants={overlayPop} initial="initial" animate="animate" onMouseDown={(e) => e.stopPropagation()}
      style={{ width: 'min(900px, 95vw)', maxHeight: '92vh', overflow: 'hidden', ...surface.overlay(), background: 'oklch(var(--overlay-l) calc(0.025 * var(--css, 1)) var(--ths) / .96)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `${SP.md}px ${SP.lg}px`, borderBottom: `0.5px solid ${hairline(.1)}` }}>
        <span style={{ width: 25, height: 25, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: fill(3), color: accent() }}><Palette size={14} /></span>
        <div style={{ minWidth: 0 }}><div style={text.subtitle()}>{editKey ? `编辑主题 · ${seedName || ''}` : '主题设计器'}</div><div style={text.faint()}>OKLCH 多通道工作台 · 实时全局预览</div></div>
        <span style={{ flex: 1 }} />
        {msg && <span style={{ ...text.faint(), color: accent() }}>{msg}</span>}
        <IconButton icon={Undo2} title="撤销" disabled={!history.length} onClick={undo} />
        <IconButton icon={Redo2} title="重做" disabled={!future.length} onClick={redo} />
        <IconButton icon={X} title="关闭" onClick={onClose} />
      </div>

      <div className="ai-scroll" style={{ maxHeight: 'calc(92vh - 51px)', overflowY: 'auto', padding: SP.lg, display: 'grid', gridTemplateColumns: 'minmax(250px, .92fr) minmax(390px, 1.45fr)', gap: SP.lg, alignItems: 'start' }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: SP.md }}>
          <Segmented value={preview} onChange={setPreview} options={[{ key: 'control', label: '控制', icon: LayoutGrid }, { key: 'workspace', label: '工作', icon: ListTodo }, { key: 'data', label: '数据', icon: MessageCircle }, { key: 'terminal', label: '终端', icon: Code2 }]} style={{ width: '100%', justifyContent: 'space-between' }} />
          <div style={{ '--preview-glass-a': String(t.ga), padding: 4, borderRadius: R.xl + 4, background: 'repeating-conic-gradient(oklch(var(--line-l) .006 var(--th) / .08) 0 25%, transparent 0 50%) 0 / 12px 12px' } as CSSProperties}>
            <ThemePreview mode={t.mode} view={preview} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Segmented value={t.mode} onChange={setMode} options={[{ key: 'dark', label: '深色', icon: Moon }, { key: 'light', label: '浅色', icon: Sun }]} style={{ flex: 1 }} />
            <Button sm variant="ghost" icon={ratios.text >= 4.5 && ratios.primary >= 4.5 ? ShieldCheck : Contrast} onClick={fixContrast}>自动修正</Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <div style={{ ...surface.section(), padding: '8px 10px' }}><div style={text.faint()}>正文 / 面板</div><div style={{ ...text.num(FS.subtitle), ...ratioStyle(ratios.text) }}>{ratios.text.toFixed(2)} : 1</div><div style={text.faint()}>{ratios.text >= 4.5 ? 'AA 通过' : '需要修正'}</div></div>
            <div style={{ ...surface.section(), padding: '8px 10px' }}><div style={text.faint()}>按钮 / 前景</div><div style={{ ...text.num(FS.subtitle), ...ratioStyle(ratios.primary) }}>{ratios.primary.toFixed(2)} : 1</div><div style={text.faint()}>{ratios.primary >= 4.5 ? 'AA 通过' : '需要修正'}</div></div>
          </div>
          <div><div style={{ ...text.overline(), marginBottom: 7 }}>风格起点</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{PRESETS.map((item) => <Chip key={item.label} active={sameTokens(t, item.t)} onClick={() => commit(item.t)}><span style={{ width: 7, height: 7, borderRadius: R.pill, background: `oklch(${item.t.l1} ${item.t.c1} ${item.t.th})` }} />{item.label}</Chip>)}<Chip icon={Dices} onClick={randomize}>智能随机</Chip></div></div>
          <div style={{ display: 'flex', gap: 6 }}><Input value={aiDesc} onChange={setAiDesc} onKeyDown={(e) => { if (e.key === 'Enter') void aiGenerate() }} icon={Sparkles} placeholder="如：晨间雪山、低饱和冷蓝玻璃" style={{ flex: 1 }} /><Button variant="primary" icon={Sparkles} onClick={() => void aiGenerate()}>{aiBusy ? '生成中' : 'AI 配色'}</Button></div>
          <div style={{ display: 'flex', gap: 6 }}><Button sm variant="ghost" icon={Copy} onClick={copyTokens}>导出 JSON</Button><Button sm variant="ghost" icon={ClipboardPaste} onClick={() => void importTokens()}>导入 JSON</Button></div>
        </div>

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: SP.md }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={text.overline()}>独立色彩通道</span><span style={{ flex: 1 }} /><Segmented value={channel} onChange={setChannel} options={[{ key: 'th', label: '主色' }, { key: 'th2', label: '副色' }, { key: 'ths', label: '面板' }]} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(15px, 1fr))', gap: 5 }}>{HUES.map((value) => { const selected = Math.abs(channelValues.h - value) < 7.5 || (channelValues.h > 352.5 && value === 0); return <button key={value} type="button" title={`${value}°`} onClick={() => patchChannel({ h: value })} style={{ height: 20, minWidth: 0, borderRadius: 6, border: selected ? `2px solid ${ink(1)}` : `0.5px solid ${hairline(.16)}`, background: `oklch(.72 .16 ${value})`, boxShadow: selected ? `0 0 0 2px ${accent(.7, .22)}` : 'none', cursor: 'pointer' }} /> })}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0,1fr) 54px 28px', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <span style={{ ...text.dim(), fontSize: FS.small }}>色相</span><Slider min={0} max={360} value={channelValues.h} onChange={(value) => patchChannel({ h: value })} style={{ height: 7, background: HUE_TRACK }} /><span style={{ ...text.num(FS.tiny), textAlign: 'right', color: ink(2) }}>{Math.round(channelValues.h)}°</span><IconButton icon={locks[channel] ? Lock : Unlock} size={27} title={locks[channel] ? '解锁此通道' : '锁定此通道，随机和配色关系将跳过'} color={locks[channel] ? accent() : ink(3)} onClick={() => setLocks((items) => ({ ...items, [channel]: !items[channel] }))} />
              <span style={{ ...text.dim(), fontSize: FS.small }}>彩度</span><Slider min={channel === 'ths' ? .002 : .01} max={chromaMax} step={.002} value={channelValues.c} onChange={(value) => patchChannel({ c: value })} /><span style={{ ...text.num(FS.tiny), textAlign: 'right', color: ink(2) }}>{channelValues.c.toFixed(3)}</span><span />
              <span style={{ ...text.dim(), fontSize: FS.small }}>明度</span><Slider min={lightRange.min} max={lightRange.max} step={.01} value={channelValues.l} onChange={(value) => patchChannel({ l: value })} /><span style={{ ...text.num(FS.tiny), textAlign: 'right', color: ink(2) }}>{channelValues.l.toFixed(2)}</span><input type="color" value={currentHex} title={`HEX 取色 ${currentHex}`} onChange={(e) => useHex(e.target.value)} style={{ width: 27, height: 27, padding: 2, borderRadius: R.sm, border: `0.5px solid ${hairline(.15)}`, background: fill(2), cursor: 'pointer' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 9, alignItems: 'center' }}><span style={{ ...text.faint(), marginRight: 2 }}>配色关系</span>{HARMONIES.map((item) => <Chip key={item.key} onClick={() => applyHarmony(item.key)}>{item.label}</Chip>)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7, alignItems: 'center' }}><span style={{ ...text.faint(), marginRight: 2 }}>快速变体</span><Chip icon={WandSparkles} onClick={() => applyVariant('soft')}>柔和</Chip><Chip onClick={() => applyVariant('vivid')}>鲜明</Chip><Chip onClick={() => applyVariant('bright')}>提亮</Chip><Chip onClick={() => applyVariant('deep')}>压暗</Chip><Chip onClick={() => applyVariant('swap')}>主副互换</Chip></div>
          </div>

          <div style={{ height: .5, background: hairline(.09) }} />
          <div><div style={{ ...text.overline(), marginBottom: 9 }}>材质、文字与层级</div><div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 72, flex: 'none', ...text.dim(), fontSize: FS.small }}>文字明度</span><Slider min={t.mode === 'light' ? .08 : .68} max={t.mode === 'light' ? .42 : 1} step={.01} value={t.tx} onChange={(value) => patch({ tx: value })} style={{ flex: 1 }} /><span style={{ width: 38, textAlign: 'right', ...text.num(FS.tiny), color: ink(2) }}>{t.tx.toFixed(2)}</span></div>
            {MATERIAL_SLIDERS.map(({ key, label, min, max, step }) => <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 72, flex: 'none', ...text.dim(), fontSize: FS.small }}>{label}</span><Slider min={min} max={max} step={step} value={t[key]} onChange={(value) => patch({ [key]: value })} style={{ flex: 1 }} /><span style={{ width: 38, textAlign: 'right', ...text.num(FS.tiny), color: ink(2) }}>{key === 'ga' ? `${Math.round(t[key] * 100)}%` : key === 'bl' || key === 'gr' ? Math.round(t[key]) : t[key].toFixed(2)}</span></div>)}
          </div></div>

          <div style={{ height: .5, background: hairline(.09) }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={text.overline()}>主题身份</span><span style={{ flex: 1 }} /><Button sm variant="ghost" icon={WandSparkles} onClick={() => void aiNameTheme()}>{namingBusy ? '命名中' : 'AI 命名'}</Button></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, .72fr) minmax(180px, 1.28fr)', gap: 7 }}>
              <Input value={name} onChange={setName} placeholder="主题名称" />
              <Input value={tagsText} onChange={setTagsText} placeholder="特征标签，用逗号分隔" />
              <Input value={description} onChange={setDescription} placeholder="主题特征介绍" style={{ gridColumn: '1 / -1' }} />
            </div>
            {identity.tags.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>{identity.tags.map((tag) => <Chip key={tag}># {tag}</Chip>)}</div>}
          </div>

          <div style={{ height: .5, background: hairline(.09) }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" icon={editKey ? Check : undefined} onClick={() => onSave(identity.name, t, { desc: identity.desc, tags: identity.tags }, editKey)}>{editKey ? '更新主题' : '保存主题'}</Button></div>
        </div>
      </div>
    </motion.div>
  </motion.div>
}
