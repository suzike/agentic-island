#!/usr/bin/env node
// 验收台「补验证 → 岛内续跑」端到端审计（隔离实例 + 沙箱 git 仓库）。
// 流程：注入演示计划 → 在验收页批准 → 展开记录 → 打开补验证 → 读取追问 →
//       点击「在岛内续跑」（伪造会话 id，必失败）→ 断言流式输出/退出码回显 → 关闭实例。
// 用法：node scripts/audit-acceptance-followup.mjs
// 说明：伪会话 id 会让 claude 以非零退出码结束，用来验证"启动→输出→结束"整条链路；
//       不会碰到任何真实会话。

import { spawn, execFileSync } from 'child_process'
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const debugPort = 9231
const userData = mkdtempSync(join(tmpdir(), 'aiisland-accept-audit-'))
const sandbox = mkdtempSync(join(tmpdir(), 'aiisland-accept-repo-'))
const bridgeFile = join(userData, 'bridge.json')

let child = null
let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${msg}${cond || !detail ? '' : `\n    ${detail}`}`)
  if (!cond) failed++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const killTree = () => {
  if (!child?.pid) return
  try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }) } catch { /* */ }
  child = null
}

const loadJson = async (url) => {
  const res = await fetch(url)
  return res.json()
}

const connectCdp = async () => {
  let targets = null
  for (let i = 0; i < 120; i++) {
    try {
      targets = await loadJson(`http://127.0.0.1:${debugPort}/json`)
      if (targets?.[0]?.webSocketDebuggerUrl) break
    } catch { /* 还没起来 */ }
    await sleep(500)
  }
  if (!targets?.[0]?.webSocketDebuggerUrl) throw new Error('CDP 未就绪：Electron 可能没启动')
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP 连接失败')) })
  const send = (method, params = {}) => new Promise((r) => {
    const id = ++seq
    pending.set(id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  const evalJs = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text)
    return res.result?.result?.value
  }
  const waitFor = async (expression, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const val = await evalJs(expression)
      if (val) return val
      await sleep(300)
    }
    return null
  }
  return { ws, evalJs, waitFor }
}

const git = (...args) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf8' })
const prepareRepo = () => {
  git('init', '-q')
  git('config', 'user.email', 'audit@example.com')
  git('config', 'user.name', 'audit')
  writeFileSync(join(sandbox, 'app.txt'), 'line1\nline2\n')
  git('add', '-A')
  git('commit', '-qm', 'init')
}

const runDemo = () => new Promise((resolveDemo, reject) => {
  const demo = spawn(process.execPath, [join(root, 'scripts', 'demo-plan.mjs')], {
    cwd: root,
    env: { ...process.env, AIISLAND_BRIDGE_FILE: bridgeFile, AIISLAND_DEMO_CWD: sandbox },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  demo.stdout.on('data', (c) => { out += c })
  demo.stderr.on('data', (c) => { out += c })
  demo.on('close', (code) => (code === 0 ? resolveDemo(out) : reject(new Error(`demo 退出 ${code}: ${out}`))))
  setTimeout(() => { try { demo.kill() } catch { /* */ } }, 60_000)
})

async function main() {
  if (!existsSync(electron)) throw new Error(`找不到 Electron：${electron}`)
  prepareRepo()

  child = spawn(electron, ['.', `--remote-debugging-port=${debugPort}`], {
    cwd: root,
    env: {
      ...process.env,
      AIISLAND_SKIP_HOOKS: '1',
      AIISLAND_ALLOW_AUDIT_INSTANCE: '1',
      AIISLAND_AUDIT_USER_DATA: userData,
      AIISLAND_BRIDGE_FILE: bridgeFile
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (c) => { stderr += c })
  child.on('exit', (code, signal) => {
    if (code && code !== 0) stderr += `\n[electron exit ${code} ${signal || ''}]`
  })

  let cdp = null
  try {
    cdp = await connectCdp()
  } catch (e) {
    console.error(`\n无法启动隔离实例：${e.message}`)
    console.error(stderr.split('\n').filter(Boolean).slice(-4).join('\n') || '(无 stderr)')
    console.error('\n这类失败通常是本机会话的窗口资源问题（Electron 连 --version 都崩），重启登录后再跑一次。')
    failed++
    return
  }
  const { evalJs, waitFor, ws } = cdp

  try {
    ok(!!(await waitFor(`!!document.querySelector('[role="tab"]')`)), '隔离实例启动，渲染层可访问')
    ok(await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('验收')); t&&t.click(); return !!t})()`), '切到验收分区')

    const demoPromise = runDemo()
    ok(!!(await waitFor(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('批准计划')); if(!b) return false; b.click(); return true})()`, 30000)), '演示计划送达并批准')
    const demoOut = await demoPromise

    ok(!!(await waitFor(`[...document.querySelectorAll('span')].some(e=>/^未验证 \\d+$/.test(e.textContent.trim()))`, 30000)), '会话结束生成验收记录')
    await evalJs(`(()=>{const b=[...document.querySelectorAll('span')].find(e=>/^未验证 \\d+$/.test(e.textContent.trim())); b&&b.parentElement.parentElement.click(); return true})()`)
    await waitFor(`document.body.innerText.includes('实际改动')`, 10000)
    const body = await evalJs('document.body.innerText')
    ok(
      body.includes('实际改动 · 1') && body.includes('DEMO_CHANGE.md'),
      '改动按会话基线归属：只报演示新增文件',
      `sandbox=[${readdirSync(sandbox).join(', ')}]\n    demo=${demoOut.trim().split('\n').join(' | ')}\n    body=${body.slice(body.indexOf('实际改动'), body.indexOf('实际改动') + 220).split('\n').join(' | ')}`
    )
    ok(!body.includes('app.txt'), '基线之前的改动没有被算进来')
    ok(body.includes('验证记录 · 2') && body.includes('退出 1'), '验证记录带退出码')
    ok(body.includes('SWR-101'), '计划里的需求编号在卡片上回链')

    ok(await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='补验证'); if(!b) return false; b.click(); return true})()`), '打开补验证')
    const prompt = await evalJs(`(()=>{const t=[...document.querySelectorAll('textarea')].pop(); return t?t.value:''})()`)
    ok(!!prompt && prompt.includes('## 需要补的验证') && prompt.includes('## 完成标准'), '生成可编辑的追问')
    ok(!!prompt && prompt.includes('退出码') && prompt.includes('不要用'), '追问要求给出真实结果')

    ok(await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='在岛内续跑'); if(!b||b.disabled) return false; b.click(); return true})()`), '点击在岛内续跑')
    const runText = await waitFor(`(()=>{const t=document.body.innerText; if(/补验证进行中/.test(t)) return false; return /补验证结束|补验证异常/.test(t) ? t : false})()`, 60000)
    ok(!!runText, '续跑流式输出回到卡片')
    ok(!!runText && /补验证结束 · 退出 1|补验证异常/.test(runText), '伪会话被 CLI 拒绝后如实显示失败', runText ? runText.split('\n').filter((l) => l.includes('补验证')).join(' | ') : '')

    // ===== 计划项转待办 =====
    ok(await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('计划转待办')); if(!b) return false; b.click(); return true})()`), '计划项转待办入口可用')
    await sleep(500)
    ok(!!(await evalJs(`[...document.querySelectorAll('button')].some(e=>/已加 \\d+ 条|已在待办/.test(e.textContent))`)), '转待办给出条数反馈')
    await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('待办')); t&&t.click(); return 1})()`)
    await sleep(600)
    const todoBody = await evalJs('document.body.innerText')
    ok(/令牌桶|限流/.test(todoBody), '计划步骤出现在待办里', todoBody.split('\n').filter(Boolean).slice(12, 26).join(' | '))

    // ===== 验收凭证 =====
    await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('验收')); t&&t.click(); return 1})()`)
    await sleep(500)
    await evalJs(`(()=>{const b=[...document.querySelectorAll('span')].find(e=>/^未验证 \\d+$/.test(e.textContent.trim())); b&&b.parentElement.parentElement.click(); return 1})()`)
    await sleep(400)
    ok(await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='存验收凭证'); if(!b) return false; b.click(); return true})()`), '存验收凭证入口可用')
    await sleep(500)
    await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('灵感便签')); t&&t.click(); return 1})()`)
    await sleep(700)
    const certBody = await evalJs('document.body.innerText')
    ok(certBody.includes('验收凭证'), '验收凭证已落到便签')
    ok(certBody.includes('需求追溯') && certBody.includes('SWR-101'), '凭证带回需求追溯小节')

    // ===== 设置页：验收规则 + 门禁开关 =====
    await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('设置')); t&&t.click(); return 1})()`)
    // 设置页内容较多，等它真正渲染出来再断言，避免固定 sleep 撞上慢一帧
    const settingsBody = await waitFor(`(()=>{const t=document.body.innerText; return (t.includes('验收规则与门禁') || t.includes('补充规则')) ? t : false})()`, 10000) || ''
    ok(settingsBody.includes('验收规则') && settingsBody.includes('补充规则'), '设置页有验收规则入口')
    ok(settingsBody.includes('内置判定覆盖') || settingsBody.includes('MATLAB'), '规则说明交代内置判定范围')
    ok(await evalJs(`(()=>{
      const rows = [...document.querySelectorAll('div')].filter(d => d.textContent.includes('验证必须全部退出 0') && d.querySelector('button'))
      const row = rows.sort((a, b) => a.textContent.length - b.textContent.length)[0]
      if (!row) return false
      row.querySelector('button').click()
      return true
    })()`), '打开「验证必须全部退出 0」门禁')
    await sleep(400)

    // ===== 验收门禁：失败命令 → 标记已验收二段确认（此时只有演示记录）=====
    await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('验收')); t&&t.click(); return 1})()`)
    await sleep(500)
    await evalJs(`(()=>{const b=[...document.querySelectorAll('span')].find(e=>/^未验证 \\d+$/.test(e.textContent.trim())); b&&b.parentElement.parentElement.click(); return 1})()`)
    await sleep(500)
    ok((await evalJs('document.body.innerText')).includes('门禁未满足'), '门禁命中在卡片上明示')
    ok(await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='标记已验收'); if(!b) return false; b.click(); return true})()`), '点击标记已验收')
    await sleep(400)
    const armedBody = await evalJs('document.body.innerText')
    ok(armedBody.includes('确认仍然验收'), '门禁未满足时先要求二次确认')
    ok(!(await evalJs(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='已验收')`)), '二次确认前不会直接置为已验收')
    ok(await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='仍然验收'); if(!b) return false; b.click(); return true})()`), '确认仍然验收')
    await sleep(500)
    ok(await evalJs(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='已验收')`), '确认后状态变为已验收')
    ok((await evalJs('document.body.innerText')).includes('仍然验收：'), '带未满足项验收会留痕')

    // ===== 同一会话续跑：证据并回原记录 =====
    await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('验收')); t&&t.click(); return 1})()`)
    await sleep(400)
    const bridgeInfo = JSON.parse(readFileSync(bridgeFile, 'utf8'))
    const post = (payload) => fetch(`http://127.0.0.1:${bridgeInfo.port}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: bridgeInfo.token, backend: 'claude-code', sessionId: 'audit-merge-1', cwd: sandbox, ...payload })
    })
    const round = async (exitCode, reply, extraChecks = []) => {
      const pending = post({ kind: 'permission', tool: 'ExitPlanMode', command: '## 计划\n- [ ] 做事', isPlan: true })
      await waitFor(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('批准计划')); if(!b) return false; b.click(); return true})()`, 20000)
      await pending
      await post({
        kind: 'notification', detail: '本轮完成', turnEnd: true, lastReply: reply,
        check: { command: 'npm run build', at: Date.now(), exitCode, ms: 1200, ok: exitCode === 0, outputTail: exitCode === 0 ? undefined : 'error TS2339' }
      })
      for (const check of extraChecks) {
        await post({ kind: 'activity', detail: `验证完成：${check.command}`, check: { ...check, at: Date.now() } })
      }
      await sleep(2500)
      await post({ kind: 'end', detail: '会话结束' })
      await sleep(900)
    }
    await round(1, '第一轮：构建失败', [
      { command: 'matlab -batch "runtests(\'tests\')"', exitCode: 0, ms: 5400, ok: true },
      { command: 'gcc -c src/a.c -o a.o', exitCode: 0, ms: 800, ok: true },
      { command: 'git status', exitCode: 0, ms: 120, ok: true }
    ])
    await evalJs(`(()=>{const b=[...document.querySelectorAll('span')].find(e=>/^未验证 \\d+$/.test(e.textContent.trim())); b&&b.parentElement.parentElement.click(); return 1})()`)
    await sleep(500)
    ok((await evalJs('document.body.innerText')).includes('验证命令失败：npm run build'), '第一轮失败进入未验证项')
    await evalJs(`(()=>{const b=[...document.querySelectorAll('span')].find(e=>/^未验证 \\d+$/.test(e.textContent.trim())); b&&b.parentElement.parentElement.click(); return 1})()`)
    await round(0, '第二轮：构建通过')
    // 合并后那条已经没有未验证项，按"补验证 N"徽标定位它
    ok(await evalJs(`(()=>{const b=[...document.querySelectorAll('span')].find(e=>/^补验证 \\d+$/.test(e.textContent.trim())); if(!b) return false; b.parentElement.parentElement.click(); return true})()`), '定位到合并后的记录')
    await sleep(600)
    const mergedBody = await evalJs('document.body.innerText')
    ok(mergedBody.includes('补验证 1'), '续跑证据并回原记录（补验证 1 次）')
    ok(!mergedBody.includes('验证命令失败：npm run build'), '补验证通过后旧失败不再挂着', mergedBody.slice(mergedBody.indexOf('验证记录'), mergedBody.indexOf('验证记录') + 200).split('\n').join(' | '))
    ok(mergedBody.includes('退出 0') && mergedBody.includes('退出 1'), '两轮结果都留痕')
    ok(mergedBody.includes('matlab -batch') && mergedBody.includes('gcc -c src/a.c'), 'MATLAB/Simulink 与 C/C++ 命令被识别为验证证据')
    ok(!mergedBody.includes('git status'), '非验证命令不会混进验证记录')

    // ===== 搜索过滤 =====
    const searched = await evalJs(`(()=>{
      const el = document.querySelector('input[placeholder^="搜索项目"]')
      if (!el) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, 'DEMO_CHANGE')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    ok(searched, '验收记录有搜索框')
    await sleep(500)
    ok((await evalJs('document.body.innerText')).includes('验收记录 · 1'), '搜索按文件名过滤生效')
    await evalJs(`(()=>{
      const el = document.querySelector('input[placeholder^="搜索项目"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(400)

    // ===== 复盘接入验收 =====
    await evalJs(`(()=>{const t=[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('复盘')); t&&t.click(); return 1})()`)
    await sleep(800)
    ok((await evalJs('document.body.innerText')).includes('验收 · 未验证'), '复盘事实卡出现验收统计')

  } finally {
    try { ws.close() } catch { /* */ }
  }
}

main()
  .catch((e) => { console.error('审计异常:', e); failed++ })
  .finally(async () => {
    killTree()
    await sleep(1200)
    for (const dir of [userData, sandbox]) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 上偶发占用，忽略 */ }
    }
    if (failed > 0) {
      console.error(`\n${failed} 项失败`)
      process.exit(1)
    }
    console.log('\n✅ 验收台「补验证 → 岛内续跑」端到端审计通过')
  })
