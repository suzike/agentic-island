import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
    motionKeyframes: [
      { t: 0, x: 0.5, y: 0.5, zoom: 1 },
      { t: 3000, x: 0.6, y: 0.4, zoom: 1.6 }
    ],
    cursorTrack: [
      { t: 0, x: 0.2, y: 0.3, s: 0 },
      { t: 500, x: 0.5, y: 0.4, s: 6_000 },
      { t: 1_200, x: 1.8, y: -0.4, s: 99_999 },
      { t: 999_999, x: Number.NaN, y: 0.5, s: 1 }
    ],
    workspace: { timelineZoom: 1.8, timelineSnap: true, videoTrackLocked: false, markerTrackLocked: true, aiEditMode: 'tutorial' },
    aiResults: [{ id: 1, label: '摘要', text: '工程摘要' }]
  }

  const created = await store.save(input)
  assert.match(created.id, /^project-/, '创建稳定工程 ID')
  assert.equal(created.edit.segments.length, 1, '丢弃结束时间早于开始时间的无效片段')
  assert.equal(store.list()[0].transcriptCount, 1, '摘要包含字幕数量')
  assert.equal(created.cursorTrack.length, 3, '丢弃坐标非法的轨迹点（NaN）')
  assert.deepEqual(created.cursorTrack[2], { t: 1_200, x: 1, y: 0, s: 50_000 }, '越界坐标钳到边界，速度上限钳到 50000')
  assert.equal(created.cursorTrack[3], undefined, 'NaN 坐标不会混进工程')
  assert.equal(created.cursorTrack[0].t, 0, '轨迹时间戳按录制偏移落盘')
  // 运镜点：人工编辑的结果要能落盘并规范化（越界缩放钳回、按时间排序、丢弃非法点）
  assert.equal(created.motionKeyframes.length, 2, '运镜点应落盘')
  assert.deepEqual(created.motionKeyframes[0], { t: 0, x: 0.5, y: 0.5, zoom: 1 }, '开场锚点原样保留')
  assert.equal(created.motionKeyframes[1].zoom, 1.6, '合法缩放保留')
  const normalized = await store.save({
    ...input,
    id: created.id,
    motionKeyframes: [{ t: 5_000, x: 0.9, y: 0.1, zoom: 9 }, { t: 1_000, x: 0.5, y: 0.5, zoom: 1.3 }]
  })
  assert.deepEqual(normalized.motionKeyframes.map((point) => point.t), [1_000, 5_000], '运镜点按时间排序')
  assert.equal(normalized.motionKeyframes[1].zoom, 4, '越界缩放钳到上限 4')

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

  // v0.6.14 之前的工程没有光标轨迹字段：读取时补空数组，避免下游到处判 undefined
  const legacy = { ...input, id: 'project-legacy', createdAt: 1, updatedAt: 2, cursorTrack: undefined }
  await writeFile(join(root, 'project-legacy.json'), JSON.stringify(legacy), 'utf8')
  const reopened = new RecordingProjectStore(root)
  await reopened.initialize()
  assert.deepEqual(reopened.load('project-legacy')?.cursorTrack, [], '旧工程缺少轨迹字段时补空数组而不是 undefined')
  console.log('recording project tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
