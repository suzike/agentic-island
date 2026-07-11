// 截图工坊（专业版）：无损像素截图 + 高级边框美化 + 手写 canvas 标注编辑器 + 20+ AI 视觉增强。
// 合成管线：原图 →（裁剪/旋转/翻转）→ 边框/背景/装饰（圆角/阴影/内边距/水印）→ 标注层 → 导出。
// canvas 全程按原生分辨率合成（图像像素 1:1，倍率仅可选放大）；「原图」+ 无任何编辑时直接导出原始 dataURL，位级一致。

import { useEffect, useMemo, useRef, useState } from 'react'
import { island } from '../bridge'

interface Props {
  dataUrl: string
  onClose: () => void
  llmReady: boolean
  onAskImage: (dataUrl: string) => void
  onAIVision: (system: string, dataUrl: string, prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>
}

// ────────────────────────────── 边框 / 背景预设 ──────────────────────────────
type FrameKey = 'none' | 'glass' | 'macos' | 'browser' | 'minimal' | 'neon' | 'dark' | 'polaroid'
const FRAMES: { key: FrameKey; label: string; hint: string }[] = [
  { key: 'none', label: '原图', hint: '零处理 · 位级无损' },
  { key: 'glass', label: '玻璃拟态', hint: '弥散渐变 + 悬浮投影' },
  { key: 'macos', label: 'macOS 窗口', hint: '交通灯标题栏' },
  { key: 'browser', label: '浏览器', hint: '地址栏窗口' },
  { key: 'minimal', label: '极简画框', hint: '白框 + 柔影' },
  { key: 'neon', label: '霓虹光环', hint: '渐变描边 + 辉光' },
  { key: 'dark', label: '暗夜卡片', hint: '深色悬浮卡片' },
  { key: 'polaroid', label: '拍立得', hint: '白底相纸留白' }
]
// 弥散背景预设
const BGS: { key: string; label: string; stops: [string, string, string] }[] = [
  { key: 'aurora', label: '极光', stops: ['#1a2980', '#26d0ce', '#7f53ac'] },
  { key: 'sunset', label: '暮色', stops: ['#0f0c29', '#e96443', '#904e95'] },
  { key: 'forest', label: '苔原', stops: ['#134e5e', '#71b280', '#2c5364'] },
  { key: 'mono', label: '石墨', stops: ['#232526', '#414345', '#232526'] },
  { key: 'candy', label: '霓彩', stops: ['#fc466b', '#3f5efb', '#00d2ff'] },
  { key: 'peach', label: '蜜桃', stops: ['#ffecd2', '#fcb69f', '#ff9a9e'] },
  { key: 'ocean', label: '深海', stops: ['#2b5876', '#4e4376', '#1e3c72'] },
  { key: 'ink', label: '素白', stops: ['#f5f7fa', '#e4e7eb', '#cfd9df'] }
]
// 标注调色板
const PALETTE = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ffffff', '#000000']

// ────────────────────────────── 标注数据模型 ──────────────────────────────
type Tool = 'none' | 'arrow' | 'rect' | 'ellipse' | 'pen' | 'line' | 'text' | 'mosaic' | 'blur' | 'highlight' | 'number'
type Pt = { x: number; y: number }
interface Anno {
  id: number
  tool: Tool
  color: string
  width: number
  start: Pt
  end: Pt
  points?: Pt[] // pen
  text?: string // text
  n?: number // number badge
}

// ────────────────────────────── 装饰参数 ──────────────────────────────
interface Deco {
  radius: number // 图像圆角（px 相对原图短边比例的近似，0..1 → 实际 = ratio*min*0.09）
  shadow: number // 阴影强度 0..1
  pad: number // 内边距 0..1（相对短边）
  scale: number // 导出倍率 1|2
  watermark: string // 水印文字（空=无）
  wmStamp: boolean // 追加时间戳
}
const DEFAULT_DECO: Deco = { radius: 0.5, shadow: 0.6, pad: 0.5, scale: 1, watermark: '', wmStamp: false }

// ────────────────────────────── 变换参数 ──────────────────────────────
interface Xform {
  rotate: number // 0 | 90 | 180 | 270
  flipH: boolean
  flipV: boolean
  crop: { x: number; y: number; w: number; h: number } | null // 相对原图像素
}
const DEFAULT_XFORM: Xform = { rotate: 0, flipH: false, flipV: false, crop: null }

// ────────────────────────────── 绘制工具函数 ──────────────────────────────
function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function paintBg(ctx: CanvasRenderingContext2D, W: number, H: number, stops: [string, string, string]): void {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, stops[0]); g.addColorStop(0.55, stops[1]); g.addColorStop(1, stops[2])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const orb1 = ctx.createRadialGradient(W * 0.22, H * 0.2, 0, W * 0.22, H * 0.2, Math.max(W, H) * 0.4)
  orb1.addColorStop(0, 'rgba(255,255,255,.16)'); orb1.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = orb1; ctx.fillRect(0, 0, W, H)
  const orb2 = ctx.createRadialGradient(W * 0.85, H * 0.9, 0, W * 0.85, H * 0.9, Math.max(W, H) * 0.5)
  orb2.addColorStop(0, 'rgba(0,0,0,.22)'); orb2.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = orb2; ctx.fillRect(0, 0, W, H)
}

/** 把原图按 transform（裁剪/旋转/翻转）烘焙成一张新的“基础图像” canvas */
function bakeTransform(img: HTMLImageElement, xf: Xform): HTMLCanvasElement {
  const iw = img.naturalWidth, ih = img.naturalHeight
  const crop = xf.crop || { x: 0, y: 0, w: iw, h: ih }
  // 先裁剪
  const cc = document.createElement('canvas')
  cc.width = Math.max(1, Math.round(crop.w)); cc.height = Math.max(1, Math.round(crop.h))
  const cctx = cc.getContext('2d')!
  cctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cc.width, cc.height)
  // 再旋转/翻转
  const rot = ((xf.rotate % 360) + 360) % 360
  const swap = rot === 90 || rot === 270
  const ow = swap ? cc.height : cc.width
  const oh = swap ? cc.width : cc.height
  const oc = document.createElement('canvas')
  oc.width = ow; oc.height = oh
  const octx = oc.getContext('2d')!
  octx.save()
  octx.translate(ow / 2, oh / 2)
  octx.rotate((rot * Math.PI) / 180)
  octx.scale(xf.flipH ? -1 : 1, xf.flipV ? -1 : 1)
  octx.drawImage(cc, -cc.width / 2, -cc.height / 2)
  octx.restore()
  return oc
}

/** 合成边框 + 背景 + 装饰。返回 canvas + 图像本体在画布内的偏移/尺寸（供标注坐标换算） */
interface Composed { canvas: HTMLCanvasElement; imgX: number; imgY: number; imgW: number; imgH: number; W: number; H: number }
function composeBase(base: HTMLCanvasElement, frame: FrameKey, bg: [string, string, string], deco: Deco): Composed {
  const iw = base.width, ih = base.height
  const short = Math.min(iw, ih)
  if (frame === 'none') {
    const c = document.createElement('canvas'); c.width = iw; c.height = ih
    c.getContext('2d')!.drawImage(base, 0, 0)
    return { canvas: c, imgX: 0, imgY: 0, imgW: iw, imgH: ih, W: iw, H: ih }
  }
  const pad = Math.round(short * 0.16 * deco.pad) + 24
  const bar = frame === 'macos' ? Math.max(44, Math.round(ih * 0.045)) : frame === 'browser' ? Math.max(52, Math.round(ih * 0.05)) : 0
  const polaroidBottom = frame === 'polaroid' ? Math.round(short * 0.16) : 0
  const W = iw + pad * 2
  const H = ih + pad * 2 + bar + polaroidBottom
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  const r = Math.max(4, Math.round(short * 0.09 * deco.radius))
  const imgX = pad, imgY = pad + bar

  if (frame === 'minimal' || frame === 'polaroid') {
    if (frame === 'minimal') { ctx.fillStyle = '#eceef1'; ctx.fillRect(0, 0, W, H) } else { ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, W, H) }
    const bw = Math.max(12, Math.round(pad * 0.3))
    ctx.save()
    ctx.shadowColor = `rgba(30,40,60,${0.36 * deco.shadow})`; ctx.shadowBlur = pad * 0.5; ctx.shadowOffsetY = pad * 0.14
    ctx.fillStyle = '#ffffff'
    roundedPath(ctx, pad - bw, pad - bw, iw + bw * 2, ih + bw * 2 + polaroidBottom, r + bw * 0.6)
    ctx.fill()
    ctx.restore()
    ctx.save(); roundedPath(ctx, pad, pad, iw, ih, Math.max(2, r * 0.4)); ctx.clip(); ctx.drawImage(base, pad, pad); ctx.restore()
    if (frame === 'polaroid') {
      ctx.fillStyle = 'rgba(60,60,70,.55)'
      ctx.font = `${Math.round(polaroidBottom * 0.4)}px 'Segoe UI',cursive,sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('◆ Agentic-Island', W / 2, pad + ih + polaroidBottom * 0.55)
      ctx.textAlign = 'left'
    }
    return { canvas: c, imgX: pad, imgY: pad, imgW: iw, imgH: ih, W, H }
  }

  if (frame === 'dark') {
    ctx.fillStyle = '#0e1016'; ctx.fillRect(0, 0, W, H)
    paintBg(ctx, W, H, ['#151922', '#1c2230', '#101319'])
  } else {
    paintBg(ctx, W, H, bg)
  }

  if (frame === 'neon') {
    const ring = Math.max(4, Math.round(pad * 0.09))
    ctx.save()
    ctx.shadowColor = bg[1]; ctx.shadowBlur = pad * 0.55 * (0.5 + deco.shadow)
    const rg = ctx.createLinearGradient(pad, pad, pad + iw, pad + ih)
    rg.addColorStop(0, '#7df9ff'); rg.addColorStop(0.5, bg[1]); rg.addColorStop(1, '#ff7ee2')
    ctx.strokeStyle = rg; ctx.lineWidth = ring
    roundedPath(ctx, pad - ring / 2, pad - ring / 2, iw + ring, ih + ring, r + ring)
    ctx.stroke()
    ctx.restore()
    ctx.save(); roundedPath(ctx, pad, pad, iw, ih, r); ctx.clip(); ctx.drawImage(base, pad, pad); ctx.restore()
    return { canvas: c, imgX: pad, imgY: pad, imgW: iw, imgH: ih, W, H }
  }

  // glass / macos / browser / dark：悬浮卡片
  const cardY = pad
  const cardH = ih + bar
  ctx.save()
  ctx.shadowColor = `rgba(0,0,0,${0.5 * deco.shadow})`; ctx.shadowBlur = pad * 0.6; ctx.shadowOffsetY = pad * 0.18
  ctx.fillStyle = frame === 'dark' ? '#12151d' : '#20242c'
  roundedPath(ctx, pad, cardY, iw, cardH, r)
  ctx.fill()
  ctx.restore()

  if (bar > 0) {
    ctx.save()
    roundedPath(ctx, pad, cardY, iw, cardH, r); ctx.clip()
    const tg = ctx.createLinearGradient(0, cardY, 0, cardY + bar)
    tg.addColorStop(0, '#3a3f4a'); tg.addColorStop(1, '#2b2f38')
    ctx.fillStyle = tg
    ctx.fillRect(pad, cardY, iw, bar)
    const dotR = bar * 0.16
    const cy = cardY + bar / 2
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      ctx.beginPath(); ctx.arc(pad + bar * 0.55 + i * dotR * 3.1, cy, dotR, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill()
    })
    if (frame === 'browser') {
      const ax = pad + bar * 2.2
      const aw = iw - bar * 3.2
      const ah = bar * 0.56
      roundedPath(ctx, ax, cy - ah / 2, aw, ah, ah / 2)
      ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,.4)'
      ctx.font = `${Math.round(ah * 0.52)}px 'Segoe UI',sans-serif`
      ctx.textBaseline = 'middle'
      ctx.fillText('🔒  agentic-island.local', ax + ah * 0.6, cy + 1)
    }
    ctx.restore()
  }
  ctx.save(); roundedPath(ctx, pad, cardY, iw, cardH, r); ctx.clip(); ctx.drawImage(base, pad, cardY + bar); ctx.restore()
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5
  roundedPath(ctx, pad + 0.75, cardY + 0.75, iw - 1.5, cardH - 1.5, r)
  ctx.stroke()
  ctx.restore()
  return { canvas: c, imgX, imgY, imgW: iw, imgH: ih, W, H }
}

/** 在合成画布上绘制一条标注（坐标已在合成画布坐标系） */
function drawAnno(ctx: CanvasRenderingContext2D, a: Anno, base: HTMLCanvasElement, imgX: number, imgY: number): void {
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = a.color; ctx.fillStyle = a.color; ctx.lineWidth = a.width
  const { start: s, end: e } = a
  if (a.tool === 'rect') {
    ctx.strokeRect(Math.min(s.x, e.x), Math.min(s.y, e.y), Math.abs(e.x - s.x), Math.abs(e.y - s.y))
  } else if (a.tool === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse((s.x + e.x) / 2, (s.y + e.y) / 2, Math.abs(e.x - s.x) / 2, Math.abs(e.y - s.y) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (a.tool === 'line') {
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke()
  } else if (a.tool === 'arrow') {
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke()
    const ang = Math.atan2(e.y - s.y, e.x - s.x)
    const head = Math.max(10, a.width * 3.4)
    ctx.beginPath()
    ctx.moveTo(e.x, e.y)
    ctx.lineTo(e.x - head * Math.cos(ang - Math.PI / 6), e.y - head * Math.sin(ang - Math.PI / 6))
    ctx.lineTo(e.x - head * Math.cos(ang + Math.PI / 6), e.y - head * Math.sin(ang + Math.PI / 6))
    ctx.closePath(); ctx.fill()
  } else if (a.tool === 'pen' && a.points && a.points.length > 1) {
    ctx.beginPath(); ctx.moveTo(a.points[0].x, a.points[0].y)
    for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y)
    ctx.stroke()
  } else if (a.tool === 'highlight' && a.points && a.points.length > 1) {
    ctx.globalAlpha = 0.35; ctx.lineWidth = a.width * 4; ctx.globalCompositeOperation = 'multiply'
    ctx.beginPath(); ctx.moveTo(a.points[0].x, a.points[0].y)
    for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y)
    ctx.stroke()
  } else if (a.tool === 'text' && a.text) {
    const fs = Math.max(14, a.width * 6)
    ctx.font = `700 ${fs}px 'Segoe UI',sans-serif`
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 3
    ctx.fillText(a.text, s.x, s.y)
  } else if (a.tool === 'number' && a.n != null) {
    const rad = Math.max(13, a.width * 4)
    ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(rad * 1.1)}px 'Segoe UI',sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(a.n), s.x, s.y + 1)
  } else if (a.tool === 'mosaic' || a.tool === 'blur') {
    // 从基础图像取样对应区域，做像素化 / 模糊，画回该区域
    const x = Math.min(s.x, e.x), y = Math.min(s.y, e.y)
    const w = Math.abs(e.x - s.x), h = Math.abs(e.y - s.y)
    if (w > 3 && h > 3) {
      const sx = x - imgX, sy = y - imgY // 映射回基础图像坐标
      if (a.tool === 'mosaic') {
        const cells = Math.max(6, Math.round(w / 14))
        const tmp = document.createElement('canvas'); tmp.width = cells; tmp.height = Math.max(1, Math.round(cells * h / w))
        const tctx = tmp.getContext('2d')!
        tctx.imageSmoothingEnabled = false
        tctx.drawImage(base, sx, sy, w, h, 0, 0, tmp.width, tmp.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h)
        ctx.imageSmoothingEnabled = true
      } else {
        ctx.save()
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
        ctx.filter = `blur(${Math.max(4, Math.round(w / 22))}px)`
        ctx.drawImage(base, sx - 4, sy - 4, w + 8, h + 8, x - 4, y - 4, w + 8, h + 8)
        ctx.filter = 'none'
        ctx.restore()
      }
    }
  }
  ctx.restore()
}

/** 绘制水印 */
function drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number, deco: Deco): void {
  let txt = deco.watermark
  if (deco.wmStamp) {
    const d = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    txt = txt ? `${txt} · ${stamp}` : stamp
  }
  if (!txt) return
  const fs = Math.max(12, Math.round(Math.min(W, H) * 0.024))
  ctx.save()
  ctx.font = `600 ${fs}px 'Segoe UI',sans-serif`
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
  ctx.fillStyle = 'rgba(255,255,255,.7)'
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4
  ctx.fillText(txt, W - fs * 0.9, H - fs * 0.7)
  ctx.restore()
}

// ────────────────────────────── AI 增强动作定义 ──────────────────────────────
interface AIAction { key: string; label: string; icon: string; system: string; prompt: string; group: string }
const OCR_SYS = '你是精准的 OCR 与图像理解助手。只依据图片内容作答，不要编造。用简体中文回复。'
const AI_ACTIONS: AIAction[] = [
  { key: 'ocr', group: '文字', icon: '🔤', label: 'OCR 提取文字', system: OCR_SYS, prompt: '把这张图里的所有文字**逐行**提取出来，保持原有换行与顺序，只输出文字本身，不要解释。' },
  { key: 'trans', group: '文字', icon: '🌐', label: '翻译图中文字', system: OCR_SYS, prompt: '识别图中文字，若是中文则翻译成英文，否则翻译成简体中文。左侧给原文、右侧给译文，逐行对照。' },
  { key: 'handwrite', group: '文字', icon: '✍️', label: '手写/笔记转文本', system: OCR_SYS, prompt: '这可能是手写内容或潦草笔记，请把它整理成整洁、通顺的书面文本，修正明显笔误，保留原意与要点结构。' },
  { key: 'lang', group: '文字', icon: '🈳', label: '识别语言并标注', system: OCR_SYS, prompt: '识别图中出现的所有自然语言种类，列出每种语言及其对应的示例片段。' },
  { key: 'contacts', group: '文字', icon: '📇', label: '提取链接/邮箱/电话', system: OCR_SYS, prompt: '从图中提取所有链接(URL)、邮箱地址、电话号码，分类列出；没有的类别写“无”。' },
  { key: 'desc', group: '理解', icon: '💬', label: '一句话描述', system: OCR_SYS, prompt: '用一句话（不超过 40 字）概括这张图片的内容。' },
  { key: 'explain', group: '理解', icon: '🔍', label: '解读/讲解内容', system: OCR_SYS, prompt: '详细解读这张截图：它展示了什么、关键信息有哪些、可能的上下文是什么。分点说明。' },
  { key: 'summary', group: '理解', icon: '📝', label: '总结长文要点', system: OCR_SYS, prompt: '这可能是一段长文/文章截图，请提炼 3-6 条核心要点，用简洁的项目符号列出。' },
  { key: 'ui', group: '理解', icon: '🎨', label: 'UI 设计改进建议', system: OCR_SYS, prompt: '把这张图当作一个界面设计稿，从布局、对比度、层级、可用性、无障碍角度给出 4-6 条具体改进建议。' },
  { key: 'chart', group: '数据', icon: '📊', label: '读图表并总结', system: OCR_SYS, prompt: '这是一张图表，请读出其中的关键数值与趋势，并用 2-3 句话总结它想表达的结论。' },
  { key: 'table', group: '数据', icon: '▦', label: '表格转 Markdown', system: OCR_SYS, prompt: '把图中的表格精确转成 Markdown 表格，保留所有行列与表头，只输出表格。' },
  { key: 'numbers', group: '数据', icon: '🔢', label: '提取关键数字', system: OCR_SYS, prompt: '提取图中所有关键数字/指标/金额，用「名称：数值」的形式逐条列出。' },
  { key: 'code', group: '开发', icon: '⌨️', label: '代码截图转文本', system: OCR_SYS, prompt: '这是一张代码截图，请逐字转成可复制的纯代码文本，保持缩进与换行，用代码块包裹，不要解释。' },
  { key: 'diagnose', group: '开发', icon: '🩺', label: '报错诊断+修复', system: OCR_SYS, prompt: '这可能是一张报错/异常截图。请：1) 提取错误信息；2) 分析最可能的原因；3) 给出具体修复步骤。' },
  { key: 'todo', group: '效率', icon: '☑️', label: '提取待办/行动项', system: OCR_SYS, prompt: '从图中提取所有待办事项 / 行动项 / 任务，用清单形式（- [ ]）逐条列出。' },
  { key: 'alt', group: '效率', icon: '♿', label: '生成 alt 文本', system: OCR_SYS, prompt: '为这张图片生成简洁、准确的无障碍 alt 文本（一句话，客观描述，用于屏幕阅读器）。' },
  { key: 'social', group: '效率', icon: '📢', label: '社交媒体配文', system: OCR_SYS, prompt: '为这张图配一段吸引人的社交媒体文案（含 2-3 个话题标签），语气轻松专业。' },
  { key: 'filename', group: '效率', icon: '🏷️', label: '起个文件名', system: OCR_SYS, prompt: '根据图片内容给它起一个简洁、语义化的英文文件名（kebab-case，不含扩展名），只输出这一个文件名。' },
  { key: 'privacy', group: '安全', icon: '🛡️', label: '敏感信息检测', system: OCR_SYS, prompt: '检查这张图是否包含敏感信息（密码、密钥、身份证、手机号、银行卡、私密路径、Token 等）。逐项指出位置与类型；若安全则明确说明“未发现敏感信息”。' },
  { key: 'objects', group: '安全', icon: '🧩', label: '识别主要元素', system: OCR_SYS, prompt: '列出这张图中出现的主要对象/元素/区域，按重要性排序，每条一行。' }
]

// ────────────────────────────── 组件 ──────────────────────────────
export function ScreenshotStudio({ dataUrl, onClose, llmReady, onAskImage, onAIVision }: Props): React.JSX.Element {
  const [frame, setFrame] = useState<FrameKey>('glass')
  const [bgKey, setBgKey] = useState('aurora')
  const [deco, setDeco] = useState<Deco>(DEFAULT_DECO)
  const [xf, setXf] = useState<Xform>(DEFAULT_XFORM)

  // 标注状态
  const [tool, setTool] = useState<Tool>('none')
  const [color, setColor] = useState('#ff3b30')
  const [lineW, setLineW] = useState(4)
  const [annos, setAnnos] = useState<Anno[]>([])
  const [redoStack, setRedoStack] = useState<Anno[]>([])
  const [draft, setDraft] = useState<Anno | null>(null) // 正在绘制
  const [textInput, setTextInput] = useState<{ x: number; y: number; sx: number; sy: number; value: string } | null>(null)
  const [cropSel, setCropSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [cropMode, setCropMode] = useState(false)

  const [tab, setTab] = useState<'design' | 'annotate' | 'ai'>('design')
  const [out, setOut] = useState('')
  const [toast, setToast] = useState('')

  // AI 状态
  const [aiBusy, setAiBusy] = useState('')
  const [aiResults, setAiResults] = useState<{ id: number; label: string; text: string; err?: boolean }[]>([])
  const [askInput, setAskInput] = useState('')

  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const composedRef = useRef<Composed | null>(null) // 最近一次合成（含坐标映射）
  const previewRef = useRef<HTMLImageElement | null>(null) // 预览 <img> DOM
  const numCounter = useRef(1)
  const idCounter = useRef(1)

  const bg = useMemo(() => (BGS.find((b) => b.key === bgKey) || BGS[0]).stops, [bgKey])

  // 加载原图
  useEffect(() => {
    const img = new Image()
    img.onload = () => { imgRef.current = img; setImgLoaded(true) }
    img.src = dataUrl
  }, [dataUrl])

  // 是否处于“零处理”路径：原图 + 无任何编辑 → 位级一致导出原始 dataUrl
  const untouched = frame === 'none' && annos.length === 0 && !xf.crop && xf.rotate === 0 && !xf.flipH && !xf.flipV &&
    !deco.watermark && !deco.wmStamp && deco.scale === 1

  /** 核心：完整合成（transform → 边框/背景/装饰 → 标注 → 水印 → 倍率），返回 dataURL */
  const render = (mult = deco.scale): string => {
    const img = imgRef.current
    if (!img) return dataUrl
    if (untouched && mult === 1) return dataUrl
    const base = bakeTransform(img, xf)
    const comp = composeBase(base, frame, bg, deco)
    composedRef.current = comp
    const ctx = comp.canvas.getContext('2d')!
    // 标注 + 草稿
    const all = draft ? [...annos, draft] : annos
    for (const a of all) drawAnno(ctx, a, base, comp.imgX, comp.imgY)
    drawWatermark(ctx, comp.W, comp.H, deco)
    if (mult !== 1) {
      const up = document.createElement('canvas')
      up.width = comp.canvas.width * mult; up.height = comp.canvas.height * mult
      const uctx = up.getContext('2d')!
      uctx.imageSmoothingEnabled = true; uctx.imageSmoothingQuality = 'high'
      uctx.drawImage(comp.canvas, 0, 0, up.width, up.height)
      return up.toDataURL('image/png')
    }
    return comp.canvas.toDataURL('image/png')
  }

  // 重新渲染预览（依赖变化 / 标注变化 / 草稿变化）
  useEffect(() => {
    if (!imgLoaded) return
    setOut(render(1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgLoaded, frame, bgKey, deco.radius, deco.shadow, deco.pad, deco.watermark, deco.wmStamp, annos, draft, xf])

  const final = untouched ? dataUrl : out || dataUrl

  const flash = (m: string): void => { setToast(m); setTimeout(() => setToast(''), 2400) }

  // ── 撤销 / 重做 ──
  const undo = (): void => {
    setAnnos((prev) => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      setRedoStack((r) => [...r, last])
      return prev.slice(0, -1)
    })
  }
  const redo = (): void => {
    setRedoStack((r) => {
      if (!r.length) return r
      const item = r[r.length - 1]
      setAnnos((a) => [...a, item])
      return r.slice(0, -1)
    })
  }
  const clearAnno = (): void => { setAnnos([]); setRedoStack([]); numCounter.current = 1 }

  // ── 坐标换算：预览 <img> 事件坐标 → 合成画布坐标 ──
  const toCanvasPt = (e: React.MouseEvent): Pt | null => {
    const el = previewRef.current
    const comp = composedRef.current
    if (!el || !comp) return null
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    return { x: px * comp.W, y: py * comp.H }
  }

  // ── 标注绘制交互 ──
  const onDown = (e: React.MouseEvent): void => {
    if (cropMode) { const p = toCanvasPt(e); if (p) setCropSel({ x: p.x, y: p.y, w: 0, h: 0 }); return }
    if (tool === 'none') return
    const p = toCanvasPt(e)
    if (!p) return
    if (tool === 'text') {
      const el = previewRef.current!
      const rect = el.getBoundingClientRect()
      setTextInput({ x: e.clientX - rect.left, y: e.clientY - rect.top, sx: p.x, sy: p.y, value: '' })
      return
    }
    if (tool === 'number') {
      const a: Anno = { id: idCounter.current++, tool: 'number', color, width: lineW, start: p, end: p, n: numCounter.current++ }
      setAnnos((prev) => [...prev, a]); setRedoStack([])
      return
    }
    const base: Anno = { id: idCounter.current++, tool, color, width: lineW, start: p, end: p }
    if (tool === 'pen' || tool === 'highlight') base.points = [p]
    setDraft(base)
  }
  const onMove = (e: React.MouseEvent): void => {
    if (cropMode && cropSel && e.buttons === 1) {
      const p = toCanvasPt(e); if (!p) return
      setCropSel({ x: Math.min(cropSel.x, p.x), y: Math.min(cropSel.y, p.y), w: Math.abs(p.x - cropSel.x), h: Math.abs(p.y - cropSel.y) })
      return
    }
    if (!draft) return
    const p = toCanvasPt(e)
    if (!p) return
    setDraft((d) => {
      if (!d) return d
      if (d.tool === 'pen' || d.tool === 'highlight') return { ...d, end: p, points: [...(d.points || []), p] }
      return { ...d, end: p }
    })
  }
  const onUp = (): void => {
    if (cropMode) return
    if (draft) {
      const d = draft
      const moved = Math.abs(d.end.x - d.start.x) > 2 || Math.abs(d.end.y - d.start.y) > 2 || (d.points && d.points.length > 2)
      if (moved) { setAnnos((prev) => [...prev, d]); setRedoStack([]) }
      setDraft(null)
    }
  }

  const commitText = (): void => {
    if (textInput && textInput.value.trim()) {
      const a: Anno = { id: idCounter.current++, tool: 'text', color, width: lineW, start: { x: textInput.sx, y: textInput.sy }, end: { x: textInput.sx, y: textInput.sy }, text: textInput.value.trim() }
      setAnnos((prev) => [...prev, a]); setRedoStack([])
    }
    setTextInput(null)
  }

  // ── 裁剪 / 旋转 / 翻转 ──
  const applyCrop = (): void => {
    const comp = composedRef.current
    const sel = cropSel
    if (!comp || !sel || sel.w < 8 || sel.h < 8) { setCropMode(false); setCropSel(null); return }
    // 合成画布坐标 → 基础图像坐标（减去图像在画布内偏移）
    const bx = Math.max(0, sel.x - comp.imgX)
    const by = Math.max(0, sel.y - comp.imgY)
    const bw = Math.min(comp.imgW - bx, sel.w)
    const bh = Math.min(comp.imgH - by, sel.h)
    if (bw < 4 || bh < 4) { setCropMode(false); setCropSel(null); return }
    // 累加到 xform.crop（相对当前 base；需换算回原图坐标——简化：先烘焙当前 base 为新原图）
    const img = imgRef.current
    if (!img) return
    const baseCanvas = bakeTransform(img, xf)
    const cropped = document.createElement('canvas')
    cropped.width = Math.round(bw); cropped.height = Math.round(bh)
    cropped.getContext('2d')!.drawImage(baseCanvas, bx, by, bw, bh, 0, 0, cropped.width, cropped.height)
    const newImg = new Image()
    newImg.onload = () => {
      imgRef.current = newImg
      setXf(DEFAULT_XFORM) // 已烘焙进新原图
      setAnnos([]); setRedoStack([])
      setCropMode(false); setCropSel(null)
      setOut(''); setImgLoaded(true); flash('✓ 已裁剪')
      // 触发重渲
      setTimeout(() => setOut(render(1)), 0)
    }
    newImg.src = cropped.toDataURL('image/png')
  }
  const rotate = (deg: number): void => setXf((x) => ({ ...x, rotate: (((x.rotate + deg) % 360) + 360) % 360 }))
  const flip = (dir: 'h' | 'v'): void => setXf((x) => (dir === 'h' ? { ...x, flipH: !x.flipH } : { ...x, flipV: !x.flipV }))

  // ── 导出 ──
  const doCopy = (): void => { island.copyImage(render(deco.scale)); flash(`✓ 已复制到剪贴板（PNG${deco.scale > 1 ? ` ${deco.scale}x` : ' 无损'}）`) }
  const doSave = (): void => {
    const img = render(deco.scale)
    const d = new Date()
    void island.saveImage(img, `截图_${d.getMonth() + 1}-${d.getDate()}_${d.getHours()}${String(d.getMinutes()).padStart(2, '0')}${deco.scale > 1 ? `_${deco.scale}x` : ''}`).then((r) => {
      if (r.ok) flash('✓ 已保存 ' + (r.path || '')); else if (!r.canceled) flash('✗ ' + (r.error || '保存失败'))
    })
  }
  const doAsk = (): void => onAskImage(render(deco.scale))

  // ── AI 调用 ──
  const runAI = (label: string, system: string, prompt: string): void => {
    if (!llmReady || aiBusy) return
    setAiBusy(label); setTab('ai')
    const img = render(1)
    void onAIVision(system, img, prompt).then((r) => {
      const id = Date.now() + Math.random()
      if (r.ok) setAiResults((prev) => [{ id, label, text: (r.text || '').trim() || '(空结果)' }, ...prev])
      else setAiResults((prev) => [{ id, label, text: r.error || '调用失败（当前模型可能不支持图片输入）', err: true }, ...prev])
      setAiBusy('')
    }).catch((err: unknown) => {
      const id = Date.now() + Math.random()
      setAiResults((prev) => [{ id, label, text: String(err), err: true }, ...prev])
      setAiBusy('')
    })
  }
  const runAsk = (): void => {
    const q = askInput.trim()
    if (!q) return
    setAskInput('')
    runAI(`问图：${q.slice(0, 18)}${q.length > 18 ? '…' : ''}`, OCR_SYS, `围绕这张图回答：${q}`)
  }
  const copyResult = (text: string): void => {
    void navigator.clipboard.writeText(text).then(() => flash('✓ 结果已复制')).catch(() => flash('✗ 复制失败'))
  }

  // ── 快捷键 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (textInput) return // 输入时不拦截
      const ae = document.activeElement
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') { onClose(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); doCopy() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); doSave() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textInput, annos, redoStack, deco, xf, frame, bgKey])

  // ── 样式片段 ──
  const chip = (active: boolean): React.CSSProperties => ({
    flex: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '6px 11px', borderRadius: 9, cursor: 'pointer',
    background: active ? 'oklch(0.4 0.09 var(--th) / .45)' : 'rgba(255,255,255,.04)',
    border: `1px solid ${active ? 'oklch(0.72 0.14 var(--th) / .55)' : 'rgba(255,255,255,.07)'}`,
    color: active ? 'oklch(0.92 0.06 var(--th))' : 'oklch(0.8 0.02 var(--th) / .8)', fontSize: 11, fontWeight: 600
  })
  const label9: React.CSSProperties = { color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 9.5, flex: 'none' }
  const slider: React.CSSProperties = { flex: 1, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }
  const btnSm = (active = false): React.CSSProperties => ({
    padding: '5px 9px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
    background: active ? 'oklch(0.42 0.1 var(--th) / .5)' : 'rgba(255,255,255,.05)',
    border: `1px solid ${active ? 'oklch(0.72 0.14 var(--th) / .5)' : 'rgba(255,255,255,.08)'}`,
    color: 'oklch(0.86 0.02 var(--th))'
  })

  const TOOLS: { key: Tool; icon: string; label: string }[] = [
    { key: 'none', icon: '👆', label: '选择' },
    { key: 'arrow', icon: '➘', label: '箭头' },
    { key: 'rect', icon: '▭', label: '矩形' },
    { key: 'ellipse', icon: '◯', label: '椭圆' },
    { key: 'line', icon: '╱', label: '直线' },
    { key: 'pen', icon: '✎', label: '画笔' },
    { key: 'highlight', icon: '🖍', label: '荧光笔' },
    { key: 'text', icon: 'T', label: '文字' },
    { key: 'number', icon: '①', label: '序号' },
    { key: 'mosaic', icon: '▦', label: '马赛克' },
    { key: 'blur', icon: '◌', label: '模糊' }
  ]

  const drawing = tool !== 'none' || cropMode

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.08 0.02 var(--ths) / .55)', backdropFilter: 'blur(4px)', animation: 'ai-fadein .15s ease' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(960px, 94vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'oklch(calc(0.16 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .98)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', animation: 'ai-riseblur .3s cubic-bezier(.22,.61,.36,1)' }}>
        {/* 头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 15px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          <span style={{ fontSize: 15 }}>📸</span>
          <span style={{ color: 'oklch(0.95 0.01 var(--th))', fontSize: 13, fontWeight: 700 }}>截图工坊 <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9.5, fontWeight: 400 }}>专业版 · 原生分辨率 · PNG 无损</span></span>
          {/* 顶部 Tab */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            {([['design', '🎨 设计'], ['annotate', '✏️ 标注'], ['ai', '✨ AI']] as const).map(([k, l]) => (
              <span key={k} className="hv" onClick={() => setTab(k)} style={{ ...btnSm(tab === k), padding: '4px 10px' }}>{l}</span>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {toast && <span style={{ color: 'oklch(0.8 0.11 150)', fontSize: 10.5 }}>{toast}</span>}
          <span className="hv" onClick={onClose} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 14 }}>✕</span>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* 预览区 */}
          <div className="ai-scroll" style={{ flex: 1, minWidth: 0, minHeight: 260, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'repeating-conic-gradient(rgba(255,255,255,.045) 0% 25%, transparent 0% 50%) 0 0 / 22px 22px', position: 'relative' }}>
            <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '58vh', lineHeight: 0 }}>
              <img ref={previewRef} src={final} alt="截图预览" draggable={false}
                onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                style={{ maxWidth: '100%', maxHeight: '58vh', borderRadius: 8, boxShadow: '0 10px 34px rgba(0,0,0,.45)', cursor: drawing ? 'crosshair' : 'default', userSelect: 'none' }} />
              {/* 裁剪选框叠层（预览像素） */}
              {cropMode && cropSel && composedRef.current && previewRef.current && (
                <div style={{
                  position: 'absolute', pointerEvents: 'none', border: '2px dashed oklch(0.85 0.14 var(--th))', background: 'oklch(0.85 0.14 var(--th) / .12)',
                  left: `${(cropSel.x / composedRef.current.W) * 100}%`, top: `${(cropSel.y / composedRef.current.H) * 100}%`,
                  width: `${(cropSel.w / composedRef.current.W) * 100}%`, height: `${(cropSel.h / composedRef.current.H) * 100}%`
                }} />
              )}
              {/* 文字行内输入框 */}
              {textInput && (
                <input autoFocus value={textInput.value} onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                  onBlur={commitText} onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextInput(null) }}
                  placeholder="输入文字，回车确认"
                  style={{ position: 'absolute', left: textInput.x, top: textInput.y, minWidth: 120, padding: '2px 6px', border: `2px solid ${color}`, borderRadius: 5, background: 'rgba(20,20,26,.9)', color, fontSize: 13, fontWeight: 700, outline: 'none' }} />
              )}
            </div>
            {aiBusy && (
              <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, background: 'oklch(0.2 0.04 var(--th) / .9)', border: '1px solid oklch(0.6 0.12 var(--th) / .4)' }}>
                <span style={{ display: 'inline-flex', gap: 3 }}>
                  {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: 3, background: 'oklch(0.8 0.14 var(--th))', animation: `ai-dotpulse 1s ${i * 0.15}s infinite` }} />)}
                </span>
                <span style={{ color: 'oklch(0.88 0.04 var(--th))', fontSize: 11 }}>{aiBusy}…</span>
              </div>
            )}
          </div>

          {/* 右侧控制面板 */}
          <div className="ai-scroll" style={{ width: 320, flex: 'none', overflow: 'auto', borderLeft: '1px solid rgba(255,255,255,.07)', padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tab === 'design' && (
              <>
                {/* 边框 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {FRAMES.map((f) => (
                    <div key={f.key} className="hv" onClick={() => setFrame(f.key)} title={f.hint} style={chip(frame === f.key)}>{f.label}</div>
                  ))}
                </div>
                {/* 背景 */}
                {frame !== 'none' && frame !== 'minimal' && frame !== 'polaroid' && frame !== 'dark' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={label9}>背景</span>
                    {BGS.map((b) => (
                      <div key={b.key} className="hv" onClick={() => setBgKey(b.key)} title={b.label} style={{ width: 26, height: 26, borderRadius: 8, cursor: 'pointer', background: `linear-gradient(135deg, ${b.stops[0]}, ${b.stops[1]}, ${b.stops[2]})`, border: bgKey === b.key ? '2px solid oklch(0.85 0.12 var(--th))' : '2px solid transparent' }} />
                    ))}
                  </div>
                )}
                {/* 装饰滑杆 */}
                {frame !== 'none' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ ...label9, width: 42 }}>圆角</span><input type="range" min={0} max={1} step={0.05} value={deco.radius} onChange={(e) => setDeco({ ...deco, radius: Number(e.target.value) })} style={slider} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ ...label9, width: 42 }}>阴影</span><input type="range" min={0} max={1} step={0.05} value={deco.shadow} onChange={(e) => setDeco({ ...deco, shadow: Number(e.target.value) })} style={slider} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ ...label9, width: 42 }}>内边距</span><input type="range" min={0} max={1} step={0.05} value={deco.pad} onChange={(e) => setDeco({ ...deco, pad: Number(e.target.value) })} style={slider} /></div>
                  </>
                )}
                {/* 变换 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={label9}>变换</span>
                  <span className="hv" onClick={() => rotate(-90)} style={btnSm()} title="逆时针 90°">⟲</span>
                  <span className="hv" onClick={() => rotate(90)} style={btnSm()} title="顺时针 90°">⟳</span>
                  <span className="hv" onClick={() => flip('h')} style={btnSm(xf.flipH)} title="水平翻转">◧</span>
                  <span className="hv" onClick={() => flip('v')} style={btnSm(xf.flipV)} title="垂直翻转">⬒</span>
                  <span className="hv" onClick={() => { setCropMode((v) => !v); setCropSel(null); setTool('none') }} style={btnSm(cropMode)} title="框选裁剪">✂ 裁剪</span>
                  {cropMode && <span className="hv" onClick={applyCrop} style={{ ...btnSm(), background: 'oklch(0.55 0.14 150 / .5)' }}>应用</span>}
                </div>
                {/* 水印 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...label9, width: 42 }}>水印</span>
                    <input value={deco.watermark} onChange={(e) => setDeco({ ...deco, watermark: e.target.value })} placeholder="自定义水印文字"
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 7, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: 'oklch(0.9 0.02 var(--th))', fontSize: 11, outline: 'none' }} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 11 }}>
                    <input type="checkbox" checked={deco.wmStamp} onChange={(e) => setDeco({ ...deco, wmStamp: e.target.checked })} style={{ accentColor: 'oklch(0.75 0.14 var(--th))' }} /> 追加时间戳
                  </label>
                </div>
                {/* 倍率 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={label9}>导出倍率</span>
                  {[1, 2, 3].map((s) => (
                    <span key={s} className="hv" onClick={() => setDeco({ ...deco, scale: s })} style={btnSm(deco.scale === s)}>{s}x</span>
                  ))}
                  <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 8.5 }}>1x 无损</span>
                </div>
              </>
            )}

            {tab === 'annotate' && (
              <>
                {/* 工具 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {TOOLS.map((t) => (
                    <div key={t.key} className="hv" onClick={() => { setTool(t.key); setCropMode(false) }} title={t.label} style={{ ...chip(tool === t.key), padding: '6px 9px' }}><span style={{ fontSize: 12 }}>{t.icon}</span>{t.label}</div>
                  ))}
                </div>
                {/* 颜色 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={label9}>颜色</span>
                  {PALETTE.map((c) => (
                    <div key={c} className="hv" onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: 6, cursor: 'pointer', background: c, border: color === c ? '2px solid oklch(0.92 0.05 var(--th))' : '2px solid rgba(255,255,255,.15)' }} />
                  ))}
                </div>
                {/* 线宽 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...label9, width: 42 }}>线宽</span>
                  <input type="range" min={2} max={16} step={1} value={lineW} onChange={(e) => setLineW(Number(e.target.value))} style={slider} />
                  <span style={{ color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 10, width: 20, textAlign: 'right' }}>{lineW}</span>
                </div>
                {/* 撤销/重做/清空 */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="hv" onClick={undo} style={{ ...btnSm(), flex: 1, textAlign: 'center', opacity: annos.length ? 1 : 0.4 }}>↶ 撤销</span>
                  <span className="hv" onClick={redo} style={{ ...btnSm(), flex: 1, textAlign: 'center', opacity: redoStack.length ? 1 : 0.4 }}>↷ 重做</span>
                  <span className="hv" onClick={clearAnno} style={{ ...btnSm(), flex: 1, textAlign: 'center', opacity: annos.length ? 1 : 0.4 }}>🗑 清空</span>
                </div>
                <div style={{ color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9.5, lineHeight: 1.6 }}>
                  在左侧图上按住拖拽绘制。文字/序号点击即放置。马赛克/模糊框选区域遮盖敏感内容。<br />快捷键：Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Esc 关闭。
                </div>
              </>
            )}

            {tab === 'ai' && (
              <>
                {!llmReady && (
                  <div style={{ padding: '9px 11px', borderRadius: 9, background: 'oklch(0.4 0.09 75 / .18)', border: '1px solid oklch(0.7 0.13 75 / .35)', color: 'oklch(0.85 0.09 75)', fontSize: 10.5, lineHeight: 1.55 }}>
                    ⚠ 请先在「设置」里配置视觉模型（API），再使用 AI 增强能力。
                  </div>
                )}
                {/* 自由问图 */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={askInput} disabled={!llmReady} onChange={(e) => setAskInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runAsk() }}
                    placeholder="问关于这张图的任何问题…"
                    style={{ flex: 1, padding: '7px 9px', borderRadius: 8, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: 'oklch(0.9 0.02 var(--th))', fontSize: 11, outline: 'none', opacity: llmReady ? 1 : 0.5 }} />
                  <span className="hv" onClick={runAsk} style={{ ...btnSm(), opacity: llmReady && askInput.trim() && !aiBusy ? 1 : 0.4, padding: '7px 12px' }}>问</span>
                </div>
                {/* 动作矩阵，按分组 */}
                {['文字', '理解', '数据', '开发', '效率', '安全'].map((grp) => (
                  <div key={grp} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ ...label9, letterSpacing: 1 }}>{grp}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {AI_ACTIONS.filter((a) => a.group === grp).map((a) => (
                        <div key={a.key} className="hv" onClick={() => runAI(a.label, a.system, a.prompt)} title={a.label}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, cursor: llmReady && !aiBusy ? 'pointer' : 'not-allowed', opacity: llmReady && !aiBusy ? 1 : 0.4, background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.08)', color: 'oklch(0.85 0.02 var(--th))', fontSize: 10.5 }}>
                          <span>{a.icon}</span>{a.label}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {/* 结果面板 */}
                {aiResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...label9, letterSpacing: 1 }}>结果</span>
                      <span className="hv" onClick={() => setAiResults([])} style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9.5, cursor: 'pointer', marginLeft: 'auto' }}>清空</span>
                    </div>
                    {aiResults.map((r) => (
                      <div key={r.id} style={{ padding: '8px 10px', borderRadius: 9, background: r.err ? 'oklch(0.35 0.1 25 / .18)' : 'rgba(255,255,255,.04)', border: `1px solid ${r.err ? 'oklch(0.6 0.14 25 / .35)' : 'rgba(255,255,255,.08)'}`, animation: 'ai-fadein .2s ease' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                          <span style={{ color: r.err ? 'oklch(0.75 0.13 25)' : 'oklch(0.82 0.06 var(--th))', fontSize: 10.5, fontWeight: 700 }}>{r.label}</span>
                          {!r.err && <span className="hv" onClick={() => copyResult(r.text)} style={{ marginLeft: 'auto', color: 'oklch(0.65 0.02 var(--th) / .7)', fontSize: 9.5, cursor: 'pointer' }}>📋 复制</span>}
                        </div>
                        <div style={{ color: r.err ? 'oklch(0.8 0.08 25)' : 'oklch(0.85 0.015 var(--th))', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto' }} className="ai-scroll">{r.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 15px 13px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
          <div className="hv" onClick={doAsk} style={{ flex: 'none', textAlign: 'center', padding: '9px 14px', borderRadius: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'oklch(0.88 0.02 var(--th))', fontSize: 12, fontWeight: 700 }} title="把当前图交给「截图问 AI」浮层">💬 问 AI</div>
          <div className="hv" onClick={doCopy} style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'oklch(0.88 0.02 var(--th))', fontSize: 12, fontWeight: 700 }}>📋 复制</div>
          <div className="hv" onClick={doSave} style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 10, cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 12, fontWeight: 700 }}>💾 保存 PNG{deco.scale > 1 ? ` ${deco.scale}x` : ''}</div>
        </div>
      </div>
    </div>
  )
}
