// 本机 MJPEG 推流：给 OBS 浏览器源提供低延迟画面。
// 只绑定 127.0.0.1 + 随机 token，不对外网暴露。

import { randomBytes } from 'crypto'
import { createServer, type Server, type ServerResponse } from 'http'
import type { Socket } from 'net'

export interface MjpegServerHandle {
  url: string
  token: string
  port: number
  push: (dataUrl: string) => void
  close: () => Promise<void>
}

export async function startMjpegServer(): Promise<MjpegServerHandle> {
  const token = randomBytes(12).toString('hex')
  const clients = new Set<ServerResponse>()
  const sockets = new Set<Socket>()
  let latest: Buffer | null = null
  const boundary = `aiisland-${token}`

  const writeFrame = (client: ServerResponse, frame: Buffer): void => {
    client.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`)
    client.write(frame)
    client.write('\r\n')
  }

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(`<!doctype html><meta charset="utf-8"><title>Agentic-Island Virtual Camera</title><style>html,body{margin:0;background:#000;overflow:hidden}img{width:100vw;height:100vh;object-fit:contain}</style><img src="/${token}/stream.mjpg" alt="">`)
      return
    }
    if (url.pathname !== `/${token}/stream.mjpg`) { response.writeHead(404); response.end(); return }
    response.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff'
    })
    clients.add(response)
    request.on('close', () => clients.delete(response))
    if (latest) writeFrame(response, latest)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}/`,
    token,
    port,
    push: (dataUrl: string) => {
      const comma = dataUrl.indexOf(',')
      if (comma < 0 || !/^data:image\/jpe?g;base64,/i.test(dataUrl)) return
      latest = Buffer.from(dataUrl.slice(comma + 1), 'base64')
      for (const client of clients) {
        try { writeFrame(client, latest) } catch { clients.delete(client) }
      }
    },
    close: async () => {
      for (const client of clients) { try { client.end() } catch { /* */ } }
      clients.clear()
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
