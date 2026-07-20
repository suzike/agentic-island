import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { RecordingExportRequest } from '../shared/protocol'

export interface RecordingExportProcess {
  child: ChildProcessByStdio<null, Readable, Readable>
  done: Promise<void>
}

const crfFor = (quality: RecordingExportRequest['quality']): number => {
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

export function buildRecordingFfmpegArgs(inputPath: string, outputPath: string, request: RecordingExportRequest): string[] {
  const trimStart = Math.max(0, Math.min(request.durationMs, Number(request.trimStartMs) || 0))
  const trimEnd = Math.max(trimStart + 1, Math.min(request.durationMs, Number(request.trimEndMs) || request.durationMs))
  const edit = request.edit || {}
  const segments = normalizedSegments(request)
  const speed = Math.max(0.5, Math.min(2, Number(edit.speed) || 1))
  const editedDurationMs = recordingExportDurationMs(request)
  const hasSegmentFilter = segments.length > 0
  const common = [
    '-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i', inputPath,
    ...(request.subtitleFilePath && request.format !== 'gif' && request.format !== 'mp3' ? ['-i', request.subtitleFilePath] : []),
    ...(!hasSegmentFilter && trimStart > 0 ? ['-ss', (trimStart / 1000).toFixed(3)] : []),
    ...(!hasSegmentFilter && (trimStart > 0 || trimEnd < request.durationMs) ? ['-t', ((trimEnd - trimStart) / 1000).toFixed(3)] : []),
    '-map_metadata', '-1'
  ]
  const videoFilters: string[] = []
  if (hasSegmentFilter) {
    const selection = segments.map((segment) => `between(t\\,${(segment.startMs / 1000).toFixed(3)}\\,${(segment.endMs / 1000).toFixed(3)})`).join('+')
    videoFilters.push(`select='${selection}'`, `setpts=N/(FRAME_RATE*${speed.toFixed(3)}*TB)`)
  } else if (speed !== 1) {
    videoFilters.push(`setpts=PTS/${speed.toFixed(3)}`)
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
    if (outputWidth < request.width || outputHeight < request.height) videoFilters.push(`scale=w=${outputWidth}:h=${outputHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`)
    const outputFps = Math.max(1, Math.min(120, Math.round(Number(request.outputFps) || request.fps)))
    if (outputFps !== request.fps) videoFilters.push(`fps=${outputFps}`)
  }
  const fadeIn = Math.min(editedDurationMs / 2, Math.max(0, Number(edit.fadeInMs) || 0)) / 1000
  const fadeOut = Math.min(editedDurationMs / 2, Math.max(0, Number(edit.fadeOutMs) || 0)) / 1000
  if (fadeIn > 0) videoFilters.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`)
  if (fadeOut > 0) videoFilters.push(`fade=t=out:st=${Math.max(0, editedDurationMs / 1000 - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`)

  const includeAudio = request.hasAudio === true && edit.muteAudio !== true && request.format !== 'gif'
  const audioFilters: string[] = []
  if (includeAudio && hasSegmentFilter) {
    const selection = segments.map((segment) => `between(t\\,${(segment.startMs / 1000).toFixed(3)}\\,${(segment.endMs / 1000).toFixed(3)})`).join('+')
    audioFilters.push(`aselect='${selection}'`, 'asetpts=N/SR/TB')
  }
  if (includeAudio && speed !== 1) audioFilters.push(`atempo=${speed.toFixed(3)}`)
  const volume = Math.max(0, Math.min(3, Number(edit.audioVolume) || 1))
  if (includeAudio && volume !== 1) audioFilters.push(`volume=${volume.toFixed(3)}`)
  if (includeAudio && fadeIn > 0) audioFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`)
  if (includeAudio && fadeOut > 0) audioFilters.push(`afade=t=out:st=${Math.max(0, editedDurationMs / 1000 - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`)
  if (request.format === 'mp3') {
    const bitrate = request.quality === 'compact' ? '96k' : request.quality === 'near-lossless' || request.quality === 'lossless' ? '320k' : '192k'
    return [...common, '-vn', '-map', '0:a:0', ...(audioFilters.length ? ['-af', audioFilters.join(',')] : []), '-c:a', 'libmp3lame', '-b:a', bitrate, outputPath]
  }
  const complex = hasSegmentFilter || audioFilters.length > 0
  const filterArgs = complex
    ? ['-filter_complex', `[0:v]${videoFilters.length ? videoFilters.join(',') : 'null'}[vout]${includeAudio ? `;[0:a]${audioFilters.length ? audioFilters.join(',') : 'anull'}[aout]` : ''}`, '-map', '[vout]', ...(includeAudio ? ['-map', '[aout]'] : ['-an'])]
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
    const filter = `[0:v]${pre}fps=${fps},scale=min(${maxWidth}\\,iw):-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle[gif]`
    return [...common, '-filter_complex', filter, '-map', '[gif]', '-loop', '0', outputPath]
  }

  if (request.format === 'mp4') {
    const crf = crfFor(request.quality)
    return [
      ...common,
      ...filterArgs,
      '-c:v', 'libx264',
      '-preset', request.quality === 'compact' ? 'slow' : 'medium',
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
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

export function startRecordingFfmpeg(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  request: RecordingExportRequest,
  onProgress: (progress: number) => void
): RecordingExportProcess {
  const child = spawn(ffmpegPath, buildRecordingFfmpegArgs(inputPath, outputPath, request), {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let progressBuffer = ''
  let errorBuffer = ''
  const durationUs = recordingExportDurationMs(request) * 1000

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
