// 闪念胶囊：全局热键（Ctrl+Alt+Space）唤出的居中输入框。
// 一句话丢进去 → AI 判断意图 → 路由到 待办/便签/问答，零摩擦捕获。

import { useEffect, useRef, useState } from 'react'
import type { CapsuleResult } from '../logic/capsuleAi'

interface CapsuleProps {
  onSubmit: (text: string) => Promise<{ result: CapsuleResult; feedback: string } | { error: string }>
  onClose: () => void
}

export function Capsule({ onSubmit, onClose }: CapsuleProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ icon: string; label: string } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  const submit = (): void => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    void onSubmit(v).then((r) => {
      setBusy(false)
      if ('error' in r) { setDone({ icon: '⚠️', label: r.error }); setTimeout(onClose, 1600); return }
      const k = r.result.kind
      setDone({ icon: k === 'todo' ? '✅' : k === 'note' ? '💡' : '💬', label: r.feedback })
      setTimeout(onClose, 1300)
    })
  }

  return (
    <div
      data-solid
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '16vh', background: 'oklch(0.08 0.02 var(--ths) / .45)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}
    >
      <div
        style={{ width: 'min(560px, 78vw)', borderRadius: 18, overflow: 'hidden', background: 'oklch(calc(0.17 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .98)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', boxShadow: 'none', animation: 'ai-riseblur .35s cubic-bezier(.22,.61,.36,1)' }}
      >
        {done ? (
          <div style={{ padding: '26px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 26 }}>{done.icon}</span>
            <span style={{ color: 'oklch(0.92 0.01 var(--th))', fontSize: 14, fontWeight: 600 }}>{done.label}</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px 0' }}>
              <span style={{ fontSize: 15 }}>⚡</span>
              <span style={{ color: 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 12, fontWeight: 700 }}>闪念胶囊</span>
              <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10 }}>AI 自动归类到 待办 / 便签 / 问答</span>
              <span style={{ flex: 1 }} />
              <span className="hv" onClick={onClose} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 13 }}>✕</span>
            </div>
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
                else if (e.key === 'Escape') onClose()
              }}
              placeholder="随口说点什么…（如：明早9点跟王工对齐限流方案 / 记一下 Redis 令牌桶思路 / 怎么排查 CORS）"
              rows={3}
              className="ai-scroll"
              style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: 'oklch(0.96 0.01 var(--th))', fontSize: 15, lineHeight: 1.55, fontFamily: 'inherit', padding: '12px 16px', maxHeight: 160 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px 12px' }}>
              <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 10 }}>Enter 记录 · Shift+Enter 换行 · Esc 关闭</span>
              <span style={{ flex: 1 }} />
              <div className="hv" onClick={submit} style={{ padding: '7px 18px', borderRadius: 999, cursor: text.trim() && !busy ? 'pointer' : 'default', background: text.trim() && !busy ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: text.trim() && !busy ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 12.5, fontWeight: 700 }}>
                {busy ? '⚡ 归类中…' : '记录'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
