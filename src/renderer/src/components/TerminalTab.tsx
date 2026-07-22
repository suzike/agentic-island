// 真 PTY 终端（xterm.js + ConPTY PowerShell）：与本地 Windows 终端同源——
// vim/top 等 TUI、Claude Code/Codex 等交互式 CLI、颜色/光标/快捷键全部原生支持。
// 多标签：＋新增 / ✕关闭（杀进程）/ 双击改名；xterm 实例与 DOM 常驻模块级，切分区不丢。
// 视觉层：设计系统重做（ui/tokens + 共享组件 + lucide 图标），功能逻辑零改动。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  ArrowDownToLine, Bot, Brain, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock,
  Clipboard, CornerDownRight, Eraser, Folder, FolderOpen, Gauge, History, ListChecks, Package,
  Pin, Play, Plus, RefreshCw, RotateCcw, Search, Settings2, ShieldAlert, Sparkles, Square, Star,
  Terminal as TerminalIcon, Ticket, Trash2, Wand2, X
} from 'lucide-react'
import type { AgentVM } from '../types'
import type { LlmRequestConfig, TerminalEnvironmentProfile, TerminalProjectInspection, TerminalSavedSession, TerminalShellProfile, TerminalStartupTask, TerminalWorkspaceGroup, TerminalWorkspaceSettings, TerminalWorkspaceState } from '../../../shared/protocol'
import { island } from '../bridge'
import { buildTerminalDiagnosisPrompt, buildTerminalHandoffPrompt, consumeTerminalInput, extractPowerShellCwd, extractTerminalExitCode, isDangerousTerminalCommand, quotePowerShellLiteral, setLocationCommand, summarizeTerminalOutput, terminalOutputTail, terminalProjectId, TERMINAL_COMMANDS, updateTerminalCwd, type TerminalCommandGroup, type TerminalHistoryEntry } from '../logic/terminal'
import { Badge, Button, Chip, IconButton, Input, Segmented, Slider, Switch } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text, transition } from '../ui/tokens'
import { TerminalRecoveryCenter } from './TerminalRecoveryCenter'

type TermTab = TerminalSavedSession

interface Session {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

// 模块级：xterm 实例/DOM/标签列表 常驻，组件卸载（切分区）不销毁
const sessions = new Map<string, Session>()
const persisted = { tabs: [] as TermTab[], active: '' }
const inputBuffers = new Map<string, string>()
const historyStore: TerminalHistoryEntry[] = []
let commandObserver: ((id: string, command: string) => void) | null = null
let cwdObserver: ((id: string, cwd: string) => void) | null = null
let resultObserver: ((id: string, exitCode: number) => void) | null = null
const outputTails = new Map<string, string>()
const observedCwds = new Map<string, string>()
const restoredSnapshots = new Map<string, { text: string; at?: number }>()
const pendingStartupCommands = new Map<string, string[]>()
const runningCommands = new Map<string, { historyId: number; startedAt: number }>()
const DEFAULT_WORKSPACE_SETTINGS: TerminalWorkspaceSettings = { restoreMode: 'prompt', captureOutput: false, redactOutput: true, retentionDays: 7, maxSnapshotChars: 30_000 }
let workspaceCache: TerminalWorkspaceState = { version: 2, sessions: [], history: [], favorites: [], startupTasks: [], groups: [], envProfiles: [], settings: { ...DEFAULT_WORKSPACE_SETTINGS }, updatedAt: Date.now() }
let workspaceLoaded = false
let workspaceHandled = false
let workspaceLoadPromise: Promise<TerminalWorkspaceState> | null = null
let workspaceSaveTimer: ReturnType<typeof setTimeout> | undefined
let workspaceUnloadSubscribed = false
let subscribed = false

const newTerminalTab = (index = 1, cwd?: string, profile: TerminalShellProfile = 'powershell', envProfileId?: string): TermTab => {
  const now = Date.now()
  return { id: `t${now}-${Math.random().toString(36).slice(2, 7)}`, name: `${profile === 'powershell' ? 'PowerShell' : profile === 'pwsh' ? 'PowerShell 7' : profile.toUpperCase()} ${index}`, cwd, profile, envProfileId, createdAt: now, lastActiveAt: now, commandCount: 0, projectId: terminalProjectId(cwd) }
}

function loadWorkspaceOnce(): Promise<TerminalWorkspaceState> {
  if (!workspaceLoadPromise) workspaceLoadPromise = island.loadTerminalWorkspace().then((state) => { workspaceCache = state; workspaceLoaded = true; return state })
  return workspaceLoadPromise
}

function scheduleWorkspaceSave(): void {
  if (!workspaceLoaded) return
  clearTimeout(workspaceSaveTimer)
  workspaceSaveTimer = setTimeout(() => island.saveTerminalWorkspace({ ...workspaceCache, updatedAt: Date.now() }), 700)
}

function subscribeWorkspaceUnloadOnce(): void {
  if (workspaceUnloadSubscribed) return
  workspaceUnloadSubscribed = true
  window.addEventListener('beforeunload', () => {
    if (!workspaceLoaded) return
    clearTimeout(workspaceSaveTimer)
    island.saveTerminalWorkspace({ ...workspaceCache, updatedAt: Date.now() })
  })
}

function getSession(id: string): Session {
  let s = sessions.get(id)
  if (s) return s
  const term = new Terminal({
    fontFamily: "'Cascadia Code','JetBrains Mono',Consolas,'Courier New',monospace",
    fontSize: 12.5,
    lineHeight: 1.3,
    letterSpacing: 0.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowTransparency: true,
    scrollback: 8000,
    // 精调 One Dark 风配色，Claude Code / Codex 的彩色输出更好看
    theme: {
      background: 'rgba(0,0,0,0)', foreground: '#c6d0e0', cursor: '#7ee0a8', cursorAccent: '#0b0f0d',
      selectionBackground: 'rgba(126,224,168,.28)',
      black: '#2b303b', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#c6d0e0',
      brightBlack: '#5c6672', brightRed: '#ef7b85', brightGreen: '#a8d488', brightYellow: '#f0cd8b',
      brightBlue: '#74bbff', brightMagenta: '#d68ee8', brightCyan: '#66c6d2', brightWhite: '#f2f6fc'
    }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const el = document.createElement('div')
  el.style.cssText = 'width:100%;height:100%'
  term.open(el)
  const restored = restoredSnapshots.get(id)
  if (restored?.text) {
    term.writeln(`\x1b[90m── 历史输出快照 · ${restored.at ? new Date(restored.at).toLocaleString('zh-CN') : '上次会话'} · 以下内容不会重新执行 ──\x1b[0m`)
    term.write(restored.text.replace(/\n/g, '\r\n'))
    term.writeln('\r\n\x1b[90m── 新会话从这里开始 ──\x1b[0m')
    restoredSnapshots.delete(id)
  }
  term.onData((data) => {
    const next = consumeTerminalInput(inputBuffers.get(id) || '', data)
    inputBuffers.set(id, next.buffer)
    if (next.submitted) commandObserver?.(id, next.submitted)
    island.ptyInput(id, data)
  })
  term.onResize(({ cols, rows }) => island.ptyResize(id, cols, rows))
  term.registerLinkProvider({
    provideLinks: (lineNumber, callback) => {
      const line = term.buffer.active.getLine(lineNumber - 1)?.translateToString(true) || ''
      const links: Parameters<typeof callback>[0] = []
      const pattern = /(https?:\/\/[^\s"'<>]+|(?:[A-Za-z]:\\|\.{1,2}[\\/])[^\s"'<>|]+?\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|ps1|cs|cpp|c|h|java|rs|go|toml|yaml|yml))(?:\:(\d+)(?:\:(\d+))?)?/gi
      for (const match of line.matchAll(pattern)) {
        const text = match[0]
        const start = (match.index || 0) + 1
        links.push({
          range: { start: { x: start, y: lineNumber }, end: { x: start + text.length, y: lineNumber } },
          text,
          activate: () => {
            const target = text.replace(/:(\d+)(?::\d+)?$/, '')
            const cwd = observedCwds.get(id)
            const resolved = /^https?:\/\//i.test(target) || /^[A-Za-z]:\\/.test(target) || !cwd ? target : `${cwd}\\${target.replace(/^[.\\/]+/, '')}`
            void island.shortcutOpen(resolved)
          }
        })
      }
      callback(links.length ? links : undefined)
    }
  })

  // 复制粘贴：Ctrl+V / Ctrl+Shift+V 粘贴；有选区时 Ctrl+C 复制（无选区则透传 SIGINT）；Ctrl+Shift+C 复制；右键粘贴
  const paste = (): void => { void navigator.clipboard.readText().then((t) => { if (t) term.paste(t) }).catch(() => {}) }
  const copy = (): boolean => { const s = term.getSelection(); if (s) { void navigator.clipboard.writeText(s).catch(() => {}); return true } return false }
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (ctrl && e.shiftKey && k === 'c') { copy(); return false }
    if (ctrl && e.shiftKey && k === 'v') { paste(); return false }
    if (ctrl && !e.shiftKey && k === 'c') { return !copy() } // 有选区→复制并拦截；无选区→透传（中断）
    if (ctrl && !e.shiftKey && k === 'v') { paste(); return false }
    return true
  })
  el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); const s = term.getSelection(); if (s) { void navigator.clipboard.writeText(s).catch(() => {}) } else paste() })
  s = { term, fit, el }
  sessions.set(id, s)
  return s
}

function subscribeOnce(): void {
  if (subscribed) return
  subscribed = true
  island.onPtyData((id, data) => {
    sessions.get(id)?.term.write(data)
    const tail = terminalOutputTail(outputTails.get(id) || '', data, workspaceCache.settings.maxSnapshotChars)
    outputTails.set(id, tail)
    const cwd = extractPowerShellCwd(tail)
    if (cwd && observedCwds.get(id) !== cwd) {
      observedCwds.set(id, cwd)
      cwdObserver?.(id, cwd)
    }
    const exitCode = extractTerminalExitCode(data)
    if (exitCode !== null) resultObserver?.(id, exitCode)
    if (workspaceCache.settings.captureOutput) {
      workspaceCache = { ...workspaceCache, sessions: workspaceCache.sessions.map((session) => session.id === id ? { ...session, outputSnapshot: tail, outputSavedAt: Date.now() } : session) }
      scheduleWorkspaceSave()
    }
  })
}

// 状态 → 语义色/文案
const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: '运行中', color: sem.run }, needs_approval: { label: '待审批', color: sem.warn },
  waiting: { label: '等待回复', color: sem.warn }, done: { label: '已结束', color: sem.calm }
}
const fmtElapsed = (start: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - start) / 1000))
  if (s < 60) return `${s} 秒`
  if (s < 3600) return `${Math.floor(s / 60)} 分`
  return `${Math.floor(s / 3600)} 时 ${Math.floor((s % 3600) / 60)} 分`
}
const fmtTok = (n?: number): string => (n === undefined ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const MONO = "'Cascadia Code', Consolas, ui-monospace, monospace"

/** 后端徽标：Claude（品牌渐变菱形 SVG）/ Codex（六边形 SVG），与 AgentsTab 同款 */
const BackendGlyph = ({ isCodex }: { isCodex: boolean }): React.JSX.Element => (
  <div
    style={{
      width: 22, height: 22, flex: 'none', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: isCodex
        ? 'linear-gradient(135deg, oklch(0.45 0.03 250), oklch(0.3 0.03 250))'
        : gradient.brand(),
      color: isCodex ? 'oklch(0.9 0.02 250)' : gradient.onPrimary(),
      boxShadow: isCodex ? 'inset 0 1px 0 rgba(255,255,255,.08)' : `0 2px 8px ${accent(0.7, 0.35)}, inset 0 1px 0 rgba(255,255,255,.3)`
    }}
  >
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      {isCodex
        ? <path d="M12 2.5 21 7.5v9l-9 5-9-5v-9l9-5z" />
        : <path d="M12 2 22 12 12 22 2 12z" />}
    </svg>
  </div>
)

// Coding Agent 会话卡：模型 / 状态 / 运行时长 / token 用量 / 上下文 / 活动轨迹 / 变更小结
function AgentCard({ a, now }: { a: AgentVM; now: number }): React.JSX.Element {
  const st = STATUS[a.status] || STATUS.running
  const isCodex = a.backend === 'codex'
  const ctxPct = a.contextTokens ? Math.min(100, (a.contextTokens / 200000) * 100) : 0
  return (
    <motion.div
      variants={fadeScaleIn}
      initial={false}
      animate="animate"
      className="ai-card"
      style={{ ...surface.card(), padding: `${SP.md}px ${SP.md + 1}px`, display: 'flex', flexDirection: 'column', gap: SP.sm }}
    >
      {/* 头 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <BackendGlyph isCodex={isCodex} />
        <span style={{ ...text.subtitle(), fontSize: FS.body }}>{a.tool}</span>
        {a.model && <span style={{ padding: '2px 7px', borderRadius: R.pill, background: semBg(sem.focus, 0.14), color: sem.focus, fontSize: 9.5, fontWeight: 700, fontFamily: MONO }}>{a.model}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: R.pill, background: semBg(st.color, 0.16), border: `0.5px solid ${semBg(st.color, 0.35)}` }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: st.color, boxShadow: `0 0 6px ${st.color}`, animation: a.status === 'done' ? undefined : 'ai-dotpulse 1.6s ease-in-out infinite' }} />
          <span style={{ color: st.color, fontSize: 10, fontWeight: 700 }}>{st.label}</span>
        </span>
      </div>
      {/* 指标 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { icon: Folder, l: '项目', v: a.proj },
          { icon: Clock, l: '运行', v: a.startedAt ? fmtElapsed(a.startedAt, now) : '—' },
          { icon: Ticket, l: 'Token', v: fmtTok(a.tokens) },
          { icon: Brain, l: '上下文', v: fmtTok(a.contextTokens) }
        ].map((m, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: R.sm, background: fill(1), display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, ...text.faint(), fontSize: 9 }}><m.icon size={9} strokeWidth={2} style={{ flex: 'none' }} />{m.l}</span>
            <span style={{ ...text.num(FS.small), fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.v}</span>
          </div>
        ))}
      </div>
      {/* 上下文占用条 */}
      {a.contextTokens ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, height: 5, borderRadius: R.pill, background: fill(2), overflow: 'hidden' }}>
            <div style={{ width: `${ctxPct}%`, height: '100%', borderRadius: R.pill, background: ctxPct > 80 ? sem.warn : gradient.primary(), transition: transition('width', '.3s') }} />
          </div>
          <span style={{ ...text.faint(), fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>{Math.round(ctxPct)}%</span>
        </div>
      ) : null}
      {/* 当前动作 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: ink(2), fontSize: FS.small, overflow: 'hidden' }}>
        <ChevronRight size={11} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail || '待命中…'}</span>
      </div>
      {/* 活动轨迹 */}
      {a.history && a.history.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderLeft: `2px solid ${accent(0.7, 0.25)}`, paddingLeft: 8 }}>
          {a.history.slice(-3).reverse().map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, fontSize: 9 }}>
              <span style={{ flex: 'none', ...text.mono(8.5), fontVariantNumeric: 'tabular-nums' }}>{new Date(h.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              <span style={{ color: i === 0 ? ink(1) : ink(3), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.text}</span>
            </div>
          ))}
        </div>
      )}
      {/* git 小结 */}
      {a.summary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, ...text.mono(10) }}><Package size={10} strokeWidth={2} style={{ flex: 'none' }} />{a.summary.files} 文件</span>
          <span style={{ color: sem.calm, fontFamily: MONO }}>+{a.summary.added}</span>
          <span style={{ color: sem.danger, fontFamily: MONO }}>−{a.summary.removed}</span>
          {a.summary.commit && <span style={{ ...text.mono(9.5), opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.summary.commit}</span>}
        </div>
      )}
    </motion.div>
  )
}

export function TerminalTab({ tall, full, agents, llm }: { tall: boolean; full?: boolean; agents: AgentVM[]; llm: LlmRequestConfig }): React.JSX.Element {
  const [tabs, setTabs] = useState<TermTab[]>(persisted.tabs)
  const [active, setActive] = useState(persisted.active)
  const [workspaceReady, setWorkspaceReady] = useState(workspaceHandled)
  const [recovery, setRecovery] = useState<TerminalWorkspaceState | null>(null)
  const [selectedRecoverySessions, setSelectedRecoverySessions] = useState<string[]>([])
  const [selectedStartupTasks, setSelectedStartupTasks] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ptyOk, setPtyOk] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [workspacePanel, setWorkspacePanel] = useState<'tools' | 'agents' | null>(null)
  const [dims, setDims] = useState({ cols: 0, rows: 0 })
  const [commandGroup, setCommandGroup] = useState<TerminalCommandGroup>('项目')
  const [commandDraft, setCommandDraft] = useState('')
  const [cwdDraft, setCwdDraft] = useState('')
  const [toolView, setToolView] = useState<'commands' | 'history' | 'favorites' | 'workspaces' | 'tasks' | 'output' | 'ai' | 'settings'>('commands')
  const [history, setHistory] = useState<TerminalHistoryEntry[]>(historyStore)
  const [favorites, setFavorites] = useState<string[]>(workspaceCache.favorites)
  const [startupTasks, setStartupTasks] = useState<TerminalStartupTask[]>(workspaceCache.startupTasks)
  const [workspaceGroups, setWorkspaceGroups] = useState<TerminalWorkspaceGroup[]>(workspaceCache.groups)
  const [envProfiles, setEnvProfiles] = useState<TerminalEnvironmentProfile[]>(workspaceCache.envProfiles)
  const [workspaceSettings, setWorkspaceSettings] = useState<TerminalWorkspaceSettings>(workspaceCache.settings)
  const [historyQuery, setHistoryQuery] = useState('')
  const [inspection, setInspection] = useState<TerminalProjectInspection | null>(null)
  const [inspectionBusy, setInspectionBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [aiMode, setAiMode] = useState<'diagnose' | 'handoff' | 'next'>('diagnose')
  const [shellProfile, setShellProfile] = useState<TerminalShellProfile>('powershell')
  const [selectedEnvProfile, setSelectedEnvProfile] = useState('')
  const [envName, setEnvName] = useState('')
  const [envKey, setEnvKey] = useState('')
  const [envValue, setEnvValue] = useState('')
  const [pendingCommand, setPendingCommand] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [gitInfo, setGitInfo] = useState<{ ok: boolean; branch?: string; dirty?: number; ahead?: number; behind?: number } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState('')
  const hostRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  useEffect(() => { persisted.tabs = tabs; persisted.active = active }, [tabs, active])
  const liveAgents = agents.filter((a) => a.status !== 'done')
  const activeTab = tabs.find((t) => t.id === active) || tabs[0]
  const linkedAgents = activeTab?.cwd ? liveAgents.filter((agent) => activeTab.cwd!.toLowerCase().includes(agent.proj.toLowerCase()) || agent.proj.toLowerCase().includes((activeTab.cwd!.split(/[\\/]/).filter(Boolean).at(-1) || '').toLowerCase())) : []
  const groupCommands = useMemo(() => TERMINAL_COMMANDS.filter((x) => x.group === commandGroup), [commandGroup])
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase()
    return query ? history.filter((entry) => `${entry.command} ${entry.cwd || ''} ${entry.sessionName}`.toLowerCase().includes(query)) : history
  }, [history, historyQuery])
  const outputSummary = useMemo(() => summarizeTerminalOutput(outputTails.get(active) || activeTab?.outputSnapshot || ''), [active, activeTab?.outputSnapshot, history.length])

  useEffect(() => {
    if (!activeTab?.cwd) { setGitInfo(null); return }
    let canceled = false
    const timer = setTimeout(() => { void island.gitStatus(activeTab.cwd!).then((result) => { if (!canceled) setGitInfo(result) }) }, 250)
    return () => { canceled = true; clearTimeout(timer) }
  }, [activeTab?.cwd, activeTab?.lastCommand])

  useEffect(() => {
    if (!activeTab) return
    setShellProfile(activeTab.profile)
    setSelectedEnvProfile(activeTab.envProfileId || '')
  }, [activeTab?.id])

  useEffect(() => {
    setCwdDraft(activeTab?.cwd || '')
  }, [activeTab?.id, activeTab?.cwd])

  const activateSavedSessions = useCallback((saved: TermTab[], activeId?: string): void => {
    const next = saved.length ? saved.map((session) => ({ ...session, lastActiveAt: Date.now() })) : [newTerminalTab(1)]
    for (const session of next) {
      if (session.outputSnapshot) restoredSnapshots.set(session.id, { text: session.outputSnapshot, at: session.outputSavedAt })
      outputTails.set(session.id, session.outputSnapshot || '')
      if (session.cwd) observedCwds.set(session.id, session.cwd)
    }
    setTabs(next)
    setActive(next.some((session) => session.id === activeId) ? activeId! : next[0].id)
    setShellProfile(next.find((session) => session.id === activeId)?.profile || next[0].profile)
    workspaceHandled = true
    setWorkspaceReady(true)
  }, [])

  useEffect(() => {
    subscribeWorkspaceUnloadOnce()
    if (workspaceHandled) {
      if (!tabs.length) activateSavedSessions(workspaceCache.sessions, workspaceCache.activeSessionId)
      return
    }
    let canceled = false
    void loadWorkspaceOnce().then((state) => {
      if (canceled) return
      historyStore.splice(0, historyStore.length, ...state.history)
      setHistory([...historyStore])
      setFavorites(state.favorites)
      setStartupTasks(state.startupTasks)
      setWorkspaceGroups(state.groups)
      setEnvProfiles(state.envProfiles)
      setWorkspaceSettings(state.settings)
      if (state.sessions.length && state.settings.restoreMode === 'prompt') {
        setRecovery(state)
        setSelectedRecoverySessions(state.sessions.map((session) => session.id))
        setSelectedStartupTasks([])
      } else if (state.sessions.length && state.settings.restoreMode === 'auto') {
        activateSavedSessions(state.sessions, state.activeSessionId)
      } else {
        activateSavedSessions([], undefined)
      }
    })
    return () => { canceled = true }
  }, [activateSavedSessions, tabs.length])

  useEffect(() => {
    if (!workspaceReady) return
    const mergedSessions = tabs.map((tab) => {
      const cached = workspaceCache.sessions.find((session) => session.id === tab.id)
      return cached?.outputSnapshot && !tab.outputSnapshot ? { ...tab, outputSnapshot: cached.outputSnapshot, outputSavedAt: cached.outputSavedAt } : tab
    })
    workspaceCache = { version: 2, sessions: mergedSessions, activeSessionId: active, history, favorites, startupTasks, groups: workspaceGroups, envProfiles, settings: workspaceSettings, updatedAt: Date.now() }
    scheduleWorkspaceSave()
  }, [tabs, active, history, favorites, startupTasks, workspaceGroups, envProfiles, workspaceSettings, workspaceReady])

  const recordCommand = useCallback((sessionId: string, command: string): void => {
    const clean = command.trim()
    if (!clean) return
    const current = tabsRef.current.find((tab) => tab.id === sessionId)
    const sessionName = current?.name || sessionId
    const cwd = current?.cwd
    setTabs((list) => list.map((tab) => {
      if (tab.id !== sessionId) return tab
      return { ...tab, commandCount: (tab.commandCount || 0) + 1, lastCommand: clean, lastActiveAt: Date.now() }
    }))
    const entry: TerminalHistoryEntry = { id: Date.now() * 100 + historyStore.length % 100, sessionId, sessionName, command: clean, cwd, ts: Date.now() }
    runningCommands.set(sessionId, { historyId: entry.id, startedAt: entry.ts })
    historyStore.unshift(entry)
    if (historyStore.length > 500) historyStore.length = 500
    setHistory([...historyStore])
  }, [])

  useEffect(() => {
    commandObserver = recordCommand
    cwdObserver = (id, cwd) => {
      setTabs((list) => updateTerminalCwd(list, id, cwd).map((tab) => tab.id === id ? { ...tab, projectId: terminalProjectId(cwd), lastActiveAt: Date.now() } : tab))
      setWorkspaceGroups((groups) => {
        const projectId = terminalProjectId(cwd)!
        const current = groups.find((group) => terminalProjectId(group.cwd) === projectId)
        if (current) return groups.map((group) => group.id === current.id ? { ...group, lastOpenedAt: Date.now() } : group)
        return [{ id: `group-${Date.now()}`, name: cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd, cwd, lastOpenedAt: Date.now() }, ...groups].slice(0, 80)
      })
    }
    resultObserver = (id, exitCode) => {
      const running = runningCommands.get(id)
      if (!running) return
      runningCommands.delete(id)
      const durationMs = Math.max(0, Date.now() - running.startedAt)
      for (let index = 0; index < historyStore.length; index++) {
        if (historyStore[index].id === running.historyId) historyStore[index] = { ...historyStore[index], exitCode, durationMs }
      }
      setHistory([...historyStore])
      setTabs((list) => list.map((tab) => tab.id === id ? { ...tab, lastExitCode: exitCode, lastDurationMs: durationMs, lastActiveAt: Date.now() } : tab))
    }
    return () => {
      if (commandObserver === recordCommand) commandObserver = null
      cwdObserver = null
      resultObserver = null
    }
  }, [recordCommand])

  const executeCommand = useCallback((command: string): void => {
    const clean = command.trim()
    if (!clean) return
    recordCommand(active, clean)
    inputBuffers.set(active, '')
    island.ptyInput(active, clean + '\r')
    getSession(active).term.focus()
    setWorkspacePanel(null)
  }, [active, recordCommand])

  const runCommand = useCallback((command: string): void => {
    const clean = command.trim()
    if (!clean) return
    if (isDangerousTerminalCommand(clean)) {
      setPendingCommand(clean)
      return
    }
    executeCommand(clean)
  }, [executeCommand])

  const changeDirectory = (): void => {
    const path = cwdDraft.trim()
    if (!path) return
    runCommand(setLocationCommand(path))
    setTabs((list) => updateTerminalCwd(list, active, path))
  }

  const chooseDirectory = async (): Promise<void> => {
    const result = await island.pickDirectory(cwdDraft.trim() || activeTab?.cwd)
    if (!result.ok || !result.path) {
      getSession(active).term.focus()
      return
    }
    const selectedPath = result.path
    setCwdDraft(selectedPath)
    runCommand(setLocationCommand(selectedPath))
    setTabs((list) => updateTerminalCwd(list, active, selectedPath))
  }

  const toggleFavorite = (command: string): void => {
    const clean = command.trim()
    if (!clean) return
    setFavorites((list) => {
      const next = list.includes(clean) ? list.filter((x) => x !== clean) : [clean, ...list].slice(0, 30)
      return next
    })
  }

  const findInTerminal = (direction: 1 | -1): void => {
    const query = searchQuery.trim()
    if (!query) return
    const term = getSession(active).term
    const buffer = term.buffer.active
    const start = direction === 1 ? 0 : buffer.length - 1
    for (let offset = 0; offset < buffer.length; offset++) {
      const row = start + offset * direction
      const text = buffer.getLine(row)?.translateToString(true) || ''
      const col = direction === 1 ? text.toLowerCase().indexOf(query.toLowerCase()) : text.toLowerCase().lastIndexOf(query.toLowerCase())
      if (col >= 0) {
        term.select(col, row, query.length)
        term.scrollToLine(row)
        setSearchStatus(`第 ${row + 1} 行`)
        return
      }
    }
    setSearchStatus('未找到')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); setSearchOpen(true) }
      if (e.key.toLowerCase() === 't') { e.preventDefault(); addTab() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  // 有活跃会话时逐秒刷新运行时长
  useEffect(() => {
    if (!liveAgents.length) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [liveAgents.length])

  // 挂载/切换标签：把该会话的 xterm DOM 挂进宿主容器，fit 并通知 PTY 尺寸
  useEffect(() => {
    if (!workspaceReady || !active) return
    subscribeOnce()
    const host = hostRef.current
    if (!host) return
    const s = getSession(active)
    host.innerHTML = ''
    host.appendChild(s.el)
    let fitFrame = 0
    let ensured = false
    const doFit = (): void => {
      fitFrame = 0
      try {
        s.fit.fit()
        const cols = s.term.cols
        const rows = s.term.rows
        setDims((current) => current.cols === cols && current.rows === rows ? current : { cols, rows })
        if (!ensured) {
          ensured = true
          const tab = tabsRef.current.find((item) => item.id === active)
          const environmentProfile = workspaceCache.envProfiles.find((profile) => profile.id === tab?.envProfileId)
          const environment = environmentProfile ? Object.fromEntries(environmentProfile.variables.map((variable) => [variable.key, variable.value])) : undefined
          void island.ptyEnsure(active, cols, rows, tab?.cwd, tab?.profile, environment).then((ok) => {
            setPtyOk(ok)
            if (!ok) return
            const queued = pendingStartupCommands.get(active)
            if (queued?.length) {
              pendingStartupCommands.delete(active)
              for (const command of queued) {
                recordCommand(active, command)
                island.ptyInput(active, `${command}\r`)
              }
            }
          })
        }
      } catch { /* */ }
    }
    const scheduleFit = (): void => {
      if (!fitFrame) fitFrame = requestAnimationFrame(doFit)
    }
    // 等布局稳定再 fit；ResizeObserver 的连续通知合并到同一绘制帧。
    scheduleFit()
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(host)
    s.term.focus()
    return () => { if (fitFrame) cancelAnimationFrame(fitFrame); ro.disconnect() }
  }, [active, tall, full, searchOpen, workspaceReady, recordCommand])

  const addTab = (): void => {
    const tab = newTerminalTab(tabs.length + 1, activeTab?.cwd, shellProfile, selectedEnvProfile || undefined)
    setTabs((list) => [...list, tab])
    setActive(tab.id)
  }
  const closeTab = (id: string): void => {
    island.ptyKill(id)
    const s = sessions.get(id)
    if (s) { s.term.dispose(); sessions.delete(id) }
    inputBuffers.delete(id)
    outputTails.delete(id)
    observedCwds.delete(id)
    const remaining = tabs.filter((t) => t.id !== id)
    const next = remaining.length ? remaining : [newTerminalTab(1, undefined, shellProfile)]
    setTabs(next)
    if (active === id) setActive(next[0].id)
  }

  const restoreWorkspace = (): void => {
    if (!recovery) return
    const selected = recovery.sessions.filter((session) => selectedRecoverySessions.includes(session.id))
    const tasks = recovery.startupTasks.filter((task) => task.enabled && selectedStartupTasks.includes(task.id))
    if (selected.length && tasks.length) {
      for (const task of tasks) {
        const target = selected.find((session) => task.cwd && terminalProjectId(session.cwd) === terminalProjectId(task.cwd)) || selected[0]
        pendingStartupCommands.set(target.id, [...(pendingStartupCommands.get(target.id) || []), task.command])
      }
    }
    activateSavedSessions(selected, recovery.activeSessionId)
    setRecovery(null)
  }

  const startFreshWorkspace = (): void => {
    activateSavedSessions([], undefined)
    setRecovery(null)
  }

  const inspectProject = async (): Promise<void> => {
    if (!activeTab?.cwd) return
    setInspectionBusy(true)
    try { setInspection(await island.inspectTerminalProject(activeTab.cwd)) } finally { setInspectionBusy(false) }
  }

  const addStartupTask = (command: string, label?: string): void => {
    const clean = command.trim()
    if (!clean) return
    setStartupTasks((tasks) => tasks.some((task) => task.command === clean && terminalProjectId(task.cwd) === terminalProjectId(activeTab?.cwd)) ? tasks : [{ id: `startup-${Date.now()}`, label: label || clean.slice(0, 60), command: clean, cwd: activeTab?.cwd, enabled: true, createdAt: Date.now() }, ...tasks].slice(0, 80))
  }

  const openWorkspace = (cwd: string, name?: string): void => {
    const tab = newTerminalTab(tabs.length + 1, cwd, shellProfile, selectedEnvProfile || undefined)
    if (name) tab.name = name
    setTabs((list) => [...list, tab])
    setActive(tab.id)
    setWorkspacePanel(null)
  }

  const runAi = async (mode: 'diagnose' | 'handoff' | 'next'): Promise<void> => {
    if (!activeTab) return
    setAiMode(mode)
    setAiBusy(true)
    setAiResult('')
    const output = outputTails.get(active) || activeTab.outputSnapshot || ''
    const sessionHistory = history.filter((entry) => entry.sessionId === active)
    const prompt = mode === 'handoff'
      ? buildTerminalHandoffPrompt({ cwd: activeTab.cwd, history: sessionHistory, output })
      : mode === 'next'
        ? `${buildTerminalHandoffPrompt({ cwd: activeTab.cwd, history: sessionHistory, output })}\n\n基于事实给出接下来最值得执行的 3 个步骤；如包含命令，用独立代码块给出，但不要声称已执行。`
        : buildTerminalDiagnosisPrompt({ cwd: activeTab.cwd, command: activeTab.lastCommand, output, project: inspection?.kind.join(' / ') })
    try {
      const result = await island.llmComplete(llm, '你是本地开发终端的谨慎工程助手。只依据提供的现场信息回答，任何命令都需要用户确认后执行。', prompt, true)
      setAiResult(result.ok ? result.text || 'AI 未返回正文' : `分析失败：${result.error || '未知错误'}`)
    } catch (error) {
      setAiResult(`分析失败：${String(error)}`)
    } finally { setAiBusy(false) }
  }

  const clearSnapshots = async (): Promise<void> => {
    const next = await island.clearTerminalSnapshots()
    workspaceCache = next
    outputTails.clear()
    setTabs((list) => list.map((tab) => ({ ...tab, outputSnapshot: undefined, outputSavedAt: undefined })))
  }

  const addEnvironmentVariable = (): void => {
    const key = envKey.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !envValue) return
    let profileId = selectedEnvProfile
    if (!profileId) {
      profileId = `env-${Date.now()}`
      const profile: TerminalEnvironmentProfile = { id: profileId, name: envName.trim() || `环境 ${envProfiles.length + 1}`, variables: [{ key, value: envValue }], createdAt: Date.now() }
      setEnvProfiles((profiles) => [profile, ...profiles])
      setSelectedEnvProfile(profileId)
    } else {
      setEnvProfiles((profiles) => profiles.map((profile) => profile.id === profileId ? { ...profile, name: envName.trim() || profile.name, variables: [...profile.variables.filter((variable) => variable.key !== key), { key, value: envValue }] } : profile))
    }
    setEnvKey('')
    setEnvValue('')
  }

  const exportWorkspace = async (): Promise<void> => {
    await island.exportTerminalWorkspace(workspaceCache)
  }

  const importWorkspace = async (): Promise<void> => {
    const result = await island.importTerminalWorkspace()
    if (!result.ok || !result.state) return
    workspaceCache = result.state
    historyStore.splice(0, historyStore.length, ...result.state.history)
    setHistory([...historyStore])
    setFavorites(result.state.favorites)
    setStartupTasks(result.state.startupTasks)
    setWorkspaceGroups(result.state.groups)
    setEnvProfiles(result.state.envProfiles)
    setWorkspaceSettings(result.state.settings)
    setRecovery(result.state.sessions.length ? result.state : null)
    setSelectedRecoverySessions(result.state.sessions.map((session) => session.id))
    if (!result.state.sessions.length) activateSavedSessions([], undefined)
  }

  const dropPaths = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragActive(false)
    const paths = Array.from(event.dataTransfer.files).map((file) => island.pathForFile(file)).filter(Boolean)
    if (!paths.length) return
    getSession(active).term.paste(paths.map(quotePowerShellLiteral).join(' '))
    getSession(active).term.focus()
  }

  const terminalHeight = full
    ? `calc(100vh - ${searchOpen ? 273 : 235}px)`
    : tall
      ? searchOpen ? 650 : 690
      : searchOpen ? 345 : 385

  if (recovery) {
    return <TerminalRecoveryCenter
      state={recovery}
      selectedSessions={selectedRecoverySessions}
      selectedTasks={selectedStartupTasks}
      onToggleSession={(id) => setSelectedRecoverySessions((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])}
      onToggleTask={(id) => setSelectedStartupTasks((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])}
      onAutoRestore={(on) => {
        const settings = { ...recovery.settings, restoreMode: on ? 'auto' as const : 'prompt' as const }
        const next = { ...recovery, settings }
        setRecovery(next)
        setWorkspaceSettings(settings)
        workspaceCache = next
        scheduleWorkspaceSave()
      }}
      onRestore={restoreWorkspace}
      onFresh={startFreshWorkspace}
    />
  }

  if (!workspaceReady || !activeTab) {
    return <div style={{ ...surface.panel(), minHeight: 360, borderRadius: R.panel, display: 'grid', placeItems: 'center', color: ink(2) }}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><RefreshCw size={15} className="spin" />正在读取终端开发现场…</span></div>
  }

  return (
    <div data-terminal-workspace style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: SP.sm }}>
      {/* 默认只保留会话切换和两个低频工具入口，让 PTY 成为首屏主体。 */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minHeight: 28 }}>
        <div className="noscrollbar" role="tablist" aria-label="PowerShell 会话" style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto' }}>
          {tabs.map((t) => {
            const sel = t.id === active
            return (
              <button
                 key={t.id}
                 data-terminal-session-id={t.id}
                type="button"
                role="tab"
                aria-selected={sel}
                onClick={() => setActive(t.id)}
                onDoubleClick={() => setRenaming(t.id)}
                className="hv"
                style={{ appearance: 'none', border: sel ? `0.5px solid ${accent(0.7, 0.35)}` : '0.5px solid transparent', flex: 'none', display: 'flex', alignItems: 'center', gap: 5, height: 27, padding: '0 8px', borderRadius: R.sm, cursor: 'pointer', transition: transition('background, border-color'), background: sel ? semBg(accent(), 0.16) : fill(1), color: sel ? ink(1) : ink(2), fontFamily: 'inherit' }}
              >
                <TerminalIcon size={11} strokeWidth={2} style={{ color: sel ? accent() : ink(3), flex: 'none' }} />
                {renaming === t.id ? (
                  <input autoFocus defaultValue={t.name} onClick={(e) => e.stopPropagation()} onBlur={(e) => { const v = e.target.value.trim(); setTabs((l) => l.map((x) => x.id === t.id ? { ...x, name: v || x.name } : x)); setRenaming(null) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} style={{ width: 78, background: 'rgba(0,0,0,.35)', border: `0.5px solid ${accent(0.7, 0.35)}`, borderRadius: 5, outline: 'none', color: ink(1), fontSize: 10.5, padding: '1px 5px', fontFamily: 'inherit' }} />
                ) : <span title={t.cwd ? `${t.cwd}\n双击重命名` : '双击重命名'} style={{ fontSize: 10.5, fontWeight: 650, whiteSpace: 'nowrap' }}>{t.name}</span>}
                {!!t.commandCount && <span title="本会话执行命令数" style={{ ...text.faint(), fontSize: 8.5, fontVariantNumeric: 'tabular-nums' }}>{t.commandCount}</span>}
                <X size={10} strokeWidth={2} className="hv" onClick={(e) => { e.stopPropagation(); closeTab(t.id) }} style={{ color: ink(3), cursor: 'pointer', flex: 'none' }} aria-label="关闭标签（结束该会话）" />
              </button>
            )
          })}
          <IconButton icon={Plus} onClick={addTab} title="新建终端标签（Ctrl+Shift+T）" size={27} style={{ flex: 'none' }} />
        </div>
        <IconButton icon={TerminalIcon} title="命令工具、历史与收藏" size={27} active={workspacePanel === 'tools'} onClick={() => setWorkspacePanel((value) => value === 'tools' ? null : 'tools')} />
        {liveAgents.length > 0 && <Button sm variant={workspacePanel === 'agents' ? 'tinted' : 'ghost'} icon={Bot} onClick={() => setWorkspacePanel((value) => value === 'agents' ? null : 'agents')} title="查看正在运行的 Agent">{liveAgents.length}</Button>}

        {workspacePanel && (
          <motion.div
            data-solid
            variants={overlayPop}
            initial="initial"
            animate="animate"
            style={{ position: 'absolute', top: 34, left: 0, right: 0, zIndex: 40, maxHeight: tall ? 480 : 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: SP.sm, padding: SP.md, borderRadius: R.lg, ...surface.overlay(), border: `0.5px solid ${hairline(0.12)}`, boxShadow: '0 18px 45px rgba(0,0,0,.5)' }}
            className="ai-scroll"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              {workspacePanel === 'tools' ? <TerminalIcon size={13} color={accent()} /> : <Bot size={13} color={sem.run} />}
              <span style={text.subtitle()}>{workspacePanel === 'tools' ? 'PowerShell 工具' : '活跃 Agent 会话'}</span>
              {workspacePanel === 'tools' && <span style={{ ...text.faint(), fontSize: 9 }}>{tabs.length} 会话 · {history.length} 命令 · {favorites.length} 收藏</span>}
              {workspacePanel === 'agents' && <Badge color={sem.run}>{liveAgents.length}</Badge>}
              <span style={{ flex: 1 }} />
              <IconButton icon={X} title="关闭面板" size={25} onClick={() => setWorkspacePanel(null)} />
            </div>

            {pendingCommand && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: R.md, background: semBg(sem.danger, 0.14), color: sem.danger }}>
              <ShieldAlert size={14} style={{ flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 10.5, fontWeight: 700 }}>该命令可能删除、覆盖或发布内容</div><div title={pendingCommand} style={{ ...text.mono(9), color: ink(2), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingCommand}</div></div>
              <Button sm onClick={() => setPendingCommand('')}>取消</Button>
              <Button sm variant="danger" onClick={() => { const command = pendingCommand; setPendingCommand(''); executeCommand(command) }}>确认运行</Button>
            </div>}

            {workspacePanel === 'tools' ? <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Input value={cwdDraft} onChange={setCwdDraft} onKeyDown={(e) => { if (e.key === 'Enter') changeDirectory() }} placeholder={activeTab?.cwd || '输入项目路径，例如 E:\\work\\repo'} icon={Folder} style={{ flex: 1, minWidth: 0 }} />
                <Button sm icon={CornerDownRight} onClick={changeDirectory} disabled={!cwdDraft.trim()} title="切换 PowerShell 当前目录">切换</Button>
                <IconButton icon={FolderOpen} onClick={() => { void chooseDirectory() }} title="选择并切换 PowerShell 工作目录" size={28} />
              </div>
              <div className="noscrollbar" style={{ overflowX: 'auto' }}>
                <Segmented options={[
                  { key: 'commands' as const, label: '命令', icon: TerminalIcon },
                  { key: 'history' as const, label: `历史 ${history.length}`, icon: History },
                  { key: 'favorites' as const, label: `收藏 ${favorites.length}`, icon: Star },
                  { key: 'workspaces' as const, label: '工作区', icon: FolderOpen },
                  { key: 'tasks' as const, label: '项目任务', icon: ListChecks },
                  { key: 'output' as const, label: '输出摘要', icon: Clipboard },
                  { key: 'ai' as const, label: 'AI', icon: Sparkles },
                  { key: 'settings' as const, label: '恢复与隐私', icon: Settings2 }
                ]} value={toolView} onChange={setToolView} />
              </div>

              {toolView === 'commands' && <>
                <Segmented options={(['项目', 'Git', 'Node', '系统'] as TerminalCommandGroup[]).map((group) => ({ key: group, label: group }))} value={commandGroup} onChange={setCommandGroup} />
                <div className="noscrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>{groupCommands.map((preset) => <Chip key={preset.id} icon={Play} onClick={() => runCommand(preset.command)} title={`${preset.description}\n${preset.command}`} style={{ flex: 'none' }}>{preset.label}</Chip>)}</div>
              </>}

              {toolView === 'history' && <>
                <Input value={historyQuery} onChange={setHistoryQuery} icon={Search} placeholder="按命令、目录或会话检索历史" />
                <div className="ai-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
                  {filteredHistory.length === 0 && <span style={text.faint()}>没有匹配的命令记录</span>}
                  {filteredHistory.slice(0, 80).map((entry) => <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 30, padding: '3px 7px', borderRadius: R.sm, background: fill(1) }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: entry.exitCode === undefined ? ink(3) : entry.exitCode === 0 ? sem.calm : sem.danger, flex: 'none' }} />
                    <span onClick={() => runCommand(entry.command)} title={`${entry.cwd || entry.sessionName}\n${entry.command}`} style={{ flex: 1, minWidth: 0, ...text.mono(10), color: ink(1), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{entry.command}</span>
                    {entry.durationMs !== undefined && <span style={{ ...text.faint(), fontSize: 9 }}>{entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`}</span>}
                    <IconButton icon={Star} size={23} active={favorites.includes(entry.command)} color={sem.warn} onClick={() => toggleFavorite(entry.command)} title="收藏命令" />
                  </div>)}
                </div>
              </>}

              {toolView === 'favorites' && <div className="ai-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                {favorites.length === 0 && <span style={text.faint()}>从命令历史或输入框收藏常用命令</span>}
                {favorites.map((command) => <div key={command} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: R.sm, background: fill(1) }}><span style={{ flex: 1, minWidth: 0, ...text.mono(10), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{command}</span><Button sm icon={Play} onClick={() => runCommand(command)}>运行</Button><IconButton icon={ListChecks} size={24} onClick={() => addStartupTask(command)} title="设为启动任务" /><IconButton icon={Star} size={24} color={sem.warn} onClick={() => toggleFavorite(command)} title="取消收藏" /></div>)}
              </div>}

              {toolView === 'workspaces' && <div className="ai-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {workspaceGroups.length === 0 && <span style={text.faint()}>切换过的项目目录会自动形成工作区</span>}
                {[...workspaceGroups].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.lastOpenedAt - a.lastOpenedAt).map((group) => <div key={group.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: R.sm, background: fill(1) }}>
                  <Folder size={12} color={group.pinned ? sem.warn : accent()} />
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...text.dim(), color: ink(1) }}>{group.name}</div><div title={group.cwd} style={{ ...text.mono(9), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.cwd}</div></div>
                  <IconButton icon={Pin} active={group.pinned} color={sem.warn} size={24} onClick={() => setWorkspaceGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, pinned: !item.pinned } : item))} title="固定工作区" />
                  <Button sm icon={RotateCcw} onClick={() => openWorkspace(group.cwd, group.name)}>打开</Button>
                </div>)}
              </div>}

              {toolView === 'tasks' && <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Button sm icon={RefreshCw} onClick={() => { void inspectProject() }} disabled={!activeTab?.cwd || inspectionBusy}>{inspectionBusy ? '扫描中' : '扫描项目任务'}</Button><span style={text.faint()}>{inspection?.ok ? `${inspection.kind.join(' / ')} · ${inspection.tasks.length} 个任务` : inspection?.error || '读取 package、VS Code、Make、Python、Rust 与 .NET 入口'}</span></div>
                {inspection?.ok && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{inspection.checks.map((check) => <Chip key={check.label} color={check.status === 'ok' ? sem.calm : check.status === 'warn' ? sem.warn : accent()} title={check.detail}>{check.label}</Chip>)}</div>}
                <div className="ai-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 145, overflowY: 'auto' }}>
                  {inspection?.tasks.map((task) => <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px', borderRadius: R.sm, background: fill(1) }}><span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 10.5 }}>{task.label}</b><span style={{ marginLeft: 7, ...text.mono(9) }}>{task.command}</span></span><IconButton icon={Plus} size={24} onClick={() => addStartupTask(task.command, task.label)} title="加入启动任务" /><Button sm icon={Play} onClick={() => runCommand(task.command)}>运行</Button></div>)}
                  {startupTasks.map((task) => <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 7px', borderRadius: R.sm, background: semBg(accent(), 0.08) }}><Switch on={task.enabled} onChange={(on) => setStartupTasks((tasks) => tasks.map((item) => item.id === task.id ? { ...item, enabled: on } : item))} /><span title={task.command} style={{ flex: 1, minWidth: 0, ...text.dim(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>启动：{task.label}</span><IconButton icon={Trash2} color={sem.danger} size={23} onClick={() => setStartupTasks((tasks) => tasks.filter((item) => item.id !== task.id))} title="删除启动任务" /></div>)}
                </div>
              </>}

              {toolView === 'output' && <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Badge color={sem.calm}>{outputSummary.originalLines} → {outputSummary.visibleLines} 行</Badge><span style={text.faint()}>连续重复行与多余空行已折叠；原始终端内容不变</span><span style={{ flex: 1 }} /><Button sm icon={Clipboard} onClick={() => island.clipWriteText(outputSummary.text)} disabled={!outputSummary.text}>复制摘要</Button></div>
                <pre className="ai-scroll" style={{ margin: 0, minHeight: 100, maxHeight: 190, overflow: 'auto', padding: 9, borderRadius: R.md, background: fill(1), color: ink(1), fontFamily: MONO, fontSize: 9.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{outputSummary.text || '当前会话还没有可摘要的输出'}</pre>
              </>}

              {toolView === 'ai' && <>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Button sm variant={aiMode === 'diagnose' ? 'tinted' : 'ghost'} icon={Gauge} onClick={() => { void runAi('diagnose') }} disabled={aiBusy}>诊断当前现场</Button><Button sm variant={aiMode === 'handoff' ? 'tinted' : 'ghost'} icon={Clipboard} onClick={() => { void runAi('handoff') }} disabled={aiBusy}>生成交接摘要</Button><Button sm variant={aiMode === 'next' ? 'tinted' : 'ghost'} icon={Wand2} onClick={() => { void runAi('next') }} disabled={aiBusy}>规划下一步</Button></div>
                <div className="ai-scroll" style={{ minHeight: 95, maxHeight: 180, overflowY: 'auto', padding: 9, borderRadius: R.md, background: fill(1), ...text.dim(), color: aiResult ? ink(1) : ink(3), whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{aiBusy ? '正在基于当前目录、最近命令和输出分析…' : aiResult || 'AI 只读取当前会话上下文，不会自动执行建议命令。'}</div>
                {aiResult && <div style={{ display: 'flex', gap: 6 }}><Button sm icon={Clipboard} onClick={() => island.clipWriteText(aiResult)}>复制结果</Button>{aiMode === 'handoff' && <Button sm icon={CheckCircle2} onClick={() => setTabs((list) => list.map((tab) => tab.id === active ? { ...tab, handoff: aiResult } : tab))}>保存到会话</Button>}</div>}
              </>}

              {toolView === 'settings' && <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 100, ...text.dim() }}>启动恢复</span><Segmented options={[{ key: 'prompt' as const, label: '询问' }, { key: 'auto' as const, label: '自动' }, { key: 'fresh' as const, label: '空白' }]} value={workspaceSettings.restoreMode} onChange={(restoreMode) => setWorkspaceSettings((value) => ({ ...value, restoreMode }))} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 100, ...text.dim() }}>新会话 Shell</span><Segmented options={[{ key: 'powershell' as const, label: 'Windows PS' }, { key: 'pwsh' as const, label: 'PS 7' }, { key: 'cmd' as const, label: 'CMD' }, { key: 'wsl' as const, label: 'WSL' }]} value={shellProfile} onChange={setShellProfile} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 100, ...text.dim() }}>加密环境</span><Input value={envName} onChange={setEnvName} placeholder="配置名称" style={{ width: 130 }} /><Input value={envKey} onChange={setEnvKey} placeholder="变量名" style={{ width: 120 }} /><Input type="password" value={envValue} onChange={setEnvValue} placeholder="变量值" style={{ flex: 1 }} /><Button sm icon={Plus} onClick={addEnvironmentVariable} disabled={!envKey.trim() || !envValue}>添加</Button></div>
                {envProfiles.length > 0 && <div className="noscrollbar" style={{ display: 'flex', gap: 5, overflowX: 'auto' }}><Chip active={!selectedEnvProfile} onClick={() => setSelectedEnvProfile('')}>不注入</Chip>{envProfiles.map((profile) => <Chip key={profile.id} active={selectedEnvProfile === profile.id} onClick={() => { setSelectedEnvProfile(profile.id); setEnvName(profile.name) }} title={`${profile.variables.map((item) => item.key).join(', ')}\n由应用安全存储；系统支持时使用 Windows DPAPI`}>{profile.name} · {profile.variables.length}</Chip>)}</div>}
                {selectedEnvProfile && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{envProfiles.find((profile) => profile.id === selectedEnvProfile)?.variables.map((variable) => <Chip key={variable.key} onClick={() => setEnvProfiles((profiles) => profiles.map((profile) => profile.id === selectedEnvProfile ? { ...profile, variables: profile.variables.filter((item) => item.key !== variable.key) } : profile))} title="点击移除此变量">{variable.key}=••••</Chip>)}<IconButton icon={Trash2} color={sem.danger} size={24} onClick={() => { setEnvProfiles((profiles) => profiles.filter((profile) => profile.id !== selectedEnvProfile)); setSelectedEnvProfile('') }} title="删除当前环境配置" /></div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Switch on={workspaceSettings.captureOutput} onChange={(captureOutput) => setWorkspaceSettings((value) => ({ ...value, captureOutput }))} /><span style={{ ...text.dim(), color: ink(1) }}>保存输出快照</span><span style={text.faint()}>默认关闭；开启后随终端现场加密保存</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Switch disabled={!workspaceSettings.captureOutput} on={workspaceSettings.redactOutput} onChange={(redactOutput) => setWorkspaceSettings((value) => ({ ...value, redactOutput }))} /><span style={{ ...text.dim(), color: ink(1) }}>自动脱敏</span><span style={text.faint()}>过滤常见 token、API Key、密码与 URL 密钥参数</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 55px', alignItems: 'center', gap: 8 }}><span style={text.dim()}>快照保留</span><Slider min={1} max={30} value={workspaceSettings.retentionDays} onChange={(retentionDays) => setWorkspaceSettings((value) => ({ ...value, retentionDays }))} /><span style={{ ...text.num(10), textAlign: 'right' }}>{workspaceSettings.retentionDays} 天</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 55px', alignItems: 'center', gap: 8 }}><span style={text.dim()}>单会话上限</span><Slider min={5000} max={100000} step={5000} value={workspaceSettings.maxSnapshotChars} onChange={(maxSnapshotChars) => setWorkspaceSettings((value) => ({ ...value, maxSnapshotChars }))} /><span style={{ ...text.num(10), textAlign: 'right' }}>{Math.round(workspaceSettings.maxSnapshotChars / 1000)}k 字</span></div>
                <div style={{ display: 'flex', gap: 6 }}><Button sm icon={ArrowDownToLine} onClick={() => { void exportWorkspace() }} title="导出标签、目录、历史与任务；自动排除输出内容和环境变量值">导出工作区</Button><Button sm icon={FolderOpen} onClick={() => { void importWorkspace() }}>导入工作区</Button><span style={{ flex: 1 }} /><Button sm variant="danger" icon={Trash2} onClick={() => { void clearSnapshots() }}>清除全部输出快照</Button></div>
              </>}

              {toolView !== 'settings' && toolView !== 'ai' && <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 1, flex: 'none', color: sem.calm, fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>PS<ChevronRight size={12} strokeWidth={2.5} /></span>
                <Input value={commandDraft} onChange={setCommandDraft} onKeyDown={(e) => { if (e.key === 'Enter') { runCommand(commandDraft); setCommandDraft('') } }} placeholder="输入 PowerShell 命令，Enter 执行" style={{ flex: 1, minWidth: 0 }} />
                <IconButton icon={Star} onClick={() => toggleFavorite(commandDraft)} disabled={!commandDraft.trim()} title="收藏当前命令" size={28} active={favorites.includes(commandDraft.trim())} color={favorites.includes(commandDraft.trim()) ? sem.warn : undefined} />
                <Button sm variant="primary" icon={Play} onClick={() => { runCommand(commandDraft); setCommandDraft('') }} disabled={!commandDraft.trim()}>运行</Button>
              </div>}
            </> : (
              <div className="ai-scroll" style={{ display: 'grid', gridTemplateColumns: liveAgents.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 7, maxHeight: tall ? 260 : 185, overflowY: 'auto' }}>
                {liveAgents.map((agent) => <AgentCard key={agent.id} a={agent} now={now} />)}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {!ptyOk && <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: R.sm, background: semBg(sem.danger, 0.14), color: sem.danger, fontSize: FS.small, fontWeight: 600 }}><ShieldAlert size={13} strokeWidth={2} />PTY 原生模块加载失败，请重新安装依赖后重启。</div>}

      {/* xterm 宿主：默认占据绝大多数可用高度。 */}
      <div data-terminal-frame onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false) }} onDrop={dropPaths} style={{ position: 'relative', borderRadius: R.lg, overflow: 'hidden', border: `0.5px solid ${accent(0.6, 0.22)}`, background: 'radial-gradient(120% 100% at 50% 0%, oklch(0.22 0.03 var(--th) / .5), rgba(0,0,0,.6) 60%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05), 0 6px 22px rgba(0,0,0,.28)', ...({ '--ink-l': '.96', '--line-l': '.96', '--fill-l': '.96', '--accent1-l-shift': '0', '--accent2-l-shift': '0', '--on-primary-l': '.16' } as React.CSSProperties) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '4px 8px 4px 10px', borderBottom: `0.5px solid ${hairline(0.07)}`, background: fill(1) }}>
          <span style={{ display: 'flex', gap: 5 }}>{['#ff5f57', '#febc2e', '#28c840'].map((color) => <span key={color} style={{ width: 9, height: 9, borderRadius: 999, background: color }} />)}</span>
          <TerminalIcon size={11} strokeWidth={2} style={{ marginLeft: 4, color: sem.calm, flex: 'none' }} />
          <span style={{ color: ink(2), fontSize: 10, fontFamily: MONO, fontWeight: 650, whiteSpace: 'nowrap' }}>{activeTab?.name}</span>
          <span title={activeTab?.cwd || '当前目录由 PowerShell 会话维护'} style={{ minWidth: 0, maxWidth: tall ? 420 : 190, ...text.mono(9), color: ink(3), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTab?.cwd || 'PowerShell'}</span>
          {gitInfo?.ok && <span title={`Git 分支${gitInfo.dirty ? ` · ${gitInfo.dirty} 项未提交` : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: R.pill, background: gitInfo.dirty ? semBg(sem.warn, 0.13) : semBg(sem.calm, 0.12), color: gitInfo.dirty ? sem.warn : sem.calm, fontFamily: MONO, fontSize: 8.5 }}><span>{gitInfo.branch}</span>{!!gitInfo.dirty && <b>±{gitInfo.dirty}</b>}{!!gitInfo.ahead && <span>↑{gitInfo.ahead}</span>}{!!gitInfo.behind && <span>↓{gitInfo.behind}</span>}</span>}
          <span style={{ flex: 1 }} />
          <IconButton icon={Square} color={sem.danger} onClick={() => island.ptyInput(active, '\x03')} title="中断当前命令（Ctrl+C）" size={25} />
          <IconButton icon={Search} active={searchOpen} onClick={() => setSearchOpen((value) => !value)} title="搜索终端输出（Ctrl+Shift+F）" size={25} />
          <IconButton icon={Eraser} onClick={() => getSession(active).term.clear()} title="清屏（保留会话）" size={25} />
          <IconButton icon={ArrowDownToLine} onClick={() => getSession(active).term.scrollToBottom()} title="滚动到底部" size={25} />
        </div>
        {searchOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: `0.5px solid ${hairline(0.06)}`, background: 'rgba(0,0,0,.22)' }}>
            <Search size={12} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />
            <input autoFocus value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setSearchStatus('') }} onKeyDown={(e) => { if (e.key === 'Enter') findInTerminal(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setSearchOpen(false) }} placeholder="搜索当前终端缓冲区" style={{ flex: 1, minWidth: 0, height: 26, borderRadius: R.sm, border: `0.5px solid ${hairline(0.1)}`, background: 'rgba(0,0,0,.3)', color: ink(1), outline: 'none', padding: '0 8px', fontSize: 10, fontFamily: MONO }} />
            <span style={{ minWidth: 45, ...text.faint(), fontSize: 9 }}>{searchStatus}</span>
            <IconButton icon={ChevronUp} size={24} onClick={() => findInTerminal(-1)} title="上一个" />
            <IconButton icon={ChevronDown} size={24} onClick={() => findInTerminal(1)} title="下一个" />
            <IconButton icon={X} size={24} onClick={() => { getSession(active).term.clearSelection(); setSearchOpen(false) }} title="关闭搜索" />
          </div>
        )}
        <div ref={hostRef} data-terminal-host data-terminal-session-id={active} style={{ height: terminalHeight, minHeight: 250, padding: '8px 4px 8px 10px', boxSizing: 'border-box', overflow: 'hidden' }} />
        {dragActive && <div style={{ position: 'absolute', inset: 0, zIndex: 25, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.72)', color: accent(), pointerEvents: 'none' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: R.md, background: semBg(accent(), 0.18), fontWeight: 700 }}><FolderOpen size={17} />松开后把本地路径安全粘贴到终端</div></div>}
        {/* 底部状态栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 11px', borderTop: `0.5px solid ${hairline(0.06)}`, background: `linear-gradient(180deg, ${semBg(sem.run, 0.1)}, rgba(0,0,0,.3))`, fontFamily: MONO, fontSize: 9, color: ink(3) }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: ptyOk ? sem.run : sem.danger }}><span style={{ width: 5, height: 5, borderRadius: 999, background: ptyOk ? sem.run : sem.danger, boxShadow: ptyOk ? `0 0 5px ${sem.run}` : undefined }} />{ptyOk ? 'ConPTY 已连接' : 'PTY 未就绪'}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{dims.cols}×{dims.rows}</span>
          <span>UTF-8</span>
          <span>{tabs.length} 会话 · {history.length} 命令</span>
          {activeTab.lastExitCode !== undefined && <span style={{ color: activeTab.lastExitCode === 0 ? sem.calm : sem.danger }}>exit {activeTab.lastExitCode}</span>}
          {activeTab.lastDurationMs !== undefined && <span>{activeTab.lastDurationMs < 1000 ? `${activeTab.lastDurationMs}ms` : `${(activeTab.lastDurationMs / 1000).toFixed(1)}s`}</span>}
          {activeTab.envProfileId && <span title="该会话启动时已注入加密环境配置">ENV · {envProfiles.find((profile) => profile.id === activeTab.envProfileId)?.name || '已配置'}</span>}
          {linkedAgents.length > 0 && <span style={{ color: sem.focus }}>关联 Agent {linkedAgents.length}</span>}
          <span style={{ flex: 1 }} />
          <span style={{ opacity: 0.75 }}>UTF-8 · 8000 行回滚</span>
        </div>
      </div>
    </div>
  )
}
