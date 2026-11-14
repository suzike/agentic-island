// agent-autoloop 提供方：把本机（或局域网）的 Agent Autoloop 中台折算成 Super-Agent 归一化数据。
// 协议依据 github.com/KKKKhazix/agent-autoloop 的 docs/protocol.md（/v1 有版本化兼容承诺，
// 且"新增字段不算破坏"——因此解析全程防御式，未知字段一律忽略、缺省字段一律空值，绝不抛错）。
//
// 连接策略（按优先级）：
// 1. http：设置里配了本人密钥（ownerKey）→ GET /v1/state 直连（毫秒级、无进程开销），动作走 POST。
// 2. cli ：没配密钥但本机装有 agent-autoloop → 只读兜底 `agent-autoloop status --json`
//          （文档明确 scripts 用 --json）。CLI 状态只用于展示，动作一律要求密钥（不把自由文本
//          拼进 shell 命令行，是注入面的硬边界）。
// 3. off ：都没有 → 板块显示引导。
//
// 触发：设置轮询（默认 15s）+ 本机 ~/.agent-autoloop 目录 fs.watch（中台每次提交都写事件日志，
// WAL 会触发目录事件）去抖后立即拉取；以及渲染层手动刷新/动作后的主动 refresh。
//
// raw-node 可加载：运行时依赖（fetch/spawn）全部注入，顶层只有 node 内置与类型导入。

import { EventEmitter } from 'events'
import { existsSync, readFileSync, watch } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SuperActionResult, SuperAgentSettings, SuperComponent, SuperDecision, SuperElsewhere, SuperFactPulse, SuperHistoryItem, SuperPipeline, SuperProviderStatus, SuperRule, SuperSkippedEvent, SuperSpend, SuperTimer, SuperWhyLine, SuperWork } from '../shared/protocol'
import type { SuperProvider, SuperProviderData } from './super-agent'

// ---- 注入面（index.ts / 测试提供实现） ----

/** 最小 fetch 形状（标准 fetch Response 满足；测试可直接传包装函数。body 供 SSE 读流） */
export type SuperFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string>; body?: ReadableStream<Uint8Array> | null }>

/** 子进程执行（CLI 兜底用；args 只会是简单 token，绝不含用户自由文本） */
export type SuperSpawn = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

export interface AutoloopProviderOptions {
  fetchImpl: SuperFetch
  spawnImpl: SuperSpawn
  /** 覆盖发现根目录（测试用）；默认 $AGENT_AUTOLOOP_HOME 或 ~/.agent-autoloop */
  homeDir?: string
}

// ---- 防御式取值（协议允许新增字段，这里只取文档写明的键） ----

const asObj = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : null
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v) ? v : null
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null
const bool = (v: unknown): boolean | null => (typeof v === 'boolean') ? v : null
/** ISO 字符串或 epoch 毫秒 → epoch 毫秒；解析不了给 null */
const ts = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    if (Number.isFinite(t)) return t
  }
  return null
}

const AUTOLOOP_HOME = (): string => process.env.AGENT_AUTOLOOP_HOME || join(homedir(), '.agent-autoloop')

const emptyPipeline = (): SuperPipeline => ({
  sources: 0, rules: 0, pausedRules: 0, queued: 0, retrying: 0, running: 0,
  unknown: 0, doneToday: 0, nothingToday: 0, attention: 0, timers: 0
})
const clampPollSec = (s: number): number => Math.max(5, Math.min(120, Math.round(s) || 15))

/** 读 ~/.agent-autoloop/config.json → { url }（自动发现；任何异常按未安装处理） */
export function discoverAutoloopUrl(homeDir?: string): string | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homeDir || AUTOLOOP_HOME(), 'config.json'), 'utf8')) as Record<string, unknown>
    return str(cfg.url) || str(asObj(cfg.hub)?.publicUrl) || null
  } catch {
    return null
  }
}

export function autoloopInstalled(homeDir?: string): boolean {
  try {
    const home = homeDir || AUTOLOOP_HOME()
    return existsSync(join(home, 'config.json')) || existsSync(home)
  } catch {
    return false
  }
}

/** 规范化基地址：补协议、去尾斜杠 */
const normalizeBase = (raw: string): string | null => {
  const s = raw.trim()
  if (!s) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`
  return withScheme.replace(/\/+$/, '') || null
}

// ---- 归一化（纯函数，测试直测） ----

/** agent-autoloop GET /v1/state（或 CLI status --json 同形输出）→ 归一化数据。永不抛错。
 *  字段名以实现为准（host/state.ts 的 stateOf + kernel/query.ts 的 cardView，2026-11 主分支），
 *  与 docs/protocol.md 的文字描述有出入处一律按实现：runs 编号键是 id（不是 run）、时间戳驼峰
 *  （createdAt/finishedAt）、卡片时间 createdAt、tokens 在 usage.input+output、lines 用 every/next
 *  描述定时而非 when.cron、sources 无 online（只有事件计数）。防御式兼容旧文档形态作回退。 */
export function normalizeAutoloopState(raw: unknown, now: number): SuperProviderData {
  const root = asObj(raw)
  if (!root) return { decisions: [], work: [], rules: [], history: [], timers: [], spend: null, components: [], pipeline: emptyPipeline(), skipped: [], elsewhere: [], facts: [] }

  // agents: id → 显示名（runs/lines 里的 agent 字段是 id，不是名字）
  const agentName = new Map<string, string>()
  for (const a of asArr(root.agents)) {
    const o = asObj(a)
    const id = str(o?.id)
    const name = str(o?.name) || id
    if (id && name) agentName.set(id, name)
  }

  // 卡片投递失败索引：channels[].lastFailure.card → 具体卡片（没送达=你可能根本不知道它存在）
  const deliveryFailures = new Map<number, { tries: number; error: string; givenUp: boolean }>()
  for (const ch of asArr(root.channels)) {
    const o = asObj(ch)
    const fail = asObj(o?.lastFailure)
    const cardId = num(fail?.card)
    if (!fail || cardId === null) continue
    deliveryFailures.set(cardId, {
      tries: num(fail.tries) || 0,
      error: str(fail.error) || '投递失败',
      givenUp: bool(fail.givenUp) === true
    })
  }

  // 卡片：state 为 open 的进入"待拍板"（ask 前置、同 kind 按年龄老→新；未知年龄排最后）
  const decisions: SuperDecision[] = []
  for (const c of asArr(root.cards)) {
    const o = asObj(c)
    if (!o || str(o.state) !== 'open') continue
    const cardId = num(o.id)
    if (cardId === null) continue
    const kind = str(o.kind) === 'notice' ? 'notice' : 'ask'
    decisions.push({
      id: `autoloop:${cardId}`,
      provider: 'autoloop',
      cardId,
      kind,
      title: str(o.title) || '(无标题)',
      text: str(o.text) || '',
      options: asArr(o.options).map((x) => String(x)).slice(0, 12),
      recommend: num(o.recommend),
      rule: str(o.rule),
      lane: str(o.lane) || null,
      about: str(o.about) || null,
      link: str(o.link) || null,
      createdAt: ts(o.createdAt) ?? ts(o.at) ?? ts(o.created_at) ?? 0,
      deliveryFailed: deliveryFailures.get(cardId) || null
    })
  }
  decisions.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'ask' ? -1 : 1
    const av = a.createdAt || Number.MAX_SAFE_INTEGER
    const bv = b.createdAt || Number.MAX_SAFE_INTEGER
    return av - bv
  })

  // 轮次：进行中/排队/不确定 → work；已结束 → history（近 14 条）
  const work: SuperWork[] = []
  const history: SuperHistoryItem[] = []
  for (const r of asArr(root.runs)) {
    const o = asObj(r)
    if (!o) continue
    const runId = num(o.id) ?? num(o.run) // 实现是 id；文档写 run，双兼容
    const rule = str(o.rule)
    if (runId === null || !rule) continue
    const agentId = str(o.agent)
    const agent = (agentId && agentName.get(agentId)) || agentId || null
    const usage = asObj(o.usage)
    // 用量口径与中台一致：input/output 任一存在才算已报 tokens；cost 单独算
    const input = num(usage?.input)
    const output = num(usage?.output)
    const tokens = usage && (input !== null || output !== null) ? (input || 0) + (output || 0) : null
    const state = str(o.state)
    if (state === 'queued' || state === 'claimed' || state === 'unknown') {
      work.push({
        id: `autoloop:${runId}`,
        provider: 'autoloop',
        runId,
        rule,
        lane: str(o.lane) || null,
        agent,
        state,
        attempts: num(o.attempts) || 0,
        error: str(o.error) || null,
        summary: str(o.summary) || null,
        manual: bool(o.manual) === true,
        stopping: bool(o.stopping) === true,
        notBefore: ts(o.notBefore),
        link: str(o.link) || null,
        session: str(o.session) || null
      })
    } else if (state === 'done' || state === 'nothing' || state === 'cancelled') {
      history.push({
        id: `autoloop:${runId}`,
        provider: 'autoloop',
        runId,
        rule,
        agent,
        outcome: state,
        finishedAt: ts(o.finishedAt) ?? ts(o.finished_at),
        summary: str(o.summary) || null,
        tokens,
        costUsd: num(usage?.cost),
        link: str(o.link) || null,
        session: str(o.session) || null
      })
    }
  }
  work.sort((a, b) => b.runId - a.runId)
  history.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  history.splice(14)

  // 规则：lines（paused 直接内嵌；顶层 pauses 兜底）
  const pauses = new Map<string, Record<string, unknown>>()
  for (const p of asArr(root.pauses)) {
    const o = asObj(p)
    const name = str(o?.name)
    if (o && name) pauses.set(name, o)
  }
  const rules: SuperRule[] = []
  for (const l of asArr(root.lines)) {
    const o = asObj(l)
    if (!o) continue
    const name = str(o.name) || str(o.id) || str(o.rule)
    if (!name) continue
    const pausedObj = asObj(o.paused) || pauses.get(name) || null
    const skippedObj = asObj(pausedObj?.skipped)
    const agentId = str(o.agent)
    // lines[].totals 是中台的 tally（running/queued/retrying/doneToday/nothing）
    const tally = asObj(o.totals)
    const today = tally
      ? {
          done: num(tally.doneToday) ?? 0,
          nothing: num(tally.nothing) ?? 0,
          retrying: num(tally.retrying) ?? 0,
          running: num(tally.running) ?? 0,
          queued: num(tally.queued) ?? 0
        }
      : null
    rules.push({
      provider: 'autoloop',
      name,
      agent: (agentId && agentName.get(agentId)) || agentId || null,
      every: str(o.every) || str(asObj(o.when)?.cron),
      sourceType: str(o.source) || str(asObj(o.when)?.source),
      next: ts(o.next),
      paused: !!pausedObj,
      pauseReason: str(pausedObj?.reason),
      pausedSince: ts(pausedObj?.since),
      skippedCount: num(skippedObj?.count) || 0,
      today
    })
  }
  rules.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))

  // 未来复查
  const timers: SuperTimer[] = []
  for (const t of asArr(root.timers)) {
    const o = asObj(t)
    if (!o) continue
    const at = ts(o.at)
    const rule = str(o.rule)
    if (at === null || !rule) continue
    timers.push({ provider: 'autoloop', rule, lane: str(o.lane) || null, key: str(o.key) || '', about: str(o.about) || '', at })
  }
  timers.sort((a, b) => a.at - b.at)

  // 用量：未上报的轮数单列（诚实显示，不当 0）
  const win = (v: unknown): SuperSpend['today'] => {
    const o = asObj(v) || {}
    return {
      rounds: num(o.rounds) || 0,
      tokens: num(o.tokens),
      cached: num(o.cached),
      costUsd: num(o.cost),
      missingTokens: num(o.missingTokens) || 0,
      missingCost: num(o.missingCost) || 0
    }
  }
  const spending = asObj(root.spending)
  const spend: SuperSpend | null = spending ? { today: win(spending.today), week: win(spending.week) } : null

  // 暂停期间被跳过的事件（skippedView：{...event, receivedAt, rules: JSON.parse(paused)}）
  const skipped: SuperSkippedEvent[] = []
  for (const s of asArr(root.skipped)) {
    const o = asObj(s)
    const id = num(o?.id)
    const type = str(o?.type)
    const source = str(o?.source)
    if (!o || id === null || !type || !source) continue
    let rulesOf: string[] = []
    try {
      const raw = o.rules ?? o.paused
      if (Array.isArray(raw)) rulesOf = raw.map((x) => String(x))
      else if (typeof raw === 'string') rulesOf = (JSON.parse(raw) as unknown[]).map((x) => String(x))
    } catch { /* 保留空 */ }
    skipped.push({
      id,
      source,
      type,
      subject: str(o.subject),
      summary: str(o.summary),
      at: ts(o.receivedAt) ?? ts(o.received_at),
      rules: rulesOf
    })
  }

  // elsewhere：托管在别处的定时任务
  const elsewhere: SuperElsewhere[] = []
  for (const e of asArr(root.elsewhere)) {
    const o = asObj(e)
    const name = str(o?.name)
    if (!o || !name) continue
    elsewhere.push({
      name,
      source: str(o.source) || '',
      agent: str(o.agent) || '',
      cron: str(o.cron) || '',
      every: str(o.every),
      next: ts(o.next),
      where: str(o.where)
    })
  }

  // 部件在线状态：Agent 接单程序 / 通道（online=心跳 2 分钟）/ 事件源（无心跳，online=null + 事件计数）
  const components: SuperComponent[] = []
  const pushComponents = (v: unknown, kind: SuperComponent['kind']): void => {
    for (const c of asArr(v)) {
      const o = asObj(c)
      if (!o) continue
      const name = str(o.name) || str(o.id) || str(o.label)
      if (!name) continue
      const online = bool(o.online)
      const fail = asObj(o.lastFailure)
      const events = num(o.events)
      const worker = str(o.worker)
      // Agent 部件的 detail 优先给 worker 归属（多机部署时"这台接单程序是谁"一眼可见）
      components.push({
        kind,
        name,
        online: kind === 'source' && online === null ? null : online === true,
        detail: str(o.detail)
          || (kind === 'agent' && worker ? `接单程序 ${worker}` : null)
          || (fail ? `最近投递失败 ${num(fail.tries) || '?'} 次` : null)
          || (kind === 'source' && events !== null ? `${events} 条事件` : null)
      })
    }
  }
  pushComponents(root.agents, 'agent')
  pushComponents(root.channels, 'channel')
  pushComponents(root.sources, 'source')

  // 流水线计数：优先用中台 totals（实现里的 tally 结构），缺失时用本条快照派生
  const totals = asObj(root.totals)
  const running = num(totals?.running) ?? work.filter((w) => w.state === 'claimed').length
  const queued = num(totals?.queued) ?? work.filter((w) => w.state === 'queued').length
  const pipeline: SuperPipeline = {
    sources: Object.keys(asObj(root.sources) || {}).length || asArr(root.sources).length,
    rules: rules.length,
    pausedRules: rules.filter((r) => r.paused).length,
    queued,
    retrying: num(totals?.retrying) ?? work.filter((w) => w.state === 'queued' && w.attempts > 0).length,
    running,
    unknown: num(totals?.unknown) ?? work.filter((w) => w.state === 'unknown').length,
    doneToday: num(totals?.doneToday) ?? 0,
    nothingToday: num(totals?.nothing) ?? 0,
    attention: num(totals?.attention) ?? decisions.length,
    timers: timers.length
  }

  return { decisions, work, rules, history, timers, spend, components, pipeline, skipped, elsewhere, facts: [] }
}

/** why 事实 → 时间线行（形状防御：只挑常见可读字段，其余紧凑 JSON） */
export function normalizeAutoloopWhy(raw: unknown): SuperWhyLine[] {
  const root = asObj(raw)
  const list = asArr(root?.facts ?? raw)
  const lines: SuperWhyLine[] = []
  for (const f of list) {
    const o = asObj(f)
    if (!o) continue
    const when = ts(o.at) ?? ts(o.time)
    const kind = str(o.kind) || str(o.type) || str(o.event) || ''
    const human = str(o.summary) || str(o.detail) || str(o.note) || str(o.message) || str(o.reason) || str(o.text)
    const text = human ? (kind ? `${kind} · ${human}` : human) : (kind || JSON.stringify(o).slice(0, 160))
    lines.push({ at: when, text: text.slice(0, 300) })
  }
  return lines.slice(0, 60)
}

// ---- Provider ----

export class AutoloopProvider extends EventEmitter implements SuperProvider {
  readonly id = 'autoloop'
  readonly label = 'Agent Autoloop'

  private cfg: SuperAgentSettings = { enabled: false, url: '', ownerKey: '', pollMs: 15 }
  private fetchImpl: SuperFetch
  private spawnImpl: SuperSpawn
  private home: string
  private data: SuperProviderData = { decisions: [], work: [], rules: [], history: [], timers: [], spend: null, components: [], pipeline: emptyPipeline(), skipped: [], elsewhere: [], facts: [] }
  /** 真实事实环形队列（最近 12 条），随快照交给渲染层播放流动动画 */
  private facts: SuperFactPulse[] = []
  private connected = false
  private detail: string | null = null
  private seq: number | null = null
  /** 历史分页游标（null = 没有更早的了；undefined 未取过） */
  private nextBefore: number | null = null
  private updatedAt: number | null = null
  private timer: NodeJS.Timeout | null = null
  private watcher: ReturnType<typeof watch> | null = null
  private watchDebounce: NodeJS.Timeout | null = null
  private inFlight: Promise<void> | null = null
  private cliState: 'unknown' | 'yes' | 'no' = 'unknown'
  private cliProbedAt = 0
  private mode: SuperProviderStatus['mode'] = 'off'
  private base: string | null = null
  // SSE 增量流（官方为看板设计的 /v1/stream）：变更秒级可见，轮询退为兜底
  private streamLive = false
  private streamAbort: AbortController | null = null
  private streamTimer: NodeJS.Timeout | null = null
  private streamSeq = 0
  private streamRetry = 0
  private refreshDeb: NodeJS.Timeout | null = null
  private tickCount = 0

  constructor(opts: AutoloopProviderOptions) {
    super()
    this.fetchImpl = opts.fetchImpl
    this.spawnImpl = opts.spawnImpl
    this.home = opts.homeDir || AUTOLOOP_HOME()
  }

  /** 配置更新（save-state / 启动装载）。enabled 变化即时启停；地址/密钥变化重建流。 */
  configure(cfg: Partial<SuperAgentSettings>): void {
    const prevEnabled = this.cfg.enabled
    const prevTarget = `${this.cfg.url}|${this.cfg.ownerKey}`
    const prevPoll = this.cfg.pollMs
    this.cfg = { ...this.cfg, ...cfg }
    this.resolveBase()
    if (this.cfg.enabled && !prevEnabled) this.start()
    if (!this.cfg.enabled && prevEnabled) this.stop()
    // pollMs 变化时重建轮询定时器（start 有幂等守卫，不重排就永远是旧间隔——实测踩过）
    if (this.timer && this.cfg.pollMs !== prevPoll) {
      clearInterval(this.timer)
      this.armInterval()
    }
    const nextTarget = `${this.cfg.url}|${this.cfg.ownerKey}`
    if (prevTarget !== nextTarget && this.cfg.enabled && this.timer) {
      this.teardownStream()
      void this.connectStream()
    }
  }

  /** 轮询定时器装配（start 与 configure 共用；流在线时退为 12 倍间隔兜底） */
  private armInterval(): void {
    this.timer = setInterval(() => {
      if (this.streamLive && this.tickCount++ % 12 !== 0) return
      void this.refresh()
    }, clampPollSec(this.cfg.pollMs) * 1000)
    this.timer.unref?.()
  }

  private resolveBase(): void {
    this.base = normalizeBase(this.cfg.url) || normalizeBase(discoverAutoloopUrl(this.home) || '')
  }

  status(): SuperProviderStatus {
    return {
      id: this.id,
      label: this.label,
      connected: this.connected,
      live: this.streamLive,
      hubDetected: autoloopInstalled(this.home),
      mode: this.mode,
      url: this.base,
      detail: this.detail,
      keyConfigured: !!this.cfg.ownerKey,
      updatedAt: this.updatedAt
    }
  }

  collect(): SuperProviderData {
    // facts 是独立维护的最新队列：与 data 一起交给渲染层（data 本身由全量 state 归一化得到）
    return { ...this.data, facts: this.facts.slice(-12) }
  }

  start(): void {
    if (this.timer) return
    // 定期轮询（SSE 流/目录监听只是加速，轮询是兜底——前者在远程中台/受限环境可能不可用）
    this.armInterval()
    this.attachWatcher()
    void this.refresh()
    void this.connectStream()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.watchDebounce) clearTimeout(this.watchDebounce)
    this.watchDebounce = null
    this.watcher?.close()
    this.watcher = null
    this.teardownStream()
  }

  /** 供测试：直接跑一次拉取（跳过定时器） */
  pollOnce(): Promise<void> {
    return this.refresh()
  }

  /** 本机目录变更触发（去抖 400ms）。目录不存在时静默跳过。 */
  private attachWatcher(): void {
    if (this.watcher || !autoloopInstalled(this.home)) return
    try {
      this.watcher = watch(this.home, () => {
        if (this.watchDebounce) clearTimeout(this.watchDebounce)
        this.watchDebounce = setTimeout(() => { void this.refresh() }, 400)
        this.watchDebounce.unref?.()
      })
      // unref：不让目录监听单独吊住事件循环（脚本型消费 provider 时进程退不出去，实测踩过）
      this.watcher.unref?.()
      this.watcher.on('error', () => { /* 监听失败静默降级为纯轮询 */ })
    } catch {
      this.watcher = null
    }
  }

  // ---- SSE 增量流（GET /v1/stream?after=<seq>，官方语义：先取状态再从 seq 接着读，不漏不重） ----

  /** 连接增量流。fact 到达只当"变更信号"（去抖后拉全量 state）——不做增量应用，简单且不会算错。 */
  private async connectStream(): Promise<void> {
    if (!this.base || !this.cfg.ownerKey) return
    const ac = new AbortController()
    this.streamAbort = ac
    // after=0 会全量重放历史事实：给 2 秒追赶窗口，期间只推进水位不触发刷新。
    // 本地/局域网中台重放毫秒级；极端大历史下多出的几次 refresh 无害（refresh 本就是幂等全量拉取）。
    const catchupUntil = Date.now() + 2000
    try {
      const res = await this.fetchImpl(`${this.base}/v1/stream?after=${this.streamSeq}`, {
        headers: { Authorization: `Bearer ${this.cfg.ownerKey}` },
        signal: ac.signal
      })
      if (!res.ok || !res.body) { this.scheduleStreamRetry(); return }
      this.streamLive = true
      this.streamRetry = 0
      this.emit('change')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          this.handleStreamBlock(block, catchupUntil)
        }
      }
    } catch {
      /* aborted（stop/换目标）或网络断开：走重连 */
    }
    if (this.streamAbort === ac) {
      this.streamLive = false
      this.emit('change')
      this.scheduleStreamRetry()
    }
  }

  private handleStreamBlock(block: string, catchupUntil: number): void {
    let seq = 0
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) {
        const n = Number(line.slice(3).trim())
        if (Number.isFinite(n) && n > this.streamSeq) this.streamSeq = n
        if (Number.isFinite(n)) seq = n
      } else if (line.startsWith('data:')) {
        data += line.slice(5).trim()
      }
    }
    // 追赶窗口（after=0 的历史重放）只推进水位：不播动画、不触发刷新
    if (Date.now() < catchupUntil) return
    // 真实事实 → 动画脉冲。Fact 形状：{ version, seq, at, type, changes }（type 是上游输入类型）
    if (data && seq > 0) {
      let fact: { type?: unknown; changes?: unknown } | null = null
      try { fact = JSON.parse(data) as { type?: unknown; changes?: unknown } } catch { /* 非 JSON 事实只当变更信号 */ }
      const type = fact ? String(fact.type || '') : ''
      if (type) {
        const last = this.facts[this.facts.length - 1]
        if (!last || seq > last.seq) {
          // 从 changes 提取这条事实真实作用的规则 / 事项 / 来源（动画落到对应规则行）
          let rule: string | null = null
          let lane: string | null = null
          let source: string | null = null
          for (const ch of asArr(fact?.changes)) {
            const o = asObj(ch)
            const row = asObj(o?.row)
            if (!row) continue
            const table = str(o?.table)
            if ((table === 'runs' || table === 'cards') && !rule) {
              rule = str(row.rule)
              lane = str(row.lane)
            }
            if (table === 'events' && !source) source = str(row.source)
          }
          this.facts.push({ seq, type, at: Date.now(), rule, lane, source })
          if (this.facts.length > 12) this.facts.splice(0, this.facts.length - 12)
          // 立即广播：动画不等全量刷新（这才是"实时看到管道在流"）
          this.emit('change')
        }
      }
    }
    // 去抖 200ms 合并成一次全量拉取（动画靠上面的 facts，刷新只为更新计数/列表）
    if (this.refreshDeb) return
    this.refreshDeb = setTimeout(() => { this.refreshDeb = null; void this.refresh() }, 200)
    this.refreshDeb.unref?.()
  }

  /** 断线重连：1s 起指数退避、上限 30s；连上即归零（stop 后不再排程） */
  private scheduleStreamRetry(): void {
    if (!this.timer || this.streamTimer) return
    const delay = Math.min(30000, 1000 * 2 ** this.streamRetry++)
    this.streamTimer = setTimeout(() => { this.streamTimer = null; void this.connectStream() }, delay)
    this.streamTimer.unref?.()
  }

  private teardownStream(): void {
    this.streamAbort?.abort()
    this.streamAbort = null
    if (this.streamTimer) clearTimeout(this.streamTimer)
    this.streamTimer = null
    if (this.refreshDeb) clearTimeout(this.refreshDeb)
    this.refreshDeb = null
    this.streamLive = false
    this.streamRetry = 0
  }

  async refresh(): Promise<void> {
    // 并发调用（定时器/目录触发/手动刷新撞车）共享同一次拉取：手动刷新绝不能被静默吞掉
    if (this.inFlight) return this.inFlight
    const p = this.doRefresh().finally(() => { this.inFlight = null })
    this.inFlight = p
    return p
  }

  private async doRefresh(): Promise<void> {
    this.resolveBase()
    if (this.base && this.cfg.ownerKey) {
      await this.refreshHttp()
    } else {
      await this.refreshCli()
    }
  }

  private async refreshHttp(): Promise<void> {
    this.mode = 'http'
    try {
      const res = await this.fetchImpl(`${this.base}/v1/state`, { headers: { Authorization: `Bearer ${this.cfg.ownerKey}` } })
      if (res.status === 401 || res.status === 403) {
        this.setOffline(`本人密钥被拒绝（${res.status}）——请检查设置里的密钥`)
        return
      }
      if (!res.ok) {
        this.setOffline(`中台返回 ${res.status}`)
        return
      }
      const raw = JSON.parse(await res.text()) as unknown
      this.applyState(raw, `本人密钥直连${this.seq !== null ? ` · seq ${this.seq}` : ''}`)
    } catch (e) {
      // 网络失败时降级尝试 CLI（本机装了且没配密钥的场景已在 refresh 分流；这里只兜"配了密钥但中台搬家"）
      this.setOffline(`连不上中台：${String((e as Error)?.message || e).slice(0, 120)}`)
    }
  }

  private async refreshCli(): Promise<void> {
    const available = await this.probeCli()
    if (!available) {
      this.mode = 'off'
      if (this.base) {
        this.setOffline('未配置本人密钥——只读兜底不可用（未检测到 agent-autoloop 命令）')
      } else {
        this.setOffline(null) // 未安装是正常态，不算错误
      }
      return
    }
    this.mode = 'cli'
    try {
      const r = await this.spawnImpl(['status', '--json'])
      if (r.code !== 0) {
        this.setOffline(`agent-autoloop status 退出码 ${r.code}${r.stderr ? `：${r.stderr.slice(0, 120)}` : ''}`)
        return
      }
      const text = r.stdout
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) {
        this.setOffline('CLI 输出不是 JSON（版本过旧？需要支持 --json 的版本）')
        return
      }
      const raw = JSON.parse(text.slice(start, end + 1)) as unknown
      this.applyState(raw, '命令行只读（配置本人密钥后可拍板）')
    } catch (e) {
      this.setOffline(`CLI 拉取失败：${String((e as Error)?.message || e).slice(0, 120)}`)
    }
  }

  private applyState(raw: unknown, modeLabel: string): void {
    this.data = normalizeAutoloopState(raw, Date.now())
    const seq = num(asObj(raw)?.seq)
    this.seq = seq
    this.nextBefore = num(asObj(raw)?.nextBefore)
    this.connected = true
    this.detail = `${modeLabel}${this.streamLive ? ' · 实时流' : ''}`
    this.updatedAt = Date.now()
    this.emit('change')
  }

  private setOffline(detail: string | null): void {
    const wasConnected = this.connected
    this.connected = false
    this.detail = detail
    this.updatedAt = Date.now()
    // 清空数据与否：离线保留最后一帧（渲染层显示"数据截至 xx:xx"比闪成空列表诚实），
    // 但从"在线→离线"的跳变必须广播一次让 UI 更新状态条。
    if (wasConnected || this.data.decisions.length > 0) this.emit('change')
  }

  /** CLI 可用性探测（结果缓存 10 分钟，避免未安装时空转 spawn） */
  private async probeCli(): Promise<boolean> {
    const now = Date.now()
    if (this.cliState !== 'unknown' && now - this.cliProbedAt < 10 * 60 * 1000) return this.cliState === 'yes'
    try {
      const r = await this.spawnImpl(['--version'])
      this.cliState = r.code === 0 ? 'yes' : 'no'
    } catch {
      this.cliState = 'no'
    }
    this.cliProbedAt = now
    return this.cliState === 'yes'
  }

  // ---- 动作（仅 HTTP 直连；不把用户文本拼进命令行） ----

  private async post(path: string, body: Record<string, unknown>): Promise<SuperActionResult> {
    if (!this.base || !this.cfg.ownerKey) {
      return { ok: false, error: '需要先在板块设置里配置中台地址与本人密钥（只读兜底无法执行动作）' }
    }
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.ownerKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const t = await res.text()
        let msg = t.slice(0, 200)
        try { msg = str(asObj(JSON.parse(t))?.error) || msg } catch { /* 保留原文 */ }
        return { ok: false, error: `中台返回 ${res.status}${msg ? `：${msg}` : ''}` }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: `请求失败：${String((e as Error)?.message || e).slice(0, 160)}` }
    }
  }

  async answer(cardId: number, choice?: number, text?: string): Promise<SuperActionResult> {
    const body: Record<string, unknown> = {}
    if (typeof choice === 'number') body.choice = choice
    else if (text) body.text = text.slice(0, 4000)
    else return { ok: false, error: '回答内容为空' }
    const r = await this.post(`/v1/cards/${cardId}/answer`, body)
    if (r.ok) void this.refresh()
    return r
  }

  async resolve(cardId: number, reason: string): Promise<SuperActionResult> {
    const r = await this.post(`/v1/cards/${cardId}/resolve`, { reason: reason.slice(0, 500) || '无需决定' })
    if (r.ok) void this.refresh()
    return r
  }

  async stopRun(runId: number): Promise<SuperActionResult> {
    const r = await this.post(`/v1/runs/${runId}/cancel`, {})
    if (r.ok) void this.refresh()
    return r
  }

  async ruleAction(rule: string, action: 'pause' | 'resume' | 'run', opts?: { reason?: string }): Promise<SuperActionResult> {
    const body: Record<string, unknown> = {}
    if (action === 'pause' && opts?.reason) body.reason = opts.reason.slice(0, 300)
    if (action === 'run' && opts?.reason) body.reason = opts.reason.slice(0, 300)
    const r = await this.post(`/v1/rules/${encodeURIComponent(rule)}/${action}`, body)
    if (r.ok) void this.refresh()
    return r
  }

  /** 补跑暂停期间跳过的事件（协议：POST /v1/rules/<名>/replay {since}，since 必须带时区） */
  async ruleReplay(rule: string, since: string): Promise<SuperActionResult> {
    if (!since) return { ok: false, error: '缺少暂停起点（since）' }
    const r = await this.post(`/v1/rules/${encodeURIComponent(rule)}/replay`, { since })
    if (r.ok) void this.refresh()
    return r
  }

  /** 历史分页：GET /v1/state?before=<nextBefore>（中台一次 60 轮，返回更早的一页） */
  async historyMore(): Promise<{ ok: boolean; items?: SuperHistoryItem[]; nextBefore?: number | null; error?: string }> {
    if (!this.base || !this.cfg.ownerKey) return { ok: false, error: '需要配置本人密钥' }
    if (this.nextBefore === null) return { ok: true, items: [], nextBefore: null }
    try {
      const res = await this.fetchImpl(`${this.base}/v1/state?before=${this.nextBefore}`, {
        headers: { Authorization: `Bearer ${this.cfg.ownerKey}` }
      })
      if (!res.ok) return { ok: false, error: `中台返回 ${res.status}` }
      const raw = JSON.parse(await res.text()) as unknown
      const data = normalizeAutoloopState(raw, Date.now())
      this.nextBefore = num(asObj(raw)?.nextBefore)
      return { ok: true, items: data.history, nextBefore: this.nextBefore }
    } catch (e) {
      return { ok: false, error: `请求失败：${String((e as Error)?.message || e).slice(0, 160)}` }
    }
  }

  async why(runId: number): Promise<{ ok: boolean; lines?: SuperWhyLine[]; error?: string }> {
    if (!this.base || !this.cfg.ownerKey) return { ok: false, error: '需要配置本人密钥才能查看来龙去脉' }
    try {
      const res = await this.fetchImpl(`${this.base}/v1/runs/${runId}/why`, { headers: { Authorization: `Bearer ${this.cfg.ownerKey}` } })
      if (!res.ok) return { ok: false, error: `中台返回 ${res.status}` }
      return { ok: true, lines: normalizeAutoloopWhy(JSON.parse(await res.text())) }
    } catch (e) {
      return { ok: false, error: `请求失败：${String((e as Error)?.message || e).slice(0, 160)}` }
    }
  }
}
