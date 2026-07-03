// 真 PTY 终端（xterm.js + ConPTY PowerShell）：与本地 Windows 终端同源——
// vim/top 等 TUI、Claude Code/Codex 等交互式 CLI、颜色/光标/快捷键全部原生支持。
// 多标签：＋新增 / ✕关闭（杀进程）/ 双击改名；xterm 实例与 DOM 常驻模块级，切分区不丢。

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { island } from '../bridge'

interface TermTab {
  id: string
  name: string
}

interface Session {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
}

// 模块级：xterm 实例/DOM/标签列表 常驻，组件卸载（切分区）不销毁
const sessions = new Map<string, Session>()
const persisted = { tabs: [{ id: 't1', name: '终端 1' }] as TermTab[], active: 't1' }
let subscribed = false

function getSession(id: string): Session {
  let s = sessions.get(id)
  if (s) return s
  const term = new Terminal({
    fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
    fontSize: 12,
    lineHeight: 1.25,
    cursorBlink: true,
    allowTransparency: true,
    scrollback: 5000,
    theme: {
      background: 'rgba(0,0,0,0)',
      foreground: '#d8dee9',
      cursor: '#9adfb8',
      selectionBackground: 'rgba(120,180,150,.35)'
    }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const el = document.createElement('div')
  el.style.cssText = 'width:100%;height:100%'
  term.open(el)
  term.onData((data) => island.ptyInput(id, data))
  term.onResize(({ cols, rows }) => island.ptyResize(id, cols, rows))
  s = { term, fit, el }
  sessions.set(id, s)
  return s
}

function subscribeOnce(): void {
  if (subscribed) return
  subscribed = true
  island.onPtyData((id, data) => sessions.get(id)?.term.write(data))
}

export function TerminalTab({ tall }: { tall: boolean }): React.JSX.Element {
  const [tabs, setTabs] = useState<TermTab[]>(persisted.tabs)
  const [active, setActive] = useState(persisted.active)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ptyOk, setPtyOk] = useState(true)
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => { persisted.tabs = tabs; persisted.active = active }, [tabs, active])

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
    setTabs((l) => [...l, { id, name: `终端 ${l.length + 1}` }])
    setActive(id)
  }
  const closeTab = (id: string): void => {
    island.ptyKill(id)
    const s = sessions.get(id)
    if (s) { s.term.dispose(); sessions.delete(id) }
    setTabs((l) => {
      const next = l.filter((t) => t.id !== id)
      return next.length ? next : [{ id: 't' + Date.now(), name: '终端 1' }]
    })
    setActive((cur) => (cur === id ? (tabs.find((t) => t.id !== id)?.id || tabs[0]?.id || 't1') : cur))
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
                <span title="双击重命名" style={{ color: sel ? 'oklch(0.94 0.01 var(--th))' : 'oklch(0.75 0.02 var(--th) / .75)', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{t.name}</span>
              )}
              <span className="hv" onClick={(e) => { e.stopPropagation(); closeTab(t.id) }} title="关闭标签（结束该会话）" style={{ color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 10, cursor: 'pointer' }}>✕</span>
            </div>
          )
        })}
        <div className="hv" onClick={addTab} title="新建终端标签" style={{ flex: 'none', width: 24, height: 24, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.05)', color: 'oklch(0.85 0.02 var(--th))', fontSize: 13, fontWeight: 700 }}>＋</div>
        <span style={{ flex: 1 }} />
        <span style={{ flex: 'none', color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 9.5 }}>真 PTY · 与本地 PowerShell 完全一致</span>
      </div>

      {!ptyOk && (
        <div style={{ padding: '8px 11px', borderRadius: 10, background: 'oklch(0.3 0.08 30 / .3)', border: '1px solid oklch(0.6 0.12 30 / .4)', color: 'oklch(0.85 0.08 30)', fontSize: 11 }}>
          PTY 原生模块加载失败（@lydell/node-pty）。请重新 npm install 后重启。
        </div>
      )}

      {/* xterm 宿主：真实终端渲染区 */}
      <div
        ref={hostRef}
        style={{ height: tall ? 'calc(100vh - 300px)' : 380, borderRadius: 12, background: 'rgba(0,0,0,.5)', border: '1px solid rgba(255,255,255,.07)', padding: '8px 4px 8px 10px', boxSizing: 'border-box', overflow: 'hidden' }}
      />
      <div style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 9.5 }}>
        ConPTY 真终端：可直接运行 claude / codex / vim / npm 等任何 PowerShell 里能跑的程序，Tab 补全与彩色输出原生支持。
      </div>
    </div>
  )
}
