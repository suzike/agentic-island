import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startLanShare } from '../src/main/lan-share.ts'

const dir = await mkdtemp(join(tmpdir(), 'aiisland-share-'))
const file = join(dir, 'demo 视频.mp4')
const body = Buffer.from('0123456789abcdef'.repeat(1024))
await writeFile(file, body)

try {
  const share = await startLanShare(file, { ttlMs: 60_000, host: '127.0.0.1' })
  assert.match(share.url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{24}\//, '分享链接带随机 token')

  const full = await fetch(share.url)
  assert.equal(full.status, 200, '完整下载应 200')
  assert.equal(full.headers.get('accept-ranges'), 'bytes', '声明支持 Range')
  assert.equal(Number(full.headers.get('content-length')), body.length, 'Content-Length 为真实文件大小')
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), body, '下载内容逐字节一致')

  const ranged = await fetch(share.url, { headers: { range: 'bytes=10-19' } })
  assert.equal(ranged.status, 206, 'Range 请求应 206')
  assert.equal(await ranged.text(), 'abcdef0123', 'Range 内容正确')
  assert.equal(ranged.headers.get('content-range'), `bytes 10-19/${body.length}`, 'Content-Range 正确')

  const head = await fetch(share.url, { method: 'HEAD' })
  assert.equal(head.status, 200, 'HEAD 应 200')
  assert.equal((await head.arrayBuffer()).byteLength, 0, 'HEAD 不返回正文')

  const wrong = await fetch(share.url.replace(/\/[a-f0-9]{24}\//, '/wrong-token/'))
  assert.equal(wrong.status, 404, '错误 token 返回 404，不暴露文件')

  await share.close()
  await assert.rejects(fetch(share.url), '关闭后端口不再提供服务')
  console.log('lan share tests passed')
} finally {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
