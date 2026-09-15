// 应用内框选叠层：覆盖一块显示器，拖出矩形即截图。Esc 取消，回车确认，右键取消。
// 叠层本身会被拍进画面，所以确认后由主进程先隐藏它、再请渲染层抓图。

import { useEffect, useRef, useState } from 'react'
import { island } from './bridge'

interface SnipConfig { displayId: string; scaleFactor: number; width: number; height: number; mode?: 'snip' | 'scroll' }

export function SnipOverlay(): React.JSX.Element {
  const [config, setConfig] = useState<SnipConfig | null>(null)
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const anchorRef = useRef<{ x: number; y: number } | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => island.onSnipConfig((value) => setConfig(value)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); island.cancelSnip(); return }
      if (event.key === 'Enter' && sel && sel.w >= 2 && sel.h >= 2) { event.preventDefault(); confirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const confirm = (): void => {
    if (!sel || done) return
    setDone(true)
    island.completeSnip({ x: sel.x, y: sel.y, width: sel.w, height: sel.h, scaleFactor: config?.scaleFactor, mode: config?.mode })
  }

  const point = (event: React.PointerEvent): { x: number; y: number } => ({ x: event.clientX, y: event.clientY })

  return (
    <div
      onPointerDown={(event) => {
        if (event.button === 2) { island.cancelSnip(); return }
        const p = point(event)
        anchorRef.current = p
        setSel({ x: p.x, y: p.y, w: 0, h: 0 })
      }}
      onPointerMove={(event) => {
        const anchor = anchorRef.current
        if (!anchor) return
        const p = point(event)
        setSel({ x: Math.min(anchor.x, p.x), y: Math.min(anchor.y, p.y), w: Math.abs(p.x - anchor.x), h: Math.abs(p.y - anchor.y) })
      }}
      onPointerUp={() => {
        const anchor = anchorRef.current
        anchorRef.current = null
        // 只是点一下没拖动 → 当作取消，避免误触把整屏截走
        if (!anchor || !sel || sel.w < 6 || sel.h < 6) { island.cancelSnip(); return }
      }}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', cursor: 'crosshair',
        background: done ? 'transparent' : 'rgba(8,10,14,.34)',
        fontFamily: "'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif", userSelect: 'none'
      }}
    >
      {/* 已经选中的区域：抠出透明洞（用 4 块遮罩而不是减掉背景，避免透明窗口下的合成差异） */}
      {sel && sel.w > 0 && sel.h > 0 && !done && (
        <>
          <div style={{ position: 'absolute', left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: '0 0 0 100vmax rgba(8,10,14,.34)', border: '1px solid rgba(120,190,255,.95)' }} />
          <div style={{
            position: 'absolute', left: sel.x, top: sel.y + sel.h + 6, padding: '3px 8px', borderRadius: 7,
            background: 'rgba(16,18,22,.88)', color: '#eef3fb', fontSize: 12, fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap'
          }}>
            {Math.round(sel.w)} × {Math.round(sel.h)}
            {config ? `  ·  实际 ${Math.round(sel.w * config.scaleFactor)} × ${Math.round(sel.h * config.scaleFactor)} px` : ''}
            <span style={{ opacity: .6 }}>　回车确认 · Esc 取消</span>
          </div>
        </>
      )}
      {/* 十字辅助线 */}
      {!sel && !done && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(16,18,22,.8)', color: '#eef3fb', fontSize: 13 }}>
            {(config?.mode === 'scroll' ? '拖动框选要滚动截图的区域（随后滚动，停手即完成）' : '拖动框选截图区域')}　<span style={{ opacity: .62 }}>Esc 取消</span>
          </div>
        </div>
      )}
    </div>
  )
}
