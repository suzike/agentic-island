// 间隔重复（SM-2 精简版）：便签变闪卡，按记忆强度排下次复习。纯逻辑，可 raw-node 直测。

export interface SrsCard { ease: number; interval: number; due: number; reps: number }

/** 评分：0=忘了 1=模糊 2=记得 */
export type Grade = 0 | 1 | 2

export const NEW_CARD: SrsCard = { ease: 2.5, interval: 0, due: 0, reps: 0 }

const DAY = 86400_000

/** 根据评分算出下次复习安排 */
export function schedule(c: SrsCard, grade: Grade, now: number): SrsCard {
  if (grade === 0) {
    // 忘了：降易度、10 分钟后重来
    return { ease: Math.max(1.3, c.ease - 0.2), interval: 0, due: now + 10 * 60_000, reps: 0 }
  }
  const reps = c.reps + 1
  const ease = Math.max(1.3, c.ease + (grade === 2 ? 0.1 : -0.05))
  let interval: number
  if (c.interval < 1) interval = grade === 2 ? 1 : 0.5
  else interval = c.interval * ease * (grade === 2 ? 1 : 0.6)
  interval = Math.max(0.007, interval)
  return { ease, interval, due: now + interval * DAY, reps }
}

/** 到期（含从未复习的新卡）的便签 id */
export function dueCardIds(noteIds: number[], state: Record<number, SrsCard>, now: number): number[] {
  return noteIds.filter((id) => !state[id] || state[id].due <= now)
}

/** 人类可读的下次复习间隔 */
export function intervalLabel(days: number): string {
  if (days < 1) return `${Math.round(days * 24 * 60)} 分钟`
  if (days < 30) return `${Math.round(days)} 天`
  if (days < 365) return `${Math.round(days / 30)} 个月`
  return `${(days / 365).toFixed(1)} 年`
}
