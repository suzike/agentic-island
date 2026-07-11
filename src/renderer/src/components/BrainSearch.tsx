// 第二大脑检索浮层（Ctrl+Alt+F）：一个问题跨便签/问答/复盘/资讯/剪贴板召回 + AI 答疑带出处。

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCorpus, prefilter, brainPrompt, BRAIN_SYSTEM, type BrainSources, type BrainDoc } from '../logic/brain'
import { hashText, topKByCosine } from '../logic/vector'
import { Markdown } from './Markdown'

interface Props {
  open: boolean
  sources: BrainSources
  onClose: () => void
  onGenerate: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  onJump: (tab: BrainDoc['tab']) => void
  llmReady: boolean
  /** 向量化（有向量模型才走语义 RAG，否则回退关键词）；返回 null=不可用 */
  onEmbed: (texts: string[]) => Promise<number[][] | null>
  embedModel: string
  onSetEmbedModel: (m: string) => void
}

export function BrainSearch({ open, sources, onClose, onGenerate, onJump, llmReady, onEmbed, embedModel, onSetEmbedModel }: Props): React.JSX.Element | null {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const [hits, setHits] = useState<BrainDoc[]>([])
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'' | '语义' | '关键词'>('')
  const [cfgOpen, setCfgOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const vecCache = useRef<Record<string, number[]>>({}) // 内存缓存，避免重复向量化

  const corpus = useMemo(() => buildCorpus(sources), [sources])

  useEffect(() => {
    if (open) { setQ(''); setAnswer(''); setHits([]); setErr(''); setMode(''); setTimeout(() => inputRef.current?.focus(), 30) }
  }, [open])

  if (!open) return null

  // 语义召回：向量化 query + 未缓存的 doc，按余弦取前 14；失败返回 null 由调用方回退
  const vectorRecall = async (query: string): Promise<BrainDoc[] | null> => {
    if (!embedModel.trim()) return null
    const missing = corpus.filter((d) => !vecCache.current[hashText(d.text)])
    if (missing.length) {
      const vecs = await onEmbed(missing.map((d) => d.text.slice(0, 1500)))
      if (!vecs) return null
      missing.forEach((d, i) => { if (vecs[i]) vecCache.current[hashText(d.text)] = vecs[i] })
    }
    const qv = await onEmbed([query])
    if (!qv || !qv[0]) return null
    const vecs = corpus.map((d) => vecCache.current[hashText(d.text)])
    return topKByCosine(qv[0], vecs, 14).map((i) => corpus[i])
  }

  const search = async (): Promise<void> => {
    const query = q.trim()
    if (!query) return
    if (!llmReady) { setErr('请先在设置里配置问答模型'); return }
    setAnswer(''); setErr(''); setBusy(true); setMode('')
    let docs: BrainDoc[] | null = null
    try { docs = await vectorRecall(query) } catch { docs = null }
    if (docs) setMode('语义')
    else { docs = prefilter(corpus, query, 14); if (embedModel.trim()) setMode('关键词') }
    setHits(docs)
    const res = await onGenerate(BRAIN_SYSTEM, brainPrompt(query, docs))
    setBusy(false)
    if (res.ok && res.text) setAnswer(res.text.trim())
    else setErr(res.error || '检索失败')
  }

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', background: 'oklch(0.08 0.02 var(--ths) / .5)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(600px, 82vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'oklch(calc(0.17 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .98)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', boxShadow: 'none', animation: 'ai-riseblur .3s cubic-bezier(.22,.61,.36,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          <span style={{ fontSize: 15 }}>🧠</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } else if (e.key === 'Escape') onClose() }}
            placeholder="问你的第二大脑：我之前关于 X 的笔记 / 结论…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'oklch(0.96 0.01 var(--th))', fontSize: 14, fontFamily: 'var(--font)' }}
          />
          <span className="hv" onClick={() => setCfgOpen((v) => !v)} title="设置向量模型（语义 RAG）" style={{ flex: 'none', cursor: 'pointer', color: embedModel.trim() ? 'oklch(0.82 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 14 }}>⚙</span>
          <span className="hv" onClick={() => void search()} style={{ flex: 'none', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 12, fontWeight: 700 }}>{busy ? '检索中…' : '检索'}</span>
        </div>
        {cfgOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(255,255,255,.02)' }}>
            <span style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 10.5, flex: 'none' }}>向量模型</span>
            <input value={embedModel} onChange={(e) => onSetEmbedModel(e.target.value)} placeholder="留空=关键词检索;填如 text-embedding-3-small / bge-m3 走语义" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 7, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 10.5, padding: '5px 9px', fontFamily: "ui-monospace,'Cascadia Code',monospace" }} />
          </div>
        )}
        <div className="ai-scroll" style={{ overflowY: 'auto', padding: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {err && <div style={{ color: 'oklch(0.75 0.1 30)', fontSize: 11.5 }}>{err}</div>}
          {!answer && !busy && !err && (
            <div style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 11.5, lineHeight: 1.7 }}>
              统一检索你自己的 {corpus.length} 条记忆（便签 / 问答 / 复盘 / 资讯 / 剪贴板收藏）。{embedModel.trim() ? '已启用语义向量检索。' : '填向量模型可升级为语义 RAG（⚙）。'}回车开始。
            </div>
          )}
          {mode && <div style={{ color: 'oklch(0.7 calc(0.1 * var(--cs, 1)) var(--th) / .7)', fontSize: 9.5 }}>{mode === '语义' ? '🔮 语义向量召回' : '🔤 关键词召回（向量不可用，已回退）'}</div>}
          {answer && (
            <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)', fontSize: 12.5, lineHeight: 1.65 }}>
              <Markdown text={answer} />
            </div>
          )}
          {hits.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: 'oklch(0.66 0.02 var(--th) / .6)', fontSize: 10, fontWeight: 700 }}>命中的记忆 · 点击前往分区</div>
              {hits.slice(0, 8).map((d) => (
                <div key={d.id} className="hv" onClick={() => { onJump(d.tab); onClose() }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)' }}>
                  <span style={{ flex: 'none', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: 'oklch(0.32 0.06 var(--th) / .5)', color: 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))' }}>{d.source}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'oklch(0.82 0.02 var(--th) / .85)', fontSize: 11 }}>{d.title}</span>
                  <span style={{ flex: 'none', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11 }}>→</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
