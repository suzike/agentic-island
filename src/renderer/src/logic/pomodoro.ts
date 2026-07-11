// 番茄钟状态机（纯逻辑，可 raw-node 直测）：专注 25 / 小憩 5，每 4 轮长休 15。
// 与专注模式联动：work 阶段静默通知；每完成一个 work 记一次，汇入复盘/洞察。

export type PomoPhase = 'idle' | 'work' | 'break' | 'longbreak'

export interface PomoConfig {
  /** 各阶段分钟数 */
  work: number
  brk: number
  longBrk: number
  /** 多少个专注后进入长休 */
  cycle: number
}

export const DEFAULT_POMO: PomoConfig = { work: 25, brk: 5, longBrk: 15, cycle: 4 }

export interface PomoState {
  phase: PomoPhase
  /** 当前阶段结束时间戳（ms）；idle 时为 0 */
  endsAt: number
  /** 已完成的专注轮数 */
  round: number
}

export const POMO_IDLE: PomoState = { phase: 'idle', endsAt: 0, round: 0 }

export const phaseLabel = (p: PomoPhase): string =>
  p === 'work' ? '专注' : p === 'break' ? '小憩' : p === 'longbreak' ? '长休' : '番茄钟'

export const phaseMinutes = (p: PomoPhase, cfg: PomoConfig): number =>
  p === 'work' ? cfg.work : p === 'longbreak' ? cfg.longBrk : cfg.brk

/** 从空闲开始一个专注 */
export function startWork(cfg: PomoConfig, nowMs: number): PomoState {
  return { phase: 'work', endsAt: nowMs + cfg.work * 60_000, round: 0 }
}

/**
 * 当前阶段自然结束 → 下一阶段。
 * work 完成：round+1，满 cycle 进长休，否则小憩；休息完成：回到专注。
 */
export function nextPhase(s: PomoState, cfg: PomoConfig, nowMs: number): PomoState {
  if (s.phase === 'work') {
    const round = s.round + 1
    const isLong = round % cfg.cycle === 0
    return { phase: isLong ? 'longbreak' : 'break', endsAt: nowMs + (isLong ? cfg.longBrk : cfg.brk) * 60_000, round }
  }
  // break / longbreak / idle → 进入专注（round 累积不清零，跨休息延续当日节奏）
  return { phase: 'work', endsAt: nowMs + cfg.work * 60_000, round: s.round }
}

/** 跳过当前阶段（手动） */
export const skipPhase = nextPhase

/** 剩余秒数 */
export const remainSecs = (s: PomoState, nowMs: number): number =>
  s.phase === 'idle' ? 0 : Math.max(0, Math.ceil((s.endsAt - nowMs) / 1000))

/** mm:ss */
export function fmtMMSS(secs: number): string {
  const m = Math.floor(secs / 60)
  const ss = secs % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
