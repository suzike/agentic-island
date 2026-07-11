// 智能截图问答：全局热键 Ctrl+Alt+S 框选后弹出。缩略图 + 快捷动作 + 自定义问题 → 走多模态问答。

import { useEffect, useRef, useState } from 'react'

interface ScreenshotAskProps {
  dataUrl: string
  onAsk: (prompt: string, dataUrl: string) => void
  onClose: () => void
}

const ACTIONS = [
  { icon: '🐛', label: '解释报错', prompt: '这是一张报错截图，请解释错误原因并给出修复方案。' },
  { icon: '📖', label: '讲解内容', prompt: '讲解这张截图里的内容，抓住重点，面向工程师。' },
  { icon: '🌐', label: '翻译', prompt: '翻译这张截图里的文字（中英互译，保留术语）。' },
  { icon: '💡', label: '怎么实现', prompt: '这是一个界面/效果截图，分析它并说明大致怎么实现。' },
  { icon: '📊', label: '读图表', prompt: '解读这张图表/架构图，说明它表达了什么。' }
]

export function ScreenshotAsk({ dataUrl, onAsk, onClose }: ScreenshotAskProps): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const go = (prompt: string): void => { onAsk(prompt, dataUrl); onClose() }

  return (
    <div
      data-solid
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh', background: 'oklch(0.08 0.02 var(--ths) / .5)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}
    >
      <div style={{ width: 'min(600px, 82vw)', borderRadius: 18, overflow: 'hidden', background: 'oklch(calc(0.17 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .98)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', boxShadow: 'none', animation: 'ai-riseblur .35s cubic-bezier(.22,.61,.36,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px 0' }}>
          <span style={{ fontSize: 15 }}>📸</span>
          <span style={{ color: 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 12, fontWeight: 700 }}>截图问 AI</span>
          <span style={{ flex: 1 }} />
          <span className="hv" onClick={onClose} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 13 }}>✕</span>
        </div>
        {/* 缩略图预览 */}
        <div style={{ padding: '10px 16px 4px' }}>
          <img src={dataUrl} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block', margin: '0 auto', border: '1px solid rgba(255,255,255,.1)' }} />
        </div>
        {/* 快捷动作 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 14px' }}>
          {ACTIONS.map((a) => (
            <div key={a.label} className="hv" onClick={() => go(a.prompt)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', color: 'oklch(0.85 0.02 var(--th) / .9)', fontSize: 11.5, fontWeight: 600 }}>
              <span>{a.icon}</span>{a.label}
            </div>
          ))}
        </div>
        {/* 自定义问题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px 14px' }}>
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) go(text.trim()); else if (e.key === 'Escape') onClose() }}
            placeholder="或者自己问：针对这张图想问什么…（Enter 发送）"
            style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, outline: 'none', color: 'oklch(0.96 0.01 var(--th))', fontSize: 12.5, padding: '9px 12px', fontFamily: 'inherit' }}
          />
          <div className="hv" onClick={() => text.trim() && go(text.trim())} style={{ padding: '8px 16px', borderRadius: 999, cursor: text.trim() ? 'pointer' : 'default', background: text.trim() ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: text.trim() ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 12.5, fontWeight: 700 }}>发送</div>
        </div>
      </div>
    </div>
  )
}
