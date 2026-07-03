// 灵感便签：AI 把文章/网页/段落整理成排版优美的知识卡片（自动配色+标签），
// 支持手动新建/编辑（Markdown）、按标签/日期筛选、AI 语义搜索。瀑布流双栏布局。

import { useMemo, useRef, useState } from 'react'
import type { StickyNote } from '../types'
import { NOTE_COLORS, colorOf } from '../logic/noteAi'
import { imageToCompactDataUrl } from '../logic/files'
import { Markdown, Collapsible } from './Markdown'

interface NotesTabProps {
  notes: StickyNote[]
  onAdd: () => void
  onUpdate: (n: StickyNote) => void
  onDelete: (id: number) => void
  onTogglePin: (id: number) => void
  /** AI 生成：输入文本或 URL，返回反馈文案 */
  onAiCreate: (input: string) => Promise<string>
  /** AI 语义搜索：返回匹配 id 列表（null=AI 不可用，调用方回退关键词） */
  onAiSearch: (query: string) => Promise<number[] | null>
}

const fmtDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const dayLabel = (ts: number): string => {
  const d = new Date(ts)
  const today = new Date()
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= t0) return '今天'
  if (ts >= t0 - 86400000) return '昨天'
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 卡片配色：色相 → 玻璃渐变背景 + 边框 + 标题色 */
const cardStyle = (h: number, pinned?: boolean): React.CSSProperties => ({
  breakInside: 'avoid',
  marginBottom: 9,
  padding: '11px 12px',
  borderRadius: 14,
  background: `linear-gradient(160deg, oklch(0.33 0.055 ${h} / .4), oklch(0.22 0.035 ${h} / .28))`,
  border: `1px solid oklch(0.68 0.11 ${h} / ${pinned ? '.55' : '.3'})`,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  animation: 'ai-fadein .25s ease'
})

const chip = (h: number): React.CSSProperties => ({
  padding: '1.5px 8px',
  borderRadius: 999,
  background: `oklch(0.4 0.07 ${h} / .35)`,
  color: `oklch(0.85 0.08 ${h})`,
  fontSize: 9.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
})

const inputBase: React.CSSProperties = {
  boxSizing: 'border-box',
  background: 'rgba(0,0,0,.3)',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 9,
  color: 'oklch(0.95 0.01 var(--th))',
  fontSize: 11.5,
  padding: '7px 9px',
  outline: 'none',
  fontFamily: "'Segoe UI',system-ui,sans-serif"
}

export function NotesTab(p: NotesTabProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [aiIds, setAiIds] = useState<number[] | null>(null) // AI 搜索结果（null=未启用）
  const [aiBusy, setAiBusy] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genInput, setGenInput] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState<StickyNote | null>(null)
  const [preview, setPreview] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 富文本工具栏：对选区包裹/插入 Markdown（用户无需手写语法）
  const wrapSel = (before: string, after = '', placeholder = '文字'): void => {
    const ta = taRef.current
    if (!ta || !draft) return
    const s = ta.selectionStart ?? draft.md.length
    const e = ta.selectionEnd ?? draft.md.length
    const sel = draft.md.slice(s, e) || placeholder
    const md = draft.md.slice(0, s) + before + sel + after + draft.md.slice(e)
    setDraft({ ...draft, md })
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length) })
  }
  const insertLine = (text: string): void => {
    const ta = taRef.current
    if (!draft) return
    const s = ta?.selectionStart ?? draft.md.length
    const pre = draft.md.slice(0, s)
    const md = pre + (pre && !pre.endsWith('\n') ? '\n' : '') + text + '\n' + draft.md.slice(s)
    setDraft({ ...draft, md })
  }
  // 🖼 插图：本地图片压缩为 dataURL（≈720px JPEG）嵌入便签
  const pickImage = (): void => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.onchange = (): void => {
      const f = inp.files?.[0]
      if (!f) return
      imageToCompactDataUrl(f).then((url) => {
        if (url) insertLine(`![${f.name}](${url})`)
      })
    }
    inp.click()
  }

  // 全部标签（按出现频次）
  const allTags = useMemo(() => {
    const cnt = new Map<string, number>()
    p.notes.forEach((n) => n.tags.forEach((t) => cnt.set(t, (cnt.get(t) || 0) + 1)))
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12)
  }, [p.notes])

  // 过滤：AI 结果 > 关键词 > 标签
  const filtered = useMemo(() => {
    let list = [...p.notes]
    if (aiIds) list = aiIds.map((id) => list.find((n) => n.id === id)).filter(Boolean) as StickyNote[]
    else if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((n) => (n.title + n.md + n.tags.join(' ')).toLowerCase().includes(q))
    }
    if (tagFilter) list = list.filter((n) => n.tags.includes(tagFilter))
    if (!aiIds) list.sort((a, b) => Number(b.pinned || 0) - Number(a.pinned || 0) || b.createdAt - a.createdAt)
    return list
  }, [p.notes, query, aiIds, tagFilter])

  const aiSearch = (): void => {
    if (!query.trim() || aiBusy) return
    setAiBusy(true)
    p.onAiSearch(query.trim()).then((ids) => {
      setAiBusy(false)
      setAiIds(ids) // null = AI 不可用 → 保持关键词过滤
    })
  }

  const doGenerate = (): void => {
    if (!genInput.trim() || genBusy) return
    setGenBusy(true)
    setGenMsg('✨ AI 正在阅读并整理…')
    p.onAiCreate(genInput.trim()).then((msg) => {
      setGenBusy(false)
      setGenMsg(msg)
      if (msg.startsWith('✓')) setGenInput('')
    })
  }

  const startEdit = (n: StickyNote): void => { setEditId(n.id); setDraft({ ...n }); setPreview(false) }
  const saveEdit = (): void => {
    if (draft) p.onUpdate({ ...draft, updatedAt: Date.now() })
    setEditId(null); setDraft(null); setPreview(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 顶栏：搜索 + AI 搜 + 生成/新建 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRadius: 10, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)' }}>
          <span style={{ fontSize: 11, opacity: 0.5 }}>🔍</span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setAiIds(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') aiSearch() }}
            placeholder="搜索便签…（Enter = AI 语义搜索）"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'oklch(0.95 0.01 var(--th))', fontSize: 11.5, padding: '7px 0' }}
          />
          {query && (
            <span className="hv" onClick={() => { setQuery(''); setAiIds(null) }} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 11 }}>✕</span>
          )}
        </div>
        <div className="hv" onClick={aiSearch} title="AI 语义搜索（不只是关键词匹配）" style={{ padding: '0 11px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: aiIds ? 'oklch(0.35 0.08 var(--th) / .5)' : 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)', color: 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 11, fontWeight: 700 }}>
          {aiBusy ? '…' : '✨ AI 搜'}
        </div>
        <div className="hv" onClick={() => setGenOpen((v) => !v)} title="AI 生成便签（丢文章/链接/段落进来）" style={{ padding: '0 12px', borderRadius: 10, display: 'flex', alignItems: 'center', cursor: 'pointer', background: genOpen ? 'oklch(0.3 0.05 var(--th) / .45)' : 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: genOpen ? 'oklch(0.9 0.02 var(--th))' : 'oklch(0.14 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>
          ✨ 生成
        </div>
        <div className="hv" onClick={p.onAdd} title="手动新建空白便签" style={{ padding: '0 11px', borderRadius: 10, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: 'oklch(0.85 0.02 var(--th))', fontSize: 13, fontWeight: 700 }}>
          ＋
        </div>
      </div>

      {/* AI 生成面板 */}
      {genOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 11, borderRadius: 13, background: 'oklch(0.26 0.04 var(--th) / .25)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .3)' }}>
          <textarea
            value={genInput}
            onChange={(e) => setGenInput(e.target.value)}
            placeholder={'粘贴任意内容，AI 整理成排版优美的知识便签：\n· 一段文字 / 整篇文章\n· 网页链接（自动抓取正文）\n· 本地 md/txt 直接拖进问答后复制过来\n（Word/PDF 暂不支持解析，可复制其中文字）'}
            rows={4}
            className="ai-scroll"
            style={{ ...inputBase, width: '100%', resize: 'none', lineHeight: 1.55, maxHeight: 120 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="hv" onClick={doGenerate} style={{ padding: '6px 16px', borderRadius: 999, background: genInput.trim() && !genBusy ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: genInput.trim() && !genBusy ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              {genBusy ? '整理中…' : '✨ 整理成便签'}
            </div>
            {genMsg && <span style={{ flex: 1, color: genMsg.startsWith('✓') ? 'oklch(0.8 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 10.5 }}>{genMsg}</span>}
          </div>
        </div>
      )}

      {/* 标签筛选 */}
      {allTags.length > 0 && (
        <div className="ai-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {allTags.map((t) => (
            <div key={t} className="hv" onClick={() => setTagFilter(tagFilter === t ? '' : t)} style={{ flex: 'none', padding: '3.5px 11px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', background: tagFilter === t ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)', color: tagFilter === t ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.78 0.02 var(--th) / .8)' }}>
              # {t}
            </div>
          ))}
        </div>
      )}
      {aiIds && <div style={{ color: 'oklch(0.78 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10 }}>✨ AI 找到 {filtered.length} 条相关便签（<span className="hv" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setAiIds(null)}>返回全部</span>）</div>}

      {/* 空态 */}
      {filtered.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 14px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.09)' }}>
          <div style={{ fontSize: 22, opacity: 0.6 }}>{p.notes.length === 0 ? '🗂️' : '🔍'}</div>
          <div style={{ color: 'oklch(0.8 0.02 var(--th) / .85)', fontSize: 12, fontWeight: 600 }}>{p.notes.length === 0 ? '还没有便签' : '没有匹配的便签'}</div>
          {p.notes.length === 0 && <div style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 10.5, textAlign: 'center', lineHeight: 1.7 }}>点 ✨生成 丢一篇文章/链接给 AI<br />每天积累一点碎片化知识</div>}
        </div>
      )}

      {/* 瀑布流双栏（按日期分组仅在无筛选时显示组头） */}
      <div style={{ columnCount: 2, columnGap: 9 }}>
        {filtered.map((n) => {
          const h = colorOf(n.color)
          const editing = editId === n.id && draft
          if (editing) {
            return (
              <div key={n.id} style={{ ...cardStyle(h), border: `1.5px solid oklch(0.75 0.13 ${h} / .7)` }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  <input value={draft.emoji} onChange={(e) => setDraft((d) => d && { ...d, emoji: e.target.value })} style={{ ...inputBase, width: 38, textAlign: 'center', padding: '5px 2px' }} />
                  <input value={draft.title} onChange={(e) => setDraft((d) => d && { ...d, title: e.target.value })} placeholder="标题" style={{ ...inputBase, flex: 1, fontWeight: 700 }} />
                </div>
                {/* 富文本工具栏：点按钮即可排版，无需手写 Markdown */}
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {([
                    ['𝐁', '加粗', (): void => wrapSel('**', '**')],
                    ['H', '小标题', (): void => insertLine('## 小标题')],
                    ['•', '要点列表', (): void => insertLine('- 要点')],
                    ['❝', '引用', (): void => insertLine('> 引用一句话')],
                    ['‹›', '代码', (): void => wrapSel('`', '`', 'code')],
                    ['▤', '代码块', (): void => insertLine('```\n代码\n```')],
                    ['🔗', '链接', (): void => wrapSel('[', '](https://)', '链接文字')],
                    ['🖼', '插入图片', pickImage]
                  ] as [string, string, () => void][]).map(([icon, title, fn]) => (
                    <div key={title} className="hv" title={title} onClick={fn} style={{ minWidth: 24, height: 22, padding: '0 5px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.07)', color: 'oklch(0.85 0.02 var(--th) / .9)', fontSize: 10.5, fontWeight: 700 }}>
                      {icon}
                    </div>
                  ))}
                  <span style={{ flex: 1 }} />
                  <div className="hv" title="预览排版效果" onClick={() => setPreview((v) => !v)} style={{ height: 22, padding: '0 9px', borderRadius: 6, display: 'flex', alignItems: 'center', cursor: 'pointer', background: preview ? `oklch(0.45 0.1 ${h} / .5)` : 'rgba(255,255,255,.07)', color: 'oklch(0.9 0.02 var(--th))', fontSize: 10, fontWeight: 700 }}>
                    👁 {preview ? '编辑' : '预览'}
                  </div>
                </div>
                {preview ? (
                  <div className="ai-scroll" style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 9px', borderRadius: 9, background: 'rgba(0,0,0,.22)' }}>
                    <Markdown text={draft.md} />
                  </div>
                ) : (
                  <textarea ref={taRef} value={draft.md} onChange={(e) => setDraft((d) => d && { ...d, md: e.target.value })} placeholder="正文…（用上方按钮排版，或直接打字）" rows={8} className="ai-scroll" style={{ ...inputBase, width: '100%', resize: 'none', lineHeight: 1.55, fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 10.5, maxHeight: 220 }} />
                )}
                <input value={draft.tags.join(' ')} onChange={(e) => setDraft((d) => d && { ...d, tags: e.target.value.split(/[\s,，、]+/).filter(Boolean).slice(0, 4) })} placeholder="标签（空格分隔）" style={{ ...inputBase, fontSize: 10.5 }} />
                {/* 配色盘 */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {NOTE_COLORS.map((c) => (
                    <div key={c.key} title={c.label} className="hv" onClick={() => setDraft((d) => d && { ...d, color: c.key })} style={{ width: 17, height: 17, borderRadius: 999, cursor: 'pointer', background: `oklch(0.6 0.13 ${c.h})`, border: draft.color === c.key ? '2px solid #fff' : '2px solid transparent', boxSizing: 'border-box' }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div className="hv" onClick={saveEdit} style={{ flex: 1, textAlign: 'center', padding: '5.5px 0', borderRadius: 8, background: `oklch(0.6 0.12 ${h})`, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>✓ 保存</div>
                  <div className="hv" onClick={() => { setEditId(null); setDraft(null) }} style={{ padding: '5.5px 12px', borderRadius: 8, background: 'rgba(255,255,255,.07)', color: 'oklch(0.8 0.02 var(--th) / .8)', fontSize: 11, cursor: 'pointer' }}>取消</div>
                </div>
              </div>
            )
          }
          return (
            <div key={n.id} className="ai-card" style={cardStyle(h, n.pinned)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                <span style={{ fontSize: 15, lineHeight: 1.2 }}>{n.emoji}</span>
                <span style={{ flex: 1, color: `oklch(0.92 0.04 ${h})`, fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>{n.pinned ? '📌 ' : ''}{n.title}</span>
              </div>
              <div style={{ fontSize: 11 }}>
                <Collapsible collapsedHeight={110}>
                  <Markdown text={n.md} />
                </Collapsible>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {n.tags.map((t) => (
                  <span key={t} onClick={() => setTagFilter(tagFilter === t ? '' : t)} style={chip(h)}># {t}</span>
                ))}
                <span style={{ marginLeft: 'auto', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9 }}>{dayLabel(n.createdAt)} {fmtDate(n.createdAt) !== dayLabel(n.createdAt) ? '' : ''}</span>
              </div>
              {/* 悬停浮现操作 */}
              <div className="row-acts" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <span className="hv" title={n.pinned ? '取消置顶' : '置顶'} onClick={() => p.onTogglePin(n.id)} style={{ cursor: 'pointer', fontSize: 10.5, color: 'oklch(0.75 0.02 var(--th) / .7)' }}>📌</span>
                <span className="hv" title="编辑" onClick={() => startEdit(n)} style={{ cursor: 'pointer', fontSize: 10.5, color: 'oklch(0.75 0.02 var(--th) / .7)' }}>✎</span>
                <span className="hv" title="复制内容" onClick={() => navigator.clipboard?.writeText(`# ${n.title}\n\n${n.md}`).catch(() => {})} style={{ cursor: 'pointer', fontSize: 10.5, color: 'oklch(0.75 0.02 var(--th) / .7)' }}>⧉</span>
                <span className="hv" title="删除" onClick={() => p.onDelete(n.id)} style={{ cursor: 'pointer', fontSize: 10.5, color: 'oklch(0.6 0.05 25 / .8)' }}>✕</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
