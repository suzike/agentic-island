// 桌宠 RPG：把生产力换算成经验，宠物随等级进化。纯逻辑，可 raw-node 直测。
// XP 来源：完成的番茄 ×10 · 完成的待办 ×5 · 编码会话 ×3（全部复用已有数据，零额外记录）。

export interface PetStage { min: number; emoji: string; name: string }

export const STAGES: PetStage[] = [
  { min: 0, emoji: '🥚', name: '灵卵' },
  { min: 2, emoji: '🐣', name: '初醒' },
  { min: 5, emoji: '🐤', name: '雏形' },
  { min: 9, emoji: '🦊', name: '灵狐' },
  { min: 14, emoji: '🦉', name: '睿智' },
  { min: 20, emoji: '🦅', name: '翱翔' },
  { min: 28, emoji: '🦁', name: '王者' },
  { min: 38, emoji: '🐉', name: '化龙' }
]

export function computeXp(pomoDone: Record<string, number>, doneTodos: number, activities: number): number {
  const pomo = Object.values(pomoDone).reduce((s, v) => s + v, 0)
  return pomo * 10 + doneTodos * 5 + activities * 3
}

/** 累计到达 level 所需 XP（二次增长，越往后越难） */
const xpForLevel = (l: number): number => 20 * l * l

export interface Pet {
  xp: number
  level: number
  emoji: string
  name: string
  stage: number
  /** 距下一级还差 */
  toNext: number
  /** 当前级内进度 0..1 */
  progress: number
}

export function petFrom(xp: number): Pet {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 20))
  const cur = xpForLevel(level)
  const next = xpForLevel(level + 1)
  const stage = STAGES.reduce((acc, s, i) => (level >= s.min ? i : acc), 0)
  return {
    xp,
    level,
    emoji: STAGES[stage].emoji,
    name: STAGES[stage].name,
    stage,
    toNext: next - xp,
    progress: (xp - cur) / (next - cur)
  }
}
