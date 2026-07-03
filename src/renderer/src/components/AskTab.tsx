// 问答分区 v3：紧凑单行头部（模式/模型下拉切换/指令管理/重试/新对话/历史）
// · 模型 chip 下拉可在「已保存的配置」间一键切换（多厂商多模型自由切换）
// · 快捷指令完全可自定义（增删改 + 恢复默认，持久化），空态卡片与输入区 chips 同源。

import { useState } from 'react'
import type { ChatProps, QuickPrompt } from '../types'
import { IslandChat } from './IslandChat'

interface AskTabProps {
  modelLabel: string
  onOpenLlmSettings: () => void
  /** 可切换的模型（当前厂商型号列表 + 已保存的跨厂商配置） */
  models: { id: string; name: string; active: boolean }[]
  onSwitchModel: (id: string) => void
  empty: boolean
  mode: 'fast' | 'deep'
  onSetMode: (m: 'fast' | 'deep') => void
  suggestions: { label: string; go: () => void }[]
  conv: ChatProps
  sessions: { id: number; title: string }[]
  onNew: () => void
  onSwitch: (id: number) => void
  onDeleteSession: (id: number) => void
  onRetry: () => void
  /** 快捷指令（用户可增删改） */
  prompts: QuickPrompt[]
  onSavePrompt: (p: { id?: number; icon: string; label: string; text: string }) => void
  onDeletePrompt: (id: number) => void
  onResetPrompts: () => void
  /** 剪贴板历史（仅内存）+ AI 快捷分析 */
  clips: string[]
  onRemoveClip: (i: number) => void
  onClearClips: () => void
  /** 直接发送一条组装好的提问（翻译/解释/分析剪贴板内容） */
  onSendClip: (text: string) => void
}

/** 剪贴板条目的 AI 快捷动作 */
const CLIP_ACTIONS = [
  { label: '译', title: '翻译', prefix: '翻译下面的内容（中英互译，保留术语）：\n\n' },
  { label: '释', title: '解释代码/内容', prefix: '解释下面的内容（若是代码给出关键逻辑，若是报错给出原因与修复）：\n\n' },
  { label: '洗', title: '清洗格式', prefix: '把下面的内容清洗成干净的纯文本/Markdown（去乱码、修正换行、保留结构）：\n\n' }
]

const iconBtn: React.CSSProperties = {
  height: 26,
  padding: '0 10px',
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.07)',
  color: 'oklch(0.78 0.02 var(--th) / .75)',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap'
}

const segChip = (active: boolean): React.CSSProperties => ({
  padding: '4px 11px',
  borderRadius: 7,
  fontSize: 11,
  fontWeight: active ? 700 : 500,
  cursor: 'pointer',
  transition: 'all .15s',
  background: active ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'transparent',
  color: active ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.78 0.02 var(--th) / .7)'
})

const panelBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: 8,
  borderRadius: 11,
  background: 'rgba(0,0,0,.22)'
}

const miniInput: React.CSSProperties = {
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 8,
  color: 'oklch(0.95 0.01 var(--th))',
  fontSize: 11.5,
  padding: '6px 8px',
  outline: 'none',
  fontFamily: "'Segoe UI',system-ui,sans-serif"
}

const emptyEdit = { icon: '✨', label: '', text: '' }

export function AskTab(p: AskTabProps): React.JSX.Element {
  const [showHistory, setShowHistory] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const [manage, setManage] = useState(false)
  const [showClips, setShowClips] = useState(false)
  // 指令编辑表单：id 存在 = 更新已有，否则新增
  const [edit, setEdit] = useState<{ id?: number; icon: string; label: string; text: string }>(emptyEdit)

  const canSavePrompt = edit.label.trim() && edit.text.trim()
  const savePrompt = (): void => {
    if (!canSavePrompt) return
    p.onSavePrompt({ ...edit, icon: edit.icon.trim() || '✨', label: edit.label.trim() })
    setEdit(emptyEdit)
  }

  // 快捷指令注入输入区（有对话时显示为输入框上方的横滑 chips；点击回填不发送）
  const finalConv: ChatProps = {
    ...p.conv,
    quickReplies: p.empty ? undefined : p.prompts.map((q) => q.label),
    onQuick: (label) => {
      const found = p.prompts.find((q) => q.label === label)
      if (found) p.conv.onText(found.text)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 紧凑头部：模式 · 模型(下拉切换) · 指令管理 · 操作 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 9, background: 'rgba(0,0,0,.25)' }}>
          <div className="hv" style={segChip(p.mode === 'fast')} onClick={() => p.onSetMode('fast')}>⚡ 快速</div>
          <div className="hv" style={segChip(p.mode === 'deep')} onClick={() => p.onSetMode('deep')}>🧠 深度</div>
        </div>
        <div
          className="hv"
          onClick={() => (p.models.length > 0 ? setShowModels((v) => !v) : p.onOpenLlmSettings())}
          title={p.models.length > 0 ? '切换模型（已保存的配置）' : '模型设置'}
          style={{ ...iconBtn, maxWidth: 170, background: showModels ? 'oklch(0.3 0.05 var(--th) / .4)' : iconBtn.background }}
        >
          <span style={{ width: 5, height: 5, flex: 'none', borderRadius: 999, background: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', boxShadow: '0 0 6px oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 10 }}>{p.modelLabel}</span>
          {p.models.length > 0 && <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>}
        </div>
        <div className="hv" onClick={() => setManage((v) => !v)} title="管理快捷指令（增删改）" style={{ ...iconBtn, background: manage ? 'oklch(0.3 0.05 var(--th) / .4)' : iconBtn.background }}>✎</div>
        {p.clips.length > 0 && (
          <div className="hv" onClick={() => setShowClips((v) => !v)} title="剪贴板历史（仅内存，AI 一键分析）" style={{ ...iconBtn, background: showClips ? 'oklch(0.3 0.05 var(--th) / .4)' : iconBtn.background }}>
            📋 {p.clips.length}
          </div>
        )}
        <span style={{ flex: 1 }} />
        {!p.empty && <div className="hv" onClick={p.onRetry} title="重新生成最后一个回答" style={iconBtn}>↺</div>}
        {!p.empty && <div className="hv" onClick={p.onNew} title="归档当前对话，开始新话题" style={iconBtn}>✚</div>}
        {p.sessions.length > 0 && (
          <div className="hv" onClick={() => setShowHistory((v) => !v)} title="历史对话" style={{ ...iconBtn, background: showHistory ? 'oklch(0.3 0.05 var(--th) / .4)' : iconBtn.background }}>
            🗂 {p.sessions.length}
          </div>
        )}
      </div>

      {/* 模型切换下拉：已保存的配置一键切换 */}
      {showModels && p.models.length > 0 && (
        <div style={panelBox}>
          {p.models.map((m) => (
            <div
              key={m.id}
              className="ai-card"
              onClick={() => { p.onSwitchModel(m.id); setShowModels(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9, background: m.active ? 'oklch(0.3 0.05 var(--th) / .3)' : 'rgba(255,255,255,.04)', border: `1px solid ${m.active ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .4)' : 'rgba(255,255,255,.055)'}`, cursor: 'pointer' }}
            >
              <span style={{ width: 6, height: 6, flex: 'none', borderRadius: 999, background: m.active ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' : 'oklch(0.5 0.02 var(--th) / .5)' }} />
              <span style={{ flex: 1, color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 11, fontFamily: "ui-monospace,'Cascadia Code',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              {m.active && <span style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', fontSize: 10, fontWeight: 700 }}>使用中</span>}
            </div>
          ))}
          <div className="hv" onClick={() => { setShowModels(false); p.onOpenLlmSettings() }} style={{ textAlign: 'center', padding: '6px 0', borderRadius: 8, color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
            ⚙ 管理模型配置（在设置里保存多个即可在此切换）
          </div>
        </div>
      )}

      {/* 快捷指令管理：增删改 + 恢复默认 */}
      {manage && (
        <div style={{ ...panelBox, gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'oklch(0.85 0.02 var(--th) / .85)', fontSize: 11, fontWeight: 700 }}>✎ 快捷指令</span>
            <span style={{ flex: 1 }} />
            <span className="hv" onClick={p.onResetPrompts} title="恢复出厂 6 条默认指令" style={{ color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 10, cursor: 'pointer' }}>恢复默认</span>
            <span className="hv" onClick={() => { setManage(false); setEdit(emptyEdit) }} style={{ color: 'oklch(0.78 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>完成</span>
          </div>
          {/* 已有指令列表：✎ 载入编辑 / ✕ 删除 */}
          {p.prompts.map((q) => (
            <div key={q.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 9, background: edit.id === q.id ? 'oklch(0.3 0.05 var(--th) / .3)' : 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.055)' }}>
              <span style={{ fontSize: 13 }}>{q.icon}</span>
              <span style={{ flex: 'none', color: 'oklch(0.9 0.02 var(--th))', fontSize: 11, fontWeight: 600 }}>{q.label}</span>
              <span style={{ flex: 1, color: 'oklch(0.62 0.02 var(--th) / .55)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.text.replace(/\n/g, ' ')}</span>
              <span className="hv" onClick={() => setEdit({ id: q.id, icon: q.icon, label: q.label, text: q.text })} title="编辑" style={{ color: 'oklch(0.75 0.02 var(--th) / .7)', fontSize: 11, cursor: 'pointer' }}>✎</span>
              <span className="hv" onClick={() => { p.onDeletePrompt(q.id); if (edit.id === q.id) setEdit(emptyEdit) }} title="删除" style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11, cursor: 'pointer' }}>✕</span>
            </div>
          ))}
          {/* 新增 / 编辑表单 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 8, borderRadius: 9, background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.12)' }}>
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
              <div
                className="hv"
                onClick={savePrompt}
                style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: canSavePrompt ? 'pointer' : 'default', background: canSavePrompt ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: canSavePrompt ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)' }}
              >
                {edit.id ? '✓ 更新指令' : '＋ 新增指令'}
              </div>
              {edit.id && (
                <div className="hv" onClick={() => setEdit(emptyEdit)} style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .7)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>取消</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 📋 剪贴板历史：填入 / 译 / 释 / 洗（AI 直发） */}
      {showClips && p.clips.length > 0 && (
        <div style={{ ...panelBox, gap: 6, maxHeight: 220, overflowY: 'auto' }} className="ai-scroll">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'oklch(0.85 0.02 var(--th) / .85)', fontSize: 11, fontWeight: 700 }}>📋 剪贴板</span>
            <span style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9.5 }}>仅内存 · 不落盘</span>
            <span style={{ flex: 1 }} />
            <span className="hv" onClick={p.onClearClips} style={{ color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 10, cursor: 'pointer' }}>清空</span>
          </div>
          {p.clips.map((c, i) => (
            <div key={i} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 9, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.055)' }}>
              <span
                className="hv"
                onClick={() => { p.conv.onText(c); setShowClips(false) }}
                title="填入输入框"
                style={{ flex: 1, minWidth: 0, color: 'oklch(0.8 0.02 var(--th) / .85)', fontSize: 10.5, fontFamily: "ui-monospace,'Cascadia Code',monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
              >
                {c.replace(/\s+/g, ' ').slice(0, 72)}
              </span>
              {CLIP_ACTIONS.map((a) => (
                <span key={a.label} className="hv" onClick={() => { p.onSendClip(a.prefix + c); setShowClips(false) }} title={`AI ${a.title}`} style={{ flex: 'none', padding: '2px 7px', borderRadius: 6, background: 'oklch(0.3 0.05 var(--th) / .35)', color: 'oklch(0.85 calc(0.08 * var(--cs, 1)) var(--th))', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                  {a.label}
                </span>
              ))}
              <span className="hv" onClick={() => p.onRemoveClip(i)} style={{ flex: 'none', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11, cursor: 'pointer' }}>✕</span>
            </div>
          ))}
        </div>
      )}

      {/* 历史会话列表 */}
      {showHistory && p.sessions.length > 0 && (
        <div style={panelBox}>
          {p.sessions.map((s) => (
            <div key={s.id} className="ai-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.055)' }}>
              <span onClick={() => { p.onSwitch(s.id); setShowHistory(false) }} style={{ flex: 1, color: 'oklch(0.86 0.02 var(--th) / .9)', fontSize: 11.5, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="恢复此对话继续聊">
                💬 {s.title}
              </span>
              <span className="hv" onClick={() => p.onDeleteSession(s.id)} style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11, cursor: 'pointer' }}>✕</span>
            </div>
          ))}
        </div>
      )}

      {/* 沉浸式空态：欢迎 + 指令卡片网格 + 示例问题 */}
      {p.empty && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 14px 14px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.62 calc(0.15 * var(--cs, 1)) var(--th2)))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: '0 4px 18px oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)' }}>✦</div>
            <div style={{ color: 'oklch(0.94 0.01 var(--th))', fontSize: 14, fontWeight: 700 }}>工作助手</div>
            <div style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 11, textAlign: 'center', lineHeight: 1.6 }}>
              支持多轮追问（记得上文）· 多行粘贴代码 · {p.mode === 'deep' ? '深度模式展示思维链' : '快速模式直给结论'}
            </div>
          </div>

          {/* 指令卡片：点击回填输入框（✎ 可自定义） */}
          {p.prompts.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
              {p.prompts.map((q) => (
                <div
                  key={q.id}
                  className="hv ai-card"
                  onClick={() => p.conv.onText(q.text)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '11px 6px', borderRadius: 11, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 16 }}>{q.icon}</span>
                  <span style={{ color: 'oklch(0.86 0.02 var(--th) / .9)', fontSize: 10.5, fontWeight: 600 }}>{q.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* 示例问题：点击直接发送 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {p.suggestions.map((s, i) => (
              <div key={i} className="hv" onClick={s.go} style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)', color: 'oklch(0.8 0.02 var(--th) / .8)', fontSize: 11.5, cursor: 'pointer' }}>
                💡 {s.label}
              </div>
            ))}
          </div>
        </div>
      )}

      <IslandChat {...finalConv} />
    </div>
  )
}
