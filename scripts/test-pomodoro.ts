// 番茄钟状态机单测：阶段流转（专注→小憩→…→长休）、轮数累积、剩余时间。
// 运行：node --experimental-strip-types scripts/test-pomodoro.ts

import { DEFAULT_POMO, startWork, nextPhase, remainSecs, fmtMMSS, phaseLabel } from '../src/renderer/src/logic/pomodoro.ts'

let failed = 0
const ok = (c: boolean, m: string): void => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) failed++ }

const cfg = DEFAULT_POMO // work25 brk5 longBrk15 cycle4
const t0 = 1_000_000_000_000

let s = startWork(cfg, t0)
ok(s.phase === 'work' && s.round === 0, '开始 → 专注 round0')
ok(s.endsAt === t0 + 25 * 60000, '专注 25 分钟')
ok(remainSecs(s, t0) === 1500 && fmtMMSS(1500) === '25:00', '剩余 25:00')

s = nextPhase(s, cfg, t0) // work done → round1 → 小憩
ok(s.phase === 'break' && s.round === 1, '第1轮专注完 → 小憩 round1')

s = nextPhase(s, cfg, t0) // break done → work
ok(s.phase === 'work' && s.round === 1, '小憩完 → 专注（round 不变）')

// 连续跑到第 4 轮专注完成 → 长休
s = nextPhase(s, cfg, t0) // r2 break
s = nextPhase(s, cfg, t0) // work
s = nextPhase(s, cfg, t0) // r3 break
s = nextPhase(s, cfg, t0) // work
s = nextPhase(s, cfg, t0) // r4 → longbreak
ok(s.phase === 'longbreak' && s.round === 4, `第4轮完 → 长休（实际 ${phaseLabel(s.phase)} round${s.round}）`)
ok(s.endsAt === t0 + 15 * 60000, '长休 15 分钟')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
