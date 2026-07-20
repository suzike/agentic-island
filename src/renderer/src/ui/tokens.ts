// 设计令牌 v2 —— 全面转译 Apple（macOS/iOS）设计语言，仍消费 OKLCH 主题变量（--th/--th2/--ths/--cs/--css/--pl）。
//
// 核心转译规则：
//  1. 层级靠【填充明度阶梯】而非描边（Apple systemGroupedBackground 体系）——卡片无 1px 边框，
//     分隔一律用发型线（hairline）；描边只出现在浮层与需要强调的交互件上。
//  2. 文字墨色对齐 iOS label 四级（label / secondaryLabel / tertiaryLabel / quaternaryLabel）。
//  3. 圆角对齐 Apple 连续圆角观感：按钮 10、卡片/分组 13、浮层 18、面板 28、胶囊 999。
//  4. 排版对齐 SF：标题负字距（-0.01 ~ -0.024em）、小节标签 footnote 大写宽字距、数字 tabular-nums。
//  5. 按压反馈对齐 iOS：以透明度下沉为主（0.55），缩放极轻（0.98）；macOS hover 只改填充亮度。
import type React from 'react'

/* ---------------- 基础尺度 ---------------- */

/** 圆角（Apple 连续圆角观感阶梯） */
export const R = {
  /** 小件：徽标、小图标砖 */
  sm: 7,
  /** 按钮、输入框 */
  md: 10,
  /** 卡片、分组列表容器（iOS inset grouped） */
  lg: 13,
  /** 分区容器 */
  xl: 16,
  /** 浮层 */
  overlay: 18,
  /** 面板本体 */
  panel: 28,
  /** 胶囊 */
  pill: 999,
} as const

/** 间距 */
export const SP = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const

/** 字号阶梯（SF Text 阶梯） */
export const FS = {
  /** caption2：键提示、最弱辅助 */
  tiny: 10,
  /** caption1/footnote：元信息、辅助说明 */
  small: 11,
  /** subhead/正文小 */
  body: 12.5,
  /** callout/小标题 */
  subtitle: 13.5,
  /** title3/节标题 */
  title: 15,
  /** title2/大标题 */
  big: 19,
  /** title1/特大数字 */
  hero: 24,
} as const

/* ---------------- 颜色（消费 OKLCH 主题变量） ---------------- */

/** 强调色（主色相，浅色主题会自动压低明度以保持文字/控件对比） */
export const accent = (lightness = 0.82, alpha = 1): string =>
  `oklch(calc(${lightness} + var(--accent1-l-shift, var(--accent-l-shift, 0))) var(--accent-c, calc(0.16 * var(--cs, 1))) var(--th) / ${alpha})`

/** 强调色渐变副色 */
export const accent2 = (lightness = 0.82, alpha = 1): string =>
  `oklch(calc(${lightness} + var(--accent2-l-shift, var(--accent-l-shift, 0))) var(--accent2-c, calc(0.15 * var(--cs, 1))) var(--th2) / ${alpha})`

/** 文字墨色：对齐 iOS label 四级（1=label → 4=quaternaryLabel），轻微染主题色 */
export const ink = (level: 1 | 2 | 3 | 4 = 1): string => {
  const fallback = [0, 1, 0.6, 0.32, 0.18][level]
  const alpha = level === 1 ? '1' : `var(--ink-${level}-a, ${fallback})`
  return `oklch(var(--ink-l, 0.96) 0.008 var(--th) / ${alpha})`
}

/** 语义色（跨主题固定色相，与 AGENTS.md 约定一致） */
export const sem = {
  /** 琥珀：警示/待处理 */
  warn: 'oklch(0.8 0.13 75)',
  /** 红：危险/删除 */
  danger: 'oklch(0.7 0.18 25)',
  /** 紫：专注 */
  focus: 'oklch(0.78 0.12 275)',
  /** 绿：安静/完成 */
  calm: 'oklch(0.78 0.11 150)',
  /** 蓝：运行中 */
  run: 'oklch(0.78 0.13 220)',
} as const

/** 语义色的浅底填充 */
export const semBg = (color: string, alpha = 0.13): string =>
  `color-mix(in oklch, ${color} ${Math.round(alpha * 100)}%, transparent)`

/* ---------------- 填充阶梯（Apple 层级核心：fill 代替 border） ---------------- */

/** iOS systemFill 四级填充（染一丝主题色），1 最弱 → 4 最强 */
export const fill = (level: 1 | 2 | 3 | 4 = 2): string => {
  const alpha = [0, 0.05, 0.075, 0.11, 0.16][level]
  return `oklch(var(--fill-l, 0.96) 0.008 var(--th) / calc(${alpha} * var(--fill-k, 1)))`
}

/** 发型线分隔（Apple separator）：层级分界一律用它，不用 1px 实边框 */
export const hairline = (alpha = 0.09): string => `oklch(var(--line-l, 0.96) 0.006 var(--th) / ${alpha})`

/** 跨明暗主题的色相染色表面。浅色主题生成浅色彩纸，深色主题生成暗色玻璃。 */
export const tintSurface = (hue = 'var(--th)', alpha = 0.45, strong = false): string =>
  `oklch(var(--tint-${strong ? 'low' : 'hi'}-l, ${strong ? '0.2' : '0.3'}) 0.045 ${hue} / ${alpha})`

/** 任意色相上的可读强调色，避免浅色主题继续使用过亮文字。 */
export const hueAccent = (hue = 'var(--th)', chroma = 0.12, alpha = 1): string =>
  `oklch(var(--hue-accent-l, 0.84) ${chroma} ${hue} / ${alpha})`

/** 终端、截图遮罩等始终为深底的局部表面使用，不随全局浅色主题反转。 */
export const solidInk = (alpha = 1): string => `oklch(var(--solid-ink-l, 0.96) 0.008 var(--th) / ${alpha})`

/** 发型线分隔行样式（iOS 分组列表行分隔，左侧缩进对齐文字） */
export const separatorRow = (indent = 0): React.CSSProperties => ({
  height: 0.5,
  background: hairline(0.08),
  marginLeft: indent,
  border: 'none',
  flex: 'none',
})

/* ---------------- 层级表面（Elevation，填充制） ---------------- */

/** 柔和投影（Apple 式弥散阴影，无硬边） */
const softShadow = '0 10px 28px -12px rgb(0 0 0 / calc(0.4 * var(--shadow-k, 1)))'

export const surface = {
  /** 面板本体（vibrancy 毛玻璃） */
  panel: (): React.CSSProperties => ({
    background: 'oklch(var(--panel-l, 0.15) var(--surface-c, calc(0.02 * var(--css, 1))) var(--ths) / var(--glass-a, 0.97))',
    backdropFilter: 'blur(var(--glass-blur, 30px)) saturate(180%)',
  }),
  /** 分区容器：最弱填充，圈定一组内容 */
  section: (): React.CSSProperties => ({
    background: fill(1),
    borderRadius: R.xl,
  }),
  /** 卡片：填充制（无 1px 边框），hover 靠填充变亮（ai-card） */
  card: (highlight = false): React.CSSProperties => ({
    background: highlight
      ? 'linear-gradient(180deg, oklch(0.3 0.06 75 / 0.2), oklch(0.25 0.045 75 / 0.11))'
      : fill(2),
    border: highlight ? '0.5px solid oklch(0.8 0.13 75 / 0.4)' : `0.5px solid ${hairline(0.05)}`,
    borderRadius: R.lg,
    boxShadow: highlight ? '0 8px 24px -10px oklch(0.6 0.12 75 / 0.3)' : 'none',
  }),
  /** 内嵌井：输入框、代码块（比面板深，下凹感） */
  inset: (): React.CSSProperties => ({
    background: 'oklch(var(--inset-l, 0.1) calc(0.012 * var(--css, 1)) var(--ths) / calc(0.48 * var(--fill-k, 1)))',
    border: `0.5px solid ${hairline(0.06)}`,
    borderRadius: R.md,
  }),
  /** 浮层（弹层/下拉）：最实的玻璃 + 发型线描边 + 弥散深影 */
  overlay: (): React.CSSProperties => ({
    background: 'oklch(var(--overlay-l, 0.2) calc(0.025 * var(--css, 1)) var(--ths) / var(--glass-a, 0.97))',
    backdropFilter: 'blur(calc(var(--glass-blur, 30px) + 6px)) saturate(180%)',
    border: `0.5px solid ${hairline(0.12)}`,
    borderRadius: R.overlay,
    boxShadow: '0 28px 60px -18px rgb(0 0 0 / calc(0.6 * var(--shadow-k, 1))), 0 2px 8px rgb(0 0 0 / calc(0.25 * var(--shadow-k, 1)))',
  }),
  /** iOS 分组列表（inset grouped）：容器填充 + 行内 hairline 分隔 */
  group: (): React.CSSProperties => ({
    background: fill(2),
    borderRadius: R.lg,
    overflow: 'hidden',
  }),
} as const

/** 弥散软阴影（卡片浮起等场景） */
export const shadowSoft = softShadow

/* ---------------- 文字角色（SF 排版：字距拉开层级） ---------------- */

export const text = {
  /** 大标题（title2，负字距） */
  bigTitle: (): React.CSSProperties => ({ fontSize: FS.big, fontWeight: 700, color: ink(1), letterSpacing: '-0.022em' }),
  /** 节标题（title3，负字距） */
  title: (): React.CSSProperties => ({ fontSize: FS.title, fontWeight: 700, color: ink(1), letterSpacing: '-0.014em' }),
  /** 小标题/强调行（headline） */
  subtitle: (): React.CSSProperties => ({ fontSize: FS.subtitle, fontWeight: 600, color: ink(1), letterSpacing: '-0.008em' }),
  /** 正文 */
  body: (): React.CSSProperties => ({ fontSize: FS.body, fontWeight: 400, color: ink(1), letterSpacing: '-0.004em' }),
  /** 次要说明（secondaryLabel） */
  dim: (): React.CSSProperties => ({ fontSize: FS.small, fontWeight: 400, color: ink(2), letterSpacing: '-0.002em' }),
  /** 幽灵提示（tertiaryLabel） */
  faint: (): React.CSSProperties => ({ fontSize: FS.tiny, fontWeight: 400, color: ink(3) }),
  /** 小组标签（iOS 分组头：footnote 大写宽字距，quaternary） */
  overline: (): React.CSSProperties => ({
    fontSize: FS.tiny,
    fontWeight: 500,
    color: ink(3),
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
  }),
  /** 数字（等宽数字） */
  num: (size: number = FS.big): React.CSSProperties => ({ fontSize: size, fontWeight: 700, color: ink(1), fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.014em' }),
  /** 等宽代码 */
  mono: (size: number = FS.small): React.CSSProperties => ({
    fontSize: size,
    fontFamily: "'Cascadia Code', Consolas, ui-monospace, monospace",
    color: ink(2),
  }),
} as const

/* ---------------- 常用渐变 ---------------- */

export const gradient = {
  /** 主按钮/选中态：主题双色纵向渐变（上亮下实，Apple 式微妙） */
  primary: (): string =>
    `linear-gradient(180deg, ${accent(0.84)}, ${accent(0.72)})`,
  /** 品牌 logo 渐变（135° 主→副色相） */
  brand: (): string =>
    `linear-gradient(var(--gradient-angle, 135deg), ${accent(0.84)}, ${accent2(0.64)})`,
  /** 主按钮上的深色文字 */
  onPrimary: (): string => 'oklch(var(--on-primary-l, 0.16) 0.02 var(--th))',
} as const

/* ---------------- 动效令牌（CSS transition 用；framer-motion 预设在 motion.ts） ---------------- */

export const MOTION = {
  fast: '.16s',
  base: '.24s',
  slow: '.4s',
  ease: 'cubic-bezier(.22,.61,.36,1)',
  spring: 'cubic-bezier(.34,1.3,.64,1)',
} as const

/** 通用过渡 shorthand */
export const transition = (props = 'all', dur: string = MOTION.fast, ease: string = MOTION.ease): string =>
  `${props} ${dur} ${ease}`

/* ---------------- 字体栈（SF 优先，Windows 落 Segoe UI） ---------------- */

export const FONT_STACK = "-apple-system, 'SF Pro SC', 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, sans-serif"
