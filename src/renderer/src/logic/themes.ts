// 灵动岛主题：OKLCH 色相 + 明暗外观 + 毛玻璃参数。
// 新字段均为可选，旧版仅含 th/th2/ths/cs/css/pl 的自定义主题会自动归一化为深色主题。

export type ThemeMode = 'dark' | 'light'
export type ThemeHarmony = 'analogous' | 'complementary' | 'split' | 'triadic'

export interface ThemeTokenInput {
  th: string
  th2: string
  ths: string
  /** 强调色饱和倍率 */
  cs: string
  /** 面板底色饱和倍率 */
  css: string
  /** 旧版面板明度倍率，保留用于迁移 */
  pl?: string
  mode?: ThemeMode
  /** 面板 OKLCH 明度 */
  bg?: string
  /** 主题面板不透明度（0.25-1） */
  ga?: string
  /** 卡片与控件填充强度 */
  fi?: string
  /** 背景模糊半径（px） */
  bl?: string
  /** 阴影强度倍率 */
  sh?: string
  /** 主强调色 OKLCH 彩度 */
  c1?: string
  /** 副强调色 OKLCH 彩度 */
  c2?: string
  /** 面板染色 OKLCH 彩度 */
  sc?: string
  /** 主强调色基准明度 */
  l1?: string
  /** 副强调色基准明度 */
  l2?: string
  /** 正文墨色明度 */
  tx?: string
  /** 品牌渐变角度（deg） */
  gr?: string
}

export interface NormalizedThemeTokens extends Required<ThemeTokenInput> {}

export interface ThemeDef extends ThemeTokenInput {
  key: string
  label: string
  desc: string
  /** AI 或用户定义的主题特征标签 */
  tags?: string[]
  /** 设置里的预览圆点颜色 */
  dot: string
}

export interface ThemeIdentity {
  name: string
  desc: string
  tags: string[]
}

export const THEMES: ThemeDef[] = [
  { key: 'aurora', label: '极光青', desc: '北极光渐变 · 翡翠青 → 冰蓝 · 清透护眼', th: '168', th2: '196', ths: '176', cs: '0.9', css: '1.5', pl: '1.1', dot: 'oklch(0.8 0.12 176)' },
  {
    key: 'control-center',
    label: '冰川控制中心',
    desc: '冷蓝浅色玻璃 · 清晰分组 · macOS 控制中心质感',
    th: '252', th2: '210', ths: '244', cs: '1.05', css: '1.55', pl: '1.15',
    mode: 'light', bg: '0.82', ga: '0.9', fi: '1.22', bl: '38', sh: '0.62',
    c1: '0.168', c2: '0.145', sc: '0.031', l1: '0.54', l2: '0.61', tx: '0.16', gr: '145',
    dot: 'oklch(0.66 0.17 252)'
  },
  { key: 'sand', label: '暖金沙', desc: '琥珀暖光 · 沙金玻璃 · 温润不刺眼', th: '72', th2: '52', ths: '66', cs: '0.86', css: '1.9', pl: '1.16', dot: 'oklch(0.82 0.11 72)' },
  { key: 'graphite', label: '磨砂黑', desc: '石墨黑 · 冰蓝点缀', th: '245', th2: '260', ths: '250', cs: '1', css: '1', dot: 'oklch(0.75 0.1 245)' },
  { key: 'midnight', label: '曜石黑', desc: '曜石极简 · 冷钢微光 · 沉静护眼', th: '238', th2: '250', ths: '242', cs: '0.34', css: '0.5', pl: '0.74', dot: 'oklch(0.42 0.02 242)' },
  { key: 'violet', label: '暮光紫', desc: '暮色暗玻璃 · 霓虹紫点缀', th: '300', th2: '315', ths: '305', cs: '1', css: '1', dot: 'oklch(0.75 0.15 300)' },
  { key: 'rose', label: '樱粉', desc: '樱花柔粉 · 暖染玻璃 · 温柔护眼', th: '356', th2: '22', ths: '2', cs: '0.78', css: '1.6', pl: '1.15', dot: 'oklch(0.82 0.1 356)' }
]

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const numberToken = (value: unknown, fallback: number, min: number, max: number): string => {
  const parsed = Number(value)
  return String(Number(clamp(Number.isFinite(parsed) ? parsed : fallback, min, max).toFixed(2)))
}

const cleanIdentityText = (value: unknown, max: number): string => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** 归一化 AI 命名结果，限制长度并清理重复标签，避免脏数据进入持久化状态。 */
export function normalizeThemeIdentity(input: Partial<ThemeIdentity> & { description?: unknown }, fallbackName = '自定义主题'): ThemeIdentity {
  const name = cleanIdentityText(input.name, 16) || fallbackName
  const desc = cleanIdentityText(input.desc ?? input.description, 72)
  const rawTags = Array.isArray(input.tags) ? input.tags : String(input.tags ?? '').split(/[,，、|]/)
  const tags = [...new Set(rawTags.map((tag) => cleanIdentityText(tag, 8).replace(/^#+/, '')).filter(Boolean))].slice(0, 5)
  return { name, desc, tags }
}

/** 从带代码围栏或前后说明的模型输出中提取主题身份 JSON。 */
export function parseThemeIdentity(raw: string): ThemeIdentity | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match ? match[0] : raw) as Partial<ThemeIdentity> & { description?: unknown }
    if (!parsed.name || !(parsed.desc || parsed.description)) return null
    return normalizeThemeIdentity(parsed)
  } catch {
    return null
  }
}

/** 补齐旧主题缺失的新外观令牌，并限制所有可导入数值的范围。 */
export function normalizeThemeTokens(t: Partial<ThemeTokenInput>): NormalizedThemeTokens {
  const mode: ThemeMode = t.mode === 'light' ? 'light' : 'dark'
  const pl = Number(numberToken(t.pl, 1, 0.4, 1.3))
  const legacyBg = clamp(0.15 * pl, 0.07, 0.3)
  const cs = Number(numberToken(t.cs, 1, 0.1, 1.4))
  const css = Number(numberToken(t.css, 1, 0.1, 2))
  return {
    th: numberToken(t.th, 200, 0, 360),
    th2: numberToken(t.th2, 260, 0, 360),
    ths: numberToken(t.ths, 220, 0, 360),
    cs: String(cs),
    css: String(css),
    pl: String(pl),
    mode,
    bg: numberToken(t.bg, mode === 'light' ? 0.82 : legacyBg, 0.07, 0.94),
    ga: numberToken(t.ga, mode === 'light' ? 0.9 : 0.97, 0.25, 1),
    fi: numberToken(t.fi, mode === 'light' ? 1.2 : 1, 0.45, 1.8),
    bl: numberToken(t.bl, mode === 'light' ? 38 : 30, 8, 56),
    sh: numberToken(t.sh, mode === 'light' ? 0.62 : 1, 0, 1.5),
    c1: numberToken(t.c1, 0.16 * cs, 0.01, 0.28),
    c2: numberToken(t.c2, 0.15 * cs, 0.01, 0.28),
    sc: numberToken(t.sc, 0.02 * css, 0.002, 0.09),
    l1: numberToken(t.l1, mode === 'light' ? 0.54 : 0.82, 0.38, 0.94),
    l2: numberToken(t.l2, mode === 'light' ? 0.58 : 0.8, 0.38, 0.94),
    tx: numberToken(t.tx, mode === 'light' ? 0.18 : 0.96, mode === 'light' ? 0.08 : 0.68, mode === 'light' ? 0.42 : 1),
    gr: numberToken(t.gr, 135, 0, 360)
  }
}

export interface OklchColor {
  l: number
  c: number
  h: number
}

const srgbEncode = (value: number): number => value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
const srgbDecode = (value: number): number => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)

/** 浏览器原生取色器使用 HEX，这里与设计器内部 OKLCH 做无依赖转换。 */
export function oklchToHex({ l, c, h }: OklchColor): string {
  const rad = h * Math.PI / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const ll = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3)
  const mm = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3)
  const ss = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3)
  const rgb = [
    4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss
  ].map((value) => Math.round(clamp(srgbEncode(value), 0, 1) * 255))
  return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function hexToOklch(hex: string): OklchColor | null {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim())
  if (!match) return null
  const [r, g, b] = match.slice(1).map((part) => srgbDecode(parseInt(part, 16) / 255))
  const ll = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const ss = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const l = 0.2104542553 * ll + 0.793617785 * mm - 0.0040720468 * ss
  const a = 1.9779984951 * ll - 2.428592205 * mm + 0.4505937099 * ss
  const bb = 0.0259040371 * ll + 0.7827717662 * mm - 0.808675766 * ss
  const c = Math.hypot(a, bb)
  const h = c < 0.0001 ? 0 : (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360
  return { l: Number(l.toFixed(3)), c: Number(c.toFixed(3)), h: Number(h.toFixed(1)) }
}

const relativeLuminance = (color: OklchColor): number => {
  const hex = oklchToHex(color)
  const values = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => srgbDecode(parseInt(part, 16) / 255))
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]
}

export function contrastRatio(a: OklchColor, b: OklchColor): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2))
}

export function themeContrastRatios(input: Partial<ThemeTokenInput>): { text: number; primary: number } {
  const t = normalizeThemeTokens(input)
  const panel = { l: +t.bg, c: +t.sc, h: +t.ths }
  const foreground = { l: +t.tx, c: 0.008, h: +t.th }
  const primary = { l: +t.l1, c: +t.c1, h: +t.th }
  const onPrimary = { l: +t.l1 > 0.66 ? 0.14 : 0.98, c: 0.01, h: +t.th }
  return { text: contrastRatio(panel, foreground), primary: contrastRatio(primary, onPrimary) }
}

/** 根据主色生成常用色彩关系。 */
export function huesForHarmony(primary: number, harmony: ThemeHarmony): { th2: number; ths: number } {
  const hue = ((Math.round(primary) % 360) + 360) % 360
  const offsets: Record<ThemeHarmony, [number, number]> = {
    analogous: [32, -22],
    complementary: [180, 8],
    split: [150, 210],
    triadic: [120, 240]
  }
  const [secondary, surface] = offsets[harmony]
  return { th2: (hue + secondary) % 360, ths: (hue + surface + 360) % 360 }
}

/** 把一组令牌写进 :root（主题设计器实时预览用）。 */
export function applyThemeTokens(input: Partial<ThemeTokenInput>): void {
  const t = normalizeThemeTokens(input)
  const light = t.mode === 'light'
  const bg = Number(t.bg)
  const primaryShift = Number(t.l1) - 0.82
  const secondaryShift = Number(t.l2) - 0.82
  const r = document.documentElement
  const vars: Record<string, string> = {
    '--th': t.th,
    '--th2': t.th2,
    '--ths': t.ths,
    '--cs': t.cs,
    '--css': t.css,
    '--accent-c': t.c1,
    '--accent2-c': t.c2,
    '--surface-c': t.sc,
    '--pl': t.pl,
    '--panel-l': t.bg,
    '--panel-hi-l': String(Number(clamp(bg + (light ? 0.06 : 0.035), 0.08, 0.98).toFixed(3))),
    '--panel-low-l': String(Number(clamp(bg - (light ? 0.055 : 0.025), 0.05, 0.95).toFixed(3))),
    '--overlay-l': String(Number(clamp(bg + (light ? 0.08 : 0.05), 0.09, 0.98).toFixed(3))),
    '--inset-l': String(Number(clamp(bg - (light ? 0.13 : 0.055), 0.04, 0.9).toFixed(3))),
    '--ink-l': t.tx,
    '--muted-ink-l': light ? '0.28' : '0.86',
    '--ink-2-a': light ? '0.66' : '0.6',
    '--ink-3-a': light ? '0.46' : '0.32',
    '--ink-4-a': light ? '0.3' : '0.18',
    '--fill-l': light ? '0.99' : '0.96',
    '--line-l': light ? '0.16' : '0.96',
    '--tint-hi-l': light ? '0.94' : '0.3',
    '--tint-low-l': light ? '0.86' : '0.2',
    '--hue-accent-l': String(Number(clamp(Number(t.l1) - (light ? 0.08 : 0), 0.42, 0.9).toFixed(2))),
    '--solid-ink-l': '0.96',
    '--glass-a': t.ga,
    '--fill-k': t.fi,
    '--glass-blur': `${t.bl}px`,
    '--shadow-k': t.sh,
    '--accent-l-shift': String(Number(primaryShift.toFixed(2))),
    '--accent1-l-shift': String(Number(primaryShift.toFixed(2))),
    '--accent2-l-shift': String(Number(secondaryShift.toFixed(2))),
    '--gradient-angle': `${t.gr}deg`,
    '--on-primary-l': Number(t.l1) > 0.66 ? '0.14' : '0.98',
    '--overlay-mask-l': light ? '0.16' : '0.04'
  }
  for (const [key, value] of Object.entries(vars)) r.style.setProperty(key, value)
  r.dataset.theme = t.mode
  r.style.colorScheme = t.mode
}

export function applyTheme(key: string): void {
  applyThemeTokens(THEMES.find((x) => x.key === key) || THEMES[0])
}

/** 内置 + 用户自定义主题里查 key 并应用。 */
export function applyThemeAny(key: string, customs: ThemeDef[]): void {
  const t = [...customs, ...THEMES].find((x) => x.key === key)
  applyThemeTokens(t || THEMES[0])
}

/** 生成一条自定义主题；写入完整令牌，后续版本无需再次猜测默认值。 */
export function makeCustomTheme(key: string, label: string, input: ThemeTokenInput, metadata?: Partial<ThemeIdentity>): ThemeDef {
  const t = normalizeThemeTokens(input)
  const identity = normalizeThemeIdentity({
    name: label,
    desc: metadata?.desc || `${t.mode === 'light' ? '浅色' : '深色'}自定义玻璃主题`,
    tags: metadata?.tags || []
  }, label)
  return {
    key,
    label: identity.name,
    desc: identity.desc,
    tags: identity.tags,
    dot: `oklch(${t.l1} ${t.c1} ${t.th})`,
    ...t
  }
}
