// 滚动截图的进度小窗：一条小药丸，显示已拼接段数与成图高度，带"完成/取消"。
// 它必须能被点（用户要能提前收尾），所以不做点击穿透；窗口本身很小、贴在屏幕顶部居中，不挡选区。

import { useEffect, useState } from 'react'
import { island } from './bridge'
import type { ScrollHudState } from '../../shared/protocol'

export function ScrollHud(): React.JSX.Element {
  const [state, setState] = useState<ScrollHudState>({ state: 'capturing', segments: 0, height: 0 })
  useEffect(() => island.onScrollHudState((value) => setState(value)), [])

  const capturing = state.state === 'capturing'
  return (
    <div style={{
      width: '100vw', height: '100vh', boxSizing: 'border-box', WebkitAppRegion: 'drag',
      display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: 22,
      background: 'rgba(18,20,24,.92)', border: '0.5px solid rgba(255,255,255,.16)',
      boxShadow: '0 8px 24px rgba(0,0,0,.45)', color: '#eef2f8',
      fontFamily: "'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif", fontSize: 12
    } as React.CSSProperties}>
      <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: capturing ? '#4fd1a5' : state.state === 'done' ? '#7aa2ff' : '#ff9f9f' }} />
      <span style={{ fontWeight: 650, flex: 'none' }}>{capturing ? '滚动截图' : state.state === 'done' ? '已完成' : '已取消'}</span>
      <span style={{ opacity: .75, fontVariantNumeric: 'tabular-nums', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {capturing ? `${state.segments} 帧 · 成图 ${state.height}px · 停手即完成` : state.message || ''}
      </span>
      {capturing && (
        <span style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => island.scrollHudAction('finish')} style={pillButton}>完成</button>
          <button onClick={() => island.scrollHudAction('cancel')} style={{ ...pillButton, color: '#ffb4b4' }}>取消</button>
        </span>
      )}
    </div>
  )
}

const pillButton: React.CSSProperties = {
  border: '0.5px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.08)', color: '#eef2f8',
  borderRadius: 8, padding: '3px 10px', fontSize: 11.5, fontFamily: 'inherit', cursor: 'pointer'
}
