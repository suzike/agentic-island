// 第二大脑检索浮层（Ctrl+Alt+F）：一个问题跨便签/问答/复盘/资讯/剪贴板召回 + AI 答疑带出处。
// 视觉层已重做到 ui/ 设计系统（overlayPop 浮层 + tokens 层级表面 + lucide 图标）；检索/生成逻辑不变。

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Type } from 'lucide-react'
import { buildCorpus, prefilter, brainPrompt, BRAIN_SYSTEM, type BrainSources, type BrainDoc } from '../logic/brain'
import { hashText, topKByCosine } from '../logic/vector'
import { Markdown } from './Markdown'
import { Button, IconButton, Input } from '../ui/components'
import { fadeScaleIn, overlayPop, staggerContainer, staggerItem } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'
import { Ico } from '../ui/icons'

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
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(6px)', animation: 'ai-fadein .15s ease' }}>
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(620px, 84vw)', maxHeight: '72vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...surface.overlay() }}
      >
        {/* 输入区：品牌图标 + 查询框 + 向量模型设置 + 检索按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: `${SP.md}px ${SP.lg - 1}px`, borderBottom: `0.5px solid ${hairline()}` }}>
          <div style={{ width: 26, height: 26, borderRadius: R.sm, flex: 'none', display: 'grid', placeItems: 'center', background: gradient.brand(), color: gradient.onPrimary(), boxShadow: `0 2px 8px ${accent(0.7, 0.35)}, inset 0 1px 0 rgba(255,255,255,.3)` }}>
            <Ico.brain size={14} strokeWidth={2} />
          </div>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } else if (e.key === 'Escape') onClose() }}
            placeholder="问你的第二大脑：我之前关于 X 的笔记 / 结论…"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: ink(1), fontSize: FS.subtitle, fontFamily: 'var(--font)' }}
          />
          <IconButton icon={Ico.settings} active={!!embedModel.trim()} onClick={() => setCfgOpen((v) => !v)} title="设置向量模型（语义 RAG）" />
          <Button variant="primary" sm icon={Ico.search} onClick={() => void search()} disabled={busy}>{busy ? '检索中…' : '检索'}</Button>
        </div>
        {cfgOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: `9px ${SP.lg - 1}px`, borderBottom: `0.5px solid ${hairline(0.07)}`, background: fill(1) }}>
            <span style={{ ...text.faint(), flex: 'none' }}>向量模型</span>
            <Input value={embedModel} onChange={onSetEmbedModel} placeholder="留空=关键词检索;填如 text-embedding-3-small / bge-m3 走语义" style={{ flex: 1, fontFamily: "'Cascadia Code', Consolas, ui-monospace, monospace" }} />
          </div>
        )}
        <div className="ai-scroll" style={{ overflowY: 'auto', padding: SP.md + 1, display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
          {err && (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: R.md, background: semBg(sem.danger, 0.12), border: `0.5px solid ${semBg(sem.danger, 0.32)}`, color: sem.danger, fontSize: FS.small }}>
              <Ico.close size={12} strokeWidth={2} style={{ flex: 'none' }} />{err}
            </motion.div>
          )}
          {!answer && !busy && !err && (
            <div style={{ ...text.dim(), lineHeight: 1.7 }}>
              统一检索你自己的 {corpus.length} 条记忆（便签 / 问答 / 复盘 / 资讯 / 剪贴板收藏）。{embedModel.trim() ? '已启用语义向量检索。' : '填向量模型可升级为语义 RAG。'}回车开始。
            </div>
          )}
          {mode && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: mode === '语义' ? accent(0.82, 0.8) : ink(3), fontSize: FS.tiny - 1 }}>
              {mode === '语义'
                ? <><Ico.ai size={11} strokeWidth={2} />语义向量召回</>
                : <><Type size={11} strokeWidth={2} />关键词召回（向量不可用，已回退）</>}
            </div>
          )}
          {answer && (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ ...surface.card(), padding: SP.md }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7, color: accent(0.82, 0.85) }}>
                <Ico.ai size={12} strokeWidth={2} />
                <span style={{ ...text.overline(), color: accent(0.82, 0.7) }}>AI 答疑 · 带出处</span>
              </div>
              <div style={{ fontSize: FS.body, lineHeight: 1.65 }}>
                <Markdown text={answer} />
              </div>
            </motion.div>
          )}
          {hits.length > 0 && (
            <motion.div variants={staggerContainer} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 2px' }}>
                <span style={text.overline()}>命中的记忆 · 点击前往分区</span>
                <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
              </div>
              {hits.slice(0, 8).map((d) => (
                <motion.div
                  key={d.id}
                  variants={staggerItem}
                  className="hv"
                  onClick={() => { onJump(d.tab); onClose() }}
                  style={{ display: 'flex', alignItems: 'center', gap: SP.sm, padding: '7px 10px', borderRadius: R.md, cursor: 'pointer', background: fill(1) }}
                >
                  <span style={{ flex: 'none', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: R.sm, background: semBg(accent(), 0.14), color: accent(0.85) }}>{d.source}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: ink(2), fontSize: FS.small }}>{d.title}</span>
                  <ArrowUpRight size={12} strokeWidth={2} style={{ flex: 'none', color: ink(3) }} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
