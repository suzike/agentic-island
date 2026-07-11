// 桌宠 XP/等级/进化单测。
// 运行：node --experimental-strip-types scripts/test-pet.ts

import { computeXp, petFrom, STAGES } from '../src/renderer/src/logic/pet.ts'

let failed = 0
const ok = (c: boolean, m: string): void => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) failed++ }

ok(computeXp({ '2026-07-01': 3 }, 4, 5) === 3 * 10 + 4 * 5 + 5 * 3, 'XP 计算 = 番茄×10+待办×5+会话×3')
ok(computeXp({}, 0, 0) === 0, '零数据 0 XP')

const p0 = petFrom(0)
ok(p0.level === 0 && p0.emoji === '🥚', '0 XP → Lv0 灵卵')
ok(petFrom(19).level === 0 && petFrom(20).level === 1, 'Lv1 阈值=20 XP')
ok(petFrom(80).level === 2, '80 XP → Lv2')

const hi = petFrom(20 * 40 * 40) // Lv40
ok(hi.level === 40 && hi.emoji === '🐉', '高等级 → 化龙')
ok(hi.stage === STAGES.length - 1, '进化到最终阶段')

const p = petFrom(50)
ok(p.progress > 0 && p.progress < 1, '级内进度在 0..1')
ok(p.toNext === 80 - 50, '距下一级差值正确')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
