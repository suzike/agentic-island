import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

/**
 * 截图工坊的隔离 Electron 审计：把**批量美化**这条此前只有人工点击才能走通的链路补上端到端验证。
 *
 * 卡点原本是原生多选文件框（CDP 关不掉），现在主进程支持 `AIISLAND_AUDIT_OPEN_PATHS` 充当
 * "用户选了哪些文件"，快存也落到隔离导出目录——于是从"点按钮 → 读图 → 套观感 → 落盘"整条链路都可断言。
 *
 * 断言分两层：**链路是否跑通**（提示文案 + 落盘文件数）和**内容对不对**（把成品读回渲染层用
 * canvas 采像素，确认左半仍是源图的红、右半仍是源图的蓝——只查"文件存在"会被"写了个空白画布"骗过）。
 */
const root = resolve(import.meta.dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = await mkdtemp(join(tmpdir(), 'aiisland-shot-audit-'))
const work = await mkdtemp(join(tmpdir(), 'aiisland-shot-work-'))
const exportDir = join(work, 'exports')
const port = 9352
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

// ---------- 一个够用的 PNG 编码器（不引入依赖，只为了造测试图与读回成品尺寸）----------
const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c
  }
  return table
})()
const crc32 = (buffer) => {
  let c = -1
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const pngChunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const encodePng = (width, height, pixelAt) => {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y)
      const index = rowStart + 1 + x * 4
      raw[index] = r
      raw[index + 1] = g
      raw[index + 2] = b
      raw[index + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}
/** 读回 PNG 的 IHDR：既能验尺寸，也能确认它真是一张 PNG 而不是被写成别的字节。 */
const pngSize = (buffer) => {
  assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE), '成品应当是合法 PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

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

// 三张"左红右蓝"的测试图：批量之后成品的中线两侧应当仍然是红/蓝，否则说明套上去的是一张空白画布
const SOURCE_WIDTH = 240
const SOURCE_HEIGHT = 160
const RED = [255, 51, 85, 255]
const BLUE = [51, 102, 255, 255]
await mkdir(exportDir, { recursive: true })
const sourcePaths = []
for (let index = 1; index <= 3; index += 1) {
  const file = join(work, `source-${index}.png`)
  await writeFile(file, encodePng(SOURCE_WIDTH, SOURCE_HEIGHT, (x) => (x < SOURCE_WIDTH / 2 ? RED : BLUE)))
  sourcePaths.push(file)
}

const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  cwd: root,
  env: {
    ...process.env,
    AIISLAND_SKIP_HOOKS: '1',
    AIISLAND_ALLOW_AUDIT_INSTANCE: '1',
    AIISLAND_AUDIT_USER_DATA: profile,
    AIISLAND_AUDIT_EXPORT_DIR: exportDir,
    AIISLAND_AUDIT_OPEN_PATHS: sourcePaths.join(';'),
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
  const bodyText = () => evaluate('document.body.innerText')
  const clickButton = (text) => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === ${JSON.stringify(text)})
    button?.click()
    return Boolean(button)
  })()`)

  await sleep(900)
  await evaluate(`window.__shotAuditErrors=[];window.addEventListener('error',(event)=>window.__shotAuditErrors.push(event.message));window.addEventListener('unhandledrejection',(event)=>window.__shotAuditErrors.push(String(event.reason)));true`)
  // 先确保岛是展开的（收起状态没有头部按钮）
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'\\u0060',ctrlKey:true,bubbles:true}));true`)
  await sleep(700)

  // 录屏工坊自带一个"截图/录屏"分段控件：走它进图片工作台，就不必去驱动框选叠层
  const opened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('[title]')].find((item) => item.title?.includes('录屏工坊'))
    button?.click()
    return Boolean(button)
  })()`)
  assert.equal(opened, true, '应能从头部进入录屏工坊')
  await sleep(1_200)
  assert.match(await bodyText(), /截图工坊/, '工作台应显示截图工坊标题')

  assert.equal(await clickButton('截图'), true, '应能在工作台内切到截图（图片）分区')
  await sleep(600)

  // 工具栏溢出回归：新增动作按钮后头部曾是 nowrap，右侧的「重截」被挤出面板
  const toolbar = await evaluate(`(() => {
    const labels = ['文字卡片', '批量美化', '标尺', '长截图', '重截']
    const rects = labels.map((label) => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
      if (!button) return { label, missing: true }
      const rect = button.getBoundingClientRect()
      return { label, left: Math.round(rect.left), right: Math.round(rect.right), viewport: innerWidth }
    })
    return rects
  })()`)
  for (const item of toolbar) {
    assert.ok(!item.missing, `工具栏应包含「${item.label}」`)
    assert.ok(item.left >= -0.5 && item.right <= item.viewport + 0.5, `「${item.label}」不得溢出面板：${JSON.stringify(item)}`)
  }
  assert.match(await bodyText(), /批量美化/, '截图分区应显示批量美化入口')

  assert.equal(await clickButton('批量美化'), true, '批量美化应可点击')

  // flash 只留 2.4 秒，别用固定睡眠去撞它，直接轮询文案
  let batchText = ''
  for (let attempt = 0; attempt < 120; attempt += 1) {
    batchText = await bodyText()
    if (/批量完成/.test(batchText)) break
    await sleep(120)
  }
  assert.match(batchText, /批量完成：3 张/, `批量美化应报告三张成功，实际提示：${(batchText.match(/批量[^\n]*/) || [''])[0]}`)
  assert.doesNotMatch(batchText, /成功 \d+ 张，失败 [1-9]/, '本次审计不应出现失败张数')

  const produced = (await readdir(exportDir)).filter((name) => name.endsWith('.png'))
  assert.equal(produced.length, 3, `批量应落盘 3 张，实际 ${produced.length} 张：${produced.join(', ')}`)
  assert.deepEqual(produced.map((name) => name.replace(/^source-\d+/, '')).filter((name) => !/_card\.png$/.test(name)), [], '成品应带 _card 后缀')

  // 内容断言：把成品读回渲染层采样，确认源图内容真的被合成进去了
  for (const name of produced) {
    const bytes = await readFile(join(exportDir, name))
    const size = pngSize(bytes)
    assert.ok(size.width >= SOURCE_WIDTH && size.height >= SOURCE_HEIGHT, `${name} 的成品尺寸不应小于源图：${JSON.stringify(size)}`)
    const sampled = await evaluate(`(async () => {
      const img = new Image()
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('decode failed')); img.src = 'data:image/png;base64,${bytes.toString('base64')}' })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const context = canvas.getContext('2d')
      context.drawImage(img, 0, 0)
      const at = (xRatio, yRatio) => [...context.getImageData(Math.round(img.naturalWidth * xRatio), Math.round(img.naturalHeight * yRatio), 1, 1).data]
      return { width: img.naturalWidth, height: img.naturalHeight, left: at(0.35, 0.5), right: at(0.65, 0.5) }
    })()`)
    assert.ok(sampled, `${name} 应能在渲染层解码采样`)
    const [lr, , lb] = sampled.left
    const [rr, , rb] = sampled.right
    assert.ok(lr > lb, `${name} 中线上左侧应仍是源图的红（实际 rgb(${sampled.left.slice(0, 3).join(',')})）`)
    assert.ok(rb > rr, `${name} 中线上右侧应仍是源图的蓝（实际 rgb(${sampled.right.slice(0, 3).join(',')})）`)
  }

  // 再验一遍快存单张：它同样走隔离导出目录，别偷偷写进用户真实的"图片"文件夹
  const quick = await evaluate(`window.island.saveImageQuick('data:image/png;base64,' + ${JSON.stringify((await readFile(sourcePaths[0])).toString('base64'))}, 'audit-single', 'png')`)
  assert.equal(quick?.ok, true, `快存应成功：${JSON.stringify(quick)}`)
  assert.ok(String(quick.path).startsWith(exportDir), `快存应落到隔离目录，实际 ${quick.path}`)

  assert.deepEqual(await evaluate('window.__shotAuditErrors || []'), [], '批量美化期间不得出现 renderer 未处理异常')
  process.stdout.write('screenshot studio batch audit passed\n')
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
    try { await rm(profile, { recursive: true, force: true }); await rm(work, { recursive: true, force: true }); break } catch { await sleep(150) }
  }
}
