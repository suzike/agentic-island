import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RecordingProjectDocument, RecordingProjectSaveInput, RecordingProjectSummary } from '../shared/protocol'

const MAX_PROJECT_BYTES = 8 * 1024 * 1024
const safeText = (value: unknown, limit: number): string => String(value || '').trim().slice(0, limit)
const finite = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback
const clamp = (value: unknown, min: number, max: number, fallback = min): number => Math.min(max, Math.max(min, finite(value, fallback)))

export class RecordingProjectStore {
  private readonly root: string
  private projects = new Map<string, RecordingProjectDocument>()

  constructor(root: string) { this.root = root }

  private projectPath(id: string): string { return join(this.root, `${id}.json`) }

  private async persist(project: RecordingProjectDocument): Promise<void> {
    const body = JSON.stringify(project, null, 2)
    if (Buffer.byteLength(body, 'utf8') > MAX_PROJECT_BYTES) throw new Error('录屏工程超过 8MB，请清理过长的 AI 结果后重试')
    const target = this.projectPath(project.id)
    const temporary = `${target}.tmp`
    await writeFile(temporary, body, 'utf8')
    await rename(temporary, target)
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const files = await readdir(this.root).catch(() => [])
    for (const file of files.filter((name) => name.startsWith('project-') && name.endsWith('.json'))) {
      try {
        const project = JSON.parse(await readFile(join(this.root, file), 'utf8')) as RecordingProjectDocument
        if (project.schema !== 'agentic-island-recording-project/v2' || !project.id || !project.sessionId) continue
        this.projects.set(project.id, project)
      } catch { /* ignore damaged project files without blocking app startup */ }
    }
  }

  async save(input: RecordingProjectSaveInput): Promise<RecordingProjectDocument> {
    const sessionId = safeText(input.sessionId, 160)
    if (!sessionId) throw new Error('录屏工程缺少素材会话')
    const previous = input.id ? this.projects.get(input.id) : undefined
    const id = previous?.id || `project-${Date.now()}-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const durationMs = clamp(input.durationMs, 0, 7 * 24 * 60 * 60 * 1000)
    const segments = (input.edit?.segments || []).slice(0, 200).map((segment, index) => ({
      id: safeText(segment.id, 120) || `segment-${index + 1}`,
      startMs: clamp(segment.startMs, 0, durationMs),
      endMs: clamp(segment.endMs, 0, durationMs),
      enabled: segment.enabled !== false,
      label: safeText(segment.label, 120)
    })).filter((segment) => segment.endMs > segment.startMs)
    const project: RecordingProjectDocument = {
      schema: 'agentic-island-recording-project/v2',
      id,
      sessionId,
      name: safeText(input.name, 100) || '未命名录屏工程',
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      source: input.source ? { name: safeText(input.source.name, 200), kind: input.source.kind === 'window' ? 'window' : 'screen', displayId: safeText(input.source.displayId, 100) || undefined } : null,
      durationMs,
      size: { width: Math.round(clamp(input.size?.width, 2, 16384, 1920)), height: Math.round(clamp(input.size?.height, 2, 16384, 1080)) },
      fps: Math.round(clamp(input.fps, 1, 240, 30)),
      hasAudio: Boolean(input.hasAudio),
      edit: { ...input.edit, speed: clamp(input.edit?.speed, 0.1, 8, 1), segments },
      timeline: (input.timeline || []).slice(0, 500).map((item) => ({ at: clamp(item.at, 0, durationMs), type: item.type, label: safeText(item.label, 160) })),
      transcript: {
        model: safeText(input.transcript?.model, 120) || 'whisper-1',
        language: input.transcript?.language === 'zh' || input.transcript?.language === 'en' ? input.transcript.language : 'auto',
        segments: (input.transcript?.segments || []).slice(0, 20_000).map((item) => ({ startMs: clamp(item.startMs, 0, durationMs), endMs: clamp(item.endMs, 0, durationMs), text: safeText(item.text, 2000) })).filter((item) => item.text && item.endMs >= item.startMs)
      },
      workspace: {
        timelineZoom: clamp(input.workspace?.timelineZoom, 0.5, 8, 1),
        timelineSnap: input.workspace?.timelineSnap !== false,
        videoTrackLocked: Boolean(input.workspace?.videoTrackLocked),
        markerTrackLocked: Boolean(input.workspace?.markerTrackLocked),
        aiEditMode: input.workspace?.aiEditMode === 'tutorial' || input.workspace?.aiEditMode === 'dynamic' ? input.workspace.aiEditMode : 'conservative'
      },
      aiResults: (input.aiResults || []).slice(0, 80).map((item) => ({ id: finite(item.id, now), label: safeText(item.label, 120), text: safeText(item.text, 20_000), error: Boolean(item.error) }))
    }
    await this.persist(project)
    this.projects.set(id, project)
    return structuredClone(project)
  }

  list(): RecordingProjectSummary[] {
    return [...this.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((project) => ({
      id: project.id,
      sessionId: project.sessionId,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      durationMs: project.durationMs,
      width: project.size.width,
      height: project.size.height,
      hasAudio: project.hasAudio,
      segmentCount: project.edit.segments.length,
      transcriptCount: project.transcript.segments.length
    }))
  }

  load(id: string): RecordingProjectDocument | null {
    const project = this.projects.get(id)
    return project ? structuredClone(project) : null
  }

  async duplicate(id: string): Promise<RecordingProjectDocument> {
    const source = this.projects.get(id)
    if (!source) throw new Error('录屏工程不存在')
    return this.save({ ...structuredClone(source), id: undefined, name: `${source.name} 副本` })
  }

  async delete(id: string): Promise<void> {
    await Promise.all([rm(this.projectPath(id), { force: true }), rm(`${this.projectPath(id)}.tmp`, { force: true })])
    this.projects.delete(id)
  }

  async deleteBySession(sessionId: string): Promise<void> {
    const ids = [...this.projects.values()].filter((project) => project.sessionId === sessionId).map((project) => project.id)
    await Promise.all(ids.map((id) => this.delete(id)))
  }
}
