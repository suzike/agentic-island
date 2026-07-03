#!/usr/bin/env node
// Codex `notify` 程序：Codex 以 `node codex-notify.mjs <json>` 调用，最后一个参数是通知 JSON。
// 用于 Windows（Codex 的 hooks 在 Windows 被禁用，只能用 notify 收完成/通知事件；单向、不能审批）。
// 失败一律静默 exit 0。

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { request } from 'http'

const BRIDGE_FILE = join(homedir(), '.agentic-island', 'bridge.json')

const post = (bridge, payload) =>
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
      (res) => { res.on('data', () => {}); res.on('end', resolve) }
    )
    req.on('error', reject)
    req.setTimeout(4000, () => req.destroy(new Error('timeout')))
    req.write(body)
    req.end()
  })

async function main() {
  let bridge
  try {
    bridge = JSON.parse(readFileSync(BRIDGE_FILE, 'utf8'))
  } catch {
    process.exit(0)
  }

  // Codex 把通知 JSON 作为最后一个参数传入
  let notif = {}
  const arg = process.argv[process.argv.length - 1]
  try {
    notif = arg && arg.trim().startsWith('{') ? JSON.parse(arg) : {}
  } catch {
    notif = {}
  }

  const type = notif.type || notif['type'] || ''
  const cwd = notif.cwd || notif.workdir || process.cwd()
  const sessionId = notif['turn-id'] || notif.turn_id || notif.turn || ''
  const last = notif['last-assistant-message'] || notif.last_assistant_message || ''

  let kind = 'notification'
  let detail = '需要你的注意'
  if (type === 'agent-turn-complete' || type === 'turn-complete' || type === 'turn.completed') {
    kind = 'stop'
    detail = last ? `本轮完成 · ${String(last).slice(0, 40)}` : '本轮完成 · 待命中…'
  }

  try {
    await post(bridge, { token: bridge.token, backend: 'codex', kind, sessionId, cwd, detail })
  } catch {
    /* fail-open */
  }
  process.exit(0)
}

main().catch(() => process.exit(0))
