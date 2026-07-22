// 真 PTY 终端（@lydell/node-pty，N-API 预编译免 rebuild）：每个标签页一个真实的
// ConPTY PowerShell —— 与本地 Windows 终端完全同源：TUI（vim/top）、交互式 CLI
// （Claude Code / Codex）、颜色、光标控制全部原生支持。

import { homedir } from 'os'
import { existsSync } from 'fs'
import type { TerminalShellProfile } from '../shared/protocol'

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
const sessionSizes = new Map<string, { cols: number; rows: number }>()
let sink: ((id: string, data: string) => void) | null = null

function normalizedSize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Number.isFinite(cols) ? Math.round(cols) : 100),
    rows: Math.max(5, Number.isFinite(rows) ? Math.round(rows) : 28)
  }
}

export function setPtySink(cb: (id: string, data: string) => void): void {
  sink = cb
}

function shellCommand(profile: TerminalShellProfile): { file: string; args: string[] } {
  if (profile === 'pwsh') return { file: 'pwsh.exe', args: ['-NoLogo'] }
  if (profile === 'cmd') return { file: 'cmd.exe', args: ['/Q'] }
  if (profile === 'wsl') return { file: 'wsl.exe', args: [] }
  return { file: 'powershell.exe', args: ['-NoLogo'] }
}

/** 确保会话存活；返回是否可用（原生模块加载失败时 false） */
export function ptyEnsure(id: string, cols: number, rows: number, cwd?: string, profile: TerminalShellProfile = 'powershell', environment?: Record<string, string>): boolean {
  const mod = loadPty()
  if (!mod) return false
  if (sessions.has(id)) {
    ptyResize(id, cols, rows)
    return true
  }
  const size = normalizedSize(cols, rows)
  const shell = shellCommand(profile)
  let p: IPty
  try {
    p = mod.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: cwd && existsSync(cwd) ? cwd : homedir(),
      env: { ...process.env, ...environment, TERM: 'xterm-256color', PYTHONUTF8: '1' },
      useConpty: true
    })
  } catch {
    return false
  }
  sessions.set(id, p)
  sessionSizes.set(id, size)
  p.onData((data) => sink?.(id, data))
  p.onExit(({ exitCode }) => {
    sink?.(id, `\r\n\x1b[90m[会话已退出 code=${exitCode}，输入任意内容自动重启]\x1b[0m\r\n`)
    if (sessions.get(id) === p) {
      sessions.delete(id)
      sessionSizes.delete(id)
    }
  })
  if (profile === 'powershell' || profile === 'pwsh') {
    p.write('[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();$OutputEncoding=[Console]::OutputEncoding;$global:__AIIslandPrompt=(Get-Item Function:\\prompt).ScriptBlock;function global:prompt{$__ok=$?;$__native=$global:LASTEXITCODE;$__code=if($__ok){0}elseif($__native -is [int] -and $__native -ne 0){$__native}else{1};[Console]::Write(([char]27)+"]633;D;$__code"+([char]7));&$global:__AIIslandPrompt}\r')
  }
  return true
}

export function ptyInput(id: string, data: string): void {
  if (!sessions.has(id)) ptyEnsure(id, 100, 28)
  sessions.get(id)?.write(data)
}

export function ptyResize(id: string, cols: number, rows: number): void {
  const size = normalizedSize(cols, rows)
  const current = sessionSizes.get(id)
  if (current?.cols === size.cols && current.rows === size.rows) return
  try {
    sessions.get(id)?.resize(size.cols, size.rows)
    if (sessions.has(id)) sessionSizes.set(id, size)
  } catch { /* */ }
}

export function ptyKill(id: string): void {
  try { sessions.get(id)?.kill() } catch { /* */ }
  sessions.delete(id)
  sessionSizes.delete(id)
}

export function ptyKillAll(): void {
  for (const id of [...sessions.keys()]) ptyKill(id)
}
