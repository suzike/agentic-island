// 每个 Agent 会话一份工作区基线：会话开始时拍快照，之后每次小结都相对它计算。
// 主进程单例（index.ts 装配），桥与 Codex rollout 跟随共用；会话结束即释放。

import type { ChangeSummary } from '../shared/protocol'
import type { WorktreeBaseline } from './git-baseline'

/** 同时保留的会话上限：防止长时间运行时基线内容无限堆积 */
const MAX_SESSIONS = 8

export class SessionChanges {
  private baselines = new Map<string, Promise<WorktreeBaseline | null>>()
  private capture: (cwd: string) => Promise<WorktreeBaseline | null>
  private diff: (baseline: WorktreeBaseline) => Promise<ChangeSummary | null>

  constructor(
    capture: (cwd: string) => Promise<WorktreeBaseline | null>,
    diff: (baseline: WorktreeBaseline) => Promise<ChangeSummary | null>
  ) {
    this.capture = capture
    this.diff = diff
  }

  /** 会话第一次出现时调用：此刻还没跑任何工具，快照即"Agent 动手前"的工作区 */
  ensure(agentId: string, cwd: string): Promise<void> {
    if (!cwd || this.baselines.has(agentId)) return Promise.resolve()
    if (this.baselines.size >= MAX_SESSIONS) {
      const oldest = this.baselines.keys().next().value
      if (oldest) this.baselines.delete(oldest)
    }
    const pending = this.capture(cwd).catch(() => null)
    this.baselines.set(agentId, pending)
    return pending.then(() => undefined)
  }

  /**
   * 等基线真正落定。必须在"Agent 被允许动手"之前 await：
   * 采集是异步的，若用户在百毫秒内就批准计划，快照可能拍到改动之后的状态，
   * 于是本次产出会被当成基线的一部分而整段丢失。
   */
  async ready(agentId: string, cwd: string): Promise<void> {
    await this.ensure(agentId, cwd)
  }

  /** 相对基线的本次会话改动；拿不到基线时返回 null（不退回"相对 HEAD"以免错误归属） */
  async summary(cwd: string, agentId: string): Promise<ChangeSummary | null> {
    this.ensure(agentId, cwd)
    const baseline = await this.baselines.get(agentId)
    if (!baseline) return null
    return this.diff(baseline).catch(() => null)
  }

  forget(agentId: string): void {
    this.baselines.delete(agentId)
  }
}
