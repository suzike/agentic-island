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
  ArrowDownToLine, Bot, Brain, ChevronDown, ChevronRight, ChevronUp, Clock,
  CornerDownRight, Eraser, Folder, FolderOpen, History, Package, Play, Plus,
  Search, ShieldAlert, Square, Star, Terminal as TerminalIcon, Ticket, X
} from 'lucide-react'
import type { AgentVM } from '../types'
import { island } from '../bridge'
import { consumeTerminalInput, extractPowerShellCwd, setLocationCommand, TERMINAL_COMMANDS, updateTerminalCwd, type TerminalCommandGroup, type TerminalHistoryEntry } from '../logic/terminal'
import { Badge, Button, Chip, IconButton, Input, Segmented } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text, transition } from '../ui/tokens'

interface TermTab {
  id: string
  name: string
  cwd?: string
  commandCount?: number
  lastCommand?: string
  createdAt?: number
}

interface Session {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

// 模块级：xterm 实例/DOM/标签列表 常驻，组件卸载（切分区）不销毁
const sessions = new Map<string, Session>()
const persisted = { tabs: [{ id: 't1', name: 'PowerShell 1', createdAt: Date.now() }] as TermTab[], active: 't1' }
const inputBuffers = new Map<string, string>()
const historyStore: TerminalHistoryEntry[] = []
let commandObserver: ((id: string, command: string) => void) | null = null
let cwdObserver: ((id: string, cwd: string) => void) | null = null
const outputTails = new Map<string, string>()
const observedCwds = new Map<string, string>()
let subscribed = false

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
  term.onData((data) => {
    const next = consumeTerminalInput(inputBuffers.get(id) || '', data)
    inputBuffers.set(id, next.buffer)
    if (next.submitted) commandObserver?.(id, next.submitted)
    island.ptyInput(id, data)
  })
  term.onResize(({ cols, rows }) => island.ptyResize(id, cols, rows))

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
    const tail = ((outputTails.get(id) || '') + data).slice(-1200)
    outputTails.set(id, tail)
    const cwd = extractPowerShellCwd(tail)
    if (cwd && observedCwds.get(id) !== cwd) {
      observedCwds.set(id, cwd)
      cwdObserver?.(id, cwd)
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

export function TerminalTab({ tall, full, agents }: { tall: boolean; full?: boolean; agents: AgentVM[] }): React.JSX.Element {
  const [tabs, setTabs] = useState<TermTab[]>(persisted.tabs)
  const [active, setActive] = useState(persisted.active)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ptyOk, setPtyOk] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [workspacePanel, setWorkspacePanel] = useState<'tools' | 'agents' | null>(null)
  const [dims, setDims] = useState({ cols: 0, rows: 0 })
  const [commandGroup, setCommandGroup] = useState<TerminalCommandGroup>('项目')
  const [commandDraft, setCommandDraft] = useState('')
  const [cwdDraft, setCwdDraft] = useState('')
  const [toolView, setToolView] = useState<'commands' | 'history' | 'favorites'>('commands')
  const [history, setHistory] = useState<TerminalHistoryEntry[]>(historyStore)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('aiisland-terminal-favorites') || '[]') as unknown
      return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, 30) : []
    } catch { return [] }
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState('')
  const hostRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  useEffect(() => { persisted.tabs = tabs; persisted.active = active }, [tabs, active])
  const liveAgents = agents.filter((a) => a.status !== 'done')
  const activeTab = tabs.find((t) => t.id === active) || tabs[0]
  const groupCommands = useMemo(() => TERMINAL_COMMANDS.filter((x) => x.group === commandGroup), [commandGroup])

  const recordCommand = useCallback((sessionId: string, command: string): void => {
    const clean = command.trim()
    if (!clean) return
    const current = tabsRef.current.find((tab) => tab.id === sessionId)
    const sessionName = current?.name || sessionId
    const cwd = current?.cwd
    setTabs((list) => list.map((tab) => {
      if (tab.id !== sessionId) return tab
      return { ...tab, commandCount: (tab.commandCount || 0) + 1, lastCommand: clean }
    }))
    const entry: TerminalHistoryEntry = { id: Date.now() * 100 + historyStore.length % 100, sessionId, sessionName, command: clean, cwd, ts: Date.now() }
    historyStore.unshift(entry)
    if (historyStore.length > 120) historyStore.length = 120
    setHistory([...historyStore])
  }, [])

  useEffect(() => {
    commandObserver = recordCommand
    cwdObserver = (id, cwd) => setTabs((list) => updateTerminalCwd(list, id, cwd))
    return () => {
      if (commandObserver === recordCommand) commandObserver = null
      cwdObserver = null
    }
  }, [recordCommand])

  const runCommand = useCallback((command: string): void => {
    const clean = command.trim()
    if (!clean) return
    recordCommand(active, clean)
    inputBuffers.set(active, '')
    island.ptyInput(active, clean + '\r')
    getSession(active).term.focus()
    setWorkspacePanel(null)
  }, [active, recordCommand])

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
      try { localStorage.setItem('aiisland-terminal-favorites', JSON.stringify(next)) } catch { /* 收藏仍保留在当前运行 */ }
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
          void island.ptyEnsure(active, cols, rows).then((ok) => setPtyOk(ok))
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
  }, [active, tall, full, searchOpen])

  const addTab = (): void => {
    const id = 't' + Date.now()
    setTabs((l) => [...l, { id, name: `PowerShell ${l.length + 1}`, cwd: activeTab?.cwd, createdAt: Date.now() }])
    setActive(id)
  }
  const closeTab = (id: string): void => {
    island.ptyKill(id)
    const s = sessions.get(id)
    if (s) { s.term.dispose(); sessions.delete(id) }
    inputBuffers.delete(id)
    outputTails.delete(id)
    observedCwds.delete(id)
    const remaining = tabs.filter((t) => t.id !== id)
    const next = remaining.length ? remaining : [{ id: 't' + Date.now(), name: 'PowerShell 1', createdAt: Date.now() }]
    setTabs(next)
    if (active === id) setActive(next[0].id)
  }

  const terminalHeight = full
    ? `calc(100vh - ${searchOpen ? 273 : 235}px)`
    : tall
      ? searchOpen ? 650 : 690
      : searchOpen ? 345 : 385

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
            style={{ position: 'absolute', top: 34, left: 0, right: 0, zIndex: 40, maxHeight: tall ? 330 : 245, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: SP.sm, padding: SP.md, borderRadius: R.lg, ...surface.overlay(), border: `0.5px solid ${hairline(0.12)}`, boxShadow: '0 18px 45px rgba(0,0,0,.5)' }}
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

            {workspacePanel === 'tools' ? <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Input value={cwdDraft} onChange={setCwdDraft} onKeyDown={(e) => { if (e.key === 'Enter') changeDirectory() }} placeholder={activeTab?.cwd || '输入项目路径，例如 E:\\work\\repo'} icon={Folder} style={{ flex: 1, minWidth: 0 }} />
                <Button sm icon={CornerDownRight} onClick={changeDirectory} disabled={!cwdDraft.trim()} title="切换 PowerShell 当前目录">切换</Button>
                <IconButton icon={FolderOpen} onClick={() => { void chooseDirectory() }} title="选择并切换 PowerShell 工作目录" size={28} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Segmented options={[{ key: 'commands' as const, label: '命令', icon: TerminalIcon }, { key: 'history' as const, label: `历史 ${history.length}`, icon: History }, { key: 'favorites' as const, label: `收藏 ${favorites.length}`, icon: Star }]} value={toolView} onChange={setToolView} />
                {toolView === 'commands' && <Segmented options={(['项目', 'Git', 'Node', '系统'] as TerminalCommandGroup[]).map((group) => ({ key: group, label: group }))} value={commandGroup} onChange={setCommandGroup} />}
              </div>
              {toolView === 'commands' && <div className="noscrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>{groupCommands.map((preset) => <Chip key={preset.id} icon={Play} onClick={() => runCommand(preset.command)} title={`${preset.description}\n${preset.command}`} style={{ flex: 'none' }}>{preset.label}</Chip>)}</div>}
              {toolView === 'history' && <div className="noscrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                {history.length === 0 && <span style={text.faint()}>本次运行还没有命令记录</span>}
                {history.slice(0, 16).map((entry) => <div key={entry.id} style={{ flex: 'none', maxWidth: 260, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: R.md, background: fill(1) }}><span className="hv" onClick={() => runCommand(entry.command)} title={`${entry.sessionName} · ${new Date(entry.ts).toLocaleTimeString()}\n${entry.command}`} style={{ maxWidth: 190, ...text.mono(10), color: ink(1), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{entry.command}</span><Star size={11} strokeWidth={2} className="hv" onClick={() => toggleFavorite(entry.command)} style={{ color: favorites.includes(entry.command) ? sem.warn : ink(3), fill: favorites.includes(entry.command) ? sem.warn : 'none', cursor: 'pointer', flex: 'none' }} aria-label="收藏命令" /></div>)}
              </div>}
              {toolView === 'favorites' && <div className="noscrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                {favorites.length === 0 && <span style={text.faint()}>收藏的命令会显示在这里</span>}
                {favorites.map((command) => <div key={command} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5 }}><Chip icon={Play} onClick={() => runCommand(command)} title={command} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{command}</Chip><IconButton icon={Star} size={24} color={sem.warn} onClick={() => toggleFavorite(command)} title="取消收藏" /></div>)}
              </div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 1, flex: 'none', color: sem.calm, fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>PS<ChevronRight size={12} strokeWidth={2.5} /></span>
                <Input value={commandDraft} onChange={setCommandDraft} onKeyDown={(e) => { if (e.key === 'Enter') { runCommand(commandDraft); setCommandDraft('') } }} placeholder="输入 PowerShell 命令，Enter 执行" style={{ flex: 1, minWidth: 0 }} />
                <IconButton icon={Star} onClick={() => toggleFavorite(commandDraft)} disabled={!commandDraft.trim()} title="收藏当前命令" size={28} active={favorites.includes(commandDraft.trim())} color={favorites.includes(commandDraft.trim()) ? sem.warn : undefined} />
                <Button sm variant="primary" icon={Play} onClick={() => { runCommand(commandDraft); setCommandDraft('') }} disabled={!commandDraft.trim()}>运行</Button>
              </div>
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
      <div data-terminal-frame style={{ borderRadius: R.lg, overflow: 'hidden', border: `0.5px solid ${accent(0.6, 0.22)}`, background: 'radial-gradient(120% 100% at 50% 0%, oklch(0.22 0.03 var(--th) / .5), rgba(0,0,0,.6) 60%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05), 0 6px 22px rgba(0,0,0,.28)', ...({ '--ink-l': '.96', '--line-l': '.96', '--fill-l': '.96', '--accent1-l-shift': '0', '--accent2-l-shift': '0', '--on-primary-l': '.16' } as React.CSSProperties) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '4px 8px 4px 10px', borderBottom: `0.5px solid ${hairline(0.07)}`, background: fill(1) }}>
          <span style={{ display: 'flex', gap: 5 }}>{['#ff5f57', '#febc2e', '#28c840'].map((color) => <span key={color} style={{ width: 9, height: 9, borderRadius: 999, background: color }} />)}</span>
          <TerminalIcon size={11} strokeWidth={2} style={{ marginLeft: 4, color: sem.calm, flex: 'none' }} />
          <span style={{ color: ink(2), fontSize: 10, fontFamily: MONO, fontWeight: 650, whiteSpace: 'nowrap' }}>{activeTab?.name}</span>
          <span title={activeTab?.cwd || '当前目录由 PowerShell 会话维护'} style={{ minWidth: 0, maxWidth: tall ? 420 : 190, ...text.mono(9), color: ink(3), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTab?.cwd || 'PowerShell'}</span>
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
        <div ref={hostRef} data-terminal-host style={{ height: terminalHeight, minHeight: 250, padding: '8px 4px 8px 10px', boxSizing: 'border-box', overflow: 'hidden' }} />
        {/* 底部状态栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 11px', borderTop: `0.5px solid ${hairline(0.06)}`, background: `linear-gradient(180deg, ${semBg(sem.run, 0.1)}, rgba(0,0,0,.3))`, fontFamily: MONO, fontSize: 9, color: ink(3) }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: ptyOk ? sem.run : sem.danger }}><span style={{ width: 5, height: 5, borderRadius: 999, background: ptyOk ? sem.run : sem.danger, boxShadow: ptyOk ? `0 0 5px ${sem.run}` : undefined }} />{ptyOk ? 'ConPTY 已连接' : 'PTY 未就绪'}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{dims.cols}×{dims.rows}</span>
          <span>UTF-8</span>
          <span>{tabs.length} 会话 · {history.length} 命令</span>
          <span style={{ flex: 1 }} />
          <span style={{ opacity: 0.75 }}>UTF-8 · 8000 行回滚</span>
        </div>
      </div>
    </div>
  )
}
