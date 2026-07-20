export type RecordingResolution = 'source' | '1080p' | '1440p' | '4k'
export type RecordingAspect = 'source' | '16:9' | '9:16' | '1:1'
export type RecordingMotion = 'off' | 'gentle' | 'dynamic'
export type RecordingAnimePalette = 'natural' | 'warm' | 'cool'
export type RecordingCharacterStyle = 'anime' | 'cartoon'

export interface RecordingSize { width: number; height: number }
export interface RecordingCrop { x: number; y: number; width: number; height: number }
export interface RecordingComposition { source: RecordingCrop; destination: RecordingCrop }

export function selectRecordingSourceId(
  sources: Array<{ id: string; name?: string; kind: 'screen' | 'window'; available?: boolean }>,
  kind: 'screen' | 'window',
  currentId = '',
  currentName = ''
): string {
  const retained = sources.find((source) => source.id === currentId && source.kind === kind && source.available !== false)
  const renamed = currentName ? sources.find((source) => source.name === currentName && source.kind === kind && source.available !== false) : undefined
  return retained?.id || renamed?.id || sources.find((source) => source.kind === kind && source.available !== false)?.id || ''
}

export interface RecordingSegmentLike { id: string; startMs: number; endMs: number; enabled?: boolean; label?: string }

export function normalizeRecordingSegments(segments: RecordingSegmentLike[], durationMs: number): RecordingSegmentLike[] {
  const duration = Math.max(1, Number(durationMs) || 1)
  return segments
    .map((segment, index) => ({
      ...segment,
      id: segment.id || `segment-${index + 1}`,
      startMs: Math.max(0, Math.min(duration, Number(segment.startMs) || 0)),
      endMs: Math.max(0, Math.min(duration, Number(segment.endMs) || 0))
    }))
    .filter((segment) => segment.endMs - segment.startMs >= 50)
    .sort((a, b) => a.startMs - b.startMs)
}

export function recordingSegmentsDuration(segments: RecordingSegmentLike[], durationMs: number, speed = 1): number {
  const normalized = normalizeRecordingSegments(segments, durationMs).filter((segment) => segment.enabled !== false)
  return Math.max(0, normalized.reduce((sum, segment) => sum + segment.endMs - segment.startMs, 0) / Math.max(0.5, Math.min(2, speed)))
}

export function splitRecordingSegment(segments: RecordingSegmentLike[], segmentId: string, atMs: number): RecordingSegmentLike[] {
  const segment = segments.find((item) => item.id === segmentId)
  if (!segment || atMs - segment.startMs < 100 || segment.endMs - atMs < 100) return segments
  const index = segments.indexOf(segment)
  const label = segment.label || `片段 ${index + 1}`
  return [
    ...segments.slice(0, index),
    { ...segment, id: `${segment.id}-a-${Math.round(atMs)}`, endMs: atMs, label: `${label} A` },
    { ...segment, id: `${segment.id}-b-${Math.round(atMs)}`, startMs: atMs, label: `${label} B` },
    ...segments.slice(index + 1)
  ]
}

export function snapRecordingTime(valueMs: number, durationMs: number, points: number[], thresholdMs: number, fps = 30): number {
  const duration = Math.max(0, durationMs)
  const value = Math.max(0, Math.min(duration, Number(valueMs) || 0))
  const threshold = Math.max(0, Number(thresholdMs) || 0)
  const candidates = [0, duration, ...points]
    .map((point) => Math.max(0, Math.min(duration, Number(point) || 0)))
  let nearest = value
  let distance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const current = Math.abs(candidate - value)
    if (current < distance) { nearest = candidate; distance = current }
  }
  if (distance <= threshold) return nearest
  const frameMs = 1000 / Math.max(1, fps)
  return Math.max(0, Math.min(duration, Math.round(value / frameMs) * frameMs))
}

export interface RecordingAiEditPlan {
  title: string
  summary: string
  segments: Array<{ startMs: number; endMs: number; label: string; enabled: boolean }>
  markers: Array<{ at: number; label: string }>
  speed: number
  adjustments: Pick<RecordingEditSettingsLike, 'brightness' | 'contrast' | 'saturation' | 'gamma' | 'sharpen' | 'denoise' | 'audioVolume' | 'fadeInMs' | 'fadeOutMs'>
}

interface RecordingEditSettingsLike {
  brightness?: number
  contrast?: number
  saturation?: number
  gamma?: number
  sharpen?: number
  denoise?: number
  audioVolume?: number
  fadeInMs?: number
  fadeOutMs?: number
}

const finite = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback

export function parseRecordingAiEditPlan(text: string, durationMs: number): RecordingAiEditPlan | null {
  const source = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const raw = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>
    const duration = Math.max(1, finite(durationMs, 1))
    const inputSegments = Array.isArray(raw.segments) ? raw.segments.slice(0, 40) : []
    const normalized = inputSegments.map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      const startMs = Math.max(0, Math.min(duration, finite(item.startMs, 0)))
      const endMs = Math.max(0, Math.min(duration, finite(item.endMs, 0)))
      return { startMs, endMs, label: String(item.label || `片段 ${index + 1}`).slice(0, 80), enabled: item.enabled !== false }
    }).filter((segment) => segment.endMs - segment.startMs >= 100).sort((a, b) => a.startMs - b.startMs)
    const segments: RecordingAiEditPlan['segments'] = []
    for (const segment of normalized) {
      const previous = segments.at(-1)
      if (previous && segment.startMs < previous.endMs) {
        previous.endMs = Math.max(previous.endMs, segment.endMs)
        previous.label = previous.label === segment.label ? previous.label : `${previous.label} / ${segment.label}`.slice(0, 80)
      } else segments.push({ ...segment })
    }
    if (!segments.length) return null
    const markers = (Array.isArray(raw.markers) ? raw.markers : []).slice(0, 30).map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
      return { at: Math.max(0, Math.min(duration, finite(item.at, 0))), label: String(item.label || `章节 ${index + 1}`).slice(0, 80) }
    }).sort((a, b) => a.at - b.at)
    const adjustmentRaw = raw.adjustments && typeof raw.adjustments === 'object' ? raw.adjustments as Record<string, unknown> : {}
    const clamp = (key: string, fallback: number, min: number, max: number): number => Math.max(min, Math.min(max, finite(adjustmentRaw[key], fallback)))
    return {
      title: String(raw.title || 'AI 智能粗剪').slice(0, 120),
      summary: String(raw.summary || '').slice(0, 1200),
      segments,
      markers,
      speed: Math.max(0.5, Math.min(2, finite(raw.speed, 1))),
      adjustments: {
        brightness: clamp('brightness', 0, -0.5, 0.5), contrast: clamp('contrast', 1, 0.5, 2), saturation: clamp('saturation', 1, 0, 2), gamma: clamp('gamma', 1, 0.5, 2),
        sharpen: clamp('sharpen', 0, 0, 2), denoise: clamp('denoise', 0, 0, 10), audioVolume: clamp('audioVolume', 1, 0, 2), fadeInMs: clamp('fadeInMs', 0, 0, 3000), fadeOutMs: clamp('fadeOutMs', 0, 0, 3000)
      }
    }
  } catch { return null }
}

export interface RecordingTranscriptLike { startMs: number; endMs: number; text: string }

const subtitleTime = (ms: number, decimal: ',' | '.'): string => {
  const value = Math.max(0, Math.round(Number(ms) || 0))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor(value % 3_600_000 / 60_000)
  const seconds = Math.floor(value % 60_000 / 1000)
  const millis = value % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${decimal}${String(millis).padStart(3, '0')}`
}

export function recordingTranscriptToSrt(segments: RecordingTranscriptLike[]): string {
  return segments.filter((segment) => segment.text.trim()).map((segment, index) => `${index + 1}\n${subtitleTime(segment.startMs, ',')} --> ${subtitleTime(Math.max(segment.startMs + 1, segment.endMs), ',')}\n${segment.text.trim()}`).join('\n\n')
}

export function recordingTranscriptToVtt(segments: RecordingTranscriptLike[]): string {
  const body = segments.filter((segment) => segment.text.trim()).map((segment) => `${subtitleTime(segment.startMs, '.')} --> ${subtitleTime(Math.max(segment.startMs + 1, segment.endMs), '.')}\n${segment.text.trim()}`).join('\n\n')
  return `WEBVTT\n\n${body}`
}

export function recordingOutputSize(sourceWidth: number, sourceHeight: number, resolution: RecordingResolution, aspect: RecordingAspect = 'source'): RecordingSize {
  const sw = Math.max(2, Math.round(sourceWidth))
  const sh = Math.max(2, Math.round(sourceHeight))
  if (resolution === 'source' && aspect === 'source') return { width: sw - (sw % 2), height: sh - (sh % 2) }
  const landscape = sw >= sh
  const long = resolution === '4k' ? 3840 : resolution === '1440p' ? 2560 : 1920
  const short = resolution === '4k' ? 2160 : resolution === '1440p' ? 1440 : 1080
  if (aspect === '1:1') return { width: short, height: short }
  if (aspect === '9:16') return { width: short, height: long }
  if (aspect === '16:9') return { width: long, height: short }
  if (resolution === 'source') return landscape
    ? { width: sw - (sw % 2), height: Math.max(2, Math.round(sw * 9 / 16) - (Math.round(sw * 9 / 16) % 2)) }
    : { width: Math.max(2, Math.round(sh * 9 / 16) - (Math.round(sh * 9 / 16) % 2)), height: sh - (sh % 2) }
  return landscape ? { width: long, height: short } : { width: short, height: long }
}

export function recordingPreviewSize(output: RecordingSize, maxWidth = 1280, maxHeight = 720): RecordingSize {
  const width = Math.max(2, Math.round(output.width))
  const height = Math.max(2, Math.round(output.height))
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const previewWidth = Math.max(2, Math.round(width * scale))
  const previewHeight = Math.max(2, Math.round(height * scale))
  return {
    width: previewWidth - (previewWidth % 2),
    height: previewHeight - (previewHeight % 2)
  }
}

export function recordingElapsed(
  paused: boolean,
  now: number,
  startAt: number,
  pausedAt: number,
  pausedTotal: number
): number {
  const end = paused ? pausedAt : now
  return Math.max(0, end - startAt - pausedTotal)
}

export function recordingFrameBudget(gapMs: number, frameIntervalMs: number): { totalFrames: number; droppedFrames: number } {
  const interval = Math.max(1, frameIntervalMs)
  const totalFrames = Math.max(1, Math.floor((Math.max(0, gapMs) + interval * 0.15) / interval))
  return { totalFrames, droppedFrames: Math.max(0, totalFrames - 1) }
}

export function recordingRegionCrop(
  sourceWidth: number,
  sourceHeight: number,
  region: { left: number; top: number; right: number; bottom: number }
): RecordingCrop {
  const sw = Math.max(2, sourceWidth)
  const sh = Math.max(2, sourceHeight)
  const left = Math.max(0, Math.min(0.9, region.left))
  const top = Math.max(0, Math.min(0.9, region.top))
  const right = Math.max(0, Math.min(0.9 - left, region.right))
  const bottom = Math.max(0, Math.min(0.9 - top, region.bottom))
  const x = Math.round(sw * left)
  const y = Math.round(sh * top)
  const endX = Math.round(sw * (1 - right))
  const endY = Math.round(sh * (1 - bottom))
  return { x, y, width: Math.max(2, endX - x), height: Math.max(2, endY - y) }
}

export function recordingFitComposition(
  source: RecordingCrop,
  outputWidth: number,
  outputHeight: number,
  fit: 'contain' | 'cover'
): RecordingComposition {
  const output = { width: Math.max(2, outputWidth), height: Math.max(2, outputHeight) }
  const input = {
    x: Number(source.x) || 0,
    y: Number(source.y) || 0,
    width: Math.max(2, Number(source.width) || 2),
    height: Math.max(2, Number(source.height) || 2)
  }
  if (fit === 'cover') {
    const outputAspect = output.width / output.height
    const sourceAspect = input.width / input.height
    if (sourceAspect > outputAspect) {
      const width = input.height * outputAspect
      return {
        source: { x: input.x + (input.width - width) / 2, y: input.y, width, height: input.height },
        destination: { x: 0, y: 0, width: output.width, height: output.height }
      }
    }
    const height = input.width / outputAspect
    return {
      source: { x: input.x, y: input.y + (input.height - height) / 2, width: input.width, height },
      destination: { x: 0, y: 0, width: output.width, height: output.height }
    }
  }
  const scale = Math.min(output.width / input.width, output.height / input.height)
  const width = input.width * scale
  const height = input.height * scale
  return {
    source: input,
    destination: { x: (output.width - width) / 2, y: (output.height - height) / 2, width, height }
  }
}

export function recordingSourcePointToOutput(
  composition: RecordingComposition,
  sourceX: number,
  sourceY: number
): { x: number; y: number; visible: boolean } {
  const { source, destination } = composition
  const nx = (sourceX - source.x) / source.width
  const ny = (sourceY - source.y) / source.height
  return {
    x: destination.x + nx * destination.width,
    y: destination.y + ny * destination.height,
    visible: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1
  }
}

export function recordingZoomForMotion(motion: RecordingMotion, cursorSpeed: number): number {
  if (motion === 'off') return 1
  const base = motion === 'dynamic' ? 1.58 : 1.32
  const speedRelief = Math.min(0.24, Math.max(0, cursorSpeed) / 2600)
  return Math.max(1.08, base - speedRelief)
}

export function recordingFocusCrop(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  focusX: number,
  focusY: number,
  zoom: number
): RecordingCrop {
  const sw = Math.max(1, sourceWidth)
  const sh = Math.max(1, sourceHeight)
  const targetAspect = Math.max(0.01, outputWidth / Math.max(1, outputHeight))
  let baseWidth = sw
  let baseHeight = baseWidth / targetAspect
  if (baseHeight > sh) {
    baseHeight = sh
    baseWidth = baseHeight * targetAspect
  }
  const z = Math.max(1, zoom)
  const width = Math.max(1, baseWidth / z)
  const height = Math.max(1, baseHeight / z)
  const cx = Math.max(0, Math.min(1, focusX)) * sw
  const cy = Math.max(0, Math.min(1, focusY)) * sh
  return {
    x: Math.max(0, Math.min(sw - width, cx - width / 2)),
    y: Math.max(0, Math.min(sh - height, cy - height / 2)),
    width,
    height
  }
}

export function recordingLerp(current: number, target: number, smoothing: number): number {
  const amount = Math.max(0.01, Math.min(1, smoothing))
  return current + (target - current) * amount
}

export function stylizeRecordingAnimeFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
  palette: RecordingAnimePalette = 'natural',
  style: RecordingCharacterStyle = 'anime'
): Uint8ClampedArray {
  const amount = Math.max(0, Math.min(1, strength))
  const frameWidth = Math.max(0, Math.floor(width))
  const frameHeight = Math.max(0, Math.floor(height))
  const count = frameWidth * frameHeight
  if (!count || pixels.length < count * 4) return pixels

  let source = new Uint8ClampedArray(pixels)
  let smooth = new Uint8ClampedArray(source.length)
  const passes = style === 'anime' ? 2 : 1
  const colorThreshold = 58 + amount * 46
  const neighborOffsets = [-1, 1, -frameWidth, frameWidth]
  for (let pass = 0; pass < passes; pass++) {
    smooth.set(source)
    for (let y = 1; y < frameHeight - 1; y++) {
      for (let x = 1; x < frameWidth - 1; x++) {
        const index = y * frameWidth + x
        const offset = index * 4
        const centerRed = source[offset]
        const centerGreen = source[offset + 1]
        const centerBlue = source[offset + 2]
        let red = centerRed * 4
        let green = centerGreen * 4
        let blue = centerBlue * 4
        let weight = 4
        for (const delta of neighborOffsets) {
          const neighbor = index + delta
          const neighborOffset = neighbor * 4
          const distance = Math.abs(source[neighborOffset] - centerRed) + Math.abs(source[neighborOffset + 1] - centerGreen) + Math.abs(source[neighborOffset + 2] - centerBlue)
          if (distance > colorThreshold * 3) continue
          const neighborWeight = distance < colorThreshold ? 3 : 1
          red += source[neighborOffset] * neighborWeight
          green += source[neighborOffset + 1] * neighborWeight
          blue += source[neighborOffset + 2] * neighborWeight
          weight += neighborWeight
        }
        smooth[offset] = red / weight
        smooth[offset + 1] = green / weight
        smooth[offset + 2] = blue / weight
        smooth[offset + 3] = source[offset + 3]
      }
    }
    const swap = source; source = smooth; smooth = swap
  }

  const luminance = new Uint8Array(count)
  const levels = style === 'cartoon' ? Math.max(3, Math.round(5 - amount * 2)) : Math.max(4, Math.round(8 - amount * 3))
  const step = 255 / (levels - 1)
  const saturation = (style === 'cartoon' ? 1.22 : 1.12) + amount * (style === 'cartoon' ? 0.72 : 0.48)
  const contrast = 1.05 + amount * (style === 'cartoon' ? 0.26 : 0.16)

  for (let index = 0; index < count; index++) {
    const offset = index * 4
    let red = source[offset]
    let green = source[offset + 1]
    let blue = source[offset + 2]
    const gray = red * 0.299 + green * 0.587 + blue * 0.114
    luminance[index] = gray
    red = gray + (red - gray) * saturation
    green = gray + (green - gray) * saturation
    blue = gray + (blue - gray) * saturation
    red = (red - 128) * contrast + 128
    green = (green - 128) * contrast + 128
    blue = (blue - 128) * contrast + 128
    if (style === 'anime') {
      const highlight = Math.max(0, (gray - 145) / 110) * amount
      red += highlight * 14; green += highlight * 11; blue += highlight * 16
      const shadow = Math.max(0, (92 - gray) / 92) * amount
      red -= shadow * 5; green -= shadow * 2; blue += shadow * 8
    }
    if (palette === 'warm') { red *= 1.07; green *= 1.01; blue *= 0.91 }
    if (palette === 'cool') { red *= 0.94; green *= 1.02; blue *= 1.1 }
    pixels[offset] = Math.round(Math.max(0, Math.min(255, red)) / step) * step
    pixels[offset + 1] = Math.round(Math.max(0, Math.min(255, green)) / step) * step
    pixels[offset + 2] = Math.round(Math.max(0, Math.min(255, blue)) / step) * step
    pixels[offset + 3] = source[offset + 3]
  }

  const edges = new Uint8Array(count)
  const edgeThreshold = (style === 'cartoon' ? 92 : 118) - amount * (style === 'cartoon' ? 34 : 28)
  for (let y = 1; y < frameHeight - 1; y++) {
    for (let x = 1; x < frameWidth - 1; x++) {
      const index = y * frameWidth + x
      const top = index - frameWidth
      const bottom = index + frameWidth
      const gx = -luminance[top - 1] + luminance[top + 1] - 2 * luminance[index - 1] + 2 * luminance[index + 1] - luminance[bottom - 1] + luminance[bottom + 1]
      const gy = -luminance[top - 1] - 2 * luminance[top] - luminance[top + 1] + luminance[bottom - 1] + 2 * luminance[bottom] + luminance[bottom + 1]
      edges[index] = Math.min(255, Math.hypot(gx, gy))
    }
  }

  const edgeOpacity = (style === 'cartoon' ? 0.72 : 0.5) + amount * (style === 'cartoon' ? 0.25 : 0.34)
  for (let y = 1; y < frameHeight - 1; y++) {
    for (let x = 1; x < frameWidth - 1; x++) {
      const index = y * frameWidth + x
      let edge = edges[index]
      if (style === 'cartoon') edge = Math.max(edge, edges[index - 1], edges[index + 1], edges[index - frameWidth], edges[index + frameWidth])
      if (edge <= edgeThreshold) continue
      const offset = index * 4
      const darkness = Math.max(style === 'cartoon' ? 0.04 : 0.12, 1 - Math.min(1, (edge - edgeThreshold) / 165) * edgeOpacity)
      pixels[offset] *= darkness
      pixels[offset + 1] *= darkness
      pixels[offset + 2] *= darkness
    }
  }
  return pixels
}

export function selectRecorderMime(isSupported: (mime: string) => boolean, withAudio = true): string {
  const candidates = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return candidates.find(isSupported) || 'video/webm'
}

export function recordingVideoBitrate(width: number, height: number, fps: number, quality: 'standard' | 'high' | 'ultra'): number {
  const pixelsPerSecond = Math.max(1, width * height * fps)
  const factor = quality === 'ultra' ? 0.16 : quality === 'high' ? 0.11 : 0.075
  return Math.round(Math.max(4_000_000, Math.min(80_000_000, pixelsPerSecond * factor)))
}

export interface RecordingHealthInput {
  active: boolean
  elapsedMs: number
  bytes: number
  chunkGapMs: number
  writeLatencyMs: number
  droppedFrames: number
  totalFrames: number
  writeError?: string
}

export interface RecordingHealthResult {
  level: 'healthy' | 'warning' | 'critical'
  message: string
  bitrateMbps: number
  droppedPercent: number
}

export function recordingHealth(input: RecordingHealthInput): RecordingHealthResult {
  const bitrateMbps = input.elapsedMs > 0 ? input.bytes * 8 / input.elapsedMs / 1000 : 0
  const droppedPercent = input.totalFrames > 0 ? input.droppedFrames / input.totalFrames * 100 : 0
  if (input.writeError) return { level: 'critical', message: '写盘失败', bitrateMbps, droppedPercent }
  if (!input.active) return { level: 'healthy', message: '采集已暂停', bitrateMbps, droppedPercent }
  if (input.elapsedMs >= 4000 && input.bytes < 1024) return { level: 'critical', message: '编码器没有输出数据', bitrateMbps, droppedPercent }
  if (input.chunkGapMs > 3500) return { level: 'warning', message: '编码分片延迟', bitrateMbps, droppedPercent }
  if (input.writeLatencyMs > 2000) return { level: 'warning', message: '磁盘写入积压', bitrateMbps, droppedPercent }
  if (input.totalFrames >= 120 && droppedPercent > 5) return { level: 'warning', message: `画面丢帧 ${droppedPercent.toFixed(1)}%`, bitrateMbps, droppedPercent }
  return { level: 'healthy', message: input.bytes > 0 ? '录制与写盘正常' : '正在等待首个分片', bitrateMbps, droppedPercent }
}

export function formatRecordingTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function recordingStartError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  const detail = error instanceof Error ? error.message : String(error || '')
  if (name === 'NotAllowedError' || /permission denied|not allowed/i.test(detail)) {
    return '屏幕或麦克风权限被拒绝，请在 Windows 隐私设置中允许桌面应用访问后重试。'
  }
  if (name === 'NotReadableError' || /could not start video source|device in use/i.test(detail)) {
    return '无法读取录制来源，它可能已关闭、正被独占或属于受保护内容。请刷新来源后重试。'
  }
  if (name === 'OverconstrainedError' || /constraint/i.test(detail)) {
    return '当前录制来源不支持所选参数，请降低帧率或分辨率后重试。'
  }
  if (name === 'AbortError') return '系统中止了屏幕采集，请重新选择录制来源。'
  if (/timed?\s*out|超时/i.test(detail)) return '连接屏幕画面超时，请刷新录制来源后重试。'
  return detail || '录屏启动失败，请刷新录制来源后重试。'
}
