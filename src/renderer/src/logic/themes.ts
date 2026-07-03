// 灵动岛主题：OKLCH 色相令牌驱动（--th 主色 / --th2 渐变副色 / --ths 面板底色；--cs/--css 饱和倍率）。
// 经用户实测取舍：全系保持原设计饱和度（cs=1）质感最佳；不再提供反色浅色主题。

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
  { key: 'aurora', label: '极光绿', desc: '默认 · 深色玻璃 + 荧光绿', th: '150', th2: '165', ths: '155', cs: '1', css: '1', dot: 'oklch(0.78 0.16 150)' },
  { key: 'sand', label: '暖沙米黄', desc: '暖米金点缀的沙色暗玻璃', th: '82', th2: '70', ths: '85', cs: '1', css: '1', dot: 'oklch(0.8 0.13 82)' },
  { key: 'graphite', label: '磨砂黑', desc: '石墨黑 · 冰蓝点缀', th: '245', th2: '260', ths: '250', cs: '1', css: '1', dot: 'oklch(0.75 0.1 245)' },
  // 暗夜黑：接近纯黑的面板（明度压到 0.5 倍）+ 近无彩的冷白点缀，与磨砂黑拉开层次
  { key: 'midnight', label: '暗夜黑', desc: '近纯黑面板 · 冷白点缀 · 极简', th: '255', th2: '270', ths: '260', cs: '0.22', css: '0.15', pl: '0.5', dot: 'oklch(0.2 0.005 260)' },
  { key: 'violet', label: '暮光紫', desc: '暮色暗玻璃 · 霓虹紫点缀', th: '300', th2: '315', ths: '305', cs: '1', css: '1', dot: 'oklch(0.75 0.15 300)' },
  { key: 'rose', label: '樱粉', desc: '暗玫瑰玻璃 · 樱粉点缀', th: '350', th2: '5', ths: '352', cs: '1', css: '1', dot: 'oklch(0.78 0.14 350)' }
]

export function applyTheme(key: string): void {
  // 旧持久化值兼容：'ocean'（深海蓝已移除）回退默认
  const t = THEMES.find((x) => x.key === key) || THEMES[0]
  const r = document.documentElement
  r.style.setProperty('--th', t.th)
  r.style.setProperty('--th2', t.th2)
  r.style.setProperty('--ths', t.ths)
  r.style.setProperty('--cs', t.cs)
  r.style.setProperty('--css', t.css)
  r.style.setProperty('--pl', t.pl || '1')
  r.dataset.theme = 'dark'
}
