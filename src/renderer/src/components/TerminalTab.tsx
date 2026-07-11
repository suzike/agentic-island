// 真 PTY 终端（xterm.js + ConPTY PowerShell）：与本地 Windows 终端同源——
// vim/top 等 TUI、Claude Code/Codex 等交互式 CLI、颜色/光标/快捷键全部原生支持。
// 多标签：＋新增 / ✕关闭（杀进程）/ 双击改名；xterm 实例与 DOM 常驻模块级，切分区不丢。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AgentVM } from '../types'
import { island } from '../bridge'
import { consumeTerminalInput, extractPowerShellCwd, setLocationCommand, TERMINAL_COMMANDS, type TerminalCommandGroup, type TerminalHistoryEntry } from '../logic/terminal'

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
    if (cwd) cwdObserver?.(id, cwd)
  })
}

// 状态 → 颜色/文案
const STATUS: Record<string, { label: string; hue: number }> = {
  running: { label: '运行中', hue: 150 }, needs_approval: { label: '待审批', hue: 75 },
  waiting: { label: '等待回复', hue: 200 }, done: { label: '已结束', hue: 0 }
}
const fmtElapsed = (start: number, now: number): string => {
  const s = Math.max(0, Math.floor((now - start) / 1000))
  if (s < 60) return `${s} 秒`
  if (s < 3600) return `${Math.floor(s / 60)} 分`
  return `${Math.floor(s / 3600)} 时 ${Math.floor((s % 3600) / 60)} 分`
}
const fmtTok = (n?: number): string => (n === undefined ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const terminalButton: React.CSSProperties = {
  height: 27, padding: '0 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,.07)',
  background: 'rgba(255,255,255,.045)', color: 'oklch(0.76 0.03 var(--th))', cursor: 'pointer',
  fontFamily: 'var(--font)', fontSize: 9.5, fontWeight: 650, whiteSpace: 'nowrap'
}
const terminalSegment = (active: boolean): React.CSSProperties => ({
  height: 24, padding: '0 8px', borderRadius: 6, border: `1px solid ${active ? 'oklch(0.68 0.11 150 / .38)' : 'transparent'}`,
  background: active ? 'oklch(0.38 0.08 150 / .32)' : 'transparent', color: active ? 'oklch(0.86 0.1 150)' : 'oklch(0.64 0.02 var(--th) / .65)',
  cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 9.5, fontWeight: active ? 700 : 550
})

// Coding Agent 会话卡：模型 / 状态 / 运行时长 / token 用量 / 上下文 / 活动轨迹 / 变更小结
function AgentCard({ a, now }: { a: AgentVM; now: number }): React.JSX.Element {
  const st = STATUS[a.status] || STATUS.running
  const isCodex = a.backend === 'codex'
  const ctxPct = a.contextTokens ? Math.min(100, (a.contextTokens / 200000) * 100) : 0
  return (
    <div style={{ padding: '10px 12px', borderRadius: 13, background: `linear-gradient(160deg, oklch(0.3 0.05 ${st.hue || 250} / .28), oklch(0.19 0.03 var(--th) / .5))`, border: `1px solid oklch(0.6 0.1 ${st.hue || 250} / .3)`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 头 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ width: 22, height: 22, flex: 'none', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, background: isCodex ? 'oklch(0.4 0.02 var(--th) / .5)' : 'oklch(0.5 0.13 30 / .4)', color: isCodex ? 'oklch(0.85 0.02 var(--th))' : 'oklch(0.85 0.13 30)' }}>{isCodex ? '⬡' : '◆'}</span>
        <span style={{ color: 'oklch(0.94 0.02 var(--th))', fontSize: 12, fontWeight: 700 }}>{a.tool}</span>
        {a.model && <span style={{ padding: '1px 7px', borderRadius: 999, background: 'oklch(0.4 0.08 260 / .4)', color: 'oklch(0.85 0.11 260)', fontSize: 9, fontWeight: 600, fontFamily: 'ui-monospace,monospace' }}>{a.model}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: `oklch(0.4 0.1 ${st.hue} / .4)`, color: `oklch(0.86 0.13 ${st.hue})`, fontSize: 9.5, fontWeight: 700 }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: `oklch(0.8 0.14 ${st.hue})`, animation: a.status === 'done' ? undefined : 'ai-dotpulse 1.6s ease-in-out infinite' }} />{st.label}
        </span>
      </div>
      {/* 指标 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { l: '📁 项目', v: a.proj },
          { l: '⏱ 运行', v: a.startedAt ? fmtElapsed(a.startedAt, now) : '—' },
          { l: '🎟 Token', v: fmtTok(a.tokens) },
          { l: '🧠 上下文', v: fmtTok(a.contextTokens) }
        ].map((m, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0, padding: '5px 7px', borderRadius: 8, background: 'rgba(255,255,255,.04)', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 8 }}>{m.l}</span>
            <span style={{ color: 'oklch(0.9 0.03 var(--th))', fontSize: 10.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.v}</span>
          </div>
        ))}
      </div>
      {/* 上下文占用条 */}
      {a.contextTokens ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
            <div style={{ width: `${ctxPct}%`, height: '100%', borderRadius: 999, background: ctxPct > 80 ? 'oklch(0.75 0.15 30)' : 'linear-gradient(90deg, oklch(0.7 0.13 200), oklch(0.8 0.14 var(--th)))' }} />
          </div>
          <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 8.5 }}>{Math.round(ctxPct)}%</span>
        </div>
      ) : null}
      {/* 当前动作 */}
      <div style={{ color: 'oklch(0.78 0.02 var(--th) / .82)', fontSize: 10.5, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>▸ {a.detail || '待命中…'}</div>
      {/* 活动轨迹 */}
      {a.history && a.history.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '2px solid oklch(0.5 0.06 var(--th) / .3)', paddingLeft: 8 }}>
          {a.history.slice(-3).reverse().map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, color: i === 0 ? 'oklch(0.8 0.06 var(--th) / .85)' : 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9 }}>
              <span style={{ flex: 'none', opacity: 0.6 }}>{new Date(h.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.text}</span>
            </div>
          ))}
        </div>
      )}
      {/* git 小结 */}
      {a.summary && (
        <div style={{ display: 'flex', gap: 8, color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 9.5 }}>
          <span>📦 {a.summary.files} 文件</span><span style={{ color: 'oklch(0.75 0.13 145)' }}>+{a.summary.added}</span><span style={{ color: 'oklch(0.7 0.13 30)' }}>−{a.summary.removed}</span>
          {a.summary.commit && <span style={{ fontFamily: 'ui-monospace,monospace', opacity: 0.7 }}>{a.summary.commit}</span>}
        </div>
      )}
    </div>
  )
}

export function TerminalTab({ tall, full, agents }: { tall: boolean; full?: boolean; agents: AgentVM[] }): React.JSX.Element {
  const [tabs, setTabs] = useState<TermTab[]>(persisted.tabs)
  const [active, setActive] = useState(persisted.active)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ptyOk, setPtyOk] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [showAgents, setShowAgents] = useState(true)
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
    cwdObserver = (id, cwd) => setTabs((list) => list.map((tab) => tab.id === id && tab.cwd !== cwd ? { ...tab, cwd } : tab))
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
  }, [active, recordCommand])

  const changeDirectory = (): void => {
    const path = cwdDraft.trim()
    if (!path) return
    runCommand(setLocationCommand(path))
    setTabs((list) => list.map((tab) => tab.id === active ? { ...tab, cwd: path } : tab))
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
    const doFit = (): void => {
      try {
        s.fit.fit()
        setDims({ cols: s.term.cols, rows: s.term.rows })
        void island.ptyEnsure(active, s.term.cols, s.term.rows).then((ok) => setPtyOk(ok))
        island.ptyResize(active, s.term.cols, s.term.rows)
      } catch { /* */ }
    }
    // 等布局稳定再 fit
    const raf = requestAnimationFrame(doFit)
    const ro = new ResizeObserver(() => doFit())
    ro.observe(host)
    s.term.focus()
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [active, tall])

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
    const remaining = tabs.filter((t) => t.id !== id)
    const next = remaining.length ? remaining : [{ id: 't' + Date.now(), name: 'PowerShell 1', createdAt: Date.now() }]
    setTabs(next)
    if (active === id) setActive(next[0].id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 标签栏 */}
      <div className="ai-scroll" style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
        {tabs.map((t) => {
          const sel = t.id === active
          return (
            <div
              key={t.id}
              onClick={() => setActive(t.id)}
              onDoubleClick={() => setRenaming(t.id)}
              className="hv"
              style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '4.5px 11px', borderRadius: 9, cursor: 'pointer', background: sel ? 'oklch(0.3 0.05 var(--th) / .5)' : 'rgba(255,255,255,.04)', border: `1px solid ${sel ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .45)' : 'rgba(255,255,255,.07)'}` }}
            >
              <span style={{ fontSize: 9, color: 'oklch(0.8 calc(0.12 * var(--cs, 1)) var(--th))' }}>›_</span>
              {renaming === t.id ? (
                <input
                  autoFocus
                  defaultValue={t.name}
                  onBlur={(e) => { const v = e.target.value.trim(); setTabs((l) => l.map((x) => (x.id === t.id ? { ...x, name: v || x.name } : x))); setRenaming(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }}
                  style={{ width: 76, background: 'rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 5, outline: 'none', color: 'oklch(0.95 0.01 var(--th))', fontSize: 10.5, padding: '1px 5px' }}
                />
              ) : (
                <span title={t.cwd ? `${t.cwd}\n双击重命名` : '双击重命名'} style={{ color: sel ? 'oklch(0.94 0.01 var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{t.name}</span>
              )}
              {!!t.commandCount && <span title="本会话执行命令数" style={{ color: 'oklch(0.62 0.02 var(--th) / .55)', fontSize: 8 }}>{t.commandCount}</span>}
              <span className="hv" onClick={(e) => { e.stopPropagation(); closeTab(t.id) }} title="关闭标签（结束该会话）" style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 10, cursor: 'pointer' }}>✕</span>
            </div>
          )
        })}
        <div className="hv" onClick={addTab} title="新建终端标签" style={{ flex: 'none', width: 24, height: 24, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.05)', color: 'oklch(0.85 0.02 var(--th))', fontSize: 13, fontWeight: 700 }}>＋</div>
        <span style={{ flex: 1 }} />
        <span style={{ flex: 'none', color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 9.5 }}>PowerShell 工作台 · 真 ConPTY</span>
      </div>

      {/* PowerShell 工作台概览 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 1fr)', gap: 1, overflow: 'hidden', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.07)' }}>
        <div style={{ padding: '9px 11px', background: 'oklch(0.2 0.025 var(--ths) / .96)', minWidth: 0 }}>
          <div style={{ color: 'oklch(0.94 0.02 var(--th))', fontSize: 12, fontWeight: 750 }}>PowerShell 控制台</div>
          <div title={activeTab?.cwd || '当前目录由 PowerShell 会话维护'} style={{ marginTop: 2, color: 'oklch(0.62 0.02 var(--th) / .65)', fontSize: 9, fontFamily: 'ui-monospace,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTab?.cwd || '会话目录未锁定'}</div>
        </div>
        {[
          { n: tabs.length, l: '会话' },
          { n: history.length, l: '命令' },
          { n: favorites.length, l: '收藏' },
          { n: liveAgents.length, l: 'Agent' }
        ].map((item) => (
          <div key={item.l} style={{ padding: '8px 9px', background: 'oklch(0.2 0.025 var(--ths) / .96)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ color: 'oklch(0.9 0.05 var(--th))', fontSize: 15, lineHeight: 1, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{item.n}</span>
            <span style={{ marginTop: 3, color: 'oklch(0.58 0.02 var(--th) / .6)', fontSize: 8.5 }}>{item.l}</span>
          </div>
        ))}
      </div>

      {/* 工作目录 + 命令编排 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '9px 10px', borderRadius: 8, background: 'rgba(0,0,0,.2)', border: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 'none', color: 'oklch(0.66 0.02 var(--th) / .7)', fontSize: 9, fontWeight: 700 }}>目录</span>
          <input value={cwdDraft} onChange={(e) => setCwdDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') changeDirectory() }} placeholder={activeTab?.cwd || '输入项目路径，例如 E:\\work\\repo'} style={{ flex: 1, minWidth: 0, height: 27, boxSizing: 'border-box', borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.25)', color: 'oklch(0.9 0.02 var(--th))', outline: 'none', padding: '0 8px', fontSize: 10, fontFamily: 'ui-monospace,monospace' }} />
          <button type="button" className="hv" onClick={changeDirectory} disabled={!cwdDraft.trim()} title="切换 PowerShell 当前目录" style={{ ...terminalButton, opacity: cwdDraft.trim() ? 1 : .45 }}>↳ 切换</button>
          <button type="button" className="hv" onClick={() => activeTab?.cwd && island.openFolder(activeTab.cwd)} disabled={!activeTab?.cwd} title="在资源管理器打开当前目录" style={{ ...terminalButton, width: 27, padding: 0, opacity: activeTab?.cwd ? 1 : .45 }}>▣</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {(['commands', 'history', 'favorites'] as const).map((view) => (
            <button key={view} type="button" onClick={() => setToolView(view)} style={terminalSegment(toolView === view)}>{view === 'commands' ? '命令工具' : view === 'history' ? `历史 ${history.length}` : `收藏 ${favorites.length}`}</button>
          ))}
          {toolView === 'commands' && <span style={{ width: 1, height: 18, margin: '0 2px', background: 'rgba(255,255,255,.08)' }} />}
          {toolView === 'commands' && (['项目', 'Git', 'Node', '系统'] as TerminalCommandGroup[]).map((group) => (
            <button key={group} type="button" onClick={() => setCommandGroup(group)} style={terminalSegment(commandGroup === group)}>{group}</button>
          ))}
        </div>
        {toolView === 'commands' && (
          <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
            {groupCommands.map((preset) => (
              <button key={preset.id} type="button" className="hv" onClick={() => runCommand(preset.command)} title={`${preset.description}\n${preset.command}`} style={{ ...terminalButton, flex: 'none' }}>▶ {preset.label}</button>
            ))}
          </div>
        )}
        {toolView === 'history' && (
          <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
            {history.length === 0 && <span style={{ color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9.5 }}>本次运行还没有命令记录</span>}
            {history.slice(0, 16).map((entry) => (
              <div key={entry.id} style={{ flex: 'none', maxWidth: 260, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 7px', borderRadius: 7, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.055)' }}>
                <span className="hv" onClick={() => runCommand(entry.command)} title={`${entry.sessionName} · ${new Date(entry.ts).toLocaleTimeString()}\n${entry.command}`} style={{ maxWidth: 190, color: 'oklch(0.8 0.03 var(--th))', fontSize: 9.5, fontFamily: 'ui-monospace,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{entry.command}</span>
                <span className="hv" onClick={() => toggleFavorite(entry.command)} title="收藏命令" style={{ color: favorites.includes(entry.command) ? 'oklch(0.82 0.13 85)' : 'oklch(0.58 0.02 var(--th) / .5)', cursor: 'pointer', fontSize: 10 }}>{favorites.includes(entry.command) ? '★' : '☆'}</span>
              </div>
            ))}
          </div>
        )}
        {toolView === 'favorites' && (
          <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 1 }}>
            {favorites.length === 0 && <span style={{ color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9.5 }}>收藏的命令会显示在这里</span>}
            {favorites.map((command) => (
              <div key={command} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
                <button type="button" className="hv" onClick={() => runCommand(command)} title={command} style={{ ...terminalButton, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>▶ {command}</button>
                <button type="button" className="hv" onClick={() => toggleFavorite(command)} title="取消收藏" style={{ ...terminalButton, width: 25, padding: 0 }}>★</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#7ee0a8', fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>PS›</span>
          <input value={commandDraft} onChange={(e) => setCommandDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { runCommand(commandDraft); setCommandDraft('') } }} placeholder="输入 PowerShell 命令，Enter 执行" style={{ flex: 1, minWidth: 0, height: 27, boxSizing: 'border-box', borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.25)', color: 'oklch(0.92 0.02 var(--th))', outline: 'none', padding: '0 8px', fontSize: 10.5, fontFamily: 'ui-monospace,monospace' }} />
          <button type="button" className="hv" onClick={() => toggleFavorite(commandDraft)} disabled={!commandDraft.trim()} title="收藏当前命令" style={{ ...terminalButton, width: 27, padding: 0, color: favorites.includes(commandDraft.trim()) ? 'oklch(0.82 0.13 85)' : terminalButton.color }}>{favorites.includes(commandDraft.trim()) ? '★' : '☆'}</button>
          <button type="button" className="hv" onClick={() => { runCommand(commandDraft); setCommandDraft('') }} disabled={!commandDraft.trim()} style={{ ...terminalButton, padding: '0 11px', opacity: commandDraft.trim() ? 1 : .45, background: commandDraft.trim() ? 'oklch(0.65 0.13 150 / .55)' : terminalButton.background, color: commandDraft.trim() ? 'oklch(0.94 0.03 150)' : terminalButton.color }}>运行</button>
        </div>
      </div>

      {!ptyOk && (
        <div style={{ padding: '8px 11px', borderRadius: 10, background: 'oklch(0.3 0.08 30 / .3)', border: '1px solid oklch(0.6 0.12 30 / .4)', color: 'oklch(0.85 0.08 30)', fontSize: 11 }}>
          PTY 原生模块加载失败（@lydell/node-pty）。请重新 npm install 后重启。
        </div>
      )}

      {/* Coding Agent 会话可视化 */}
      {liveAgents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="hv" onClick={() => setShowAgents((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '0 2px' }}>
            <span style={{ color: 'oklch(0.85 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em' }}>🤖 活跃 Agent 会话</span>
            <span style={{ padding: '0 6px', borderRadius: 999, background: 'oklch(0.4 0.09 150 / .4)', color: 'oklch(0.85 0.12 150)', fontSize: 9, fontWeight: 700 }}>{liveAgents.length}</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
            <span style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 9, transform: showAgents ? 'none' : 'rotate(-90deg)', transition: 'transform .18s' }}>▾</span>
          </div>
          {showAgents && (
            liveAgents.length === 1
              ? <AgentCard a={liveAgents[0]} now={now} />
              : <div className="ai-scroll" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 5, scrollSnapType: 'x proximity' }}>
                  {liveAgents.map((a) => <div key={a.id} style={{ flex: 'none', width: 'calc((100% - 21px) / 4)', minWidth: 205, scrollSnapAlign: 'start' }}><AgentCard a={a} now={now} /></div>)}
                </div>
          )}
        </div>
      )}

      {/* xterm 宿主：真实终端渲染区（玻璃质感 + 顶栏 + 底部状态栏） */}
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid oklch(0.5 0.08 var(--th) / .22)', background: 'radial-gradient(120% 100% at 50% 0%, oklch(0.22 0.03 var(--th) / .5), rgba(0,0,0,.6) 60%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05), 0 6px 22px rgba(0,0,0,.28)' }}>
        {/* 顶栏：交通灯 + 标题 + 工具 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderBottom: '1px solid rgba(255,255,255,.07)', background: 'linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.01))' }}>
          <span style={{ display: 'flex', gap: 5 }}>{['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: 999, background: c, boxShadow: `0 0 5px ${c}88` }} />)}</span>
          <span style={{ marginLeft: 5, display: 'flex', alignItems: 'center', gap: 5, color: 'oklch(0.82 0.03 var(--th) / .82)', fontSize: 9.5, fontFamily: 'ui-monospace,monospace', fontWeight: 600 }}><span style={{ color: '#7ee0a8' }}>❯</span>PowerShell · {tabs.find((t) => t.id === active)?.name}</span>
          {activeTab?.lastCommand && <span title={activeTab.lastCommand} style={{ maxWidth: 220, color: 'oklch(0.56 0.02 var(--th) / .52)', fontSize: 8.5, fontFamily: 'ui-monospace,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTab.lastCommand}</span>}
          <span style={{ flex: 1 }} />
          <span className="hv" onClick={() => island.ptyInput(active, '\x03')} title="中断当前命令（Ctrl+C）" style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 7, background: 'oklch(0.32 0.07 30 / .25)', color: 'oklch(0.78 0.09 30)', fontSize: 9 }}>■ 中断</span>
          <span className="hv" onClick={() => setSearchOpen((v) => !v)} title="搜索终端输出（Ctrl+Shift+F）" style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 7, background: searchOpen ? 'oklch(0.35 0.07 205 / .35)' : 'rgba(255,255,255,.05)', color: 'oklch(0.78 0.05 205)', fontSize: 9 }}>⌕ 查找</span>
          <span className="hv" onClick={() => getSession(active).term.clear()} title="清屏（保留会话）" style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 7, background: 'rgba(255,255,255,.05)', color: 'oklch(0.78 0.02 var(--th) / .78)', fontSize: 9 }}>🧹 清屏</span>
          <span className="hv" onClick={() => getSession(active).term.scrollToBottom()} title="滚到底" style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 7, background: 'rgba(255,255,255,.05)', color: 'oklch(0.78 0.02 var(--th) / .78)', fontSize: 9 }}>⤓ 底部</span>
        </div>
        {searchOpen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(0,0,0,.22)' }}>
            <span style={{ color: 'oklch(0.7 0.05 205)', fontSize: 10 }}>⌕</span>
            <input autoFocus value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setSearchStatus('') }} onKeyDown={(e) => { if (e.key === 'Enter') findInTerminal(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setSearchOpen(false) }} placeholder="搜索当前终端缓冲区" style={{ flex: 1, minWidth: 0, height: 24, borderRadius: 6, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.3)', color: 'oklch(0.9 0.02 var(--th))', outline: 'none', padding: '0 7px', fontSize: 9.5, fontFamily: 'ui-monospace,monospace' }} />
            <span style={{ minWidth: 45, color: 'oklch(0.58 0.02 var(--th) / .6)', fontSize: 8.5 }}>{searchStatus}</span>
            <button type="button" onClick={() => findInTerminal(-1)} title="上一个" style={{ ...terminalButton, width: 24, height: 24, padding: 0 }}>↑</button>
            <button type="button" onClick={() => findInTerminal(1)} title="下一个" style={{ ...terminalButton, width: 24, height: 24, padding: 0 }}>↓</button>
            <button type="button" onClick={() => { getSession(active).term.clearSelection(); setSearchOpen(false) }} title="关闭搜索" style={{ ...terminalButton, width: 24, height: 24, padding: 0 }}>×</button>
          </div>
        )}
        {/* 大尺寸固定 660px；仅真全屏绑 100vh（覆盖层会把窗口铺满显示器，100vh 突变会让终端高度跳动） */}
        <div ref={hostRef} style={{ height: full ? 'calc(100vh - 500px)' : tall ? 590 : 330, minHeight: 250, padding: '8px 4px 8px 10px', boxSizing: 'border-box', overflow: 'hidden' }} />
        {/* 底部状态栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 11px', borderTop: '1px solid rgba(255,255,255,.06)', background: 'linear-gradient(180deg, oklch(0.32 0.06 150 / .18), rgba(0,0,0,.3))', fontFamily: 'ui-monospace,monospace', fontSize: 8.5, color: 'oklch(0.68 0.02 var(--th) / .62)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'oklch(0.8 0.11 150)' }}><span style={{ width: 5, height: 5, borderRadius: 999, background: ptyOk ? 'oklch(0.8 0.14 150)' : 'oklch(0.7 0.15 30)', boxShadow: ptyOk ? '0 0 5px oklch(0.8 0.14 150)' : undefined }} />{ptyOk ? 'ConPTY 已连接' : 'PTY 未就绪'}</span>
          <span>{dims.cols}×{dims.rows}</span>
          <span>UTF-8</span>
          <span>回滚 8000 行</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)' }}>PowerShell · xterm-256color</span>
        </div>
      </div>
    </div>
  )
}
