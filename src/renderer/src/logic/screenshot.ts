export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type ScreenshotFormat = 'png' | 'jpeg' | 'webp'

export function dragRect(anchor: Point, cursor: Point): Rect {
  return {
    x: Math.min(anchor.x, cursor.x),
    y: Math.min(anchor.y, cursor.y),
    w: Math.abs(cursor.x - anchor.x),
    h: Math.abs(cursor.y - anchor.y)
  }
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width, rect.x))
  const y = Math.max(0, Math.min(height, rect.y))
  return {
    x,
    y,
    w: Math.max(0, Math.min(width - x, rect.w)),
    h: Math.max(0, Math.min(height - y, rect.h))
  }
}

export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const payload = dataUrl.slice(comma + 1).replace(/\s/g, '')
  if (!payload) return 0
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/**
 * 抓取指定采集源的**原生分辨率**单帧。
 *
 * 走媒体流而不是 `desktopCapturer` 缩略图：缩略图只能按请求尺寸缩放，而逻辑尺寸乘 scaleFactor
 * 会有半像素（1707 × 1.5 = 2560.5），取整成 2561 就必然重采样，同一张静态图锐度从 84.9 掉到 64.1。
 * 媒体流给的是真原生帧（实测与 DPI-aware 的系统级抓图逐像素一致），而且与录制走同一条链路。
 */
export async function captureScreenNative(sourceId: string): Promise<string> {
  const constraints = {
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } }
  } as unknown as MediaStreamConstraints
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  const video = document.createElement('video')
  try {
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()
    if (!video.videoWidth) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('抓帧超时（未拿到画面尺寸）')), 6_000)
        video.addEventListener('loadedmetadata', () => { window.clearTimeout(timer); resolve() }, { once: true })
      })
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, video.videoWidth)
    canvas.height = Math.max(2, video.videoHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    video.srcObject = null
    stream.getTracks().forEach((track) => track.stop())
  }
}

/** 取色结果：十六进制 + RGB + 在源图上的像素坐标。 */
export interface ScreenshotPixelProbe {
  hex: string
  rgb: { r: number; g: number; b: number }
  /** 源图像素坐标（已钳进图像范围） */
  x: number
  y: number
}

export function screenshotPixelHex(r: number, g: number, b: number): string {
  const part = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

/**
 * 放大镜取景框（纯函数）：给光标位置算出一块 `size` 见方的源图采样区，并标出光标落在其中哪一格。
 * 越靠边时窗口整体内移（而不是把内容裁掉），这样放大镜永远显示完整的 size×size 个像素。
 */
export function screenshotLoupeRect(
  x: number,
  y: number,
  sourceWidth: number,
  sourceHeight: number,
  size = 15
): { x: number; y: number; size: number; markerX: number; markerY: number } {
  const grid = Math.max(3, Math.min(41, Math.round(size) | 1))
  const width = Math.max(1, Math.floor(sourceWidth))
  const height = Math.max(1, Math.floor(sourceHeight))
  const half = Math.floor(grid / 2)
  const originX = Math.max(0, Math.min(width - grid, Math.round(x) - half))
  const originY = Math.max(0, Math.min(height - grid, Math.round(y) - half))
  return {
    x: originX,
    y: originY,
    size: grid,
    markerX: Math.max(0, Math.min(grid - 1, Math.round(x) - originX)),
    markerY: Math.max(0, Math.min(grid - 1, Math.round(y) - originY))
  }
}

/**
 * 免对话框保存的默认目标说明（界面要如实告诉用户文件去哪了）。
 * 与主进程 `save-image-quick` 的落盘位置必须一致。
 */
export const SCREENSHOT_QUICK_DIR = '图片/Agentic-Island'

/** 框选区域（DIP，相对被截显示器左上角）。 */
export interface ScreenshotSnipRegion {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 把框选区域从 DIP 换算到**物理像素**并钳进画面范围。
 *
 * 为什么必须换算：框选叠层的 CSS 坐标系是 DIP（本机 1707×1067），而抓帧拿到的是物理像素
 * （2560×1600）。不换算就会截错位置、尺寸也不会对；这也是"整屏截图"曾经被 DPI 取整坑过的同一条线。
 * 返回 null 表示选区太小（拖动过程中的抖动）或完全落在画面外。
 */
export function snipRegionToPixels(
  region: ScreenshotSnipRegion,
  scaleFactor: number,
  sourceWidth: number,
  sourceHeight: number,
  minPixels = 8
): { x: number; y: number; width: number; height: number } | null {
  const sf = Math.max(0.1, Number.isFinite(scaleFactor) ? scaleFactor : 1)
  const width = Math.max(1, Math.floor(sourceWidth))
  const height = Math.max(1, Math.floor(sourceHeight))
  const left = Math.max(0, Math.min(width, Math.round(region.x * sf)))
  const top = Math.max(0, Math.min(height, Math.round(region.y * sf)))
  const right = Math.max(0, Math.min(width, Math.round((region.x + region.width) * sf)))
  const bottom = Math.max(0, Math.min(height, Math.round((region.y + region.height) * sf)))
  const pixelWidth = right - left
  const pixelHeight = bottom - top
  if (pixelWidth < minPixels || pixelHeight < minPixels) return null
  return { x: left, y: top, width: pixelWidth, height: pixelHeight }
}

/**
 * 按框选区域裁剪一张 dataUrl（区域是 DIP，图是物理像素，按 `snipRegionToPixels` 换算后裁）。
 * 区域无效时抛错，由调用方决定退回整屏还是放弃。
 */
export async function cropDataUrlToRegion(dataUrl: string, region: ScreenshotSnipRegion, scaleFactor?: number): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('截图解码失败'))
    img.src = dataUrl
  })
  // 未显式给缩放时按"图宽 / 区域所在显示器 DIP 宽"反推；这里拿不到显示器信息，
  // 所以只在调用方给了 scaleFactor 时换算，否则按 1:1 处理（100% 缩放屏的情形）。
  const rect = snipRegionToPixels(region, scaleFactor ?? 1, image.naturalWidth, image.naturalHeight, 2)
  if (!rect) throw new Error('框选区域无效')
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  return canvas.toDataURL('image/png')
}

/**
 * 文字卡片的排版：把一段文字按可用宽度折行，并算出画布尺寸（纯逻辑，测量函数由调用方注入）。
 *
 * 为什么把 measure 注入进来：真正量文字宽度必须用 canvas 的 measureText（依赖 DOM），
 * 而"怎么折行、折多少行、画布多大"是可以离线验证的纯计算。分开之后，边界情况（超长单词、
 * 空行、行数上限、极小字号）都能用假测量函数穷举，不必起浏览器。
 */
export interface TextCardMetrics {
  fontSize: number
  lineHeight: number
  padding: number
  maxLines: number
  maxWidth: number
}

export interface TextCardLayout {
  lines: string[]
  width: number
  height: number
  /** 被行数上限截断（界面要如实提示"已截断"） */
  truncated: boolean
}

export function wrapTextLines(text: string, maxWidth: number, measure: (line: string) => number, maxLines = 200): { lines: string[]; truncated: boolean } {
  const normalized = String(text ?? '').replace(/\r\n?/g, String.fromCharCode(10))
  const sourceLines = normalized.split(String.fromCharCode(10))
  const lines: string[] = []
  let truncated = false
  for (const raw of sourceLines) {
    if (lines.length >= maxLines) { truncated = true; break }
    // 空行保留（用户用它分段）
    if (!raw.trim()) { lines.push(''); continue }
    let current = ''
    // 先按空白切词；单个词自身超宽时按字符硬切，保证**任何输入都不溢出画布**
    for (const token of raw.split(/(\s+)/)) {
      if (!token) continue
      if (measure(current + token) <= maxWidth) { current += token; continue }
      if (current.trim()) {
        lines.push(current.replace(/\s+$/, ''))
        current = ''
        if (lines.length >= maxLines) { truncated = true; break }
      }
      let piece = token.replace(/^\s+/, '')
      while (measure(piece) > maxWidth && piece.length > 1) {
        let cut = piece.length - 1
        while (cut > 1 && measure(piece.slice(0, cut)) > maxWidth) cut -= 1
        lines.push(piece.slice(0, cut))
        if (lines.length >= maxLines) { truncated = true; break }
        piece = piece.slice(cut)
      }
      if (truncated) break
      current = piece
    }
    if (truncated) break
    if (current) lines.push(current.replace(/\s+$/, ''))
  }
  return { lines, truncated }
}

/** 由折行结果与排版参数算画布尺寸（宽度取最宽一行 + 两侧内边距）。 */
export function textCardLayout(text: string, metrics: TextCardMetrics, measure: (line: string) => number): TextCardLayout {
  const fontSize = Math.max(8, Math.min(200, Math.round(metrics.fontSize) || 32))
  const lineHeight = Math.max(1, Math.min(3, metrics.lineHeight || 1.45)) * fontSize
  const padding = Math.max(0, Math.min(400, Math.round(metrics.padding) || 48))
  const maxWidth = Math.max(fontSize * 2, Math.min(4000, Math.round(metrics.maxWidth) || 960))
  const maxLines = Math.max(1, Math.min(400, Math.round(metrics.maxLines) || 120))
  const { lines, truncated } = wrapTextLines(text, maxWidth, measure, maxLines)
  const contentWidth = lines.reduce((widest, line) => Math.max(widest, measure(line)), fontSize)
  const width = Math.max(2, Math.round(contentWidth + padding * 2))
  const height = Math.max(2, Math.round(lines.length * lineHeight + padding * 2))
  return { lines, width, height, truncated }
}

/** 标尺刻度：给定像素长度与期望步长，算出可读的刻度位置与标签（纯逻辑）。 */
export function rulerTicks(length: number, targetStep: number, max = 400): Array<{ at: number; label: number }> {
  const total = Math.max(0, Math.floor(length))
  if (!total) return []
  // 步长吸附到 1/2/5/10/20/50/100... 这类"人看得顺"的值
  const raw = Math.max(1, targetStep)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = Math.max(1, nice * magnitude)
  const ticks: Array<{ at: number; label: number }> = []
  for (let at = 0; at <= total && ticks.length < max; at += step) ticks.push({ at, label: at })
  return ticks
}

export function exportDimensions(width: number, height: number, scale: number): { width: number; height: number; pixels: number } {
  const outWidth = Math.max(1, Math.round(width * scale))
  const outHeight = Math.max(1, Math.round(height * scale))
  return { width: outWidth, height: outHeight, pixels: outWidth * outHeight }
}

export function formatExtension(format: ScreenshotFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

export function sanitizeScreenshotName(value: string): string {
  const clean = value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 120)
  return clean || 'screenshot'
}
