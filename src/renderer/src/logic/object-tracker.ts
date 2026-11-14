// 轻量模板匹配跟踪器：不引第三方 CV 依赖，纯 TypedArray。
// 用在隐私遮罩上——目标移动时遮罩跟着走；置信度低时冻结在最后位置，宁可盖多也不乱跳。

export interface TrackerFrame {
  width: number
  height: number
  /** 灰度，0-255 */
  data: Uint8ClampedArray
}

export interface TrackerRect {
  x: number
  y: number
  w: number
  h: number
}

export interface TrackerTemplate {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function grayscaleFrame(rgba: Uint8ClampedArray, width: number, height: number): TrackerFrame {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const out = new Uint8ClampedArray(w * h)
  for (let index = 0; index < w * h; index += 1) {
    const offset = index * 4
    out[index] = Math.round(0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2])
  }
  return { width: w, height: h, data: out }
}

/** 最近邻缩放到指定宽度，保持比例。 */
export function downscaleFrame(frame: TrackerFrame, targetWidth: number): TrackerFrame {
  const width = Math.max(1, Math.min(frame.width, Math.round(targetWidth)))
  const height = Math.max(1, Math.round(frame.height * width / Math.max(1, frame.width)))
  if (width === frame.width && height === frame.height) return frame
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(frame.height - 1, Math.floor(y * frame.height / height))
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(frame.width - 1, Math.floor(x * frame.width / width))
      out[y * width + x] = frame.data[sy * frame.width + sx]
    }
  }
  return { width, height, data: out }
}

export function createTemplate(frame: TrackerFrame, rect: TrackerRect): TrackerTemplate | null {
  const x = Math.max(0, Math.min(frame.width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(frame.height - 1, Math.round(rect.y)))
  const w = Math.max(2, Math.min(frame.width - x, Math.round(rect.w)))
  const h = Math.max(2, Math.min(frame.height - y, Math.round(rect.h)))
  if (w < 2 || h < 2) return null
  const data = new Uint8ClampedArray(w * h)
  for (let row = 0; row < h; row += 1) {
    data.set(frame.data.subarray((y + row) * frame.width + x, (y + row) * frame.width + x + w), row * w)
  }
  return { width: w, height: h, data }
}

const sadAt = (frame: TrackerFrame, template: TrackerTemplate, x: number, y: number, step = 2): number => {
  let sum = 0
  let count = 0
  for (let ty = 0; ty < template.height; ty += step) {
    const fy = y + ty
    if (fy < 0 || fy >= frame.height) return Number.POSITIVE_INFINITY
    for (let tx = 0; tx < template.width; tx += step) {
      const fx = x + tx
      if (fx < 0 || fx >= frame.width) return Number.POSITIVE_INFINITY
      sum += Math.abs(template.data[ty * template.width + tx] - frame.data[fy * frame.width + fx])
      count += 1
    }
  }
  return count > 0 ? sum / count : Number.POSITIVE_INFINITY
}

export interface TrackerResult {
  rect: TrackerRect
  confidence: number
}

/**
 * 在上一帧位置附近搜索模板；返回新位置与 0-1 置信度。
 * `radius` 是搜索半径（帧像素），`step` 越大越快但越容易错过快速移动。
 */
export function trackTemplate(
  frame: TrackerFrame,
  template: TrackerTemplate,
  previous: TrackerRect,
  options: { radius?: number; step?: number } = {}
): TrackerResult {
  const radius = Math.max(2, Math.round(options.radius ?? Math.max(8, template.width * 0.45)))
  const searchStep = Math.max(1, Math.round(options.step ?? 2))
  const baseX = Math.round(previous.x)
  const baseY = Math.round(previous.y)
  let bestX = baseX
  let bestY = baseY
  let best = Number.POSITIVE_INFINITY
  for (let dy = -radius; dy <= radius; dy += searchStep) {
    for (let dx = -radius; dx <= radius; dx += searchStep) {
      const x = baseX + dx
      const y = baseY + dy
      if (x < 0 || y < 0 || x + template.width > frame.width || y + template.height > frame.height) continue
      const score = sadAt(frame, template, x, y, searchStep)
      if (score < best) { best = score; bestX = x; bestY = y }
    }
  }
  // 置信度：平均绝对差 0 最好；>= 48 基本不可信。
  const confidence = best === Number.POSITIVE_INFINITY ? 0 : Math.max(0, Math.min(1, 1 - best / 48))
  return {
    rect: confidence >= 0.35 ? { ...previous, x: bestX, y: bestY } : { ...previous },
    confidence
  }
}
