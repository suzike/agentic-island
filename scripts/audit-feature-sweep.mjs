import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = await mkdtemp(join(tmpdir(), 'aiisland-feature-sweep-'))
const port = 9366
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TABS = ['agents', 'accept', 'ask', 'shortcuts', 'todos', 'notes', 'news', 'review', 'repos', 'term', 'settings']
const EXPECT = {
  agents: ['暂无活动 Agent'],
  accept: ['还没有可验收'],
  ask: ['我们应该如何降低'],
  shortcuts: ['写周报'],
  todos: ['把对比度审计'],
  notes: ['灵感便签示例'],
  news: ['一条资讯标题'],
  review: ['复盘'],
  repos: ['热门 GitHub'],
  term: ['PowerShell'],
  settings: ['运行状态']
}

class Cdp {
  constructor(url) { this.seq = 0; this.pending = new Map(); this.ws = new WebSocket(url) }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true })
      this.ws.addEventListener('error', rej, { once: true })
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
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.ws.close() }
}

const contentSeed = {
  settings: { largeSize: true },
  islandWidth: 880,
  askThread: [
    { role: 'user', text: '我们应该如何降低一个新产品上线的失败风险？请给一个可执行的方案。', ts: Date.now() - 9000 },
    { role: 'agent', modelLabel: 'deepseek-chat', blocks: [{ t: 'h', text: '上线风险控制' }, { t: 'p', text: '分阶段发布、观测指标和回滚预案。' }], suggestions: ['先做小流量灰度吗？'], ts: Date.now() - 8000 }
  ],
  askSessions: [],
  todos: [{ id: 1, text: '把对比度审计脚本接进 CI', done: false, priority: 1, tag: '质量', createdAt: Date.now() }],
  notes: [{ id: 1, emoji: '', title: '灵感便签示例', md: '便签正文。', color: 'amber', tags: ['质量'], createdAt: Date.now(), updatedAt: Date.now() }],
  shortcuts: [{ id: 'sh1', icon: '', name: '写周报', group: '写作', desc: '汇总本周进度', steps: [{ kind: 'ai', system: '你是周报助手', prompt: '帮我写一份周报' }], runCount: 0 }],
  repos: [{ path: 'E:\\proj\\my-repo' }],
  feedItems: [{ id: 'f1', title: '一条资讯标题', brief: '摘要', sourceName: 'HN', link: 'https://example.com', pubDate: Date.now(), score: 92, summary: '详细总结内容，用来验证展开状态。', processed: true, read: false }],
  activityLog: [{ id: 'a1', kind: 'agent', text: '完成一次重构', ts: Date.now() }],
  reviews: { [new Date(Date.now() - 86400000).toISOString().slice(0, 10)]: '今天完成了对比度审计脚本。' },
  customThemes: []
}

const child = spawn(electron, [root, `--remote-debugging-port=${port}`], {
  cwd: root,
  env: { ...process.env, AIISLAND_SKIP_HOOKS: '1', AIISLAND_ALLOW_AUDIT_INSTANCE: '1', AIISLAND_AUDIT_USER_DATA: profile, AIISLAND_BRIDGE_FILE: join(profile, 'bridge.json') },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true
})
let hostErrors = ''
child.stderr?.on('data', (chunk) => { hostErrors += String(chunk) })

let cdp
const findings = []
const add = (level, tab, text) => findings.push({ level, tab, text })

try {
  let target
  for (let i = 0; i < 120; i += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      target = targets.find((item) => item.type === 'page' && item.title === 'Agentic-Island')
      if (target) break
    } catch { /* waiting */ }
    await sleep(250)
  }
  assert.ok(target, 'renderer target')
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(`Boolean(window.island) && document.querySelectorAll('[role="tab"][data-main-tab]').length === ${TABS.length}`).catch(() => false)) break
    await sleep(300)
  }
  await evaluate(`window.island.saveState(${JSON.stringify(contentSeed)}); true`)
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(1400)
  await evaluate(`window.__auditErrors=[];window.addEventListener('error',(e)=>window.__auditErrors.push(String(e.message)));window.addEventListener('unhandledrejection',(e)=>window.__auditErrors.push(String(e.reason)));true`)

  const panelBox = () => evaluate(`(() => { const el=document.querySelector('#main-tab-panel'); if(!el) return null; const r=el.getBoundingClientRect(); return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height,iw:innerWidth,ih:innerHeight} })()`)
  const openPanel = async () => {
    for (let i = 0; i < 12; i += 1) {
      const box = await panelBox()
      if (box && box.height > 80 && box.top >= 0) {
        const pinned = await evaluate(`(() => { const b=document.querySelector('[title="贴住 / 取消贴住"]'); return b?.querySelector('svg')?.style.transform || '' })()`)
        if (pinned && !pinned.includes('rotate(0deg)')) { await evaluate(`document.querySelector('[title="贴住 / 取消贴住"]')?.click(); true`); await sleep(250) }
        return true
      }
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'\\u0060',ctrlKey:true,bubbles:true}));true`)
      await sleep(800)
    }
    return false
  }
  assert.ok(await openPanel(), `panel should open\n${hostErrors.slice(-1500)}`)

  const collect = async (tab) => {
    const data = await evaluate(`(() => {
      const panel = document.querySelector('#main-tab-panel')
      const root = panel || document.body
      const text = (root.innerText || '').replace(/\\s+/g, ' ')
      const r = panel?.getBoundingClientRect()
      const visible = (el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 1 && b.height > 1 }
      const all = [...root.querySelectorAll('*')].filter(visible)
      const overflowEls = all.filter((el) => {
        if (el.scrollWidth <= el.clientWidth + 8 || getComputedStyle(el).overflowX !== 'visible') return false
        const b = el.getBoundingClientRect()
        // 36px 图标外圈的光晕是 inset:-14 的装饰，不是内容溢出。
        if (b.width <= 60 && !(el.innerText || '').trim()) return false
        return true
      })
      const overflow = overflowEls.slice(0, 8).map((el) => {
        const b = el.getBoundingClientRect()
        return el.tagName + '.' + String(el.className || '').slice(0, 30) + ' [' + Math.round(b.width) + '/' + el.scrollWidth + '] ' + (el.innerText || '').trim().slice(0, 40)
      })
      const clipped = [...root.querySelectorAll('button,[role="button"]')].filter(visible).filter((el) => { const b = el.getBoundingClientRect(); return r && (b.right > r.right + 2 || b.left < r.left - 2) }).slice(0, 8).map((el) => (el.innerText || el.getAttribute('title') || el.tagName).trim().slice(0, 60))
      const unnamedEls = [...root.querySelectorAll('button')].filter(visible).filter((el) => !(el.innerText || '').trim() && !el.getAttribute('title') && !el.getAttribute('aria-label'))
      const unnamedButtons = unnamedEls.length
      const unnamedSamples = unnamedEls.slice(0, 6).map((el) => (el.outerHTML || '').slice(0, 180))
      const disabled = [...root.querySelectorAll('button')].filter((el) => el.disabled).length
      return { text, overflow, clipped, unnamedButtons, unnamedSamples, disabled, buttons: root.querySelectorAll('button').length, inputs: root.querySelectorAll('input,textarea,select').length, scrollTop: panel?.scrollTop || 0, bodyLen: text.length }
    })()`)
    const errors = await evaluate('window.__auditErrors || []')
    if (errors.length) add('P0', tab, `运行时异常：${errors.slice(0, 3).join(' | ')}`)
    if (/\\b(undefined|NaN)\\b/.test(data.text)) add('P1', tab, '界面文本出现 undefined/NaN')
    if (data.bodyLen < 40 && !data.text.includes('加载中')) add('P1', tab, `内容过少（${data.bodyLen} 字），可能空白/渲染失败`)
    for (const key of EXPECT[tab] || []) if (!data.text.includes(key)) add('P1', tab, `缺少关键内容「${key}」`)
    if (data.overflow.length) add('P2', tab, `横向溢出 ${data.overflow.length} 处：${data.overflow.join(' / ')}`)
    if (data.clipped.length) add('P2', tab, `按钮被裁 ${data.clipped.length} 个：${data.clipped.join(' / ')}`)
    if (data.unnamedButtons) add('P2', tab, `${data.unnamedButtons} 个图标按钮没有可访问名称：${(data.unnamedSamples || []).join(' || ')}`)
    return data
  }

  const report = {}
  for (const width of [960, 468]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 940, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    await openPanel()
    report[width] = {}
    for (const tab of TABS) {
      const clicked = await evaluate(`(() => { const n=document.querySelector('[role="tab"][data-main-tab=${JSON.stringify(tab)}]'); n?.click(); return Boolean(n) })()`)
      if (!clicked) { add('P0', tab, `找不到分区 tab`); continue }
      await sleep(tab === 'repos' ? 1400 : 420)
      const box = await panelBox()
      if (!box || box.height < 80 || box.top < 0) { add('P0', tab, `切到该分区后面板不可见`); continue }
      report[width][tab] = await collect(tab)
    }
  }

  // 资讯详情：点击首条后等待 1.6s，面板不能被自动收起
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 940, deviceScaleFactor: 1, mobile: false })
  await evaluate(`document.querySelector('[role="tab"][data-main-tab="news"]')?.click(); true`)
  await sleep(400)
  await evaluate(`(() => { const item=[...document.querySelectorAll('#main-tab-panel *')].find((el)=>el.children.length===0 && (el.textContent||'').includes('一条资讯标题')); item?.click(); return Boolean(item) })()`)
  await sleep(1700)
  const newsBox = await panelBox()
  if (!newsBox || newsBox.height < 80) add('P0', 'news', '点击资讯详情后面板被自动收起')
  const detailOpen = await evaluate(`(document.querySelector('#main-tab-panel')?.innerText || '').includes('详细总结内容')`)
  if (!detailOpen) add('P2', 'news', '点击资讯后未看到详细总结内容（可能点击未命中）')

  // 命令面板：Ctrl+K 打开后 Esc 关闭
  await evaluate(`document.activeElement?.blur?.();document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));true`)
  await sleep(350)
  const palette = await evaluate(`Boolean(document.querySelector('input[placeholder*="搜索分区"]')) || Boolean(document.querySelector('[data-command-palette]'))`)
  if (!palette) add('P2', 'global', 'Ctrl+K 未打开命令面板（或缺少可识别标记）')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`)

  const openCommand = async (query, needle) => {
    await evaluate(`document.activeElement?.blur?.();document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));true`)
    await sleep(300)
    const typed = await evaluate(`(() => {
      const input = document.querySelector('input[placeholder*="搜索分区"]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(query)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!typed) return false
    await sleep(350)
    const clicked = await evaluate(`(() => {
      const node = [...document.querySelectorAll('div[data-sel]')].find((el) => (el.innerText || '').includes(${JSON.stringify(needle)}))
      if (!node) return false
      node.click()
      return true
    })()`)
    await sleep(1200)
    return clicked
  }
  const closeOverlay = async () => {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`)
    await sleep(300)
    await evaluate(`document.querySelector('button[title="关闭"]')?.click(); true`)
    await sleep(300)
  }

  if (await openCommand('录屏', '录屏工坊')) {
    const recorderText = await evaluate(`document.body.innerText || ''`)
    for (const key of ['我的场景', '多画面叠加', '虚拟摄像头（OBS）', '区域遮罩', '原始画面']) {
      if (!recorderText.includes(key)) add('P1', 'recorder', `缺少入口「${key}」`)
    }
    await closeOverlay()
  } else add('P2', 'global', '命令面板找不到“录屏工坊”')

  const overlays = [
    { query: 'Markdown', needle: 'Markdown 工作台', keys: ['文档标题', '导出'], placeholders: ['文档标题'] },
    { query: '工程计算', needle: '工程计算', keys: ['计算', '变量'] },
    { query: '学习中心', needle: '学习中心', keys: ['学习', '复习'] },
    { query: '闪念胶囊', needle: '闪念胶囊', keys: ['想到', '记录'] },
    { query: '第二大脑', needle: '第二大脑检索', keys: ['搜索', '知识'], placeholders: ['问你的第二大脑'] },
    { query: '知识库管理', needle: '知识库管理', keys: ['知识库', '接入'] },
    { query: '主题设计器', needle: '主题设计器', keys: ['主题', '色彩'] }
  ]
  for (const overlay of overlays) {
    if (!(await openCommand(overlay.query, overlay.needle))) {
      add('P2', 'global', `命令面板找不到“${overlay.needle}”`)
      continue
    }
    const text = await evaluate(`document.body.innerText || ''`)
    const placeholderFound = (overlay.placeholders || []).length
      ? await evaluate(`(${JSON.stringify(overlay.placeholders)}).some((text) => Boolean(document.querySelector('input[placeholder*="' + text + '"]')))`)
      : false
    if (!placeholderFound && !overlay.keys.some((key) => text.includes(key))) add('P2', `overlay:${overlay.needle}`, `打开后找不到内容关键词：${overlay.keys.join(' / ')}`)
    await closeOverlay()
  }

  const hasScreenshotCommand = await evaluate(`(() => {
    document.activeElement?.blur?.();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));
    return true
  })()`)
  if (hasScreenshotCommand) {
    await sleep(250)
    const input = await evaluate(`(() => {
      const el = document.querySelector('input[placeholder*="搜索分区"]')
      if (!el) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, '截图')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(300)
    const found = input && await evaluate(`[...document.querySelectorAll('div[data-sel]')].some((el) => (el.innerText || '').includes('截图工坊'))`)
    if (!found) add('P2', 'global', '命令面板找不到“截图工坊”')
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`)
  }

  const errors = await evaluate('window.__auditErrors || []')
  if (errors.length) add('P0', 'global', `累计运行时异常：${errors.slice(0, 5).join(' | ')}`)
  const meaningfulHostErrors = hostErrors.split('\n').filter((line) => line.trim() && !/DevTools listening on ws:\/\//.test(line)).join('\n')
  if (meaningfulHostErrors.trim()) add('P2', 'host', `主进程 stderr 有输出：${meaningfulHostErrors.trim().slice(-300)}`)

  console.log(JSON.stringify({ findings, report }, null, 2))
  if (findings.some((f) => f.level === 'P0')) process.exitCode = 1
} finally {
  try { cdp?.send('Runtime.evaluate', { expression: 'window.island.quitApp(); true', returnByValue: true }) } catch { /* */ }
  await sleep(600)
  if (child.pid) { try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }) } catch { /* */ } }
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 }).catch(() => {})
}
