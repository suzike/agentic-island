// 本地桥：仅监听 127.0.0.1 的 HTTP 服务。hook 转发脚本把事件 POST 到这里。
// - permission 事件：请求会一直挂起（阻塞），直到用户在岛上裁决后才响应决定 → CLI 据此放行/拦截。
// - stop / notification：立即响应。
// 通过随机端口 + 共享 token 防止本机其它进程冒充。

import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import type { AgentsStore } from './agents-store'
import type { BridgeEvent, ChangeSummary } from '../shared/protocol'

/** 完成时用于计算变更小结的注入函数（由 index.ts 注入 gitSummary，测试可省略） */
export type Summarizer = (cwd: string) => Promise<ChangeSummary | null>

export const BRIDGE_DIR = join(homedir(), '.agentic-island')
export const BRIDGE_FILE = join(BRIDGE_DIR, 'bridge.json')

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

export class BridgeServer {
  private server: Server | null = null
  readonly token = randomBytes(24).toString('hex')
  private store: AgentsStore
  private summarize?: Summarizer
  /** 发现文件路径：测试传临时路径，绝不能覆盖真实岛的 bridge.json（曾致全部 hook 打到死端口） */
  private discoveryFile: string
  private keepalive: NodeJS.Timeout | null = null

  constructor(store: AgentsStore, summarize?: Summarizer, discoveryFile: string = BRIDGE_FILE) {
    this.store = store
    this.summarize = summarize
    this.discoveryFile = discoveryFile
  }

  async start(): Promise<{ port: number; token: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res))
      server.on('error', reject)
      // port 0 → 系统分配空闲端口
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr === null || typeof addr === 'string') {
          reject(new Error('failed to bind bridge'))
          return
        }
        this.server = server
        const info = { port: addr.port, token: this.token }
        const payload = JSON.stringify(info)
        const write = (): void => {
          try {
            mkdirSync(BRIDGE_DIR, { recursive: true })
            writeFileSync(this.discoveryFile, payload, { mode: 0o600 })
          } catch { /* 下轮重试 */ }
        }
        write()
        // 自愈：发现文件可能被其它进程覆盖（如误跑的测试桥），周期性重申，15s 内自动恢复
        this.keepalive = setInterval(() => {
          try {
            if (readFileSync(this.discoveryFile, 'utf8') === payload) return
          } catch { /* 丢失也重写 */ }
          write()
        }, 15000)
        this.keepalive.unref?.()
        resolve(info)
      })
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end()
      return
    }
    let event: BridgeEvent
    try {
      event = JSON.parse(await readBody(req)) as BridgeEvent
    } catch {
      res.writeHead(400).end('{"error":"bad json"}')
      return
    }
    if (event.token !== this.token) {
      res.writeHead(403).end('{"error":"bad token"}')
      return
    }

    const reply = (obj: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }

    try {
      if (event.kind === 'permission') {
        // 阻塞直到用户裁决；reason 会回传给 CLI 作为 deny 理由
        const result = await this.store.handlePermission(event)
        reply({ decision: result.decision, reason: result.reason })
      } else if (event.kind === 'stop') {
        this.store.handleStop(event)
        reply({ ok: true })
        // 异步补充真实 git 变更小结（注入的 summarizer）
        this.summarize?.(event.cwd)
          .then((sum) => { if (sum) this.store.attachSummary(event, sum) })
          .catch(() => {})
      } else {
        // 其余生命周期事件：非阻塞，立即回应，实时更新岛
        if (event.kind === 'session') this.store.handleSession(event)
        else if (event.kind === 'prompt') this.store.handlePrompt(event)
        else if (event.kind === 'activity') this.store.handleActivity(event)
        else if (event.kind === 'end') this.store.handleEnd(event)
        else if (event.kind === 'terminfo') this.store.handleTerminfo(event)
        else this.store.handleNotification(event)
        reply({ ok: true })
        // 轮次结束 → 异步采集真实 git 变更小结（Stop 现走 notification/waiting，故用显式标记）
        if (event.turnEnd) {
          this.summarize?.(event.cwd)
            .then((sum) => { if (sum) this.store.attachSummary(event, sum) })
            .catch(() => {})
        }
      }
    } catch (err) {
      // 出错也要 fail-open，避免卡住 CLI
      reply({ decision: 'ask', error: String(err) })
    }
  }

  stop(): void {
    if (this.keepalive) clearInterval(this.keepalive)
    this.keepalive = null
    this.server?.close()
    this.server = null
  }
}
