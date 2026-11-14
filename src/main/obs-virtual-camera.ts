// OBS Virtual Camera 集成：OBS 28+ 自带 WebSocket（默认 4455）。
// 我们不直接写系统摄像头（那需要签名驱动），而是让 OBS 建一个浏览器源显示本机 MJPEG，
// 再调用 OBS 的 StartVirtualCam——这样 Zoom/Teams/微信等应用看到的是标准系统摄像头。

import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { connect } from 'net'
import { join } from 'path'

export interface ObsVirtualCameraOptions {
  streamUrl: string
  width: number
  height: number
  obsUrl?: string
  password?: string
}

export interface ObsVirtualCameraResult {
  ok: boolean
  scene?: string
  error?: string
  launched?: boolean
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('base64')
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** OBS WebSocket v5 的认证串：base64(sha256(base64(sha256(password+salt)) + challenge)) */
export function obsAuthString(password: string, salt: string, challenge: string): string {
  return sha256(sha256(password + salt) + challenge)
}

const portOpen = (host: string, port: number, timeout = 800): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (value: boolean): void => { socket.destroy(); resolve(value) }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })

const findObs = (): string => {
  const candidates = [
    'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe',
    'C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs64.exe',
    // 免安装/便携版：应用自己维护的稳定 OBS 目录（驱动也指向这里）
    join(process.env.LOCALAPPDATA || '', 'Agentic-Island', 'obs', 'bin', '64bit', 'obs64.exe'),
    join(process.env.LOCALAPPDATA || '', 'Programs', 'obs-studio', 'bin', '64bit', 'obs64.exe'),
    join(process.env.APPDATA || '', 'obs-studio', 'bin', '64bit', 'obs64.exe')
  ]
  return candidates.find((path) => existsSync(path)) || ''
}

const ensureObs = async (host: string, port: number): Promise<boolean> => {
  if (await portOpen(host, port)) return false
  const exe = findObs()
  if (!exe) throw new Error('未找到 OBS Studio。请安装 OBS 28+，并在“工具 → WebSocket 服务器设置”启用服务器')
  spawn(exe, ['--startvirtualcam', '--minimize-to-tray'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500)
    if (await portOpen(host, port)) return true
  }
  throw new Error('OBS 已启动，但 WebSocket 没有就绪。请在 OBS 的“工具 → WebSocket 服务器设置”启用服务器（默认端口 4455）')
}

interface ObsClient {
  request: (requestType: string, requestData?: Record<string, unknown>) => Promise<Record<string, unknown>>
  close: () => void
}

const connectObs = async (url: string, password: string, timeoutMs = 8000): Promise<ObsClient> => {
  const ws = new WebSocket(url)
  let identified = false
  let finished = false
  let seq = 0
  const pending = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>()
  let finish: (value: ObsClient) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const ready = new Promise<ObsClient>((resolve, reject) => { finish = resolve; fail = reject })

  const timer = setTimeout(() => { fail(new Error('连接 OBS WebSocket 超时')); try { ws.close() } catch { /* */ } }, timeoutMs)
  const send = (payload: Record<string, unknown>): void => { ws.send(JSON.stringify(payload)) }

  ws.onmessage = (event) => {
    let message: { op?: number; d?: Record<string, unknown> }
    try { message = JSON.parse(String((event as MessageEvent).data)) } catch { return }
    if (message.op === 0) {
      const data = message.d ?? {}
      const auth = data.authentication as { challenge?: string; salt?: string } | undefined
      const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: 0 }
      if (auth?.challenge && auth?.salt) {
        if (!password) { fail(new Error('OBS WebSocket 需要密码，请在录屏工坊填写')); return }
        identify.authentication = obsAuthString(password, auth.salt, auth.challenge)
      }
      send({ op: 1, d: identify })
      return
    }
    if (message.op === 2) {
      identified = true
      clearTimeout(timer)
      finish({
        request: (requestType, requestData = {}) => new Promise((resolve, reject) => {
          const requestId = `ai-${++seq}`
          pending.set(requestId, { resolve, reject })
          send({ op: 6, d: { requestType, requestId, requestData } })
        }),
        close: () => { finished = true; try { ws.close() } catch { /* */ } }
      })
      return
    }
    if (message.op === 7) {
      const data = message.d ?? {}
      const requestId = String(data.requestId || '')
      const waiter = pending.get(requestId)
      if (!waiter) return
      pending.delete(requestId)
      const status = data.requestStatus as { result?: boolean; code?: number; comment?: string } | undefined
      if (status?.result === false) waiter.reject(new Error(`OBS ${status.code ?? ''}: ${status.comment || '请求失败'}`))
      else waiter.resolve((data.responseData as Record<string, unknown>) || {})
    }
  }
  ws.onerror = () => { if (!identified && !finished) fail(new Error('无法连接 OBS WebSocket。请在 OBS 启用 WebSocket 服务器，并确认端口 4455')) }
  ws.onclose = () => {
    clearTimeout(timer)
    if (!identified && !finished) fail(new Error('OBS WebSocket 连接被关闭'))
    for (const [, waiter] of pending) waiter.reject(new Error('OBS WebSocket 已断开'))
    pending.clear()
  }
  return ready
}

const parseObsUrl = (raw: string): { wsUrl: string; host: string; port: number } => {
  let url = (raw || 'ws://127.0.0.1:4455').trim()
  if (!/^wss?:\/\//i.test(url)) url = `ws://${url}`
  const parsed = new URL(url)
  const host = parsed.hostname || '127.0.0.1'
  const port = Number(parsed.port || (parsed.protocol === 'wss:' ? 443 : 4455))
  return { wsUrl: `ws://${host}:${port}`, host, port }
}

export async function startObsVirtualCamera(options: ObsVirtualCameraOptions): Promise<ObsVirtualCameraResult> {
  const { wsUrl, host, port } = parseObsUrl(options.obsUrl || '')
  try {
    const launched = await ensureObs(host, port)
    const client = await connectObs(wsUrl, options.password || '')
    const scene = 'Agentic-Island 虚拟摄像头'
    const input = 'Agentic-Island 画面'
    try {
      const list = await client.request('GetSceneList')
      const scenes = Array.isArray(list.scenes) ? list.scenes as Array<{ sceneName?: string }> : []
      if (!scenes.some((item) => item.sceneName === scene)) await client.request('CreateScene', { sceneName: scene })
      await client.request('SetCurrentProgramScene', { sceneName: scene })

      let created = false
      try {
        await client.request('CreateInput', {
          sceneName: scene,
          inputName: input,
          inputKind: 'browser_source',
          inputSettings: {
            url: options.streamUrl,
            width: Math.max(320, Math.round(options.width)),
            height: Math.max(240, Math.round(options.height)),
            shutdown: false,
            restart_when_active: true
          },
          sceneItemEnabled: true
        })
        created = true
      } catch {
        await client.request('SetInputSettings', {
          inputName: input,
          inputSettings: {
            url: options.streamUrl,
            width: Math.max(320, Math.round(options.width)),
            height: Math.max(240, Math.round(options.height)),
            shutdown: false,
            restart_when_active: true
          },
          overlay: true
        })
      }
      if (created) {
        try {
          const video = await client.request('GetVideoSettings')
          const baseWidth = Number(video.baseWidth) || Math.round(options.width)
          const baseHeight = Number(video.baseHeight) || Math.round(options.height)
          const item = await client.request('GetSceneItemId', { sceneName: scene, sourceName: input })
          const sceneItemId = Number(item.sceneItemId)
          if (Number.isFinite(sceneItemId)) {
            await client.request('SetSceneItemTransform', {
              sceneName: scene,
              sceneItemId,
              sceneItemTransform: {
                positionX: 0, positionY: 0,
                boundsType: 'OBS_BOUNDS_SCALE_INNER',
                boundsAlignment: 5,
                boundsWidth: baseWidth,
                boundsHeight: baseHeight
              }
            })
          }
        } catch { /* 变换失败不影响虚拟摄像头启动 */ }
      }
      await client.request('StartVirtualCam')
      client.close()
      return { ok: true, scene, launched }
    } catch (error) {
      client.close()
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: /604|VirtualCam is not available/i.test(message)
        ? 'OBS 已连接并建好浏览器源，但 OBS Virtual Camera 驱动未注册。请以管理员身份运行一次 OBS 安装器（或在 OBS 中启用虚拟摄像头）后重试。'
        : message
    }
  }
}

export async function stopObsVirtualCamera(options: { obsUrl?: string; password?: string } = {}): Promise<ObsVirtualCameraResult> {
  const { wsUrl } = parseObsUrl(options.obsUrl || '')
  try {
    const client = await connectObs(wsUrl, options.password || '', 4000)
    await client.request('StopVirtualCam').catch(() => {})
    client.close()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
