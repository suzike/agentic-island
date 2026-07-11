// 间隔重复 SM-2 精简版单测。
// 运行：node --experimental-strip-types scripts/test-srs.ts

import { schedule, NEW_CARD, dueCardIds, intervalLabel } from '../src/renderer/src/logic/srs.ts'

let failed = 0
const ok = (c: boolean, m: string): void => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) failed++ }

const now = 1_000_000_000_000
const DAY = 86400_000

// 记得：新卡 → 1 天后
const a = schedule(NEW_CARD, 2, now)
ok(a.reps === 1 && Math.round((a.due - now) / DAY) === 1, '新卡记得 → 约 1 天后')
ok(a.ease > NEW_CARD.ease, '记得 → 易度上升')

// 再次记得 → 间隔拉长
const b = schedule(a, 2, now)
ok(b.due - now > a.due - now, '连续记得 → 间隔变长')

// 忘了 → 10 分钟后重来、reps 归零、易度降
const c = schedule(b, 0, now)
ok(c.reps === 0 && Math.round((c.due - now) / 60000) === 10 && c.ease < b.ease, '忘了 → 10 分钟重来 + 降易度')

// 到期筛选：新卡（无状态）与已到期都算
const state = { 1: { ...NEW_CARD, due: now + DAY }, 2: { ...NEW_CARD, due: now - 100 } }
ok(JSON.stringify(dueCardIds([1, 2, 3], state, now)) === JSON.stringify([2, 3]), '到期筛选（含新卡3、已到期2，排除未到期1）')

ok(intervalLabel(0.5) === '720 分钟' || /分钟/.test(intervalLabel(0.5)), 'intervalLabel 分钟')
ok(intervalLabel(3) === '3 天', 'intervalLabel 天')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
