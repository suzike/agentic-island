// 学习中心：① 间隔重复复习（便签变闪卡，按记忆排期）② 技术雷达（采用/试用/评估/观望）。

import { useMemo, useState } from 'react'
import type { StickyNote } from '../types'
import type { SrsCard, Grade } from '../logic/srs'
import { dueCardIds, intervalLabel, schedule, NEW_CARD } from '../logic/srs'
import { Markdown } from './Markdown'

export interface RadarItem { id: number; name: string; ring: 'adopt' | 'trial' | 'assess' | 'hold' }

const RINGS = [
  { key: 'adopt', label: '采用', outer: 45, mid: 30, hue: 145 },
  { key: 'trial', label: '试用', outer: 85, mid: 66, hue: 200 },
  { key: 'assess', label: '评估', outer: 120, mid: 103, hue: 75 },
  { key: 'hold', label: '观望', outer: 150, mid: 136, hue: 30 }
] as const

interface Props {
  open: boolean
  onClose: () => void
  notes: StickyNote[]
  srsState: Record<number, SrsCard>
  onGrade: (noteId: number, grade: Grade) => void
  radar: RadarItem[]
  onAddRadar: (name: string, ring: RadarItem['ring']) => void
  onCycleRadar: (id: number) => void
  onRemoveRadar: (id: number) => void
}

export function LearnCenter(p: Props): React.JSX.Element | null {
  const [tab, setTab] = useState<'review' | 'radar'>('review')
  const [flip, setFlip] = useState(false)
  const [radarName, setRadarName] = useState('')

  const due = useMemo(() => {
    const now = Date.now()
    return dueCardIds(p.notes.map((n) => n.id), p.srsState, now).map((id) => p.notes.find((n) => n.id === id)!).filter(Boolean)
  }, [p.notes, p.srsState])

  if (!p.open) return null

  const card = due[0]
  const grade = (g: Grade): void => { if (card) { p.onGrade(card.id, g); setFlip(false) } }

  const tabBtn = (k: 'review' | 'radar', label: string): React.JSX.Element => (
    <div className="hv" onClick={() => setTab(k)} style={{ padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: tab === k ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .22)' : 'transparent', color: tab === k ? 'oklch(0.88 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.72 0.02 var(--th) / .7)' }}>{label}</div>
  )

  return (
    <div onMouseDown={p.onClose} style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 5vw', background: 'oklch(0.08 0.02 var(--ths) / .6)', backdropFilter: 'blur(5px)', animation: 'ai-fadein .15s ease' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(560px, 92vw)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden', background: 'oklch(calc(0.16 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .99)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .32)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          <span style={{ fontSize: 15 }}>🎓</span>
          <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 13.5, fontWeight: 700 }}>学习中心</span>
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.05)', borderRadius: 9, padding: 2, marginLeft: 6 }}>
            {tabBtn('review', `复习 ${due.length}`)}{tabBtn('radar', '技术雷达')}
          </div>
          <span style={{ flex: 1 }} />
          <div className="hv" onClick={p.onClose} style={{ cursor: 'pointer', color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 15 }}>✕</div>
        </div>

        <div className="ai-scroll" style={{ overflowY: 'auto', padding: 16, minHeight: 260 }}>
          {tab === 'review' ? (
            !card ? (
              <div style={{ textAlign: 'center', padding: '50px 0', color: 'oklch(0.72 0.02 var(--th) / .75)' }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>🎉</div>
                <div style={{ fontSize: 13 }}>今天的复习都完成了</div>
                <div style={{ fontSize: 11, color: 'oklch(0.6 0.02 var(--th) / .55)', marginTop: 5 }}>便签会按记忆强度自动排期,记得越牢间隔越长</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10.5 }}>待复习 {due.length} · 第 {(p.srsState[card.id]?.reps || 0) + 1} 次</div>
                <div onClick={() => setFlip(true)} style={{ minHeight: 150, padding: '18px 16px', borderRadius: 14, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)', cursor: flip ? 'default' : 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{card.emoji}</span>
                    <span style={{ color: 'oklch(0.95 0.02 var(--th))', fontSize: 15, fontWeight: 800 }}>{card.title}</span>
                  </div>
                  {flip ? (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.08)' }}><Markdown text={card.md} /></div>
                  ) : (
                    <div style={{ marginTop: 20, textAlign: 'center', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11 }}>点击翻面查看内容</div>
                  )}
                </div>
                {flip && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([[0, '忘了', 25], [1, '模糊', 75], [2, '记得', 145]] as const).map(([g, label, hue]) => {
                      const nx = schedule(p.srsState[card.id] || NEW_CARD, g, Date.now())
                      return (
                        <div key={g} className="hv" onClick={() => grade(g)} style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 10, cursor: 'pointer', background: `oklch(0.4 0.1 ${hue} / .35)`, border: `1px solid oklch(0.65 0.13 ${hue} / .4)` }}>
                          <div style={{ color: `oklch(0.86 0.13 ${hue})`, fontSize: 12.5, fontWeight: 700 }}>{label}</div>
                          <div style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 8.5, marginTop: 2 }}>+{intervalLabel(nx.interval)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 雷达图 */}
              <svg viewBox="0 0 300 300" style={{ width: '100%', maxWidth: 320, alignSelf: 'center' }}>
                {[...RINGS].reverse().map((r) => (
                  <g key={r.key}>
                    <circle cx={150} cy={150} r={r.outer} style={{ fill: `oklch(0.4 0.06 ${r.hue} / .06)`, stroke: `oklch(0.6 0.08 ${r.hue} / .25)`, strokeWidth: 1 }} />
                    <text x={150} y={150 - r.outer + 11} textAnchor="middle" style={{ fill: `oklch(0.7 0.08 ${r.hue} / .7)`, fontSize: 8, fontWeight: 700 }}>{r.label}</text>
                  </g>
                ))}
                {RINGS.map((r) => {
                  const items = p.radar.filter((it) => it.ring === r.key)
                  return items.map((it, i) => {
                    const a = (i / items.length) * Math.PI * 2 - Math.PI / 2
                    const x = 150 + r.mid * Math.cos(a)
                    const y = 150 + r.mid * Math.sin(a)
                    return (
                      <g key={it.id} className="hv" onClick={() => p.onCycleRadar(it.id)} style={{ cursor: 'pointer' }}>
                        <circle cx={x} cy={y} r={4} style={{ fill: `oklch(0.75 0.14 ${r.hue})` }} />
                        <text x={x} y={y - 6} textAnchor="middle" style={{ fill: 'oklch(0.86 0.02 var(--th) / .85)', fontSize: 7.5 }}>{it.name.slice(0, 8)}</text>
                      </g>
                    )
                  })
                })}
              </svg>
              {/* 添加 */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={radarName} onChange={(e) => setRadarName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && radarName.trim()) { p.onAddRadar(radarName.trim(), 'assess'); setRadarName('') } }} placeholder="添加技术/工具/方法（默认进「评估」）" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11.5, padding: '7px 10px' }} />
                <div className="hv" onClick={() => { if (radarName.trim()) { p.onAddRadar(radarName.trim(), 'assess'); setRadarName('') } }} style={{ padding: '0 13px', borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 13, fontWeight: 700 }}>＋</div>
              </div>
              <div style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10 }}>点雷达上的点可在 采用→试用→评估→观望 之间循环</div>
              {/* 列表 */}
              {RINGS.map((r) => {
                const items = p.radar.filter((it) => it.ring === r.key)
                if (!items.length) return null
                return (
                  <div key={r.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ color: `oklch(0.8 0.1 ${r.hue})`, fontSize: 10.5, fontWeight: 700, width: 40 }}>{r.label}</span>
                    {items.map((it) => (
                      <span key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999, background: `oklch(0.35 0.07 ${r.hue} / .4)`, color: 'oklch(0.9 0.02 var(--th))', fontSize: 10.5 }}>
                        {it.name}
                        <span className="hv" onClick={() => p.onRemoveRadar(it.id)} style={{ cursor: 'pointer', color: 'oklch(0.6 0.05 25 / .8)', fontSize: 10 }}>✕</span>
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
