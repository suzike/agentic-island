// Island Chat：消息气泡（用户/AI，AI 支持 h/p/ul/code/note/think 富文本 + Markdown）+ 富输入。
// v2：多行输入（Enter 发送 / Shift+Enter 换行，自动增高）、新消息自动滚底、
// 消息时间戳、悬停浮现复制（用户/AI 均可）。
// v3：视觉层重做至 ui/tokens 设计系统（层级表面 + 语义色 + lucide 图标 + framer-motion 入场），交互零改动。

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUp, Brain, Camera, Check, ChevronDown, Copy, CornerDownRight, Database, EyeOff, GitFork, GitMerge, Image as ImageIcon, Library, ListTree, MoreHorizontal, Paperclip, Pin, Quote, RefreshCw, Scale, Settings, ShieldCheck, Sparkles, Square, Users, WandSparkles, Wrench, X } from 'lucide-react'
import type { AnswerAnalysis, AnswerAnalysisAction, Block, ChatMessage, ChatProps, QuoteRef } from '../types'
import { Markdown, Collapsible } from './Markdown'
import { blocksToText, conversationContextStats } from '../logic/chat'
import { ANALYSIS_METHOD_GROUPS, ANALYSIS_METHODS, ANSWER_METHOD_GROUPS, ANSWER_METHODS, analysisMethodById, answerMethodById, recommendAnalysisMethods, recommendAnswerMethods, type AnalysisMethodGroup, type AnswerMethodGroup } from '../logic/methodologies'
import { readAttachment, downscaleDataUrl, selectLocalFiles } from '../logic/files'
import { island } from '../bridge'
import { Button, Chip, IconButton } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text, transition } from '../ui/tokens'

/** 附件类型图标（文件/图像） */
const AttIcon = ({ t, size = 12 }: { t: string; size?: number }): React.JSX.Element =>
  t === 'file' ? <Paperclip size={size} strokeWidth={1.75} /> : <Camera size={size} strokeWidth={1.75} />

const methodGroupIcon = (group: AnswerMethodGroup | AnalysisMethodGroup): typeof ListTree => {
  if (group === 'structure') return ListTree
  if (group === 'reasoning') return Brain
  if (group === 'decision') return Scale
  if (group === 'innovation') return Sparkles
  if (group === 'evidence') return Database
  if (group === 'risk') return ShieldCheck
  return Wrench
}

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
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, background: 'linear-gradient(180deg, transparent, oklch(var(--panel-hi-l) calc(0.02 * var(--css, 1)) var(--ths) / .95))', pointerEvents: 'none' }} />
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

function ModelStamp({ label }: { label?: string }): React.JSX.Element | null {
  if (!label) return null
  return (
    <div title="本条回答实际使用的模型" style={{ display: 'flex', alignItems: 'center', gap: 4, color: ink(3), fontSize: 9.5, lineHeight: 1.2 }}>
      <Brain size={10} strokeWidth={1.8} style={{ flex: 'none' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

/** 多模型候选保持在同一条会话消息内，切换不会复制或污染主上下文。 */
function AnswerVariants({ variants, onAdopt }: { variants: NonNullable<ChatMessage['variants']>; onAdopt?: (id: string) => void }): React.JSX.Element {
  const [active, setActive] = useState(variants[0]?.id || '')
  const current = variants.find((variant) => variant.id === active) || variants[0]
  if (!current) return <></>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 3, paddingTop: 7, borderTop: `0.5px solid ${hairline(0.09)}` }}>
      <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
        {variants.map((variant) => (
          <Chip key={variant.id} active={variant.id === current.id} onClick={() => setActive(variant.id)} style={{ flex: 'none', maxWidth: 170 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{variant.label}</span>
          </Chip>
        ))}
        {onAdopt && <Chip icon={Check} onClick={() => onAdopt(current.id)} style={{ flex: 'none' }}>采用</Chip>}
      </div>
      <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <AnswerBody blocks={current.blocks} />
      </div>
    </div>
  )
}

function AnswerAnalyses({ items }: { items: AnswerAnalysis[] }): React.JSX.Element {
  const [active, setActive] = useState(items[items.length - 1]?.id || '')
  useEffect(() => { setActive(items[items.length - 1]?.id || '') }, [items.length, items[items.length - 1]?.id])
  const current = items.find((item) => item.id === active) || items[items.length - 1]
  if (!current) return <></>
  const method = current.action === 'council' ? undefined : analysisMethodById(current.action)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, ...surface.inset(), borderRadius: R.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <ShieldCheck size={11} strokeWidth={1.9} style={{ color: accent(), flex: 'none' }} />
        <span style={{ color: ink(2), fontSize: FS.tiny, fontWeight: 700 }}>气泡分析</span>
        {items.map((item) => <Chip key={item.id} active={item.id === current.id} onClick={() => setActive(item.id)}>{item.label}</Chip>)}
        <span style={{ flex: 1 }} />
        <span style={{ ...text.faint(), fontSize: 9 }}>不改变主回答和会话上下文</span>
      </div>
      {method && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: ink(3), fontSize: 9.5 }}>
          <span style={{ color: accent(0.82), fontWeight: 650 }}>{method.framework}</span>
          <span>·</span>
          <span>{method.outcome}</span>
        </div>
      )}
      <div style={{ padding: '2px 3px' }}><AnswerBody blocks={current.blocks} /></div>
    </div>
  )
}

function ForkConfirmation({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }): React.JSX.Element {
  return (
    <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', ...surface.inset(), borderRadius: R.md }}>
      <GitFork size={12} strokeWidth={1.9} style={{ color: accent(), flex: 'none' }} />
      <span style={{ flex: 1, color: ink(2), fontSize: FS.tiny, lineHeight: 1.45 }}>当前会话会保留；新分支只继承这条消息以前的内容，并立即切换过去。</span>
      <Button variant="ghost" sm onClick={onCancel}>取消</Button>
      <Button variant="primary" sm onClick={onConfirm}>创建并切换</Button>
    </motion.div>
  )
}

function ContextStatus({ mode }: { mode?: ChatMessage['contextMode'] }): React.JSX.Element | null {
  if (!mode || mode === 'normal') return null
  const excluded = mode === 'excluded'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', gap: 4, padding: '2px 7px', borderRadius: R.pill, background: semBg(excluded ? sem.warn : accent(), 0.12), color: excluded ? sem.warn : accent(0.84), fontSize: 9, fontWeight: 650 }}>
      {excluded ? <EyeOff size={9} strokeWidth={2} /> : <Pin size={9} strokeWidth={2} />}
      {excluded ? '不发送给模型' : '重要上下文'}
    </span>
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
  const hasInput = !!(composer.text && composer.text.trim()) || composer.attachments.length > 0 || quotes.length > 0
  const canSend = hasInput && !p.busy
  // 引用追问弹窗：框选 AI 片段后浮现，写疑问 → 贴入输入区
  const [sel, setSel] = useState<{ text: string; note: string; x: number; y: number } | null>(null)
  // 就地追问：记录哪条回答下展开了输入框 + 其草稿文本
  const [fuIdx, setFuIdx] = useState<number | null>(null)
  const [fuText, setFuText] = useState('')
  const [panel, setPanel] = useState<'branches' | 'context' | 'council' | null>(null)
  const [advanceIdx, setAdvanceIdx] = useState<number | null>(null)
  const [messageMenuIdx, setMessageMenuIdx] = useState<number | null>(null)
  const [pendingForkIdx, setPendingForkIdx] = useState<number | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState<{ msgIndex: number; action: Exclude<AnswerAnalysisAction, 'council'>; label: string } | null>(null)
  const [answerMethodOpen, setAnswerMethodOpen] = useState(false)
  const [answerMethodGroup, setAnswerMethodGroup] = useState<AnswerMethodGroup | 'recommended'>('recommended')
  const [analysisGroup, setAnalysisGroup] = useState<AnalysisMethodGroup | 'recommended'>('recommended')
  const [councilBusy, setCouncilBusy] = useState(false)
  const [rename, setRename] = useState('')
  const [notice, setNotice] = useState('')
  const [knowledgeBusy, setKnowledgeBusy] = useState(false)
  const [councilMode, setCouncilMode] = useState<'parallel' | 'consensus' | 'debate'>('consensus')
  const [councilIds, setCouncilIds] = useState<string[]>([])
  const boxRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const fuRef = useRef<HTMLTextAreaElement>(null)

  const contextStats = useMemo(() => conversationContextStats(p.messages, p.memory || ''), [p.messages, p.memory])
  const lastQuestion = useMemo(() => [...p.messages].reverse().find((message) => message.role === 'user' && message.text?.trim())?.text?.trim() || '', [p.messages])
  const selectedAnswerMethod = useMemo(() => answerMethodById(p.answerMethodId), [p.answerMethodId])
  const answerMethodRecommendations = useMemo(() => recommendAnswerMethods(composer.text || lastQuestion), [composer.text, lastQuestion])
  const visibleAnswerMethods = useMemo(
    () => answerMethodGroup === 'recommended' ? answerMethodRecommendations : ANSWER_METHODS.filter((method) => method.group === answerMethodGroup),
    [answerMethodGroup, answerMethodRecommendations]
  )
  const orderedBranches = useMemo(() => {
    const branches = p.branch?.branches || []
    const children = new Map<number | undefined, typeof branches>()
    for (const branch of branches) {
      const list = children.get(branch.parentId) || []
      list.push(branch)
      children.set(branch.parentId, list)
    }
    const result: Array<(typeof branches)[number] & { depth: number }> = []
    const seen = new Set<number>()
    const walk = (parentId: number | undefined, depth: number): void => {
      for (const branch of children.get(parentId) || []) {
        if (seen.has(branch.id)) continue
        seen.add(branch.id); result.push({ ...branch, depth }); walk(branch.id, depth + 1)
      }
    }
    walk(undefined, 0)
    for (const branch of branches) if (!seen.has(branch.id)) result.push({ ...branch, depth: 0 })
    return result
  }, [p.branch?.branches])

  useEffect(() => {
    const ids = (p.councilModels || []).slice(0, 3).map((model) => model.id)
    setCouncilIds((current) => current.filter((id) => ids.includes(id)).length >= 2 ? current.filter((id) => (p.councilModels || []).some((model) => model.id === id)) : ids)
  }, [p.councilModels])

  useEffect(() => { setRename(p.branch?.title || '') }, [p.branch?.activeId, p.branch?.title])

  useEffect(() => {
    setFuIdx(null)
    setFuText('')
    setAdvanceIdx(null)
    setMessageMenuIdx(null)
    setPendingForkIdx(null)
    setAnalysisBusy(null)
    setAnswerMethodOpen(false)
    setAnalysisGroup('recommended')
    setCouncilBusy(false)
    setPanel(null)
  }, [p.branch?.activeId])

  const flash = (message: string): void => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 3200)
  }

  const saveKnowledge = async (scope: 'message' | 'conversation' | 'selection', msgIndex?: number, value?: string): Promise<void> => {
    if (!p.onSaveKnowledge || knowledgeBusy) return
    setKnowledgeBusy(true)
    try {
      const result = await p.onSaveKnowledge(scope, msgIndex, value)
      flash(result.message)
    } catch (error) {
      flash('保存失败：' + String(error))
    } finally { setKnowledgeBusy(false) }
  }

  const sendFollowUp = (): void => {
    const t = fuText.trim()
    if (!t || !p.onFollowUp || fuIdx === null || p.busy) return
    p.onFollowUp(fuIdx, t) // 问答嵌套进第 fuIdx 条气泡；保持展开以便连续追问
    setFuText('')
  }

  const runAnswerAnalysis = (msgIndex: number, action: Exclude<AnswerAnalysisAction, 'council'>, label: string): void => {
    if (!p.onAdvance || analysisBusy || p.busy) return
    setAdvanceIdx(null)
    setAnalysisBusy({ msgIndex, action, label })
    void Promise.resolve(p.onAdvance(msgIndex, action))
      .catch((error) => flash(`${label}失败：${String(error)}`))
      .finally(() => setAnalysisBusy((current) => current?.msgIndex === msgIndex && current.action === action ? null : current))
  }

  const changeContextMode = (msgIndex: number, mode: NonNullable<ChatMessage['contextMode']>): void => {
    p.onSetContextMode?.(msgIndex, mode)
    flash(mode === 'pinned' ? '已标为重要上下文，后续回答会持续携带' : mode === 'excluded' ? '已从后续模型上下文中排除' : '已恢复为普通上下文')
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

  const followupSignal = p.messages.reduce((sum, message) => sum + (message.followups || []).reduce((inner, item) => inner + 1 + (item.typing ? 1 : 0) + (item.live?.text.length || 0), 0), 0)
  useEffect(() => {
    if (fuIdx === null) return
    const target = boxRef.current?.querySelector(`[data-message-index="${fuIdx}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [fuIdx, followupSignal])

  // 输入框自动增高（1~6 行）
  const autoGrow = (): void => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 116) + 'px'
  }
  useEffect(autoGrow, [composer.text])

  const copyText = (value: string): void => {
    if (!navigator.clipboard) { flash('当前环境不支持复制'); return }
    navigator.clipboard.writeText(value).then(() => flash('已复制')).catch(() => flash('复制失败'))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', boxSizing: 'border-box' }}>
      {p.messages.length > 0 && p.branch && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', padding: '5px 7px', ...surface.inset(), borderRadius: R.md }}>
            <Chip icon={Settings} active={panel !== null} onClick={() => setPanel((value) => value === null ? 'branches' : null)} title="管理分支、对话记忆和多模型讨论">
              会话管理
            </Chip>
            {p.onSaveKnowledge && (
              <Chip icon={Library} onClick={() => void saveKnowledge('conversation')} title="将当前完整分支写入本地向量知识库">
                {knowledgeBusy ? '保存中' : '保存会话'}
              </Chip>
            )}
            <span style={{ flex: 1, minWidth: 4 }} />
            <span style={{ ...text.faint(), fontSize: 9, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.branch.title}</span>
          </div>

          {notice && <div style={{ padding: '6px 10px', borderRadius: R.md, background: semBg(notice.includes('失败') || notice.includes('请先') ? sem.danger : sem.calm, 0.12), color: notice.includes('失败') || notice.includes('请先') ? sem.danger : sem.calm, fontSize: FS.tiny }}>{notice}</div>}
          {councilBusy && <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: R.md, background: semBg(accent(), 0.1), color: ink(2), fontSize: FS.tiny }}><span style={{ width: 7, height: 7, borderRadius: 999, background: accent(), animation: 'ai-dotpulse 1s ease-in-out infinite' }} />多个模型正在处理当前问题，完成后结果会附加到原回答。</div>}

          {panel !== null && (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 7px', ...surface.inset(), borderRadius: R.md }}>
              <Chip icon={ListTree} active={panel === 'branches'} onClick={() => setPanel('branches')}>分支</Chip>
              <Chip icon={Brain} active={panel === 'context'} onClick={() => setPanel('context')}>记忆与规则</Chip>
              {(p.councilModels?.length || 0) >= 2 && <Chip icon={Users} active={panel === 'council'} onClick={() => setPanel('council')}>多模型讨论</Chip>}
            </motion.div>
          )}

          {panel === 'branches' && (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ ...surface.inset(), borderRadius: R.lg, padding: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ ...text.faint(), fontSize: FS.tiny, lineHeight: 1.45 }}>不同思路分别推进；切换保留各自对话，合并只把目标分支的结论写入当前记忆。</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <GitFork size={13} strokeWidth={1.8} style={{ color: accent(), flex: 'none' }} />
                <input
                  value={rename}
                  onChange={(event) => setRename(event.target.value)}
                  onBlur={() => p.onRenameBranch?.(rename)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { p.onRenameBranch?.(rename); event.currentTarget.blur() } }}
                  style={{ flex: 1, minWidth: 0, background: fill(1), border: 'none', outline: 'none', borderRadius: R.sm, color: ink(1), padding: '5px 8px', fontSize: FS.small, fontWeight: 600, fontFamily: 'var(--font)' }}
                  title="重命名当前分支"
                />
                {p.branch.parentId && <span style={{ ...text.faint(), fontSize: 9 }}>Fork 分支</span>}
              </div>
              <div className="ai-scroll" style={{ maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {orderedBranches.map((branch) => (
                  <div key={branch.id} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 30, paddingLeft: Math.min(branch.depth, 4) * 15 }}>
                    <span style={{ width: 12, height: 12, display: 'inline-flex', alignItems: 'center', color: branch.active ? accent() : ink(4), flex: 'none' }}>
                      {branch.parentId ? <GitFork size={11} strokeWidth={1.8} /> : <Database size={11} strokeWidth={1.8} />}
                    </span>
                    <button onClick={() => p.onSwitchBranch?.(branch.id)} disabled={branch.active} style={{ flex: 1, minWidth: 0, border: 'none', background: branch.active ? semBg(accent(), 0.13) : 'transparent', color: branch.active ? accent() : ink(2), borderRadius: R.sm, padding: '5px 8px', textAlign: 'left', fontSize: FS.tiny, fontWeight: branch.active ? 700 : 500, cursor: branch.active ? 'default' : 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {branch.title}
                    </button>
                    {!branch.active && <Button variant="ghost" sm onClick={() => p.onMergeBranch?.(branch.id)} title="只把该分支的结论写入当前会话记忆，不复制消息"><GitMerge size={11} />合并结论</Button>}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {panel === 'context' && (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ ...surface.inset(), borderRadius: R.lg, padding: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ ...text.faint(), fontSize: FS.tiny, lineHeight: 1.45 }}>控制后续回答持续遵守什么，以及哪些内容会继续发送给模型。</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <Chip active>当前上下文 {contextStats.included}</Chip>
                <Chip icon={Pin}>重要内容 {contextStats.pinned}</Chip>
                <Chip icon={EyeOff}>已忽略 {contextStats.excluded}</Chip>
                <Chip icon={Paperclip}>附件 {contextStats.attachments}</Chip>
                <span style={{ flex: 1 }} />
                <span style={{ ...text.faint(), alignSelf: 'center', fontVariantNumeric: 'tabular-nums' }}>约 {contextStats.estimatedTokens.toLocaleString()} tokens</span>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ ...text.overline() }}>本次对话规则 · 每轮持续生效</span>
                <textarea value={p.instruction || ''} onChange={(event) => p.onSetInstruction?.(event.target.value)} rows={2} placeholder="例如：始终以资深 TypeScript 架构师视角回答，先指出风险再给方案。" className="ai-scroll" style={{ ...surface.card(), border: 'none', outline: 'none', resize: 'vertical', minHeight: 42, maxHeight: 100, padding: '7px 9px', color: ink(1), fontSize: FS.small, lineHeight: 1.5, fontFamily: 'var(--font)' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ ...text.overline() }}>已确认信息 · 跨轮次与分支保留</span>
                <textarea value={p.memory || ''} onChange={(event) => p.onSetMemory?.(event.target.value)} rows={3} placeholder="记录稳定事实、偏好、约束与已确认结论；也可以让 AI 从完整会话自动压缩。" className="ai-scroll" style={{ ...surface.card(), border: 'none', outline: 'none', resize: 'vertical', minHeight: 54, maxHeight: 150, padding: '7px 9px', color: ink(1), fontSize: FS.small, lineHeight: 1.5, fontFamily: 'var(--font)' }} />
              </label>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {!!p.memory && <Button variant="ghost" sm onClick={() => p.onSetMemory?.('')}>清空已确认信息</Button>}
                <Button variant="tinted" sm onClick={p.onCompressContext}><RefreshCw size={11} strokeWidth={2} />从对话更新</Button>
              </div>
            </motion.div>
          )}

          {panel === 'council' && (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ ...surface.inset(), borderRadius: R.lg, padding: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ ...text.faint(), fontSize: FS.tiny, lineHeight: 1.45 }}>选择至少两个已保存模型，让它们分别回答、汇总结论或比较分歧。</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px', borderRadius: R.sm, background: fill(1) }}>
                <Quote size={10} strokeWidth={2} style={{ color: accent(), flex: 'none', marginTop: 2 }} />
                <span style={{ ...text.faint(), flex: 'none' }}>讨论目标</span>
                <span style={{ color: ink(2), fontSize: FS.tiny, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lastQuestion || '请先提出一个问题'}</span>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {(p.councilModels || []).map((model) => (
                  <Chip key={model.id} active={councilIds.includes(model.id)} onClick={() => setCouncilIds((ids) => ids.includes(model.id) ? ids.filter((id) => id !== model.id) : [...ids, model.id].slice(0, 4))} style={{ maxWidth: 180 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.label}</span>
                  </Chip>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {([
                  ['parallel', '分别回答'], ['consensus', '汇总结论'], ['debate', '比较分歧']
                ] as const).map(([mode, label]) => <Chip key={mode} active={councilMode === mode} onClick={() => setCouncilMode(mode)}>{label}</Chip>)}
                <span style={{ flex: 1 }} />
                <Button variant="primary" sm disabled={councilIds.length < 2 || councilBusy || !lastQuestion || p.busy} onClick={() => {
                  if (!p.onCouncil) return
                  setCouncilBusy(true); setPanel(null)
                  void Promise.resolve(p.onCouncil(councilMode, councilIds))
                    .catch((error) => flash('多模型讨论失败：' + String(error)))
                    .finally(() => setCouncilBusy(false))
                }}><Users size={11} strokeWidth={2} />开始讨论</Button>
              </div>
            </motion.div>
          )}
        </>
      )}
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
                {m.answerMethodLabel && (
                  <span title="本轮回答采用的方法，只影响紧随其后的回答" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: R.pill, background: semBg(accent(), 0.12), color: accent(0.84), fontSize: 9, fontWeight: 650 }}>
                    <WandSparkles size={9} strokeWidth={2} />
                    回答方法 · {m.answerMethodLabel}
                  </span>
                )}
                <ContextStatus mode={m.contextMode} />
                {/* 用户消息只留一个明确的二级入口。 */}
                <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {m.ts && <span style={{ ...text.faint(), fontSize: 9 }}>{fmtTs(m.ts)}</span>}
                  <Chip icon={MoreHorizontal} active={messageMenuIdx === mi} onClick={() => { setMessageMenuIdx((value) => value === mi ? null : mi); setAdvanceIdx(null) }} style={{ fontSize: FS.tiny, padding: '2px 8px' }}>更多</Chip>
                </div>
                {messageMenuIdx === mi && (
                  <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ alignSelf: 'stretch', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 5, padding: 6, ...surface.inset() }}>
                    {p.onSetContextMode && <Button variant="ghost" sm onClick={() => { changeContextMode(mi, m.contextMode === 'pinned' ? 'normal' : 'pinned'); setMessageMenuIdx(null) }}><Pin size={11} />{m.contextMode === 'pinned' ? '取消重要标记' : '标为重要内容'}</Button>}
                    {p.onSetContextMode && <Button variant="ghost" sm onClick={() => { changeContextMode(mi, m.contextMode === 'excluded' ? 'normal' : 'excluded'); setMessageMenuIdx(null) }}><EyeOff size={11} />{m.contextMode === 'excluded' ? '恢复给模型' : '不再发送给模型'}</Button>}
                    {p.onFork && <Button variant="ghost" sm disabled={p.busy} onClick={() => { setPendingForkIdx(mi); setMessageMenuIdx(null) }}><GitFork size={11} />从这里建分支</Button>}
                    <Button variant="ghost" sm onClick={() => { copyText(m.text || ''); setMessageMenuIdx(null) }}><Copy size={11} />复制问题</Button>
                  </motion.div>
                )}
                {pendingForkIdx === mi && <ForkConfirmation onCancel={() => setPendingForkIdx(null)} onConfirm={() => { setPendingForkIdx(null); p.onFork?.(mi) }} />}
              </motion.div>
            ) : (
              <motion.div key={mi} data-message-index={mi} variants={fadeScaleIn} initial="initial" animate="animate" className="msg" style={{ alignSelf: 'flex-start', maxWidth: '92%', display: 'flex', gap: 8 }}>
                <div style={{ width: 20, height: 20, flex: 'none', borderRadius: 6, background: gradient.brand(), color: gradient.onPrimary(), boxShadow: `0 2px 8px ${accent(0.7, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                  <Sparkles size={11} strokeWidth={2} />
                </div>
                <div
                  onContextMenu={p.enableQuote && !m.typing ? onAiSelect : undefined}
                  style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 13px', ...surface.card(), border: 'none', boxShadow: '0 6px 18px -8px rgba(0, 0, 0, 0.4)', borderRadius: '4px 14px 14px 14px', minWidth: 0, userSelect: p.enableQuote ? 'text' : undefined, cursor: p.enableQuote && !m.typing ? 'text' : undefined }}
                >
                  {m.typing && <TypingDots />}
                  {m.live && <AgentLiveBody live={m.live} />}
                  {!m.typing && !m.live && <ModelStamp label={m.modelLabel} />}
                  <AnswerBody blocks={m.blocks} />
                  <ContextStatus mode={m.contextMode} />
                  {(m.variants?.length || 0) > 0 && <AnswerVariants variants={m.variants!} onAdopt={p.onAdoptVariant ? (id) => p.onAdoptVariant?.(mi, id) : undefined} />}
                  {(m.analyses?.length || 0) > 0 && <AnswerAnalyses items={m.analyses!} />}
                  {analysisBusy?.msgIndex === mi && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', borderRadius: R.md, background: semBg(accent(), 0.1), color: ink(2), fontSize: FS.tiny }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: accent(), animation: 'ai-dotpulse 1s ease-in-out infinite' }} />
                      正在执行「{analysisBusy.label}」，结果会显示在这条回答下方…
                    </div>
                  )}
                  {/* 就地追问子线程：问答都嵌套在本气泡内，形成一条对话支线 */}
                  {(m.followups?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 5, padding: '7px 8px 7px 10px', borderLeft: `2px solid ${accent(0.7, 0.5)}`, borderRadius: `0 ${R.md}px ${R.md}px 0`, background: fill(1), display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: accent(0.82), fontSize: FS.tiny, fontWeight: 700 }}>
                        <CornerDownRight size={11} strokeWidth={2} />本回答的追问支线 · {m.followups!.filter((item) => item.role === 'user').length} 轮
                      </div>
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
                            <ModelStamp label={fm.modelLabel} />
                            <AnswerBody blocks={fm.blocks} />
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {/* 追问：就地在本气泡下展开输入框；问答嵌套在本气泡内，上下文含整段主对话 */}
                  {!m.typing && (m.blocks?.length ?? 0) > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                      {p.onFollowUp && (
                        <Chip
                          icon={CornerDownRight}
                          active={fuIdx === mi}
                          onClick={() => { setFuIdx((v) => (v === mi ? null : mi)); setFuText('') }}
                          title="就地追问（记得上文）"
                          style={{ fontSize: FS.tiny, padding: '2px 9px' }}
                        >
                          继续追问
                        </Chip>
                      )}
                      <span style={{ flex: 1 }} />
                      {p.onAdvance && <Chip icon={ShieldCheck} active={advanceIdx === mi} onClick={() => { setAdvanceIdx((value) => value === mi ? null : mi); setMessageMenuIdx(null) }} title="检查、拆解或继续深化这条回答" style={{ fontSize: FS.tiny, padding: '2px 9px' }}>分析回答</Chip>}
                      <Chip icon={MoreHorizontal} active={messageMenuIdx === mi} onClick={() => { setMessageMenuIdx((value) => value === mi ? null : mi); setAdvanceIdx(null) }} style={{ fontSize: FS.tiny, padding: '2px 9px' }}>更多</Chip>
                      {m.ts && <span className="row-acts" style={{ ...text.faint(), fontSize: 9 }}>{fmtTs(m.ts)}</span>}
                    </div>
                  )}
                  {messageMenuIdx === mi && (
                    <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5, padding: 7, ...surface.inset() }}>
                      <span style={{ gridColumn: '1 / -1', ...text.overline(), padding: '1px 3px' }}>上下文</span>
                      {p.onSetContextMode && <Button variant="ghost" sm onClick={() => { changeContextMode(mi, m.contextMode === 'pinned' ? 'normal' : 'pinned'); setMessageMenuIdx(null) }}><Pin size={11} />{m.contextMode === 'pinned' ? '取消重要标记' : '后续持续参考'}</Button>}
                      {p.onSetContextMode && <Button variant="ghost" sm onClick={() => { changeContextMode(mi, m.contextMode === 'excluded' ? 'normal' : 'excluded'); setMessageMenuIdx(null) }}><EyeOff size={11} />{m.contextMode === 'excluded' ? '恢复给模型' : '后续不再发送'}</Button>}
                      <span style={{ gridColumn: '1 / -1', ...text.overline(), padding: '4px 3px 1px' }}>继续使用</span>
                      {p.onAddQuote && <Button variant="ghost" sm onClick={() => { p.onAddQuote?.({ text: blocksToText(m.blocks || []) }); flash('整条回答已作为引用放入输入区'); setMessageMenuIdx(null) }}><Quote size={11} />引用整条回答</Button>}
                      {p.onFork && <Button variant="ghost" sm disabled={p.busy} onClick={() => { setPendingForkIdx(mi); setMessageMenuIdx(null) }}><GitFork size={11} />从这里建分支</Button>}
                      <span style={{ gridColumn: '1 / -1', ...text.overline(), padding: '4px 3px 1px' }}>沉淀与复用</span>
                      {p.onSaveKnowledge && <Button variant="ghost" sm disabled={knowledgeBusy} onClick={() => { void saveKnowledge('message', mi); setMessageMenuIdx(null) }}><Library size={11} />保存到知识库</Button>}
                      <Button variant="ghost" sm onClick={() => { copyText(blocksToText(m.blocks || [])); flash('回答已复制'); setMessageMenuIdx(null) }}><Copy size={11} />复制回答</Button>
                    </motion.div>
                  )}
                  {pendingForkIdx === mi && <ForkConfirmation onCancel={() => setPendingForkIdx(null)} onConfirm={() => { setPendingForkIdx(null); p.onFork?.(mi) }} />}
                  {advanceIdx === mi && p.onAdvance && (() => {
                    const question = [...p.messages.slice(0, mi)].reverse().find((message) => message.role === 'user' && message.text?.trim())?.text || ''
                    const recommended = recommendAnalysisMethods(question, blocksToText(m.blocks || []))
                    const methods = analysisGroup === 'recommended' ? recommended : ANALYSIS_METHODS.filter((method) => method.group === analysisGroup)
                    return (
                      <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, ...surface.inset() }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                          <ShieldCheck size={13} strokeWidth={2} style={{ color: accent(), flex: 'none', marginTop: 1 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: ink(1), fontSize: FS.small, fontWeight: 700 }}>回答分析中心</div>
                            <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.4 }}>方法会围绕当前气泡生成独立分析，不新增主消息、不改变后续上下文。同一方法再次执行会替换旧结果。</div>
                          </div>
                        </div>
                        <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
                          <Chip active={analysisGroup === 'recommended'} onClick={() => setAnalysisGroup('recommended')} style={{ flex: 'none' }}><Sparkles size={9} />智能推荐</Chip>
                          {ANALYSIS_METHOD_GROUPS.map((group) => <Chip key={group.id} active={analysisGroup === group.id} onClick={() => setAnalysisGroup(group.id)} style={{ flex: 'none' }}>{group.label}</Chip>)}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))', gap: 5 }}>
                          {methods.map((method) => {
                            const Icon = methodGroupIcon(method.group)
                            return (
                              <button key={method.id} type="button" disabled={!!analysisBusy || p.busy} onClick={() => runAnswerAnalysis(mi, method.id, method.label)} className="hv" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 7, alignItems: 'start', minHeight: 70, padding: '7px 8px', border: 'none', borderRadius: R.md, background: fill(1), color: ink(1), textAlign: 'left', fontFamily: 'var(--font)', cursor: analysisBusy || p.busy ? 'default' : 'pointer', opacity: analysisBusy || p.busy ? 0.55 : 1 }}>
                                <span style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: R.sm, background: semBg(accent(), 0.14), color: accent() }}><Icon size={13} strokeWidth={1.9} /></span>
                                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                                    <strong style={{ fontSize: FS.small }}>{method.label}</strong>
                                    <span style={{ ...text.faint(), fontSize: 8.5 }}>{method.framework}</span>
                                  </span>
                                  <span style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.35 }}>{method.description}</span>
                                  <span style={{ color: accent(0.8), fontSize: 9, lineHeight: 1.3 }}>产出：{method.outcome}</span>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </motion.div>
                    )
                  })()}
                  {(m.suggestions?.length || 0) > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 3 }}>
                      <span style={{ ...text.overline() }}>可继续追问</span>
                      {m.suggestions!.map((suggestion) => (
                        <button key={suggestion} onClick={() => p.onUseSuggestion?.(suggestion)} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, border: 'none', background: fill(2), borderRadius: R.sm, color: ink(2), padding: '6px 8px', textAlign: 'left', fontSize: FS.tiny, lineHeight: 1.4, cursor: 'pointer', fontFamily: 'var(--font)' }}>
                          <CornerDownRight size={10} strokeWidth={2} style={{ flex: 'none', marginTop: 2, color: accent() }} />
                          <span style={{ flex: 1 }}>{suggestion}</span>
                          <span style={{ ...text.faint(), fontSize: 9, whiteSpace: 'nowrap' }}>填入主输入框</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* 就地追问输入框：仅在该条回答下展开 */}
                  {p.onFollowUp && fuIdx === mi && (
                    <div style={{ marginTop: 4, ...surface.inset(), border: `0.5px solid ${accent(0.7, 0.35)}`, padding: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                        <textarea
                          ref={fuRef}
                          value={fuText}
                          onChange={(e) => setFuText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollowUp() }
                            else if (e.key === 'Escape') { setFuIdx(null); setFuText('') }
                          }}
                          placeholder="只追问这条回答…"
                          rows={1}
                          className="ai-scroll"
                          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: ink(1), fontSize: FS.small, lineHeight: 1.5, fontFamily: 'var(--font)', padding: '4px 4px', maxHeight: 90, overflowY: 'auto' }}
                        />
                        <SendBtn size={28} active={!!fuText.trim() && !p.busy} onSend={sendFollowUp} title={p.busy ? '当前分支仍在生成' : '发送到本回答的追问支线'} />
                      </div>
                      <span style={{ ...text.faint(), fontSize: 9 }}>回答会继续显示在当前气泡下方，不进入主会话。</span>
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
        {p.busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: sem.warn, fontSize: FS.tiny }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: sem.warn, animation: 'ai-dotpulse 1s ease-in-out infinite' }} />
            当前分支正在生成回答，完成后可继续发送
          </div>
        )}
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

        {p.onAnswerMethodChange && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ ...text.overline(), flex: 'none' }}>本轮回答方法</span>
              <Chip
                icon={WandSparkles}
                active={answerMethodOpen || !!selectedAnswerMethod}
                onClick={() => setAnswerMethodOpen((open) => !open)}
                title="选择一种方法控制下一条回答的组织和推理方式"
                style={{ minWidth: 0, maxWidth: 190 }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedAnswerMethod?.label || '默认回答'}</span>
              </Chip>
              {selectedAnswerMethod && <span style={{ minWidth: 0, flex: 1, ...text.faint(), fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedAnswerMethod.outcome}</span>}
              {!selectedAnswerMethod && <span style={{ flex: 1, ...text.faint(), fontSize: 9.5 }}>不套用方法模板</span>}
              {selectedAnswerMethod && <IconButton icon={X} title="恢复默认回答" size={22} onClick={() => p.onAnswerMethodChange?.(undefined)} style={{ flex: 'none' }} />}
            </div>
            {answerMethodOpen && (
              <motion.div variants={fadeScaleIn} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 8, ...surface.inset() }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <WandSparkles size={13} strokeWidth={2} style={{ color: accent(), flex: 'none', marginTop: 1 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: ink(1), fontSize: FS.small, fontWeight: 700 }}>选择这一问的回答方法</div>
                    <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.4 }}>仅影响下一次发送，回答气泡会记录所用方法；发送完成后自动恢复默认。</div>
                  </div>
                  <Button variant="ghost" sm onClick={() => { p.onAnswerMethodChange?.(undefined); setAnswerMethodOpen(false) }}>使用默认</Button>
                </div>
                <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
                  <Chip active={answerMethodGroup === 'recommended'} onClick={() => setAnswerMethodGroup('recommended')} style={{ flex: 'none' }}><Sparkles size={9} />智能推荐</Chip>
                  {ANSWER_METHOD_GROUPS.map((group) => <Chip key={group.id} active={answerMethodGroup === group.id} onClick={() => setAnswerMethodGroup(group.id)} style={{ flex: 'none' }}>{group.label}</Chip>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))', gap: 5 }}>
                  {visibleAnswerMethods.map((method) => {
                    const Icon = methodGroupIcon(method.group)
                    const active = method.id === p.answerMethodId
                    return (
                      <button key={method.id} type="button" onClick={() => { p.onAnswerMethodChange?.(method.id); setAnswerMethodOpen(false) }} className="hv" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 7, alignItems: 'start', minHeight: 72, padding: '7px 8px', border: `0.5px solid ${active ? accent(0.7, 0.5) : hairline(0.06)}`, borderRadius: R.md, background: active ? semBg(accent(), 0.13) : fill(1), color: ink(1), textAlign: 'left', fontFamily: 'var(--font)', cursor: 'pointer' }}>
                        <span style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: R.sm, background: semBg(accent(), 0.14), color: accent() }}><Icon size={13} strokeWidth={1.9} /></span>
                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: FS.small }}>{method.label}</strong>
                            <span style={{ ...text.faint(), fontSize: 8.5 }}>{method.framework}</span>
                          </span>
                          <span style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.35 }}>{method.description}</span>
                          <span style={{ color: accent(0.8), fontSize: 9, lineHeight: 1.3 }}>产出：{method.outcome}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            )}
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
              {p.onSaveKnowledge && <Button variant="ghost" sm onClick={() => { void saveKnowledge('selection', undefined, sel.text); setSel(null) }}><Library size={11} />保存片段</Button>}
              <Button variant="ghost" sm onClick={() => setSel(null)}>取消</Button>
            </div>
          </motion.div>
        </>
      )}
    </div>
  )
}
