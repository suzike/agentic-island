// 工作节律洞察面板：一句洞察 + 概况卡 + 环形 24h 高效时段热力盘 + 项目环形图 + 7 天趋势。
// 纯统计可视化（内联 SVG，fill 用 style+oklch(var(--th)) 保持主题联动）。

import { useMemo } from 'react'
import type { ActivityEntry, TodoItem } from '../types'
import { buildInsights, hourBand } from '../logic/insights'

const box: React.CSSProperties = {
  padding: '13px 14px', borderRadius: 15, background: 'linear-gradient(160deg, rgba(255,255,255,.045), rgba(255,255,255,.02))',
  border: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 12
}

const rad = (deg: number): number => (deg * Math.PI) / 180
/** 环形扇区路径（cx,cy 圆心；rIn,rOut 内外半径；起止角度，deg，0=右，顺时针） */
function annular(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number): string {
  const pt = (r: number, a: number): string => `${(cx + r * Math.cos(rad(a))).toFixed(2)},${(cy + r * Math.sin(rad(a))).toFixed(2)}`
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${pt(rOut, a0)} A${rOut},${rOut} 0 ${large} 1 ${pt(rOut, a1)} L${pt(rIn, a1)} A${rIn},${rIn} 0 ${large} 0 ${pt(rIn, a0)} Z`
}

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
      <div style={box}>
        <div style={{ color: 'oklch(0.9 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 12.5, fontWeight: 800 }}>📈 工作节律洞察</div>
        <div style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 11, lineHeight: 1.6 }}>还没有足够数据。完成待办、跑 Agent 会话、走几个番茄钟后，这里会显示你的高效时段、项目分布与本周趋势。</div>
      </div>
    )
  }

  return (
    <div style={box}>
      {/* 标题 + 一句洞察 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color: 'oklch(0.93 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 12.5, fontWeight: 800 }}>📈 工作节律洞察</span>
          <span style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9.5 }}>近 7 天</span>
        </div>
        <div style={{ color: 'oklch(0.82 calc(0.05 * var(--cs, 1)) var(--th) / .9)', fontSize: 11, lineHeight: 1.5 }}>{ins.headline}</div>
      </div>

      {/* 概况卡 */}
      <div style={{ display: 'flex', gap: 7 }}>
        {[
          { n: ins.weekPomo, l: '🍅 番茄', h: 30 },
          { n: ins.weekTodos, l: '✓ 待办', h: undefined },
          { n: ins.weekFiles, l: '📄 文件', h: undefined },
          { n: ins.totalActivities, l: '◆ 会话', h: undefined }
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, padding: '8px 9px', borderRadius: 11, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.05)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: s.h ? `oklch(0.85 0.13 ${s.h})` : 'oklch(0.93 calc(0.09 * var(--cs, 1)) var(--th))' }}>{s.n}</span>
            <span style={{ color: 'oklch(0.64 0.02 var(--th) / .62)', fontSize: 9.5 }}>{s.l}</span>
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
                  style={{ fill: isPeak ? 'oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th))' : `oklch(0.62 calc(0.11 * var(--cs, 1)) var(--th) / ${(0.14 + intensity * 0.8).toFixed(2)})` }}
                />
              )
            })}
            {/* 刻度：0/6/12/18 */}
            {[['0', 60, 14], ['12', 60, 112], ['6', 112, 63], ['18', 12, 63]].map(([t, x, y]) => (
              <text key={t as string} x={x as number} y={y as number} textAnchor="middle" style={{ fill: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 7 }}>{t}</text>
            ))}
            <text x="60" y="57" textAnchor="middle" style={{ fill: 'oklch(0.9 calc(0.08 * var(--cs, 1)) var(--th))', fontSize: 12, fontWeight: 800 }}>{ins.peakHour >= 0 ? `${ins.peakHour}:00` : '—'}</text>
            <text x="60" y="69" textAnchor="middle" style={{ fill: 'oklch(0.68 0.02 var(--th) / .7)', fontSize: 7.5 }}>高效时段</text>
          </svg>
          <span style={{ color: 'oklch(0.72 0.02 var(--th) / .75)', fontSize: 10 }}>你在 <b style={{ color: 'oklch(0.86 calc(0.12 * var(--cs, 1)) var(--th))' }}>{hourBand(ins.peakHour)}</b> 最活跃</span>
        </div>

        {/* 项目环形图 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {donut.length ? (
            <>
              <svg viewBox="0 0 120 120" style={{ width: '100%', maxWidth: 128 }}>
                {donut.map((s, i) => (
                  <path key={i} d={annular(60, 60, 34, 54, s.a0, s.a1)} style={{ fill: `oklch(0.7 calc(0.14 * var(--cs, 1)) calc(var(--th) + ${s.hue}))` }} />
                ))}
                <text x="60" y="57" textAnchor="middle" style={{ fill: 'oklch(0.9 calc(0.08 * var(--cs, 1)) var(--th))', fontSize: 12, fontWeight: 800 }}>{ins.projects.length}</text>
                <text x="60" y="69" textAnchor="middle" style={{ fill: 'oklch(0.68 0.02 var(--th) / .7)', fontSize: 7.5 }}>个项目</text>
              </svg>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', justifyContent: 'center' }}>
                {donut.slice(0, 4).map((s, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: `oklch(0.7 calc(0.14 * var(--cs, 1)) calc(var(--th) + ${s.hue}))` }} />
                    <span style={{ color: 'oklch(0.75 0.02 var(--th) / .8)', maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 10, padding: '30px 0' }}>暂无项目数据</div>
          )}
        </div>
      </div>

      {/* 7 天趋势：待办（亮）叠加会话（暗）堆叠柱 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 10.5 }}>
          <span>7 天趋势</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: 'oklch(0.78 calc(0.14 * var(--cs, 1)) var(--th))' }} />待办</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: 'oklch(0.5 calc(0.08 * var(--cs, 1)) var(--th) / .6)' }} />会话</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 46 }}>
          {ins.daily.map((d) => {
            const total = d.todos + d.acts
            const hPct = (total / maxDaily) * 100
            const isToday = d.key === ins.daily[ins.daily.length - 1].key
            return (
              <div key={d.key} title={`${d.key} · 待办 ${d.todos} · 会话 ${d.acts}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
                {total > 0 && <span style={{ fontSize: 8, color: 'oklch(0.7 0.02 var(--th) / .6)', fontVariantNumeric: 'tabular-nums' }}>{total}</span>}
                <div style={{ width: '100%', maxWidth: 20, height: `${Math.max(total ? 10 : 3, hPct)}%`, borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: total ? undefined : 'rgba(255,255,255,.05)', opacity: isToday ? 1 : 0.82 }}>
                  {total > 0 && <>
                    <div style={{ height: `${(d.acts / total) * 100}%`, background: 'oklch(0.5 calc(0.08 * var(--cs, 1)) var(--th) / .55)' }} />
                    <div style={{ height: `${(d.todos / total) * 100}%`, background: 'linear-gradient(180deg, oklch(0.82 calc(0.15 * var(--cs, 1)) var(--th)), oklch(0.68 calc(0.14 * var(--cs, 1)) var(--th)))' }} />
                  </>}
                </div>
                <span style={{ color: isToday ? 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))' : 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 8, fontWeight: isToday ? 700 : 400 }}>{d.key.slice(8)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
