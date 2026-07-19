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
