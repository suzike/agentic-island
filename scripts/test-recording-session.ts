import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingSessionStore } from '../src/main/recording-session-store.ts'

const root = await mkdtemp(join(tmpdir(), 'recording-session-test-'))
try {
  const store = new RecordingSessionStore(root)
  await store.initialize()
  const created = await store.create({ name: '测试:录屏', mimeType: 'video/webm', sourceName: '屏幕 1', sourceKind: 'screen', width: 1920, height: 1080, fps: 30, hasAudio: true })
  assert.equal(created.status, 'recording', '创建持久录制会话')
  await store.append(created.id, 0, new Uint8Array([1, 2, 3]))
  await store.append(created.id, 1, new Uint8Array([4, 5]))
  await assert.rejects(() => store.append(created.id, 3, new Uint8Array([6])), /分片顺序异常/, '拒绝乱序分片')
  const finalized = await store.finalize(created.id, 12_345)
  assert.equal(finalized.manifest.status, 'ready', '结束后会话可预览和导出')
  assert.equal(finalized.manifest.bytes, 5, '记录落盘字节数')
  assert.deepEqual([...await readFile(finalized.filePath)], [1, 2, 3, 4, 5], '分片按序拼接到同一媒体文件')

  const interrupted = await store.create({ name: '未完成录屏', mimeType: 'video/webm', sourceName: '窗口', sourceKind: 'window', width: 1280, height: 720, fps: 24, hasAudio: false })
  await store.append(interrupted.id, 0, new Uint8Array([7, 8, 9]))
  await mkdir(join(root, `${interrupted.id}.json.tmp`))
  await assert.rejects(() => store.finalize(interrupted.id, 500), '结束清单提交失败会向调用方返回错误')
  await access(join(root, `${interrupted.id}.webm.part`))
  assert.equal(store.getFile(interrupted.id)?.manifest.status, 'recording', '结束失败时回滚文件名并保留可恢复会话')
  await rm(join(root, `${interrupted.id}.json.tmp`), { recursive: true, force: true })
  const restored = new RecordingSessionStore(root)
  await restored.initialize()
  const recovered = restored.list().find((session) => session.id === interrupted.id)
  assert.equal(recovered?.status, 'interrupted', '启动时识别上次异常中断的录制')
  const ready = await restored.recover(interrupted.id)
  assert.equal(ready.manifest.status, 'ready', '中断录制可恢复为可用文件')
  await restored.discard(interrupted.id)
  assert.equal(restored.getFile(interrupted.id), null, '可彻底丢弃恢复记录')
  console.log('recording session tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
