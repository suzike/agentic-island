// 全局命令面板（Ctrl+Alt+K）：模糊搜索一键跳分区 / 执行动作 / 切主题。
// 键盘全程可用：↑↓ 选择 · Enter 执行 · Esc 关闭。命令列表由 App 组装（掌握所有动作）。
// 视觉层：ui/tokens 设计系统 + lucide 语义图标 + overlayPop 浮层动效（功能逻辑不变）。

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { EmptyState } from '../ui/components'
import { overlayPop } from '../ui/motion'
import { accent, fill, FS, hairline, ink, R, semBg, SP, surface, text, transition } from '../ui/tokens'
import { Ico } from '../ui/icons'

export interface Command {
  id: string
  title: string
  hint?: string
  icon: string
  group: string
  /** 额外可搜关键词（拼音首字母/别名等） */
  keywords?: string
  run: () => void
}

/** 模糊匹配：子串命中给低分（越靠前越优），否则子序列命中给高分，无命中 -1 */
function score(q: string, text: string): number {
  if (!q) return 0
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx !== -1) return idx
  let i = 0
  for (const ch of t) { if (ch === q[i]) i++; if (i === q.length) return 200 }
  return -1
}

export function CommandPalette({ open, commands, onClose }: { open: boolean; commands: Command[]; onClose: () => void }): React.JSX.Element | null {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30) }
  }, [open])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return commands
      .map((c) => ({ c, s: score(query, `${c.title} ${c.hint || ''} ${c.keywords || ''} ${c.group}`) }))
      .filter((x) => x.s !== -1)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.c)
  }, [q, commands])

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => {
    listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel, filtered])

  if (!open) return null

  const exec = (c?: Command): void => { if (!c) return; c.run(); onClose() }

  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '13vh', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)', animation: 'ai-fadein .15s ease' }}
    >
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); exec(filtered[sel]) }
          else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        style={{ ...surface.overlay(), width: 'min(560px, 80vw)', maxHeight: '64vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* 搜索框 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: `${SP.md}px ${SP.lg - 1}px`, borderBottom: `0.5px solid ${hairline()}` }}>
          <Ico.search size={14} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索分区 / 动作 / 主题…"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: ink(1), fontSize: FS.subtitle, fontFamily: 'var(--font)' }}
          />
          <span style={{ ...text.faint(), fontSize: 9.5, flex: 'none' }}>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
        </div>
        {/* 命令列表 */}
        <div ref={listRef} className="ai-scroll" style={{ overflowY: 'auto', padding: SP.sm - 2 }}>
          {filtered.length === 0 ? (
            <EmptyState icon={Ico.search} title="没有匹配的命令" style={{ margin: SP.sm, border: 'none', background: 'transparent' }} />
          ) : (
            filtered.map((c, i) => {
              const active = i === sel
              return (
                <div
                  key={c.id}
                  data-sel={active ? '1' : '0'}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => exec(c)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: `${SP.sm}px ${SP.md - 1}px`,
                    borderRadius: R.md,
                    cursor: 'pointer',
                    background: active ? semBg(accent(), 0.14) : 'transparent',
                    transition: transition('background'),
                  }}
                >
                  {/* icon 字段是调用方传入的 emoji 字符串数据，保持原样渲染 */}
                  <span style={{ flex: 'none', width: 24, height: 24, display: 'grid', placeItems: 'center', fontSize: 14, borderRadius: R.sm - 2, background: active ? semBg(accent(), 0.16) : fill(1) }}>{c.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...text.body(), fontWeight: 600, color: active ? accent(0.88) : ink(1), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                    {c.hint && <div style={{ ...text.faint(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.hint}</div>}
                  </div>
                  <span style={{ flex: 'none', ...text.faint(), fontSize: 9.5, fontWeight: 600, padding: '2px 7px', borderRadius: R.sm - 2, background: fill(1) }}>{c.group}</span>
                </div>
              )
            })
          )}
        </div>
      </motion.div>
    </div>
  )
}
