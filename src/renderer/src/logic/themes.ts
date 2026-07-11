// 灵动岛主题：OKLCH 色相令牌驱动（--th 主色 / --th2 渐变副色 / --ths 面板底色；--cs/--css 饱和倍率）。
// 磨砂黑/暮光紫沿用原设计（cs=1）质感最佳，勿动；其余四套经护眼重设计（降强调饱和 cs<1 +
// 玻璃微染色 css>1 + 抬面板明度 pl>1），去"霓虹压死黑"的阴森感。不再提供反色浅色主题。

export interface ThemeDef {
  key: string
  label: string
  desc: string
  th: string
  th2: string
  ths: string
  /** 强调色饱和倍率（1=原设计） */
  cs: string
  /** 面板底色饱和倍率 */
  css: string
  /** 面板底色明度倍率（1=原设计；<1 更黑，暗夜黑用） */
  pl?: string
  /** 设置里的预览圆点颜色 */
  dot: string
}

export const THEMES: ThemeDef[] = [
  // 极光绿 → 极光青（emerald→teal→cyan）：告别荧光"黑客绿"，改走北极光的清透感。
  // 强调饱和降到 0.9（护眼），玻璃微微透青（css1.5）、明度抬 1.1（去死黑晨雾感）。
  { key: 'aurora', label: '极光青', desc: '北极光渐变 · 翡翠青 → 冰蓝 · 清透护眼', th: '168', th2: '196', ths: '176', cs: '0.9', css: '1.5', pl: '1.1', dot: 'oklch(0.8 0.12 176)' },
  // 暖沙米黄 → 暖金：从发绿的病黄校正到琥珀金，玻璃暖染（css1.8）+ 抬明度（1.16）→ 慵懒沙金。
  { key: 'sand', label: '暖金沙', desc: '琥珀暖光 · 沙金玻璃 · 温润不刺眼', th: '72', th2: '52', ths: '66', cs: '0.86', css: '1.9', pl: '1.16', dot: 'oklch(0.82 0.11 72)' },
  { key: 'graphite', label: '磨砂黑', desc: '石墨黑 · 冰蓝点缀', th: '245', th2: '260', ths: '250', cs: '1', css: '1', dot: 'oklch(0.75 0.1 245)' },
  // 暗夜黑 → 曜石：不再压到死黑（pl 0.5→0.74），近无彩冷调透一丝钢蓝，成"高级极简"而非"阴森"。
  { key: 'midnight', label: '曜石黑', desc: '曜石极简 · 冷钢微光 · 沉静护眼', th: '238', th2: '250', ths: '242', cs: '0.34', css: '0.5', pl: '0.74', dot: 'oklch(0.42 0.02 242)' },
  { key: 'violet', label: '暮光紫', desc: '暮色暗玻璃 · 霓虹紫点缀', th: '300', th2: '315', ths: '305', cs: '1', css: '1', dot: 'oklch(0.75 0.15 300)' },
  // 樱粉：重饱和的暗玫瑰像"干血"→ 降饱和（0.78）成粉扑质感，玻璃暖染 + 抬明度 → 柔和樱花。
  { key: 'rose', label: '樱粉', desc: '樱花柔粉 · 暖染玻璃 · 温柔护眼', th: '356', th2: '22', ths: '2', cs: '0.78', css: '1.6', pl: '1.15', dot: 'oklch(0.82 0.1 356)' }
]

/** 把一组令牌写进 :root（主题设计器实时预览用） */
export function applyThemeTokens(t: Pick<ThemeDef, 'th' | 'th2' | 'ths' | 'cs' | 'css' | 'pl'>): void {
  const r = document.documentElement
  r.style.setProperty('--th', t.th)
  r.style.setProperty('--th2', t.th2)
  r.style.setProperty('--ths', t.ths)
  r.style.setProperty('--cs', t.cs)
  r.style.setProperty('--css', t.css)
  r.style.setProperty('--pl', t.pl || '1')
  r.dataset.theme = 'dark'
}

export function applyTheme(key: string): void {
  // 旧持久化值兼容：'ocean'（深海蓝已移除）回退默认
  applyThemeTokens(THEMES.find((x) => x.key === key) || THEMES[0])
}

/** 内置 + 用户自定义主题里查 key 并应用 */
export function applyThemeAny(key: string, customs: ThemeDef[]): void {
  const t = [...customs, ...THEMES].find((x) => x.key === key)
  applyThemeTokens(t || THEMES[0])
}

/** 生成一条自定义主题（dot 由主色相推导） */
export function makeCustomTheme(key: string, label: string, tk: Pick<ThemeDef, 'th' | 'th2' | 'ths' | 'cs' | 'css' | 'pl'>): ThemeDef {
  return { key, label, desc: '自定义主题', dot: `oklch(0.78 0.14 ${tk.th})`, ...tk }
}
