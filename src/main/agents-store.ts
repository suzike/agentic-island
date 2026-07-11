// 服务端权威状态：维护每个 Agent 会话的展示态，以及"挂起的审批请求"表。
// 挂起请求持有一个 resolve 回调 —— hook 转发脚本的 HTTP 请求会一直阻塞，
// 直到用户在岛上裁决时调用 resolve，从而把决定回传给 CLI。

import { EventEmitter } from 'events'
import { basename } from 'path'
import type { AgentState, Backend, BridgeEvent, ChangeSummary, Decision, IslandSnapshot } from '../shared/protocol'

/** 裁决结果：decision + 可选的回传理由（deny 时会被 Claude Code 采纳并据此调整） */
export interface DecisionResult {
  decision: Decision
  reason?: string
}

interface PendingRequest {
  id: string
  agentId: string
  resolve: (r: DecisionResult) => void
  timer: NodeJS.Timeout
}

const toolLabel = (e: BridgeEvent): string => {
  // Codex 的 rollout/hook 元数据无法区分 CLI 与桌面端（实测 originator 恒为 codex-tui）——
  // 统一标"Codex"，不做无依据的猜测。Claude Code 有 CLAUDE_CODE_ENTRYPOINT 可靠区分。
  if (e.backend === 'codex') return 'Codex'
  const isDesktop = !!e.entry && e.entry !== 'cli'
  return `Claude Code ${isDesktop ? '桌面端' : 'CLI'}`
}

const projOf = (cwd: string): string => {
  if (!cwd) return '~'
  return basename(cwd) || cwd
}

// 用每个会话唯一的 sessionId 标识 Agent（多终端=多个独立会话）；无 sessionId 时退回 cwd
const agentKey = (e: BridgeEvent): string => `${e.backend}:${e.sessionId || e.cwd}`

export class AgentsStore extends EventEmitter {
  private agents = new Map<string, AgentState>()
  private pending = new Map<string, PendingRequest>()
  private seq = 0

  /** 审批默认超时（毫秒）：超时未裁决则 fail-open 回退到 CLI 自身提示 */
  private static APPROVAL_TIMEOUT = 5 * 60 * 1000
  /** 已结束的会话在岛上保留的时长（之后自动隐藏，避免堆积） */
  private static DONE_LINGER = 3 * 60 * 1000

  constructor() {
    super()
    // 定期清扫：已结束超过 DONE_LINGER 的卡片自动消失（窗口还开着的活动会话不受影响）
    const sweeper = setInterval(() => { if (this.prune()) this.emit('change') }, 30000)
    sweeper.unref?.()
  }

  snapshot(): IslandSnapshot {
    return { agents: [...this.agents.values()].sort((a, b) => b.updatedAt - a.updatedAt) }
  }

  private upsertAgent(e: BridgeEvent, patch: Partial<AgentState>): AgentState {
    const key = agentKey(e)
    const prev = this.agents.get(key)
    const next: AgentState = {
      id: key,
      backend: e.backend,
      tool: toolLabel(e),
      proj: projOf(e.cwd),
      status: 'running',
      detail: '',
      updatedAt: Date.now(),
      ...prev,
      ...patch,
      // 记录 CLI 进程 PID（跳转时据此反查终端），保留旧值以防某些事件不带
      ppid: e.ppid || prev?.ppid,
      startedAt: prev?.startedAt || Date.now()
    }
    // 活动轨迹：状态描述变化时记录时间线（取首行，最多 10 条）
    const line = (patch.detail || '').split('\n')[0].trim()
    if (line && line !== (prev?.detail || '').split('\n')[0].trim()) {
      next.history = [...(prev?.history || []), { ts: Date.now(), text: line.slice(0, 80) }].slice(-10)
    }
    this.agents.set(key, next)
    this.prune()
    this.emit('change')
    return next
  }

  // 清理策略：已结束的卡片保留 DONE_LINGER 后隐藏；同时兜底上限 8 个 done。返回是否有删除。
  private prune(): boolean {
    const now = Date.now()
    let removed = false
    const done = [...this.agents.values()].filter((a) => a.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt)
    for (const a of done) {
      if (now - a.updatedAt > AgentsStore.DONE_LINGER) { this.agents.delete(a.id); removed = true }
    }
    done.slice(8).forEach((a) => { if (this.agents.delete(a.id)) removed = true })
    return removed
  }

  /** 处理一条 permission 事件：登记挂起请求并返回一个在用户裁决时 resolve 的 Promise */
  handlePermission(e: BridgeEvent): Promise<DecisionResult> {
    const requestId = `req-${++this.seq}-${Date.now()}`
    return new Promise<DecisionResult>((resolve) => {
      const timer = setTimeout(() => {
        // 超时：fail-open，交回 CLI 自身的权限提示
        this.resolvePending(requestId, 'ask')
      }, AgentsStore.APPROVAL_TIMEOUT)
      // 先登记 pending，再触发 change —— 避免同步监听者在 pending 就绪前就 decide 造成放行落空
      this.pending.set(requestId, { id: requestId, agentId: agentKey(e), resolve, timer })
      this.upsertAgent(e, {
        status: 'needs_approval',
        detail: e.detail || '请求执行命令',
        command: e.command,
        requestId,
        isPlan: !!e.isPlan
      })
    })
  }

  /** 用户在岛上裁决。reason 会作为 deny 理由回传给 CLI（真正的接力 steer） */
  decide(requestId: string, decision: Decision, reason?: string): void {
    this.resolvePending(requestId, decision, reason)
  }

  private resolvePending(requestId: string, decision: Decision, reason?: string): void {
    const p = this.pending.get(requestId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(requestId)
    p.resolve({ decision, reason })

    const agent = this.agents.get(p.agentId)
    if (agent && agent.requestId === requestId) {
      // 裁决后回到 running（allow/ask）或标记已拒绝（deny 仍继续运行，交回 CLI）
      this.agents.set(p.agentId, {
        ...agent,
        status: 'running',
        detail:
          decision === 'deny'
            ? reason
              ? '已把你的意见发给 Agent，正在据此调整…'
              : '已拒绝，已通知 Agent'
            : '已允许，继续执行中…',
        command: undefined,
        requestId: undefined,
        updatedAt: Date.now()
      })
      this.emit('change')
    }
  }

  // 一轮对话结束 → 待命（不是"已完成"，因为会话可能还在继续）
  handleStop(e: BridgeEvent): void {
    const key = agentKey(e)
    const prev = this.agents.get(key)
    if (prev && prev.status === 'needs_approval') return // 别覆盖待审批
    this.upsertAgent(e, {
      status: 'running',
      detail: e.detail || '本轮完成 · 待命中…',
      command: undefined,
      requestId: undefined
    })
  }

  // 会话真正结束 → 立即从岛上移除，不再占位（此前保留 3min，用户希望即时消失）
  handleEnd(e: BridgeEvent): void {
    const key = agentKey(e)
    if (this.agents.delete(key)) this.emit('change')
  }

  /** 补充模型 / token 元信息（Codex rollout 可得），仅合并不改状态 */
  attachMeta(e: BridgeEvent, meta: { model?: string; tokens?: number; contextTokens?: number }): void {
    const key = agentKey(e)
    const agent = this.agents.get(key)
    if (!agent) return
    const next = { ...agent }
    if (meta.model) next.model = meta.model
    if (typeof meta.tokens === 'number') next.tokens = meta.tokens
    if (typeof meta.contextTokens === 'number') next.contextTokens = meta.contextTokens
    this.agents.set(key, next)
    this.emit('change')
  }

  /** Stop 后异步补充真实变更小结 */
  attachSummary(e: BridgeEvent, summary: ChangeSummary): void {
    const key = agentKey(e)
    const agent = this.agents.get(key)
    if (!agent) return
    this.agents.set(key, { ...agent, summary, updatedAt: Date.now() })
    this.emit('change')
  }

  // 需要你注意/等待你输入（如 Agent 反问、需要补充信息）→ 醒目的"等待你回复"态
  handleNotification(e: BridgeEvent): void {
    const key = agentKey(e)
    const prev = this.agents.get(key)
    if (prev && prev.status === 'needs_approval') return // 审批优先，别被覆盖
    const agent = this.upsertAgent(e, { status: 'waiting', detail: e.detail || '等待你的回复…', command: undefined, requestId: undefined })
    // 兜底：等待应持续到你回复（UserPromptSubmit 会清除）；10 分钟仍无任何事件才自动回到待命，防卡死
    const stamp = agent.updatedAt
    setTimeout(() => {
      const cur = this.agents.get(key)
      if (cur && cur.status === 'waiting' && cur.updatedAt === stamp) {
        this.agents.set(key, { ...cur, status: 'running', detail: '待命中…', updatedAt: Date.now() })
        this.emit('change')
      }
    }, 600000)
  }

  handleSession(e: BridgeEvent): void {
    this.upsertAgent(e, { status: 'running', detail: e.detail || '会话已开始，待命中…' })
  }

  /** 终端窗口句柄（hook 异步解析后补报），只更新句柄不改状态 */
  handleTerminfo(e: BridgeEvent): void {
    const key = agentKey(e)
    const prev = this.agents.get(key)
    if (!prev || !e.termHwnd || prev.termHwnd === e.termHwnd) return
    this.agents.set(key, { ...prev, termHwnd: e.termHwnd })
    this.emit('change')
  }

  handlePrompt(e: BridgeEvent): void {
    this.upsertAgent(e, { status: 'running', detail: e.detail || '对话中 · 正在处理你的消息…', summary: undefined })
  }

  handleActivity(e: BridgeEvent): void {
    // 若该会话正处于待审批，不要用活动覆盖审批态
    const key = agentKey(e)
    const prev = this.agents.get(key)
    if (prev && prev.status === 'needs_approval') return
    this.upsertAgent(e, { status: 'running', detail: e.detail || '正在工作…' })
  }
}
