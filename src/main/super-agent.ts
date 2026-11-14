// Super-Agent 板块的服务端核心：把"后台自主循环"（首个提供方 agent-autoloop）折算成
// 归一化快照推给渲染层。设计要点：
// - 提供方抽象（SuperProvider）：Phase 1 只有 autoloop，未来 dsh-superagent 等以同一接口接入，
//   渲染层只见 SuperAgentSnapshot、不见任何提供方词汇。
// - 懒启动：板块未启用时不跑任何定时器/网络请求（常驻顶部小条不容忍后台空转）。
// - fail-open：提供方不可用只影响本板块，绝不影响岛的其它链路。
//
// raw-node 可加载：仅类型导入 protocol + node 内置，运行时依赖全部由 index.ts 注入。

import { EventEmitter } from 'events'
import type {
  SuperActionResult,
  SuperAgentSnapshot,
  SuperComponent,
  SuperDecision,
  SuperElsewhere,
  SuperFactPulse,
  SuperHistoryItem,
  SuperPipeline,
  SuperProviderStatus,
  SuperRule,
  SuperSkippedEvent,
  SuperSpend,
  SuperTimer,
  SuperWhyLine,
  SuperWork
} from '../shared/protocol'

/** 一个后台循环提供方需要交出的归一化数据（status 之外的全部） */
export interface SuperProviderData {
  decisions: SuperDecision[]
  work: SuperWork[]
  rules: SuperRule[]
  history: SuperHistoryItem[]
  timers: SuperTimer[]
  spend: SuperSpend | null
  components: SuperComponent[]
  /** 流水线各阶段真实计数（图标管道点亮用） */
  pipeline: SuperPipeline
  /** 暂停期间被跳过的事件（恢复后可补跑） */
  skipped: SuperSkippedEvent[]
  /** 托管在别处的定时任务 */
  elsewhere: SuperElsewhere[]
  /** 最近真实事实（按 seq 升序，最多 12 条）：驱动流水线的流动动画 */
  facts: SuperFactPulse[]
}

/** Super-Agent 提供方接口（实现方用 EventEmitter 发 'change'）。动作为可选：只读提供方可以不支持。 */
export interface SuperProvider extends EventEmitter {
  readonly id: string
  readonly label: string
  status(): SuperProviderStatus
  collect(): SuperProviderData
  /** 开始周期性拉取（幂等；未启用时是空操作） */
  start(): void
  stop(): void
  /** 拉一次并广播（手动刷新/动作后调用） */
  refresh(): Promise<void>
  /** 回答一张待拍板卡片（提供方可不支持） */
  answer?(cardId: number, choice?: number, text?: string): Promise<SuperActionResult>
  /** 结案一张卡片 */
  resolve?(cardId: number, reason: string): Promise<SuperActionResult>
  /** 停掉一轮 */
  stopRun?(runId: number): Promise<SuperActionResult>
  /** 规则动作：暂停/恢复/立即运行 */
  ruleAction?(rule: string, action: 'pause' | 'resume' | 'run', opts?: { reason?: string }): Promise<SuperActionResult>
  /** 补跑暂停期间跳过的事件 */
  ruleReplay?(rule: string, since: string): Promise<SuperActionResult>
  /** 历史分页：加载更早的轮次 */
  historyMore?(): Promise<{ ok: boolean; items?: SuperHistoryItem[]; nextBefore?: number | null; error?: string }>
  /** 一轮的来龙去脉 */
  why?(runId: number): Promise<{ ok: boolean; lines?: SuperWhyLine[]; error?: string }>
}

const EMPTY_PIPELINE: SuperPipeline = {
  sources: 0, rules: 0, pausedRules: 0, queued: 0, retrying: 0, running: 0,
  unknown: 0, doneToday: 0, nothingToday: 0, attention: 0, timers: 0
}

const EMPTY_DATA: SuperProviderData = {
  decisions: [], work: [], rules: [], history: [], timers: [], spend: null, components: [],
  pipeline: EMPTY_PIPELINE, skipped: [], elsewhere: [], facts: []
}

/** 聚合各提供方 → 唯一快照。index.ts 监听 'change' 后 safeSend 推送渲染层。 */
export class SuperAgentStore extends EventEmitter {
  private providers: SuperProvider[] = []

  register(provider: SuperProvider): void {
    this.providers.push(provider)
    provider.on('change', () => this.emit('change'))
  }

  snapshot(): SuperAgentSnapshot {
    const decisions: SuperDecision[] = []
    const work: SuperWork[] = []
    const rules: SuperRule[] = []
    const history: SuperHistoryItem[] = []
    const timers: SuperTimer[] = []
    const components: SuperComponent[] = []
    const facts: SuperFactPulse[] = []
    const skipped: SuperSkippedEvent[] = []
    const elsewhere: SuperElsewhere[] = []
    let spend: SuperSpend | null = null
    // 多提供方时计数相加（Phase 1 只有一个；聚合规则与其它列表一致）
    const pipeline: SuperPipeline = { sources: 0, rules: 0, pausedRules: 0, queued: 0, retrying: 0, running: 0, unknown: 0, doneToday: 0, nothingToday: 0, attention: 0, timers: 0 }
    for (const p of this.providers) {
      const data = p.collect()
      decisions.push(...data.decisions)
      work.push(...data.work)
      rules.push(...data.rules)
      history.push(...data.history)
      timers.push(...data.timers)
      components.push(...data.components)
      facts.push(...data.facts)
      skipped.push(...data.skipped)
      elsewhere.push(...data.elsewhere)
      if (data.spend) spend = data.spend
      for (const k of Object.keys(pipeline) as (keyof SuperPipeline)[]) pipeline[k] += data.pipeline[k] || 0
    }
    // 事实按 seq 升序（多提供方时各自 seq 独立，排序只为渲染稳定；渲染层按 seq 去重播放）
    facts.sort((a, b) => a.seq - b.seq)
    return {
      providers: this.providers.map((p) => p.status()),
      decisions,
      work,
      rules,
      history,
      timers,
      spend,
      components,
      pipeline,
      skipped: skipped.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 20),
      elsewhere,
      facts: facts.slice(-12),
      updatedAt: Date.now()
    }
  }

  async refreshAll(): Promise<void> {
    await Promise.allSettled(this.providers.map((p) => p.refresh()))
  }

  find(providerId: string): SuperProvider | undefined {
    return this.providers.find((p) => p.id === providerId)
  }

  /** 板块整体空数据（未注册任何提供方时渲染层也能拿到合法形状） */
  static emptyData(): SuperProviderData {
    return { ...EMPTY_DATA, decisions: [], work: [], rules: [], history: [], timers: [], components: [] }
  }
}
