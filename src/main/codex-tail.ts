// Codex 实时接入（Windows 正解）：Codex CLI/桌面端不会触发我们的 hooks（实测 events.log 零命中），
// notify 又被 OpenAI 的 computer-use 独占。但每个 Codex 会话都会把全过程实时写入 rollout JSONL：
//   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// 本模块以「字节偏移 + 定时轮询」只读跟随这些文件的新增行，把事件映射进 AgentsStore，
// 从而让灵动岛实时看到 Codex 的会话/思考/命令/改文件/完成。
//
// 局限（如实）：rollout 是「运行记录」而非控制通道 —— 只能观察，无法拦截审批（那需要 hooks 生效）。
// 因此 Codex 在岛上是「实时监控 + 完成待命」，不提供 Allow/Deny 按钮。

import { readFileSync, openSync, readSync, closeSync, statSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentsStore } from './agents-store'
import type { BridgeEvent, ChangeSummary } from '../shared/protocol'

type Summarizer = (cwd: string) => Promise<ChangeSummary | null>

interface Ctx {
  sessionId: string
  cwd: string
  entry: string // 'cli'（codex-tui）或其它宿主 → 桌面端
}

// 尊重 Codex 官方 CODEX_HOME 环境变量（用户可能自定义 codex 主目录）
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex')
const DEFAULT_SESSIONS_ROOT = join(CODEX_HOME, 'sessions')
const POLL_MS = 1000
const RECENT_MS = 12 * 60 * 60 * 1000 // 只跟随近 12h 内活跃的会话文件，控制扫描量
const truncate = (s: string, n = 160): string => (s && s.length > n ? s.slice(0, n) + '…' : s || '')

export class CodexTail {
  private store: AgentsStore
  private summarize?: Summarizer
  private root: string
  private timer: NodeJS.Timeout | null = null
  private offsets = new Map<string, number>() // 文件 → 已消费字节
  private ctxs = new Map<string, Ctx>() // 文件 → 会话上下文
  private lastGrow = new Map<string, number>() // 文件 → 最近一次新增数据的时间（空闲判定）
  private endedIdle = new Set<string>() // 已按空闲归档过的会话（新数据到来时移除，可复活）
  private knownFiles = new Set<string>() // 周期性扫描发现的近期 rollout 文件
  private lastScan = 0

  /** rollout 无"会话结束"信号（关终端不会写任何东西）——超过此时长无新数据即视为已结束 */
  private static IDLE_END_MS = 15 * 60 * 1000
  /** 全树扫描间隔：活跃文件仍每秒跟随，新文件最多延迟几秒出现，避免历史多时每秒递归扫盘 */
  private static SCAN_MS = 5000

  constructor(store: AgentsStore, summarize?: Summarizer, root: string = DEFAULT_SESSIONS_ROOT) {
    this.store = store
    this.summarize = summarize
    this.root = root
  }

  /** 供测试：直接跑一次轮询（跳过定时器） */
  pollOnce(): void {
    this.scanFiles(Date.now())
    this.tick()
  }

  start(): void {
    if (this.timer) return
    // 首扫：对已存在的活跃会话，提取上下文但把偏移设到文件末尾（只关心「从现在起」的新事件，不回放历史）。
    // 若 sessions 目录尚不存在，也继续启动定时器；用户之后首次运行 Codex 创建目录时会自动接入。
    try {
      this.scanFiles(Date.now())
      for (const f of this.knownFiles) {
        this.ctxs.set(f, this.readHeadCtx(f))
        this.offsets.set(f, this.sizeOf(f))
      }
    } catch { /* 忽略首扫异常 */ }
    this.timer = setInterval(() => {
      try { this.tick() } catch { /* 单次轮询异常不应中断跟随 */ }
    }, POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // ---- 内部 ----

  private sizeOf(f: string): number {
    try { return statSync(f).size } catch { return 0 }
  }

  // 递归收集近 RECENT_MS 内修改过的 rollout JSONL
  private recentFiles(): string[] {
    const out: string[] = []
    if (!existsSync(this.root)) return out
    const now = Date.now()
    const walk = (dir: string): void => {
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.jsonl')) {
          try { if (now - statSync(p).mtimeMs < RECENT_MS) out.push(p) } catch { /* */ }
        }
      }
    }
    walk(this.root)
    return out
  }

  private scanFiles(now: number): void {
    this.lastScan = now
    for (const f of this.recentFiles()) this.knownFiles.add(f)
  }

  // 从文件头部读取 session_meta，建立会话上下文（用于「岛启动前已在跑」的会话）
  private readHeadCtx(f: string): Ctx {
    const ctx: Ctx = { sessionId: '', cwd: homedir(), entry: 'cli' }
    try {
      const head = readFileSync(f, 'utf8').split('\n', 3)
      for (const line of head) {
        if (!line.trim()) continue
        const o = JSON.parse(line)
        if (o.type === 'session_meta') {
          const p = o.payload || {}
          ctx.sessionId = p.session_id || p.id || ''
          ctx.cwd = p.cwd || ctx.cwd
          ctx.entry = p.originator === 'codex-tui' ? 'cli' : String(p.originator || 'cli')
          break
        }
      }
    } catch { /* */ }
    return ctx
  }

  private tick(): void {
    const now = Date.now()
    if (now - this.lastScan >= CodexTail.SCAN_MS) this.scanFiles(now)
    for (const f of this.knownFiles) {
      const size = this.sizeOf(f)
      const off = this.offsets.get(f)
      if (off === undefined) {
        // 岛启动后新出现的会话文件：从头读（首行即 session_meta）
        this.ctxs.set(f, { sessionId: '', cwd: homedir(), entry: 'cli' })
        this.offsets.set(f, 0)
      } else if (size <= off) {
        this.checkIdle(f, now)
        continue // 无新增
      }
      this.lastGrow.set(f, now)
      this.endedIdle.delete(this.ctxs.get(f)?.sessionId || '') // 有新数据 → 可复活
      this.consume(f)
    }
  }

  // 空闲归档：关掉终端后 rollout 永远不再增长，超时把卡片置为"已结束"（之后由 store 自动隐藏）
  private checkIdle(f: string, now: number): void {
    const ctx = this.ctxs.get(f)
    if (!ctx?.sessionId || this.endedIdle.has(ctx.sessionId)) return
    const grow = this.lastGrow.get(f)
    if (!grow || now - grow < CodexTail.IDLE_END_MS) return
    const agent = this.store.snapshot().agents.find((a) => a.id === `codex:${ctx.sessionId}`)
    if (!agent || agent.status === 'done') { this.endedIdle.add(ctx.sessionId); return }
    this.endedIdle.add(ctx.sessionId)
    this.store.handleEnd(this.ev(ctx, 'end', { detail: '会话已结束（长时间无活动）' }))
  }

  // 读取 [offset, size) 的新增字节，只处理到最后一个换行（避免解析半行）
  private consume(f: string): void {
    const off = this.offsets.get(f) || 0
    const size = this.sizeOf(f)
    if (size <= off) return
    const len = size - off
    const buf = Buffer.alloc(len)
    let fd: number
    try {
      fd = openSync(f, 'r')
    } catch { return }
    try {
      readSync(fd, buf, 0, len, off)
    } finally {
      closeSync(fd)
    }
    // 定位最后一个换行（字节级，避免多字节字符被截断）
    let lastNl = -1
    for (let i = len - 1; i >= 0; i--) {
      if (buf[i] === 0x0a) { lastNl = i; break }
    }
    if (lastNl < 0) return // 尚无完整行，等下次
    this.offsets.set(f, off + lastNl + 1)
    const ctx = this.ctxs.get(f) || { sessionId: '', cwd: homedir(), entry: 'cli' }
    this.ctxs.set(f, ctx)
    const text = buf.subarray(0, lastNl).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.trim()) this.handleLine(line, ctx)
    }
  }

  private handleLine(line: string, ctx: Ctx): void {
    let o: { type?: string; payload?: Record<string, unknown> }
    try { o = JSON.parse(line) } catch { return }
    const p = o.payload || {}

    if (o.type === 'session_meta') {
      ctx.sessionId = String(p.session_id || p.id || ctx.sessionId)
      ctx.cwd = String(p.cwd || ctx.cwd)
      ctx.entry = p.originator === 'codex-tui' ? 'cli' : String(p.originator || 'cli')
      this.store.handleSession(this.ev(ctx, 'session', { detail: '会话已开始 · 待命中…' }))
      if (p.model) this.store.attachMeta(this.ev(ctx, 'session', {}), { model: String(p.model) })
      return
    }
    if (o.type === 'turn_context') {
      if (p.cwd) ctx.cwd = String(p.cwd)
      if (p.model) this.store.attachMeta(this.ev(ctx, 'session', {}), { model: String(p.model) })
      return
    }
    if (!ctx.sessionId) return // 无会话上下文，忽略

    // 命令 / 改文件：来自 response_item（模型发起时即写入，适合展示「正在做什么」）
    if (o.type === 'response_item') {
      if (p.type === 'function_call' && p.name === 'shell_command') {
        let cmd = ''
        try { cmd = String((JSON.parse(String(p.arguments || '{}')) as { command?: string }).command || '') } catch { /* */ }
        this.store.handleActivity(this.ev(ctx, 'activity', { tool: 'Bash', detail: cmd ? `运行命令：${truncate(cmd)}` : '正在运行命令…' }))
      } else if (p.type === 'custom_tool_call' && p.name === 'apply_patch') {
        this.store.handleActivity(this.ev(ctx, 'activity', { tool: 'Edit', detail: '正在修改文件…' }))
      }
      return
    }

    if (o.type !== 'event_msg') return
    switch (p.type) {
      case 'task_started':
        this.store.handleActivity(this.ev(ctx, 'activity', { detail: '正在思考 · 处理你的请求…' }))
        break
      case 'user_message':
        this.store.handlePrompt(this.ev(ctx, 'prompt', { detail: p.message ? `对话中 · ${truncate(String(p.message), 80)}` : '对话中 · 正在处理你的消息…' }))
        break
      case 'mcp_tool_call_end': {
        const inv = (p.invocation || {}) as { server?: string; tool?: string }
        this.store.handleActivity(this.ev(ctx, 'activity', { detail: `调用工具：${inv.server || ''}·${inv.tool || ''}` }))
        break
      }
      case 'web_search_end':
        this.store.handleActivity(this.ev(ctx, 'activity', { detail: '联网搜索…' }))
        break
      case 'task_complete': {
        const last = String(p.last_agent_message || '')
        const ev = this.ev(ctx, 'notification', {
          detail: last ? `本轮完成 · 等待你的回复\n\n${truncate(last, 400)}` : '本轮完成 · 等待你的回复…'
        })
        this.store.handleNotification(ev)
        // 轮次结束 → 采集真实 git 变更小结（与 Claude Code 一致）
        this.summarize?.(ctx.cwd).then((s) => { if (s) this.store.attachSummary(ev, s) }).catch(() => {})
        break
      }
      case 'token_count': {
        // token 用量：兼容多种字段形态（total 累计 / last 本轮上下文占用）
        const info = (p.info || p) as Record<string, unknown>
        const num = (v: unknown): number | undefined => {
          if (typeof v === 'number') return v
          if (v && typeof v === 'object') { const o2 = v as Record<string, unknown>; return num(o2.total_tokens ?? o2.total ?? o2.tokens) }
          return undefined
        }
        const total = num(info.total_token_usage) ?? num(info.total_tokens) ?? num(info.total)
        const last = num(info.last_token_usage) ?? num(info.context_tokens) ?? num(info.last)
        if (total !== undefined || last !== undefined) this.store.attachMeta(this.ev(ctx, 'activity', {}), { tokens: total, contextTokens: last })
        break
      }
      case 'turn_aborted':
        this.store.handleStop(this.ev(ctx, 'stop', { detail: '本轮已中止 · 待命中…' }))
        break
      case 'error':
        this.store.handleNotification(this.ev(ctx, 'notification', { detail: `出错：${truncate(String(p.message || p.error || '未知错误'))}` }))
        break
      default:
        break
    }
  }

  // 构造直调 store 用的最小 BridgeEvent（token/kind 仅占位，store 直接消费字段）
  private ev(ctx: Ctx, kind: BridgeEvent['kind'], extra: Partial<BridgeEvent>): BridgeEvent {
    return { token: '', backend: 'codex', kind, sessionId: ctx.sessionId, cwd: ctx.cwd, entry: ctx.entry, ...extra }
  }
}
