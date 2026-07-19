// 智能截图问答：全局热键 Ctrl+Alt+S 框选后弹出。缩略图 + 快捷动作 + 自定义问题 → 走多模态问答。

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, BookOpen, Bug, Languages, Lightbulb, type LucideIcon } from 'lucide-react'
import { Button, Chip, IconButton } from '../ui/components'
import { overlayPop } from '../ui/motion'
import { accent, FS, ink, R, SP, surface, text as txt } from '../ui/tokens'
import { Ico } from '../ui/icons'

interface ScreenshotAskProps {
  dataUrl: string
  onAsk: (prompt: string, dataUrl: string) => void
  onClose: () => void
}

const ACTIONS: { icon: LucideIcon; label: string; prompt: string }[] = [
  { icon: Bug, label: '解释报错', prompt: '这是一张报错截图，请解释错误原因并给出修复方案。' },
  { icon: BookOpen, label: '讲解内容', prompt: '讲解这张截图里的内容，抓住重点，面向工程师。' },
  { icon: Languages, label: '翻译', prompt: '翻译这张截图里的文字（中英互译，保留术语）。' },
  { icon: Lightbulb, label: '怎么实现', prompt: '这是一个界面/效果截图，分析它并说明大致怎么实现。' },
  { icon: BarChart3, label: '读图表', prompt: '解读这张图表/架构图，说明它表达了什么。' }
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
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}
    >
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        style={{ width: 'min(600px, 82vw)', overflow: 'hidden', ...surface.overlay() }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 0' }}>
          <Ico.shot size={14} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
          <span style={txt.subtitle()}>截图问 AI</span>
          <span style={{ flex: 1 }} />
          <IconButton icon={Ico.close} onClick={onClose} title="关闭" />
        </div>
        {/* 缩略图预览 */}
        <div style={{ padding: '10px 16px 4px' }}>
          <div style={{ ...surface.inset(), padding: 6, display: 'flex', justifyContent: 'center', borderRadius: R.md }}>
            <img src={dataUrl} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: R.sm, display: 'block', boxShadow: '0 4px 16px rgba(0,0,0,.35)' }} />
          </div>
        </div>
        {/* 快捷动作 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: `8px ${SP.md + 2}px 2px` }}>
          {ACTIONS.map((a) => (
            <Chip key={a.label} icon={a.icon} onClick={() => go(a.prompt)} style={{ padding: '5px 11px' }}>
              {a.label}
            </Chip>
          ))}
        </div>
        {/* 自定义问题 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `8px ${SP.md + 2}px ${SP.md + 2}px` }}>
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) go(text.trim()); else if (e.key === 'Escape') onClose() }}
            placeholder="或者自己问：针对这张图想问什么…（Enter 发送）"
            style={{ ...surface.inset(), flex: 1, outline: 'none', color: ink(1), fontSize: FS.body, padding: '8px 12px', fontFamily: 'inherit' }}
          />
          <Button variant="primary" icon={Ico.send} disabled={!text.trim()} onClick={() => text.trim() && go(text.trim())}>
            发送
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
