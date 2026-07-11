// 钉屏便利贴：独立浮贴小窗，常驻桌面显示一条便签（Markdown 渲染）。整窗可拖动，右上角关闭。

import { useEffect, useState } from 'react'
import { island } from './bridge'
import { colorOf } from './logic/noteAi'
import { Markdown } from './components/Markdown'

interface StickyData { id: number; emoji: string; title: string; md: string; color: string }

export function Sticky(): React.JSX.Element {
  const [n, setN] = useState<StickyData | null>(null)
  useEffect(() => island.onStickyData((d) => setN(d as unknown as StickyData)), [])

  const h = n ? colorOf(n.color) : 155
  useEffect(() => { document.documentElement.style.setProperty('--th', String(h)) }, [h])

  return (
    <div style={{ width: '100vw', height: '100vh', WebkitAppRegion: 'drag', boxSizing: 'border-box' } as React.CSSProperties}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: 14, padding: '10px 12px',
        background: `linear-gradient(160deg, oklch(0.34 0.06 ${h} / .97), oklch(0.24 0.04 ${h} / .95))`,
        border: `1px solid oklch(0.68 0.11 ${h} / .5)`, backdropFilter: 'blur(20px)',
        display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden',
        fontFamily: "'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif"
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ fontSize: 15, flex: 'none' }}>{n?.emoji || '📌'}</span>
          <span style={{ flex: 1, minWidth: 0, color: `oklch(0.94 0.05 ${h})`, fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{n?.title || '便利贴'}</span>
          <span
            onClick={() => n && island.closeSticky(n.id)}
            title="关闭浮贴"
            style={{ WebkitAppRegion: 'no-drag', cursor: 'pointer', flex: 'none', color: 'oklch(0.75 0.02 var(--th) / .7)', fontSize: 12, lineHeight: 1 } as React.CSSProperties}
          >✕</span>
        </div>
        <div className="ai-scroll" style={{ WebkitAppRegion: 'no-drag', flex: 1, overflowY: 'auto', fontSize: 11, minHeight: 0 } as React.CSSProperties}>
          <Markdown text={n?.md || ''} />
        </div>
      </div>
    </div>
  )
}
