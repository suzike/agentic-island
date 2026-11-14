// 验证流水线节点跳转：来源/规则 → 编排对应分组；执行 → 进行中分段；拍板 → 待拍板分段。
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const profile = mkdtempSync(join(tmpdir(), 'aiisland-jump-'))
const port = 9393
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  cwd: root,
  env: { ...process.env, AIISLAND_SKIP_HOOKS: '1', AIISLAND_ALLOW_AUDIT_INSTANCE: '1', AIISLAND_AUDIT_USER_DATA: profile, AIISLAND_DEMO_SUPER: '1', AIISLAND_BRIDGE_FILE: join(profile, 'bridge.json') },
  stdio: 'ignore', windowsHide: false
})

class Cdp {
  constructor(url) { this.seq = 0; this.pending = new Map(); this.ws = new WebSocket(url) }
  async open() {
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }) })
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)); const w = this.pending.get(m.id); if (!w) return
      this.pending.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result)
    })
  }
  send(method, params = {}) { const id = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  close() { this.ws.close() }
}

async function waitTarget() {
  for (let i = 0; i < 80; i += 1) {
    try { const l = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()); const t = l.find((x) => x.type === 'page' && x.title === 'Agentic-Island'); if (t) return t } catch { /* */ }
    await sleep(250)
  }
  throw new Error('no target')
}

let cdp
const results = []
const check = (ok, label, detail = '') => { results.push({ ok, label, detail }); console.log(`${ok ? '✓' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`) }

try {
  const t = await waitTarget()
  cdp = new Cdp(t.webSocketDebuggerUrl); await cdp.open()
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result?.value
  }
  await evaluate(`window.island.saveState(${JSON.stringify({ theme: 'control-center', islandWidth: 880, settings: { largeSize: true, autoConnect: false }, superAgent: { enabled: true, url: '', ownerKey: '', pollMs: 15 } })}); true`)
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(1500)
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: String.fromCharCode(96), ctrlKey: true, bubbles: true })); true")
  await sleep(500)
  await evaluate(`[...document.querySelectorAll('[title="贴住 / 取消贴住"]')][0]?.click(); true`)
  await sleep(400)
  await evaluate(`(() => { const t=[...document.querySelectorAll('[role="tab"][data-main-tab]')].find(x=>x.textContent.trim().startsWith('循环')); t?.click(); return Boolean(t) })()`)
  await sleep(700)

  const clickNode = async (label) => evaluate(`(() => {
    const node = [...document.querySelectorAll('button[title]')].find((b) => (b.getAttribute('title') || '').startsWith(${JSON.stringify(label)} + ' · '))
    node?.click()
    return Boolean(node)
  })()`)

  const studioNav = async () => evaluate(`(() => {
    const root = document.querySelector('[data-config-studio]')
    if (!root) return null
    return { open: true, body: (root.innerText || '').slice(0, 400) }
  })()`)
  const closeStudio = async () => evaluate(`(() => { const c=[...document.querySelectorAll('[data-config-studio] button')].find(x=>(x.textContent||'').trim()==='关闭'); c?.click(); return Boolean(c) })()`)
  /** 用"当前分段的内容特征"判断落点（Segmented 选中态没有可测 DOM 属性） */
  const panelText = async () => evaluate(`(() => (document.querySelector('#main-tab-panel')?.innerText || '').slice(0, 1500))()`)
  /** 当前分段：Segmented 选中项字重 600、未选中 500（可测且稳定） */
  const activeSeg = async () => evaluate(`(() => {
    const buttons = [...document.querySelectorAll('#main-tab-panel button')].filter((b) => /^(待拍板|进行中|规则|近况)/.test((b.textContent || '').trim()))
    const hit = buttons.find((b) => Number(getComputedStyle(b).fontWeight) >= 600)
    return hit ? (hit.textContent || '').trim() : null
  })()`)
  // ① 来源节点 → 编排的「事件来源」
  check(await clickNode('来源'), '点击「来源」节点')
  await sleep(700)
  const s1 = await studioNav()
  check(!!s1?.open && /事件来源/.test(s1.body || '') && /新增来源/.test(s1.body || ''), '来源 → 打开编排并落在「事件来源」', s1 ? s1.body.slice(0, 60) : '未打开')
  await closeStudio(); await sleep(400)

  // ② 规则节点 → 编排的「规则 / 回路」
  check(await clickNode('规则'), '点击「规则」节点')
  await sleep(700)
  const s2 = await studioNav()
  check(!!s2?.open && /规则 \/ 回路/.test(s2.body || '') && /新增规则/.test(s2.body || ''), '规则 → 打开编排并落在「规则 / 回路」', s2 ? s2.body.slice(0, 60) : '未打开')
  await closeStudio(); await sleep(400)

  // ③ 执行节点 → 进行中分段
  check(await clickNode('执行'), '点击「执行」节点')
  await sleep(500)
  check(!(await studioNav())?.open, '执行 → 不打开编排浮层')
  check((await activeSeg() || '').includes('进行中'), '执行 → 落在「进行中」分段', await activeSeg() || '无')

  // ④ 拍板节点 → 待拍板分段
  check(await clickNode('拍板'), '点击「拍板」节点')
  await sleep(500)
  check((await activeSeg() || '').includes('待拍板'), '拍板 → 落在「待拍板」分段', await activeSeg() || '无')

  // ⑤ 复查节点 → 近况
  check(await clickNode('复查'), '点击「复查」节点')
  await sleep(500)
  check((await activeSeg() || '').includes('近况'), '复查 → 落在「近况」分段', await activeSeg() || '无')
} finally {
  try { await Promise.race([cdp?.send('Runtime.evaluate', { expression: 'window.island.quitApp(); true' }), sleep(1000)]) } catch { /* */ }
  cdp?.close(); await sleep(700)
  if (child.exitCode === null) {
    const { spawnSync } = await import('node:child_process')
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  }
}
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n❌ ${failed} 项跳转不正确` : '\n✓ 全部跳转正确')
process.exit(failed ? 1 : 0)
