// 学习中心：① 间隔重复复习（便签变闪卡，按记忆排期）② 技术雷达（采用/试用/评估/观望）。
// 视觉层已重做到 ui/tokens 设计系统；交互与数据流保持不变。

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { GraduationCap, PartyPopper, Repeat } from 'lucide-react'
import type { StickyNote } from '../types'
import type { SrsCard, Grade } from '../logic/srs'
import { dueCardIds, intervalLabel, schedule, NEW_CARD } from '../logic/srs'
import { Markdown } from './Markdown'
import { Button, EmptyState, IconButton, Input, Segmented } from '../ui/components'
import { Ico } from '../ui/icons'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'

export interface RadarItem { id: number; name: string; ring: 'adopt' | 'trial' | 'assess' | 'hold' }

/** 观望环固定色相（无对应语义令牌，跨主题固定的橙） */
const HOLD_COLOR = 'oklch(0.78 0.13 40)'

const RINGS = [
  { key: 'adopt', label: '采用', outer: 45, mid: 30, color: sem.calm },
  { key: 'trial', label: '试用', outer: 85, mid: 66, color: sem.run },
  { key: 'assess', label: '评估', outer: 120, mid: 103, color: sem.warn },
  { key: 'hold', label: '观望', outer: 150, mid: 136, color: HOLD_COLOR }
] as const

/** 评级按钮语义色：忘了=危险 / 模糊=警示 / 记得=完成 */
const GRADES = [
  { g: 0, label: '忘了', color: sem.danger },
  { g: 1, label: '模糊', color: sem.warn },
  { g: 2, label: '记得', color: sem.calm }
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

  return (
    <div onMouseDown={p.onClose} style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 5vw', background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(5px)', animation: 'ai-fadein .15s ease' }}>
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 92vw)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...surface.overlay() }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `0.5px solid ${hairline(0.1)}` }}>
          <GraduationCap size={15} strokeWidth={1.75} style={{ color: ink(1), flex: 'none' }} />
          <span style={{ ...text.subtitle(), fontWeight: 700 }}>学习中心</span>
          <Segmented
            style={{ marginLeft: 6 }}
            value={tab}
            onChange={setTab}
            options={[
              { key: 'review', label: `复习 ${due.length}`, icon: Repeat },
              { key: 'radar', label: '技术雷达', icon: Ico.radar }
            ]}
          />
          <span style={{ flex: 1 }} />
          <IconButton icon={Ico.close} onClick={p.onClose} title="关闭" size={26} />
        </div>

        <div className="ai-scroll" style={{ overflowY: 'auto', padding: SP.lg, minHeight: 260 }}>
          {tab === 'review' ? (
            !card ? (
              <EmptyState
                icon={PartyPopper}
                title="今天的复习都完成了"
                desc="便签会按记忆强度自动排期，记得越牢间隔越长"
                style={{ margin: '26px 0' }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
                <div style={{ ...text.faint(), fontVariantNumeric: 'tabular-nums' }}>待复习 {due.length} · 第 {(p.srsState[card.id]?.reps || 0) + 1} 次</div>
                <motion.div
                  variants={fadeScaleIn}
                  initial="initial"
                  animate="animate"
                  className="ai-card"
                  onClick={() => setFlip(true)}
                  style={{ minHeight: 150, padding: '18px 16px', cursor: flip ? 'default' : 'pointer', ...surface.card() }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{card.emoji}</span>
                    <span style={{ fontSize: FS.title, fontWeight: 800, color: ink(1) }}>{card.title}</span>
                  </div>
                  {flip ? (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${hairline(0.1)}` }}><Markdown text={card.md} /></div>
                  ) : (
                    <div style={{ marginTop: 20, textAlign: 'center', ...text.faint(), color: ink(4) }}>点击翻面查看内容</div>
                  )}
                </motion.div>
                {flip && (
                  <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', gap: 8 }}>
                    {GRADES.map(({ g, label, color }) => {
                      const nx = schedule(p.srsState[card.id] || NEW_CARD, g, Date.now())
                      return (
                        <div key={g} className="hv" onClick={() => grade(g)} style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: R.md, cursor: 'pointer', background: semBg(color, 0.18), border: `0.5px solid ${semBg(color, 0.45)}` }}>
                          <div style={{ color, fontSize: FS.body, fontWeight: 700 }}>{label}</div>
                          <div style={{ ...text.faint(), fontSize: 9, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>+{intervalLabel(nx.interval)}</div>
                        </div>
                      )
                    })}
                  </motion.div>
                )}
              </div>
            )
          ) : (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
              {/* 雷达图 */}
              <svg viewBox="0 0 300 300" style={{ width: '100%', maxWidth: 320, alignSelf: 'center' }}>
                {[...RINGS].reverse().map((r) => (
                  <g key={r.key}>
                    <circle cx={150} cy={150} r={r.outer} style={{ fill: semBg(r.color, 0.06), stroke: semBg(r.color, 0.28), strokeWidth: 1 }} />
                    <text x={150} y={150 - r.outer + 11} textAnchor="middle" style={{ fill: semBg(r.color, 0.75), fontSize: 8, fontWeight: 700 }}>{r.label}</text>
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
                        <circle cx={x} cy={y} r={4} style={{ fill: r.color }} />
                        <text x={x} y={y - 6} textAnchor="middle" style={{ fill: ink(1), fontSize: 7.5 }}>{it.name.slice(0, 8)}</text>
                      </g>
                    )
                  })
                })}
              </svg>
              {/* 添加 */}
              <div style={{ display: 'flex', gap: 6 }}>
                <Input
                  style={{ flex: 1 }}
                  value={radarName}
                  onChange={setRadarName}
                  onKeyDown={(e) => { if (e.key === 'Enter' && radarName.trim()) { p.onAddRadar(radarName.trim(), 'assess'); setRadarName('') } }}
                  placeholder="添加技术/工具/方法（默认进「评估」）"
                />
                <Button variant="primary" icon={Ico.add} onClick={() => { if (radarName.trim()) { p.onAddRadar(radarName.trim(), 'assess'); setRadarName('') } }} aria-label="添加" />
              </div>
              <div style={text.faint()}>点雷达上的点可在 采用→试用→评估→观望 之间循环</div>
              {/* 列表 */}
              {RINGS.map((r) => {
                const items = p.radar.filter((it) => it.ring === r.key)
                if (!items.length) return null
                return (
                  <div key={r.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ color: r.color, fontSize: FS.tiny, fontWeight: 700, width: 40 }}>{r.label}</span>
                    {items.map((it) => (
                      <span key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: R.pill, background: semBg(r.color, 0.18), color: ink(1), fontSize: FS.tiny }}>
                        {it.name}
                        <span className="hv" onClick={() => p.onRemoveRadar(it.id)} style={{ cursor: 'pointer', color: sem.danger, display: 'flex', alignItems: 'center' }}>
                          <Ico.close size={10} strokeWidth={2} />
                        </span>
                      </span>
                    ))}
                  </div>
                )
              })}
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
