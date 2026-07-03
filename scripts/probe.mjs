// 连接诊断探针（供用户在自己终端运行：npm run probe）。
// 全局接入 Claude Code + Codex，启动本地桥，把每个到达的事件实时打印到控制台，
// 并自动放行任何权限请求（避免测试时卡住你的 CLI）。Ctrl+C 退出并卸载 hooks 还原。
//
// 用法：
//   1) 这个终端跑：npm run probe
//   2) 另开一个终端，cd 到任意项目，跑：claude 或 codex，让它执行点什么
//   3) 看这个终端有没有实时打印出事件 —— 有 = 连接成功

import { join } from 'path'
import { AgentsStore } from '../src/main/agents-store.ts'
import { BridgeServer } from '../src/main/bridge-server.ts'
import { installClaudeCode, uninstallClaudeCode, installCodex, uninstallCodex, installCodexNotify, uninstallCodexNotify } from '../src/main/hook-installer.ts'

const CC = join(process.cwd(), 'src', 'hooks-bin', 'cc-forward.mjs')
const CX = join(process.cwd(), 'src', 'hooks-bin', 'codex-forward.mjs')
const CXN = join(process.cwd(), 'src', 'hooks-bin', 'codex-notify.mjs')

installClaudeCode(CC)
installCodexNotify(CXN)
if (process.platform !== 'win32') installCodex(CX)

const store = new AgentsStore()
const bridge = new BridgeServer(store)

let n = 0
store.on('change', () => {
  const agents = store.snapshot().agents
  const latest = agents[0]
  if (latest) {
    n += 1
    console.log(`#${n}  [${latest.status}] ${latest.tool} · ${latest.proj} — ${latest.detail}${latest.command ? '  ⟶ ' + latest.command : ''}`)
  }
  for (const a of agents) {
    if (a.status === 'needs_approval' && a.requestId) store.decide(a.requestId, 'allow')
  }
})

const info = await bridge.start()
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(' Agentic-Island 连接诊断探针已就绪')
console.log(' · 已全局接入 Claude Code (~/.claude/settings.json) + Codex (~/.codex/hooks.json)')
console.log(` · 本地桥监听 127.0.0.1:${info.port}`)
console.log(' · 现在另开一个终端跑 claude / codex，让它做点事')
console.log(' · 下面会实时打印收到的事件（权限请求会自动放行，不会卡住）')
console.log(' · 按 Ctrl+C 退出并卸载 hooks 还原')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

const cleanup = () => {
  try { uninstallClaudeCode(CC); uninstallCodex(CX); uninstallCodexNotify() } catch { /* */ }
  bridge.stop()
  console.log('\n已卸载 hooks 并退出，全局配置已还原。')
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
