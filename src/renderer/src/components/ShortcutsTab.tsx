// ⚡ 快捷指令：指令网格（点击即跑）+ 多步编辑器 + 运行浮层（日志流/确认闸/运行时输入/仓库选择/Agent 流式）。
// 三种造指令：步骤编辑器 · AI 大白话生成 · （建议入口留在 App 的活动分析里）。执行引擎在 logic/shortcuts.ts。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunLog, ShortcutDef, ShortcutStep, StepKind } from '../logic/shortcuts'
import { PRESET_SHORTCUTS, LEGACY_PRESET_IDS, runShortcut, needsRepo, GEN_SYSTEM, parseGenerated } from '../logic/shortcuts'
import { island } from '../bridge'
import { Markdown } from './Markdown'
import type { WorkbenchProject, WorkflowRun } from '../types'
import { ProjectContextBar } from './ProjectContextBar'

interface Props {
  projects: WorkbenchProject[]
  activeProjectId: string | null
  onSelectProject: (id: string | null) => void
  onCreateProject: (name: string, repoPath?: string) => void
  workflowRuns: WorkflowRun[]
  onRunComplete: (run: WorkflowRun) => void
  shortcuts: ShortcutDef[]
  onChange: (list: ShortcutDef[]) => void
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  llmReady: boolean
  islandAction: (action: 'todo' | 'note' | 'ask', args: string) => string
  /** 「仓库」分区里钉的本地仓库（目标仓库下拉用） */
  repos: { path: string }[]
  autoRunId: string | null
  onAutoRunDone: () => void
}

interface AgentLive { text: string; tools: { label: string; detail?: string }[] }
interface RunState {
  name: string
  icon: string
  logs: RunLog[]
  active: boolean
  confirm?: { msg: string; resolve: (b: boolean) => void }
  input?: { label: string; resolve: (s: string | null) => void }
  repoPick?: { resolve: (s: string | null) => void }
  agentLive?: AgentLive | null
}

const GROUPS = ['开发验收', 'Git交付', 'Agent协作', 'MATLAB/Simulink', '需求文档', '自定义']
const GROUP_META: Record<string, { icon: string; hue: number }> = {
  开发验收: { icon: '✓', hue: 150 },
  Git交付: { icon: '⑂', hue: 75 },
  Agent协作: { icon: '◆', hue: 260 },
  'MATLAB/Simulink': { icon: '▦', hue: 30 },
  需求文档: { icon: '≡', hue: 205 },
  自定义: { icon: '⚡', hue: 320 }
}
const KIND_LABEL: Record<StepKind, string> = { shell: '🖥 脚本', open: '🔗 打开', clipboard: '📋 剪贴板', ai: '✨ AI', agent: '◆ 本地 Agent', island: '🝔 岛内动作', input: '⌨ 询问输入', confirm: '⚠️ 确认' }
const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || p
const defaultStep = (kind: StepKind): ShortcutStep => {
  if (kind === 'shell') return { kind, cmd: '' }
  if (kind === 'open') return { kind, target: 'https://' }
  if (kind === 'clipboard') return { kind, op: 'write', text: '%prev%' }
  if (kind === 'ai') return { kind, system: '', prompt: '%prev%' }
  if (kind === 'agent') return { kind, engine: 'claude', prompt: '', useRepo: true }
  if (kind === 'island') return { kind, action: 'note', args: '%prev%' }
  if (kind === 'confirm') return { kind, message: '确认继续？' }
  return { kind: 'input', label: '' }
}

const inp: React.CSSProperties = { boxSizing: 'border-box', background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: 'oklch(0.95 0.01 var(--th))', fontSize: 11, padding: '6px 9px', outline: 'none', fontFamily: 'var(--font)' }
const chipS = (on: boolean): React.CSSProperties => ({ padding: '4px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap', background: on ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)', color: on ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.76 0.02 var(--th) / .75)' })

export function ShortcutsTab(p: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [run, setRun] = useState<RunState | null>(null)
  const [edit, setEdit] = useState<ShortcutDef | null>(null)
  const [inputDraft, setInputDraft] = useState('')
  // AI 造指令
  const [genOpen, setGenOpen] = useState(false)
  const [genText, setGenText] = useState('')
  const [genBusy, setGenBusy] = useState(false)
  const [genErr, setGenErr] = useState('')
  // 本地 Agent 流式事件分发（runId → sink）
  const agentSinks = useRef(new Map<string, (ev: { kind: string; text?: string; name?: string; detail?: string }) => void>())
  useEffect(() => island.onAgentCliEvent(({ runId, ev }) => agentSinks.current.get(runId)?.(ev)), [])
  const presetMigrated = useRef(false)
  useEffect(() => {
    if (presetMigrated.current) return
    presetMigrated.current = true
    const hasV2 = p.shortcuts.some((s) => s.id.startsWith('wf-'))
    const hasLegacy = p.shortcuts.some((s) => LEGACY_PRESET_IDS.has(s.id))
    if (!hasV2 && hasLegacy) {
      const keep = p.shortcuts.filter((s) => !LEGACY_PRESET_IDS.has(s.id))
      p.onChange([...keep, ...PRESET_SHORTCUTS])
    }
  }, [p])

  const filtered = useMemo(() => {
    let list = p.shortcuts
    if (group) list = list.filter((s) => s.group === group)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((s) => (s.name + (s.desc || '') + s.group).toLowerCase().includes(q))
    return [...list].sort((a, b) => b.runCount - a.runCount || a.name.localeCompare(b.name))
  }, [p.shortcuts, group, query])

  const runAgent = (engine: 'claude' | 'codex', prompt: string, cwd: string | undefined, onEvent?: (ev: { kind: string; text?: string; name?: string; detail?: string }) => void): Promise<{ ok: boolean; text?: string; error?: string }> =>
    new Promise((resolve) => {
      void island.agentCliStream(engine, prompt, cwd).then((r) => {
        if (!r.ok || !r.runId) { resolve({ ok: false, error: r.error }); return }
        const runId = r.runId
        let text = ''
        agentSinks.current.set(runId, (ev) => {
          if (ev.kind === 'text') { text += ev.text || ''; onEvent?.(ev) }
          else if (ev.kind === 'tool' || ev.kind === 'status') onEvent?.(ev)
          else if (ev.kind === 'result' || ev.kind === 'error') {
            agentSinks.current.delete(runId)
            resolve(ev.kind === 'result' ? { ok: true, text: (text || ev.text || '').trim() } : { ok: false, error: ev.text })
          }
        })
      })
    })

  const runIt = async (def: ShortcutDef): Promise<void> => {
    if (run?.active) return
    const startedAt = Date.now()
    const project = p.projects.find((x) => x.id === p.activeProjectId)
    const runtimeDef = project?.repoPath && needsRepo(def) && !def.repoPath ? { ...def, repoPath: project.repoPath } : def
    const logs: RunLog[] = []
    setRun({ name: def.name, icon: def.icon, logs: [], active: true })
    setInputDraft('')
    const ok = await runShortcut(runtimeDef, {
      ai: p.onAI,
      shell: (cmd, cwd) => island.shortcutShell(cmd, cwd),
      open: (t) => island.shortcutOpen(t),
      agent: runAgent,
      clipRead: () => island.clipReadText(),
      clipWrite: (t) => island.clipWriteText(t),
      islandAction: p.islandAction,
      askInput: (label) => new Promise((res) => setRun((r) => r && { ...r, input: { label, resolve: res } })),
      askRepo: () => new Promise((res) => setRun((r) => r && { ...r, repoPick: { resolve: res } })),
      askConfirm: (msg) => new Promise((res) => setRun((r) => r && { ...r, confirm: { msg, resolve: res } })),
      onLog: (l) => { logs.push(l); setRun((r) => r && { ...r, logs: [...logs] }) },
      onAgentLive: (live) => setRun((r) => r && { ...r, agentLive: live })
    })
    setRun((r) => r && { ...r, active: false, confirm: undefined, input: undefined, repoPick: undefined, agentLive: null })
    p.onChange(p.shortcuts.map((s) => (s.id === def.id ? { ...s, runCount: s.runCount + 1, lastRun: Date.now() } : s)))
    p.onRunComplete({
      id: `run-${startedAt}`,
      shortcutId: def.id,
      shortcutName: def.name,
      projectId: project?.id,
      repoPath: runtimeDef.repoPath,
      status: ok ? 'succeeded' : logs.some((l) => l.error === '已取消') ? 'cancelled' : 'failed',
      startedAt,
      finishedAt: Date.now(),
      stepCount: def.steps.length,
      completedSteps: logs.filter((l) => l.ok).length,
      summary: logs.slice(-1)[0]?.output?.slice(0, 240) || logs.slice(-1)[0]?.error
    })
  }

  useEffect(() => {
    if (!p.autoRunId) return
    const def = p.shortcuts.find((s) => s.id === p.autoRunId)
    p.onAutoRunDone()
    if (def) void runIt(def)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.autoRunId])

  const restorePresets = (): void => {
    const missing = PRESET_SHORTCUTS.filter((pre) => !p.shortcuts.some((s) => s.id === pre.id))
    if (missing.length) p.onChange([...p.shortcuts, ...missing])
  }
  const duplicate = (s: ShortcutDef): void => p.onChange([...p.shortcuts, { ...s, id: 'c' + Date.now(), name: s.name + ' 副本', builtin: false, runCount: 0, lastRun: undefined }])
  const newShortcut = (): void => setEdit({ id: 'c' + Date.now(), icon: '⚡', name: '', group: '自定义', desc: '', steps: [defaultStep('ai')], runCount: 0 })
  const saveEdit = (): void => {
    if (!edit || !edit.name.trim() || !edit.steps.length) return
    const exists = p.shortcuts.some((s) => s.id === edit.id)
    p.onChange(exists ? p.shortcuts.map((s) => (s.id === edit.id ? edit : s)) : [...p.shortcuts, edit])
    setEdit(null)
  }
  const patchStep = (i: number, patch: Record<string, unknown>): void =>
    setEdit((e) => e && { ...e, steps: e.steps.map((s, si) => (si === i ? ({ ...s, ...patch } as ShortcutStep) : s)) })
  const moveStep = (i: number, dir: -1 | 1): void =>
    setEdit((e) => {
      if (!e) return e
      const j = i + dir
      if (j < 0 || j >= e.steps.length) return e
      const steps = [...e.steps]
      ;[steps[i], steps[j]] = [steps[j], steps[i]]
      return { ...e, steps }
    })

  const generate = async (): Promise<void> => {
    const t = genText.trim(); if (!t || genBusy) return
    if (!p.llmReady) { setGenErr('请先在设置里配置问答模型'); return }
    setGenBusy(true); setGenErr('')
    const r = await p.onAI(GEN_SYSTEM, t)
    setGenBusy(false)
    if (!r.ok || !r.text) { setGenErr(r.error || '生成失败'); return }
    const def = parseGenerated(r.text)
    if (!def) { setGenErr('AI 返回的格式没解析出来，换个说法再试'); return }
    setGenOpen(false); setGenText(''); setEdit(def) // 进编辑器让用户过目/微调再保存
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ProjectContextBar
        projects={p.projects}
        activeProjectId={p.activeProjectId}
        onSelect={p.onSelectProject}
        onCreate={p.onCreateProject}
        label="执行上下文"
        detail="当前项目仓库会自动传给需要仓库的工作流"
      />
      {/* 工程工作流概览 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr repeat(3, 1fr)', gap: 1, overflow: 'hidden', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.07)' }}>
        <div style={{ padding: '10px 12px', background: 'oklch(0.21 0.025 var(--ths) / .96)' }}>
          <div style={{ color: 'oklch(0.94 0.02 var(--th))', fontSize: 12.5, fontWeight: 750 }}>工程工作流</div>
          <div style={{ marginTop: 2, color: 'oklch(0.62 0.02 var(--th) / .65)', fontSize: 9.5 }}>质量 · 交付 · 模型 · 需求</div>
        </div>
        {[
          { n: p.shortcuts.filter((s) => s.builtin).length, l: '核心流程' },
          { n: p.repos.length, l: '已接仓库' },
          { n: p.shortcuts.reduce((sum, s) => sum + s.runCount, 0), l: '累计执行' }
        ].map((x) => (
          <div key={x.l} style={{ padding: '9px 10px', background: 'oklch(0.21 0.025 var(--ths) / .96)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ color: 'oklch(0.9 0.04 var(--th))', fontSize: 16, lineHeight: 1, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{x.n}</span>
            <span style={{ marginTop: 3, color: 'oklch(0.58 0.02 var(--th) / .6)', fontSize: 9 }}>{x.l}</span>
          </div>
        ))}
      </div>

      {p.workflowRuns.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 1 }} className="ai-scroll">
          <span style={{ flex: 'none', color: 'oklch(0.58 0.02 var(--th) / .58)', fontSize: 9.5, fontWeight: 700 }}>最近执行</span>
          {p.workflowRuns.filter((x) => !p.activeProjectId || x.projectId === p.activeProjectId).slice(0, 4).map((x) => (
            <span key={x.id} title={x.summary || x.shortcutName} style={{ flex: 'none', maxWidth: 150, padding: '4px 8px', borderRadius: 7, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)', color: x.status === 'succeeded' ? 'oklch(0.78 0.1 150)' : x.status === 'failed' ? 'oklch(0.78 0.1 30)' : 'oklch(0.72 0.08 75)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {x.status === 'succeeded' ? '✓' : x.status === 'failed' ? '!' : '−'} {x.shortcutName} · {x.completedSteps}/{x.stepCount}
            </span>
          ))}
        </div>
      )}

      {/* 顶栏：搜索 + AI 造 + 新建 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRadius: 10, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)' }}>
          <span style={{ fontSize: 11, opacity: 0.5 }}>🔍</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索指令…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'oklch(0.95 0.01 var(--th))', fontSize: 11.5, padding: '7px 0' }} />
        </div>
        <div className="hv" onClick={() => setGenOpen((v) => !v)} title="用大白话描述，AI 帮你搭一条指令" style={{ padding: '0 12px', borderRadius: 10, display: 'flex', alignItems: 'center', cursor: 'pointer', background: genOpen ? 'oklch(0.3 0.05 var(--th) / .45)' : 'linear-gradient(180deg, oklch(0.7 0.14 var(--th) / .5), oklch(0.55 0.13 var(--th2) / .4))', color: 'oklch(0.95 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>✨ AI 造</div>
        <div className="hv" onClick={newShortcut} style={{ padding: '0 12px', borderRadius: 10, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: 'oklch(0.85 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>＋ 新建</div>
      </div>

      {/* AI 造指令 */}
      {genOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 11, borderRadius: 13, background: 'oklch(0.26 0.04 var(--th) / .25)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .3)' }}>
          <textarea value={genText} onChange={(e) => setGenText(e.target.value)} placeholder={'大白话描述你想一键完成的重复操作，比如：\n· 把剪贴板里的报错发给 Codex 在我的项目里修\n· 选中的英文段落翻译成中文再存成便签\n· 生成今天的 git 提交并直接提交'} rows={3} className="ai-scroll" style={{ ...inp, width: '100%', resize: 'none', lineHeight: 1.55, maxHeight: 110 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="hv" onClick={() => void generate()} style={{ padding: '6px 15px', borderRadius: 999, cursor: genText.trim() && !genBusy ? 'pointer' : 'default', background: genText.trim() && !genBusy ? 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))' : 'rgba(255,255,255,.06)', color: genText.trim() && !genBusy ? 'oklch(0.14 0.02 var(--th))' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 11.5, fontWeight: 700 }}>{genBusy ? '生成中…' : '✨ 生成指令'}</div>
            {genErr && <span style={{ color: 'oklch(0.78 0.1 40)', fontSize: 10.5 }}>{genErr}</span>}
            <span style={{ flex: 1 }} />
            <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 9 }}>生成后进编辑器，可微调再保存</span>
          </div>
        </div>
      )}

      {/* 分组 + 恢复预置 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="hv" onClick={() => setGroup('')} style={chipS(group === '')}>全部 {p.shortcuts.length}</span>
        {GROUPS.map((gr) => {
          const n = p.shortcuts.filter((s) => s.group === gr).length
          return n > 0 ? <span key={gr} className="hv" onClick={() => setGroup(group === gr ? '' : gr)} style={chipS(group === gr)}>{gr} {n}</span> : null
        })}
        <span style={{ flex: 1 }} />
        {PRESET_SHORTCUTS.some((pre) => !p.shortcuts.some((s) => s.id === pre.id)) && (
          <span className="hv" onClick={restorePresets} title="把删掉的预置指令补回来" style={{ ...chipS(false), color: 'oklch(0.8 0.08 var(--th))' }}>⟳ 恢复预置</span>
        )}
      </div>

      {filtered.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '28px 14px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.09)' }}>
          <div style={{ fontSize: 22, opacity: 0.6 }}>⚡</div>
          <div style={{ color: 'oklch(0.8 0.02 var(--th) / .85)', fontSize: 12, fontWeight: 600 }}>没有匹配的指令</div>
        </div>
      )}

      {/* 指令网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {filtered.map((s) => {
          const meta = GROUP_META[s.group] || GROUP_META['自定义']
          return (
          <div key={s.id} className="ai-card" onClick={() => void runIt(s)} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '11px 12px', borderRadius: 8, cursor: 'pointer', background: `linear-gradient(145deg, oklch(0.27 0.035 ${meta.hue} / .2), rgba(255,255,255,.025))`, border: '1px solid rgba(255,255,255,.07)', borderLeft: `3px solid oklch(0.72 0.12 ${meta.hue} / .65)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 13, background: `oklch(0.38 0.08 ${meta.hue} / .35)`, color: `oklch(0.88 0.12 ${meta.hue})` }}>{s.icon}</span>
              <span style={{ flex: 1, minWidth: 0, color: 'oklch(0.93 0.02 var(--th))', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              {s.steps.some((x) => x.kind === 'agent') && <span title="调用本地 Agent" style={{ fontSize: 9, color: 'oklch(0.8 0.12 260)' }}>◆</span>}
              {needsRepo(s) && <span title="需要选目标仓库" style={{ fontSize: 9 }}>📁</span>}
            </div>
            {s.desc && <div style={{ color: 'oklch(0.66 0.02 var(--th) / .65)', fontSize: 10, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{s.desc}</div>}
            <div className="row-acts" style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
              <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 9 }}>{s.steps.length} 步{s.runCount > 0 ? ` · ${s.runCount} 次` : ''}</span>
              <span style={{ flex: 1 }} />
              <span className="hv" title="运行" onClick={() => void runIt(s)} style={{ cursor: 'pointer', fontSize: 11, color: 'oklch(0.85 0.12 150)' }}>▶</span>
              <span className="hv" title="编辑" onClick={() => setEdit({ ...s, steps: s.steps.map((x) => ({ ...x })) })} style={{ cursor: 'pointer', fontSize: 10.5, color: 'oklch(0.75 0.02 var(--th) / .7)' }}>✎</span>
              <span className="hv" title="复制一份" onClick={() => duplicate(s)} style={{ cursor: 'pointer', fontSize: 10.5, color: 'oklch(0.72 0.02 var(--th) / .7)' }}>⧉</span>
              <span className="hv" title="删除" onClick={() => p.onChange(p.shortcuts.filter((x) => x.id !== s.id))} style={{ cursor: 'pointer', fontSize: 10.5, color: 'oklch(0.6 0.05 25 / .8)' }}>🗑</span>
            </div>
          </div>
          )
        })}
      </div>

      {/* 运行浮层 */}
      {run && (
        <div data-solid onMouseDown={() => { if (!run.active) setRun(null) }} style={{ position: 'fixed', inset: 0, zIndex: 226, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.08 0.02 var(--ths) / .55)', backdropFilter: 'blur(4px)', animation: 'ai-fadein .15s ease' }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(580px, 90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'oklch(calc(0.16 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .99)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', animation: 'ai-riseblur .3s cubic-bezier(.22,.61,.36,1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              <span style={{ fontSize: 15 }}>{run.icon}</span>
              <span style={{ flex: 1, color: 'oklch(0.95 0.01 var(--th))', fontSize: 13, fontWeight: 700 }}>{run.name}</span>
              {run.active
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'oklch(0.8 0.11 150)', fontSize: 10 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 150)', animation: 'ai-dotpulse 1.2s ease-in-out infinite' }} />运行中</span>
                : <span className="hv" onClick={() => setRun(null)} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 14 }}>✕</span>}
            </div>
            <div className="ai-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {run.logs.map((l, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: l.ok ? 'oklch(0.75 0.13 150)' : 'oklch(0.7 0.15 30)', flex: 'none' }} />
                    <span style={{ color: 'oklch(0.88 0.03 var(--th))', fontSize: 11, fontWeight: 600 }}>{l.label}</span>
                    {l.error && <span style={{ color: 'oklch(0.78 0.12 30)', fontSize: 10 }}>{l.error}</span>}
                  </div>
                  {l.output && (
                    <div className="ai-scroll" style={{ marginLeft: 13, padding: '7px 10px', borderRadius: 9, background: 'rgba(0,0,0,.28)', fontSize: 11, lineHeight: 1.55, maxHeight: 260, overflowY: 'auto' }}>
                      {l.kind === 'ai' || l.kind === 'agent' ? <Markdown text={l.output} /> : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'oklch(0.85 0.02 var(--th) / .9)', fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 10.5 }}>{l.output}</pre>}
                    </div>
                  )}
                </div>
              ))}
              {/* Agent 流式实时区 */}
              {run.agentLive && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 11px', borderRadius: 11, background: 'oklch(0.3 0.05 260 / .22)', border: '1px solid oklch(0.6 0.12 260 / .35)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'oklch(0.82 0.1 260)', fontSize: 10.5, fontWeight: 700 }}>◆ Agent 执行中<span style={{ width: 6, height: 6, borderRadius: 999, background: 'oklch(0.8 0.13 260)', animation: 'ai-dotpulse 1.2s ease-in-out infinite' }} /></div>
                  {run.agentLive.tools.slice(-6).map((t, ti) => (
                    <div key={ti} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 10 }}>
                      <span style={{ flex: 'none', color: 'oklch(0.85 0.06 var(--th))', fontWeight: 600 }}>{t.label}</span>
                      {t.detail && <span style={{ flex: 1, minWidth: 0, color: 'oklch(0.62 0.02 var(--th) / .6)', fontFamily: "ui-monospace,monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.detail}</span>}
                    </div>
                  ))}
                  {run.agentLive.text && <div style={{ marginTop: 2, maxHeight: 160, overflow: 'hidden', fontSize: 10.5, lineHeight: 1.5, color: 'oklch(0.82 0.02 var(--th) / .85)', display: 'flex', flexDirection: 'column-reverse' }}><div><Markdown text={run.agentLive.text} /></div></div>}
                </div>
              )}
              {run.active && !run.confirm && !run.input && !run.repoPick && run.logs.length === 0 && !run.agentLive && <div style={{ color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 11 }}>准备中…</div>}

              {/* 仓库选择 */}
              {run.repoPick && (
                <div style={{ padding: 11, borderRadius: 11, background: 'oklch(0.3 0.05 var(--th) / .3)', border: '1px solid oklch(0.65 0.12 var(--th) / .4)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ color: 'oklch(0.9 0.05 var(--th))', fontSize: 11, fontWeight: 700 }}>📁 选择目标仓库</div>
                  {p.repos.length === 0
                    ? <div style={{ color: 'oklch(0.7 0.06 40 / .8)', fontSize: 10.5, lineHeight: 1.6 }}>「仓库」分区里还没钉本地仓库。先去 <b>仓库 › 本地</b> 添加一个，或在指令编辑里填目标仓库路径。</div>
                    : p.repos.map((r) => (
                      <div key={r.path} className="hv" onClick={() => { const rp = run.repoPick; setRun((x) => x && { ...x, repoPick: undefined }); rp?.resolve(r.path) }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.06)' }}>
                        <span style={{ fontSize: 12 }}>📁</span>
                        <span style={{ flex: 1, minWidth: 0, color: 'oklch(0.9 0.02 var(--th))', fontSize: 11.5, fontWeight: 600 }}>{baseName(r.path)}</span>
                        <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, fontFamily: 'ui-monospace,monospace' }}>{r.path}</span>
                      </div>
                    ))}
                  <div className="hv" onClick={() => { const rp = run.repoPick; setRun((x) => x && { ...x, repoPick: undefined }); rp?.resolve(null) }} style={{ alignSelf: 'flex-start', color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 10, cursor: 'pointer' }}>取消运行</div>
                </div>
              )}
              {/* 确认闸 */}
              {run.confirm && (
                <div style={{ padding: 11, borderRadius: 11, background: 'oklch(0.4 0.09 75 / .18)', border: '1px solid oklch(0.7 0.12 75 / .4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ color: 'oklch(0.88 0.1 75)', fontSize: 11, fontWeight: 700 }}>⚠️ 请确认</div>
                  <pre className="ai-scroll" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'oklch(0.9 0.02 var(--th))', fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 10.5, maxHeight: 160, overflowY: 'auto', padding: '7px 9px', borderRadius: 8, background: 'rgba(0,0,0,.3)' }}>{run.confirm.msg}</pre>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div className="hv" onClick={() => { const c = run.confirm; setRun((r) => r && { ...r, confirm: undefined }); c?.resolve(true) }} style={{ flex: 1, textAlign: 'center', padding: '7px 0', borderRadius: 9, cursor: 'pointer', background: 'oklch(0.55 0.12 75 / .6)', color: '#fff', fontSize: 11.5, fontWeight: 700 }}>✓ 执行</div>
                    <div className="hv" onClick={() => { const c = run.confirm; setRun((r) => r && { ...r, confirm: undefined }); c?.resolve(false) }} style={{ flex: 1, textAlign: 'center', padding: '7px 0', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.07)', color: 'oklch(0.8 0.02 var(--th))', fontSize: 11.5 }}>取消</div>
                  </div>
                </div>
              )}
              {/* 运行时输入 */}
              {run.input && (
                <div style={{ padding: 11, borderRadius: 11, background: 'oklch(0.3 0.05 var(--th) / .3)', border: '1px solid oklch(0.65 0.12 var(--th) / .4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ color: 'oklch(0.9 0.05 var(--th))', fontSize: 11, fontWeight: 700 }}>⌨ {run.input.label}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input autoFocus value={inputDraft} onChange={(e) => setInputDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && inputDraft.trim()) { const ip = run.input; setRun((r) => r && { ...r, input: undefined }); setInputDraft(''); ip?.resolve(inputDraft.trim()) } }} style={{ ...inp, flex: 1 }} />
                    <div className="hv" onClick={() => { if (!inputDraft.trim()) return; const ip = run.input; setRun((r) => r && { ...r, input: undefined }); setInputDraft(''); ip?.resolve(inputDraft.trim()) }} style={{ padding: '0 14px', borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>继续</div>
                    <div className="hv" onClick={() => { const ip = run.input; setRun((r) => r && { ...r, input: undefined }); setInputDraft(''); ip?.resolve(null) }} style={{ padding: '0 11px', borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.75 0.02 var(--th))', fontSize: 11 }}>取消</div>
                  </div>
                </div>
              )}
              {!run.active && run.logs.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  {run.logs[run.logs.length - 1]?.output && <div className="hv" onClick={() => { void navigator.clipboard?.writeText(run.logs[run.logs.length - 1].output || '').catch(() => {}) }} style={{ padding: '6px 13px', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.85 0.02 var(--th))', fontSize: 11, fontWeight: 600 }}>⧉ 复制结果</div>}
                  <div className="hv" onClick={() => setRun(null)} style={{ padding: '6px 13px', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.8 0.02 var(--th))', fontSize: 11 }}>关闭</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 编辑器浮层 */}
      {edit && (
        <div data-solid onMouseDown={() => setEdit(null)} style={{ position: 'fixed', inset: 0, zIndex: 225, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.08 0.02 var(--ths) / .55)', backdropFilter: 'blur(4px)', animation: 'ai-fadein .15s ease' }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(600px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', background: 'oklch(calc(0.16 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .99)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', animation: 'ai-riseblur .3s cubic-bezier(.22,.61,.36,1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 15px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
              <span style={{ fontSize: 15 }}>⚡</span>
              <span style={{ flex: 1, color: 'oklch(0.95 0.01 var(--th))', fontSize: 13, fontWeight: 700 }}>{p.shortcuts.some((s) => s.id === edit.id) ? '编辑指令' : '新建指令'}</span>
              <span className="hv" onClick={() => setEdit(null)} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 14 }}>✕</span>
            </div>
            <div className="ai-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={edit.icon} onChange={(e) => setEdit((x) => x && { ...x, icon: e.target.value })} title="图标（emoji）" style={{ ...inp, width: 44, textAlign: 'center' }} />
                <input value={edit.name} onChange={(e) => setEdit((x) => x && { ...x, name: e.target.value })} placeholder="指令名称" style={{ ...inp, flex: 1, fontWeight: 700 }} />
                <select value={edit.group} onChange={(e) => setEdit((x) => x && { ...x, group: e.target.value })} style={{ ...inp, width: 84 }}>
                  {GROUPS.map((gr) => <option key={gr} value={gr}>{gr}</option>)}
                </select>
              </div>
              <input value={edit.desc || ''} onChange={(e) => setEdit((x) => x && { ...x, desc: e.target.value })} placeholder="一句话说明（可空）" style={inp} />
              {/* 目标仓库（指令用了 %repo% 或有 useRepo 的 agent 步骤时才显示） */}
              {needsRepo(edit) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9, background: 'rgba(255,255,255,.03)' }}>
                  <span style={{ color: 'oklch(0.75 0.02 var(--th) / .8)', fontSize: 10.5, flex: 'none' }}>📁 目标仓库</span>
                  <select value={edit.repoPath || ''} onChange={(e) => setEdit((x) => x && { ...x, repoPath: e.target.value })} style={{ ...inp, flex: 1 }}>
                    <option value="">每次运行时选</option>
                    {p.repos.map((r) => <option key={r.path} value={r.path}>{baseName(r.path)}</option>)}
                  </select>
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 10.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!edit.trusted} onChange={(e) => setEdit((x) => x && { ...x, trusted: e.target.checked })} style={{ accentColor: 'oklch(0.75 0.14 var(--th))' }} />
                🛡 信任此指令：脚本步骤免确认（rm/del/shutdown/git push 等危险命令仍强制确认）
              </label>
              <div style={{ color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 9.5, lineHeight: 1.6, padding: '6px 9px', borderRadius: 8, background: 'rgba(255,255,255,.03)' }}>
                变量：<code>%clip%</code> 剪贴板 · <code>%prev%</code> 上一步输出 · <code>%input%</code> 询问的输入 · <code>%repo%</code> 选定仓库 · <code>%date%</code>/<code>%time%</code>
              </div>
              {edit.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 11, background: 'rgba(0,0,0,.22)', border: '1px solid rgba(255,255,255,.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'oklch(0.65 0.06 var(--th))', fontSize: 10, fontWeight: 800 }}>步骤 {i + 1}</span>
                    <select value={s.kind} onChange={(e) => setEdit((x) => x && { ...x, steps: x.steps.map((st, si) => (si === i ? defaultStep(e.target.value as StepKind) : st)) })} style={{ ...inp, width: 118, padding: '4px 6px' }}>
                      {(Object.keys(KIND_LABEL) as StepKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                    <span style={{ flex: 1 }} />
                    <span className="hv" onClick={() => moveStep(i, -1)} style={{ cursor: 'pointer', color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 11 }}>↑</span>
                    <span className="hv" onClick={() => moveStep(i, 1)} style={{ cursor: 'pointer', color: 'oklch(0.7 0.02 var(--th) / .6)', fontSize: 11 }}>↓</span>
                    <span className="hv" onClick={() => setEdit((x) => x && { ...x, steps: x.steps.filter((_, si) => si !== i) })} style={{ cursor: 'pointer', color: 'oklch(0.6 0.05 25 / .8)', fontSize: 11 }}>✕</span>
                  </div>
                  {s.kind === 'shell' && (<>
                    <textarea value={s.cmd} onChange={(e) => patchStep(i, { cmd: e.target.value })} placeholder="PowerShell 脚本（支持变量）" rows={3} className="ai-scroll" style={{ ...inp, width: '100%', resize: 'none', fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 10.5, lineHeight: 1.5 }} />
                    <input value={s.cwd || ''} onChange={(e) => patchStep(i, { cwd: e.target.value })} placeholder="工作目录（可空；可用 %repo%）" style={{ ...inp, fontSize: 10 }} />
                  </>)}
                  {s.kind === 'open' && <input value={s.target} onChange={(e) => patchStep(i, { target: e.target.value })} placeholder="https://… 或 路径（支持 %home% %repo%）" style={inp} />}
                  {s.kind === 'clipboard' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={s.op} onChange={(e) => patchStep(i, { op: e.target.value })} style={{ ...inp, width: 90 }}><option value="read">读取</option><option value="write">写入</option></select>
                      {s.op === 'write' && <input value={s.text || ''} onChange={(e) => patchStep(i, { text: e.target.value })} placeholder="写入内容（默认 %prev%）" style={{ ...inp, flex: 1 }} />}
                    </div>
                  )}
                  {s.kind === 'ai' && (<>
                    <input value={s.system} onChange={(e) => patchStep(i, { system: e.target.value })} placeholder="给 AI 的指示，如：翻译成英文，只输出译文" style={inp} />
                    <input value={s.prompt} onChange={(e) => patchStep(i, { prompt: e.target.value })} placeholder="输入内容模板（默认 %prev%）" style={inp} />
                  </>)}
                  {s.kind === 'agent' && (<>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select value={s.engine} onChange={(e) => patchStep(i, { engine: e.target.value })} style={{ ...inp, width: 130 }}><option value="claude">◆ Claude Code</option><option value="codex">⬡ Codex</option></select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'oklch(0.75 0.02 var(--th) / .8)', fontSize: 10, cursor: 'pointer' }}>
                        <input type="checkbox" checked={s.useRepo !== false} onChange={(e) => patchStep(i, { useRepo: e.target.checked })} style={{ accentColor: 'oklch(0.75 0.14 var(--th))' }} />在选定仓库(%repo%)里执行
                      </label>
                    </div>
                    <textarea value={s.prompt} onChange={(e) => patchStep(i, { prompt: e.target.value })} placeholder="派给本地 Agent 的任务（支持 %prev% %input% %clip%）" rows={3} className="ai-scroll" style={{ ...inp, width: '100%', resize: 'none', lineHeight: 1.5 }} />
                  </>)}
                  {s.kind === 'island' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={s.action} onChange={(e) => patchStep(i, { action: e.target.value })} style={{ ...inp, width: 100 }}><option value="todo">建待办</option><option value="note">存便签</option><option value="ask">发问答</option></select>
                      <input value={s.args} onChange={(e) => patchStep(i, { args: e.target.value })} placeholder="内容模板（便签首行=标题）" style={{ ...inp, flex: 1 }} />
                    </div>
                  )}
                  {s.kind === 'input' && <input value={s.label} onChange={(e) => patchStep(i, { label: e.target.value })} placeholder="问用户什么？" style={inp} />}
                  {s.kind === 'confirm' && <input value={s.message} onChange={(e) => patchStep(i, { message: e.target.value })} placeholder="确认提示（支持 %prev% 展示内容）" style={inp} />}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {(Object.keys(KIND_LABEL) as StepKind[]).map((k) => (
                  <span key={k} className="hv" onClick={() => setEdit((x) => x && { ...x, steps: [...x.steps, defaultStep(k)] })} style={{ padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10, fontWeight: 600, background: 'rgba(255,255,255,.05)', border: '1px dashed rgba(255,255,255,.15)', color: 'oklch(0.8 0.02 var(--th) / .8)' }}>＋ {KIND_LABEL[k]}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '11px 15px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
              <div className="hv" onClick={() => { if (edit.name.trim() && edit.steps.length) void runIt(edit) }} title="不保存，直接试跑一遍" style={{ padding: '7px 14px', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'oklch(0.85 0.02 var(--th))', fontSize: 11.5, fontWeight: 600 }}>▶ 测试运行</div>
              <span style={{ flex: 1 }} />
              <div className="hv" onClick={() => setEdit(null)} style={{ padding: '7px 13px', borderRadius: 9, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .75)', fontSize: 11.5 }}>取消</div>
              <div className="hv" onClick={saveEdit} style={{ padding: '7px 16px', borderRadius: 9, cursor: edit.name.trim() && edit.steps.length ? 'pointer' : 'default', opacity: edit.name.trim() && edit.steps.length ? 1 : 0.5, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>保存指令</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
