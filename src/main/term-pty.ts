// 真 PTY 终端（@lydell/node-pty，N-API 预编译免 rebuild）：每个标签页一个真实的
// ConPTY PowerShell —— 与本地 Windows 终端完全同源：TUI（vim/top）、交互式 CLI
// （Claude Code / Codex）、颜色、光标控制全部原生支持。

import { homedir } from 'os'

// 类型最小声明（避免给原生包再引类型依赖）
interface IPty {
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
}
interface PtyModule {
  spawn: (file: string, args: string[], opts: Record<string, unknown>) => IPty
}

let ptyMod: PtyModule | null | undefined
function loadPty(): PtyModule | null {
  if (ptyMod !== undefined) return ptyMod
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyMod = require('@lydell/node-pty') as PtyModule
  } catch {
    ptyMod = null // 原生模块加载失败 → 上层如实提示
  }
  return ptyMod
}

const sessions = new Map<string, IPty>()
let sink: ((id: string, data: string) => void) | null = null

export function setPtySink(cb: (id: string, data: string) => void): void {
  sink = cb
}

/** 确保会话存活；返回是否可用（原生模块加载失败时 false） */
export function ptyEnsure(id: string, cols: number, rows: number): boolean {
  const mod = loadPty()
  if (!mod) return false
  if (sessions.has(id)) return true
  const p = mod.spawn('powershell.exe', ['-NoLogo'], {
    name: 'xterm-256color',
    cols: Math.max(20, cols || 100),
    rows: Math.max(5, rows || 28),
    cwd: homedir(),
    env: process.env,
    useConpty: true
  })
  sessions.set(id, p)
  p.onData((data) => sink?.(id, data))
  p.onExit(({ exitCode }) => {
    sink?.(id, `\r\n\x1b[90m[会话已退出 code=${exitCode}，输入任意内容自动重启]\x1b[0m\r\n`)
    sessions.delete(id)
  })
  return true
}

export function ptyInput(id: string, data: string): void {
  if (!sessions.has(id)) ptyEnsure(id, 100, 28)
  sessions.get(id)?.write(data)
}

export function ptyResize(id: string, cols: number, rows: number): void {
  try { sessions.get(id)?.resize(Math.max(20, cols), Math.max(5, rows)) } catch { /* */ }
}

export function ptyKill(id: string): void {
  try { sessions.get(id)?.kill() } catch { /* */ }
  sessions.delete(id)
}

export function ptyKillAll(): void {
  for (const id of [...sessions.keys()]) ptyKill(id)
}
