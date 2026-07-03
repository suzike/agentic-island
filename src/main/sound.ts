// 提示音（主进程播放）：合成 WAV 写入临时文件，用 Windows 原生 SoundPlayer 播放。
// 完全绕开 Chromium 渲染进程音频（透明置顶无焦点窗口里渲染进程音频不可靠）。

import { app } from 'electron'
import { writeFileSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'

interface Def {
  key: string
  notes: number[]
  type: 'sine' | 'square' | 'triangle' | 'sawtooth'
  gap: number
  dur: number
}

const DEFS: Def[] = [
  { key: 'chime', notes: [660, 880, 1320], type: 'sine', gap: 0.1, dur: 0.16 },
  { key: 'blip', notes: [523, 784], type: 'square', gap: 0.07, dur: 0.09 },
  { key: 'ping', notes: [1046], type: 'triangle', gap: 0, dur: 0.22 },
  { key: 'marimba', notes: [587, 880], type: 'sine', gap: 0.12, dur: 0.24 },
  { key: 'alert', notes: [880, 740, 880], type: 'sawtooth', gap: 0.09, dur: 0.11 },
  { key: 'crystal', notes: [1318, 1568, 2093], type: 'sine', gap: 0.08, dur: 0.13 },
  { key: 'harp', notes: [1046, 880, 660, 523], type: 'sine', gap: 0.05, dur: 0.13 },
  { key: 'pulse', notes: [392, 392], type: 'square', gap: 0.12, dur: 0.1 },
  { key: 'knock', notes: [220, 180], type: 'triangle', gap: 0.1, dur: 0.13 },
  { key: 'rising', notes: [523, 659, 784, 1046], type: 'sawtooth', gap: 0.035, dur: 0.08 },
  { key: 'soft', notes: [440], type: 'sine', gap: 0, dur: 0.32 }
]

const SR = 44100

const wave = (type: Def['type'], p: number): number => {
  if (type === 'square') return p < 0.5 ? 1 : -1
  if (type === 'sawtooth') return 2 * p - 1
  if (type === 'triangle') return p < 0.5 ? 4 * p - 1 : 3 - 4 * p
  return Math.sin(2 * Math.PI * p)
}

function synthWav(def: Def): Buffer {
  const seg: number[] = []
  def.notes.forEach((f) => {
    const n = Math.floor(SR * def.dur)
    for (let s = 0; s < n; s++) {
      const t = s / SR
      const env = Math.min(1, s / (SR * 0.008)) * Math.max(0, 1 - s / n)
      seg.push(wave(def.type, (t * f) % 1) * env * 0.5)
    }
    const g = Math.floor(SR * def.gap)
    for (let s = 0; s < g; s++) seg.push(0)
  })
  const buf = Buffer.alloc(44 + seg.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + seg.length * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(seg.length * 2, 40)
  for (let i = 0; i < seg.length; i++) {
    const c = Math.max(-1, Math.min(1, seg[i]))
    buf.writeInt16LE(Math.round(c < 0 ? c * 0x8000 : c * 0x7fff), 44 + i * 2)
  }
  return buf
}

const wavPath = (key: string): string => join(app.getPath('temp'), `aiisland-${key}.wav`)

function ensureWav(key: string): string | null {
  const def = DEFS.find((d) => d.key === key) || DEFS[0]
  const p = wavPath(def.key)
  try {
    if (!existsSync(p)) writeFileSync(p, synthWav(def))
    return p
  } catch {
    return null
  }
}

const LOG = join(homedir(), '.agentic-island', 'sound.log')
const log = (msg: string): void => {
  try { appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`) } catch { /* */ }
}

export function playSound(key: string): void {
  if (process.platform !== 'win32') return
  const p = ensureWav(key)
  if (!p) { log(`ensureWav failed key=${key}`); return }
  // PlaySync 在这个短命 powershell 进程内阻塞播放完再退出；出错写日志便于排查
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `(New-Object System.Media.SoundPlayer '${p}').PlaySync()`],
    { windowsHide: true, timeout: 8000 },
    (err) => { if (err) log(`play err key=${key}: ${String(err).slice(0, 200)}`) }
  )
  log(`play requested key=${key}`)
}
