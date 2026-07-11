// 知识库管理浮层：接入本地文件夹 / 文件（含 PDF·Word）/ 网页 → 切块+向量化 → 语义检索作答（RAG）。
// 检索必须向量嵌入：顶部要求配置 Embedding 模型（未配则禁用添加，给出引导）。

import { useEffect, useState } from 'react'
import type { KbSourceView, LlmRequestConfig } from '../../../shared/protocol'
import { island } from '../bridge'
import { Markdown } from './Markdown'

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

const KIND_ICON: Record<string, string> = { folder: '📁', files: '📄', url: '🔗' }

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

  const btn = (active: boolean): React.CSSProperties => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '11px 6px', borderRadius: 11,
    cursor: embedReady && !busy ? 'pointer' : 'default', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)',
    opacity: embedReady ? 1 : 0.5, color: active ? 'oklch(0.9 0.1 var(--th))' : 'oklch(0.85 0.02 var(--th) / .85)'
  })

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh', background: 'oklch(0.08 0.02 var(--ths) / .5)', backdropFilter: 'blur(3px)', animation: 'ai-fadein .15s ease' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(620px, 84vw)', maxHeight: '76vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'oklch(calc(0.17 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .98)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', boxShadow: 'none', animation: 'ai-riseblur .3s cubic-bezier(.22,.61,.36,1)' }}>
        {/* 头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          <span style={{ fontSize: 15 }}>📚</span>
          <span style={{ flex: 1, color: 'oklch(0.95 0.01 var(--th))', fontSize: 13.5, fontWeight: 700 }}>知识库 · 本地 RAG</span>
          <span style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 10 }}>{sources.length} 源 · {totalDocs} 块</span>
          <span className="hv" onClick={onClose} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 14 }}>✕</span>
        </div>

        {/* Embedding 模型（检索必须向量嵌入） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderBottom: '1px solid rgba(255,255,255,.06)', background: embedReady ? 'rgba(255,255,255,.02)' : 'oklch(0.4 0.09 75 / .16)' }}>
          <span style={{ color: 'oklch(0.72 0.02 var(--th) / .75)', fontSize: 10.5, flex: 'none' }}>🔮 向量模型</span>
          <input value={embedModel} onChange={(e) => onSetEmbedModel(e.target.value)} placeholder="必填，如 text-embedding-3-small / bge-m3 / embedding-3" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 7, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 10.5, padding: '5px 9px', fontFamily: "ui-monospace,'Cascadia Code',monospace" }} />
        </div>
        {!embedReady && <div style={{ padding: '7px 15px', color: 'oklch(0.82 0.1 75)', fontSize: 10.5, background: 'oklch(0.4 0.09 75 / .1)' }}>先填向量模型并在「设置 › 问答助手模型」配好端点/Key，才能建立与检索知识库（复用同一端点）。</div>}

        {/* 添加动作 */}
        <div style={{ display: 'flex', gap: 8, padding: '12px 15px 8px' }}>
          <div className="hv" onClick={() => embedReady && !busy && addFolder()} style={btn(busy === 'folder')}><span style={{ fontSize: 18 }}>📁</span><span style={{ fontSize: 10.5, fontWeight: 600 }}>{busy === 'folder' ? '索引中…' : '文件夹'}</span></div>
          <div className="hv" onClick={() => embedReady && !busy && addFiles()} style={btn(busy === 'files')}><span style={{ fontSize: 18 }}>📄</span><span style={{ fontSize: 10.5, fontWeight: 600 }}>{busy === 'files' ? '索引中…' : '文件 (PDF/Word)'}</span></div>
          <div className="hv" onClick={() => embedReady && !busy && setShowUrl((v) => !v)} style={btn(showUrl || busy === 'url')}><span style={{ fontSize: 18 }}>🔗</span><span style={{ fontSize: 10.5, fontWeight: 600 }}>{busy === 'url' ? '抓取中…' : '网页'}</span></div>
        </div>
        {showUrl && (
          <div style={{ display: 'flex', gap: 6, padding: '0 15px 8px' }}>
            <input autoFocus value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addUrl() }} placeholder="https://… 粘贴要收进知识库的网页" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11, padding: '7px 10px' }} />
            <div className="hv" onClick={addUrl} style={{ padding: '0 14px', borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>抓取</div>
          </div>
        )}

        {(msg || err) && <div style={{ padding: '2px 15px 8px', fontSize: 10.5, color: err ? 'oklch(0.78 0.12 30)' : 'oklch(0.8 0.11 150)' }}>{err || msg}</div>}

        {/* 源列表 + AI 知识总览 */}
        <div className="ai-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 15px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {/* AI 知识总览（LLM-Wiki：编译一次、长期复用） */}
          {sources.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 11px', borderRadius: 11, background: 'linear-gradient(160deg, oklch(0.3 0.05 280 / .28), oklch(0.2 0.03 var(--th) / .4))', border: '1px solid oklch(0.6 0.1 280 / .25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 12 }}>🧬</span>
                <span style={{ flex: 1, color: 'oklch(0.9 0.03 var(--th))', fontSize: 11.5, fontWeight: 700 }}>AI 知识总览</span>
                {wiki && <span className="hv" onClick={() => setWikiOpen((v) => !v)} style={{ cursor: 'pointer', color: 'oklch(0.75 0.02 var(--th) / .7)', fontSize: 10 }}>{wikiOpen ? '收起' : '展开'}</span>}
                <span className="hv" onClick={() => void genOverview()} style={{ cursor: llmReady ? 'pointer' : 'default', padding: '3px 10px', borderRadius: 8, background: 'oklch(0.5 0.13 280 / .4)', color: 'oklch(0.9 0.11 280)', fontSize: 10, fontWeight: 700, opacity: llmReady ? 1 : 0.5 }}>{busy === 'wiki' ? '合成中…' : wiki ? '重新生成' : '✨ 生成总览'}</span>
              </div>
              {!wiki && <div style={{ color: 'oklch(0.66 0.02 var(--th) / .6)', fontSize: 9.5, lineHeight: 1.5 }}>把整库综合成一页结构化 Wiki（主题/术语/可问的问题），编译一次长期复用；资料更新后可重新生成。</div>}
              {wiki && wikiOpen && (
                <div style={{ padding: '9px 11px', borderRadius: 9, background: 'rgba(0,0,0,.25)', fontSize: 11, lineHeight: 1.6, maxHeight: 260, overflowY: 'auto' }} className="ai-scroll"><Markdown text={wiki} /></div>
              )}
              {wiki && wikiAt > 0 && <div style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 8.5 }}>更新于 {new Date(wikiAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'oklch(0.66 0.02 var(--th) / .6)', fontSize: 10, fontWeight: 700, flex: 1 }}>已接入的知识源</span>
            {sources.some((s) => s.kind === 'folder') && <span className="hv" onClick={() => !busy && reindex()} title="按文件修改时间增量重扫所有文件夹源" style={{ cursor: 'pointer', color: 'oklch(0.75 0.02 var(--th) / .7)', fontSize: 10.5 }}>{busy === 'reindex' ? '重扫中…' : '↻ 增量重扫'}</span>}
          </div>
          {sources.length === 0 && <div style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 11, lineHeight: 1.7, padding: '10px 2px' }}>还没有知识源。添加文件夹/文件/网页后，去问答区打开「📚 知识库」开关，AI 会只依据你的知识库作答并给出出处。</div>}
          {sources.map((s) => (
            <div key={s.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)' }}>
              <span style={{ flex: 'none', fontSize: 15 }}>{KIND_ICON[s.kind] || '📄'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'oklch(0.9 0.02 var(--th))', fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</div>
                <div style={{ color: 'oklch(0.58 0.02 var(--th) / .5)', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "ui-monospace,monospace" }}>{s.target}</div>
              </div>
              <span style={{ flex: 'none', padding: '2px 8px', borderRadius: 999, background: 'oklch(0.35 0.06 var(--th) / .45)', color: 'oklch(0.82 0.09 var(--th))', fontSize: 9, fontWeight: 700 }}>{s.docCount} 块</span>
              <span className="hv" onClick={() => remove(s.id)} title="移除该源及其索引" style={{ flex: 'none', cursor: 'pointer', color: 'oklch(0.6 0.05 25 / .8)', fontSize: 11 }}>✕</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
