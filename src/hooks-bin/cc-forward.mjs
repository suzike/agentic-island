#!/usr/bin/env node
// Claude Code hook 转发脚本。由 Claude Code 以 `node cc-forward.mjs <backend> <EventName>` 调用。
// 从 stdin 读 hook 事件 JSON，转发到岛的本地桥，阻塞等待用户裁决，再向 stdout 打印决定。
//
// 关键：任何异常都必须 fail-open（静默 exit 0）—— 岛没开/桥不可达时绝不能卡住用户的 CLI。

import { readFileSync, appendFileSync, writeFileSync, openSync, readSync, closeSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { request } from 'http'
import { execFile } from 'child_process'

// AIISLAND_BRIDGE_FILE：测试专用的发现文件覆盖（避免测试桥覆盖真实 bridge.json）
const BRIDGE_FILE = process.env.AIISLAND_BRIDGE_FILE || join(homedir(), '.agentic-island', 'bridge.json')
const EVENTS_LOG = join(homedir(), '.agentic-island', 'events.log')
const T0 = Date.now()
// 延迟诊断日志：记录 hook 启动与桥响应耗时（排查"终端先弹、岛后弹"用）
const trace = (msg) => {
  try { appendFileSync(EVENTS_LOG, `${new Date().toISOString()} +${Date.now() - T0}ms ${msg}\n`) } catch { /* */ }
}

const readStdin = () =>
  new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    // 若无 stdin（某些事件），50ms 后放行
    setTimeout(() => resolve(data), 50)
  })

const postEvent = (bridge, payload) =>
  new Promise((resolve, reject) => {
    // 附带父进程 PID（= 调用本 hook 的 claude 进程）与入口类型（cli/桌面端）
    const body = JSON.stringify({ ...payload, ppid: process.ppid, entry: process.env.CLAUDE_CODE_ENTRYPOINT || '' })
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
    // 审批可能耗时数分钟，不设短超时
    req.setTimeout(10 * 60 * 1000, () => req.destroy(new Error('timeout')))
    req.write(body)
    req.end()
  })

async function main() {
  const backend = process.argv[2] || 'claude-code'
  const eventName = process.argv[3] || 'PreToolUse'

  let bridge
  try {
    bridge = JSON.parse(readFileSync(BRIDGE_FILE, 'utf8'))
  } catch {
    process.exit(0) // 岛未运行 → fail-open
  }

  const raw = await readStdin()
  let input = {}
  try {
    input = raw ? JSON.parse(raw) : {}
  } catch {
    input = {}
  }

  const cwd = input.cwd || process.cwd()
  const sessionId = input.session_id || ''
  trace(`${eventName} tool=${input.tool_name || '-'} sess=${String(sessionId).slice(0, 8)}`)

  // 工具名 → 人类可读的活动描述
  const activityDetail = (tool) => {
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return '正在编辑文件…'
    if (/^Read$/.test(tool)) return '正在读取文件…'
    if (/^(Grep|Glob|LS)$/.test(tool)) return '正在检索代码…'
    if (/^(WebFetch|WebSearch)$/.test(tool)) return '正在联网查询…'
    if (/Task|Agent/.test(tool)) return '正在派生子任务…'
    if (/Bash/.test(tool)) return '正在运行命令…'
    return `正在使用 ${tool}…`
  }

  // 工具 → 审批卡展示的 { command(展示在等宽框), detail(一句说明) }
  const describeTool = (tool, input) => {
    const ti = input.tool_input || {}
    if (tool === 'Bash') { const c = ti.command || ti.cmd || ''; return { command: c, detail: `请求执行命令：${c}` } }
    if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) { const f = ti.file_path || ti.path || ''; return { command: `${tool}  ${f}`, detail: `请求修改文件：${f || '(未知)'}` } }
    if (tool === 'WebFetch') { const u = ti.url || ''; return { command: u, detail: `请求联网抓取：${u}` } }
    if (tool === 'WebSearch') { const q = ti.query || ''; return { command: q, detail: `请求联网搜索：${q}` } }
    if (tool.startsWith('mcp__')) {
      const parts = tool.split('__'); const name = parts.slice(1).join(' · ')
      const arg = ti.path || ti.url || ti.query || ti.command || ''
      return { command: `${tool}${arg ? '  ' + arg : ''}`, detail: `请求使用 MCP 工具：${name}` }
    }
    // 兜底：展示参数 JSON（截断），保证审批卡永远有具体内容可看
    let args = ''
    try { args = JSON.stringify(ti).slice(0, 260) } catch { /* */ }
    return { command: `${tool}${args && args !== '{}' ? '  ' + args : ''}`, detail: `请求使用工具：${tool}` }
  }

  // ===== 工具审批：灵动岛接管"所有会弹确认的工具"，只读类放行 =====
  if (eventName === 'PreToolUse') {
    const tool = input.tool_name || ''
    // 计划审阅：ExitPlanMode 携带 plan 全文 → 岛上作为"实施计划待审阅"审批
    if (tool === 'ExitPlanMode' || tool === 'exit_plan_mode') {
      const plan = (input.tool_input && (input.tool_input.plan || input.tool_input.markdown)) || ''
      let reply
      try {
        // 审批阻塞期间并行解析终端句柄（hook 存活、进程链完整，零额外延迟）
        ;[reply] = await Promise.all([
          postEvent(bridge, { token: bridge.token, backend, kind: 'permission', sessionId, cwd, tool, command: plan, detail: '📋 待你审阅的实施计划', isPlan: true }),
          ensureTermInfo(bridge, backend, sessionId, cwd)
        ])
      } catch {
        process.exit(0)
      }
      const decision = reply && reply.decision ? reply.decision : 'ask'
      if (decision === 'allow' || decision === 'deny') {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: decision === 'allow' ? 'Agentic-Island: 批准计划' : 'Agentic-Island: 继续规划' } }))
      }
      process.exit(0)
    }
    // Claude 向你提问（AskUserQuestion）：自动放行该提问工具，同时把问题原文推到岛上（等待你回复）
    if (tool === 'AskUserQuestion') {
      const qs = (input.tool_input && input.tool_input.questions) || []
      const text = Array.isArray(qs)
        ? qs.map((q) => {
            const opts = Array.isArray(q.options) ? q.options.map((o) => (o && o.label) || o).filter(Boolean).join(' / ') : ''
            return `${q.question || ''}${opts ? `（${opts}）` : ''}`
          }).filter(Boolean).join('\n')
        : ''
      await Promise.all([
        report(bridge, { backend, kind: 'notification', sessionId, cwd, detail: text ? `Claude 提问：${text}` : 'Claude 向你提问，等待你的回复…' }),
        ensureTermInfo(bridge, backend, sessionId, cwd)
      ])
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Agentic-Island: 提问工具放行' } }))
      process.exit(0)
    }
    // 只读/无害工具：不拦，只上报活动（与 Claude Code 默认自动放行一致，避免比原生更啰嗦）
    if (/^(Read|Grep|Glob|LS|NotebookRead|NotebookRead|TodoWrite|TodoRead|Task|TaskOutput|TaskList|TaskGet|BashOutput|KillShell|EnterPlanMode|SlashCommand|Skill|ListMcpResourcesTool|ReadMcpResourceTool)$/.test(tool)) {
      await report(bridge, { backend, kind: 'activity', sessionId, cwd, tool, detail: activityDetail(tool) })
      process.exit(0)
    }
    // 其余（Bash / Edit / Write / WebFetch / MCP 等）→ 岛上审批（阻塞）
    // 注意：不再读取 settings.permissions.allow 做静默放行——用户的 allow 列表常含裸工具名
    // (Bash/Edit/Write…) = "全量放行"，那样会让灵动岛失去审批意义、几乎一切都不再弹。
    // 灵动岛的定位就是接管审批；要少点确认请用"本会话自动放行只读/安全命令"开关。
    const { command, detail } = describeTool(tool, input)
    let reply
    try {
      // 审批阻塞期间并行解析终端句柄
      ;[reply] = await Promise.all([
        postEvent(bridge, { token: bridge.token, backend, kind: 'permission', sessionId, cwd, tool, command, detail }),
        ensureTermInfo(bridge, backend, sessionId, cwd)
      ])
    } catch {
      process.exit(0) // 桥不可达 → fail-open，交回 CLI 自身提示
    }
    const decision = reply && reply.decision ? reply.decision : 'ask'
    const userReason = reply && reply.reason ? String(reply.reason) : ''
    if (decision === 'allow' || decision === 'deny') {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: decision,
            permissionDecisionReason:
              decision === 'allow' ? 'Agentic-Island: 用户已允许' : userReason || 'Agentic-Island: 用户已拒绝'
          }
        })
      )
    }
    process.exit(0)
  }

  // ===== Notification：按类型区分 =====
  if (eventName === 'Notification') {
    const nt = input.notification_type || ''
    // 权限类由 PreToolUse 审批处理、登录成功无需打扰 —— 都跳过，避免和审批重复或误报"等待"
    if (nt === 'permission_prompt' || nt === 'auth_success') process.exit(0)
    // idle_prompt / elicitation_dialog 等 = 真的在等你输入/反问你
    await Promise.all([
      report(bridge, { backend, kind: 'notification', sessionId, cwd, detail: input.message ? String(input.message) : '等待你的回复…' }),
      ensureTermInfo(bridge, backend, sessionId, cwd)
    ])
    process.exit(0)
  }

  // ===== 其余生命周期事件：非阻塞实时上报 =====
  let kind = 'notification'
  let detail = input.message ? String(input.message) : '等待你的回复…'
  let withTermInfo = false
  if (eventName === 'SessionStart') { kind = 'session'; detail = '会话已开始，待命中…'; withTermInfo = true }
  else if (eventName === 'UserPromptSubmit') { kind = 'prompt'; detail = '对话中 · 正在处理你的消息…' }
  else if (eventName === 'Stop') {
    // 每轮结束 = Claude 在等你回复 → 立即弹岛提醒（不等 CC 自身迟到的 idle 通知），并附上最后一条回复
    const last = lastAssistantText(input.transcript_path)
    kind = 'notification'
    detail = last ? `本轮完成 · 等待你的回复\n\n${last}` : '本轮完成 · 等待你的回复…'
    withTermInfo = true
    // 标记轮次结束：岛端据此采集 git 变更小结
    const jobs2 = [report(bridge, { backend, kind, sessionId, cwd, detail, turnEnd: true }), ensureTermInfo(bridge, backend, sessionId, cwd)]
    await Promise.all(jobs2)
    process.exit(0)
  }
  else if (eventName === 'SubagentStop') { kind = 'activity'; detail = '子任务完成…' }
  else if (eventName === 'SessionEnd') { kind = 'end'; detail = '会话已结束' }
  else if (eventName === 'PostToolUse') { kind = 'activity'; detail = activityDetail(input.tool_name || '') }

  const jobs = [report(bridge, { backend, kind, sessionId, cwd, detail })]
  if (withTermInfo) jobs.push(ensureTermInfo(bridge, backend, sessionId, cwd))
  await Promise.all(jobs)
  process.exit(0)
}

// 非阻塞上报（失败静默）
async function report(bridge, payload) {
  try {
    await postEvent(bridge, { token: bridge.token, ...payload })
  } catch {
    /* fail-open */
  }
}

/* ================= 终端窗口句柄（跳转用） =================
 * 关键教训：hook 的父进程常是 cmd.exe 中转，hook 一结束就死 → 之前存 ppid 事后反查必失败。
 * 正确做法：hook 存活期间（进程链都活着）沿父链解析终端窗口 HWND，缓存 + 补报给岛。
 * HWND 在终端窗口存续期间一直有效，与进程无关。 */

const resolveHwnd = (pid) =>
  new Promise((resolve) => {
    const ps = `
$ErrorActionPreference='SilentlyContinue'
$terminals = @('WindowsTerminal','pwsh','powershell','cmd','conhost','wt','ConEmu64','ConEmu','alacritty','Hyper','wezterm-gui','wezterm','Code','Claude','ChatGPT','Codex')
$cur = ${pid}
for ($i=0; $i -lt 12; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur"
  if (-not $p) { break }
  $name = $p.Name -replace '\\.exe$',''
  if ($terminals -contains $name) {
    $proc = Get-Process -Id $cur
    if ($proc -and $proc.MainWindowHandle -ne 0) { [int64]$proc.MainWindowHandle; break }
  }
  if (-not $p.ParentProcessId) { break }
  $cur = [int]$p.ParentProcessId
}`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 5000 }, (_err, stdout) => {
      const out = (stdout || '').toString().trim()
      resolve(/^\d+$/.test(out) ? out : '')
    })
  })

// 解析并补报终端句柄：按会话缓存（10 分钟），岛重启（token 变化）后自动重报一次
async function ensureTermInfo(bridge, backend, sessionId, cwd) {
  try {
    const sid = String(sessionId || process.ppid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'x'
    const cacheFile = join(homedir(), '.agentic-island', `tc-${sid}.json`)
    const tok = String(bridge.token).slice(0, 8)
    let cached = null
    try { cached = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch { /* */ }

    if (cached && Date.now() - cached.ts < 600000) {
      if (cached.tok === tok) return // 本轮岛已知晓，无需重报
      if (cached.hwnd) {
        await postEvent(bridge, { token: bridge.token, backend, kind: 'terminfo', sessionId, cwd, termHwnd: cached.hwnd })
      }
      try { writeFileSync(cacheFile, JSON.stringify({ ...cached, tok })) } catch { /* */ }
      return
    }

    const hwnd = await resolveHwnd(process.ppid)
    try { writeFileSync(cacheFile, JSON.stringify({ hwnd, ts: Date.now(), tok })) } catch { /* */ }
    if (hwnd) {
      await postEvent(bridge, { token: bridge.token, backend, kind: 'terminfo', sessionId, cwd, termHwnd: hwnd })
    }
  } catch {
    /* fail-open */
  }
}

/* ============ 从会话 transcript 尾部提取 Claude 最后一条回复 ============ */
function lastAssistantText(transcriptPath) {
  try {
    if (!transcriptPath) return ''
    const size = statSync(transcriptPath).size
    const want = Math.min(size, 131072) // 尾部 128KB
    const fd = openSync(transcriptPath, 'r')
    const buf = Buffer.alloc(want)
    readSync(fd, buf, 0, want, size - want)
    closeSync(fd)
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(lines[i])
        if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
          const text = j.message.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim()
          if (text) return text.slice(0, 500)
        }
      } catch { /* 跳过不完整行 */ }
    }
    return ''
  } catch {
    return ''
  }
}

main().catch(() => process.exit(0))
