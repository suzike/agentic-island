// 服务端权威状态：维护每个 Agent 会话的展示态，以及"挂起的审批请求"表。
// 挂起请求持有一个 resolve 回调 —— hook 转发脚本的 HTTP 请求会一直阻塞，
// 直到用户在岛上裁决时调用 resolve，从而把决定回传给 CLI。

import { EventEmitter } from 'events'
import { basename } from 'path'
import type { AgentState, Backend, BridgeEvent, ChangeSummary, Decision, IslandSnapshot, ApprovalAuditEntry } from '../shared/protocol'

/** 审批策略钩子（依赖注入，保持本模块 raw-node 可加载）：主进程注入 policyAutoDecision/clearSessionAllows */
export interface PolicyHooks {
  autoDecision?: (agentId: string, command?: string) => ApprovalAuditEntry | null
  /** 命令结果是否值得留作验证证据（内置规则 + 项目自定义，由主进程注入） */
  isVerification?: (command: string, cwd: string) => boolean
  /** 会话第一次出现：此刻还没跑任何工具，可用于拍工作区基线 */
  onSessionStart?: (agentId: string, cwd: string) => void
  onSessionEnd?: (agentId: string) => void
}

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
  /** 事件快照：排队审批被顶上卡片时用于还原展示 */
  detail?: string
  command?: string
  isPlan?: boolean
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
  /** 每会话的审批队列（requestId 有序）：并行工具调用会产生多个挂起审批，卡片展示队首，裁决后依次顶上 */
  private queues = new Map<string, string[]>()
  private policyHooks: PolicyHooks | null = null
  private seq = 0

  /** 注入审批策略钩子（index.ts 装配；测试可不注入 = 无自动放行） */
  setPolicyHooks(hooks: PolicyHooks | null): void {
    this.policyHooks = hooks
  }

  /** 审批默认超时（毫秒）：超时未裁决则 fail-open 回退到 CLI 自身提示 */
  private static APPROVAL_TIMEOUT = 5 * 60 * 1000
  /** 已结束的会话在岛上保留的时长（之后自动隐藏，避免堆积） */
  private static DONE_LINGER = 3 * 60 * 1000
  /**
   * 无活动会话的兜底回收。
   * Codex 关闭窗口不会写 SessionEnd，hook 仍可能留下一张"等待回复/运行中"卡片；
   * 等待态给 10 分钟（足够用户回来接着说），运行态给 60 分钟（避免误删长构建）。
   * Claude Code 有明确的 SessionEnd/Stop，阈值放宽，只清理真正被遗弃的会话。
   */
  private static STALE_IDLE: Record<Backend, number> = {
    codex: 10 * 60 * 1000,
    'claude-code': 60 * 60 * 1000
  }

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
      cwd: e.cwd || prev?.cwd,
      status: 'running',
      detail: '',
      updatedAt: Date.now(),
      ...prev,
      ...patch,
      // 记录 CLI 进程 PID（跳转时据此反查终端），保留旧值以防某些事件不带
      ppid: e.ppid || prev?.ppid,
      startedAt: prev?.startedAt || Date.now()
    }
    // 本轮最终回复：停止/完成事件携带，验收台在会话结束时留档
    if (e.lastReply) next.lastReply = e.lastReply.slice(0, 8000)
    // 验证证据：保留最近 12 条命令结果（跨轮累计，验收时按会话整体看）
    if (e.check && (this.policyHooks?.isVerification?.(e.check.command, e.cwd) ?? true)) {
      next.checks = [...(prev?.checks || []), e.check].slice(-12)
    }
    // 计划全文：ExitPlanMode 的 command 就是计划；同一份计划重复上报时保留原裁决
    if (e.isPlan && e.command) {
      const prevPlan = prev?.plan
      const same = prevPlan?.text === e.command
      next.plan = {
        text: e.command.slice(0, 20000),
        at: same && prevPlan ? prevPlan.at : Date.now(),
        decision: same ? prevPlan?.decision : undefined,
        reason: same ? prevPlan?.reason : undefined
      }
    }
    // 活动轨迹：状态描述变化时记录时间线（取首行，最多 10 条）
    const line = (patch.detail || '').split('\n')[0].trim()
    if (line && line !== (prev?.detail || '').split('\n')[0].trim()) {
      next.history = [...(prev?.history || []), { ts: Date.now(), text: line.slice(0, 80) }].slice(-10)
    }
    this.agents.set(key, next)
    // 会话第一次出现：通知主线拍"Agent 动手前"的工作区基线（失败无副作用）
    if (!prev) {
      // 首个事件不是 SessionStart，说明岛接上时会话已经在跑（Codex 附着旧 rollout 尤其常见）
      next.baselineLate = e.kind !== 'session' || undefined
      this.policyHooks?.onSessionStart?.(key, e.cwd)
    }
    this.prune()
    this.emit('change')
    return next
  }

  // 清理策略：已结束的卡片保留 DONE_LINGER 后隐藏；同时兜底上限 8 个 done。返回是否有删除。
  private prune(): boolean {
    const now = Date.now()
    let removed = false
    // 先回收没有活动、也没有挂起审批的会话。挂起审批必须留着等用户裁决，
    // 其余卡片只要超过阈值就移除；下一次真实事件会按同一个 sessionId 重新建卡。
    for (const [id, agent] of this.agents) {
      if (agent.status === 'done') continue
      if (agent.status === 'needs_approval' && agent.requestId) continue
      const idleLimit = agent.status === 'running'
        ? AgentsStore.STALE_IDLE[agent.backend] * 6
        : AgentsStore.STALE_IDLE[agent.backend]
      if (now - agent.updatedAt <= idleLimit) continue
      const queue = this.queues.get(id)
      if (queue) for (const requestId of [...queue]) this.resolvePending(requestId, 'ask')
      this.queues.delete(id)
      this.agents.delete(id)
      removed = true
    }
    const done = [...this.agents.values()].filter((a) => a.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt)
    for (const a of done) {
      if (now - a.updatedAt > AgentsStore.DONE_LINGER) { this.agents.delete(a.id); removed = true }
    }
    done.slice(8).forEach((a) => { if (this.agents.delete(a.id)) removed = true })
    return removed
  }

  /** 处理一条 permission 事件：先过审批策略（命中即自动放行并记审计），否则登记挂起请求阻塞等待裁决 */
  handlePermission(e: BridgeEvent): Promise<DecisionResult> {
    const agentId = agentKey(e)
    // 策略放行：命中「本会话放行」或用户规则 → 不阻塞，卡片短暂提示后回到运行态
    const auto = this.policyHooks?.autoDecision?.(agentId, e.command) ?? null
    if (auto) {
      this.upsertAgent(e, {
        status: 'running',
        detail: `已按策略自动放行 · ${auto.scope === 'session' ? '本会话放行' : `规则「${auto.rule}」`} · ${auto.command.slice(0, 120)}`,
        command: undefined,
        requestId: undefined
      })
      return Promise.resolve({ decision: 'allow' })
    }
    const requestId = `req-${++this.seq}-${Date.now()}`
    return new Promise<DecisionResult>((resolve) => {
      const timer = setTimeout(() => {
        // 超时：fail-open，交回 CLI 自身的权限提示
        this.resolvePending(requestId, 'ask')
      }, AgentsStore.APPROVAL_TIMEOUT)
      // 先登记 pending，再触发 change —— 避免同步监听者在 pending 就绪前就 decide 造成放行落空
      this.pending.set(requestId, {
        id: requestId, agentId, resolve, timer,
        detail: e.detail, command: e.command, isPlan: !!e.isPlan
      })
      const queue = this.queues.get(agentId) || []
      queue.push(requestId)
      this.queues.set(agentId, queue)
      if (queue.length === 1) {
        this.upsertAgent(e, {
          status: 'needs_approval',
          detail: e.detail || '请求执行命令',
          command: e.command,
          requestId,
          isPlan: !!e.isPlan
        })
      }
      // 队列非 1 说明该会话已有审批在卡片上：新请求排队等待，不覆盖队首（并行工具调用场景）
    })
  }

  /** 用户在岛上裁决。reason 会作为 deny 理由回传给 CLI（真正的接力 steer） */
  decide(requestId: string, decision: Decision, reason?: string): void {
    this.resolvePending(requestId, decision, reason)
  }

  /** 把队首下一条待审批顶上卡片；队列已空则清档并返回 false */
  private promoteNext(agentId: string): boolean {
    const queue = this.queues.get(agentId)
    const next = queue?.find((id) => this.pending.has(id))
    if (!next) {
      this.queues.delete(agentId)
      return false
    }
    const p = this.pending.get(next)
    const agent = this.agents.get(agentId)
    if (!p || !agent) return false
    this.agents.set(agentId, {
      ...agent,
      status: 'needs_approval',
      detail: p.detail || '请求执行命令',
      command: p.command,
      requestId: next,
      isPlan: p.isPlan,
      plan: p.isPlan && p.command ? { text: p.command.slice(0, 20000), at: Date.now() } : agent.plan,
      updatedAt: Date.now()
    })
    this.emit('change')
    return true
  }

  private resolvePending(requestId: string, decision: Decision, reason?: string): void {
    const p = this.pending.get(requestId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(requestId)
    const queue = this.queues.get(p.agentId)
    if (queue) {
      const idx = queue.indexOf(requestId)
      if (idx !== -1) queue.splice(idx, 1)
    }
    p.resolve({ decision, reason })

    const agent = this.agents.get(p.agentId)
    if (agent && agent.requestId === requestId) {
      // 卡片正在展示本条：先让排队中的下一条顶上（保持待审批），没有才回到运行态
      if (this.promoteNext(p.agentId)) return
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
        // 计划裁决留档：验收台据此区分"批过再改"与"打回了却仍有改动"
        plan: p.isPlan && agent.plan
          ? { ...agent.plan, decision, reason: reason?.slice(0, 1000) }
          : agent.plan,
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
    // 会话结束：排队中的审批一并 fail-open（'ask' 交回 CLI 原生提示），避免悬挂到超时才放行
    const queue = this.queues.get(key)
    if (queue) for (const id of [...queue]) this.resolvePending(id, 'ask')
    this.queues.delete(key)
    this.policyHooks?.onSessionEnd?.(key)
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
    // 若该会话正处于待审批，不要用新消息覆盖审批态
    const prev = this.agents.get(agentKey(e))
    if (prev && prev.status === 'needs_approval') return
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
