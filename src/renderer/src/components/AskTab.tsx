// 问答分区：回答配置保持在第一层；模型、资料、模板、剪贴板与历史按任务分层展示。
// · 模型 chip 下拉可在「已保存的配置」间一键切换（多厂商多模型自由切换）
// · 提问模板完全可自定义（增删改 + 恢复默认，持久化），空态卡片与工具面板同源。

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Cloud, Terminal, Hexagon, Zap, Brain, Library, Settings2, ChevronDown,
  Pencil, ClipboardList, Plus, History, Sparkles, Lightbulb, X, Check, Star, MessageSquare, MoreHorizontal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ChatProps, ClipItem, QuickPrompt } from '../types'
import { CLIP_ACTIONS, tagHue } from '../logic/clip'
import { island } from '../bridge'
import { IslandChat } from './IslandChat'
import { Button, Chip, Segmented } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, hueAccent, ink, R, sem, semBg, SP, surface, text, tintSurface } from '../ui/tokens'

interface AskTabProps {
  modelLabel: string
  onOpenLlmSettings: () => void
  /** 可切换的模型（当前厂商型号列表 + 已保存的跨厂商配置） */
  models: { id: string; name: string; detail?: string; active: boolean }[]
  onSwitchModel: (id: string) => void
  empty: boolean
  mode: 'fast' | 'deep'
  onSetMode: (m: 'fast' | 'deep') => void
  /** 知识库模式：开启后问答只依据用户接入的本地/网页知识库作答（RAG） */
  kbMode: boolean
  onToggleKb: () => void
  onManageKb: () => void
  kbCount: number
  /** 问答引擎：llm=云端模型；claude/codex=本机 CLI（继承本地全部技能/工具/MCP） */
  engine: 'llm' | 'claude' | 'codex'
  onSetEngine: (e: 'llm' | 'claude' | 'codex') => void
  agentCwd: string
  onSetAgentCwd: (d: string) => void
  suggestions: { id: string; label: string; source: string; go: () => void }[]
  conv: ChatProps
  sessions: { id: number; title: string; busy?: boolean }[]
  onNew: () => void
  onSwitch: (id: number) => void
  onDeleteSession: (id: number) => void
  /** 提问模板（用户可增删改） */
  prompts: QuickPrompt[]
  onSavePrompt: (p: { id?: number; icon: string; label: string; text: string }) => void
  onDeletePrompt: (id: number) => void
  onResetPrompts: () => void
  /** 剪贴板历史（文本+图片，收藏项持久化）+ AI 快捷动作 */
  clips: ClipItem[]
  onRemoveClip: (id: number) => void
  onClearClips: () => void
  onToggleClipFav: (id: number) => void
  /** 直接发送一条组装好的提问（翻译/解释/分析剪贴板内容） */
  onSendClip: (text: string) => void
  /** 图片剪贴板 → 走截图问 AI */
  onAskClipImage: (dataUrl: string) => void
  /** AI 聚类：把片段聚成集（组名 → id） */
  onClusterClips: () => void
  clipGroups: Record<number, string>
  clipClustering: boolean
}

const panelBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: SP.sm,
  ...surface.inset(),
  borderRadius: R.lg
}

const miniInput: React.CSSProperties = {
  boxSizing: 'border-box',
  background: fill(1),
  border: `0.5px solid ${hairline(0.09)}`,
  borderRadius: R.md,
  color: ink(1),
  fontSize: FS.small,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: 'var(--font)'
}

const emptyEdit = { icon: '✨', label: '', text: '' }

function ToolItem({ icon: Icon, title, detail, count, onClick, disabled }: { icon: LucideIcon; title: string; detail: string; count?: number; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="hv"
      style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) auto', alignItems: 'center', gap: 8, minHeight: 48, padding: '7px 9px', border: 'none', borderRadius: R.md, background: fill(1), color: ink(1), textAlign: 'left', fontFamily: 'var(--font)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.48 : 1 }}
    >
      <span style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: R.sm, background: semBg(accent(), 0.14), color: accent() }}>
        <Icon size={14} strokeWidth={1.8} />
      </span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: FS.small, fontWeight: 650 }}>{title}</span>
        <span style={{ ...text.faint(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
      </span>
      {typeof count === 'number' && <span style={{ minWidth: 20, textAlign: 'center', padding: '2px 6px', borderRadius: R.pill, background: fill(3), color: ink(2), fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
    </button>
  )
}

export function AskTab(p: AskTabProps): React.JSX.Element {
  const [showHistory, setShowHistory] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const [manage, setManage] = useState(false)
  const [showClips, setShowClips] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [clipQuery, setClipQuery] = useState('')
  // 本地 Agent CLI 可用性探测（切到该引擎时检测一次）
  const [engineStat, setEngineStat] = useState('')
  useEffect(() => {
    if (p.engine === 'llm') { setEngineStat(''); return }
    setEngineStat('检测中…')
    let alive = true
    void island.agentCliCheck(p.engine).then((r) => { if (alive) setEngineStat(r.ok ? `✓ ${r.version || '已就绪'}` : `✗ 未检测到 ${p.engine} CLI（先在终端确认可运行）`) })
    return () => { alive = false }
  }, [p.engine])
  // 指令编辑表单：id 存在 = 更新已有，否则新增
  const [edit, setEdit] = useState<{ id?: number; icon: string; label: string; text: string }>(emptyEdit)

  const canSavePrompt = edit.label.trim() && edit.text.trim()
  const savePrompt = (): void => {
    if (!canSavePrompt) return
    p.onSavePrompt({ ...edit, icon: edit.icon.trim() || '✨', label: edit.label.trim() })
    setEdit(emptyEdit)
  }

  // 对话开始后不再铺开模板；模板统一从“工具”进入，空态仍可直接选择。
  const finalConv: ChatProps = {
    ...p.conv,
    quickReplies: undefined,
    onQuick: undefined
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {/* 第一层只显示当前回答配置；低频能力统一进入“工具”。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: 6, ...surface.inset(), borderRadius: R.lg }}>
        {/* 引擎切换：云端模型 / 本机 Claude Code / 本机 Codex（本地引擎继承全部技能/工具/MCP 配置） */}
        <Segmented
          options={[
            { key: 'llm', label: '云模型', icon: Cloud },
            { key: 'claude', label: 'Claude', icon: Terminal },
            { key: 'codex', label: 'Codex', icon: Hexagon }
          ]}
          value={p.engine}
          onChange={(k) => p.onSetEngine(k)}
        />
        {p.engine === 'llm' && (
          <Segmented
            options={[
              { key: 'fast', label: '快速', icon: Zap },
              { key: 'deep', label: '深度', icon: Brain }
            ]}
            value={p.mode}
            onChange={(k) => p.onSetMode(k)}
          />
        )}
        {p.engine === 'llm' && (
          <Chip
            onClick={() => {
              if (!p.models.length) { p.onOpenLlmSettings(); return }
              setShowModels((v) => !v); setShowTools(false); setShowHistory(false); setShowClips(false); setManage(false)
            }}
            title={p.models.length > 0 ? '切换当前回答模型' : '打开模型设置'}
            active={showModels}
            style={{ maxWidth: 190 }}
          >
            <span style={{ width: 5, height: 5, flex: 'none', borderRadius: 999, background: accent(), boxShadow: `0 0 6px ${accent()}` }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 10 }}>{p.modelLabel}</span>
            {p.models.length > 0 && <ChevronDown size={9} strokeWidth={2} style={{ opacity: 0.7 }} />}
          </Chip>
        )}
        {/* 资料范围：通用知识或仅依据用户知识库。 */}
        {p.engine === 'llm' && (
          <Chip
            icon={Library}
            active={p.kbMode}
            color={sem.calm}
            onClick={() => p.kbCount > 0 || p.kbMode ? p.onToggleKb() : p.onManageKb()}
            title={p.kbMode ? '当前仅依据你的知识库作答；点击切回通用知识' : p.kbCount > 0 ? '点击后仅依据你接入的知识库作答' : '先接入知识库资料'}
          >
            {p.kbMode ? `我的知识库 · ${p.kbCount}` : p.kbCount > 0 ? '通用知识' : '接入知识库'}
          </Chip>
        )}
        <span style={{ flex: 1 }} />
        {!p.empty && <Chip icon={Plus} active={confirmNew} onClick={() => setConfirmNew((value) => !value)} title="开始一个新话题">新对话</Chip>}
        <Chip icon={MoreHorizontal} active={showTools || manage || showClips || showHistory} onClick={() => { setShowTools((v) => !v); setShowModels(false); setManage(false); setShowClips(false); setShowHistory(false) }} title="知识库、模板、剪贴板和历史对话">工具</Chip>
      </div>

      <AnimatePresence>
      {confirmNew && !p.empty && (
        <motion.div variants={fadeScaleIn} initial="initial" animate="animate" exit="exit" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', ...surface.inset(), borderRadius: R.md }}>
          <MessageSquare size={13} strokeWidth={1.8} style={{ color: accent(), flex: 'none' }} />
          <span style={{ flex: 1, color: ink(2), fontSize: FS.small }}>当前对话会自动保存到历史记录，然后打开一个空白对话。</span>
          <Button variant="ghost" sm onClick={() => setConfirmNew(false)}>取消</Button>
          <Button variant="primary" sm onClick={() => { setConfirmNew(false); p.onNew() }}>保存并新建</Button>
        </motion.div>
      )}
      </AnimatePresence>

      {/* 本地 Agent 引擎配置：可用性 + 工作目录（本地技能/MCP/CLAUDE.md 按目录生效） */}
      {p.engine !== 'llm' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: R.md, background: semBg(accent(), 0.1), border: `0.5px solid ${accent(0.6, 0.25)}` }}>
          <span style={{ flex: 'none', display: 'inline-flex', color: accent() }}>{p.engine === 'claude' ? <Terminal size={13} strokeWidth={1.75} /> : <Hexagon size={13} strokeWidth={1.75} />}</span>
          <span style={{ flex: 'none', color: engineStat.startsWith('✗') ? sem.danger : sem.calm, fontSize: 9.5, fontWeight: 600 }}>{engineStat || '…'}</span>
          <input
            value={p.agentCwd}
            onChange={(e) => p.onSetAgentCwd(e.target.value)}
            placeholder="工作目录（空=用户主目录），如 E:\proj\my-repo"
            title="本地配置（CLAUDE.md/技能/MCP）按目录生效；也决定 Agent 能读写哪个项目"
            style={{ flex: 1, minWidth: 0, ...surface.inset(), outline: 'none', color: ink(1), fontSize: 10, padding: '4px 8px', fontFamily: 'ui-monospace,monospace' }}
          />
          <span style={{ flex: 'none', ...text.faint(), fontSize: 8.5 }}>岛内上下文 ✓</span>
        </div>
      )}

      {/* 模型切换下拉：已保存的配置一键切换 */}
      <AnimatePresence>
      {showModels && p.models.length > 0 && (
        <motion.div variants={overlayPop} initial="initial" animate="animate" exit="exit" style={panelBox}>
          {p.models.map((m) => (
            <div
              key={m.id}
              className="ai-card"
              onClick={() => { p.onSwitchModel(m.id); setShowModels(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: R.md, background: m.active ? semBg(accent(), 0.14) : fill(1), border: m.active ? `0.5px solid ${accent(0.7, 0.4)}` : 'none', cursor: 'pointer' }}
            >
              <span style={{ width: 6, height: 6, flex: 'none', borderRadius: 999, background: m.active ? accent() : ink(4) }} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: ink(1), fontSize: 11, fontFamily: "ui-monospace,'Cascadia Code',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                {m.detail && <span style={{ color: ink(3), fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.detail}</span>}
              </span>
              {m.active && <span style={{ color: accent(), fontSize: 10, fontWeight: 700 }}>使用中</span>}
            </div>
          ))}
          <div className="hv" onClick={() => { setShowModels(false); p.onOpenLlmSettings() }} style={{ textAlign: 'center', padding: '6px 0', borderRadius: R.md, color: ink(3), fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
            ⚙ 管理模型配置（在设置里保存多个即可在此切换）
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* 二级工具入口：用“动作 + 结果”代替一排含义不明的图标。 */}
      <AnimatePresence>
      {showTools && (
        <motion.div variants={overlayPop} initial="initial" animate="animate" exit="exit" style={{ ...panelBox, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 6 }}>
          <ToolItem icon={Settings2} title="知识库资料" detail="接入文件、文件夹和网页" count={p.kbCount} onClick={() => { setShowTools(false); p.onManageKb() }} />
          <ToolItem icon={Pencil} title="提问模板" detail="管理常用问题和提示词" count={p.prompts.length} onClick={() => { setShowTools(false); setManage(true) }} />
          <ToolItem icon={ClipboardList} title="剪贴板" detail={p.clips.length ? '复用并处理最近复制的内容' : '暂无可用内容'} count={p.clips.length} disabled={!p.clips.length} onClick={() => { setShowTools(false); setShowClips(true) }} />
          <ToolItem icon={History} title="历史对话" detail={p.sessions.length ? '恢复已归档的话题' : '暂无已归档对话'} count={p.sessions.length} disabled={!p.sessions.length} onClick={() => { setShowTools(false); setShowHistory(true) }} />
          <ToolItem icon={Cloud} title="模型设置" detail="配置供应商、模型和密钥" onClick={() => { setShowTools(false); p.onOpenLlmSettings() }} />
        </motion.div>
      )}
      </AnimatePresence>

      {/* 提问模板管理：增删改 + 恢复默认 */}
      <AnimatePresence>
      {manage && (
        <motion.div variants={overlayPop} initial="initial" animate="animate" exit="exit" style={{ ...panelBox, gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: ink(1), fontSize: 11, fontWeight: 700 }}><Pencil size={11} strokeWidth={2} style={{ color: accent() }} />提问模板</span>
            <span style={{ flex: 1 }} />
            <span className="hv" onClick={p.onResetPrompts} title="恢复出厂 6 条默认指令" style={{ color: ink(3), fontSize: 10, cursor: 'pointer' }}>恢复默认</span>
            <span className="hv" onClick={() => { setManage(false); setEdit(emptyEdit) }} style={{ color: accent(), fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>完成</span>
          </div>
          {/* 已有指令列表：✎ 载入编辑 / ✕ 删除 */}
          {p.prompts.map((q) => (
            <div key={q.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: R.md, background: edit.id === q.id ? semBg(accent(), 0.14) : fill(1), border: edit.id === q.id ? `0.5px solid ${accent(0.7, 0.35)}` : 'none' }}>
              <span style={{ fontSize: 13 }}>{q.icon}</span>
              <span style={{ flex: 'none', color: ink(1), fontSize: 11, fontWeight: 600 }}>{q.label}</span>
              <span style={{ flex: 1, ...text.faint(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.text.replace(/\n/g, ' ')}</span>
              <Pencil size={11} strokeWidth={2} className="hv" onClick={() => setEdit({ id: q.id, icon: q.icon, label: q.label, text: q.text })} style={{ color: ink(3), cursor: 'pointer', flex: 'none' }} />
              <X size={11} strokeWidth={2} className="hv" onClick={() => { p.onDeletePrompt(q.id); if (edit.id === q.id) setEdit(emptyEdit) }} style={{ color: ink(4), cursor: 'pointer', flex: 'none' }} />
            </div>
          ))}
          {/* 新增 / 编辑表单 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 8, borderRadius: R.md, background: fill(1), border: `0.5px dashed ${hairline(0.16)}` }}>
            <div style={{ display: 'flex', gap: 5 }}>
              <input value={edit.icon} onChange={(e) => setEdit((s) => ({ ...s, icon: e.target.value }))} title="图标（emoji）" style={{ ...miniInput, width: 44, textAlign: 'center' }} />
              <input value={edit.label} onChange={(e) => setEdit((s) => ({ ...s, label: e.target.value }))} placeholder="名称，如：写周报" style={{ ...miniInput, flex: 1 }} />
            </div>
            <textarea
              value={edit.text}
              onChange={(e) => setEdit((s) => ({ ...s, text: e.target.value }))}
              placeholder="点击指令时回填到输入框的内容模板…"
              rows={2}
              className="ai-scroll"
              style={{ ...miniInput, width: '100%', resize: 'none', lineHeight: 1.45, maxHeight: 64 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="primary" sm disabled={!canSavePrompt} onClick={savePrompt} style={{ flex: 1 }}>
                {edit.id ? '✓ 更新指令' : '＋ 新增指令'}
              </Button>
              {edit.id && (
                <Button variant="ghost" sm onClick={() => setEdit(emptyEdit)}>取消</Button>
              )}
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* 剪贴板历史：填入 / 译 / 释 / 洗（AI 直发） */}
      <AnimatePresence>
      {showClips && p.clips.length > 0 && (
        <motion.div variants={overlayPop} initial="initial" animate="animate" exit="exit" style={{ ...panelBox, gap: 6, maxHeight: 220, overflowY: 'auto' }} className="ai-scroll">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: ink(1), fontSize: 11, fontWeight: 700 }}><ClipboardList size={11} strokeWidth={2} style={{ color: accent() }} />剪贴板</span>
            <span style={{ ...text.faint(), fontSize: 9.5 }}>★ 收藏才落盘</span>
            <span style={{ flex: 1 }} />
            <span className="hv" onClick={p.onClusterClips} title="AI 把片段按主题聚成集" style={{ color: p.clipClustering ? ink(4) : accent(0.85), fontSize: 10, cursor: 'pointer' }}>{p.clipClustering ? '聚类中…' : '🧩 归类'}</span>
            <span className="hv" onClick={p.onClearClips} title="清空未收藏项" style={{ color: ink(3), fontSize: 10, cursor: 'pointer' }}>清空</span>
          </div>
          <input
            value={clipQuery}
            onChange={(e) => setClipQuery(e.target.value)}
            placeholder="搜索剪贴板…"
            style={{ width: '100%', boxSizing: 'border-box', ...surface.inset(), outline: 'none', color: ink(1), fontSize: 11, padding: '5px 9px' }}
          />
          {(() => {
            const q = clipQuery.trim().toLowerCase()
            const filtered = q ? p.clips.filter((c) => (c.text || '').toLowerCase().includes(q) || c.tag.toLowerCase().includes(q)) : p.clips
            const renderClip = (c: ClipItem): React.JSX.Element => {
              const hue = tagHue[c.tag] ?? 200
              const fav = <Star size={12} strokeWidth={1.75} fill={c.fav ? 'oklch(0.82 0.14 85)' : 'none'} className="hv" onClick={() => p.onToggleClipFav(c.id)} style={{ flex: 'none', color: c.fav ? 'oklch(0.82 0.14 85)' : ink(4), cursor: 'pointer' }} />
              const del = <X size={12} strokeWidth={2} className="hv" onClick={() => p.onRemoveClip(c.id)} style={{ flex: 'none', color: ink(4), cursor: 'pointer' }} />
              if (c.kind === 'image') {
                return (
                  <div key={c.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: R.md, background: fill(1) }}>
                    <img src={c.dataUrl} alt="剪贴板图片" style={{ flex: 'none', width: 40, height: 28, objectFit: 'cover', borderRadius: 5, border: `0.5px solid ${hairline(0.1)}` }} />
                    <span style={{ flex: 1, minWidth: 0, color: ink(3), fontSize: 10.5 }}>图片 · 截图</span>
                    <span className="hv" onClick={() => { p.onAskClipImage(c.dataUrl!); setShowClips(false) }} title="用 AI 分析这张图" style={{ flex: 'none', padding: '2px 8px', borderRadius: R.sm, background: semBg(sem.focus, 0.2), color: sem.focus, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>问 AI</span>
                    {fav}{del}
                  </div>
                )
              }
              const txt = c.text ?? ''
              return (
                <div key={c.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px', borderRadius: R.md, background: fill(1) }}>
                  <span style={{ flex: 'none', padding: '1px 6px', borderRadius: 5, background: tintSurface(String(hue), .72, true), color: hueAccent(String(hue), .11), fontSize: 9, fontWeight: 700 }}>{c.tag}</span>
                  <span className="hv" onClick={() => { p.conv.onText(txt); setShowClips(false) }} title="填入输入框" style={{ flex: 1, minWidth: 0, color: ink(2), fontSize: 10.5, fontFamily: "ui-monospace,'Cascadia Code',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{txt.replace(/\s+/g, ' ').slice(0, 60)}</span>
                  {CLIP_ACTIONS.map((a) => (
                    <span key={a.key} className="hv" onClick={() => { p.onSendClip(a.prefix + txt); setShowClips(false) }} title={`AI ${a.title}`} style={{ flex: 'none', padding: '2px 6px', borderRadius: R.sm, background: semBg(accent(), 0.14), color: accent(0.85), fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>{a.label}</span>
                  ))}
                  {fav}{del}
                </div>
              )
            }
            if (filtered.length === 0) return <div style={{ ...text.faint(), fontSize: 10.5, padding: '6px 2px' }}>没有匹配的片段</div>
            const groupNames = [...new Set(Object.values(p.clipGroups))]
            const hasGroups = groupNames.length > 0
            if (!hasGroups) return <>{filtered.map(renderClip)}</>
            const ungrouped = filtered.filter((c) => !p.clipGroups[c.id])
            return (
              <>
                {groupNames.map((name) => {
                  const items = filtered.filter((c) => p.clipGroups[c.id] === name)
                  if (!items.length) return null
                  return (
                    <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ color: accent(0.72, 0.85), fontSize: 10, fontWeight: 700, marginTop: 2 }}>🧩 {name}</div>
                      {items.map(renderClip)}
                    </div>
                  )
                })}
                {ungrouped.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ color: ink(3), fontSize: 10, fontWeight: 700, marginTop: 2 }}>其它</div>
                    {ungrouped.map(renderClip)}
                  </div>
                )}
              </>
            )
          })()}
        </motion.div>
      )}
      </AnimatePresence>

      {/* 历史会话列表 */}
      <AnimatePresence>
      {showHistory && p.sessions.length > 0 && (
        <motion.div variants={overlayPop} initial="initial" animate="animate" exit="exit" style={panelBox}>
          {p.sessions.map((s) => (
            <div key={s.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: R.md, background: fill(1) }}>
              <MessageSquare size={12} strokeWidth={1.75} style={{ color: ink(3), flex: 'none' }} />
              {pendingDeleteId === s.id ? (
                <>
                  <span style={{ flex: 1, color: s.busy ? sem.warn : ink(2), fontSize: 10.5 }}>{s.busy ? '该会话仍在生成，删除会丢弃结果。' : '删除后无法恢复这段对话。'}</span>
                  <Button variant="ghost" sm onClick={() => setPendingDeleteId(null)}>取消</Button>
                  <Button variant="danger" sm onClick={() => { p.onDeleteSession(s.id); setPendingDeleteId(null) }}>确认删除</Button>
                </>
              ) : (
                <>
                  <span onClick={() => { p.onSwitch(s.id); setShowHistory(false) }} style={{ flex: 1, color: ink(1), fontSize: 11.5, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="恢复此对话继续聊">
                    {s.title}
                  </span>
                  {s.busy && <span style={{ color: sem.warn, fontSize: 9, fontWeight: 650 }}>生成中</span>}
                  <span className="hv" onClick={() => setPendingDeleteId(s.id)} title="删除历史会话" style={{ color: ink(4), cursor: 'pointer', flex: 'none', display: 'inline-flex' }}><X size={12} strokeWidth={2} /></span>
                </>
              )}
            </div>
          ))}
        </motion.div>
      )}
      </AnimatePresence>

      {/* 沉浸式空态：欢迎 + 指令卡片网格 + 示例问题 */}
      {p.empty && (
        <motion.div variants={overlayPop} initial={false} animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 14px 14px', ...surface.section() }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 42, height: 42, borderRadius: 13, background: gradient.brand(), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 18px ${accent(0.7, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.3)`, color: gradient.onPrimary() }}>
              <Sparkles size={20} strokeWidth={1.75} />
            </div>
            <div style={{ ...text.title(), fontSize: 14 }}>工作助手</div>
            <div style={{ ...text.dim(), textAlign: 'center', lineHeight: 1.6 }}>
              从一个明确问题开始 · {p.engine === 'llm' ? (p.kbMode ? '仅依据我的知识库' : p.mode === 'deep' ? '深度回答' : '快速回答') : p.engine === 'claude' ? '交给本机 Claude' : '交给本机 Codex'}
            </div>
          </div>

          {/* 指令卡片：点击回填输入框（✎ 可自定义） */}
          {p.prompts.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
              {p.prompts.map((q) => (
                <motion.div
                  key={q.id}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => p.conv.onText(q.text)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '11px 6px', borderRadius: R.lg, background: fill(2), cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 16 }}>{q.icon}</span>
                  <span style={{ color: ink(1), fontSize: 10.5, fontWeight: 600 }}>{q.label}</span>
                </motion.div>
              ))}
            </div>
          )}

          {/* 与常驻迷你条同源的动态灵感：点击直接发送 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {p.suggestions.map((s) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.985 }}
                onClick={s.go}
                style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 38, padding: '8px 12px', borderRadius: R.lg, background: fill(2), color: ink(2), fontSize: 11.5, cursor: 'pointer', boxSizing: 'border-box' }}
              >
                <Lightbulb size={12} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <span style={{ flex: 'none', color: ink(4), fontSize: 9.5 }}>{s.source}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      <IslandChat {...finalConv} />
    </div>
  )
}
