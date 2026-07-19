// 截图工坊（专业版）：无损像素截图 + 高级边框美化 + 手写 canvas 标注编辑器 + 20+ AI 视觉增强。
// 合成管线：原图 →（裁剪/旋转/翻转）→ 边框/背景/装饰（圆角/阴影/内边距/水印）→ 标注层 → 导出。
// canvas 全程按原生分辨率合成（图像像素 1:1，倍率仅可选放大）；「原图」+ 无任何编辑时直接导出原始 dataURL，位级一致。

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Accessibility, AtSign, BarChart3, Camera, Check, Circle, ClipboardPaste, Code, Copy, Crop, Droplets, FileImage, FileText, FlipHorizontal, FlipVertical, Globe, Grid, Hash, Highlighter, Languages, ListChecks, Maximize2, Megaphone, MessageSquare, Monitor, MousePointer2, MoveUpRight, Palette, PenLine, PenTool, Pencil, Redo2, RotateCcw, RotateCw, Save, ScanLine, ScanText, Shapes, ShieldCheck, Slash, Sparkles, Square, Stethoscope, Table, Tag, TriangleAlert, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { LucideIcon } from '../ui/icons'
import { Button, Chip, IconButton, Input, Segmented, Slider, Switch } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'
import { island } from '../bridge'
import { clampRect, dataUrlBytes, dragRect, exportDimensions, formatBytes, formatExtension, sanitizeScreenshotName } from '../logic/screenshot'
import type { Point as Pt, Rect, ScreenshotFormat } from '../logic/screenshot'

interface Props {
  dataUrl: string
  onClose: () => void
  llmReady: boolean
  onAskImage: (dataUrl: string) => void
  onAIVision: (system: string, dataUrl: string, prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  onRetake: () => void
  onCreateTodo: (text: string) => void
  onCreateNote: (title: string, text: string) => void
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

/** 标注坐标存储在基础图像坐标系中，切换边框/留白后仍保持在原内容位置。 */
function drawAnno(ctx: CanvasRenderingContext2D, a: Anno, base: HTMLCanvasElement, imgX: number, imgY: number): void {
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = a.color; ctx.fillStyle = a.color; ctx.lineWidth = a.width
  const map = (p: Pt): Pt => ({ x: p.x + imgX, y: p.y + imgY })
  const s = map(a.start), e = map(a.end)
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
    const first = map(a.points[0])
    ctx.beginPath(); ctx.moveTo(first.x, first.y)
    for (let i = 1; i < a.points.length; i++) { const p = map(a.points[i]); ctx.lineTo(p.x, p.y) }
    ctx.stroke()
  } else if (a.tool === 'highlight' && a.points && a.points.length > 1) {
    ctx.globalAlpha = 0.35; ctx.lineWidth = a.width * 4; ctx.globalCompositeOperation = 'multiply'
    const first = map(a.points[0])
    ctx.beginPath(); ctx.moveTo(first.x, first.y)
    for (let i = 1; i < a.points.length; i++) { const p = map(a.points[i]); ctx.lineTo(p.x, p.y) }
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
    const localX = Math.min(a.start.x, a.end.x), localY = Math.min(a.start.y, a.end.y)
    const x = localX + imgX, y = localY + imgY
    const w = Math.abs(e.x - s.x), h = Math.abs(e.y - s.y)
    if (w > 3 && h > 3) {
      const sx = Math.max(0, localX), sy = Math.max(0, localY)
      const sw = Math.min(w, base.width - sx), sh = Math.min(h, base.height - sy)
      if (sw <= 0 || sh <= 0) { ctx.restore(); return }
      if (a.tool === 'mosaic') {
        const cells = Math.max(6, Math.round(sw / 14))
        const tmp = document.createElement('canvas'); tmp.width = cells; tmp.height = Math.max(1, Math.round(cells * sh / sw))
        const tctx = tmp.getContext('2d')!
        tctx.imageSmoothingEnabled = false
        tctx.drawImage(base, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, sw, sh)
        ctx.imageSmoothingEnabled = true
      } else {
        ctx.save()
        ctx.beginPath(); ctx.rect(x, y, sw, sh); ctx.clip()
        ctx.filter = `blur(${Math.max(4, Math.round(sw / 22))}px)`
        ctx.drawImage(base, sx, sy, sw, sh, x, y, sw, sh)
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
interface AIAction { key: string; label: string; icon: LucideIcon; system: string; prompt: string; group: string }
const OCR_SYS = '你是精准的 OCR 与图像理解助手。只依据图片内容作答，不要编造。用简体中文回复。'
const AI_ACTIONS: AIAction[] = [
  { key: 'ocr', group: '文字', icon: ScanText, label: 'OCR 提取文字', system: OCR_SYS, prompt: '把这张图里的所有文字**逐行**提取出来，保持原有换行与顺序，只输出文字本身，不要解释。' },
  { key: 'trans', group: '文字', icon: Languages, label: '翻译图中文字', system: OCR_SYS, prompt: '识别图中文字，若是中文则翻译成英文，否则翻译成简体中文。左侧给原文、右侧给译文，逐行对照。' },
  { key: 'handwrite', group: '文字', icon: PenLine, label: '手写/笔记转文本', system: OCR_SYS, prompt: '这可能是手写内容或潦草笔记，请把它整理成整洁、通顺的书面文本，修正明显笔误，保留原意与要点结构。' },
  { key: 'lang', group: '文字', icon: Globe, label: '识别语言并标注', system: OCR_SYS, prompt: '识别图中出现的所有自然语言种类，列出每种语言及其对应的示例片段。' },
  { key: 'contacts', group: '文字', icon: AtSign, label: '提取链接/邮箱/电话', system: OCR_SYS, prompt: '从图中提取所有链接(URL)、邮箱地址、电话号码，分类列出；没有的类别写“无”。' },
  { key: 'desc', group: '理解', icon: MessageSquare, label: '一句话描述', system: OCR_SYS, prompt: '用一句话（不超过 40 字）概括这张图片的内容。' },
  { key: 'explain', group: '理解', icon: ScanLine, label: '解读/讲解内容', system: OCR_SYS, prompt: '详细解读这张截图：它展示了什么、关键信息有哪些、可能的上下文是什么。分点说明。' },
  { key: 'summary', group: '理解', icon: FileText, label: '总结长文要点', system: OCR_SYS, prompt: '这可能是一段长文/文章截图，请提炼 3-6 条核心要点，用简洁的项目符号列出。' },
  { key: 'ui', group: '理解', icon: Palette, label: 'UI 设计改进建议', system: OCR_SYS, prompt: '把这张图当作一个界面设计稿，从布局、对比度、层级、可用性、无障碍角度给出 4-6 条具体改进建议。' },
  { key: 'chart', group: '数据', icon: BarChart3, label: '读图表并总结', system: OCR_SYS, prompt: '这是一张图表，请读出其中的关键数值与趋势，并用 2-3 句话总结它想表达的结论。' },
  { key: 'table', group: '数据', icon: Table, label: '表格转 Markdown', system: OCR_SYS, prompt: '把图中的表格精确转成 Markdown 表格，保留所有行列与表头，只输出表格。' },
  { key: 'numbers', group: '数据', icon: Hash, label: '提取关键数字', system: OCR_SYS, prompt: '提取图中所有关键数字/指标/金额，用「名称：数值」的形式逐条列出。' },
  { key: 'code', group: '开发', icon: Code, label: '代码截图转文本', system: OCR_SYS, prompt: '这是一张代码截图，请逐字转成可复制的纯代码文本，保持缩进与换行，用代码块包裹，不要解释。' },
  { key: 'diagnose', group: '开发', icon: Stethoscope, label: '报错诊断+修复', system: OCR_SYS, prompt: '这可能是一张报错/异常截图。请：1) 提取错误信息；2) 分析最可能的原因；3) 给出具体修复步骤。' },
  { key: 'todo', group: '效率', icon: ListChecks, label: '提取待办/行动项', system: OCR_SYS, prompt: '从图中提取所有待办事项 / 行动项 / 任务，用清单形式（- [ ]）逐条列出。' },
  { key: 'alt', group: '效率', icon: Accessibility, label: '生成 alt 文本', system: OCR_SYS, prompt: '为这张图片生成简洁、准确的无障碍 alt 文本（一句话，客观描述，用于屏幕阅读器）。' },
  { key: 'social', group: '效率', icon: Megaphone, label: '社交媒体配文', system: OCR_SYS, prompt: '为这张图配一段吸引人的社交媒体文案（含 2-3 个话题标签），语气轻松专业。' },
  { key: 'filename', group: '效率', icon: Tag, label: '起个文件名', system: OCR_SYS, prompt: '根据图片内容给它起一个简洁、语义化的英文文件名（kebab-case，不含扩展名），只输出这一个文件名。' },
  { key: 'privacy', group: '安全', icon: ShieldCheck, label: '敏感信息检测', system: OCR_SYS, prompt: '检查这张图是否包含敏感信息（密码、密钥、身份证、手机号、银行卡、私密路径、Token 等）。逐项指出位置与类型；若安全则明确说明“未发现敏感信息”。' },
  { key: 'objects', group: '安全', icon: Shapes, label: '识别主要元素', system: OCR_SYS, prompt: '列出这张图中出现的主要对象/元素/区域，按重要性排序，每条一行。' }
]

// ────────────────────────────── 组件 ──────────────────────────────
export function ScreenshotStudio({ dataUrl, onClose, llmReady, onAskImage, onAIVision, onRetake, onCreateTodo, onCreateNote }: Props): React.JSX.Element {
  const [sourceData, setSourceData] = useState(dataUrl)
  const [sourceVersion, setSourceVersion] = useState(0)
  const [sourceName, setSourceName] = useState(() => {
    const d = new Date()
    return `截图_${d.getMonth() + 1}-${d.getDate()}_${d.getHours()}${String(d.getMinutes()).padStart(2, '0')}`
  })
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
  const [cropSel, setCropSel] = useState<Rect | null>(null)
  const [cropMode, setCropMode] = useState(false)

  const [tab, setTab] = useState<'design' | 'annotate' | 'ai'>('design')
  const [out, setOut] = useState('')
  const [toast, setToast] = useState('')

  // AI 状态
  const [aiBusy, setAiBusy] = useState('')
  const [aiResults, setAiResults] = useState<{ id: number; label: string; text: string; err?: boolean }[]>([])
  const [askInput, setAskInput] = useState('')
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [exportFormat, setExportFormat] = useState<ScreenshotFormat>('png')
  const [exportQuality, setExportQuality] = useState(0.9)
  const [originalSize, setOriginalSize] = useState({ width: 0, height: 0 })

  const imgRef = useRef<HTMLImageElement | null>(null)
  const originalSourceRef = useRef(dataUrl)
  const [imgLoaded, setImgLoaded] = useState(false)
  const composedRef = useRef<Composed | null>(null) // 最近一次合成（含坐标映射）
  const previewRef = useRef<HTMLImageElement | null>(null) // 预览 <img> DOM
  const cropAnchorRef = useRef<Pt | null>(null)
  const numCounter = useRef(1)
  const idCounter = useRef(1)

  const bg = useMemo(() => (BGS.find((b) => b.key === bgKey) || BGS[0]).stops, [bgKey])

  const resetEdits = (): void => {
    setFrame('glass'); setBgKey('aurora'); setDeco(DEFAULT_DECO); setXf(DEFAULT_XFORM)
    setAnnos([]); setRedoStack([]); setDraft(null); setCropMode(false); setCropSel(null); setTool('none')
    setExportFormat('png'); setExportQuality(0.9); setZoom('fit'); numCounter.current = 1
  }

  const useSource = (url: string, name?: string): void => {
    originalSourceRef.current = url
    setSourceData(url)
    setSourceVersion((v) => v + 1)
    if (name) setSourceName(sanitizeScreenshotName(name))
    resetEdits()
    setImgLoaded(false)
  }

  useEffect(() => {
    useSource(dataUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl])

  // 加载原图
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setOriginalSize({ width: img.naturalWidth, height: img.naturalHeight })
      setImgLoaded(true)
    }
    img.onerror = () => { setImgLoaded(false); setToast('图片加载失败') }
    img.src = sourceData
  }, [sourceData, sourceVersion])

  // 是否处于“零处理”路径：原图 + 无任何编辑 → 位级一致导出原始 dataUrl
  const untouched = frame === 'none' && annos.length === 0 && !xf.crop && xf.rotate === 0 && !xf.flipH && !xf.flipV &&
    !deco.watermark && !deco.wmStamp && deco.scale === 1

  /** 核心：完整合成（transform → 边框/背景/装饰 → 标注 → 水印 → 倍率），返回 dataURL */
  const render = (mult = deco.scale, format: ScreenshotFormat = exportFormat, quality = exportQuality): string => {
    const img = imgRef.current
    if (!img) return sourceData
    if (untouched && mult === 1 && format === 'png' && sourceData.startsWith('data:image/png')) return sourceData
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
      return up.toDataURL(`image/${format}`, quality)
    }
    return comp.canvas.toDataURL(`image/${format}`, quality)
  }

  // 重新渲染预览（依赖变化 / 标注变化 / 草稿变化）
  useEffect(() => {
    if (!imgLoaded) return
    setOut(render(1, 'png', 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgLoaded, frame, bgKey, deco.radius, deco.shadow, deco.pad, deco.watermark, deco.wmStamp, annos, draft, xf])

  const final = untouched ? sourceData : out || sourceData
  const compSize = composedRef.current ? { width: composedRef.current.W, height: composedRef.current.H } : originalSize
  const exportSize = exportDimensions(compSize.width || 1, compSize.height || 1, deco.scale)
  const previewBytes = dataUrlBytes(final)

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

  // ── 坐标换算：预览事件坐标 → 基础图像坐标 ──
  const toCanvasPt = (e: React.PointerEvent): Pt | null => {
    const el = previewRef.current
    const comp = composedRef.current
    if (!el || !comp) return null
    const rect = el.getBoundingClientRect()
    const canvasX = ((e.clientX - rect.left) / rect.width) * comp.W
    const canvasY = ((e.clientY - rect.top) / rect.height) * comp.H
    const x = canvasX - comp.imgX
    const y = canvasY - comp.imgY
    if (x < 0 || y < 0 || x > comp.imgW || y > comp.imgH) return null
    return { x: Math.max(0, Math.min(comp.imgW, x)), y: Math.max(0, Math.min(comp.imgH, y)) }
  }

  // ── 标注绘制交互 ──
  const onDown = (e: React.PointerEvent<HTMLImageElement>): void => {
    const p = toCanvasPt(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (cropMode) { cropAnchorRef.current = p; setCropSel({ x: p.x, y: p.y, w: 0, h: 0 }); return }
    if (tool === 'none') return
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
  const onMove = (e: React.PointerEvent<HTMLImageElement>): void => {
    if (cropMode && cropAnchorRef.current && e.buttons === 1) {
      const p = toCanvasPt(e); if (!p) return
      const comp = composedRef.current
      setCropSel(comp ? clampRect(dragRect(cropAnchorRef.current, p), comp.imgW, comp.imgH) : dragRect(cropAnchorRef.current, p))
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
  const onUp = (e?: React.PointerEvent<HTMLImageElement>): void => {
    if (e?.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (cropMode) { cropAnchorRef.current = null; return }
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
    const bx = Math.max(0, sel.x)
    const by = Math.max(0, sel.y)
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
    const croppedUrl = cropped.toDataURL('image/png')
    const newImg = new Image()
    newImg.onload = () => {
      imgRef.current = newImg
      setSourceData(croppedUrl)
      setSourceVersion((v) => v + 1)
      setXf(DEFAULT_XFORM)
      setAnnos([]); setRedoStack([])
      setCropMode(false); setCropSel(null)
      setOut(''); setImgLoaded(false); flash('✓ 已裁剪')
    }
    newImg.src = croppedUrl
  }
  const rotate = (deg: number): void => setXf((x) => ({ ...x, rotate: (((x.rotate + deg) % 360) + 360) % 360 }))
  const flip = (dir: 'h' | 'v'): void => setXf((x) => (dir === 'h' ? { ...x, flipH: !x.flipH } : { ...x, flipV: !x.flipV }))

  const restoreOriginal = (): void => {
    resetEdits()
    setSourceData(originalSourceRef.current)
    setSourceVersion((v) => v + 1)
    flash('已恢复原始截图')
  }

  const openImage = (): void => {
    void island.openImageFile().then((r) => {
      if (r.ok && r.dataUrl) useSource(r.dataUrl, r.name)
      else if (r.error) flash('✗ ' + r.error)
    })
  }

  const pasteImage = (): void => {
    void island.readClipboardImage().then((r) => {
      if (r.ok && r.dataUrl) useSource(r.dataUrl, '剪贴板图片')
      else flash('✗ ' + (r.error || '剪贴板中没有图片'))
    })
  }

  const captureDisplay = (): void => {
    void island.captureScreen().then((r) => {
      if (r.ok && r.dataUrl) useSource(r.dataUrl, '整屏截图')
      else flash('✗ 整屏截图失败')
    })
  }

  // ── 导出 ──
  const doCopy = (): void => {
    void island.copyImage(render(deco.scale, 'png', 1)).then((r) => {
      flash(r.ok ? `✓ 已复制 PNG${deco.scale > 1 ? ` ${deco.scale}x` : ''}` : `✗ ${r.error || '复制失败'}`)
    })
  }
  const doSave = (): void => {
    const img = render(deco.scale, exportFormat, exportQuality)
    const name = `${sanitizeScreenshotName(sourceName)}${deco.scale > 1 ? `_${deco.scale}x` : ''}`
    void island.saveImage(img, name).then((r) => {
      if (r.ok) flash('✓ 已保存 ' + (r.path || '')); else if (!r.canceled) flash('✗ ' + (r.error || '保存失败'))
    })
  }
  const doAsk = (): void => onAskImage(render(1, 'png', 1))

  // ── AI 调用 ──
  const runAI = (label: string, system: string, prompt: string): void => {
    if (!llmReady || aiBusy) return
    setAiBusy(label); setTab('ai')
    const img = render(1, 'jpeg', 0.9)
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
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteImage() }
      else if (e.key === '0') setZoom('fit')
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(2, (z === 'fit' ? 1 : z) + 0.25))
      else if (e.key === '-') setZoom((z) => Math.max(0.25, (z === 'fit' ? 1 : z) - 0.25))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textInput, annos, redoStack, deco, xf, frame, bgKey, sourceData, exportFormat, exportQuality])

  // ── 样式片段（设计系统令牌） ──
  const label9: React.CSSProperties = { ...text.faint(), fontSize: 9.5, flex: 'none' }
  const groupLabel: React.CSSProperties = { ...text.overline(), fontSize: 9.5, flex: 'none' }
  const toolRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
  const toolLabel: React.CSSProperties = { ...label9, width: 42 }

  const TOOLS: { key: Tool; icon: LucideIcon; label: string }[] = [
    { key: 'none', icon: MousePointer2, label: '选择' },
    { key: 'arrow', icon: MoveUpRight, label: '箭头' },
    { key: 'rect', icon: Square, label: '矩形' },
    { key: 'ellipse', icon: Circle, label: '椭圆' },
    { key: 'line', icon: Slash, label: '直线' },
    { key: 'pen', icon: Pencil, label: '画笔' },
    { key: 'highlight', icon: Highlighter, label: '荧光笔' },
    { key: 'text', icon: Type, label: '文字' },
    { key: 'number', icon: Hash, label: '序号' },
    { key: 'mosaic', icon: Grid, label: '马赛克' },
    { key: 'blur', icon: Droplets, label: '模糊' }
  ]

  const drawing = tool !== 'none' || cropMode

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(8px)', animation: 'ai-fadein .15s ease' }}>
      <motion.div variants={overlayPop} initial="initial" animate="animate" onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(1000px, 72vw)', height: 'min(680px, 68vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...surface.overlay(), borderRadius: R.panel }}>
        {/* 头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 52, padding: `0 ${SP.md}px`, borderBottom: `0.5px solid ${hairline(0.1)}` }}>
          <div style={{ width: 26, height: 26, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: semBg(accent(), 0.14), color: accent(), flex: 'none' }}>
            <Camera size={14} strokeWidth={1.75} />
          </div>
          <span style={text.subtitle()}>截图工坊</span>
          <span style={{ ...text.faint(), fontVariantNumeric: 'tabular-nums' }}>{originalSize.width} × {originalSize.height} · {formatBytes(dataUrlBytes(sourceData))}</span>
          {/* 顶部 Tab */}
          <Segmented value={tab} onChange={(k) => setTab(k)} style={{ marginLeft: 6 }} options={[
            { key: 'design', label: '设计', icon: Palette },
            { key: 'annotate', label: '标注', icon: PenTool },
            { key: 'ai', label: 'AI', icon: Sparkles }
          ]} />
          <Button sm variant="ghost" icon={FileImage} onClick={openImage} title="打开本地图片">打开</Button>
          <Button sm variant="ghost" icon={ClipboardPaste} onClick={pasteImage} title="从剪贴板粘贴图片 (Ctrl+V)">粘贴</Button>
          <Button sm variant="ghost" icon={Monitor} onClick={captureDisplay} title="捕获鼠标所在显示器">整屏</Button>
          <Button sm variant="ghost" icon={ScanLine} onClick={onRetake} title="重新框选截图">重截</Button>
          <span style={{ flex: 1 }} />
          {toast && <span style={{ color: sem.calm, fontSize: FS.tiny, fontWeight: 600 }}>{toast}</span>}
          <IconButton icon={X} onClick={onClose} title="关闭" size={28} />
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* 预览区 */}
          <div className="ai-scroll" style={{ flex: 1, minWidth: 0, minHeight: 300, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 34, background: 'repeating-conic-gradient(rgba(255,255,255,.035) 0% 25%, rgba(0,0,0,.045) 0% 50%) 0 0 / 20px 20px', position: 'relative' }}>
            <div style={{ position: 'relative', maxWidth: zoom === 'fit' ? '100%' : 'none', maxHeight: zoom === 'fit' ? 'calc(68vh - 140px)' : 'none', lineHeight: 0, flex: 'none' }}>
              <img ref={previewRef} src={final} alt="截图预览" draggable={false}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                style={zoom === 'fit'
                  ? { maxWidth: '100%', maxHeight: 'calc(68vh - 140px)', borderRadius: R.sm, boxShadow: '0 14px 44px rgba(0,0,0,.48)', cursor: drawing ? 'crosshair' : 'default', userSelect: 'none', touchAction: 'none' }
                  : { width: `${Math.max(1, compSize.width * zoom)}px`, maxWidth: 'none', borderRadius: R.sm, boxShadow: '0 14px 44px rgba(0,0,0,.48)', cursor: drawing ? 'crosshair' : 'default', userSelect: 'none', touchAction: 'none' }} />
              {/* 裁剪选框叠层（预览像素） */}
              {cropMode && cropSel && composedRef.current && previewRef.current && (
                <div style={{
                  position: 'absolute', pointerEvents: 'none', border: `2px dashed ${accent()}`, background: semBg(accent(), 0.12),
                  left: `${((composedRef.current.imgX + cropSel.x) / composedRef.current.W) * 100}%`, top: `${((composedRef.current.imgY + cropSel.y) / composedRef.current.H) * 100}%`,
                  width: `${(cropSel.w / composedRef.current.W) * 100}%`, height: `${(cropSel.h / composedRef.current.H) * 100}%`
                }} />
              )}
              {/* 文字行内输入框 */}
              {textInput && (
                <input autoFocus value={textInput.value} onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                  onBlur={commitText} onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTextInput(null) }}
                  placeholder="输入文字，回车确认"
                  style={{ position: 'absolute', left: textInput.x, top: textInput.y, minWidth: 120, padding: '3px 7px', border: `2px solid ${color}`, borderRadius: R.sm, background: 'rgba(0,0,0,.72)', color, fontSize: 13, fontWeight: 700, outline: 'none', fontFamily: 'inherit' }} />
              )}
            </div>
            {aiBusy && (
              <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: R.pill, background: 'rgba(0,0,0,.45)', border: `0.5px solid ${accent(0.7, 0.4)}`, backdropFilter: 'blur(12px)' }}>
                <span style={{ display: 'inline-flex', gap: 3 }}>
                  {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: 3, background: accent(), animation: `ai-dotpulse 1s ${i * 0.15}s infinite` }} />)}
                </span>
                <span style={{ color: ink(1), fontSize: FS.small }}>{aiBusy}…</span>
              </div>
            )}
            <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', alignItems: 'center', gap: 3, padding: 3, borderRadius: R.pill, background: 'rgba(0,0,0,.42)', border: `0.5px solid ${hairline(0.12)}`, backdropFilter: 'blur(12px)' }}>
              <IconButton icon={ZoomOut} title="缩小 (-)" size={24} onClick={() => setZoom((z) => Math.max(0.25, (z === 'fit' ? 1 : z) - 0.25))} />
              <Chip active={zoom === 'fit'} title="适应窗口 (0)" onClick={() => setZoom('fit')} style={{ minWidth: 48, justifyContent: 'center' }}>{zoom === 'fit' ? '适应' : `${Math.round(zoom * 100)}%`}</Chip>
              <IconButton icon={ZoomIn} title="放大 (+)" size={24} onClick={() => setZoom((z) => Math.min(2, (z === 'fit' ? 1 : z) + 0.25))} />
              <IconButton icon={Maximize2} title="100% 原始像素" size={24} active={zoom === 1} onClick={() => setZoom(1)} />
            </div>
          </div>

          {/* 右侧控制面板 */}
          <div className="ai-scroll" style={{ width: 300, flex: 'none', overflow: 'auto', borderLeft: `0.5px solid ${hairline(0.1)}`, padding: `${SP.md + 2}px ${SP.md + 3}px`, display: 'flex', flexDirection: 'column', gap: SP.md + 2 }}>
            {tab === 'design' && (
              <>
                {/* 边框 */}
                <div>
                  <div style={{ ...groupLabel, marginBottom: 7 }}>边框</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {FRAMES.map((f) => (
                      <Chip key={f.key} active={frame === f.key} onClick={() => setFrame(f.key)} title={f.hint}>{f.label}</Chip>
                    ))}
                  </div>
                </div>
                {/* 背景 */}
                {frame !== 'none' && frame !== 'minimal' && frame !== 'polaroid' && frame !== 'dark' && (
                  <div style={{ ...toolRow, flexWrap: 'wrap', gap: 6 }}>
                    <span style={label9}>背景</span>
                    {BGS.map((b) => (
                      <div key={b.key} className="hv" onClick={() => setBgKey(b.key)} title={b.label} style={{ width: 24, height: 24, borderRadius: R.sm, cursor: 'pointer', background: `linear-gradient(135deg, ${b.stops[0]}, ${b.stops[1]}, ${b.stops[2]})`, border: bgKey === b.key ? `2px solid ${accent()}` : `0.5px solid ${hairline(0.15)}`, boxShadow: bgKey === b.key ? `0 0 8px ${accent(0.7, 0.5)}` : 'none' }} />
                    ))}
                  </div>
                )}
                {/* 装饰滑杆 */}
                {frame !== 'none' && (
                  <>
                    <div style={toolRow}><span style={toolLabel}>圆角</span><Slider min={0} max={1} step={0.05} value={deco.radius} onChange={(v) => setDeco({ ...deco, radius: v })} style={{ flex: 1 }} /></div>
                    <div style={toolRow}><span style={toolLabel}>阴影</span><Slider min={0} max={1} step={0.05} value={deco.shadow} onChange={(v) => setDeco({ ...deco, shadow: v })} style={{ flex: 1 }} /></div>
                    <div style={toolRow}><span style={toolLabel}>内边距</span><Slider min={0} max={1} step={0.05} value={deco.pad} onChange={(v) => setDeco({ ...deco, pad: v })} style={{ flex: 1 }} /></div>
                  </>
                )}
                {/* 变换 */}
                <div style={{ ...toolRow, flexWrap: 'wrap', gap: 6 }}>
                  <span style={label9}>变换</span>
                  <IconButton icon={RotateCcw} onClick={() => rotate(-90)} title="逆时针 90°" />
                  <IconButton icon={RotateCw} onClick={() => rotate(90)} title="顺时针 90°" />
                  <IconButton icon={FlipHorizontal} active={xf.flipH} onClick={() => flip('h')} title="水平翻转" />
                  <IconButton icon={FlipVertical} active={xf.flipV} onClick={() => flip('v')} title="垂直翻转" />
                  <Chip icon={Crop} active={cropMode} onClick={() => { setCropMode((v) => !v); setCropSel(null); setTool('none') }} title="框选裁剪">裁剪</Chip>
                  {cropMode && <Button sm variant="ghost" icon={Check} onClick={applyCrop} disabled={!cropSel || cropSel.w < 8 || cropSel.h < 8} style={{ background: semBg(sem.calm, 0.18), color: sem.calm, border: `0.5px solid ${semBg(sem.calm, 0.45)}` }}>应用</Button>}
                </div>
                {/* 水印 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={toolRow}>
                    <span style={toolLabel}>水印</span>
                    <Input value={deco.watermark} onChange={(v) => setDeco({ ...deco, watermark: v })} placeholder="自定义水印文字" style={{ flex: 1 }} />
                  </div>
                  <div style={toolRow}>
                    <Switch on={deco.wmStamp} onChange={(on) => setDeco({ ...deco, wmStamp: on })} />
                    <span className="hv" onClick={() => setDeco({ ...deco, wmStamp: !deco.wmStamp })} style={{ ...text.dim(), cursor: 'pointer' }}>追加时间戳</span>
                  </div>
                </div>
                {/* 倍率 */}
                <div style={{ ...toolRow, gap: 6 }}>
                  <span style={label9}>导出倍率</span>
                  {[1, 2, 3].map((s) => (
                    <Chip key={s} active={deco.scale === s} onClick={() => setDeco({ ...deco, scale: s })}>{s}x</Chip>
                  ))}
                  <span style={{ ...text.faint(), fontSize: 9 }}>1x 无损</span>
                </div>
                <div style={{ height: 0.5, background: hairline(0.09) }} />
                <div style={toolRow}>
                  <span style={toolLabel}>文件名</span>
                  <Input value={sourceName} onChange={setSourceName} style={{ flex: 1 }} />
                  <span style={text.mono(10)}>.{formatExtension(exportFormat)}</span>
                </div>
                <div style={toolRow}>
                  <span style={toolLabel}>格式</span>
                  <Segmented<ScreenshotFormat> value={exportFormat} onChange={setExportFormat} options={[
                    { key: 'png', label: 'PNG' },
                    { key: 'jpeg', label: 'JPG' },
                    { key: 'webp', label: 'WEBP' }
                  ]} />
                </div>
                {exportFormat !== 'png' && (
                  <div style={toolRow}>
                    <span style={toolLabel}>质量</span>
                    <Slider min={0.5} max={1} step={0.05} value={exportQuality} onChange={setExportQuality} style={{ flex: 1 }} />
                    <span style={{ ...text.num(10), width: 30, textAlign: 'right' }}>{Math.round(exportQuality * 100)}%</span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ ...surface.inset(), padding: '7px 10px' }}>
                    <div style={label9}>导出尺寸</div>
                    <div style={{ marginTop: 3, ...text.num(FS.small) }}>{exportSize.width} × {exportSize.height}</div>
                  </div>
                  <div style={{ ...surface.inset(), padding: '7px 10px' }}>
                    <div style={label9}>当前预览</div>
                    <div style={{ marginTop: 3, ...text.num(FS.small) }}>{formatBytes(previewBytes)}</div>
                  </div>
                </div>
                <Button variant="ghost" icon={RotateCcw} onClick={restoreOriginal}>恢复原始截图与默认样式</Button>
              </>
            )}

            {tab === 'annotate' && (
              <>
                {/* 工具 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {TOOLS.map((t) => (
                    <Chip key={t.key} icon={t.icon} active={tool === t.key} onClick={() => { setTool(t.key); setCropMode(false) }} title={t.label}>{t.label}</Chip>
                  ))}
                </div>
                {/* 颜色 */}
                <div style={{ ...toolRow, flexWrap: 'wrap', gap: 6 }}>
                  <span style={label9}>颜色</span>
                  {PALETTE.map((c) => (
                    <div key={c} className="hv" onClick={() => setColor(c)} style={{ width: 20, height: 20, borderRadius: 7, cursor: 'pointer', background: c, border: color === c ? `2px solid ${accent()}` : `0.5px solid ${hairline(0.18)}`, boxShadow: color === c ? `0 0 8px ${accent(0.7, 0.45)}` : 'none' }} />
                  ))}
                </div>
                {/* 线宽 */}
                <div style={toolRow}>
                  <span style={toolLabel}>线宽</span>
                  <Slider min={2} max={16} step={1} value={lineW} onChange={setLineW} style={{ flex: 1 }} />
                  <span style={{ ...text.num(10), width: 20, textAlign: 'right' }}>{lineW}</span>
                </div>
                {/* 撤销/重做/清空 */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button sm variant="ghost" icon={Undo2} onClick={undo} disabled={!annos.length} style={{ flex: 1 }}>撤销</Button>
                  <Button sm variant="ghost" icon={Redo2} onClick={redo} disabled={!redoStack.length} style={{ flex: 1 }}>重做</Button>
                  <Button sm variant="ghost" onClick={clearAnno} disabled={!annos.length} style={{ flex: 1 }}>清空</Button>
                </div>
                <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.6 }}>
                  在左侧图上按住拖拽绘制。文字/序号点击即放置。马赛克/模糊框选区域遮盖敏感内容。<br />快捷键：Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Esc 关闭。
                </div>
              </>
            )}

            {tab === 'ai' && (
              <>
                {!llmReady && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '9px 11px', borderRadius: R.md, background: semBg(sem.warn, 0.14), border: `0.5px solid ${semBg(sem.warn, 0.4)}`, color: sem.warn, fontSize: FS.tiny, lineHeight: 1.55 }}>
                    <TriangleAlert size={13} strokeWidth={1.75} style={{ flex: 'none', marginTop: 1 }} />
                    <span>请先在「设置」里配置视觉模型（API），再使用 AI 增强能力。</span>
                  </div>
                )}
                {/* 自由问图 */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ ...surface.inset(), flex: 1, display: 'flex', alignItems: 'center', padding: '0 10px', opacity: llmReady ? 1 : 0.5 }}>
                    <input value={askInput} disabled={!llmReady} onChange={(e) => setAskInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runAsk() }}
                      placeholder="问关于这张图的任何问题…"
                      style={{ flex: 1, minWidth: 0, height: 30, border: 0, outline: 'none', background: 'transparent', color: ink(1), fontSize: FS.body, fontFamily: 'inherit' }} />
                  </div>
                  <Button sm variant="primary" onClick={runAsk} disabled={!llmReady || !askInput.trim() || !!aiBusy}>问</Button>
                </div>
                {/* 动作矩阵，按分组 */}
                {['文字', '理解', '数据', '开发', '效率', '安全'].map((grp) => (
                  <div key={grp} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={groupLabel}>{grp}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {AI_ACTIONS.filter((a) => a.group === grp).map((a) => (
                        <Chip key={a.key} icon={a.icon} onClick={() => runAI(a.label, a.system, a.prompt)} title={a.label}
                          style={{ cursor: llmReady && !aiBusy ? 'pointer' : 'not-allowed', opacity: llmReady && !aiBusy ? 1 : 0.4, fontSize: 10.5 }}>
                          {a.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
                {/* 结果面板 */}
                {aiResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={groupLabel}>结果</span>
                      <span className="hv" onClick={() => setAiResults([])} style={{ ...text.faint(), fontSize: 9.5, cursor: 'pointer', marginLeft: 'auto' }}>清空</span>
                    </div>
                    {aiResults.map((r) => (
                      <motion.div key={r.id} variants={fadeScaleIn} initial="initial" animate="animate" className="ai-card"
                        style={r.err
                          ? { padding: '9px 11px', borderRadius: R.lg, background: semBg(sem.danger, 0.12), border: `0.5px solid ${semBg(sem.danger, 0.4)}` }
                          : { ...surface.card(), padding: '9px 11px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                          <span style={{ color: r.err ? sem.danger : accent(0.88), fontSize: FS.small, fontWeight: 700 }}>{r.label}</span>
                          {!r.err && <div style={{ display: 'flex', gap: 9, marginLeft: 'auto' }}>
                            <span className="hv" onClick={() => onCreateTodo(r.text)} style={{ color: ink(3), fontSize: 9.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}><ListChecks size={10} strokeWidth={2} />转待办</span>
                            <span className="hv" onClick={() => onCreateNote(r.label, r.text)} style={{ color: ink(3), fontSize: 9.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}><FileText size={10} strokeWidth={2} />存便签</span>
                            <span className="hv" onClick={() => copyResult(r.text)} style={{ color: ink(3), fontSize: 9.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Copy size={10} strokeWidth={2} />复制</span>
                          </div>}
                        </div>
                        <div style={{ color: r.err ? sem.danger : ink(1), fontSize: FS.small, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto' }} className="ai-scroll">{r.text}</div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, minHeight: 56, padding: `0 ${SP.md}px`, borderTop: `0.5px solid ${hairline(0.1)}` }}>
          <div style={{ minWidth: 230, ...text.faint(), fontVariantNumeric: 'tabular-nums' }}>
            画布 {compSize.width} × {compSize.height} · {annos.length} 个标注 · {frame === 'none' ? '原图' : FRAMES.find((x) => x.key === frame)?.label}
          </div>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" icon={MessageSquare} onClick={doAsk} title="把当前图交给截图问答">问 AI</Button>
          <Button variant="ghost" icon={Copy} onClick={doCopy}>复制 PNG</Button>
          <Button variant="primary" icon={Save} onClick={doSave}>保存 {exportFormat === 'jpeg' ? 'JPG' : exportFormat.toUpperCase()}{deco.scale > 1 ? ` ${deco.scale}x` : ''}</Button>
        </div>
      </motion.div>
    </div>
  )
}
