// 本地 Agent CLI 桥（流式）：把问答直接交给本机 Claude Code / Codex 的无头模式，逐行解析 JSONL 事件流，
// 归一化为 think/text/tool/result 事件推给渲染层——思考过程、工具/技能/MCP 步骤、最终回复全部实时可见，
// 与终端里工作方式一致（审批也照常走岛的 PreToolUse hook 阻塞审批流）。
// Windows 约束：.cmd 垫片经 cmd.exe /d /s /c 调起；提示词一律走 stdin，杜绝引号转义。
//   claude: `claude -p --output-format stream-json --verbose --include-partial-messages [-c]`
//     - stream_event(text_delta/thinking_delta) → 逐 token 流式
//     - assistant(tool_use) → 工具/技能/MCP 步骤开始；user(tool_result) → 步骤完成
//     - result → 最终回复
//   codex: `codex exec --json --skip-git-repo-check -`
//     - item.*(reasoning/agent_message/command_execution/mcp_tool_call/file_change/web_search) → 步骤粒度流式
//     - turn.completed → 结束

import { spawn, type ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { homedir } from 'os'
import type { AgentCliEvent } from '../shared/protocol'

export type AgentEngine = 'claude' | 'codex'

const running: Partial<Record<AgentEngine, ChildProcess>> = {}
const stopReasons = new Map<number, string>()
const TIMEOUT_MS = 15 * 60_000 // 带工具的 Agent 回合可能很长，给足 15 分钟

function killTree(p?: ChildProcess): void {
  if (!p || p.pid == null) return
  try { spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true }) } catch { /* */ }
}

/** 探测 CLI 是否可用（15s 超时），返回版本首行 */
export function agentCliCheck(engine: AgentEngine): Promise<{ ok: boolean; version?: string }> {
  return new Promise((resolve) => {
    let done = false
    const finish = (r: { ok: boolean; version?: string }): void => { if (!done) { done = true; resolve(r) } }
    try {
      const p = spawn('cmd.exe', ['/d', '/s', '/c', `${engine} --version`], { windowsHide: true })
      let out = ''
      p.stdout?.on('data', (d) => { out += String(d) })
      p.on('close', (code) => finish(code === 0 ? { ok: true, version: out.trim().split('\n')[0]?.slice(0, 60) } : { ok: false }))
      p.on('error', () => finish({ ok: false }))
      setTimeout(() => { killTree(p); finish({ ok: false }) }, 15000)
    } catch { finish({ ok: false }) }
  })
}

/** 主动停止当前引擎的进行中请求（渲染层"⏹ 停止"按钮） */
export function agentCliCancel(engine: AgentEngine): void {
  const process = running[engine]
  if (process?.pid != null) stopReasons.set(process.pid, '已由用户停止')
  killTree(process)
}

// 工具名 → 展示标签：MCP 工具/技能特殊标注，满足"工具、技能及 MCP 操作步骤"可视化
function toolLabel(name: string): string {
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    return `🔌 MCP · ${parts[1] || ''}${parts[2] ? '.' + parts.slice(2).join('.') : ''}`
  }
  if (name === 'Skill') return '⚡ 技能'
  if (name === 'Task' || name === 'Agent') return '🤖 子 Agent'
  if (name === 'Bash') return '🖥 命令'
  if (name === 'Read') return '📖 读取'
  if (name === 'Write' || name === 'Edit' || name === 'NotebookEdit') return '✏️ 写入'
  if (name === 'Grep' || name === 'Glob') return '🔍 检索'
  if (name === 'WebFetch' || name === 'WebSearch') return '🌐 联网'
  return `🔧 ${name}`
}
// 工具输入 → 一行摘要
function toolDetail(input: unknown): string {
  const i = (input || {}) as Record<string, unknown>
  const v = i.command ?? i.file_path ?? i.pattern ?? i.skill ?? i.url ?? i.query ?? i.description ?? i.prompt
  if (typeof v === 'string' && v) return v.replace(/\s+/g, ' ').slice(0, 90)
  try { const s = JSON.stringify(i); return s === '{}' ? '' : s.slice(0, 90) } catch { return '' }
}
const CODEX_LABEL: Record<string, string> = {
  command_execution: '🖥 命令', mcp_tool_call: '🔌 MCP', file_change: '✏️ 文件修改',
  web_search: '🌐 搜索', todo_list: '📋 计划', patch_apply: '✏️ 补丁'
}

/**
 * 流式无头问答：spawn 后立即返回；事件经 send 回调持续推送，进程结束保证发一条 result 或 error 收尾。
 * cwd=工作目录（本地配置按目录生效，空=用户主目录）；cont=续聊（仅 claude -c）。
 */
export async function agentCliStream(
  engine: AgentEngine,
  prompt: string,
  cwd: string | undefined,
  cont: boolean,
  send: (ev: AgentCliEvent) => void
): Promise<{ ok: boolean; error?: string }> {
  const q = (prompt || '').trim()
  if (!q) return { ok: false, error: '空提问' }
  let dir = homedir()
  if (cwd && cwd.trim()) {
    try { if ((await fs.stat(cwd.trim())).isDirectory()) dir = cwd.trim(); else return { ok: false, error: `工作目录不是文件夹：${cwd}` } }
    catch { return { ok: false, error: `工作目录不存在：${cwd}` } }
  }
  // 同引擎并发保护：新提问杀掉上一个仍在跑的
  const previous = running[engine]
  if (previous?.pid != null) stopReasons.set(previous.pid, '已被新的同引擎请求停止')
  killTree(previous)

  const cmdline = engine === 'claude'
    ? `claude -p --output-format stream-json --verbose --include-partial-messages${cont ? ' -c' : ''}`
    : `codex exec --json --skip-git-repo-check -`

  const p = spawn('cmd.exe', ['/d', '/s', '/c', cmdline], { cwd: dir, windowsHide: true })
  running[engine] = p

  let ended = false
  let sawResult = false
  let accText = '' // codex 的 agent_message 聚合 / claude 兜底
  let errBuf = ''
  let lineBuf = ''
  const finish = (ev: AgentCliEvent): void => {
    if (ended) return
    const stopReason = p.pid == null ? undefined : stopReasons.get(p.pid)
    if (p.pid != null) stopReasons.delete(p.pid)
    ended = true
    if (running[engine]?.pid === p.pid) delete running[engine]
    send(stopReason ? { kind: 'error', text: stopReason } : ev)
  }
  const timer = setTimeout(() => { killTree(p); finish({ kind: 'error', text: '执行超时（15 分钟），已终止。' }) }, TIMEOUT_MS)

  const handleClaude = (j: Record<string, unknown>): void => {
    const type = j.type as string
    if (type === 'system' && (j as { subtype?: string }).subtype === 'init') {
      const jj = j as { model?: string; tools?: unknown[]; mcp_servers?: unknown[] }
      send({ kind: 'status', text: `${jj.model || 'claude'} · ${jj.tools?.length ?? 0} 工具 · ${jj.mcp_servers?.length ?? 0} MCP` })
      return
    }
    if (type === 'stream_event') {
      const e = (j as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event
      if (e?.type === 'content_block_delta') {
        if (e.delta?.type === 'thinking_delta' && e.delta.thinking) send({ kind: 'think', text: e.delta.thinking })
        else if (e.delta?.type === 'text_delta' && e.delta.text) { accText += e.delta.text; send({ kind: 'text', text: e.delta.text }) }
      }
      return
    }
    if (type === 'assistant') {
      const content = ((j as { message?: { content?: { type?: string; name?: string; input?: unknown }[] } }).message?.content) || []
      for (const b of content) if (b.type === 'tool_use' && b.name) send({ kind: 'tool', name: toolLabel(b.name), detail: toolDetail(b.input) })
      return
    }
    if (type === 'user') {
      const content = ((j as { message?: { content?: { type?: string }[] } }).message?.content) || []
      if (content.some((b) => b.type === 'tool_result')) send({ kind: 'tool-done' })
      return
    }
    if (type === 'result') {
      sawResult = true
      clearTimeout(timer)
      const jj = j as { subtype?: string; result?: string; errors?: unknown }
      if (jj.subtype === 'success' || typeof jj.result === 'string') finish({ kind: 'result', text: (jj.result ?? accText) || '（无输出）' })
      else finish({ kind: 'error', text: `执行未成功（${jj.subtype || '未知'}）` })
    }
  }

  const handleCodex = (j: Record<string, unknown>): void => {
    const type = j.type as string
    if (type === 'thread.started') { send({ kind: 'status', text: 'codex 会话已开始' }); return }
    if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
      const it = ((j as { item?: Record<string, unknown> }).item) || {}
      const ty = String(it.item_type ?? it.type ?? '')
      if (ty === 'reasoning') {
        if (type === 'item.completed' && typeof it.text === 'string' && it.text) send({ kind: 'think', text: it.text + '\n\n' })
      } else if (ty === 'agent_message') {
        if (type === 'item.completed' && typeof it.text === 'string' && it.text) { accText += (accText ? '\n\n' : '') + it.text; send({ kind: 'text', text: (accText.endsWith(it.text) && accText !== it.text ? '\n\n' : '') + it.text }) }
      } else if (ty === 'error') {
        if (typeof it.message === 'string') errBuf += it.message + '\n'
      } else if (ty) {
        const label = CODEX_LABEL[ty] || `🔧 ${ty}`
        const detail = typeof it.command === 'string' ? it.command : typeof it.title === 'string' ? it.title : typeof it.query === 'string' ? it.query : ''
        if (type === 'item.started') send({ kind: 'tool', name: label, detail: detail.replace(/\s+/g, ' ').slice(0, 90) })
        else if (type === 'item.completed') send({ kind: 'tool-done' })
      }
      return
    }
    if (type === 'turn.completed') { sawResult = true; clearTimeout(timer); finish({ kind: 'result', text: accText || '（无输出）' }); return }
    if (type === 'turn.failed' || type === 'error') {
      sawResult = true
      clearTimeout(timer)
      const msg = (j as { error?: { message?: string }; message?: string })
      finish({ kind: 'error', text: msg.error?.message || msg.message || errBuf.trim() || '执行失败' })
    }
  }

  p.stdout?.on('data', (d) => {
    lineBuf += String(d)
    let nl = lineBuf.indexOf('\n')
    while (nl !== -1) {
      const line = lineBuf.slice(0, nl).trim()
      lineBuf = lineBuf.slice(nl + 1)
      nl = lineBuf.indexOf('\n')
      if (!line || !line.startsWith('{')) continue
      try {
        const j = JSON.parse(line) as Record<string, unknown>
        if (engine === 'claude') handleClaude(j); else handleCodex(j)
      } catch { /* 半截/非 JSON 行忽略 */ }
    }
  })
  p.stderr?.on('data', (d) => { errBuf += String(d) })
  p.on('error', (e) => { clearTimeout(timer); finish({ kind: 'error', text: `无法启动 ${engine} CLI：${String(e instanceof Error ? e.message : e)}` }) })
  p.on('close', (code) => {
    clearTimeout(timer)
    if (ended) return
    // 进程结束但没等到 result 事件：有正文按结果收，否则报错；停止原因由 finish 统一覆盖。
    if (!sawResult && accText) finish({ kind: 'result', text: accText })
    else if (!sawResult) finish({ kind: 'error', text: errBuf.trim().slice(-500) || `${engine} 退出码 ${code}（未装或未登录？终端里先跑一次 ${engine}）` })
  })
  try { p.stdin?.write(q, 'utf8'); p.stdin?.end() } catch { /* */ }
  return { ok: true }
}
