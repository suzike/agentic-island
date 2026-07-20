import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LlmRequestConfig, RecordingTranscriptSegment } from '../shared/protocol'
import { netFetch } from './http-client'

const transcriptionUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`

const runFfmpeg = (executable: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let error = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { error = (error + chunk).slice(-4000) })
  child.once('error', reject)
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(error.trim().split(/\r?\n/).slice(-6).join('\n') || `FFmpeg 退出码 ${code ?? 'unknown'}`)))
})

export async function transcribeRecordingFile(
  ffmpegPath: string,
  inputPath: string,
  cfg: LlmRequestConfig,
  model = 'whisper-1',
  language = 'auto'
): Promise<{ ok: boolean; text?: string; segments?: RecordingTranscriptSegment[]; error?: string }> {
  if (!cfg.baseUrl || !/^https?:\/\//i.test(cfg.baseUrl)) return { ok: false, error: '转写 Base URL 无效' }
  if (!cfg.apiKey) return { ok: false, error: 'API Key 未配置' }
  const transcriptionModel = String(model || 'whisper-1').trim().slice(0, 120)
  const dir = await mkdtemp(join(tmpdir(), 'agentic-island-transcription-'))
  try {
    const pattern = join(dir, 'audio-%03d.mp3')
    await runFfmpeg(ffmpegPath, ['-y', '-hide_banner', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'segment', '-segment_time', '1200', '-reset_timestamps', '1', pattern])
    const files = (await readdir(dir)).filter((file) => /^audio-\d+\.mp3$/i.test(file)).sort().slice(0, 24)
    if (!files.length) return { ok: false, error: '录制中没有可转写的音轨' }
    const segments: RecordingTranscriptSegment[] = []
    const texts: string[] = []
    for (let index = 0; index < files.length; index++) {
      const file = join(dir, files[index])
      const bytes = await readFile(file)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }), basename(file))
      form.append('model', transcriptionModel)
      form.append('response_format', 'verbose_json')
      if (language === 'zh' || language === 'en') form.append('language', language)
      const response = await netFetch(transcriptionUrl(cfg.baseUrl), { method: 'POST', timeoutMs: 240_000, headers: { authorization: `Bearer ${cfg.apiKey}` }, body: form })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        return { ok: false, error: `音频转写 HTTP ${response.status} · ${transcriptionModel} · ${detail.slice(0, 240)}` }
      }
      const data = await response.json() as { text?: string; segments?: Array<{ start?: number; end?: number; text?: string }> }
      const offsetMs = index * 1_200_000
      const chunkText = String(data.text || '').trim()
      if (chunkText) texts.push(chunkText)
      if (Array.isArray(data.segments) && data.segments.length) {
        for (const segment of data.segments.slice(0, 5000)) {
          const text = String(segment.text || '').trim()
          if (!text) continue
          const startMs = offsetMs + Math.max(0, Number(segment.start) || 0) * 1000
          const endMs = offsetMs + Math.max(Number(segment.start) || 0, Number(segment.end) || 0) * 1000
          segments.push({ startMs, endMs: Math.max(startMs + 1, endMs), text })
        }
      } else if (chunkText) {
        segments.push({ startMs: offsetMs, endMs: offsetMs + 1_200_000, text: chunkText })
      }
    }
    return { ok: true, text: texts.join('\n'), segments }
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {})
  }
}
