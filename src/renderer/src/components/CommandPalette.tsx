// 全局命令面板（Ctrl+Alt+K）：模糊搜索一键跳分区 / 执行动作 / 切主题。
// 键盘全程可用：↑↓ 选择 · Enter 执行 · Esc 关闭。命令列表由 App 组装（掌握所有动作）。

import { useEffect, useMemo, useRef, useState } from 'react'

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
      style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '13vh', background: 'oklch(0.08 0.02 var(--ths) / .5)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); exec(filtered[sel]) }
          else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        style={{ width: 'min(560px, 80vw)', maxHeight: '64vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'oklch(calc(0.17 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .98)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', boxShadow: 'none', animation: 'ai-riseblur .3s cubic-bezier(.22,.61,.36,1)' }}
      >
        {/* 搜索框 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          <span style={{ fontSize: 15, opacity: 0.7 }}>⌘</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索分区 / 动作 / 主题…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'oklch(0.96 0.01 var(--th))', fontSize: 14, fontFamily: 'var(--font)' }}
          />
          <span style={{ fontSize: 9.5, color: 'oklch(0.6 0.02 var(--th) / .5)', flex: 'none' }}>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
        </div>
        {/* 命令列表 */}
        <div ref={listRef} className="ai-scroll" style={{ overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '22px 12px', textAlign: 'center', color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 12 }}>没有匹配的命令</div>
          ) : (
            filtered.map((c, i) => (
              <div
                key={c.id}
                data-sel={i === sel ? '1' : '0'}
                onMouseEnter={() => setSel(i)}
                onClick={() => exec(c)}
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 11px', borderRadius: 10, cursor: 'pointer', background: i === sel ? 'oklch(0.4 calc(0.09 * var(--cs, 1)) var(--th) / .4)' : 'transparent' }}
              >
                <span style={{ flex: 'none', width: 24, textAlign: 'center', fontSize: 15 }}>{c.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'oklch(0.94 0.01 var(--th))', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  {c.hint && <div style={{ color: 'oklch(0.66 0.02 var(--th) / .6)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.hint}</div>}
                </div>
                <span style={{ flex: 'none', fontSize: 9.5, color: 'oklch(0.62 calc(0.08 * var(--cs, 1)) var(--th) / .7)', padding: '2px 7px', borderRadius: 6, background: 'rgba(255,255,255,.05)' }}>{c.group}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
