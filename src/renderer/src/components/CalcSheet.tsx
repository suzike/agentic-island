// 工程计算 Notebook：左侧逐行输入，右侧同行显示结果。变量跨行贯穿；支持 Math + 单位/温度助手。
// 视觉层：ui/tokens 设计系统 + lucide 语义图标 + overlayPop 浮层动效（功能逻辑不变）。

import { useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { evalSheet } from '../logic/calc'
import { IconButton } from '../ui/components'
import { overlayPop } from '../ui/motion'
import { accent, fill, FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'
import { Ico } from '../ui/icons'

const LH = 22 // 行高，两栏共用以对齐

export function CalcSheet({ open, value, onChange, onClose }: { open: boolean; value: string; onChange: (v: string) => void; onClose: () => void }): React.JSX.Element | null {
  const cells = useMemo(() => evalSheet(value), [value])
  const resRef = useRef<HTMLDivElement>(null)

  if (!open) return null

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5vh 4vw', background: 'rgba(0,0,0,.52)', backdropFilter: 'blur(5px)', animation: 'ai-fadein .15s ease' }}>
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...surface.overlay(), width: 'min(760px, 92vw)', height: 'min(560px, 86vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: `${SP.md}px ${SP.lg}px`, borderBottom: `0.5px solid ${hairline(0.1)}`, flex: 'none' }}>
          <div style={{ width: 26, height: 26, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: semBg(accent(), 0.14), color: accent(), flex: 'none' }}>
            <Ico.calc size={14} strokeWidth={1.75} />
          </div>
          <span style={{ ...text.subtitle(), fontSize: FS.subtitle }}>工程计算</span>
          <span style={{ ...text.faint(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>逐行求值 · 变量贯穿 · Math + rad/deg/cToK/sum/avg…</span>
          <span style={{ flex: 1 }} />
          <IconButton icon={Ico.close} onClick={onClose} title="关闭" size={26} />
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
            style={{ flex: 2, minWidth: 0, resize: 'none', background: surface.inset().background, border: 'none', outline: 'none', color: ink(1), fontSize: FS.body + 0.5, lineHeight: `${LH}px`, fontFamily: "'Cascadia Code', Consolas, ui-monospace, monospace", padding: `${SP.md}px ${SP.md + 2}px`, whiteSpace: 'pre', overflow: 'auto' }}
          />
          {/* 结果 */}
          <div ref={resRef} className="ai-scroll" style={{ flex: 1, minWidth: 130, overflow: 'hidden', borderLeft: `0.5px solid ${hairline(0.1)}`, padding: `${SP.md}px ${SP.md + 2}px`, background: fill(1) }}>
            {cells.map((c, i) => (
              <div key={i} style={{ height: LH, lineHeight: `${LH}px`, fontSize: FS.body, fontFamily: "'Cascadia Code', Consolas, ui-monospace, monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {c.kind === 'result' ? (
                  <span style={{ color: c.name ? accent(0.82) : ink(1), fontWeight: c.name ? 600 : 500, fontVariantNumeric: 'tabular-nums' }}>{c.name ? `${c.name} = ` : '= '}{c.result}</span>
                ) : c.kind === 'error' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: sem.warn, fontSize: FS.tiny }}>
                    <AlertTriangle size={11} strokeWidth={2} style={{ flex: 'none' }} />
                    {c.result}
                  </span>
                ) : (
                  <span> </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
