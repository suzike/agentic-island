import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRecordingFfmpeg } from '../src/main/recording-export.ts'
import type { RecordingExportRequest } from '../src/shared/protocol.ts'

const ffmpeg = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const root = await mkdtemp(join(tmpdir(), 'recording-export-e2e-'))
try {
  const source = join(root, 'source.mp4')
  const generated = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source], { windowsHide: true, encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr || '生成测试视频失败')

  const subtitle = join(root, 'subtitle.srt')
  await writeFile(subtitle, '1\n00:00:00,250 --> 00:00:01,500\n真实字幕验证\n', 'utf8')
  const base: RecordingExportRequest = { jobId: 'e2e-video', name: 'e2e', format: 'mp4', quality: 'compact', durationMs: 3_000, width: 640, height: 360, fps: 30, hasAudio: true, outputWidth: 320, outputHeight: 180, outputFps: 24, subtitleFilePath: subtitle, subtitle: { mode: 'embedded', language: 'zh', segments: [{ startMs: 250, endMs: 1_500, text: '真实字幕验证' }] } }
  const videoOutput = join(root, 'delivery.mp4')
  let videoProgress = 0
  const video = startRecordingFfmpeg(ffmpeg, source, videoOutput, base, (value) => { videoProgress = value })
  await video.done
  assert.equal(videoProgress, 1, '视频导出进度完成')
  assert.ok((await stat(videoOutput)).size > 10_000, '生成有效 MP4 文件')

  const extracted = join(root, 'extracted.srt')
  const subtitleResult = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoOutput, '-map', '0:s:0', extracted], { windowsHide: true, encoding: 'utf8' })
  assert.equal(subtitleResult.status, 0, subtitleResult.stderr || '提取内嵌字幕失败')
  assert.match(await readFile(extracted, 'utf8'), /真实字幕验证/, 'MP4 包含可开关字幕轨')

  const audioOutput = join(root, 'delivery.mp3')
  const audio = startRecordingFfmpeg(ffmpeg, source, audioOutput, { ...base, jobId: 'e2e-audio', format: 'mp3', quality: 'near-lossless', subtitleFilePath: undefined }, () => {})
  await audio.done
  assert.ok((await stat(audioOutput)).size > 20_000, '生成有效 MP3 文件')
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', audioOutput, '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' })
  assert.equal(decoded.status, 0, decoded.stderr || 'MP3 解码验证失败')
  console.log('recording export e2e tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
