import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 安装版审批闭环：用已安装的 Agentic-Island 与它自带的 hooks-bin 跑一次真实 PermissionRequest，
 * 通过 CDP 在岛上点“允许”，断言 hook stdout 真的拿到 Claude Code 的 behavior=allow。
 *
 * 隔离方式：audit user-data + 临时 bridge 文件，不碰用户正在运行的实例与真实 bridge.json。
 * 没安装时直接跳过（CI 用源码测试覆盖协议）。
 */
const installedRoot = join(process.env.LOCALAPPDATA || '', 'Programs', 'Agentic-Island')
const exe = join(installedRoot, 'Agentic-Island.exe')
const forwarder = join(installedRoot, 'resources', 'hooks-bin', 'cc-forward.mjs')
const profile = await mkdtemp(join(tmpdir(), 'aiisland-installed-approval-'))
const bridgeFile = join(profile, 'bridge.json')
const port = 9360
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!(await access(exe).then(() => true).catch(() => false))) {
  console.log('安装版不存在，跳过 installed approval audit')
  process.exit(0)
}

class Cdp {
  constructor(url) { this.seq = 0; this.pending = new Map(); this.ws = new WebSocket(url) }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.ws.close() }
}

let child
let cdp
try {
  child = spawn(exe, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      AIISLAND_ALLOW_AUDIT_INSTANCE: '1',
      AIISLAND_AUDIT_USER_DATA: profile,
      AIISLAND_BRIDGE_FILE: bridgeFile,
      AIISLAND_SKIP_HOOKS: '1'
    },
    stdio: 'ignore',
    windowsHide: true
  })

  let target
  for (let index = 0; index < 120; index += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      target = targets.find((item) => item.type === 'page' && item.title === 'Agentic-Island')
      if (target) break
    } catch { /* 启动中 */ }
    await sleep(250)
  }
  assert.ok(target, '安装版渲染进程应可访问')
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await sleep(1800)
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }

  const bridge = JSON.parse(await readFile(bridgeFile, 'utf8'))
  assert.ok(bridge.port && bridge.token, '安装版应写出临时 bridge 发现文件')

  const hook = spawn('node', [forwarder, 'claude-code', 'PermissionRequest'], {
    env: { ...process.env, AIISLAND_BRIDGE_FILE: bridgeFile },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  hook.stdout.on('data', (chunk) => { stdout += String(chunk) })
  hook.stderr.on('data', (chunk) => { stderr += String(chunk) })
  hook.stdin.end(JSON.stringify({
    cwd: process.cwd(),
    session_id: 'installed-approval-probe',
    tool_name: 'Bash',
    tool_input: { command: 'echo installed-approval-ok' }
  }))

  let cardReady = false
  for (let index = 0; index < 40; index += 1) {
    const text = String(await evaluate('document.body.innerText'))
    if (/请求执行命令|installed-approval-ok/.test(text)) { cardReady = true; break }
    await sleep(250)
  }
  assert.ok(cardReady, '岛应显示真实权限审批卡')
  const visibleText = String(await evaluate('document.body.innerText')).replace(/\s+/g, ' ').slice(0, 900)
  console.log('审批卡现场:', visibleText)
  console.log('按钮:', await evaluate(`[...document.querySelectorAll('button')].map((node) => (node.textContent || '').trim()).filter(Boolean).slice(0, 60)`))
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => /允许/.test(node.textContent || ''))
    const fallback = [...document.querySelectorAll('div')].find((node) => node.children.length === 0 && /允许 Allow/.test(node.textContent || ''))
    const target = button || fallback
    if (!target) return 'missing'
    target.click()
    return 'clicked'
  })()`)
  assert.equal(clicked, 'clicked', '岛应存在“允许”按钮')

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`审批 hook 未在 10s 内返回；stderr=${stderr}`)), 10_000)
    hook.on('close', (code) => { clearTimeout(timer); resolve(code) })
  })
  assert.equal(exitCode, 0, '审批 hook 应正常退出')
  const decision = JSON.parse(stdout.trim())?.hookSpecificOutput?.decision
  assert.equal(decision?.behavior, 'allow', `岛内点击应回传 behavior=allow，实际 stdout=${stdout.slice(0, 200)}`)
  console.log('✓ 安装版 PermissionRequest → 岛内点击允许 → hook 收到 behavior=allow')
  console.log('✓ 临时 bridge / audit user-data 隔离，未触碰真实实例')
} finally {
  try { cdp?.close() } catch { /* */ }
  if (child?.pid) {
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }) } catch { /* */ }
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 }).catch(() => {})
}
