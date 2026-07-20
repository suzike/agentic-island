// 桌宠成长卡：等级/进化/经验条 + 今日贡献 + 进化路线。生产力越高，宠物越强。

import { useMemo, useState } from 'react'
import type { ActivityEntry, TodoItem } from '../types'
import { computeXp, petFrom, STAGES } from '../logic/pet'
import { dayKey } from '../logic/review'
import { accent, accent2, fill, hairline, ink, tintSurface } from '../ui/tokens'

export function PetPanel({ pomoDone, todos, activities }: { pomoDone: Record<string, number>; todos: TodoItem[]; activities: ActivityEntry[] }): React.JSX.Element {
  const [pat, setPat] = useState(0)
  const doneTodos = useMemo(() => todos.filter((t) => t.done).length, [todos])
  const xp = useMemo(() => computeXp(pomoDone, doneTodos, activities.length), [pomoDone, doneTodos, activities.length])
  const pet = useMemo(() => petFrom(xp), [xp])

  // 今日贡献
  const today = dayKey(Date.now())
  const todayXp = (pomoDone[today] || 0) * 10 +
    todos.filter((t) => t.done && t.doneAt && dayKey(t.doneAt) === today).length * 5 +
    activities.filter((a) => dayKey(a.ts) === today).length * 3

  return (
    <div style={{ padding: '13px 14px', borderRadius: 15, background: `linear-gradient(160deg, ${tintSurface('var(--th)', .62)}, ${tintSurface('var(--th2)', .46, true)})`, border: `0.5px solid ${hairline(.12)}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          className="hv"
          onClick={() => setPat((v) => v + 1)}
          title="摸摸它"
          key={pat}
          style={{ fontSize: 40, lineHeight: 1, cursor: 'pointer', animation: pat ? 'ai-hop .4s ease' : 'ai-hop 2.4s ease-in-out infinite', filter: 'drop-shadow(0 3px 8px oklch(0.5 0.14 var(--th) / .5))' }}
        >{pet.emoji}</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{ color: ink(1), fontSize: 14, fontWeight: 800 }}>{pet.name}</span>
            <span style={{ color: accent(.78), fontSize: 11, fontWeight: 700 }}>Lv.{pet.level}</span>
            <span style={{ flex: 1 }} />
            {todayXp > 0 && <span style={{ color: 'oklch(0.8 0.13 145)', fontSize: 10.5, fontWeight: 700 }}>今日 +{todayXp} XP</span>}
          </div>
          {/* 经验条 */}
          <div style={{ height: 9, borderRadius: 999, background: fill(3), overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(3, Math.min(100, pet.progress * 100))}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${accent2(.72)}, ${accent(.82)})`, transition: 'width .4s' }} />
          </div>
          <span style={{ color: ink(3), fontSize: 9.5 }}>共 {pet.xp} XP · 距下一级还差 {pet.toNext} XP（专注1个番茄=+10）</span>
        </div>
      </div>

      {/* 进化路线 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'space-between' }}>
        {STAGES.map((s, i) => (
          <div key={i} title={i <= pet.stage ? `${s.name} · Lv.${s.min}+（已解锁）` : `${s.name} · Lv.${s.min}+ 解锁`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: i <= pet.stage ? 1 : 0.3, filter: i <= pet.stage ? undefined : 'grayscale(1)' }}>
            <span style={{ fontSize: i === pet.stage ? 18 : 14, lineHeight: 1, transition: 'all .3s' }}>{s.emoji}</span>
            {i === pet.stage && <span style={{ width: 4, height: 4, borderRadius: 999, background: accent(.78) }} />}
          </div>
        ))}
      </div>
    </div>
  )
}
