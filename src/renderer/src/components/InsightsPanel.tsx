// 工作节律洞察面板：一句洞察 + 概况卡 + 环形 24h 高效时段热力盘 + 项目环形图 + 7 天趋势。
// 视觉层已重做至设计系统（ui/tokens 层级表面 + lucide 语义图标 + framer-motion 入场）；统计逻辑与数据流不变。
// 纯统计可视化（内联 SVG，fill 用 style + 主题变量保持主题联动）。

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Bot, FileText, ListTodo, Timer } from 'lucide-react'
import type { ActivityEntry, TodoItem } from '../types'
import { buildInsights, hourBand } from '../logic/insights'
import { EmptyState } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, fill, FS, gradient, ink, R, SP, surface, text } from '../ui/tokens'
import { Ico } from '../ui/icons'

const rad = (deg: number): number => (deg * Math.PI) / 180
/** 环形扇区路径（cx,cy 圆心；rIn,rOut 内外半径；起止角度，deg，0=右，顺时针） */
function annular(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number): string {
  const pt = (r: number, a: number): string => `${(cx + r * Math.cos(rad(a))).toFixed(2)},${(cy + r * Math.sin(rad(a))).toFixed(2)}`
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${pt(rOut, a0)} A${rOut},${rOut} 0 ${large} 1 ${pt(rOut, a1)} L${pt(rIn, a1)} A${rIn},${rIn} 0 ${large} 0 ${pt(rIn, a0)} Z`
}

/** 图例小色点 */
const LegendDot = ({ color }: { color: string }): React.JSX.Element => (
  <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flex: 'none' }} />
)

export function InsightsPanel({ todos, activities, pomoDone }: { todos: TodoItem[]; activities: ActivityEntry[]; pomoDone: Record<string, number> }): React.JSX.Element {
  const ins = useMemo(() => buildInsights(todos, activities, pomoDone, Date.now(), 7), [todos, activities, pomoDone])
  const maxHour = Math.max(1, ...ins.hourly)
  const empty = ins.totalActivities === 0 && ins.weekTodos === 0 && ins.weekPomo === 0

  // 项目环形图：取前 5，其余归"其它"
  const donut = useMemo(() => {
    const top = ins.projects.slice(0, 5)
    const rest = ins.projects.slice(5).reduce((s, p) => s + p.count, 0)
    const segs = [...top.map((p) => ({ name: p.proj, value: p.count })), ...(rest ? [{ name: '其它', value: rest }] : [])]
    const total = segs.reduce((s, x) => s + x.value, 0) || 1
    let acc = -90
    return segs.map((s, i) => {
      const sweep = (s.value / total) * 360
      const a0 = acc + 1.5
      const a1 = acc + sweep - 1.5
      acc += sweep
      return { ...s, a0, a1: Math.max(a0, a1), hue: i * 42, pct: Math.round((s.value / total) * 100) }
    })
  }, [ins.projects])

  const maxDaily = Math.max(1, ...ins.daily.map((d) => d.todos + d.acts))

  if (empty) {
    return (
      <motion.div
        variants={fadeScaleIn}
        initial={false}
        animate="animate"
        className="ai-card"
        style={{ ...surface.card(), padding: `${SP.md}px ${SP.md + 1}px` }}
      >
        <EmptyState
          icon={Ico.trend}
          title="工作节律洞察"
          desc="还没有足够数据。完成待办、跑 Agent 会话、走几个番茄钟后，这里会显示你的高效时段、项目分布与本周趋势。"
          style={{ border: 'none', background: 'transparent', padding: `${SP.lg}px ${SP.sm}px` }}
        />
      </motion.div>
    )
  }

  return (
    <motion.div
      variants={fadeScaleIn}
      initial={false}
      animate="animate"
      className="ai-card"
      style={{
        ...surface.card(),
        padding: `${SP.md + 1}px ${SP.md + 2}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: SP.md
      }}
    >
      {/* 标题 + 一句洞察 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Ico.trend size={13} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
          <span style={{ ...text.subtitle(), fontSize: FS.body }}>工作节律洞察</span>
          <span style={{ ...text.faint(), marginLeft: 'auto' }}>近 7 天</span>
        </div>
        <div style={{ ...text.dim(), lineHeight: 1.5 }}>{ins.headline}</div>
      </div>

      {/* 概况卡 */}
      <div style={{ display: 'flex', gap: 7 }}>
        {[
          { n: ins.weekPomo, l: '番茄', Icon: Timer, c: accent() },
          { n: ins.weekTodos, l: '待办', Icon: ListTodo, c: ink(2) },
          { n: ins.weekFiles, l: '文件', Icon: FileText, c: ink(2) },
          { n: ins.totalActivities, l: '会话', Icon: Bot, c: ink(2) }
        ].map((s, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              padding: '8px 9px',
              borderRadius: R.md,
              background: fill(2),
              display: 'flex',
              flexDirection: 'column',
              gap: 3
            }}
          >
            <span style={{ ...text.num(17), lineHeight: 1, color: i === 0 ? accent() : ink(1) }}>{s.n}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3.5, color: ink(3), fontSize: FS.tiny - 1 }}>
              <s.Icon size={10} strokeWidth={1.75} style={{ color: s.c, flex: 'none' }} />
              {s.l}
            </span>
          </div>
        ))}
      </div>

      {/* 环形 24h 热力盘 + 项目环形图 并排 */}
      <div style={{ display: 'flex', gap: 10 }}>
        {/* 24h 高效时段 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <svg viewBox="0 0 120 120" style={{ width: '100%', maxWidth: 128 }}>
            {ins.hourly.map((h, i) => {
              const a0 = -90 + i * 15 + 1
              const a1 = -90 + (i + 1) * 15 - 1
              const intensity = h / maxHour
              const isPeak = i === ins.peakHour
              return (
                <path
                  key={i}
                  d={annular(60, 60, 34, 54, a0, a1)}
                  style={{ fill: isPeak ? accent() : accent(0.62, 0.14 + intensity * 0.8) }}
                />
              )
            })}
            {/* 刻度：0/6/12/18 */}
            {[['0', 60, 14], ['12', 60, 112], ['6', 112, 63], ['18', 12, 63]].map(([t, x, y]) => (
              <text key={t as string} x={x as number} y={y as number} textAnchor="middle" style={{ fill: ink(3), fontSize: 7 }}>{t}</text>
            ))}
            <text x="60" y="57" textAnchor="middle" style={{ fill: ink(1), fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{ins.peakHour >= 0 ? `${ins.peakHour}:00` : '—'}</text>
            <text x="60" y="69" textAnchor="middle" style={{ fill: ink(3), fontSize: 7.5 }}>高效时段</text>
          </svg>
          <span style={{ ...text.faint(), color: ink(2) }}>你在 <b style={{ color: accent(0.86), fontWeight: 700 }}>{hourBand(ins.peakHour)}</b> 最活跃</span>
        </div>

        {/* 项目环形图 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {donut.length ? (
            <>
              <svg viewBox="0 0 120 120" style={{ width: '100%', maxWidth: 128 }}>
                {donut.map((s, i) => (
                  <path key={i} d={annular(60, 60, 34, 54, s.a0, s.a1)} style={{ fill: `oklch(0.7 calc(0.14 * var(--cs, 1)) calc(var(--th) + ${s.hue}))` }} />
                ))}
                <text x="60" y="57" textAnchor="middle" style={{ fill: ink(1), fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{ins.projects.length}</text>
                <text x="60" y="69" textAnchor="middle" style={{ fill: ink(3), fontSize: 7.5 }}>个项目</text>
              </svg>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', justifyContent: 'center' }}>
                {donut.slice(0, 4).map((s, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9 }}>
                    <LegendDot color={`oklch(0.7 calc(0.14 * var(--cs, 1)) calc(var(--th) + ${s.hue}))`} />
                    <span style={{ color: ink(2), maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ ...text.faint(), padding: '30px 0' }}>暂无项目数据</div>
          )}
        </div>
      </div>

      {/* 7 天趋势：待办（亮）叠加会话（暗）堆叠柱 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ink(2), fontSize: FS.tiny }}>
          <span style={{ fontWeight: 600 }}>7 天趋势</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><LegendDot color={accent(0.78)} />待办</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><LegendDot color={accent(0.5, 0.6)} />会话</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 46 }}>
          {ins.daily.map((d) => {
            const total = d.todos + d.acts
            const hPct = (total / maxDaily) * 100
            const isToday = d.key === ins.daily[ins.daily.length - 1].key
            return (
              <div key={d.key} title={`${d.key} · 待办 ${d.todos} · 会话 ${d.acts}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                {total > 0 && <span style={{ fontSize: 8, color: ink(3), fontVariantNumeric: 'tabular-nums' }}>{total}</span>}
                <div style={{ width: '100%', maxWidth: 20, height: `${Math.max(total ? 10 : 3, hPct)}%`, borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: total ? undefined : fill(2), opacity: isToday ? 1 : 0.82 }}>
                  {total > 0 && <>
                    <div style={{ height: `${(d.acts / total) * 100}%`, background: accent(0.5, 0.55) }} />
                    <div style={{ height: `${(d.todos / total) * 100}%`, background: gradient.primary() }} />
                  </>}
                </div>
                <span style={{ color: isToday ? accent(0.85) : ink(4), fontSize: 8, fontWeight: isToday ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{d.key.slice(8)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
