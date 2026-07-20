// 知识库管理浮层：接入本地文件夹 / 文件（含 PDF·Word）/ 网页 → 切块+向量化 → 语义检索作答（RAG）。
// 检索必须向量嵌入：顶部要求配置 Embedding 模型（未配则禁用添加，给出引导）。
// 视觉层已重做到设计系统（ui/tokens + ui/components + framer-motion），功能逻辑不变。

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, FolderOpen, Globe, MessagesSquare, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import type { KbSourceView, LlmRequestConfig } from '../../../shared/protocol'
import { island } from '../bridge'
import { Markdown } from './Markdown'
import { Badge, Button, EmptyState, IconButton, Input } from '../ui/components'
import { Ico, type LucideIcon } from '../ui/icons'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, fill, FS, hairline, ink, R, sem, semBg, SP, surface, text, transition } from '../ui/tokens'

interface Props {
  open: boolean
  onClose: () => void
  embedCfg: LlmRequestConfig // { baseUrl, apiKey, model: embedModel }
  embedModel: string
  onSetEmbedModel: (m: string) => void
  onChanged: () => void // 通知 App 刷新 kbSources（问答模式用）
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  llmReady: boolean
}

const KIND_GLYPH: Record<string, LucideIcon> = { folder: FolderOpen, files: FileText, url: Globe, conversation: MessagesSquare }

// LLM-Wiki 合成：把代表性片段综合成一页结构化知识总览（编译一次、长期复用）
const WIKI_SYSTEM =
  '你是知识整理专家。下面是从用户知识库里代表性抽取的若干片段（含来源标题）。请综合成一页"知识总览 Wiki"，简体中文 Markdown：\n' +
  '## 这个知识库讲什么（2-3 句总括）\n## 关键主题（每个主题一个 ### 小标题 + 2-4 句跨片段提炼，不要逐条复述原文）\n' +
  '## 高频概念/术语（列表，每条「术语 — 一句解释」）\n## 可以问它的问题（5 条示范提问，引导善用知识库）\n' +
  '要综合、去重、成体系、突出主线；只依据片段，不编造。'

export function KnowledgePanel({ open, onClose, embedCfg, embedModel, onSetEmbedModel, onChanged, onAI, llmReady }: Props): React.JSX.Element | null {
  const [sources, setSources] = useState<KbSourceView[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [showUrl, setShowUrl] = useState(false)
  const [wiki, setWiki] = useState('')
  const [wikiAt, setWikiAt] = useState(0)
  const [wikiOpen, setWikiOpen] = useState(false)

  const refresh = (): void => { void island.kbList().then(setSources) }
  useEffect(() => {
    if (open) {
      refresh(); setMsg(''); setErr(''); setUrlInput(''); setShowUrl(false)
      void island.kbGetWiki().then((w) => { const o = w.overview; setWiki(o?.md || ''); setWikiAt(o?.at || 0) })
    }
  }, [open])
  if (!open) return null

  const genOverview = async (): Promise<void> => {
    if (!llmReady) { setErr('请先配置问答模型'); return }
    setBusy('wiki'); setErr(''); setMsg('')
    const r = await island.kbSampleChunks(22)
    if (!r.ok || !r.chunks?.length) { setBusy(''); setErr(r.error || '知识库为空，无法生成总览'); return }
    const body = r.chunks.map((c, i) => `【片段${i + 1} · ${c.title}】\n${c.text}`).join('\n\n')
    const g = await onAI(WIKI_SYSTEM, body.slice(0, 20000))
    setBusy('')
    if (g.ok && g.text) {
      const md = g.text.trim()
      setWiki(md); setWikiAt(Date.now()); setWikiOpen(true)
      void island.kbSaveWiki('overview', md)
    } else setErr(g.error || '生成失败')
  }

  const embedReady = !!embedModel.trim() && !!embedCfg.baseUrl && !!embedCfg.apiKey
  const totalDocs = sources.reduce((a, s) => a + s.docCount, 0)

  const after = (label: string, r: { ok?: boolean; canceled?: boolean; added?: number; skipped?: number; changed?: number; error?: string }): void => {
    setBusy('')
    if (r.canceled) return
    if (r.ok) {
      const bits = [r.added != null ? `+${r.added} 块` : '', r.changed != null ? `${r.changed} 变更` : '', r.skipped ? `跳过 ${r.skipped}` : ''].filter(Boolean).join(' · ')
      setMsg(`${label}完成${bits ? '：' + bits : ''}`); setErr(''); refresh(); onChanged()
    } else setErr(r.error || `${label}失败`)
  }

  const addFolder = (): void => { setBusy('folder'); setErr(''); setMsg(''); void island.kbAddFolder(embedCfg).then((r) => after('文件夹索引', r)) }
  const addFiles = (): void => { setBusy('files'); setErr(''); setMsg(''); void island.kbAddFiles(embedCfg).then((r) => after('文件索引', r)) }
  const addUrl = (): void => {
    const u = urlInput.trim(); if (!u) return
    setBusy('url'); setErr(''); setMsg('')
    void island.kbAddUrl(embedCfg, u).then((r) => { after('网页索引', r); if (r.ok) { setUrlInput(''); setShowUrl(false) } })
  }
  const reindex = (): void => { setBusy('reindex'); setErr(''); setMsg(''); void island.kbReindex(embedCfg).then((r) => after('增量重扫', r)) }
  const remove = (id: string): void => { void island.kbRemove(id).then(() => { refresh(); onChanged() }) }

  /** 添加动作大卡（文件夹/文件/网页）：激活态走主题色 */
  const btn = (active: boolean): React.CSSProperties => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '11px 6px',
    borderRadius: R.lg,
    cursor: embedReady && !busy ? 'pointer' : 'default',
    background: active ? semBg(accent(), 0.16) : fill(2),
    border: `0.5px solid ${active ? accent(0.7, 0.4) : hairline(0.06)}`,
    opacity: embedReady ? 1 : 0.45,
    color: active ? accent() : ink(2),
    transition: transition('background, border-color, color'),
  })

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh', background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}>
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(620px, 84vw)', maxHeight: '76vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', ...surface.overlay() }}
      >
        {/* 头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 15px', borderBottom: `0.5px solid ${hairline(0.1)}` }}>
          <div style={{ width: 26, height: 26, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: semBg(accent(), 0.14), color: accent(), flex: 'none' }}>
            <Ico.kb size={14} strokeWidth={1.75} />
          </div>
          <span style={{ flex: 1, ...text.subtitle(), fontSize: FS.subtitle, fontWeight: 700 }}>知识库 · 本地 RAG</span>
          <span style={{ ...text.faint(), fontVariantNumeric: 'tabular-nums' }}>{sources.length} 源 · {totalDocs} 块</span>
          <IconButton icon={Ico.close} onClick={onClose} title="关闭" size={26} />
        </div>

        {/* Embedding 模型（检索必须向量嵌入） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 15px', borderBottom: `0.5px solid ${hairline(0.09)}`, background: embedReady ? fill(1) : semBg(sem.warn, 0.1) }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: embedReady ? ink(2) : sem.warn, fontSize: FS.tiny, fontWeight: 600, flex: 'none' }}>
            <Ico.brain size={12} strokeWidth={1.75} />向量模型
          </span>
          <Input value={embedModel} onChange={onSetEmbedModel} placeholder="必填，如 text-embedding-3-small / bge-m3 / embedding-3" style={{ flex: 1, fontFamily: "'Cascadia Code', Consolas, ui-monospace, monospace" }} />
        </div>
        {!embedReady && <div style={{ padding: '7px 15px', color: sem.warn, fontSize: FS.tiny, background: semBg(sem.warn, 0.08), lineHeight: 1.5 }}>先填向量模型并在「设置 › 问答助手模型」配好端点/Key，才能建立与检索知识库（复用同一端点）。</div>}

        {/* 添加动作 */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 15px 8px' }}>
          <div className="hv" onClick={() => embedReady && !busy && addFolder()} style={btn(busy === 'folder')}><FolderOpen size={17} strokeWidth={1.75} /><span style={{ fontSize: FS.tiny, fontWeight: 600 }}>{busy === 'folder' ? '索引中…' : '文件夹'}</span></div>
          <div className="hv" onClick={() => embedReady && !busy && addFiles()} style={btn(busy === 'files')}><FileText size={17} strokeWidth={1.75} /><span style={{ fontSize: FS.tiny, fontWeight: 600 }}>{busy === 'files' ? '索引中…' : '文件 (PDF/Word)'}</span></div>
          <div className="hv" onClick={() => embedReady && !busy && setShowUrl((v) => !v)} style={btn(showUrl || busy === 'url')}><Globe size={17} strokeWidth={1.75} /><span style={{ fontSize: FS.tiny, fontWeight: 600 }}>{busy === 'url' ? '抓取中…' : '网页'}</span></div>
        </div>
        {showUrl && (
          <div style={{ display: 'flex', gap: 6, padding: '0 15px 8px' }}>
            <Input autoFocus value={urlInput} onChange={setUrlInput} onKeyDown={(e) => { if (e.key === 'Enter') addUrl() }} placeholder="https://… 粘贴要收进知识库的网页" icon={Ico.link} style={{ flex: 1 }} />
            <Button variant="primary" onClick={addUrl}>抓取</Button>
          </div>
        )}

        {(msg || err) && <div style={{ padding: '2px 15px 8px', fontSize: FS.tiny, color: err ? sem.danger : sem.calm }}>{err || msg}</div>}

        {/* 源列表 + AI 知识总览 */}
        <div className="ai-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 15px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {/* AI 知识总览（LLM-Wiki：编译一次、长期复用） */}
          {sources.length > 0 && (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 11px', borderRadius: R.lg, background: semBg(sem.focus, 0.12), border: `0.5px solid ${semBg(sem.focus, 0.35)}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Ico.ai size={13} strokeWidth={1.75} style={{ color: sem.focus, flex: 'none' }} />
                <span style={{ flex: 1, color: ink(1), fontSize: FS.small, fontWeight: 700 }}>AI 知识总览</span>
                {wiki && (
                  <span className="hv" onClick={() => setWikiOpen((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: ink(3), fontSize: FS.tiny }}>
                    {wikiOpen ? <Ico.expand size={11} strokeWidth={2} /> : <Ico.collapse size={11} strokeWidth={2} />}
                    {wikiOpen ? '收起' : '展开'}
                  </span>
                )}
                <span
                  className="hv"
                  onClick={() => void genOverview()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: llmReady ? 'pointer' : 'default', padding: '4px 10px', borderRadius: R.pill, background: semBg(sem.focus, 0.22), border: `0.5px solid ${semBg(sem.focus, 0.4)}`, color: sem.focus, fontSize: FS.tiny, fontWeight: 700, opacity: llmReady ? 1 : 0.5, transition: transition('background, border-color') }}
                >
                  {busy === 'wiki' ? '合成中…' : wiki ? '重新生成' : <><Sparkles size={11} strokeWidth={2} />生成总览</>}
                </span>
              </div>
              {!wiki && <div style={{ color: ink(3), fontSize: 10, lineHeight: 1.5 }}>把整库综合成一页结构化 Wiki（主题/术语/可问的问题），编译一次长期复用；资料更新后可重新生成。</div>}
              {wiki && wikiOpen && (
                <div style={{ ...surface.inset(), padding: '9px 11px', fontSize: FS.small, lineHeight: 1.6, maxHeight: 260, overflowY: 'auto' }} className="ai-scroll"><Markdown text={wiki} /></div>
              )}
              {wiki && wikiAt > 0 && <div style={{ color: ink(4), fontSize: 9 }}>更新于 {new Date(wikiAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>}
            </motion.div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...text.overline(), flex: 1 }}>已接入的知识源</span>
            {sources.some((s) => s.kind === 'folder') && (
              <span className="hv" onClick={() => !busy && reindex()} title="按文件修改时间增量重扫所有文件夹源" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: ink(2), fontSize: FS.tiny, fontWeight: 600 }}>
                <RefreshCw size={11} strokeWidth={2} />{busy === 'reindex' ? '重扫中…' : '增量重扫'}
              </span>
            )}
          </div>
          {sources.length === 0 && (
            <EmptyState
              icon={Ico.kb}
              title="还没有知识源"
              desc="添加文件夹/文件/网页后，去问答区打开「知识库」开关，AI 会只依据你的知识库作答并给出出处。"
            />
          )}
          {sources.map((s) => {
            const Glyph = KIND_GLYPH[s.kind] || FileText
            return (
              <motion.div key={s.id} variants={fadeScaleIn} initial="initial" animate="animate" className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', ...surface.card() }}>
                <div style={{ flex: 'none', width: 26, height: 26, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: semBg(accent(), 0.12), color: accent(0.85) }}>
                  <Glyph size={13} strokeWidth={1.75} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: ink(1), fontSize: FS.small, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</div>
                  <div style={{ ...text.mono(9), color: ink(4), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.target}</div>
                </div>
                <Badge style={{ height: 17, padding: '0 8px', flex: 'none' }}>{s.docCount} 块</Badge>
                <IconButton icon={Trash2} onClick={() => remove(s.id)} title="移除该源及其索引" size={24} color={sem.danger} style={{ flex: 'none' }} />
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
