// 局域网临时分享：把单个成品文件用随机 token 暴露给同一局域网，支持 Range（视频可拖动播放），
// 到期自动关闭。不是公网分享服务，也不上传任何内容；只在本机进程中转发文件。
//
// 这个模块不 import electron，便于 scripts/test-lan-share.ts 直接用 node 加载。

import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createServer, type Server } from 'http'
import type { Socket } from 'net'
import { networkInterfaces } from 'os'
import { basename, extname, resolve } from 'path'
import { randomBytes } from 'crypto'

export interface LanShareHandle {
  url: string
  port: number
  expiresAt: number
  close: () => Promise<void>
}

export interface LanShareOptions {
  ttlMs?: number
  host?: string
  /** 测试/特殊网络下的固定端口；默认 0（随机） */
  port?: number
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const lanAddress = (): string => {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address
    }
  }
  return '127.0.0.1'
}

/** 启动一个只服务 `filePath` 的临时 HTTP 服务。调用方负责在退出时 close。 */
export async function startLanShare(filePath: string, options: LanShareOptions = {}): Promise<LanShareHandle> {
  const target = resolve(filePath)
  const info = await stat(target)
  if (!info.isFile()) throw new Error('只能分享文件，不能分享目录')

  const token = randomBytes(12).toString('hex')
  const fileName = basename(target)
  const route = `/${token}/${encodeURIComponent(fileName)}`
  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'
  const sockets = new Set<Socket>()
  let closed = false
  let timer: NodeJS.Timeout | null = null

  const server: Server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost')
      if (url.pathname !== route) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('not found')
        return
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }

      const size = info.size
      const range = request.headers.range
      const headers: Record<string, string | number> = {
        'content-type': type,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'x-content-type-options': 'nosniff'
      }

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
        if (!match) {
          response.writeHead(416, { 'content-range': `bytes */${size}` })
          response.end()
          return
        }
        const start = match[1] ? Number(match[1]) : 0
        const end = match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
        if (!Number.isFinite(start) || start > end || start >= size) {
          response.writeHead(416, { 'content-range': `bytes */${size}` })
          response.end()
          return
        }
        response.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` })
        if (request.method === 'HEAD') { response.end(); return }
        createReadStream(target, { start, end }).pipe(response)
        return
      }

      response.writeHead(200, { ...headers, 'content-length': size })
      if (request.method === 'HEAD') { response.end(); return }
      createReadStream(target).pipe(response)
    } catch {
      response.writeHead(500)
      response.end()
    }
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(options.port || 0, '0.0.0.0', () => {
      server.off('error', reject)
      resolveListen()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const host = options.host || lanAddress()
  const ttlMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, options.ttlMs ?? 60 * 60 * 1000))
  const expiresAt = Date.now() + ttlMs

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
  timer = setTimeout(() => { void close() }, ttlMs)
  timer.unref?.()
  server.unref()

  return { url: `http://${host}:${port}${route}`, port, expiresAt, close }
}
