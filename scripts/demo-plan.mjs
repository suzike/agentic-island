#!/usr/bin/env node
// 计划审阅演示：向"正在运行的灵动岛"注入一条真实的计划审批事件（与 Claude Code 计划模式同一链路）。
// 用法：先 npm run dev 启动岛，另开终端运行 npm run demo:plan
// 岛的验收 / Agents 页会弹出计划卡，点「批准/继续规划」后本脚本打印你的裁决。

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { request } from 'http'

const BRIDGE_FILE = process.env.AIISLAND_BRIDGE_FILE || join(homedir(), '.agentic-island', 'bridge.json')
// 可选：把演示会话放进指定目录（隔离验证时指向临时 git 仓库，避免把演示改动写进真实项目）
const DEMO_CWD = process.env.AIISLAND_DEMO_CWD?.trim() || ''
const cwd = DEMO_CWD || process.cwd()
let bridge
try {
  bridge = JSON.parse(readFileSync(BRIDGE_FILE, 'utf8'))
} catch {
  console.error('未找到运行中的灵动岛（先 npm run dev）')
  process.exit(1)
}

const plan = `## 目标
为 API 网关增加请求限流，防止突发流量打垮下游服务（SourceID: SWR-101）。

## 实施步骤
1. **引入令牌桶中间件** —— 基于 Redis 的分布式令牌桶（\`rate-limiter-flexible\`）
2. **分级限流策略**
   - 匿名用户：60 次/分钟
   - 登录用户：600 次/分钟
   - 内部服务：白名单直通
3. **超限响应**：返回 \`429\` + \`Retry-After\` 头，日志打点到监控
4. **配置化**：阈值放 \`config/ratelimit.yaml\`，支持热更新

## 验证方式
- 单测：桶耗尽/补充/并发抢占三个用例
- 压测：k6 模拟 200 rps 突发，验证 429 比例与恢复时间

## 风险
- Redis 故障时降级为本地内存桶（fail-open，不阻塞业务）`

const body = JSON.stringify({
  token: bridge.token,
  backend: 'claude-code',
  kind: 'permission',
  sessionId: 'demo-plan-' + Date.now(),
  cwd,
  tool: 'ExitPlanMode',
  command: plan,
  detail: '📋 待你审阅的实施计划',
  isPlan: true,
  entry: 'cli'
})

console.log('已把演示计划推送到灵动岛 —— 去岛上的验收 / Agents 页审阅它…')

// 同一会话的后续事件：裁决 → 一轮结束（带最后回复，触发 git 变更采集）→ 会话结束（岛端留档）
const sessionId = JSON.parse(body).sessionId
const post = (payload) => new Promise((resolve, reject) => {
  const text = JSON.stringify({ token: bridge.token, backend: 'claude-code', sessionId, cwd, ...payload })
  const r = request(
    { host: '127.0.0.1', port: bridge.port, path: '/event', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } },
    (res) => { res.resume(); res.on('end', resolve) }
  )
  r.on('error', reject)
  r.write(text)
  r.end()
})
const req = request(
  { host: '127.0.0.1', port: bridge.port, path: '/event', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
  (res) => {
    let out = ''
    res.on('data', (c) => (out += c))
    res.on('end', () => {
      let ok = false
      try {
        const r = JSON.parse(out)
        ok = r.decision === 'allow' || r.decision === 'deny'
        console.log(r.decision === 'allow' ? '✅ 你批准了计划（真实场景下 Claude 将开始执行）' : r.decision === 'deny' ? '↩ 你选择了继续规划（真实场景下 Claude 会回去改方案）' : `结果：${out}`)
      } catch {
        console.log('岛响应：', out)
      }
      if (!ok) process.exit(0)
      // 演示留档链路：一轮结束（最后回复 + git 变更）→ 会话结束（落进验收记录）
      ;(async () => {
        if (DEMO_CWD) {
          writeFileSync(join(cwd, 'DEMO_CHANGE.md'), '# 演示改动\n\n- 令牌桶中间件\n- 分级限流策略\n')
        }
        await post({
          kind: 'notification',
          detail: '本轮完成 · 等待你的回复\n\n演示：已按计划实施。',
          turnEnd: true,
          lastReply: '演示：已按计划实施。\n\n- 已完成：令牌桶中间件与分级策略\n- 单测尚未覆盖并发抢占场景',
          check: { command: 'npm test', at: Date.now(), exitCode: 0, ms: 8200, ok: true }
        })
        await post({
          kind: 'activity',
          detail: '验证完成：npm run build · 退出 1',
          check: { command: 'npm run build', at: Date.now(), exitCode: 1, ms: 12300, ok: false, outputTail: 'error TS2339: Property limit does not exist on type RateLimitConfig.' }
        })
        // 留出 git 变更采集的时间（摘要异步回来，抢在它前面结束会话会丢掉文件清单）
        await new Promise((r) => setTimeout(r, 3000))
        await post({ kind: 'end', detail: '演示会话结束' })
        console.log('📋 演示会话已结束 —— 到「验收」页查看计划 → 实际改动 → 未验证项')
        process.exit(0)
      })().catch((e) => { console.error('留档演示失败：', e.message); process.exit(0) })
    })
  }
)
req.setTimeout(10 * 60 * 1000, () => { console.log('等待超时'); process.exit(0) })
req.on('error', (e) => { console.error('无法连接岛：', e.message); process.exit(1) })
req.write(body)
req.end()
