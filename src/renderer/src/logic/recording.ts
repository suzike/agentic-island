import type { RecordingMotionFrame } from '../../../shared/protocol'

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

/** 相机跟随的参考帧间隔：smoothing 参数原本是按 30fps 每帧调出来的。 */
const RECORDING_REFERENCE_FRAME_MS = 1000 / 30

/**
 * 把"每帧固定系数"的平滑换算成**帧率无关**的系数：α = 1 - exp(-Δt/τ)。
 *
 * 固定 α 的写法只在帧率稳定时成立：掉帧时每帧跨的时间变长，同一个 α 意味着"每秒收敛次数变少"，
 * 跟随速度随之变慢、滞后变明显（本项目实测 1440p 会掉到 24fps 上下，观感与 30fps 时不一致）。
 * 这里按参考帧长（默认 30fps 的原始调参，录制时可传实际目标帧长）反推时间常数 τ，再按真实 Δt
 * 求 α，因此实际帧率低于目标帧率时跟随速度不变，只是运镜更粗糙（这正是掉帧应有的表现）。
 */
export function recordingSmoothingAlpha(deltaMs: number, smoothing: number, referenceMs = RECORDING_REFERENCE_FRAME_MS): number {
  const target = Math.max(0.01, Math.min(1, smoothing))
  const reference = Math.max(1, Number.isFinite(referenceMs) ? referenceMs : RECORDING_REFERENCE_FRAME_MS)
  const dt = Math.max(1, Math.min(1000, Number.isFinite(deltaMs) ? deltaMs : reference))
  if (target >= 1) return 1
  const tau = -reference / Math.log(1 - target)
  return Math.max(0.001, Math.min(1, 1 - Math.exp(-dt / tau)))
}

/** 按时间常数平滑（与 recordingLerp 同语义，但传入真实帧间隔与目标帧长）。 */
export function recordingLerpTimed(current: number, target: number, deltaMs: number, smoothing: number, referenceMs = RECORDING_REFERENCE_FRAME_MS): number {
  return recordingLerp(current, target, recordingSmoothingAlpha(deltaMs, smoothing, referenceMs))
}

export interface RecordingCursorSample {
  /** 相对录制开始的毫秒偏移 */
  t: number
  x: number
  y: number
}

export interface RecordingIdleRange {
  startMs: number
  endMs: number
}

export interface RecordingIdleOptions {
  /** 连续静止多久算空闲（毫秒） */
  idleMs?: number
  /** 光标位移小于该像素数视为静止 */
  moveEpsilonPx?: number
  /** 头部/尾部静止区保留的时长，避免把开场和收尾整段剪掉 */
  edgeKeepMs?: number
}

/**
 * 从光标轨迹里找"空闲区间"（长时间没有移动）。
 *
 * 为什么可信：屏幕演示里"人在操作"几乎等价于"光标在动"；而光标轨迹是我们**真的采到**的信号
 *（60Hz 采样），不是猜测。音频静音是另一路独立信号，两者取交集更保守——见 detectRecordingIdle。
 * 头尾的静止同样会报出来（"录了才发现还在发呆"是最常见的待剪内容），但两端各保留 edgeKeepMs
 * 的余量，避免把开场画面和收尾停顿整段抹掉。
 */
export function recordingIdleRanges(
  samples: RecordingCursorSample[],
  durationMs: number,
  options: RecordingIdleOptions = {}
): RecordingIdleRange[] {
  const idleMs = Math.max(500, options.idleMs ?? 3_000)
  const epsilon = Math.max(0, options.moveEpsilonPx ?? 3)
  const edgeKeep = Math.max(0, options.edgeKeepMs ?? 1_000)
  const total = Math.max(0, durationMs)
  if (!samples.length || total <= 0) return []
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const ranges: RecordingIdleRange[] = []
  let stillSince = sorted[0].t
  let anchorX = sorted[0].x
  let anchorY = sorted[0].y
  const push = (startMs: number, endMs: number): void => {
    const start = Math.max(edgeKeep, startMs)
    const end = Math.min(total - edgeKeep, endMs)
    if (end - start >= idleMs) ranges.push({ startMs: start, endMs: end })
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const sample = sorted[index]
    if (Math.hypot(sample.x - anchorX, sample.y - anchorY) > epsilon) {
      push(stillSince, sorted[index - 1].t)
      stillSince = sample.t
      anchorX = sample.x
      anchorY = sample.y
    }
  }
  push(stillSince, sorted[sorted.length - 1].t)
  // 采样结束时仍在静止：到录制结束都算空闲
  const lastStill = Math.hypot(sorted[sorted.length - 1].x - anchorX, sorted[sorted.length - 1].y - anchorY) <= epsilon
  if (lastStill) push(stillSince, total)
  return mergeIdleRanges(ranges, idleMs)
}

/** 合并相邻/重叠的空闲区间（中间隔得很短的静止段合成一段，避免剪出碎片）。 */
export function mergeIdleRanges(ranges: RecordingIdleRange[], gapMs = 800): RecordingIdleRange[] {
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs)
  const merged: RecordingIdleRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.startMs - previous.endMs <= gapMs) previous.endMs = Math.max(previous.endMs, range.endMs)
    else merged.push({ ...range })
  }
  return merged
}

/**
 * 把"要剪掉的空闲区间"转成"要保留的片段"（剪辑模型选取的是保留段）。
 * 相邻保留段之间间隔过短时直接连通，避免产出大量百毫秒级碎片。
 */
export function recordingKeptSegmentsFromIdle(idle: RecordingIdleRange[], durationMs: number, minGapMs = 400): RecordingIdleRange[] {
  const total = Math.max(0, durationMs)
  const cuts = mergeIdleRanges(idle.filter((range) => range.endMs > range.startMs))
  if (!cuts.length || total <= 0) return []
  const kept: RecordingIdleRange[] = []
  let cursor = 0
  for (const cut of cuts) {
    if (cut.startMs - cursor > minGapMs) kept.push({ startMs: cursor, endMs: Math.min(cut.startMs, total) })
    cursor = Math.max(cursor, cut.endMs)
  }
  if (total - cursor > minGapMs) kept.push({ startMs: cursor, endMs: total })
  return kept.filter((range) => range.endMs - range.startMs > minGapMs)
}

/**
 * 把录制期的光标轨迹重建成**成片逐帧相机路径**（导出期运镜的输入）。
 *
 * 与录制期的实时运镜共用同一套语义（`recordingLerpTimed` 的时间常数平滑 + `recordingZoomForMotion`
 * 的速度→缩放曲线），所以"录制时运镜"和"导出时运镜"出来的观感一致，只是后者可以改参数不用重录。
 *
 * `segments` 给的是成片的保留区间（剪辑后顺序）：路径按成片帧序生成，被剪掉的时间不占帧位，
 * 这样主进程可以直接把下标当 zoompan 的 `in` 用，不必再理解剪辑。
 */
export function recordingMotionFrames(
  samples: RecordingCursorSample[],
  segments: Array<{ startMs: number; endMs: number }>,
  options: {
    fps: number
    motion: RecordingMotion
    strength: number
    maxZoom: number
    /** 成片速度：>1 时同一段素材会更快放完，帧数按比例减少 */
    speed?: number
  }
): RecordingMotionFrame[] {
  const fps = Math.max(1, Math.min(120, Math.round(options.fps) || 30))
  const frameMs = 1000 / fps
  const speed = Math.max(0.1, Math.min(8, options.speed || 1))
  const maxZoom = Math.max(1, Math.min(4, options.maxZoom || 1))
  const kept = (segments || []).filter((segment) => segment.endMs - segment.startMs >= 1).sort((a, b) => a.startMs - b.startMs)
  if (!kept.length || !samples.length) return []
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const strength = Math.max(0, Math.min(1, options.strength))
  // 实时运镜每帧乘 0.92 衰减速度；这里按帧率归一化，掉帧/不同帧率下的推近节奏才一致
  const decay = 0.92 ** (frameMs / (1000 / 30))
  let cursor = 0
  let x = sorted[0].x
  let y = sorted[0].y
  let zoom = 1
  let cursorSpeed = 0
  const frames: RecordingMotionFrame[] = []
  for (const segment of kept) {
    // 逐帧推进：sourceMs 是素材时间轴上的位置，帧序则是成片顺序
    const count = Math.max(1, Math.round((segment.endMs - segment.startMs) / speed / frameMs))
    for (let index = 0; index < count; index += 1) {
      const sourceMs = segment.startMs + index * frameMs * speed
      while (cursor + 1 < sorted.length && sorted[cursor + 1].t <= sourceMs) cursor += 1
      const previous = sorted[cursor]
      const next = sorted[cursor + 1]
      const ratio = next && next.t > previous.t ? Math.max(0, Math.min(1, (sourceMs - previous.t) / (next.t - previous.t))) : 0
      const cursorX = previous.x + ((next?.x ?? previous.x) - previous.x) * ratio
      const cursorY = previous.y + ((next?.y ?? previous.y) - previous.y) * ratio
      const before = sorted[cursor - 1]
      // 与实时运镜同量纲：该采样区间的位移 × 10000，再按帧衰减
      if (before) cursorSpeed = Math.hypot(previous.x - before.x, previous.y - before.y) * 10_000
      cursorSpeed *= decay
      const centerAlpha = recordingSmoothingAlpha(frameMs, 0.035 + strength * 0.075, Math.max(1, frameMs))
      x += (cursorX - x) * centerAlpha
      y += (cursorY - y) * centerAlpha
      const targetZoom = options.motion === 'off' ? 1 : Math.min(maxZoom, recordingZoomForMotion(options.motion, cursorSpeed))
      zoom += (targetZoom - zoom) * recordingSmoothingAlpha(frameMs, 0.035 + strength * 0.04, Math.max(1, frameMs))
      frames.push({
        x: Number(Math.max(0, Math.min(1, x)).toFixed(4)),
        y: Number(Math.max(0, Math.min(1, y)).toFixed(4)),
        zoom: Number(Math.max(1, Math.min(maxZoom, zoom)).toFixed(4))
      })
    }
  }
  return frames
}

/** 导出期运镜的系数与录音期保持一致的默认值，供工坊与测试共用。 */
export const RECORDING_MOTION_MAX_ZOOM = 1.6

/**
 * 采集方式。
 * - `composite`：桌面画面 → canvas（裁剪/比例/运镜/画中画/水印）→ captureStream，所见即所得。
 * - `raw`：桌面轨道**直接**进编码器，不做任何合成——代价是叠加层与画幅变换要留到导出期，
 *   换来的是采集侧没有画布重绘，实测 1440p 下丢掉的那 3–9fps 找回来。
 */
export type RecordingCaptureMode = 'composite' | 'raw'

export interface RecordingRawModeOptions {
  aspect: RecordingAspect
  fitMode: 'contain' | 'cover'
  regionEnabled: boolean
  webcam: boolean
  watermarkEnabled: boolean
  privacyTop: number
  privacyBottom: number
}

/**
 * 原始采集当前**不能**表达的东西（空数组表示可用）。
 *
 * 这里不是偷懒的禁用清单，而是逐项说明"这个功能为什么必须画布"：画幅比例与自定义区域要重采样、
 * 画中画与水印要叠图、隐私条要遮挡——它们都需要逐帧合成，且都是用户明确选过的意图，
 * 静默改掉比拒绝更糟。原始采集只把屏幕原样送进编码器，这些能力要么留到导出期，要么如实说不支持。
 *
 * 刻意**不**把鼠标光晕/轨迹列进来：它们纯粹是画布效果，原始采集本来就不画，
 * 属于"切过去就没有"而不是"切过去不生效"，由调用方顺手关掉即可（见 studio 的切换处理）。
 */
export function recordingRawModeBlockers(options: RecordingRawModeOptions): string[] {
  const blockers: string[] = []
  if (options.aspect !== 'source') blockers.push('画幅比例（请切到“跟随源”：原始采集就是屏幕原始画幅，导出期只能等比缩放，不能凭空补出别的画幅）')
  if (options.fitMode !== 'contain') blockers.push('适配方式（请切到“完整显示”：原始采集不做铺满裁切）')
  if (options.regionEnabled) blockers.push('自定义录制区域（请改用剪辑页的成片裁切）')
  if (options.webcam) blockers.push('摄像头画中画（需要逐帧叠图）')
  if (options.watermarkEnabled) blockers.push('文字水印（需要逐帧绘制）')
  if (options.privacyTop > 0 || options.privacyBottom > 0) blockers.push('隐私遮挡条（需要逐帧遮挡）')
  return blockers
}

/** 原始采集的成片尺寸就是屏幕原始尺寸，只把奇数边长收成偶数（H.264 要求）。 */
export function recordingRawCaptureSize(width: number, height: number): RecordingSize {
  const even = (value: number): number => Math.max(2, Math.round(Math.max(2, value) / 2) * 2)
  return { width: even(width), height: even(height) }
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

/**
 * 录制容器/编码优先链：**MP4 + H.264 优先**，WebM/VP9 逐级回退。
 *
 * 为什么 MP4/H.264 排最前（本机实测，Electron 44 / Chromium 152）：
 *  1. **容器元数据可信**：MediaRecorder 产出的 WebM 没有 Duration、且 tbr 被写成时基
 *     （实测 `tbn 1k`，FFmpeg 读成 1000fps），导出时只能猜标称帧率——"导出画面飞快跑完"
 *     那类事故的根就在这里。同样条件录出的 MP4 是 `Duration 2.00s / 29.92 tbr / 30k tbn`。
 *  2. **导出可直通**：目标也是 MP4 时能 `-c:v copy`（实测 60 秒素材 1 秒，重编码要 18 秒）。
 *  3. **省 CPU**：不再用软件 libvpx 编 VP8/VP9，把 CPU 让回给画面合成，缓解高分屏丢帧。
 *  4. **兼容性最好**：H.264 + AAC 在微信/剪映/Windows 播放器/手机上都能直接播。
 *
 * 级位串按"高画质 → 高兼容"排：High@5.1 覆盖到 4K，High@4.0 退一档，Baseline 兜底。
 * 刻意**不**把不带 codecs 的 `video/mp4` 放进优先链——实测它会被 Chromium 塞成 VP9-in-MP4，
 * 既拿不到 H.264 的兼容性，又丢了 WebM 的原生支持。
 */
export function selectRecorderMime(isSupported: (mime: string) => boolean, withAudio = true): string {
  const mp4 = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42001f']
  const webm = withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return [...mp4, ...webm].find(isSupported) || 'video/webm'
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
  /** 采集方式：原始采集没有画布重绘，因此不统计合成丢帧，健康文案也要跟着换。 */
  captureMode?: RecordingCaptureMode
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
  if (input.captureMode === 'raw') return { level: 'healthy', message: input.bytes > 0 ? '原始画面采集（无合成开销）' : '正在等待首个分片', bitrateMbps, droppedPercent }
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

/** 播放头 DOM 元素（结构化类型：浏览器传真实元素，测试传替身） */
export interface PreviewPositionTargets {
  main: { style: { left: string } } | null
  segment: { style: { left: string } } | null
  label: { textContent: string } | null
}

/**
 * 把播放头位置直写到 DOM（不经过 React 状态）。
 * video 的 timeupdate 是高频事件，走 state 会让录屏工作台（2000+ 行）整树重渲染；
 * 这里只改元素的 style/textContent，React 因其它原因重渲染时从 ref 读最新值即可保持一致。
 * 返回写入的百分比，便于测试与调试。
 */
export function writePreviewPosition(targets: PreviewPositionTargets, ms: number, totalMs: number): number {
  const pct = totalMs > 0 ? (ms / totalMs) * 100 : 0
  if (targets.main) targets.main.style.left = `${pct}%`
  if (targets.segment) targets.segment.style.left = `${pct}%`
  if (targets.label) targets.label.textContent = formatRecordingTime(ms)
  return pct
}

/**
 * 把悬浮录制控制条夹在可视区内（四边各留 margin）。
 * 控制条悬在被录屏幕上方，不能拖动就只能一直挡着画面；夹取保证拖出边界时仍抓得住，
 * 也保证窗口尺寸/显示器变化后它不会留在可视区之外。
 */
export function clampRecordingBarPosition(
  x: number,
  y: number,
  bar: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.width - bar.width - margin)
  const maxY = Math.max(margin, viewport.height - bar.height - margin)
  return {
    x: Math.min(Math.max(margin, Number.isFinite(x) ? x : margin), maxX),
    y: Math.min(Math.max(margin, Number.isFinite(y) ? y : margin), maxY)
  }
}
