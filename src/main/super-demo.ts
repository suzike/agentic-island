// 循环分区演示数据（AIISLAND_DEMO_SUPER=1 时由 index.ts 注册）：docs:capture 截图、对比度审计、
// 以及"没装 agent-autoloop 也想先看看这个分区长什么样"的开发预览共用。
// 演示 fixture 直接走真实的 normalizeAutoloopState——演示路径同时就是归一化路径的回归。

import { EventEmitter } from 'events'
import type { SuperProviderStatus } from '../shared/protocol'
import { normalizeAutoloopState } from './autoloop-provider'
import type { SuperProvider, SuperProviderData } from './super-agent'

const iso = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString()

/** 演示用 /v1/state（字段形状与 host/state.ts 的 stateOf 一致）：两张待拍板（一张老卡演示年龄胶囊）、
 *  一轮执行中带 claude:// 会话、一轮停止中、暂停规则、用量含未上报 */
const demoState = (): Record<string, unknown> => ({
  seq: 4821,
  now: iso(0),
  timezone: 'Asia/Shanghai',
  totals: { running: 1, queued: 1, retrying: 1, unknown: 1, done: 6, doneToday: 3, nothing: 2, attention: 3, usage: { input: 64000, output: 12000, cost: 0.18 } },
  cards: [
    {
      id: 56, version: 2, ref: 'om_demo_56', kind: 'ask', state: 'open',
      title: '订单 #1287 怎么发货？',
      text: '两种方式今天都能发出。快递可追踪但贵 12 元，自提需客户到店。',
      options: ['顺丰快递', '门店自提', '顺丰到付'], recommend: 0,
      rule: '订单跟进', lane: '#1287', about: '发货后把物流单号回填到工单',
      link: 'https://shop.example.com/orders/1287', createdAt: iso(-7 * 60_000), decidedAt: null, closedAt: null
    },
    {
      id: 55, version: 1, ref: null, kind: 'ask', state: 'open',
      title: '巡检发现首页 5xx，要重启网关吗？',
      text: '持续 4 分钟，错误率 2.3%，上游服务正常，疑似网关连接池耗尽。',
      options: ['重启网关', '再观察 10 分钟'], recommend: 1,
      rule: '网站巡检', lane: 'prod', about: '重启后 5 分钟复查错误率',
      link: null, createdAt: iso(-42 * 60_000), decidedAt: null, closedAt: null
    },
    {
      id: 54, version: 1, ref: null, kind: 'notice', state: 'open',
      title: '每日早报已生成', text: 'briefs/2026-11-14.md · 整理了 3 条提交与 2 条待办进展。',
      options: ['已处理'], recommend: null, rule: '早报', lane: '', about: null, link: null, createdAt: iso(-3.5 * 3_600_000), decidedAt: null, closedAt: null
    }
  ],
  recentCards: [],
  agents: [
    { id: 'claude', name: 'Claude Code', use: 'claude', worker: 'this-pc', seenAt: iso(-30_000), online: true },
    { id: 'codex', name: 'Codex', use: 'codex', worker: 'this-pc', seenAt: iso(-60_000), online: true },
    { id: 'hermes', name: 'Hermes', use: 'command', worker: 'mac-mini', seenAt: iso(-9 * 60_000), online: false }
  ],
  channels: [
    { id: 'desktop', name: '桌面通知', seenAt: iso(-10_000), online: true },
    // 最近一张卡片投递失败（card 55 = 「巡检发现首页 5xx」）→ 该卡会显示投递告警
    { id: 'feishu', name: '飞书', seenAt: iso(-20_000), online: true, lastFailure: { card: 55, tries: 3, error: 'feishu webhook timeout', givenUp: false } }
  ],
  sources: [
    { id: 'github', name: 'GitHub', events: 128 },
    { id: 'shop', name: '业务系统', events: 34 }
  ],
  lines: [
    { id: '早报', name: '早报', group: '早报', agent: 'claude', source: 'schedule', types: [], every: '每天 08:00', next: iso(19 * 3_600_000), paused: null, skippedAt: null, totals: { running: 0, queued: 0, retrying: 0, done: 6, doneToday: 1, nothing: 0 } },
    { id: '订单跟进', name: '订单跟进', group: '订单跟进', agent: 'hermes', source: 'shop', types: ['order.*'], every: null, next: null, paused: null, skippedAt: null, totals: { running: 1, queued: 0, retrying: 0, done: 14, doneToday: 5, nothing: 0 } },
    { id: '网站巡检', name: '网站巡检', group: '网站巡检', agent: 'codex', source: 'schedule', types: [], every: '每 5 分钟', next: iso(2 * 60_000), paused: null, skippedAt: null, totals: { running: 0, queued: 1, retrying: 1, done: 42, doneToday: 11, nothing: 3 } },
    { id: '处理意见', name: '处理意见', group: '处理意见', agent: 'claude', source: 'github', types: ['issues.opened'], every: null, next: null, paused: { by: 'owner', reason: '等 v2 接口上线', since: iso(-26 * 3_600_000), until: null, skipped: { count: 5, events: [] } }, skippedAt: null }
  ],
  pauses: [{ name: '处理意见', by: 'owner', reason: '等 v2 接口上线', since: iso(-26 * 3_600_000), until: null, skipped: { count: 5, events: [] } }],
  // 暂停「处理意见」期间被跳过的两条事件（恢复后可按 since 补跑）
  skipped: [
    { id: 412, source: 'github', type: 'issues.opened', subject: '#231', summary: '登录页在 Safari 下白屏', paused: '["处理意见"]', receivedAt: iso(-5 * 3_600_000), received_at: iso(-5 * 3_600_000) },
    { id: 411, source: 'github', type: 'issues.opened', subject: '#230', summary: '导出 CSV 缺少 BOM', paused: '["处理意见"]', receivedAt: iso(-7 * 3_600_000) }
  ],
  // 托管在别处的定时任务（Claude 应用里跑，中台只列出）
  elsewhere: [{ id: '周报', name: '周报', source: 'shop', agent: 'claude', cron: '0 18 * * 0', every: '每周日 18:00', next: iso(2 * 86_400_000), where: 'Claude 应用的定时任务' }],
  runs: [
    { id: 214, rule: '订单跟进', agent: 'hermes', state: 'claimed', attempts: 0, createdAt: iso(-6 * 60_000), claimedAt: iso(-5 * 60_000), finishedAt: null, notBefore: null, summary: '正在核对库存与收件地址', error: '', link: 'claude://session/hermes-9f21', session: 'hermes-9f21', usage: null, stopping: false, manual: false },
    { id: 213, rule: '网站巡检', agent: 'codex', state: 'unknown', attempts: 2, createdAt: iso(-12 * 60_000), claimedAt: iso(-11 * 60_000), finishedAt: null, notBefore: iso(4 * 60_000), summary: '', error: '接单程序 5 分钟未报这一轮', link: '', session: 'codex-77', usage: null, stopping: true, manual: false },
    { id: 212, rule: '早报', agent: 'claude', state: 'done', attempts: 0, createdAt: iso(-3.6 * 3_600_000), claimedAt: iso(-3.6 * 3_600_000), finishedAt: iso(-3.5 * 3_600_000), notBefore: null, summary: '早报写入 briefs/2026-11-14.md', error: '', link: 'https://claude.ai/chat/demo', session: 'cc-a03f', usage: { input: 18200, output: 3200, cached: 8400, cost: 0.06 }, stopping: false, manual: false },
    { id: 211, rule: '网站巡检', agent: 'codex', state: 'done', attempts: 0, createdAt: iso(-2.2 * 3_600_000), claimedAt: iso(-2.2 * 3_600_000), finishedAt: iso(-2 * 3_600_000), notBefore: null, summary: '巡检通过 · 首页 200 · 耗时 41s', error: '', link: '', session: 'codex-76', usage: { input: 6900, output: 1200, cached: 0, cost: 0.02 }, stopping: false, manual: false },
    { id: 210, rule: '处理意见', agent: 'claude', state: 'cancelled', attempts: 0, createdAt: iso(-26 * 3_600_000), claimedAt: iso(-25.5 * 3_600_000), finishedAt: iso(-25 * 3_600_000), notBefore: null, summary: '本人停止：等下游修复', error: '', link: '', session: null, usage: null, stopping: false, manual: false }
  ],
  hasMore: false,
  nextBefore: null,
  unrouted: [],
  spending: {
    today: { rounds: 6, tokens: 64_200, cached: 21_300, cost: 0.18, missingTokens: 1, missingCost: 0 },
    week: { rounds: 47, tokens: 512_000, cached: 168_000, cost: 1.42, missingTokens: 4, missingCost: 2 }
  },
  timers: [
    { rule: '网站巡检', lane: 'prod', key: 'recheck', about: '网关重启后复查错误率', at: iso(23 * 60_000) },
    { rule: '订单跟进', lane: '#1287', key: 'ship', about: '等客户确认快递方式', at: iso(2.5 * 3_600_000) }
  ]
})

export class DemoSuperProvider extends EventEmitter implements SuperProvider {
  readonly id = 'autoloop'
  readonly label = 'Agent Autoloop（演示）'
  private last = 0
  /** 演示也用真实事实形状（启动时给一条 started，之后每 6s 轮转一条）给截图/预览看流动 */
  private facts: { seq: number; type: string; at: number }[] = []
  private seq = 0
  private factTimer: NodeJS.Timeout | null = null
  private factCycle = ['ingest', 'started', 'result', 'createCard', 'ask', 'tick']

  status(): SuperProviderStatus {
    return {
      id: this.id,
      label: this.label,
      connected: true,
      live: false,
      hubDetected: true,
      mode: 'http',
      url: 'demo://agent-autoloop',
      detail: '演示模式',
      keyConfigured: true,
      updatedAt: this.last || Date.now()
    }
  }

  collect(): SuperProviderData {
    return { ...normalizeAutoloopState(demoState(), Date.now()), facts: this.facts.slice(-12) }
  }

  async ruleReplay(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: '演示模式：未真实执行' }
  }

  async historyMore(): Promise<{ ok: boolean; items: never[]; nextBefore: null }> {
    return { ok: true, items: [], nextBefore: null }
  }

  start(): void {
    this.last = Date.now()
    // 真实形状的演示事实流（type 与上游 HANDLERS 一致），6s 一条驱动流水线动画
    const push = (): void => {
      this.seq += 1
      this.facts.push({ seq: this.seq, type: this.factCycle[(this.seq - 1) % this.factCycle.length], at: Date.now() })
      if (this.facts.length > 12) this.facts.splice(0, this.facts.length - 12)
      this.emit('change')
    }
    push()
    this.factTimer = setInterval(push, 6000)
    this.factTimer.unref?.()
    this.emit('change')
  }

  stop(): void {
    if (this.factTimer) clearInterval(this.factTimer)
    this.factTimer = null
  }

  async refresh(): Promise<void> {
    this.last = Date.now()
    this.emit('change')
  }

  // 动作在演示模式下"成功"但不产生真实效果
  async answer(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: '演示模式：未真实执行' }
  }

  async resolve(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: '演示模式：未真实执行' }
  }

  async stopRun(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: '演示模式：未真实执行' }
  }

  async ruleAction(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: '演示模式：未真实执行' }
  }

  async why(): Promise<{ ok: boolean; lines?: { at: number | null; text: string }[] }> {
    return {
      ok: true,
      lines: [
        { at: Date.now() - 9 * 60_000, text: 'received · 来源 shop 发来 order.updated #1287' },
        { at: Date.now() - 8 * 60_000, text: 'decided · 规则「订单跟进」接单，事项 #1287' },
        { at: Date.now() - 7 * 60_000, text: 'claimed · worker 领取（Hermes）' },
        { at: Date.now() - 6 * 60_000, text: 'ask · 提问：订单 #1287 怎么发货？（等待回答）' }
      ]
    }
  }
}
