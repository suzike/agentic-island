// 工程计算 Notebook：左侧逐行输入，右侧同行显示结果。变量跨行贯穿；支持 Math + 单位/温度助手。

import { useMemo, useRef } from 'react'
import { evalSheet } from '../logic/calc'

const LH = 22 // 行高，两栏共用以对齐

export function CalcSheet({ open, value, onChange, onClose }: { open: boolean; value: string; onChange: (v: string) => void; onClose: () => void }): React.JSX.Element | null {
  const cells = useMemo(() => evalSheet(value), [value])
  const resRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 4vw', background: 'oklch(0.08 0.02 var(--ths) / .6)', backdropFilter: 'blur(5px)', animation: 'ai-fadein .15s ease' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(760px, 92vw)', height: 'min(560px, 86vh)', display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden', background: 'oklch(calc(0.16 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .99)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .32)', boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.07)', flex: 'none' }}>
          <span style={{ fontSize: 15 }}>🧮</span>
          <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 13.5, fontWeight: 700 }}>工程计算</span>
          <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10 }}>逐行求值 · 变量贯穿 · Math + rad/deg/cToK/sum/avg…</span>
          <span style={{ flex: 1 }} />
          <div className="hv" onClick={onClose} style={{ padding: '5px 10px', borderRadius: 8, cursor: 'pointer', color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 15 }}>✕</div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* 输入 */}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => { if (resRef.current) resRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop }}
            wrap="off"
            spellCheck={false}
            placeholder={'# 直接写表达式，回车换行\n2 + 3 * 4\nr = 0.05\narea = PI * r**2\ncToK(90)\navg(23, 25, 27)'}
            className="ai-scroll"
            style={{ flex: 2, minWidth: 0, resize: 'none', background: 'rgba(0,0,0,.28)', border: 'none', outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 13, lineHeight: `${LH}px`, fontFamily: "ui-monospace,'Cascadia Code',Consolas,monospace", padding: '12px 14px', whiteSpace: 'pre', overflow: 'auto' }}
          />
          {/* 结果 */}
          <div ref={resRef} className="ai-scroll" style={{ flex: 1, minWidth: 130, overflow: 'hidden', borderLeft: '1px solid rgba(255,255,255,.07)', padding: '12px 14px', background: 'rgba(255,255,255,.015)' }}>
            {cells.map((c, i) => (
              <div key={i} style={{ height: LH, lineHeight: `${LH}px`, fontSize: 12.5, fontFamily: "ui-monospace,'Cascadia Code',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {c.kind === 'result' ? (
                  <span style={{ color: c.name ? 'oklch(0.82 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.9 calc(0.08 * var(--cs, 1)) var(--th))' }}>{c.name ? `${c.name} = ` : '= '}{c.result}</span>
                ) : c.kind === 'error' ? (
                  <span style={{ color: 'oklch(0.72 0.12 30 / .85)', fontSize: 10.5 }}>⚠ {c.result}</span>
                ) : (
                  <span> </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
