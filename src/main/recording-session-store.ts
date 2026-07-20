import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RecordingSessionCreateInput, RecordingSessionManifest } from '../shared/protocol'

const safeName = (value: unknown): string => String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'recording'
const positiveInteger = (value: unknown, fallback: number): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(1, Math.round(number)) : fallback
}

export class RecordingSessionStore {
  private readonly root: string
  private manifests = new Map<string, RecordingSessionManifest>()
  private queues = new Map<string, Promise<void>>()

  constructor(root: string) { this.root = root }

  private manifestPath(id: string): string { return join(this.root, `${id}.json`) }
  private mediaPath(manifest: RecordingSessionManifest): string { return join(this.root, manifest.fileName) }

  private async persist(manifest: RecordingSessionManifest): Promise<void> {
    const target = this.manifestPath(manifest.id)
    const temporary = `${target}.tmp`
    await writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8')
    await rename(temporary, target)
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const files = await readdir(this.root).catch(() => [])
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      try {
        const manifest = JSON.parse(await readFile(join(this.root, file), 'utf8')) as RecordingSessionManifest
        if (!manifest.id || !manifest.fileName) continue
        const media = await stat(this.mediaPath(manifest)).catch(() => null)
        if (!media?.isFile()) continue
        manifest.bytes = media.size
        if (manifest.status === 'recording') manifest.status = 'interrupted'
        this.manifests.set(manifest.id, manifest)
        await this.persist(manifest)
      } catch { /* ignore corrupt recovery entries */ }
    }
  }

  async create(input: RecordingSessionCreateInput): Promise<RecordingSessionManifest> {
    await mkdir(this.root, { recursive: true })
    const id = `recording-${Date.now()}-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const manifest: RecordingSessionManifest = {
      id,
      name: safeName(input.name),
      mimeType: String(input.mimeType || 'video/webm').slice(0, 160),
      sourceName: String(input.sourceName || '未知来源').slice(0, 200),
      sourceKind: input.sourceKind === 'window' ? 'window' : 'screen',
      width: Math.max(2, positiveInteger(input.width, 1920)),
      height: Math.max(2, positiveInteger(input.height, 1080)),
      fps: Math.min(240, positiveInteger(input.fps, 30)),
      hasAudio: Boolean(input.hasAudio),
      status: 'recording',
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      bytes: 0,
      chunks: 0,
      fileName: `${id}.webm.part`
    }
    const mediaPath = this.mediaPath(manifest)
    await writeFile(mediaPath, new Uint8Array())
    try {
      await this.persist(manifest)
    } catch (error) {
      await Promise.all([
        rm(mediaPath, { force: true }),
        rm(this.manifestPath(id), { force: true }),
        rm(`${this.manifestPath(id)}.tmp`, { recursive: true, force: true })
      ]).catch(() => {})
      throw error
    }
    this.manifests.set(id, manifest)
    return { ...manifest }
  }

  async append(id: string, chunkIndex: number, data: ArrayBuffer | Uint8Array): Promise<RecordingSessionManifest> {
    const manifest = this.manifests.get(id)
    if (!manifest || manifest.status !== 'recording') throw new Error('录制会话不存在或已结束')
    if (chunkIndex !== manifest.chunks) throw new Error(`录制分片顺序异常：期望 ${manifest.chunks}，收到 ${chunkIndex}`)
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    if (!bytes.byteLength) return { ...manifest }
    if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('单个录制分片超过 128MB')
    const previous = this.queues.get(id) || Promise.resolve()
    const next = previous.then(async () => {
      await appendFile(this.mediaPath(manifest), bytes)
      manifest.bytes += bytes.byteLength
      manifest.chunks++
      manifest.updatedAt = Date.now()
      if (manifest.chunks % 5 === 0) await this.persist(manifest)
    })
    this.queues.set(id, next)
    try { await next } finally { if (this.queues.get(id) === next) this.queues.delete(id) }
    return { ...manifest }
  }

  async finalize(id: string, durationMs: number): Promise<{ manifest: RecordingSessionManifest; filePath: string }> {
    const manifest = this.manifests.get(id)
    if (!manifest) throw new Error('录制会话不存在')
    await this.queues.get(id)
    const previous = { ...manifest }
    const currentPath = this.mediaPath(previous)
    const finalName = previous.fileName.endsWith('.part') ? previous.fileName.slice(0, -5) : previous.fileName
    const finalPath = join(this.root, finalName)
    const needsRename = currentPath !== finalPath
    if (needsRename) await rename(currentPath, finalPath)
    try {
      const next: RecordingSessionManifest = {
        ...previous,
        fileName: finalName,
        durationMs: Math.max(0, Number(durationMs) || previous.durationMs),
        status: 'ready',
        updatedAt: Date.now(),
        bytes: (await stat(finalPath)).size
      }
      await this.persist(next)
      this.manifests.set(id, next)
      return { manifest: { ...next }, filePath: finalPath }
    } catch (error) {
      if (needsRename) await rename(finalPath, currentPath).catch(() => {})
      throw error
    }
  }

  async recover(id: string): Promise<{ manifest: RecordingSessionManifest; filePath: string }> {
    const manifest = this.manifests.get(id)
    if (!manifest) throw new Error('恢复记录不存在')
    return this.finalize(id, manifest.durationMs)
  }

  list(): RecordingSessionManifest[] {
    return [...this.manifests.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((manifest) => ({ ...manifest }))
  }

  getFile(id: string): { manifest: RecordingSessionManifest; filePath: string } | null {
    const manifest = this.manifests.get(id)
    return manifest ? { manifest: { ...manifest }, filePath: this.mediaPath(manifest) } : null
  }

  async discard(id: string): Promise<void> {
    const manifest = this.manifests.get(id)
    if (!manifest) return
    await this.queues.get(id)?.catch(() => {})
    this.manifests.delete(id)
    this.queues.delete(id)
    await Promise.all([
      rm(this.mediaPath(manifest), { force: true }),
      rm(this.manifestPath(id), { force: true }),
      rm(`${this.manifestPath(id)}.tmp`, { force: true })
    ])
  }
}
