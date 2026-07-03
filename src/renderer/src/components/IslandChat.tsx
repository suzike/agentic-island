// Island Chat：消息气泡（用户/AI，AI 支持 h/p/ul/code/note/think 富文本 + Markdown）+ 富输入。
// v2：多行输入（Enter 发送 / Shift+Enter 换行，自动增高）、新消息自动滚底、
// 消息时间戳、悬停浮现复制（用户/AI 均可）。

import { useEffect, useRef, useState } from 'react'
import type { ChatProps, QuoteRef } from '../types'
import { Markdown, Collapsible } from './Markdown'
import { blocksToText } from '../logic/chat'
import { readAttachment } from '../logic/files'

const attIcon = (t: string): string => (t === 'file' ? '📎' : '📷')

/** 引用卡片：左侧主题色条 + 引用原文 + 可选疑问；输入区可删除，气泡内只读展示 */
function QuoteCard({ q, onRemove, compact }: { q: QuoteRef; onRemove?: () => void; compact?: boolean }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, borderRadius: 9, background: 'oklch(0.42 calc(0.09 * var(--cs, 1)) var(--th) / .16)', border: '1px solid oklch(0.68 calc(0.14 * var(--cs, 1)) var(--th) / .32)', overflow: 'hidden', maxWidth: '100%' }}>
      <div style={{ width: 3, flex: 'none', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.62 calc(0.15 * var(--cs, 1)) var(--th2)))' }} />
      <div style={{ flex: 1, minWidth: 0, padding: compact ? '5px 8px' : '6px 9px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ flex: 'none', color: 'oklch(0.78 calc(0.14 * var(--cs, 1)) var(--th) / .9)', fontSize: 10, marginTop: 1 }}>❝</span>
          <span style={{ flex: 1, minWidth: 0, color: 'oklch(0.82 0.02 var(--th) / .82)', fontSize: 10.5, lineHeight: 1.45, fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: compact ? 2 : 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {q.text}
          </span>
          {onRemove && (
            <span className="hv" onClick={onRemove} title="移除引用" style={{ flex: 'none', color: 'oklch(0.7 0.02 var(--th) / .55)', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>
              ✕
            </span>
          )}
        </div>
        {q.note && q.note.trim() && (
          <div style={{ color: 'oklch(0.86 calc(0.06 * var(--cs, 1)) var(--th) / .92)', fontSize: 10.5, lineHeight: 1.4, paddingLeft: 16 }}>
            <span style={{ opacity: 0.6 }}>↳ </span>{q.note}
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
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.multiple = true
  if (accept) inp.accept = accept
  inp.onchange = (): void => {
    Array.from(inp.files || []).forEach((f) => {
      readAttachment(f).then((att) => onAttach(att.type, att))
    })
  }
  inp.click()
}

const copyChip = (active: boolean): React.CSSProperties => ({
  padding: '1px 8px',
  borderRadius: 999,
  background: 'rgba(255,255,255,.07)',
  color: active ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' : 'oklch(0.7 0.02 var(--th) / .6)',
  fontSize: 9,
  fontWeight: 600,
  cursor: 'pointer'
})

export function IslandChat(p: ChatProps): React.JSX.Element {
  const composer = p.composer
  const quotes = p.quotes || []
  const canSend = !!(composer.text && composer.text.trim()) || composer.attachments.length > 0 || quotes.length > 0
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  // 引用追问弹窗：框选 AI 片段后浮现，写疑问 → 贴入输入区
  const [sel, setSel] = useState<{ text: string; note: string; x: number; y: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // 在 AI 气泡内框选文字 → 记录选区文本与位置，弹出备注窗
  const onAiSelect = (e: React.MouseEvent): void => {
    if (!p.enableQuote) return
    const s = window.getSelection()
    if (!s || s.isCollapsed) return
    const text = s.toString().trim()
    if (!text || text.length < 2) return
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

  const confirmQuote = (): void => {
    if (!sel) return
    p.onAddQuote?.({ text: sel.text, note: sel.note.trim() || undefined })
    window.getSelection()?.removeAllRanges()
    setSel(null)
  }

  // 新消息自动滚到底部
  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [p.messages.length, p.messages[p.messages.length - 1]?.typing])

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
              <div key={mi} className="msg" style={{ alignSelf: 'flex-end', maxWidth: '86%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
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
                      <div key={ai} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 4px', borderRadius: 9, background: 'rgba(255,255,255,.08)' }}>
                        {a.type === 'screenshot' ? (
                          a.thumb ? (
                            <img src={a.thumb} style={{ width: 34, height: 24, borderRadius: 5, objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: 22, height: 22, borderRadius: 5, background: 'linear-gradient(135deg, oklch(0.6 0.12 200), oklch(0.5 0.14 280))' }} />
                          )
                        ) : (
                          <span style={{ fontSize: 11 }}>{attIcon(a.type)}</span>
                        )}
                        <span style={{ color: 'oklch(0.85 0.02 var(--th) / .85)', fontSize: 10.5 }}>{a.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!!m.text && (
                  <div style={{ padding: '8px 12px', borderRadius: '14px 14px 4px 14px', background: 'linear-gradient(180deg, oklch(0.5 calc(0.11 * var(--cs, 1)) var(--th)), oklch(0.42 calc(0.11 * var(--cs, 1)) var(--th)))', color: 'oklch(0.98 0.01 var(--th))', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {m.text}
                  </div>
                )}
                {/* 悬停浮现：时间 + 复制我的提问 */}
                <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {m.ts && <span style={{ fontSize: 9, color: 'oklch(0.6 0.02 var(--th) / .5)' }}>{fmtTs(m.ts)}</span>}
                  <div className="hv" onClick={() => copyText(mi, m.text || '')} style={copyChip(copiedIdx === mi)}>
                    {copiedIdx === mi ? '✓' : '⧉'}
                  </div>
                </div>
              </div>
            ) : (
              <div key={mi} className="msg" style={{ alignSelf: 'flex-start', maxWidth: '92%', display: 'flex', gap: 8 }}>
                <div style={{ width: 20, height: 20, flex: 'none', borderRadius: 6, background: 'linear-gradient(135deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.62 calc(0.15 * var(--cs, 1)) var(--th2)))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, marginTop: 2 }}>
                  ◆
                </div>
                <div
                  onMouseUp={p.enableQuote && !m.typing ? onAiSelect : undefined}
                  style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 13px', borderRadius: '4px 14px 14px 14px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.06)', minWidth: 0, userSelect: p.enableQuote ? 'text' : undefined, cursor: p.enableQuote && !m.typing ? 'text' : undefined }}
                >
                  {m.typing && (
                    <div style={{ display: 'flex', gap: 4, padding: '2px 0' }}>
                      {[0, 0.2, 0.4].map((d) => (
                        <div key={d} style={{ width: 6, height: 6, borderRadius: 999, background: 'oklch(0.7 calc(0.08 * var(--cs, 1)) var(--th))', animation: `ai-dotpulse 1s ease-in-out ${d}s infinite` }} />
                      ))}
                    </div>
                  )}
                  {/* 思考过程：合并所有 think 块为一段，默认只露一部分、可展开（避免占用过多篇幅） */}
                  {(() => {
                    const thinks = (m.blocks || []).filter((b) => b.t === 'think')
                    if (!thinks.length) return null
                    const thinkText = thinks.map((b) => b.text || '').filter(Boolean).join('\n\n')
                    return (
                      <div style={{ borderLeft: '2px solid oklch(0.6 0.1 260 / .5)', paddingLeft: 9, margin: '1px 0 3px' }}>
                        <div style={{ color: 'oklch(0.7 0.06 260 / .8)', fontSize: 10.5, fontWeight: 600, marginBottom: 3 }}>💭 思考过程</div>
                        <div style={{ opacity: 0.72 }}>
                          <Collapsible collapsedHeight={52}>
                            <Markdown text={thinkText} />
                          </Collapsible>
                        </div>
                      </div>
                    )
                  })()}
                  {(m.blocks || []).filter((b) => b.t !== 'think').map((b, bi) => {
                    if (b.t === 'h') return <div key={bi} style={{ color: 'oklch(0.94 0.02 var(--th))', fontSize: 12.5, fontWeight: 700 }}>{b.text}</div>
                    if (b.t === 'p')
                      return (
                        <div key={bi} style={{ color: 'oklch(0.84 0.02 var(--th) / .9)' }}>
                          <Markdown text={b.text || ''} />
                        </div>
                      )
                    if (b.t === 'ul')
                      return (
                        <div key={bi} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {(b.items || []).map((li, li2) => (
                            <div key={li2} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                              <div style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', fontSize: 12, lineHeight: 1.5 }}>•</div>
                              <div style={{ color: 'oklch(0.82 0.02 var(--th) / .88)', fontSize: 12, lineHeight: 1.5 }}>{li}</div>
                            </div>
                          ))}
                        </div>
                      )
                    if (b.t === 'code')
                      return (
                        <div key={bi} style={{ color: 'oklch(0.86 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 11.5, fontFamily: "ui-monospace,'Cascadia Code',Consolas,monospace", background: 'rgba(0,0,0,.32)', padding: '8px 10px', borderRadius: 8, overflowX: 'auto', whiteSpace: 'pre' }}>
                          {b.text}
                        </div>
                      )
                    return <div key={bi} style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 11, fontStyle: 'italic' }}>{b.text}</div>
                  })}
                  {/* 悬停浮现：时间 + 复制整条回复 */}
                  {!m.typing && (m.blocks?.length ?? 0) > 0 && (
                    <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginTop: 1 }}>
                      {m.ts && <span style={{ fontSize: 9, color: 'oklch(0.6 0.02 var(--th) / .5)' }}>{fmtTs(m.ts)}</span>}
                      <div className="hv" onClick={() => copyText(mi, blocksToText(m.blocks!))} style={copyChip(copiedIdx === mi)}>
                        {copiedIdx === mi ? '✓ 已复制' : '⧉ 复制'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* composer */}
      <div style={{ borderRadius: 16, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', padding: 8 }}>
        {quotes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'oklch(0.72 0.02 var(--th) / .6)', fontSize: 9.5, fontWeight: 600 }}>
              <span>❝ 引用 {quotes.length} 段作为上下文</span>
              <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
            </div>
            {quotes.map((q) => (
              <QuoteCard key={q.id} q={q} onRemove={() => p.onRemoveQuote?.(q.id)} />
            ))}
          </div>
        )}
        {composer.attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 7 }}>
            {composer.attachments.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px 4px 5px', borderRadius: 9, background: 'rgba(255,255,255,.08)' }}>
                {a.type === 'screenshot' ? (
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: 'linear-gradient(135deg, oklch(0.6 0.12 200), oklch(0.5 0.14 280))' }} />
                ) : (
                  <span style={{ fontSize: 11 }}>{attIcon(a.type)}</span>
                )}
                <span style={{ color: 'oklch(0.85 0.02 var(--th) / .85)', fontSize: 10.5 }}>{a.name}</span>
                <span style={{ color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 11, cursor: 'pointer' }} onClick={() => p.onRemoveAtt(i)}>
                  ✕
                </span>
              </div>
            ))}
          </div>
        )}

        {(p.quickReplies?.length ?? 0) > 0 && (
          <div className="ai-scroll" style={{ display: 'flex', gap: 6, marginBottom: 7, overflowX: 'auto', paddingBottom: 2 }}>
            {p.quickReplies!.map((q) => (
              <div
                key={q}
                className="hv"
                onClick={() => p.onQuick?.(q)}
                style={{ flex: 'none', padding: '4px 11px', borderRadius: 999, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: 'oklch(0.84 0.04 var(--th))', fontSize: 10.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {q}
              </div>
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
            placeholder={p.placeholder}
            rows={1}
            className="ai-scroll"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: 'oklch(0.95 0.01 var(--th))', fontSize: 12.5, lineHeight: 1.5, fontFamily: "'Segoe UI',system-ui,sans-serif", padding: '6px 4px', maxHeight: 116, overflowY: 'auto' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div title="图片" onClick={() => pickFiles('image/*', p.onAttach)} className="hv" style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'oklch(0.8 0.02 var(--th) / .8)', fontSize: 14 }}>
              🖼
            </div>
            <div title="文件" onClick={() => pickFiles('', p.onAttach)} className="hv" style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'oklch(0.8 0.02 var(--th) / .8)', fontSize: 14 }}>
              📎
            </div>
            <div
              className="hv"
              onClick={() => canSend && p.onSend()}
              title="发送（Enter）· 换行（Shift+Enter）"
              style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canSend ? 'pointer' : 'default', background: canSend ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: canSend ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 14, marginLeft: 2 }}
            >
              ↑
            </div>
          </div>
        </div>
      </div>

      {/* 引用追问弹窗：框选 AI 片段后浮现于选区下方，写疑问 → 贴入输入区 */}
      {sel && (
        <>
          <div onMouseDown={() => setSel(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div
            style={{ position: 'fixed', left: sel.x, top: sel.y, zIndex: 41, width: 250, padding: 10, borderRadius: 13, background: 'oklch(0.18 calc(0.03 * var(--cs, 1)) var(--ths) / .98)', border: '1px solid oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .3)', boxShadow: '0 12px 34px -8px oklch(0.1 0.05 var(--th) / .7)', display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'oklch(0.82 calc(0.12 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontWeight: 700 }}>
              <span>❝ 引用追问</span>
            </div>
            <div style={{ maxHeight: 66, overflowY: 'auto', padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,.05)', borderLeft: '2px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .6)', color: 'oklch(0.8 0.02 var(--th) / .82)', fontSize: 10.5, lineHeight: 1.45, fontStyle: 'italic' }} className="ai-scroll">
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
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, outline: 'none', resize: 'none', color: 'oklch(0.95 0.01 var(--th))', fontSize: 11, lineHeight: 1.45, fontFamily: "'Segoe UI',system-ui,sans-serif", padding: '6px 8px', maxHeight: 70 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <div className="hv" onClick={confirmQuote} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 8, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                ↓ 贴入输入区
              </div>
              <div className="hv" onClick={() => setSel(null)} style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .7)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                取消
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
