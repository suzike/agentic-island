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
