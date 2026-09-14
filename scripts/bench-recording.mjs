// 录屏导出基准：对同一段真实素材分别跑「直通封装 / 软件编码 / 各硬件编码器」，
// 输出耗时与体积，用来给"要不要用硬件编码"提供本机数据（而不是靠猜）。
//
// 用法：
//   node scripts/bench-recording.mjs [--input <素材路径>] [--duration 30] [--width 1920] [--crf 22]
//   不带 --input 时自动取 <userData>/recordings 下最新的媒体文件。
//
// 注意：参数完全复用应用自身的构造逻辑（buildRecordingFfmpegArgs / videoEncoderArgs），
// 保证"量到的就是应用实际会跑的"。

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildRecordingFfmpegArgs, parseHardwareEncoders, videoEncoderArgs } from '../src/main/recording-export.ts'

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const durationSec = Number(argValue('duration', '30'))
const width = Number(argValue('width', '1920'))
const crf = Number(argValue('crf', '22'))
const ffmpeg = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')

const defaultRoot = join(process.env.APPDATA || '', 'Agentic-Island', 'recordings')
const findNewest = (dir) => {
  if (!existsSync(dir)) return ''
  return readdirSync(dir)
    .filter((name) => /\.(mp4|webm|mkv)$/i.test(name))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || ''
}
const input = argValue('input', findNewest(defaultRoot))
if (!input || !existsSync(input)) {
  console.error('找不到素材：请用 --input 指定一个录屏文件')
  process.exit(1)
}
const sizeMb = (statSync(input).size / 1048576).toFixed(1)
console.log(`素材: ${input}（${sizeMb} MB）`)
console.log(`基准参数: 前 ${durationSec}s · ${width} 宽 · crf ${crf}\n`)

const timeRun = (label, ffmpegArgs) => {
  const started = Date.now()
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...ffmpegArgs], { encoding: 'utf8', windowsHide: true })
  const ms = Date.now() - started
  const ok = result.status === 0
  return { label, ms, ok, detail: ok ? '' : (result.stderr || '').trim().split('\n').slice(-2).join(' | ').slice(0, 160) }
}

const listing = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true }).stdout || ''
const hardware = parseHardwareEncoders(listing)

// ① 直通封装（无剪辑路径）：视频流 copy、音频转 AAC
const remuxOut = join(process.env.TEMP || '.', 'bench-remux.mp4')
const remux = timeRun('直通封装（-c:v copy + AAC）', [
  '-y', '-t', String(durationSec), '-i', input, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', remuxOut
])

// ② 软件编码（当前默认）与 ③ 各硬件编码器：都走应用自身的参数构造
const rows = [remux]
const baseRequest = {
  jobId: 'bench', name: 'bench', format: 'mp4', quality: 'balanced', durationMs: Math.round(durationSec * 1000),
  width, height: Math.round(width * 9 / 16), fps: 30, hasAudio: true,
  outputWidth: width, outputHeight: Math.round(width * 9 / 16), outputFps: 30
}
const encode = (encoder) => {
  const out = join(process.env.TEMP || '.', `bench-${encoder}.mp4`)
  const ffmpegArgs = [
    ...buildRecordingFfmpegArgs(input, out, { ...baseRequest, outputWidth: width, outputHeight: Math.round(width * 9 / 16) }, encoder)
  ]
  // 限制到基准时长：插到 -i 之前的输入参数区（-ss 已在其中时不再重复）
  const inputIndex = ffmpegArgs.indexOf('-i')
  ffmpegArgs.splice(inputIndex, 0, '-t', String(durationSec))
  return timeRun(encoder === 'libx264' ? '软件编码 libx264 medium' : `硬件编码 ${encoder}`, ffmpegArgs)
}

rows.push(encode('libx264'))
for (const encoder of hardware) rows.push(encode(encoder))

console.log('耗时排序（越小越快）：')
for (const row of rows.slice().sort((a, b) => a.ms - b.ms)) {
  console.log(`  ${String(row.ms / 1000).padStart(7)}s  ${row.ok ? '成功' : '失败'}  ${row.label}${row.detail ? `  ← ${row.detail}` : ''}`)
}

const baseline = rows.find((row) => row.label.includes('libx264'))
const bestHardware = rows.filter((row) => row.label.includes('硬件') && row.ok).sort((a, b) => a.ms - b.ms)[0]
console.log('')
if (!baseline?.ok) {
  console.log('软件编码失败，无法比较（请检查素材是否可解码）')
} else if (!bestHardware || bestHardware.ms * 1.15 >= baseline.ms) {
  console.log(`结论：保持软件编码。最快的硬件编码（${bestHardware?.label || '无'}）没有明显快于 libx264（要求至少快 15%）。`)
} else {
  console.log(`结论：${bestHardware.label} 快 ${(baseline.ms / bestHardware.ms).toFixed(2)}× → 应用会自动选它（编码器选择需要 ≥1.15× 才切换）。`)
}
console.log(`\n对比参考：直通封装 ${(remux.ms / 1000).toFixed(1)}s vs 软件编码 ${baseline ? (baseline.ms / 1000).toFixed(1) : '-'}s`)
