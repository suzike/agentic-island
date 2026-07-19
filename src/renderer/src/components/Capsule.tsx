// 闪念胶囊：全局热键（Ctrl+Alt+Space）唤出的居中输入框。
// 一句话丢进去 → AI 判断意图 → 路由到 待办/便签/问答，零摩擦捕获。

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { TriangleAlert } from 'lucide-react'
import type { CapsuleResult } from '../logic/capsuleAi'
import { Button, IconButton } from '../ui/components'
import { overlayPop } from '../ui/motion'
import { accent, ink, R, sem, semBg, SP, surface, text as txt } from '../ui/tokens'
import { Ico, type LucideIcon } from '../ui/icons'

interface CapsuleProps {
  onSubmit: (text: string) => Promise<{ result: CapsuleResult; feedback: string } | { error: string }>
  onClose: () => void
}

export function Capsule({ onSubmit, onClose }: CapsuleProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ Icon: LucideIcon; tone: string; label: string } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  const submit = (): void => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    void onSubmit(v).then((r) => {
      setBusy(false)
      if ('error' in r) { setDone({ Icon: TriangleAlert, tone: sem.warn, label: r.error }); setTimeout(onClose, 1600); return }
      const k = r.result.kind
      setDone({
        Icon: k === 'todo' ? Ico.done : k === 'note' ? Ico.idea : Ico.ask,
        tone: k === 'todo' ? sem.calm : k === 'note' ? sem.warn : accent(),
        label: r.feedback
      })
      setTimeout(onClose, 1300)
    })
  }

  return (
    <div
      data-solid
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '16vh', background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}
    >
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        style={{ width: 'min(560px, 78vw)', overflow: 'hidden', ...surface.overlay() }}
      >
        {done ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, filter: 'blur(2px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.2 } }}
            style={{ padding: '26px 22px', display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <div style={{ width: 34, height: 34, borderRadius: R.md, display: 'grid', placeItems: 'center', background: semBg(done.tone, 0.16), color: done.tone, flex: 'none', boxShadow: `0 0 14px ${semBg(done.tone, 0.35)}` }}>
              <done.Icon size={17} strokeWidth={1.75} />
            </div>
            <span style={{ ...txt.subtitle(), lineHeight: 1.5 }}>{done.label}</span>
          </motion.div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 0' }}>
              <Ico.shortcuts size={14} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
              <span style={txt.subtitle()}>闪念胶囊</span>
              <span style={txt.faint()}>AI 自动归类到 待办 / 便签 / 问答</span>
              <span style={{ flex: 1 }} />
              <IconButton icon={Ico.close} onClick={onClose} title="关闭" />
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
              style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: ink(1), fontSize: 15, lineHeight: 1.55, fontFamily: 'inherit', padding: '12px 16px', maxHeight: 160 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `0 ${SP.md + 2}px ${SP.md}px` }}>
              <span style={txt.faint()}>Enter 记录 · Shift+Enter 换行 · Esc 关闭</span>
              <span style={{ flex: 1 }} />
              <Button variant="primary" icon={busy ? Ico.running : Ico.send} disabled={!text.trim() || busy} onClick={submit}>
                {busy ? '归类中…' : '记录'}
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}
