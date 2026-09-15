// 钉屏截图：独立浮窗，常驻所有窗口最上层显示一张截图。整窗可拖动，悬停出工具条：
// 透明度、复制、关闭；滚轮微调透明度。窗口本身可缩放（无边框窗口在 Windows 上仍可从边缘拖拽）。

import { useEffect, useState } from 'react'
import { island } from './bridge'
import type { PinnedShotPayload } from '../../shared/protocol'

export function PinnedShot(): React.JSX.Element {
  const [shot, setShot] = useState<PinnedShotPayload | null>(null)
  const [opacity, setOpacity] = useState(1)
  const [hover, setHover] = useState(false)

  useEffect(() => island.onPinnedShot((payload) => setShot(payload)), [])

  useEffect(() => {
    if (!shot) return
    // 尺寸大的截图默认略透明，避免整块糊住桌面
    setOpacity(shot.width * shot.height > 2_000_000 ? 0.94 : 1)
  }, [shot])

  const closed = (): void => { if (shot) island.closePinnedShot(shot.id) }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onWheel={(event) => setOpacity((value) => Math.max(0.2, Math.min(1, value - Math.sign(event.deltaY) * 0.05)))}
      style={{
        width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden',
        WebkitAppRegion: 'drag', opacity,
        fontFamily: "'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif"
      } as React.CSSProperties}
    >
      {shot
        ? <img
            src={shot.dataUrl}
            alt={shot.name}
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.45))' }}
          />
        : <div style={{ width: '100%', height: '100%', borderRadius: 12, background: 'rgba(20,22,26,.6)' }} />}

      {hover && shot && (
        <div
          style={{
            position: 'absolute', top: 6, right: 6, display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 8px', borderRadius: 9, background: 'rgba(22,24,28,.82)', color: '#eef1f6',
            fontSize: 11, backdropFilter: 'blur(12px)', WebkitAppRegion: 'no-drag', userSelect: 'none'
          } as React.CSSProperties}
        >
          <span style={{ opacity: 0.7 }}>{shot.width}×{shot.height}</span>
          <input
            type="range" min={0.2} max={1} step={0.02} value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
            title="透明度"
            style={{ width: 64, accentColor: '#63b3ed' }}
          />
          <span style={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(opacity * 100)}%</span>
          <span
            title="复制到剪贴板"
            onClick={() => void island.copyImage(shot.dataUrl)}
            style={{ cursor: 'pointer', padding: '0 4px' }}
          >复制</span>
          <span title="关闭贴图" onClick={closed} style={{ cursor: 'pointer', padding: '0 4px', color: '#ff9f9f' }}>✕</span>
        </div>
      )}
    </div>
  )
}
