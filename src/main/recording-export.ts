import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { RecordingExportRequest, RecordingMotionFrame, RecordingMotionTrack } from '../shared/protocol'

export interface RecordingExportProcess {
  child: ChildProcessByStdio<null, Readable, Readable>
  done: Promise<void>
}

/** 导出期运镜的表达式的最大分段数：段数决定表达式长度（Windows 命令行上限约 32KB，48 段约 7KB）。 */
export const MAX_MOTION_WAYPOINTS = 48
/** 折线简化的容差：中心位置按归一化画面计（0.004 ≈ 1080p 下 4px），缩放单独一档。 */
export const MOTION_CENTER_TOLERANCE = 0.004
export const MOTION_ZOOM_TOLERANCE = 0.01
/** 容差放宽的上限：再放就会把真实的镜头运动整段抹平（2% 画面 ≈ 1080p 下 22px）。 */
export const MOTION_MAX_CENTER_TOLERANCE = 0.02

/**
 * 把逐帧相机路径压成**折线航点**（首尾必留，中间按最大偏差合并）。
 *
 * 为什么要压：FFmpeg 的 `zoompan` 只吃表达式，没有"按帧查表"的入口（`sendcmd` 实测驱动不了
 * `crop` 的 x/y：命令解析成功但裁剪位置始终停在初始值）。所以路径必须写成一个以帧序 `in`
 * 为自变量的表达式——逐帧表会撑成上万层的 if，压成 ≤20 段折线才有意义。
 * 用最大偏差而不是等间隔抽样：等间隔会把"拐点"抹掉，最大偏差能保证成片里镜头运动与逐帧路径
 * 的差不超过容差。
 */
/**
 * 在给定容差下做"开窗"折线简化：窗口能从 s 延伸到 e 就继续延伸，越界就把 e 收成航点。
 * 返回的下标保证**任何被丢弃的帧**与相邻两航点之间的线性插值相比，偏差都不超过容差。
 */
function simplifyAtTolerance(frames: RecordingMotionFrame[], centerTolerance: number, zoomTolerance: number): number[] {
  if (frames.length <= 2) return frames.map((_, index) => index)
  const kept: number[] = [0]
  let start = 0
  let end = 1
  while (end < frames.length - 1) {
    const from = frames[start]
    const to = frames[end + 1]
    const span = end + 1 - start || 1
    let worstCenter = 0
    let worstZoom = 0
    for (let probe = start + 1; probe <= end; probe += 1) {
      const ratio = (probe - start) / span
      const current = frames[probe]
      worstCenter = Math.max(
        worstCenter,
        Math.abs(current.x - (from.x + (to.x - from.x) * ratio)),
        Math.abs(current.y - (from.y + (to.y - from.y) * ratio))
      )
      worstZoom = Math.max(worstZoom, Math.abs(current.zoom - (from.zoom + (to.zoom - from.zoom) * ratio)))
    }
    if (worstCenter <= centerTolerance && worstZoom <= zoomTolerance) {
      end += 1
      continue
    }
    kept.push(end)
    start = end
    end = start + 1
  }
  if (kept.at(-1) !== frames.length - 1) kept.push(frames.length - 1)
  return kept
}

/**
 * 逐帧路径 → 折线航点（首尾必留）。
 *
 * 为什么要压：FFmpeg 的 `zoompan` 只吃表达式，没有"按帧查表"的入口（`sendcmd` 实测驱动不了
 * `crop` 的 x/y：命令解析成功但裁剪位置始终停在初始值）。所以路径必须写成以帧序 `in` 为自变量
 * 的表达式——逐帧表会撑成上万层的 if，压成几十段折线才有意义。
 *
 * 容差策略（不是"抽稀"）：先按基准容差（0.004 ≈ 1080p 下 4px）做最大偏差简化；超上限就放宽容差
 * 重试，但**只放到 2% 画面**（再放就会像早先那样把来回运动整段抹成一条直线，实测 600 帧的往复
 * 路径会被压成 2 个航点）；实在压不下去才等间隔抽稀兜底。任何一档都会保留首尾帧。
 */
export function simplifyRecordingMotion(track: RecordingMotionTrack, maxWaypoints = MAX_MOTION_WAYPOINTS): number[] {
  const frames = (track.frames || []).filter((frame) => frame && Number.isFinite(frame.x) && Number.isFinite(frame.y) && Number.isFinite(frame.zoom))
  if (frames.length <= 2) return frames.map((_, index) => index)
  const limit = Math.max(3, Math.min(400, Math.round(maxWaypoints)))
  const maxScale = MOTION_MAX_CENTER_TOLERANCE / MOTION_CENTER_TOLERANCE
  let waypoints = simplifyAtTolerance(frames, MOTION_CENTER_TOLERANCE, MOTION_ZOOM_TOLERANCE)
  for (let scale = 1.5; scale <= maxScale && waypoints.length > limit; scale *= 1.5) {
    waypoints = simplifyAtTolerance(frames, MOTION_CENTER_TOLERANCE * scale, MOTION_ZOOM_TOLERANCE * scale)
  }
  if (waypoints.length <= limit) return waypoints
  // 兜底：等间隔抽稀（首尾必留）。只有容差放到上限仍压不进上限的极端路径才会走到这里。
  const stride = Math.ceil(waypoints.length / limit)
  const thinned = waypoints.filter((_, index) => index % stride === 0)
  if (thinned.at(-1) !== waypoints.at(-1)) thinned.push(waypoints.at(-1)!)
  return thinned
}

const num = (value: number): string => {
  const fixed = Math.abs(value) < 1 ? value.toFixed(4) : value.toFixed(3)
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * 生成以帧序 `in` 为自变量的分段线性表达式：`in` 落在第 k 段就按该段两端线性插值。
 * 段数与 `waypoints` 一致，末段之后保持终值（`zoompan` 的 `in` 不会超出帧数，属于兜底）。
 */
function piecewiseLinearExpression(track: RecordingMotionTrack, waypoints: number[], pick: (index: number) => number): string {
  const frames = track.frames
  if (waypoints.length < 2) return num(pick(waypoints[0] || 0))
  let expression = num(pick(waypoints[waypoints.length - 1]))
  for (let index = waypoints.length - 2; index >= 0; index -= 1) {
    const start = waypoints[index]
    const end = waypoints[index + 1]
    const from = pick(start)
    const to = pick(end)
    const slope = end === start ? 0 : (to - from) / (end - start)
    expression = `if(lt(in,${end}),${num(from)}+${num(slope)}*(in-${start}),${expression})`
  }
  return expression
}

/**
 * 导出期运镜的 `zoompan` 滤镜。
 *
 * 三个实测结论决定了这个写法：
 * ① `zoompan` 的表达式里**没有 `t`**（用 `t` 会报 "Undefined constant"），只有 `in`（输入帧序）
 *    —— 所以时间轴用帧序表达，帧率由 `fps=` 归一化。
 * ② `d=1` 时输出帧数等于输入帧数，不会像默认 `d=90` 那样把每帧复制 90 份。
 * ③ 代价可接受：1600p→1080p 十秒素材 1.93s，空白基线 1.56s（+24%）。
 *
 * 输出尺寸由 `s=` 决定，因此开了运镜就不再需要单独的 `scale`；`x`/`y` 按输入像素算并钳在
 * `[0, 边长-边长/zoom]`，避免放大到画面外露出黑边。要求输入与输出同宽高比（本应用的录制画布
 * 就是按输出尺寸合成的，天然满足），否则先缩放会变形。
 */
export function buildRecordingMotionFilter(
  track: RecordingMotionTrack,
  outputWidth: number,
  outputHeight: number,
  fps: number
): string | null {
  const frames = (track.frames || []).filter((frame) => frame && Number.isFinite(frame.x) && Number.isFinite(frame.y) && Number.isFinite(frame.zoom))
  if (frames.length < 2) return null
  const safe: RecordingMotionTrack = {
    fps,
    frames: frames.map((frame) => ({ x: Math.max(0, Math.min(1, frame.x)), y: Math.max(0, Math.min(1, frame.y)), zoom: Math.max(1, Math.min(4, frame.zoom)) }))
  }
  const waypoints = simplifyRecordingMotion(safe)
  if (waypoints.length < 2) return null
  const zoom = piecewiseLinearExpression(safe, waypoints, (index) => safe.frames[index].zoom)
  const centerX = piecewiseLinearExpression(safe, waypoints, (index) => safe.frames[index].x)
  const centerY = piecewiseLinearExpression(safe, waypoints, (index) => safe.frames[index].y)
  const x = `max(0,min(iw-iw/zoom,(${centerX})*iw-iw/zoom/2))`
  const y = `max(0,min(ih-ih/zoom,(${centerY})*ih-ih/zoom/2))`
  const size = `${Math.max(2, Math.round(outputWidth))}x${Math.max(2, Math.round(outputHeight))}`
  return `zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${size}:fps=${Math.max(1, Math.round(fps))}`
}

/**
 * 素材画幅与目标画幅不一致时怎么"重组"画面（纯函数，便于离线测试）。
 *
 * 之前只有一句 `scale=…:force_original_aspect_ratio=decrease`——那在**同画幅**下没问题（等比缩小），
 * 但画幅不同时它只是把画面缩小，既不补边也不裁切，成片尺寸根本不是请求的尺寸。
 * 原始画面采集正是这种情况：录的是屏幕原始画幅（常见 16:10），用户要的却是 16:9。
 *
 * - `contain`：等比缩到能放进目标框，四周补黑（不裁内容）
 * - `cover`：等比放大到铺满目标框，多出来的裁掉（不留黑边）
 *
 * 同画幅时返回空数组，保持既有导出路径一个字节都不变。
 */
export function buildRecordingAspectFilters(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  fit: 'contain' | 'cover' = 'contain'
): string[] {
  const sw = Math.max(1, Math.round(sourceWidth))
  const sh = Math.max(1, Math.round(sourceHeight))
  const ow = Math.max(2, Math.round(outputWidth))
  const oh = Math.max(2, Math.round(outputHeight))
  if (Math.abs(sw / sh - ow / oh) < 0.002) return []
  if (fit === 'cover') return [`scale=w=${ow}:h=${oh}:force_original_aspect_ratio=increase:force_divisible_by=2`, `crop=${ow}:${oh}`]
  return [`scale=w=${ow}:h=${oh}:force_original_aspect_ratio=decrease:force_divisible_by=2`, `pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2:color=black`]
}

/**
 * 导出期运镜在当前请求下是否可用。
 *
 * 为什么单独抽出来：`zoompan` 按源像素算取景窗口、再输出目标尺寸，所以要求两者画幅一致
 * （否则会拉伸）。画幅不一致时要**如实告知运镜没生效**，而不是静默丢掉这个能力。
 */
export function recordingMotionUsable(request: RecordingExportRequest): boolean {
  if (!request.motion?.frames?.length) return false
  const sourceAspect = Math.max(1, request.width) / Math.max(1, request.height)
  const outputAspect = Math.max(2, Number(request.outputWidth) || request.width) / Math.max(2, Number(request.outputHeight) || request.height)
  if (Math.abs(sourceAspect - outputAspect) < 0.01) return true
  // 画幅不一致时，渲染层会给出"铺满"裁切窗口（先裁齐画幅再取景），有它就可用
  const crop = request.motion.crop
  return Boolean(crop && crop.width > 0 && crop.height > 0)
}

/** 运镜前的画幅裁齐：把源画面按归一化窗口裁成目标画幅（表达式里按像素算，保持偶数边长）。 */
export function buildRecordingMotionCropFilter(crop: { x: number; y: number; width: number; height: number }): string {
  const width = Math.max(0.01, Math.min(1, crop.width))
  const height = Math.max(0.01, Math.min(1, crop.height))
  const x = Math.max(0, Math.min(1 - width, crop.x))
  const y = Math.max(0, Math.min(1 - height, crop.y))
  return `crop=trunc(iw*${width.toFixed(4)}/2)*2:trunc(ih*${height.toFixed(4)}/2)*2:trunc(iw*${x.toFixed(4)}/2)*2:trunc(ih*${y.toFixed(4)}/2)*2`
}

/** 质量档 → CRF（导出侧与编码器选择都要用同一张表，避免两处漂移）。 */
export const crfFor = (quality: RecordingExportRequest['quality']): number => {
  if (quality === 'compact') return 30
  if (quality === 'near-lossless') return 15
  if (quality === 'lossless') return 0
  return 22
}

const normalizedSegments = (request: RecordingExportRequest): Array<{ startMs: number; endMs: number }> => {
  const ranges = (request.edit?.segments || [])
    .filter((segment) => segment.enabled !== false)
    .map((segment) => ({
      startMs: Math.max(0, Math.min(request.durationMs, Number(segment.startMs) || 0)),
      endMs: Math.max(0, Math.min(request.durationMs, Number(segment.endMs) || 0))
    }))
    .filter((segment) => segment.endMs - segment.startMs >= 50)
    .sort((a, b) => a.startMs - b.startMs)
  const merged: Array<{ startMs: number; endMs: number }> = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.startMs <= previous.endMs) previous.endMs = Math.max(previous.endMs, range.endMs)
    else merged.push({ ...range })
  }
  return merged
}

export function recordingExportDurationMs(request: RecordingExportRequest): number {
  const trimStart = Math.max(0, Math.min(request.durationMs, Number(request.trimStartMs) || 0))
  const trimEnd = Math.max(trimStart + 1, Math.min(request.durationMs, Number(request.trimEndMs) || request.durationMs))
  const segments = normalizedSegments(request)
  const speed = Math.max(0.5, Math.min(2, Number(request.edit?.speed) || 1))
  return Math.max(1, (segments.length ? segments.reduce((sum, segment) => sum + segment.endMs - segment.startMs, 0) : trimEnd - trimStart) / speed)
}

/**
 * 成品自检：导出完成后回头读一遍写出的文件，确认它**真的**是请求的那条片子。
 *
 * 为什么值得做：这个项目被"导出画面飞快跑完"这一类事故咬过两次（VFR 标称帧率被当帧率铺帧、
 * zoompan 的 15360 时基被后置 fps 滤镜读成 15360fps），两次的共同点是**文件写成功了**、
 * 只有内容不对。所以"导出完成"必须以读回来的元数据为准，而不是以 FFmpeg 正常退出为准。
 */
export interface RecordingOutputProbe {
  durationMs: number
  fps: number
  frames: number
  hasVideo: boolean
  hasAudio: boolean
  videoCodec: string
}

/** 解析 `ffmpeg -i <file>` 的流信息（纯函数，便于用固定文本做离线测试）。 */
export function parseRecordingOutputProbe(text: string): RecordingOutputProbe {
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
  const durationMs = duration
    ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000)
    : 0
  const videoLine = /Stream #\d+:\d+.*: Video: ([a-z0-9_]+).*?(\d+(?:\.\d+)?) fps/.exec(text)
  const hasVideo = Boolean(/Stream #\d+:\d+.*: Video:/.test(text))
  const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(text)
  const frames = Number(/frame=\s*(\d+)/.exec(text)?.[1] || 0)
  return {
    durationMs,
    fps: Number(videoLine?.[2] || 0),
    frames,
    hasVideo,
    hasAudio,
    videoCodec: videoLine?.[1] || ''
  }
}

export interface RecordingExportCheck {
  ok: boolean
  /** 一行摘要，适合直接拼进"已导出 …"的提示 */
  summary: string
  warnings: string[]
}

/**
 * 把探测结果与请求对照（纯函数）。容差是"人眼能察觉"的量级：
 * 时长 8% 或 400ms（取大者），帧率 ±1，帧数与"时长×帧率"相差 12% 以内。
 */
export function recordingExportVerdict(request: RecordingExportRequest, probe: RecordingOutputProbe): RecordingExportCheck {
  const warnings: string[] = []
  const expectedMs = recordingExportDurationMs(request)
  const seconds = probe.durationMs / 1000
  const codecLabel = probe.videoCodec ? probe.videoCodec.toUpperCase() : '—'
  if (request.format === 'mp3') {
    if (!probe.hasAudio) warnings.push('导出的文件里读不到音轨')
    const summary = probe.hasAudio ? `仅音轨 · ${seconds.toFixed(1)}s` : '音轨缺失'
    return { ok: warnings.length === 0, summary, warnings }
  }
  if (!probe.hasVideo) warnings.push('导出的文件里读不到视频轨')
  if (!probe.durationMs) warnings.push('容器没有可用的时长元数据（播放器可能无法拖动进度）')
  else if (Math.abs(probe.durationMs - expectedMs) > Math.max(400, expectedMs * 0.08)) {
    warnings.push(`时长对不上：请求 ${(expectedMs / 1000).toFixed(1)}s，成品 ${seconds.toFixed(1)}s`)
  }
  // GIF 没有音轨也没有可信帧率，只查时长与视频轨
  if (request.format === 'gif') {
    const summary = `GIF · ${seconds.toFixed(1)}s`
    return { ok: warnings.length === 0, summary, warnings }
  }
  const expectedFps = Math.max(1, Math.round(Number(request.outputFps) || request.fps))
  if (probe.fps && Math.abs(probe.fps - expectedFps) > 1) {
    warnings.push(`帧率对不上：请求 ${expectedFps}fps，成品 ${probe.fps}fps`)
  }
  if (probe.frames && probe.durationMs) {
    const density = probe.frames / seconds
    if (Math.abs(density - expectedFps) > expectedFps * 0.12) {
      warnings.push(`帧数与时长不一致：${probe.frames} 帧 / ${seconds.toFixed(1)}s ≈ ${density.toFixed(1)}fps`)
    }
  }
  if (request.hasAudio && request.edit?.muteAudio !== true && !probe.hasAudio) warnings.push('请求里带音轨，但成品没有声音')
  // 运镜要源画幅与目标画幅一致（zoompan 按源像素取景再输出目标尺寸，画幅不同会拉伸），
  // 不一致时如实说"没生效"，不能静默丢掉
  if (request.motion?.frames?.length && !recordingMotionUsable(request)) warnings.push('画幅与素材不一致，导出期运镜本次未生效（请把输出画幅设为与素材一致）')
  // "按铺满裁齐"是预期行为而不是问题，放进摘要（人看得见），不能塞进 warnings 把自检判成"有疑问"
  const summary = `${seconds.toFixed(1)}s · ${expectedFps}fps · ${codecLabel}${request.motion?.crop ? ' · 画幅按铺满重组' : ''}`
  return { ok: warnings.length === 0, summary, warnings }
}

/** 导出完成后读一遍成品并给出自检结论（runner 注入，便于离线测试）。 */
export async function probeRecordingOutput(
  ffmpegPath: string,
  filePath: string,
  runner: EncoderRunner = spawnEncoderRunner(ffmpegPath)
): Promise<RecordingOutputProbe> {
  // `-i <file>` 不指定输出时 ffmpeg 以非零码退出，但流信息已经打到 stderr —— 只看文本，不看退出码
  const result = await runner(['-hide_banner', '-i', filePath], 20_000)
  return parseRecordingOutputProbe(result.output)
}

export function recordingExportSubtitleSegments(request: RecordingExportRequest): Array<{ startMs: number; endMs: number; text: string }> {
  const source = request.subtitle?.segments || []
  if (!source.length) return []
  const trimStart = Math.max(0, Math.min(request.durationMs, Number(request.trimStartMs) || 0))
  const trimEnd = Math.max(trimStart + 1, Math.min(request.durationMs, Number(request.trimEndMs) || request.durationMs))
  const segments = normalizedSegments(request)
  const ranges = segments.length ? segments : [{ startMs: trimStart, endMs: trimEnd }]
  const speed = Math.max(0.5, Math.min(2, Number(request.edit?.speed) || 1))
  let outputOffset = 0
  const output: Array<{ startMs: number; endMs: number; text: string }> = []
  for (const range of ranges) {
    for (const item of source) {
      const start = Math.max(range.startMs, Number(item.startMs) || 0)
      const end = Math.min(range.endMs, Number(item.endMs) || 0)
      const text = String(item.text || '').trim()
      if (!text || end <= start) continue
      output.push({ startMs: (outputOffset + start - range.startMs) / speed, endMs: (outputOffset + end - range.startMs) / speed, text })
    }
    outputOffset += range.endMs - range.startMs
  }
  return output
}

export function recordingHasEdits(request: RecordingExportRequest): boolean {
  const edit = request.edit
  const deliveryEdit = Boolean(request.subtitleFilePath)
    || (Number(request.outputWidth) > 0 && Math.round(Number(request.outputWidth)) !== Math.round(request.width))
    || (Number(request.outputHeight) > 0 && Math.round(Number(request.outputHeight)) !== Math.round(request.height))
    || (Number(request.outputFps) > 0 && Math.round(Number(request.outputFps)) !== Math.round(request.fps))
  if (!edit) return deliveryEdit
  const segments = normalizedSegments(request)
  const segmentEdit = segments.length !== 1 || segments[0].startMs > 0 || segments[0].endMs < request.durationMs
  const crop = edit.crop
  return deliveryEdit
    || segmentEdit
    || Math.abs((Number(edit.speed) || 1) - 1) > 0.001
    || Boolean(crop && [crop.left, crop.top, crop.right, crop.bottom].some((value) => Number(value) > 0))
    || Boolean(edit.rotation || edit.flipHorizontal || edit.flipVertical)
    || Math.abs(Number(edit.brightness) || 0) > 0.001
    || Math.abs((Number(edit.contrast) || 1) - 1) > 0.001
    || Math.abs((Number(edit.saturation) || 1) - 1) > 0.001
    || Math.abs((Number(edit.gamma) || 1) - 1) > 0.001
    || Number(edit.sharpen) > 0
    || Number(edit.denoise) > 0
    || Math.abs((Number(edit.audioVolume) || 1) - 1) > 0.001
    || Boolean(edit.muteAudio || Number(edit.fadeInMs) > 0 || Number(edit.fadeOutMs) > 0)
}

export function buildRecordingFfmpegArgs(
  inputPath: string,
  outputPath: string,
  request: RecordingExportRequest,
  /** 由 encoder-selection 实测选出；默认软件编码（任何探测失败都回落到这里） */
  encoder: VideoEncoder = 'libx264'
): string[] {
  const trimStart = Math.max(0, Math.min(request.durationMs, Number(request.trimStartMs) || 0))
  const trimEnd = Math.max(trimStart + 1, Math.min(request.durationMs, Number(request.trimEndMs) || request.durationMs))
  const edit = request.edit || {}
  const segments = normalizedSegments(request)
  const speed = Math.max(0.5, Math.min(2, Number(edit.speed) || 1))
  const editedDurationMs = recordingExportDurationMs(request)
  const includeAudio = request.hasAudio === true && edit.muteAudio !== true && request.format !== 'gif'
  // 只有**多段**才是真正的分段剪辑（要 trim+concat）。
  // 单段 = 普通裁剪：交给 -ss/-t 输入定位，FFmpeg 从定位点开始解码，不必要的前段全部跳过；
  // 覆盖全长的单段（工坊每份录制都会自动生成一个）= 没剪，什么都不做。
  const trimming = segments.length > 1
  const hasSegmentFilter = trimming
  const singleRange = segments.length === 1 && !(segments[0].startMs <= 1 && segments[0].endMs >= request.durationMs - 1) ? segments[0] : null
  const cutStart = singleRange ? singleRange.startMs : trimStart
  const cutEnd = singleRange ? singleRange.endMs : trimEnd
  const common = [
    '-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', inputPath,
    ...(request.subtitleFilePath && request.format !== 'gif' && request.format !== 'mp3' ? ['-i', request.subtitleFilePath] : []),
    ...(!hasSegmentFilter && cutStart > 0 ? ['-ss', (cutStart / 1000).toFixed(3)] : []),
    ...(!hasSegmentFilter && (cutStart > 0 || cutEnd < request.durationMs) ? ['-t', ((cutEnd - cutStart) / 1000).toFixed(3)] : []),
    '-map_metadata', '-1'
  ]
  // 分段裁剪：按时间 trim 出每段再 concat，段内原始时间轴（含 VFR 的不均匀间隔）完整保留。
  // 旧实现是 select + setpts=N/(FRAME_RATE*TB)：按"第 N 帧 → N/帧率"重排，正确性取决于
  // FRAME_RATE 解析出的标称值，一旦与实际帧密度不符整段视频就会加速或缩短。
  const graph: string[] = []
  let videoSource = '0:v'
  let audioSource = '0:a'
  // mp3 只要音频；给不需要的轨道建图没有意义（未映射的 pad 是白费功夫，也容易触发校验噪音）
  const needVideo = request.format !== 'mp3'
  if (hasSegmentFilter) {
    const videoParts: string[] = []
    const audioParts: string[] = []
    segments.forEach((segment, index) => {
      const start = (segment.startMs / 1000).toFixed(3)
      const end = (segment.endMs / 1000).toFixed(3)
      if (needVideo) {
        graph.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`)
        videoParts.push(`[v${index}]`)
      }
      if (includeAudio) {
        graph.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`)
        audioParts.push(`[a${index}]`)
      }
    })
    if (needVideo) {
      graph.push(`${videoParts.join('')}concat=n=${segments.length}:v=1:a=0[vcut]`)
      videoSource = 'vcut'
    }
    if (includeAudio) {
      graph.push(`${audioParts.join('')}concat=n=${segments.length}:v=0:a=1[acut]`)
      audioSource = 'acut'
    }
  }
  const videoFilters: string[] = []
  if (speed !== 1) videoFilters.push(`setpts=PTS/${speed.toFixed(3)}`)
  // 导出期运镜放在滤镜链最前：它要按**源**像素坐标算裁剪窗口，后面的裁切/调色/缩放都作用在它的输出上。
  // 只有宽高比一致时才开：zoompan 的缩放窗口保持输入的宽高比，比例不同会先把画面压变形。
  const outputWidthForMotion = Math.max(2, Math.min(7680, Math.round(Number(request.outputWidth) || request.width)))
  const outputHeightForMotion = Math.max(2, Math.min(4320, Math.round(Number(request.outputHeight) || request.height)))
  const motionFilter = recordingMotionUsable(request)
    ? buildRecordingMotionFilter(request.motion!, outputWidthForMotion, outputHeightForMotion, Math.round(Number(request.outputFps) || request.fps))
    : null
  if (motionFilter) {
    // 帧率归一化必须放在 zoompan **之前**：文件输入时 zoompan 的输出时间戳停在它的 15360 时基里
    // （PTS 步长 1/15360），后面再挂 fps 滤镜会被读成 15360fps 并复制帧去凑 30fps ——
    // 实测 3 秒素材导出成 25 分 36 秒（512 倍）。先归一化成真 CFR，zoompan 就只是逐帧改取景。
    videoFilters.push(`fps=${Math.max(1, Math.min(120, Math.round(Number(request.outputFps) || request.fps)))}`)
    // 跨画幅：先把画面裁成目标画幅，zoompan 的取景窗口才有正确的宽高比（渲染层已把路径重映射）
    if (request.motion?.crop) videoFilters.push(buildRecordingMotionCropFilter(request.motion.crop))
    videoFilters.push(motionFilter)
    videoFilters.push('setsar=1')
  }
  const crop = edit.crop
  if (crop) {
    const left = Math.max(0, Math.min(0.45, Number(crop.left) || 0))
    const top = Math.max(0, Math.min(0.45, Number(crop.top) || 0))
    const right = Math.max(0, Math.min(0.45, Number(crop.right) || 0))
    const bottom = Math.max(0, Math.min(0.45, Number(crop.bottom) || 0))
    if (left + right > 0 || top + bottom > 0) {
      videoFilters.push(`crop=trunc(iw*${(1 - left - right).toFixed(4)}/2)*2:trunc(ih*${(1 - top - bottom).toFixed(4)}/2)*2:trunc(iw*${left.toFixed(4)}/2)*2:trunc(ih*${top.toFixed(4)}/2)*2`)
    }
  }
  if (edit.rotation === 90) videoFilters.push('transpose=1')
  if (edit.rotation === 180) videoFilters.push('hflip', 'vflip')
  if (edit.rotation === 270) videoFilters.push('transpose=2')
  if (edit.flipHorizontal) videoFilters.push('hflip')
  if (edit.flipVertical) videoFilters.push('vflip')
  const brightness = Math.max(-1, Math.min(1, Number(edit.brightness) || 0))
  const contrast = Math.max(0.25, Math.min(3, Number(edit.contrast) || 1))
  const saturation = Math.max(0, Math.min(3, Number(edit.saturation) || 1))
  const gamma = Math.max(0.25, Math.min(3, Number(edit.gamma) || 1))
  if (brightness !== 0 || contrast !== 1 || saturation !== 1 || gamma !== 1) videoFilters.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${gamma.toFixed(3)}`)
  const denoise = Math.max(0, Math.min(10, Number(edit.denoise) || 0))
  if (denoise > 0) videoFilters.push(`hqdn3d=${denoise.toFixed(2)}:${denoise.toFixed(2)}:${(denoise * 1.5).toFixed(2)}:${(denoise * 1.5).toFixed(2)}`)
  const sharpen = Math.max(0, Math.min(2, Number(edit.sharpen) || 0))
  if (sharpen > 0) videoFilters.push(`unsharp=5:5:${sharpen.toFixed(2)}:5:5:0`)
  if (request.format !== 'gif' && request.format !== 'mp3') {
    const outputWidth = Math.max(2, Math.min(7680, Math.round(Number(request.outputWidth) || request.width)))
    const outputHeight = Math.max(2, Math.min(4320, Math.round(Number(request.outputHeight) || request.height)))
    if (!motionFilter) {
      // 跨画幅（原始采集最常见）必须先重组再输出；同画幅返回空数组，行为与以前完全一致
      const adaptation = buildRecordingAspectFilters(request.width, request.height, outputWidth, outputHeight, request.fit === 'cover' ? 'cover' : 'contain')
      if (adaptation.length) videoFilters.push(...adaptation)
      else if (outputWidth < request.width || outputHeight < request.height) videoFilters.push(`scale=w=${outputWidth}:h=${outputHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`)
    }
    const outputFps = Math.max(1, Math.min(120, Math.round(Number(request.outputFps) || request.fps)))
    // 输出帧率必须显式归一化，不能"与源一致就不管"：
    // 录制源是 MediaRecorder 产的 WebM（VFR），容器里的标称帧率并不代表真实帧密度
    //（实测 tbr 1k，即 1000fps）。打包成 MP4 时封装器需要一个恒定帧率，会拿这个标称值
    // 铺帧 —— 实测 60 秒输入被写成 60002 帧（1000fps，41 倍重复帧），文件暴涨且播放器行为
    // 完全不可预期（画面飞快跑完、声音照常播完）。fps 滤镜按目标帧率重新排帧但保持时间轴不变。
    const fpsFilterNeeded = request.format === 'mp4' || outputFps !== request.fps
    if (fpsFilterNeeded && !motionFilter) videoFilters.push(`fps=${outputFps}`)
  }
  const fadeIn = Math.min(editedDurationMs / 2, Math.max(0, Number(edit.fadeInMs) || 0)) / 1000
  const fadeOut = Math.min(editedDurationMs / 2, Math.max(0, Number(edit.fadeOutMs) || 0)) / 1000
  if (fadeIn > 0) videoFilters.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`)
  if (fadeOut > 0) videoFilters.push(`fade=t=out:st=${Math.max(0, editedDurationMs / 1000 - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`)

  const audioFilters: string[] = []
  if (includeAudio && speed !== 1) audioFilters.push(`atempo=${speed.toFixed(3)}`)
  const volume = Math.max(0, Math.min(3, Number(edit.audioVolume) || 1))
  if (includeAudio && volume !== 1) audioFilters.push(`volume=${volume.toFixed(3)}`)
  if (includeAudio && fadeIn > 0) audioFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`)
  if (includeAudio && fadeOut > 0) audioFilters.push(`afade=t=out:st=${Math.max(0, editedDurationMs / 1000 - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`)
  if (request.format === 'mp3') {
    const bitrate = request.quality === 'compact' ? '96k' : request.quality === 'near-lossless' || request.quality === 'lossless' ? '320k' : '192k'
    if (graph.length || audioFilters.length) {
      const parts = [...graph, `[${audioSource}]${audioFilters.length ? audioFilters.join(',') : 'anull'}[aout]`]
      return [...common, '-vn', '-filter_complex', parts.join(';'), '-map', '[aout]', '-c:a', 'libmp3lame', '-b:a', bitrate, outputPath]
    }
    return [...common, '-vn', '-map', '0:a:0', ...(audioFilters.length ? ['-af', audioFilters.join(',')] : []), '-c:a', 'libmp3lame', '-b:a', bitrate, outputPath]
  }
  const graphParts = [...graph]
  if (videoFilters.length || includeAudio) {
    if (graph.length || audioFilters.length) {
      graphParts.push(`[${videoSource}]${videoFilters.length ? videoFilters.join(',') : 'null'}[vout]`)
      if (includeAudio) graphParts.push(`[${audioSource}]${audioFilters.length ? audioFilters.join(',') : 'anull'}[aout]`)
    }
  }
  // 没有分段裁剪/音轨滤镜时仍走简洁的 -vf 路径（保持既有行为，滤镜图只在需要时出现）
  const complex = graph.length > 0 || audioFilters.length > 0
  const filterArgs = complex
    ? ['-filter_complex', graphParts.join(';'), '-map', '[vout]', ...(includeAudio ? ['-map', '[aout]'] : ['-an'])]
    : [...(videoFilters.length ? ['-vf', videoFilters.join(',')] : []), ...(includeAudio ? ['-map', '0:v:0', '-map', '0:a:0?'] : ['-an'])]
  const subtitleArgs = request.subtitleFilePath
    ? ['-map', '1:0', '-c:s', request.format === 'mp4' ? 'mov_text' : 'webvtt', '-metadata:s:s:0', `language=${request.subtitle?.language === 'en' ? 'eng' : request.subtitle?.language === 'zh' ? 'zho' : 'und'}`]
    : []
  if (request.format === 'gif') {
    const fps = Math.max(8, Math.min(24, Number(request.outputFps) || request.fps || 15))
    const requestedWidth = Math.max(2, Math.min(1920, Math.round(Number(request.outputWidth) || request.width)))
    const maxWidth = Math.min(requestedWidth, request.quality === 'compact' ? 960 : request.quality === 'near-lossless' || request.quality === 'lossless' ? 1600 : 1280)
    const colors = request.quality === 'compact' ? 128 : 256
    const pre = videoFilters.length ? `${videoFilters.join(',')},` : ''
    const gifChain = `[${videoSource}]${pre}fps=${fps},scale=min(${maxWidth}\\,iw):-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle[gif]`
    const filter = [...graph, gifChain].join(';')
    return [...common, '-filter_complex', filter, '-map', '[gif]', '-loop', '0', outputPath]
  }

  if (request.format === 'mp4') {
    const crf = crfFor(request.quality)
    return [
      ...common,
      ...filterArgs,
      // 编码器由探测+实测决定：硬件明确更快才用硬件，否则软件编码（见 encoder-selection.ts）
      ...(encoder === 'libx264' && request.quality === 'compact'
        ? ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p']
        : videoEncoderArgs(encoder, crf)),
      '-movflags', '+faststart',
      ...(includeAudio ? ['-c:a', 'aac', '-b:a', request.quality === 'compact' ? '112k' : '192k'] : []),
      ...subtitleArgs,
      outputPath
    ]
  }

  if (request.quality === 'lossless') {
    return [
      ...common,
      ...filterArgs,
      '-c:v', 'libvpx-vp9',
      '-lossless', '1',
      '-row-mt', '1',
      '-deadline', 'good',
      '-cpu-used', '2',
      ...(includeAudio ? ['-c:a', 'libopus', '-b:a', '192k'] : []),
      ...subtitleArgs,
      outputPath
    ]
  }

  const crf = crfFor(request.quality)
  return [
    ...common,
    ...filterArgs,
    '-c:v', 'libvpx-vp9',
    '-crf', String(crf),
    '-b:v', '0',
    '-row-mt', '1',
    '-deadline', 'good',
    '-cpu-used', request.quality === 'compact' ? '3' : '2',
    ...(includeAudio ? ['-c:a', 'libopus', '-b:a', request.quality === 'compact' ? '96k' : '160k'] : []),
    ...subtitleArgs,
    outputPath
  ]
}

/**
 * 导出路径决策（纯函数，便于离线测试）。
 * - `copy`：源与目标同容器且无剪辑 → 原样保存（WebM→WebM 最常见）
 * - `remux`：源已是 H.264+MP4、目标 MP4 且无剪辑 → 视频流直接拷、音频转 AAC（实测 60 秒素材 1 秒）
 * - `encode`：跨容器、有剪辑、或输出为 GIF/MP3 → 走完整重编码
 */
export function recordingExportStrategy(
  request: RecordingExportRequest,
  source: 'mp4' | 'webm' | 'unknown'
): 'copy' | 'remux' | 'encode' {
  const format = request.format
  if (format !== 'mp4' && format !== 'webm') return 'encode'
  // 导出期运镜必须重新渲染画面（zoompan 滤镜），不能拷流
  if (request.motion?.frames?.length) return 'encode'
  const trimStart = Number(request.trimStartMs) || 0
  const trimEnd = Number(request.trimEndMs) || request.durationMs
  if (trimStart > 0 || trimEnd < request.durationMs) return 'encode'
  if (recordingHasEdits(request)) return 'encode'
  if (source === 'unknown') return 'encode'
  if (format !== source) return 'encode'
  return format === 'mp4' ? 'remux' : 'copy'
}

/**
 * 「无剪辑 · 直接封装」的最快路径：视频流原样拷贝，只把音频转成 AAC。
 *
 * 适用条件（由 `recordingExportStrategy` 判定）：没有剪辑/滤镜/字幕，源已经是 H.264 + MP4 容器。
 * 为什么值得单独开一条：实测 60 秒 1440p 素材走完整重编码要 18 秒，而只拷视频流 + 转音频是 **1 秒**
 * —— 差两个数量级，而且画质不二次损失。
 * 为什么音频要转：MediaRecorder 录进 MP4 的音轨是 **Opus**，Opus-in-MP4 在微信/剪映/Windows
 * 播放器上支持很差；转成 AAC 全部搞定，代价可忽略（音频重编码是流式的，不碰视频）。
 */
export function buildRecordingRemuxArgs(inputPath: string, outputPath: string, request: RecordingExportRequest): string[] {
  const includeAudio = request.hasAudio === true && request.edit?.muteAudio !== true
  return [
    '-y', '-hide_banner', '-nostats', '-progress', 'pipe:1',
    '-i', inputPath,
    '-map_metadata', '-1',
    '-map', '0:v:0',
    ...(includeAudio ? ['-map', '0:a:0?'] : ['-an']),
    '-c:v', 'copy',
    ...(includeAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags', '+faststart',
    outputPath
  ]
}

export function startRecordingFfmpeg(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  request: RecordingExportRequest,
  onProgress: (progress: number) => void,
  encoder: VideoEncoder = 'libx264'
): RecordingExportProcess {
  return startRecordingFfmpegWithArgs(
    ffmpegPath,
    buildRecordingFfmpegArgs(inputPath, outputPath, request, encoder),
    onProgress,
    recordingExportDurationMs(request)
  )
}

/** 用预先构造好的参数启动 FFmpeg（直通封装等旁路复用同一套进度/错误处理）。 */
export function startRecordingFfmpegWithArgs(
  ffmpegPath: string,
  args: string[],
  onProgress: (progress: number) => void,
  durationMs = 0
): RecordingExportProcess {
  const child = spawn(ffmpegPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let progressBuffer = ''
  let errorBuffer = ''
  const durationUs = Math.max(1, durationMs) * 1000

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    progressBuffer += chunk
    const lines = progressBuffer.split(/\r?\n/)
    progressBuffer = lines.pop() || ''
    for (const line of lines) {
      const match = /^(?:out_time_ms|out_time_us)=(\d+)/.exec(line.trim())
      if (match) onProgress(Math.max(0, Math.min(0.99, Number(match[1]) / durationUs)))
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    errorBuffer = (errorBuffer + chunk).slice(-4000)
  })

  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        onProgress(1)
        resolve()
      } else if (signal) {
        reject(new Error('导出已取消'))
      } else {
        const detail = errorBuffer.trim().split(/\r?\n/).slice(-6).join('\n')
        reject(new Error(detail || `FFmpeg 退出码 ${code ?? 'unknown'}`))
      }
    })
  })
  return { child, done }
}

/* ---------------- 视频编码器参数映射（纯函数：被 raw-node 测试直接加载，不能引入相对运行时导入） ---------------- */

export type VideoEncoder = 'libx264' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf'

/** CRF(x264) → 硬件编码器量化档的近似映射。硬件编码器没有逐帧码率控制；社区口径是同码率下
    需要多给 15–30% 码率才追平软件编码的感知质量，因此这里略偏保守（crf 22 → cq 23）。 */
export function hardwareQuantizerForCrf(crf: number): number {
  const value = Number(crf)
  // 非法输入回落到均衡档（23），而不是 0——0 在硬件编码器上等于"最高质量"，会意外产出超大文件
  if (!Number.isFinite(value)) return 23
  const clamped = Math.max(0, Math.min(51, Math.round(value)))
  return clamped === 0 ? 0 : Math.max(1, Math.min(51, clamped + 1))
}

/** 按目标编码器给出视频编码参数；软件路径保持原有语义（质量优先、码率由质量决定）。 */
export function videoEncoderArgs(encoder: VideoEncoder, crf: number): string[] {
  const quantizer = hardwareQuantizerForCrf(crf)
  if (encoder === 'h264_nvenc') {
    // -b:v 0 必须显式给：否则 -cq 会被码率上限覆盖而失效
    return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(quantizer), '-b:v', '0', '-pix_fmt', 'yuv420p']
  }
  if (encoder === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(quantizer), '-pix_fmt', 'nv12']
  }
  if (encoder === 'h264_amf') {
    return ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(quantizer), '-qp_p', String(quantizer), '-pix_fmt', 'yuv420p']
  }
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p']
}

/** 从 `ffmpeg -encoders` 输出里筛出本机编译进来的 H.264 硬件编码器（顺序即偏好）。 */
export function parseHardwareEncoders(listing: string): VideoEncoder[] {
  const found: VideoEncoder[] = []
  for (const encoder of ['h264_nvenc', 'h264_amf', 'h264_qsv'] as VideoEncoder[]) {
    if (new RegExp(`^\\s*\\S+\\s+${encoder}\\b`, 'm').test(listing)) found.push(encoder)
  }
  return found
}

/**
 * 从试编码结果里挑出值得采用的编码器：硬件必须**明确**快于软件基线（默认 1.15×）才切换。
 * 依据是本机实测：同一台机器上 h264_nvenc 快 2.76×（该用），而 h264_qsv 与软件持平甚至更慢（不该用），
 * 且 h264_amf 会出现在 `-encoders` 列表里但运行期 DLL 缺失——所以判定只能来自**试编码**，不能来自列表。
 */
export function pickFastestEncoder(
  trials: Array<{ encoder: VideoEncoder; ms: number; ok: boolean }>,
  threshold = 1.15
): VideoEncoder {
  const baseline = trials.find((trial) => trial.encoder === 'libx264' && trial.ok && trial.ms > 0)
  if (!baseline) return 'libx264'
  let best: { encoder: VideoEncoder; ms: number } | null = null
  for (const trial of trials) {
    if (!trial.ok || trial.encoder === 'libx264' || trial.ms <= 0) continue
    if (trial.ms * threshold < baseline.ms && (!best || trial.ms < best.ms)) best = { encoder: trial.encoder, ms: trial.ms }
  }
  return best?.encoder ?? 'libx264'
}


/* ---------------- 编码器探测与试编码（依赖注入 runner，便于离线测试选择逻辑） ---------------- */

export type EncoderRunner = (args: string[], timeoutMs: number) => Promise<{ code: number | null; output: string; ms: number }>

export const spawnEncoderRunner = (ffmpegPath: string): EncoderRunner => (args: string[], timeoutMs: number): Promise<{ code: number | null; output: string; ms: number }> =>
  new Promise((resolve) => {
    const started = Date.now()
    let output = ''
    let settled = false
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, output, ms: Date.now() - started })
    }
    const timer = setTimeout(() => { try { child.kill() } catch { /* 已退出 */ } finish(null) }, timeoutMs)
    child.stderr?.on('data', (chunk) => { output = (output + String(chunk)).slice(-8000) })
    child.once('error', () => finish(null))
    child.once('close', (code) => finish(code))
  })

/** 列出本机可用的 H.264 硬件编码器（探测失败返回空数组，调用方回退软件编码）。 */
export async function detectHardwareEncoders(ffmpegPath: string, runner: EncoderRunner = spawnEncoderRunner(ffmpegPath)): Promise<VideoEncoder[]> {
  const result = await runner(['-hide_banner', '-encoders'], 8_000)
  return result.code === 0 ? parseHardwareEncoders(result.output) : []
}

/**
 * 用一小段真实素材给候选编码器计时，返回**明确快于软件基线**的最快者；没有就保持 libx264。
 * 试编码输出到 null muxer，不落盘。整段逻辑有超时保护，任何异常都回退软件编码。
 */
export async function pickVideoEncoder(
  ffmpegPath: string,
  sourcePath: string,
  crf: number,
  options: { sampleMs?: number; speedupThreshold?: number; timeoutMs?: number } = {},
  // 依赖注入：测试用假 runner 直接验证选择逻辑，不必真的编码
  runner: EncoderRunner = spawnEncoderRunner(ffmpegPath)
): Promise<{ encoder: VideoEncoder; trials: Array<{ encoder: VideoEncoder; ms: number; ok: boolean }> }> {
  const sampleMs = Math.max(500, options.sampleMs ?? 2_000)
  const threshold = options.speedupThreshold ?? 1.15
  const timeoutMs = options.timeoutMs ?? 25_000
  const candidates = await detectHardwareEncoders(ffmpegPath, runner)
  const trials: Array<{ encoder: VideoEncoder; ms: number; ok: boolean }> = []
  if (!candidates.length) return { encoder: 'libx264', trials }

  const trial = async (encoder: VideoEncoder): Promise<number | null> => {
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-t', (sampleMs / 1000).toFixed(3), '-i', sourcePath,
      '-an', ...videoEncoderArgs(encoder, crf), '-f', 'null', '-'
    ]
    const result = await runner(args, timeoutMs)
    const ok = result.code === 0 && result.ms > 0
    trials.push({ encoder, ms: result.ms, ok })
    return ok ? result.ms : null
  }

  const baseline = await trial('libx264')
  if (baseline === null) return { encoder: 'libx264', trials }
  for (const encoder of candidates) await trial(encoder)
  return { encoder: pickFastestEncoder(trials, threshold), trials }
}

/**
 * 进程内缓存的编码器选取器：第一次导出付一次试编码成本，之后复用同一个决定。
 * 刻意不落盘持久化——GPU 状态（外接显卡、驱动更新、被其它程序独占）会变，
 * 每次启动重新实测比"记住一个可能已经过期的结论"更可靠。
 */
export function createEncoderPicker(ffmpegPath: string, runner?: EncoderRunner): (sourcePath: string, crf: number) => Promise<VideoEncoder> {
  let cached: VideoEncoder | null = null
  let pending: Promise<VideoEncoder> | null = null
  return async (sourcePath: string, crf: number) => {
    if (cached) return cached
    if (!pending) {
      pending = pickVideoEncoder(ffmpegPath, sourcePath, crf, {}, runner)
        .then((result) => result.encoder)
        .catch(() => 'libx264' as VideoEncoder)
        .then((encoder) => { cached = encoder; pending = null; return encoder })
    }
    return pending
  }
}
