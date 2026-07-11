// 桌面挂件：独立小窗常驻桌面角，展示主岛每秒推送的速览数据（时钟/番茄/待办/日程/Agent/媒体 + AI 速览）。
// 整窗可拖动（-webkit-app-region: drag）；标题栏"展开"回主岛；媒体键与"加入会议"为 no-drag 可点。数据经主进程中转。

import { useEffect, useState } from 'react'
import { island } from './bridge'

interface WidgetData {
  clock?: string
  date?: string
  pomoPhase?: string
  pomoMMSS?: string
  dueTodos?: number
  openTodos?: number
  focusTodo?: string
  nextMeetingTitle?: string
  nextMeetingMMSS?: string
  nextMeetingLink?: string
  agents?: number
  agentsWaiting?: number
  pending?: number
  mediaTitle?: string
  mediaPlaying?: boolean
  brief?: string
  theme?: string
}

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export function Widget(): React.JSX.Element {
  const [d, setD] = useState<WidgetData>({})

  useEffect(() => island.onWidgetData((data) => setD(data as WidgetData)), [])
  useEffect(() => {
    const r = document.documentElement
    r.style.setProperty('--th', String(d.theme || '210'))
  }, [d.theme])

  const card: React.CSSProperties = {
    width: '100vw', height: '100vh', boxSizing: 'border-box', borderRadius: 18, padding: '11px 13px',
    background: 'linear-gradient(165deg, oklch(0.21 0.035 var(--th) / .96), oklch(0.15 0.025 var(--th) / .96))',
    border: '1px solid oklch(0.7 0.12 var(--th) / .35)', boxShadow: '0 10px 30px rgba(0,0,0,.4)',
    backdropFilter: 'blur(22px)', display: 'flex', flexDirection: 'column', gap: 7, overflow: 'hidden',
    fontFamily: "'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif", color: 'oklch(0.92 0.02 var(--th))'
  }
  const pill = (bg: string, fg: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 3, padding: '2.5px 7px', borderRadius: 7, background: bg, color: fg, fontSize: 10.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
  })
  const mkey: React.CSSProperties = {
    ...noDrag, width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontSize: 11, color: 'oklch(0.86 0.08 var(--th))', background: 'rgba(255,255,255,.08)'
  }

  const hasStatus = (d.pomoPhase && d.pomoPhase !== 'idle') || !!d.dueTodos || !!d.openTodos || !!d.pending || !!d.agents

  return (
    <div style={{ width: '100vw', height: '100vh', WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div style={card}>
        {/* 顶：日期 + 时钟 + 展开 */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '.01em', fontVariantNumeric: 'tabular-nums' }}>{d.clock || '--:--'}</span>
          <span style={{ fontSize: 10.5, color: 'oklch(0.68 0.02 var(--th) / .7)' }}>{d.date || ''}</span>
          <span style={{ flex: 1 }} />
          <span onClick={() => island.widgetReveal()} title="展开灵动岛" style={{ ...noDrag, cursor: 'pointer', fontSize: 10.5, padding: '2px 8px', borderRadius: 7, background: 'oklch(0.78 0.14 var(--th) / .22)', color: 'oklch(0.86 0.12 var(--th))', fontWeight: 600 }}>展开 ↗</span>
        </div>

        {/* AI 速览 */}
        {d.brief && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'flex-start', padding: '6px 8px', borderRadius: 9, background: 'oklch(0.3 0.05 var(--th) / .35)', border: '1px solid oklch(0.6 0.1 var(--th) / .22)' }}>
            <span style={{ fontSize: 11, flex: 'none' }}>✨</span>
            <span style={{ fontSize: 10.5, lineHeight: 1.4, color: 'oklch(0.88 0.03 var(--th) / .92)' }}>{d.brief}</span>
          </div>
        )}

        {/* 状态 pills */}
        {hasStatus && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {d.pomoPhase && d.pomoPhase !== 'idle' && <span style={pill('oklch(0.5 0.13 25 / .5)', 'oklch(0.86 0.12 30)')}>🍅 {d.pomoMMSS}</span>}
            {!!d.dueTodos && <span style={pill('oklch(0.5 0.13 75 / .45)', 'oklch(0.88 0.13 75)')}>⏳ {d.dueTodos} 到期</span>}
            {!!d.openTodos && <span style={pill('rgba(255,255,255,.06)', 'oklch(0.82 0.02 var(--th))')}>📝 {d.openTodos}</span>}
            {!!d.pending && <span style={pill('oklch(0.5 0.13 75 / .5)', 'oklch(0.88 0.13 75)')}>⚠ {d.pending} 待批</span>}
            {!!d.agents && !d.pending && <span style={pill('oklch(0.45 0.1 150 / .4)', 'oklch(0.84 0.11 150)')}>🤖 {d.agents}{d.agentsWaiting ? ` · ${d.agentsWaiting} 待回` : ''}</span>}
          </div>
        )}

        {/* 下个日程 */}
        {d.nextMeetingTitle && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 11, flex: 'none' }}>⏰</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5, color: 'oklch(0.8 0.02 var(--th) / .85)' }}>{d.nextMeetingTitle}</span>
            <span style={{ flex: 'none', fontSize: 10, fontWeight: 700, color: 'oklch(0.85 0.1 var(--th))', fontVariantNumeric: 'tabular-nums' }}>{d.nextMeetingMMSS}</span>
            {d.nextMeetingLink && <span onClick={() => island.openExternal(d.nextMeetingLink!)} title="加入会议" style={{ ...noDrag, cursor: 'pointer', fontSize: 9, padding: '1px 6px', borderRadius: 6, background: 'oklch(0.45 0.1 150 / .4)', color: 'oklch(0.85 0.11 150)' }}>加入</span>}
          </div>
        )}

        {/* 现在最该做的 */}
        {d.focusTodo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 11, flex: 'none' }}>🎯</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5, color: 'oklch(0.82 0.02 var(--th) / .88)' }}>{d.focusTodo}</span>
          </div>
        )}

        {/* 底：媒体 + 控制 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 'auto', minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: 'oklch(0.74 0.02 var(--th) / .8)' }}>
            <span style={{ marginRight: 4 }}>{d.mediaPlaying ? '♫' : '♪'}</span>{d.mediaTitle || '未在播放'}
          </span>
          {([['prev', '⏮'], ['playpause', d.mediaPlaying ? '⏸' : '⏵'], ['next', '⏭']] as const).map(([c, ic]) => (
            <span key={c} className="hv" onClick={() => island.mediaKey(c)} style={mkey}>{ic}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
