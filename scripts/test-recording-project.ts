import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingProjectStore } from '../src/main/recording-project-store.ts'
import type { RecordingProjectSaveInput } from '../src/shared/protocol.ts'

const root = await mkdtemp(join(tmpdir(), 'recording-project-test-'))
try {
  const store = new RecordingProjectStore(root)
  await store.initialize()
  const input: RecordingProjectSaveInput = {
    schema: 'agentic-island-recording-project/v2',
    sessionId: 'recording-test-session',
    name: '教程工程',
    source: { name: '显示器 1', kind: 'screen', displayId: '1' },
    durationMs: 60_000,
    size: { width: 1920, height: 1080 },
    fps: 30,
    hasAudio: true,
    edit: {
      speed: 1.25,
      contrast: 1.1,
      segments: [
        { id: 'a', startMs: 0, endMs: 15_000, enabled: true, label: '开场' },
        { id: 'invalid', startMs: 30_000, endMs: 20_000, enabled: true, label: '无效段' }
      ]
    },
    timeline: [{ at: 1_000, type: 'marker', label: '介绍' }],
    transcript: { model: 'whisper-1', language: 'zh', segments: [{ startMs: 250, endMs: 1_500, text: '测试字幕' }] },
    workspace: { timelineZoom: 1.8, timelineSnap: true, videoTrackLocked: false, markerTrackLocked: true, aiEditMode: 'tutorial' },
    aiResults: [{ id: 1, label: '摘要', text: '工程摘要' }]
  }

  const created = await store.save(input)
  assert.match(created.id, /^project-/, '创建稳定工程 ID')
  assert.equal(created.edit.segments.length, 1, '丢弃结束时间早于开始时间的无效片段')
  assert.equal(store.list()[0].transcriptCount, 1, '摘要包含字幕数量')

  const updated = await store.save({ ...input, id: created.id, name: '教程工程 v2' })
  assert.equal(updated.id, created.id, '更新工程不会创建重复记录')
  assert.equal(updated.createdAt, created.createdAt, '更新保留创建时间')

  await mkdir(join(root, `${created.id}.json.tmp`))
  await assert.rejects(() => store.save({ ...input, id: created.id, name: '不应进入内存' }), '磁盘提交失败会向调用方返回错误')
  assert.equal(store.load(created.id)?.name, '教程工程 v2', '磁盘提交失败不会污染内存中的已保存版本')
  await rm(join(root, `${created.id}.json.tmp`), { recursive: true, force: true })

  const restarted = new RecordingProjectStore(root)
  await restarted.initialize()
  assert.equal(restarted.load(created.id)?.name, '教程工程 v2', '应用重启后恢复工程内容')
  assert.equal(restarted.load(created.id)?.workspace.markerTrackLocked, true, '恢复工作区轨道状态')

  const duplicate = await restarted.duplicate(created.id)
  assert.notEqual(duplicate.id, created.id, '工程副本使用新 ID')
  assert.equal(duplicate.sessionId, created.sessionId, '工程副本继续引用同一原始素材')
  assert.equal(restarted.list().length, 2, '工程库列出原工程和副本')

  await restarted.delete(created.id)
  assert.equal(restarted.load(created.id), null, '删除指定工程记录')
  assert.ok(restarted.load(duplicate.id), '删除原工程不影响副本')
  await restarted.deleteBySession(created.sessionId)
  assert.equal(restarted.list().length, 0, '清理素材时同步清理关联工程')
  console.log('recording project tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
