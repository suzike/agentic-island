// 让原会话继续补验证：用 CLI 自带的 resume 能力续跑，提示词从 stdin 喂入。
//   claude -p --resume <session-id>
//   codex exec --skip-git-repo-check resume <session-id> -
// 只负责"跑起来 + 回传输出"，不做判断——补完的验证证据仍由 hooks/rollout 走常规链路回流。

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, statSync } from 'fs'
import type { FollowupEvent, FollowupRequest } from '../shared/protocol'

const TIMEOUT_MS = 20 * 60 * 1000
interface RunningFollowup {
  child: ChildProcess
  stop: (reason: string) => void
}

const runs = new Map<string, RunningFollowup>()

const killTree = (p?: ChildProcess): void => {
  if (!p || p.pid == null) return
  try { spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true }) } catch { /* */ }
}

/** session id 会被拼进 cmd 命令串：先过白名单（IPC 透传值不受类型保护） */
const SAFE_SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{7,}$/

export function startFollowup(req: FollowupRequest, emit: (ev: FollowupEvent) => void): { ok: boolean; error?: string } {
  const engine = req.engine === 'codex' ? 'codex' : 'claude'
  const runId = String(req.runId || '').slice(0, 80)
  const sessionId = String(req.sessionId || '').trim()
  const cwd = String(req.cwd || '').trim()
  const prompt = String(req.prompt || '').trim()
  if (!runId) return { ok: false, error: '缺少任务标识' }
  if (!SAFE_SESSION.test(sessionId)) return { ok: false, error: '该会话没有可用的会话 id，无法续跑' }
  if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return { ok: false, error: `工作目录不可用：${cwd || '(空)'}` }
  if (!prompt) return { ok: false, error: '追问内容为空' }

  // 同一条记录重复点击：先停上一次（旧进程的 close 不会再改写新状态）
  runs.get(runId)?.stop('已被新的补验证请求替换')

  const cmdline = engine === 'claude'
    ? `claude -p --resume ${sessionId}`
    : `codex exec --skip-git-repo-check resume ${sessionId} -`

  let child: ChildProcess
  try {
    child = spawn('cmd.exe', ['/d', '/s', '/c', cmdline], { cwd, windowsHide: true })
  } catch (e) {
    return { ok: false, error: `无法启动 ${engine}：${e instanceof Error ? e.message : String(e)}` }
  }
  let ended = false
  const push = (text: string): void => {
    if (!text) return
    emit({ runId, kind: 'output', text: text.slice(-8000) })
  }
  const finish = (ev: FollowupEvent): void => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    if (runs.get(runId)?.child === child) runs.delete(runId)
    emit(ev)
  }
  const stop = (reason: string): void => {
    if (ended) return
    finish({ runId, kind: 'error', text: reason })
    killTree(child)
  }
  runs.set(runId, { child, stop })
  const timer = setTimeout(() => {
    killTree(child)
    finish({ runId, kind: 'error', text: `补验证超时（${Math.round(TIMEOUT_MS / 60000)} 分钟），已终止` })
  }, TIMEOUT_MS)

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => push(chunk))
  child.stderr?.on('data', (chunk: string) => push(chunk))
  child.on('error', (e) => finish({ runId, kind: 'error', text: `启动失败：${e.message}` }))
  child.on('close', (code, signal) => {
    if (ended) return
    finish({ runId, kind: 'done', exitCode: typeof code === 'number' ? code : undefined, text: signal ? `被信号终止：${signal}` : undefined })
  })

  try {
    child.stdin?.write(prompt)
    child.stdin?.end()
  } catch { /* stdin 关闭时忽略：进程可能已自行退出 */ }

  emit({ runId, kind: 'start', text: engine === 'claude' ? `claude --resume ${sessionId.slice(0, 8)}…` : `codex exec resume ${sessionId.slice(0, 8)}…` })
  return { ok: true }
}

export function cancelFollowup(runId: string): void {
  runs.get(String(runId || ''))?.stop('已手动停止补验证')
}

export function killAllFollowups(): void {
  for (const run of runs.values()) run.stop('应用退出，补验证已终止')
  runs.clear()
}
