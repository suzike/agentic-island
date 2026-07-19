// Island Chat：消息气泡（用户/AI，AI 支持 h/p/ul/code/note/think 富文本 + Markdown）+ 富输入。
// v2：多行输入（Enter 发送 / Shift+Enter 换行，自动增高）、新消息自动滚底、
// 消息时间戳、悬停浮现复制（用户/AI 均可）。
// v3：视觉层重做至 ui/tokens 设计系统（层级表面 + 语义色 + lucide 图标 + framer-motion 入场），交互零改动。

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUp, Brain, Camera, Check, ChevronDown, Copy, CornerDownRight, Image as ImageIcon, Paperclip, Quote, Settings, Sparkles, Square, Wrench, X } from 'lucide-react'
import type { Block, ChatMessage, ChatProps, QuoteRef } from '../types'
import { Markdown, Collapsible } from './Markdown'
import { blocksToText } from '../logic/chat'
import { readAttachment, downscaleDataUrl, selectLocalFiles } from '../logic/files'
import { island } from '../bridge'
import { Button, Chip, IconButton } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text, transition } from '../ui/tokens'

/** 附件类型图标（文件/图像） */
const AttIcon = ({ t, size = 12 }: { t: string; size?: number }): React.JSX.Element =>
  t === 'file' ? <Paperclip size={size} strokeWidth={1.75} /> : <Camera size={size} strokeWidth={1.75} />

/** 打字中三点脉冲 */
function TypingDots(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '2px 0' }}>
      {[0, 0.2, 0.4].map((d) => (
        <div key={d} style={{ width: 6, height: 6, borderRadius: 999, background: accent(0.7), animation: `ai-dotpulse 1s ease-in-out ${d}s infinite` }} />
      ))}
    </div>
  )
}

/** 本地 Agent 步骤时间线（工具/技能/MCP/命令）：进行中脉冲点，完成打勾 */
function StepsTimeline({ steps }: { steps: { label: string; detail?: string; done?: boolean }[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderLeft: `2px solid ${accent(0.55, 0.35)}`, paddingLeft: 9 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span style={{ flex: 'none', width: 6, height: 6, borderRadius: 999, background: s.done ? sem.calm : sem.warn, animation: s.done ? undefined : 'ai-dotpulse 1.4s ease-in-out infinite', alignSelf: 'center' }} />
          <span style={{ flex: 'none', color: ink(1), fontSize: FS.tiny, fontWeight: 600 }}>{s.label}</span>
          {s.detail && <span style={{ flex: 1, minWidth: 0, ...text.mono(9.5), color: ink(3), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.detail}</span>}
          {s.done && <Check size={10} strokeWidth={2.5} style={{ flex: 'none', color: sem.calm, alignSelf: 'center' }} />}
        </div>
      ))}
    </div>
  )
}

/** 思考链折叠区：紫色（专注）左边条 + 可点击头部（Brain 图标 + 字数 +  chevron 展开/收起）。
 *  流式进行中只露最近几行；其余情况默认折叠（长文渐隐暗示），点头部展开全文（320px 内滚动）。 */
function ThinkBlock({ text: thinkText, live, collapsed }: { text: string; live?: boolean; collapsed?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const streaming = live && !collapsed
  const collapsedH = live ? 30 : 56
  return (
    <div style={{ borderLeft: `2px solid ${semBg(sem.focus, 0.5)}`, paddingLeft: 9, margin: live ? 0 : '1px 0 3px' }}>
      <div
        onClick={streaming ? undefined : () => setOpen((v) => !v)}
        title={streaming ? undefined : open ? '收起思考过程' : '展开思考过程'}
        style={{ display: 'flex', alignItems: 'center', gap: 5, color: sem.focus, fontSize: FS.tiny, fontWeight: 600, marginBottom: 3, cursor: streaming ? 'default' : 'pointer', userSelect: 'none' }}
      >
        <Brain size={11} strokeWidth={1.75} style={{ flex: 'none' }} />
        {streaming ? '思考中…' : '思考过程'}
        {!streaming && <span style={{ ...text.faint(), fontSize: 9, fontWeight: 400 }}>{thinkText.length} 字</span>}
        {!streaming && (
          <>
            <span style={{ flex: 1 }} />
            <span style={{ ...text.faint(), fontSize: 9.5, color: sem.focus, opacity: 0.85 }}>{open ? '收起' : '展开'}</span>
            <ChevronDown size={11} strokeWidth={2} style={{ transition: 'transform .2s ease', transform: open ? 'rotate(180deg)' : undefined }} />
          </>
        )}
      </div>
      {streaming ? (
        // 进行中：只露最近几行，随流式自动"滚动"（column-reverse 让底部对齐）
        <div style={{ maxHeight: 108, overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse', opacity: 0.78 }}>
          <div><Markdown text={thinkText} /></div>
        </div>
      ) : (
        <div
          className="ai-scroll"
          style={{ maxHeight: open ? 320 : collapsedH, overflowY: open ? 'auto' : 'hidden', position: 'relative', transition: 'max-height .22s ease', opacity: 0.72 }}
        >
          <Markdown text={thinkText} />
          {!open && thinkText.length > 120 && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, background: 'linear-gradient(180deg, transparent, oklch(calc(0.17 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / .95))', pointerEvents: 'none' }} />
          )}
        </div>
      )}
    </div>
  )
}

/** 本地 Agent 流式气泡：思考过程（进行中展开，出正文/步骤后自动折叠）→ 步骤时间线 → 流式正文 + 停止按钮 */
function AgentLiveBody({ live }: { live: NonNullable<ChatMessage['live']> }): React.JSX.Element {
  const thinkCollapsed = !!live.text || live.steps.length > 0
  return (
    <>
      {live.status && (
        <div style={{ ...text.mono(9), color: ink(3), display: 'flex', alignItems: 'center', gap: 4 }}>
          <Settings size={9} strokeWidth={1.75} style={{ flex: 'none' }} />
          {live.status}
        </div>
      )}
      {live.think && <ThinkBlock text={live.think} live collapsed={thinkCollapsed} />}
      {live.steps.length > 0 && <StepsTimeline steps={live.steps} />}
      {live.text && (
        <div style={{ color: ink(1) }}>
          <Markdown text={live.text} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-block', width: 7, height: 12, borderRadius: 2, background: sem.run, animation: 'ai-dotpulse 1s ease-in-out infinite' }} />
        <span style={{ ...text.faint(), fontSize: 9 }}>{live.engine === 'claude' ? 'Claude Code' : 'Codex'} 执行中 · 需审批的操作会弹到 Agents 分区</span>
        <span style={{ flex: 1 }} />
        <span
          className="hv"
          onClick={() => island.agentCliCancel(live.engine)}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: R.pill, background: semBg(sem.danger, 0.18), color: sem.danger, fontSize: 9.5, fontWeight: 700 }}
        >
          <Square size={9} strokeWidth={2} fill="currentColor" />停止
        </span>
      </div>
    </>
  )
}

/** AI 回答正文：思考过程（可折叠）+ h/p/ul/code/note 富文本块。主气泡与就地追问子线程共用。 */
function AnswerBody({ blocks }: { blocks?: Block[] }): React.JSX.Element {
  const thinkText = (blocks || []).filter((b) => b.t === 'think').map((b) => b.text || '').filter(Boolean).join('\n\n')
  return (
    <>
      {thinkText && <ThinkBlock text={thinkText} />}
      {(blocks || []).filter((b) => b.t !== 'think').map((b, bi) => {
        if (b.t === 'steps')
          return (
            <div key={bi} style={{ opacity: 0.85 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: accent(0.78, 0.85), fontSize: FS.tiny, fontWeight: 600, marginBottom: 3 }}>
                <Wrench size={10.5} strokeWidth={1.75} style={{ flex: 'none' }} />
                执行过程 · {(b.steps || []).length} 步
              </div>
              <Collapsible collapsedHeight={44}>
                <StepsTimeline steps={(b.steps || []).map((s) => ({ ...s, done: true }))} />
              </Collapsible>
            </div>
          )
        if (b.t === 'h') return <div key={bi} style={{ ...text.subtitle(), fontSize: FS.body, fontWeight: 700 }}>{b.text}</div>
        if (b.t === 'p')
          return (
            <div key={bi} style={{ color: ink(1) }}>
              <Markdown text={b.text || ''} />
            </div>
          )
        if (b.t === 'ul')
          return (
            <div key={bi} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(b.items || []).map((li, li2) => (
                <div key={li2} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <div style={{ color: accent(), fontSize: FS.small, lineHeight: 1.5 }}>•</div>
                  <div style={{ color: ink(1), fontSize: FS.small, lineHeight: 1.5 }}>{li}</div>
                </div>
              ))}
            </div>
          )
        if (b.t === 'code')
          return (
            <div key={bi} style={{ ...surface.inset(), ...text.mono(FS.small), color: accent(0.86), padding: '8px 10px', overflowX: 'auto', whiteSpace: 'pre' }}>
              {b.text}
            </div>
          )
        return <div key={bi} style={{ color: ink(3), fontSize: FS.small, fontStyle: 'italic' }}>{b.text}</div>
      })}
    </>
  )
}

/** 引用卡片：左侧主题色条 + 引用原文 + 可选疑问；输入区可删除，气泡内只读展示 */
function QuoteCard({ q, onRemove, compact }: { q: QuoteRef; onRemove?: () => void; compact?: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, borderRadius: R.sm, background: semBg(accent(), 0.1), overflow: 'hidden', maxWidth: '100%' }}>
      <div style={{ width: 3, flex: 'none', background: gradient.brand() }} />
      <div style={{ flex: 1, minWidth: 0, padding: compact ? '5px 8px' : '6px 9px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <Quote size={10} strokeWidth={2} style={{ flex: 'none', color: accent(0.8, 0.9), marginTop: 2 }} />
          <span style={{ flex: 1, minWidth: 0, color: ink(2), fontSize: FS.tiny, lineHeight: 1.45, fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: compact ? 2 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {q.text}
          </span>
          {onRemove && (
            <span className="hv" onClick={onRemove} title="移除引用" style={{ flex: 'none', display: 'inline-flex', color: ink(3), cursor: 'pointer', lineHeight: 1 }}>
              <X size={11} strokeWidth={2} />
            </span>
          )}
        </div>
        {q.note && q.note.trim() && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, color: accent(0.86, 0.92), fontSize: FS.tiny, lineHeight: 1.4, paddingLeft: 16 }}>
            <CornerDownRight size={10} strokeWidth={2} style={{ flex: 'none', opacity: 0.6, marginTop: 1.5 }} />
            <span style={{ minWidth: 0 }}>{q.note}</span>
          </div>
        )}
      </div>
    </div>
  )
}

const fmtTs = (ts?: number): string => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 选择文件：真实读取内容（文本→content 拼进提问；图片→dataURL 发视觉模型）
const pickFiles = (accept: string, onAttach: ChatProps['onAttach']): void => {
  void selectLocalFiles(accept, true).then((files) => {
    files.forEach((f) => {
      readAttachment(f).then((att) => onAttach(att.type, att))
    })
  })
}

const copyChip = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 8px',
  borderRadius: R.pill,
  background: active ? semBg(accent(), 0.16) : fill(2),
  color: active ? accent() : ink(3),
  fontSize: 9,
  fontWeight: 600,
  cursor: 'pointer',
  transition: transition('background, color')
})

/** 发送按钮：主题渐变圆角块 + 上箭头，可发/不可发两态（主输入区与就地追问共用） */
function SendBtn({ size, active, onSend, title }: { size: number; active: boolean; onSend: () => void; title: string }): React.JSX.Element {
  return (
    <div
      className="hv"
      onClick={onSend}
      title={title}
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: size >= 32 ? R.md : R.md - 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: active ? 'pointer' : 'default',
        background: active ? gradient.primary() : fill(2),
        color: active ? gradient.onPrimary() : ink(4),
        boxShadow: active ? `0 4px 14px -4px ${accent(0.7, 0.45)}, inset 0 1px 0 rgba(255,255,255,0.25)` : 'none',
        transition: transition('background, color, box-shadow')
      }}
    >
      <ArrowUp size={size >= 32 ? 14 : 12} strokeWidth={2.25} />
    </div>
  )
}

export function IslandChat(p: ChatProps): React.JSX.Element {
  const composer = p.composer
  const quotes = p.quotes || []
  const canSend = !!(composer.text && composer.text.trim()) || composer.attachments.length > 0 || quotes.length > 0
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  // 引用追问弹窗：框选 AI 片段后浮现，写疑问 → 贴入输入区
  const [sel, setSel] = useState<{ text: string; note: string; x: number; y: number } | null>(null)
  // 就地追问：记录哪条回答下展开了输入框 + 其草稿文本
  const [fuIdx, setFuIdx] = useState<number | null>(null)
  const [fuText, setFuText] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const fuRef = useRef<HTMLTextAreaElement>(null)

  const sendFollowUp = (): void => {
    const t = fuText.trim()
    if (!t || !p.onFollowUp || fuIdx === null) return
    p.onFollowUp(fuIdx, t) // 问答嵌套进第 fuIdx 条气泡；保持展开以便连续追问
    setFuText('')
  }

  // 在 AI 气泡内先框选文字，再右键 → 弹出引用追问框。
  // 用右键（而非松开鼠标）触发，是为了让普通选中+复制不被弹窗打断；无选区时右键不拦截。
  const onAiSelect = (e: React.MouseEvent): void => {
    if (!p.enableQuote) return
    const s = window.getSelection()
    if (!s || s.isCollapsed) return
    const text = s.toString().trim()
    if (!text || text.length < 2) return
    e.preventDefault() // 有选区才弹自定义框，压掉原生右键菜单
    let x = e.clientX
    let y = e.clientY + 8
    try {
      const r = s.getRangeAt(0).getBoundingClientRect()
      if (r && r.width) { x = r.left; y = r.bottom + 8 }
    } catch { /* 退回鼠标坐标 */ }
    // 夹取到视口内（弹窗宽约 250）
    x = Math.max(8, Math.min(x, window.innerWidth - 258))
    y = Math.min(y, window.innerHeight - 170)
    setSel({ text, note: '', x, y })
  }

  // 聚焦备注框
  useEffect(() => {
    if (sel) noteRef.current?.focus()
  }, [sel])
  // 展开就地追问输入框时自动聚焦
  useEffect(() => {
    if (fuIdx !== null) fuRef.current?.focus()
  }, [fuIdx])

  const confirmQuote = (): void => {
    if (!sel) return
    p.onAddQuote?.({ text: sel.text, note: sel.note.trim() || undefined })
    window.getSelection()?.removeAllRanges()
    setSel(null)
  }

  // 新消息自动滚到底部（含本地 Agent 流式更新：正文/思考长度、步骤数变化都触发跟随）
  const lastMsg = p.messages[p.messages.length - 1]
  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [p.messages.length, lastMsg?.typing, lastMsg?.live?.text.length, lastMsg?.live?.think.length, lastMsg?.live?.steps.length])

  // 输入框自动增高（1~6 行）
  const autoGrow = (): void => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 116) + 'px'
  }
  useEffect(autoGrow, [composer.text])

  const copyText = (mi: number, text: string): void => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopiedIdx(mi)
    setTimeout(() => setCopiedIdx(null), 1500)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', boxSizing: 'border-box' }}>
      {p.messages.length > 0 && (
        <div
          ref={boxRef}
          className="ai-scroll"
          style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: p.maxH ?? 230, overflowY: 'auto', paddingRight: 2, scrollBehavior: 'smooth' }}
        >
          {p.messages.map((m, mi) =>
            m.role === 'user' ? (
              <motion.div key={mi} variants={fadeScaleIn} initial="initial" animate="animate" className="msg" style={{ alignSelf: 'flex-end', maxWidth: '86%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                {(m.quotes?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', alignItems: 'stretch' }}>
                    {m.quotes!.map((q) => (
                      <QuoteCard key={q.id} q={q} compact />
                    ))}
                  </div>
                )}
                {(m.attachments?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end' }}>
                    {m.attachments!.map((a, ai) => (
                      <div key={ai} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 4px', borderRadius: R.sm, background: fill(2) }}>
                        {a.type === 'screenshot' ? (
                          a.thumb ? (
                            <img src={a.thumb} style={{ width: 34, height: 24, borderRadius: 5, objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: 22, height: 22, borderRadius: 5, background: gradient.brand() }} />
                          )
                        ) : (
                          <span style={{ display: 'inline-flex', color: ink(2) }}><AttIcon t={a.type} /></span>
                        )}
                        <span style={{ color: ink(1), fontSize: FS.tiny }}>{a.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!!m.text && (
                  <div
                    onContextMenu={p.enableQuote ? onAiSelect : undefined}
                    style={{ padding: '8px 12px', borderRadius: '14px 14px 4px 14px', background: `linear-gradient(180deg, ${accent(0.52)}, ${accent(0.44)})`, color: ink(1), fontSize: FS.small, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: `0 3px 12px -4px ${accent(0.5, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.12)`, userSelect: p.enableQuote ? 'text' : undefined, cursor: p.enableQuote ? 'text' : undefined }}
                  >
                    {m.text}
                  </div>
                )}
                {/* 悬停浮现：时间 + 复制我的提问 */}
                <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {m.ts && <span style={{ ...text.faint(), fontSize: 9 }}>{fmtTs(m.ts)}</span>}
                  <div className="hv" onClick={() => copyText(mi, m.text || '')} style={copyChip(copiedIdx === mi)}>
                    {copiedIdx === mi ? <Check size={9} strokeWidth={2.5} /> : <Copy size={9} strokeWidth={2} />}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key={mi} variants={fadeScaleIn} initial="initial" animate="animate" className="msg" style={{ alignSelf: 'flex-start', maxWidth: '92%', display: 'flex', gap: 8 }}>
                <div style={{ width: 20, height: 20, flex: 'none', borderRadius: 6, background: gradient.brand(), color: gradient.onPrimary(), boxShadow: `0 2px 8px ${accent(0.7, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <Sparkles size={11} strokeWidth={2} />
                </div>
                <div
                  onContextMenu={p.enableQuote && !m.typing ? onAiSelect : undefined}
                  style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 13px', ...surface.card(), border: 'none', boxShadow: '0 6px 18px -8px rgba(0, 0, 0, 0.4)', borderRadius: '4px 14px 14px 14px', minWidth: 0, userSelect: p.enableQuote ? 'text' : undefined, cursor: p.enableQuote && !m.typing ? 'text' : undefined }}
                >
                  {m.typing && <TypingDots />}
                  {m.live && <AgentLiveBody live={m.live} />}
                  <AnswerBody blocks={m.blocks} />
                  {/* 就地追问子线程：问答都嵌套在本气泡内，形成一条对话支线 */}
                  {(m.followups?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 5, paddingLeft: 10, borderLeft: `2px solid ${accent(0.7, 0.32)}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {m.followups!.map((fm, fi) =>
                        fm.role === 'user' ? (
                          <div key={fi} style={{ alignSelf: 'flex-start', maxWidth: '96%', padding: '5px 10px', borderRadius: '12px 12px 12px 4px', background: semBg(accent(), 0.2), color: ink(1), fontSize: FS.small, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {fm.text}
                          </div>
                        ) : fm.typing ? (
                          <TypingDots key={fi} />
                        ) : fm.live ? (
                          <div key={fi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <AgentLiveBody live={fm.live} />
                          </div>
                        ) : (
                          <div key={fi} onContextMenu={p.enableQuote ? onAiSelect : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 6, userSelect: p.enableQuote ? 'text' : undefined }}>
                            <AnswerBody blocks={fm.blocks} />
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {/* 追问：就地在本气泡下展开输入框；问答嵌套在本气泡内，上下文含整段主对话 */}
                  {!m.typing && (m.blocks?.length ?? 0) > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      {p.onFollowUp && (
                        <Chip
                          icon={CornerDownRight}
                          active={fuIdx === mi}
                          onClick={() => { setFuIdx((v) => (v === mi ? null : mi)); setFuText('') }}
                          title="就地追问（记得上文）"
                          style={{ fontSize: FS.tiny, padding: '2px 9px' }}
                        >
                          追问
                        </Chip>
                      )}
                      <span style={{ flex: 1 }} />
                      {/* 悬停浮现：时间 + 复制整条回复 */}
                      <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {m.ts && <span style={{ ...text.faint(), fontSize: 9 }}>{fmtTs(m.ts)}</span>}
                        <div className="hv" onClick={() => copyText(mi, blocksToText(m.blocks!))} style={copyChip(copiedIdx === mi)}>
                          {copiedIdx === mi ? <><Check size={9} strokeWidth={2.5} />已复制</> : <><Copy size={9} strokeWidth={2} />复制</>}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 就地追问输入框：仅在该条回答下展开 */}
                  {p.onFollowUp && fuIdx === mi && (
                    <div style={{ marginTop: 4, ...surface.inset(), border: `0.5px solid ${accent(0.7, 0.35)}`, padding: 7, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                      <textarea
                        ref={fuRef}
                        value={fuText}
                        onChange={(e) => setFuText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollowUp() }
                          else if (e.key === 'Escape') { setFuIdx(null); setFuText('') }
                        }}
                        placeholder="接着这段继续问…（Enter 发送 · Esc 收起）"
                        rows={1}
                        className="ai-scroll"
                        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: ink(1), fontSize: FS.small, lineHeight: 1.5, fontFamily: 'var(--font)', padding: '4px 4px', maxHeight: 90, overflowY: 'auto' }}
                      />
                      <SendBtn size={28} active={!!fuText.trim()} onSend={sendFollowUp} title="发送追问（Enter）" />
                    </div>
                  )}
                </div>
              </motion.div>
            )
          )}
        </div>
      )}

      {/* composer */}
      <div style={{ ...surface.inset(), borderRadius: R.lg, padding: SP.sm }}>
        {quotes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, ...text.faint(), fontWeight: 600 }}>
              <Quote size={10} strokeWidth={2} style={{ flex: 'none' }} />
              <span>引用 {quotes.length} 段作为上下文</span>
              <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
            </div>
            {quotes.map((q) => (
              <QuoteCard key={q.id} q={q} onRemove={() => p.onRemoveQuote?.(q.id)} />
            ))}
          </div>
        )}
        {composer.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 7 }}>
            {composer.attachments.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px 4px 5px', borderRadius: R.sm, background: fill(2) }}>
                {a.type === 'screenshot' ? (
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: gradient.brand() }} />
                ) : (
                  <span style={{ display: 'inline-flex', color: ink(2) }}><AttIcon t={a.type} /></span>
                )}
                <span style={{ color: ink(1), fontSize: FS.tiny }}>{a.name}</span>
                <span className="hv" style={{ display: 'inline-flex', color: ink(3), cursor: 'pointer' }} onClick={() => p.onRemoveAtt(i)} title="移除附件">
                  <X size={11} strokeWidth={2} />
                </span>
              </div>
            ))}
          </div>
        )}

        {(p.quickReplies?.length ?? 0) > 0 && (
          <div className="ai-scroll" style={{ display: 'flex', gap: 6, marginBottom: 7, overflowX: 'auto', paddingBottom: 2 }}>
            {p.quickReplies!.map((q) => (
              <Chip key={q} onClick={() => p.onQuick?.(q)} style={{ flex: 'none', fontSize: FS.tiny }}>
                {q}
              </Chip>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          {/* 多行输入：Enter 发送 / Shift+Enter 换行，自动增高（可直接粘贴多行代码） */}
          <textarea
            ref={taRef}
            value={composer.text}
            onChange={(e) => p.onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (canSend) p.onSend()
              }
            }}
            onPaste={(e) => {
              // 直接粘贴图片 → 作为附件（缩放控内存）走多模态；有图时阻止其默认文本粘贴
              const imgItem = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'))
              if (!imgItem) return
              const blob = imgItem.getAsFile()
              if (!blob) return
              e.preventDefault()
              const reader = new FileReader()
              reader.onload = (): void => {
                const url = String(reader.result)
                void downscaleDataUrl(url).then((small) => p.onAttach('screenshot', { name: '粘贴图片', thumb: small, dataUrl: small }))
              }
              reader.readAsDataURL(blob)
            }}
            placeholder={p.placeholder}
            rows={1}
            className="ai-scroll"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: ink(1), fontSize: FS.body, lineHeight: 1.5, fontFamily: 'var(--font)', padding: '6px 4px', maxHeight: 116, overflowY: 'auto' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton icon={ImageIcon} title="图片" onClick={() => pickFiles('image/*', p.onAttach)} size={28} style={{ background: 'transparent' }} />
            <IconButton icon={Paperclip} title="文件" onClick={() => pickFiles('', p.onAttach)} size={28} style={{ background: 'transparent' }} />
            <SendBtn size={32} active={canSend} onSend={() => canSend && p.onSend()} title="发送（Enter）· 换行（Shift+Enter）" />
          </div>
        </div>
      </div>

      {/* 引用追问弹窗：框选 AI 片段后浮现于选区下方，写疑问 → 贴入输入区 */}
      {sel && (
        <>
          <div onMouseDown={() => setSel(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <motion.div
            variants={overlayPop}
            initial="initial"
            animate="animate"
            style={{ position: 'fixed', left: sel.x, top: sel.y, zIndex: 41, width: 250, padding: 10, ...surface.overlay(), display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: accent(0.85), fontSize: FS.tiny, fontWeight: 700 }}>
              <Quote size={11} strokeWidth={2} style={{ flex: 'none' }} />
              <span>引用追问</span>
            </div>
            <div style={{ maxHeight: 66, overflowY: 'auto', padding: '6px 8px', borderRadius: R.sm, background: fill(1), borderLeft: `2px solid ${accent(0.7, 0.6)}`, color: ink(2), fontSize: FS.tiny, lineHeight: 1.45, fontStyle: 'italic' }} className="ai-scroll">
              {sel.text}
            </div>
            <textarea
              ref={noteRef}
              value={sel.note}
              onChange={(e) => setSel((s) => (s ? { ...s, note: e.target.value } : s))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmQuote() }
                else if (e.key === 'Escape') setSel(null)
              }}
              placeholder="写下你对这段的疑问（可留空，Enter 添加）"
              rows={2}
              className="ai-scroll"
              style={{ width: '100%', boxSizing: 'border-box', ...surface.inset(), borderRadius: R.sm, outline: 'none', resize: 'none', color: ink(1), fontSize: FS.small, lineHeight: 1.45, fontFamily: 'var(--font)', padding: '6px 8px', maxHeight: 70 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="primary" sm onClick={confirmQuote} style={{ flex: 1 }}>贴入输入区</Button>
              <Button variant="ghost" sm onClick={() => setSel(null)}>取消</Button>
            </div>
          </motion.div>
        </>
      )}
    </div>
  )
}
