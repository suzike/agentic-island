import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = await mkdtemp(join(tmpdir(), 'aiisland-ask-method-audit-'))
const port = 9351
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

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

const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  cwd: root,
  env: {
    ...process.env,
    AIISLAND_SKIP_HOOKS: '1',
    AIISLAND_ALLOW_AUDIT_INSTANCE: '1',
    AIISLAND_AUDIT_USER_DATA: profile,
    AIISLAND_BRIDGE_FILE: join(profile, 'bridge.json')
  },
  stdio: 'ignore',
  windowsHide: true
})

let cdp
try {
  const target = await waitForTarget()
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 920, height: 900, deviceScaleFactor: 1, mobile: false })

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }
  const clickButton = (text) => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().includes(${JSON.stringify(text)}))
    button?.click()
    return Boolean(button)
  })()`)
  const bodyText = () => evaluate('document.body.innerText')
  const seed = {
    settings: { largeSize: true },
    islandWidth: 760,
    fullscreen: false,
    askThread: [
      { role: 'user', text: '我们应该如何降低一个新产品上线的失败风险？', ts: Date.now() - 2_000 },
      {
        role: 'agent',
        blocks: [
          { t: 'h', text: '上线风险控制' },
          { t: 'p', text: '先明确成功标准与不可接受损失，再用分阶段发布、观测指标和回滚预案降低不可逆风险。' },
          { t: 'ul', items: ['识别关键假设', '小流量验证', '设置停止条件', '准备回滚路径'] }
        ],
        ts: Date.now() - 1_000
      }
    ]
  }

  await evaluate(`window.island.saveState(${JSON.stringify(seed)}); true`)
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(1_000)
  await evaluate(`window.__askAuditErrors=[];window.addEventListener('error',(event)=>window.__askAuditErrors.push(event.message));window.addEventListener('unhandledrejection',(event)=>window.__askAuditErrors.push(String(event.reason)));true`)
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'\\u0060',ctrlKey:true,bubbles:true}));true`)
  await sleep(700)
  assert.equal(await evaluate(`(() => {
    const tab=[...document.querySelectorAll('[role="tab"][data-main-tab]')].find((item)=>item.textContent?.trim().startsWith('问答'))
    tab?.click()
    return Boolean(tab)
  })()`), true, '应能切换到问答模块')
  await sleep(450)

  assert.match(await bodyText(), /本轮回答方法/, '输入区应显示本轮回答方法入口')
  assert.equal(await clickButton('默认回答'), true, '默认回答入口应可展开')
  await sleep(180)
  const selectorText = await bodyText()
  assert.match(selectorText, /智能推荐/, '回答方法选择器应提供本地智能推荐')
  assert.match(selectorText, /情景规划/, '当前风险问题应推荐情景规划')
  assert.match(selectorText, /仅影响下一次发送/, '应明确方法的单轮作用域')
  assert.equal(await clickButton('推理求解'), true, '应能切换回答方法分类')
  await sleep(100)
  assert.match(await bodyText(), /第一性原理/, '推理求解分类应包含第一性原理')
  assert.equal(await clickButton('第一性原理'), true, '应能选择第一性原理')
  await sleep(150)
  const selectedText = await bodyText()
  assert.match(selectedText, /第一性原理/, '选择后输入区应清楚显示当前方法')
  assert.match(selectedText, /基本事实 → 约束 → 从零推导/, '选择后应显示方法的预期结构')

  const composer = await evaluate(`(() => {
    const marker = [...document.querySelectorAll('*')].find((item) => item.children.length === 0 && item.textContent?.trim() === '本轮回答方法')
    const panel = marker?.parentElement?.parentElement
    const rect = panel?.getBoundingClientRect()
    return rect ? { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth, scrollWidth: panel.scrollWidth } : null
  })()`)
  assert.ok(composer, '应找到回答方法输入面板')
  assert.ok(composer.left >= 0 && composer.right <= composer.viewport + 1, `回答方法面板不得越界：${JSON.stringify(composer)}`)
  assert.ok(composer.scrollWidth <= composer.width + 1, `回答方法面板不得产生水平溢出：${JSON.stringify(composer)}`)

  assert.equal(await clickButton('分析回答'), true, '回答气泡应能打开分析中心')
  await sleep(180)
  const analysisText = await bodyText()
  assert.match(analysisText, /回答分析中心/, '应显示回答分析中心')
  assert.match(analysisText, /事实证据/, '分析中心应包含证据类方法')
  assert.match(analysisText, /风险压力/, '分析中心应包含风险类方法')
  assert.match(analysisText, /决策取舍/, '分析中心应包含决策类方法')
  assert.match(analysisText, /不改变后续上下文/, '应明确气泡分析不污染主会话')
  if (process.env.AIISLAND_AUDIT_SCREENSHOT) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    await writeFile(process.env.AIISLAND_AUDIT_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(120)
  const narrowAnalysis = await evaluate(`(() => {
    const method = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('验证与验收计划'))
    const grid = method?.parentElement
    const panel = grid?.parentElement
    if (!grid || !panel) return null
    const rect = panel.getBoundingClientRect()
    return {
      panelWidth: rect.width,
      panelScrollWidth: panel.scrollWidth,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
    }
  })()`)
  assert.ok(narrowAnalysis, '窄宽度下应找到分析方法网格')
  assert.equal(narrowAnalysis.columns, 1, `窄宽度下方法卡片应自动切为单列：${JSON.stringify(narrowAnalysis)}`)
  assert.ok(narrowAnalysis.panelScrollWidth <= narrowAnalysis.panelWidth + 1, `窄宽度下分析面板不得水平溢出：${JSON.stringify(narrowAnalysis)}`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 920, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(120)

  assert.equal(await clickButton('分析回答'), true, '应能关闭分析中心')
  await sleep(100)
  assert.equal(await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')].filter((item) => item.textContent?.trim() === '更多')
    buttons.at(-1)?.click()
    return buttons.length > 0
  })()`), true, '回答气泡应能打开更多菜单')
  await sleep(100)
  const moreText = await bodyText()
  assert.match(moreText, /上下文/, '更多菜单应按任务分组')
  assert.match(moreText, /引用整条回答/, '更多菜单应提供整条引用')
  assert.match(moreText, /从这里建分支/, '更多菜单应保留气泡级 Fork')
  assert.match(moreText, /保存到知识库/, '更多菜单应保留知识沉淀')

  assert.deepEqual(await evaluate('window.__askAuditErrors || []'), [], '问答方法交互期间不得出现 renderer 未处理异常')
  process.stdout.write('ask methodology Electron UI audit passed\n')
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
