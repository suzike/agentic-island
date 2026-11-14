import assert from 'node:assert/strict'
import { startMjpegServer } from '../src/main/mjpeg-server.ts'

const server = await startMjpegServer()
try {
  const frame = Buffer.from('FAKE-JPEG-FRAME')
  server.push(`data:image/jpeg;base64,${frame.toString('base64')}`)
  const controller = new AbortController()
  const response = await fetch(`http://127.0.0.1:${server.port}/${server.token}/stream.mjpg`, { signal: controller.signal })
  assert.equal(response.status, 200, 'MJPEG 流应 200')
  assert.match(response.headers.get('content-type') || '', /multipart\/x-mixed-replace/, '应为 multipart 流')
  const reader = response.body!.getReader()
  let text = ''
  for (let index = 0; index < 10 && !text.includes('FAKE-JPEG-FRAME'); index += 1) {
    const chunk = await reader.read()
    if (chunk.done) break
    text += Buffer.from(chunk.value).toString('latin1')
  }
  assert.match(text, /--aiisland-/, '包含 multipart 边界')
  assert.match(text, /FAKE-JPEG-FRAME/, '收到推入的帧')

  // 推第二帧，已连接的客户端应继续收到
  server.push(`data:image/jpeg;base64,${Buffer.from('SECOND-FRAME').toString('base64')}`)
  let second = ''
  for (let index = 0; index < 10 && !second.includes('SECOND-FRAME'); index += 1) {
    const chunk = await reader.read()
    if (chunk.done) break
    second += Buffer.from(chunk.value).toString('latin1')
  }
  assert.match(second, /SECOND-FRAME/, '后续帧持续推送')

  const page = await fetch(server.url).then((res) => res.text())
  assert.match(page, new RegExp(`/${server.token}/stream\\.mjpg`), '首页包含带 token 的流地址')

  await reader.cancel().catch(() => {})
  controller.abort()
  await server.close()
  await assert.rejects(fetch(`http://127.0.0.1:${server.port}/${server.token}/stream.mjpg`), '关闭后端口不再监听')
  console.log('mjpeg server tests passed')
} finally {
  await server.close().catch(() => {})
}
