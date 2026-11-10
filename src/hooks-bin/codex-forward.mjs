#!/usr/bin/env node
// Codex hook 转发脚本。由 `node codex-forward.mjs codex <EventName>` 调用。
// 结构与 cc-forward.mjs 对称：读 stdin → 转发本地桥 → 阻塞等裁决 → 打印决定。
//
// ⚠️ Codex 的 hook 输入字段名与决定输出 schema 需在真实 Codex 版本二次验证（计划风险 #1）。
// 本脚本对输入字段做多名兼容，输出同时给出几种常见键名；连接失败一律 fail-open(exit 0)。

import { readFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { request } from 'http'

// AIISLAND_BRIDGE_FILE：测试专用的发现文件覆盖（避免测试桥覆盖真实 bridge.json）
const BRIDGE_FILE = process.env.AIISLAND_BRIDGE_FILE || join(homedir(), '.agentic-island', 'bridge.json')
// 诊断日志：与 cc-forward 同一份 events.log（此前 codex hook 是否触发无从查证，就是因为这里不落日志）
const EVENTS_LOG = join(homedir(), '.agentic-island', 'events.log')
const trace = (msg) => {
  try { appendFileSync(EVENTS_LOG, `${new Date().toISOString()} [codex] ${msg}\n`) } catch { /* */ }
}

const readStdin = () =>
  new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    setTimeout(() => resolve(data), 50)
  })

const postEvent = (bridge, payload, timeoutMs = 10 * 60 * 1000) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...payload, ppid: process.ppid })
    const req = request(
      {
        host: '127.0.0.1',
        port: bridge.port,
        path: '/event',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      },
      (res) => {
        let out = ''
        res.on('data', (c) => (out += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(out))
          } catch {
            resolve({})
          }
        })
      }
    )
    req.on('error', reject)
    // 只有 PermissionRequest 可以长等；PreToolUse 活动上报必须快速 fail-open。
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    req.write(body)
    req.end()
  })

// 从 Codex 各种可能的字段里尽力提取命令原文
const extractCommand = (input) => {
  if (!input || typeof input !== 'object') return ''
  const cand =
    input.command ||
    (input.tool_input && (input.tool_input.command || input.tool_input.cmd)) ||
    (Array.isArray(input.command) ? input.command.join(' ') : '') ||
    input.cmd ||
    ''
  return Array.isArray(cand) ? cand.join(' ') : String(cand || '')
}

async function main() {
  const backend = 'codex'
  const eventName = process.argv[3] || process.argv[2] || 'PermissionRequest'

  let bridge
  try {
    bridge = JSON.parse(readFileSync(BRIDGE_FILE, 'utf8'))
  } catch {
    process.exit(0)
  }

  const raw = await readStdin()
  let input = {}
  try {
    input = raw ? JSON.parse(raw) : {}
  } catch {
    input = {}
  }

  const cwd = input.cwd || input.workdir || process.cwd()
  const sessionId = input.session_id || input.turn_id || input['turn-id'] || ''
  const command = extractCommand(input)
  const tool = input.tool_name || (command ? 'command' : '')
  trace(`${eventName} tool=${tool || '-'} sess=${String(sessionId).slice(0, 8)} cwd=${String(cwd).slice(-30)}`)

  // PreToolUse 每次工具调用都会触发，即使 Codex 本来会直接执行；
  // 在这里阻塞会把所有自动化变成逐工具审批。只上报活动，不返回决定。
  if (eventName === 'PreToolUse') {
    const detail = command ? `正在执行：${command}` : `正在使用工具：${tool || 'command'}`
    try { await postEvent(bridge, { token: bridge.token, backend, kind: 'activity', sessionId, cwd, tool, detail }, 2000) } catch { /* */ }
    process.exit(0)
  }

  // PermissionRequest 只在 Codex 真正准备弹批准提示时触发（命令升级、网络审批等）。
  // 输出必须严格使用 Codex hooks 文档的 decision.behavior 结构；回传其它旧字段会被判为失败。
  if (eventName === 'PermissionRequest') {
    const description = input && input.tool_input && typeof input.tool_input.description === 'string'
      ? input.tool_input.description.trim()
      : ''
    const detail = description || (command ? `请求执行命令：${command}` : `请求使用工具：${tool || 'command'}`)
    let reply
    try {
      reply = await postEvent(bridge, {
        token: bridge.token, backend, kind: 'permission', sessionId, cwd,
        tool: tool || 'command', command: command || tool, detail
      })
    } catch {
      process.exit(0)
    }
    const decision = reply && reply.decision ? reply.decision : 'ask'
    const userReason = reply && reply.reason ? String(reply.reason) : ''
    if (decision === 'allow' || decision === 'deny') {
      const hookDecision = decision === 'allow'
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: userReason || 'Agentic-Island: 用户已拒绝' }
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: hookDecision } }))
    }
    process.exit(0)
  }

  // 其余生命周期：非阻塞实时上报
  let kind = 'notification'
  let detail = '需要你的注意'
  if (eventName === 'SessionStart') { kind = 'session'; detail = '会话已开始，待命中…' }
  else if (eventName === 'UserPromptSubmit') { kind = 'prompt'; detail = '对话中 · 正在处理你的消息…' }
  else if (eventName === 'Stop') { kind = 'stop'; detail = input.last_assistant_message || input['last-assistant-message'] || '本轮完成 · 待命中…' }
  else if (eventName === 'SessionEnd') { kind = 'end'; detail = '会话已结束' }
  else if (eventName === 'PostToolUse') { kind = 'activity'; detail = '正在工作…' }

  try {
    await postEvent(bridge, { token: bridge.token, backend, kind, sessionId, cwd, detail }, 2000)
  } catch {
    /* fail-open */
  }
  process.exit(0)
}

main().catch(() => process.exit(0))
