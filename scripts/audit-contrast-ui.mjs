// 全岛对比度审计：在隔离 Electron 实例里逐分区、逐主题实测"每个带文字的元素"的 WCAG 对比度。
// 覆盖范围包含 input/textarea 的 ::placeholder（它不在 textContent 里，脚本化 DOM 扫描极易漏掉，
// 而"输入框提示读不清"正是漏掉它的后果）。
//
// 判定依据是**真实渲染像素**：每个元素矩形内取"出现最多的量化色"当背景、与背景亮度差最大的像素当文字。
// 不用 CSS 颜色栈推断背景——渐变、半透明层、backdrop-filter 都要正确合成才能得到用户看到的颜色，
// 按颜色栈硬算会在玻璃面板上给出物理上不可能的结论（背景与文字同色 → 1.0:1），把报告变成噪声。
//
// 硬失败线是 3.0（无论字号，属于"看不清"），4.5 以下但因字号/弱化语义而设计的记为 warn 供人工复核：
// 低对比的分级提示（text.faint 等）是本项目的既定视觉语言，不能一律判失败，但必须可见地列出来。
//
// 用法：node scripts/audit-contrast-ui.mjs [--json out.json]

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = await mkdtemp(join(tmpdir(), 'aiisland-contrast-audit-'))
const port = 9361
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

/** 审计的主题：一个深色预设 + 唯一浅色预设（浅色下 accent 明度下移，是最容易出问题的一侧）。 */
const THEMES = ['aurora', 'control-center']
/** 逐分区审计（分区键与 App.tsx 的 TABS 一致）。 */
const TABS = ['agents', 'plan', 'ask', 'shortcuts', 'todos', 'notes', 'news', 'review', 'repos', 'term', 'settings']

class Cdp {
  constructor(url) { this.seq = 0; this.pending = new Map(); this.ws = new WebSocket(url) }
  async open() {
    await new Promise((resolveOpen, reject) => {
      this.ws.addEventListener('open', resolveOpen, { once: true })
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
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.ws.close() }
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const target = targets.find((item) => item.type === 'page' && item.title === 'Agentic-Island')
      if (target) return target
    } catch { /* renderer is still starting */ }
    await sleep(250)
  }
  throw new Error('等待 Electron renderer 超时')
}

/**
 * 页内采集器（作为字符串注入渲染进程执行）：只负责收集"带文字的元素的几何与排版信息"。
 * 对比度不在这里算——用 CSS 颜色栈推断背景会在渐变/玻璃面板上失真（半透明层、
 * 渐变端点、backdrop-filter 都要合成）；改成截屏后在 Node 侧量真实像素。
 */
const COLLECTOR = String(function collectTextElements() {
  const items = []
  /** 元素可测量吗：必须在某个滚动容器的可视区内，且在中心点能被命中测试选中。
      只判 display/visibility 不够——滚动区外的元素矩形照样返回坐标，采样会落到**旁边内容的像素**上，
      于是量出"文字与背景同色 → 1.0:1"这种不存在的结论。 */
  const measurable = (element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 3 || rect.height < 3) return null
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return null
    let opacity = 1
    let node = element
    let clip = { top: 0, left: 0, right: innerWidth, bottom: innerHeight }
    while (node && node !== document.documentElement) {
      opacity *= Number(getComputedStyle(node).opacity || '1')
      const overflow = getComputedStyle(node).overflow + getComputedStyle(node).overflowY
      if (/auto|scroll|hidden/.test(overflow)) {
        const box = node.getBoundingClientRect()
        clip = {
          top: Math.max(clip.top, box.top),
          left: Math.max(clip.left, box.left),
          right: Math.min(clip.right, box.right),
          bottom: Math.min(clip.bottom, box.bottom)
        }
      }
      node = node.parentElement
    }
    if (opacity < 0.25) return null
    const left = Math.max(clip.left, rect.left)
    const top = Math.max(clip.top, rect.top)
    const right = Math.min(clip.right, rect.right)
    const bottom = Math.min(clip.bottom, rect.bottom)
    if (right - left < 3 || bottom - top < 3) return null
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    if (!hit || !(hit === element || element.contains(hit) || hit.contains(element))) return null
    return { left, top, right, bottom }
  }
  const add = (element, text, kind) => {
    const box = measurable(element)
    if (!box) return
    const style = getComputedStyle(element)
    // 元素路径：报告里能直接定位到"哪一块 UI"，不然只看到一个 "1" 无法回源码。
    const chain = []
    let node = element
    for (let depth = 0; depth < 3 && node && node !== document.body; depth += 1) {
      const title = node.getAttribute?.('title')
      chain.unshift(`${node.tagName.toLowerCase()}${title ? `[${title.slice(0, 20)}]` : ''}`)
      node = node.parentElement
    }
    items.push({
      kind,
      text: (text || '').replace(/\s+/g, ' ').trim().slice(0, 32),
      x: Math.round(box.left),
      y: Math.round(box.top),
      w: Math.max(3, Math.round(box.right - box.left)),
      h: Math.max(3, Math.round(box.bottom - box.top)),
      fontSize: Math.round((parseFloat(style.fontSize) || 12) * 10) / 10,
      weight: Number(style.fontWeight) || 400,
      color: style.color,
      path: chain.join(' > ')
    })
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  let element = document.body
  while (element) {
    const own = [...element.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent || '').join('')
    if (own.trim()) add(element, own, 'text')
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const placeholder = element.getAttribute('placeholder')
      if (placeholder && placeholder.trim() && !element.value) add(element, placeholder, 'placeholder')
      else if (element.value) add(element, element.value, 'value')
    }
    element = walker.nextNode()
  }
  return items
})

/** 解析 8 位 PNG（非隔行）→ { width, height, data: RGBA }。只认 Electron 截图会产出的格式。 */
function decodePng(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'PNG 签名不匹配')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      assert.equal(body.readUInt8(8), 8, '只支持 8 位深 PNG')
      assert.equal(body.readUInt8(12), 0, '不支持隔行 PNG')
      colorType = body.readUInt8(9)
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  assert.ok(channels, `不支持的 PNG 颜色类型 ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const data = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]
    const line = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)))
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0
      const b = previous[i]
      const c = i >= channels ? previous[i - channels] : 0
      if (filter === 1) line[i] = (line[i] + a) & 0xff
      else if (filter === 2) line[i] = (line[i] + b) & 0xff
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (row * width + x) * 4
      data[target] = line[source]
      data[target + 1] = line[source + 1]
      data[target + 2] = line[source + 2]
      data[target + 3] = channels === 4 ? line[source + 3] : 255
    }
    previous = line
  }
  return { width, height, data }
}

const srgb = (value) => {
  const v = value / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/**
 * 在元素矩形内量真实像素：众数色（出现最多的量化色）当作背景，
 * 与背景亮度差距最大的像素当作文字（抗锯齿会稀释笔画，取极值才不会被平均掉）。
 */
function measureElement(image, item) {
  const left = Math.max(0, item.x)
  const top = Math.max(0, item.y)
  const right = Math.min(image.width, item.x + item.w)
  const bottom = Math.min(image.height, item.y + item.h)
  if (right - left < 3 || bottom - top < 3) return null
  const buckets = new Map()
  let extreme = null
  let extremeLuminance = 0
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * image.width + x) * 4
      const r = image.data[index]
      const g = image.data[index + 1]
      const b = image.data[index + 2]
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
      bucket.n += 1
      bucket.r += r
      bucket.g += g
      bucket.b += b
      buckets.set(key, bucket)
    }
  }
  if (!buckets.size) return null
  let best = null
  for (const bucket of buckets.values()) if (!best || bucket.n > best.n) best = bucket
  const background = { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }
  const backgroundLuminance = luminance(background.r, background.g, background.b)
  for (const bucket of buckets.values()) {
    const r = bucket.r / bucket.n
    const g = bucket.g / bucket.n
    const b = bucket.b / bucket.n
    const value = luminance(r, g, b)
    if (!extreme || Math.abs(value - backgroundLuminance) > Math.abs(extremeLuminance - backgroundLuminance)) {
      extreme = { r, g, b }
      extremeLuminance = value
    }
  }
  return {
    ratio: Math.round(contrast(extremeLuminance, backgroundLuminance) * 100) / 100,
    background: `rgb(${Math.round(background.r)},${Math.round(background.g)},${Math.round(background.b)})`,
    glyph: `rgb(${Math.round(extreme.r)},${Math.round(extreme.g)},${Math.round(extreme.b)})`
  }
}


const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  cwd: root,
  env: {
    ...process.env,
    AIISLAND_SKIP_HOOKS: '1',
    AIISLAND_ALLOW_AUDIT_INSTANCE: '1',
    AIISLAND_AUDIT_USER_DATA: profile,
    AIISLAND_BRIDGE_FILE: join(profile, 'bridge.json')
  },
  // 主进程会把 renderer 的 console.error / 崩溃转发到 stderr：审计失败时要能看到根因，
  // 否则"整页空白"只能靠猜。
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true
})
let hostErrors = ''
child.stderr?.on('data', (chunk) => { hostErrors += String(chunk) })

/**
 * 种子内容：只覆盖"确定形状"的键，其余一律沿用应用自己写回的规范状态。
 * 猜键名/猜形状会让水合抛错 → 整页空白 → 审计报告变成假绿，这比不测更糟。
 */
const contentSeed = {
  settings: { largeSize: true },
  islandWidth: 880,
  askThread: [
    { role: 'user', text: '我们应该如何降低一个新产品上线的失败风险？请给一个可执行的方案。', ts: Date.now() - 9_000 },
    {
      role: 'agent',
      modelLabel: 'deepseek-chat',
      blocks: [
        { t: 'think', text: '先把问题拆成"可逆/不可逆"两类风险，不可逆的优先用分阶段发布和小流量验证降低暴露面，再考虑观测与回滚。' },
        { t: 'h', text: '上线风险控制' },
        { t: 'p', text: '先明确成功标准与不可接受损失，再用分阶段发布、观测指标和回滚预案降低不可逆风险。' },
        { t: 'ul', items: ['识别关键假设', '小流量验证', '设置停止条件', '准备回滚路径'] },
        { t: 'code', text: 'kubectl rollout undo deploy/api --to-revision=3' },
        { t: 'note', text: '回滚预案必须在发布前演练一次，否则不可用。' }
      ],
      suggestions: ['先做小流量灰度吗？', '成功标准怎么定？'],
      ts: Date.now() - 8_000
    },
    { role: 'user', text: '如果只能做一件事呢？', quotes: [{ id: 'q1', text: '先用分阶段发布降低不可逆风险', note: '这条能不能落到具体动作？' }], ts: Date.now() - 3_000 }
  ],
  askSessions: [],
  todos: [
    { id: 1, text: '把对比度审计脚本接进 CI', done: false, priority: 1, tag: '质量', createdAt: Date.now() },
    { id: 2, text: '浅色主题下输入框提示已核对', done: true, priority: 3, tag: '视觉', createdAt: Date.now() }
  ],
  notes: [{ id: 1, emoji: '', title: '灵感便签示例', md: '便签正文用于抽样对比度。', color: 'amber', tags: ['质量'], createdAt: Date.now(), updatedAt: Date.now() }],
  shortcuts: [{ id: 'sh1', icon: '', name: '写周报', group: '写作', desc: '汇总本周进度', steps: [{ kind: 'ai', system: '你是周报助手', prompt: '帮我写一份周报' }], runCount: 0 }],
  repos: [{ path: 'E:\\proj\\my-repo' }],
  feedItems: [{ id: 'f1', title: '一条资讯标题', source: 'HN', url: 'https://example.com', ts: Date.now(), score: 8 }],
  activityLog: [{ id: 'a1', kind: 'agent', text: '完成一次重构', ts: Date.now() }],
  reviews: { [new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)]: '今天完成了对比度审计脚本。' },
  clipFavs: [{ id: 'c1', text: '一条剪贴板内容', tag: '代码', kind: 'text', ts: Date.now(), fav: true }],
  customThemes: []
}

let cdp
const report = { themes: {} }
try {
  const target = await waitForTarget()
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 940, deviceScaleFactor: 1, mobile: false })

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }

  /** 面板是否已挂载（岛默认收起时分区 DOM 不存在）。用 tab 数量判定：
      不能用 documentElement 属性——data-theme 在收起态也存在，会让断言假通过。 */
  const tabCount = () => evaluate(`document.querySelectorAll('[role="tab"][data-main-tab]').length`)
  /** 面板几何：收起态时分区 DOM 依然挂载但整块被移出视口（y<0 或高 0），
      此时读 innerText 仍有内容——只按文本断言会得到"隐藏 UI 上假通过"的审计结论。
      对比度必须量可见像素，所以这里把"面板真的画在视口里"当作前置条件。 */
  /** 可见视口几何。注意 `#main-tab-panel` 是**被滚动的内部内容**（设置分区可高达 2200px+），
      拿它判"是否在屏上"会误判；真正的可见区域是它外层那个 maxHeight 受限的 .ai-scroll。
      收起态时整块被 translateY(-101%) 移出视口，此时分区 DOM 仍在、innerText 也仍有内容——
      只按文本断言会得到"在隐藏 UI 上假通过"的审计结论，对比度必须量可见像素。 */
  const panelGeometry = () => evaluate(`(() => {
    const content = document.querySelector('#main-tab-panel')
    if (!content) return null
    const viewport = content.closest('.ai-scroll') || content
    const box = viewport.getBoundingClientRect()
    return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height), viewportWidth: innerWidth, viewportHeight: innerHeight }
  })()`)
  const onScreen = (box) => box && box.height > 80 && box.top >= 0 && box.left >= 0
    && box.left + box.width <= box.viewportWidth + 1 && box.top + box.height <= box.viewportHeight + 1

  /** 是否已"贴住"（钉住后面板不会在鼠标移开时收起）。按钮没有状态属性，
      但钉住时图标 transform 为 rotate(0deg)、未钉住是 rotate(38deg)。 */
  const pinnedNow = () => evaluate(`(() => {
    const button = [...document.querySelectorAll('[title="贴住 / 取消贴住"]')][0]
    const icon = button?.querySelector('svg')
    return icon ? String(icon.style.transform || '') : null
  })()`)

  /** 等待渲染层就绪：窗口刚起来时 React 还没挂载，此刻派发热键会丢事件，
      随后每次重试再派发一次就等于"开→关→开"来回翻转，面板永远量不到可见态。 */
  const waitForRenderer = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await evaluate(`Boolean(window.island) && Boolean(document.querySelector('#main-tab-panel')) && document.querySelectorAll('[role="tab"][data-main-tab]').length === ${TABS.length}`).catch(() => false)
      if (ready) return true
      await sleep(300)
    }
    return false
  }

  /** 展开并钉住主面板。只有"当前不在屏上"才发热键：已展开时再发一次会把它收起，
      多次重试就会在展开/收起之间来回翻转，导致审计随机地量到隐藏 UI。 */
  const openPanel = async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const box = await panelGeometry()
      if (await tabCount() === TABS.length && onScreen(box)) {
        const transform = await pinnedNow()
        if (transform && !transform.includes('rotate(0deg)')) {
          await evaluate(`[...document.querySelectorAll('[title="贴住 / 取消贴住"]')][0]?.click(); true`)
          await sleep(300)
        }
        return true
      }
      if (onScreen(box)) { await sleep(400); continue }
      // 展开热键的监听在 document 上；派发到 window 不会传播过去（window 是传播链终点）
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'\\u0060',ctrlKey:true,bubbles:true}));true`)
      await sleep(900)
    }
    return false
  }

  // 全新 profile 下应用没有状态变化就不会写盘，loadState 读不到东西——
  // 所以这里不依赖"读回默认态"，只注入内容种子；未覆盖的键一律保留应用自己的默认值。
  // 种子里每个键的形状都必须真实（id 为 number、priority 为 1|2|3 等）：
  // 形状错了水合就抛错 → 整页空白 → 审计报告变成假绿，这比不测更糟。
  const rendererReady = await waitForRenderer()
  if (!rendererReady) throw new Error(`渲染层未就绪\n宿主 stderr:\n${hostErrors.slice(-1500)}`)

  for (const theme of THEMES) {
    const seed = { ...contentSeed, theme }
    await evaluate(`window.island.saveState(${JSON.stringify(seed)}); true`)
    await cdp.send('Page.reload', { ignoreCache: true })
    await sleep(1_300)
    await evaluate(`window.__auditErrors=[];window.addEventListener('error',(event)=>window.__auditErrors.push(String(event.message)));window.addEventListener('unhandledrejection',(event)=>window.__auditErrors.push(String(event.reason)));true`)
    if (!(await openPanel())) {
      const diagnostics = await evaluate(`JSON.stringify({ errors: window.__auditErrors || [], geometry: (() => { const box = document.querySelector('#main-tab-panel')?.getBoundingClientRect(); return box ? [box.top, box.left, box.width, box.height] : null })(), body: (document.body.innerText || '').slice(0, 300) })`)
      throw new Error(`${theme}：主面板未真正展开（对比度必须在可见状态量）— ${diagnostics}\n宿主 stderr:\n${hostErrors.slice(-2000)}`)
    }
    assert.equal(await evaluate(`document.documentElement.dataset.themeMode || getComputedStyle(document.documentElement).getPropertyValue('--accent-text-max-l').trim()`), theme === 'control-center' ? '0.40' : '1', `${theme}：主题令牌未按预期生效`)

    const collected = []
    for (const tab of TABS) {
      const clicked = await evaluate(`(() => {
        const node = document.querySelector('[role="tab"][data-main-tab=${JSON.stringify(tab)}]')
        node?.click()
        return Boolean(node)
      })()`)
      // 分区点击失败/面板被收起都必须停下来说明，静默跳过会让报告看起来"全都测过了"
      if (!clicked) throw new Error(`${theme}：找不到分区 tab「${tab}」`)
      await sleep(360)
      if (!onScreen(await panelGeometry())) {
        const diagnostics = await evaluate(`JSON.stringify({ errors: window.__auditErrors || [], geometry: (() => { const box = document.querySelector('#main-tab-panel')?.getBoundingClientRect(); return box ? [Math.round(box.top), Math.round(box.left), Math.round(box.width), Math.round(box.height)] : null })() })`)
        if (!(await openPanel())) throw new Error(`${theme}：切到分区「${tab}」后面板不再可见 — ${diagnostics}\n宿主 stderr:\n${hostErrors.slice(-1500)}`)
      }
      const result = await evaluate(`(${COLLECTOR})()`)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
      const image = decodePng(Buffer.from(shot.data, 'base64'))
      const samples = []
      for (const item of result) {
        // emoji 是多色字形，像素里没有"文字色 vs 背景色"这对关系（测量只会得到彩色笔画与底的差），
        // 用 WCAG 判它没有意义；只保留含真实文字笔画（字母/数字/汉字/标点）的样本。
        if (!/[\p{L}\p{N}\p{P}]/u.test(item.text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ''))) continue
        const measured = measureElement(image, item)
        if (!measured) continue
        const large = item.fontSize >= 24 || (item.fontSize >= 18.66 && item.weight >= 700)
        samples.push({ ...item, ...measured, large })
      }
      const failures = samples.filter((sample) => sample.ratio < 3)
      const warnings = samples.filter((sample) => sample.ratio >= 3 && sample.ratio < 4.5)
      collected.push({ tab, samples, failures, warnings, sampled: samples.length })
    }
    report.themes[theme] = collected
    process.stdout.write(`\n=== 主题 ${theme} ===\n`)
    for (const entry of collected) {
      const worst = entry.warnings.length ? Math.min(...entry.warnings.map((sample) => sample.ratio)) : null
      process.stdout.write(`  ${entry.tab.padEnd(10)} 样本 ${String(entry.sampled).padStart(3)}  失败 ${entry.failures.length}  偏低 ${entry.warnings.length}${worst ? `（最低 ${worst}）` : ''}\n`)
    }
  }

  const jsonIndex = process.argv.indexOf('--json')
  if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
    await writeFile(process.argv[jsonIndex + 1], JSON.stringify(report, null, 2))
  }

  const failures = []
  for (const theme of THEMES) {
    for (const entry of report.themes[theme]) {
      for (const sample of entry.failures) failures.push({ theme, tab: entry.tab, ...sample })
    }
  }
  if (failures.length) {
    process.stdout.write('\n对比度低于 3.0 的样本（必须修复）：\n')
    for (const item of failures) {
      process.stdout.write(`  [${item.theme}/${item.tab}] ${item.ratio}:1  ${item.fontSize}px/${item.weight}${item.kind === 'placeholder' ? ' (placeholder)' : ''}  "${item.text}"  ← ${item.color}  @ ${item.path}\n`)
    }
  }
  const warnings = []
  for (const theme of THEMES) {
    for (const entry of report.themes[theme]) {
      for (const sample of entry.warnings) warnings.push({ theme, tab: entry.tab, ...sample })
    }
  }
  if (warnings.length) {
    process.stdout.write(`\n3.0–4.5 的样本（${warnings.length} 条，多为有意的弱化层级，列出供复核）：\n`)
    for (const item of warnings.slice(0, 40)) {
      process.stdout.write(`  [${item.theme}/${item.tab}] ${item.ratio}:1  ${item.fontSize}px  "${item.text}"\n`)
    }
  }
  process.stdout.write(`\n对比度审计完成：硬失败 ${failures.length} 条，偏低 ${warnings.length} 条。\n`)
  assert.equal(failures.length, 0, `存在 ${failures.length} 条低于 3.0 的文字对比度`)
} finally {
  try {
    await Promise.race([
      cdp?.send('Runtime.evaluate', { expression: 'window.island.quitApp(); true', returnByValue: true }),
      sleep(800)
    ])
  } catch { /* renderer may already be gone */ }
  cdp?.close()
  if (child.exitCode === null) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break } catch { await sleep(150) }
  }
}
