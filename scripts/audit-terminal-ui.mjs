import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = await mkdtemp(join(tmpdir(), 'aiisland-terminal-audit-'))
const port = 9347
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
    return new Promise((resolveSend, reject) => { this.pending.set(id, { resolve: resolveSend, reject }); this.ws.send(JSON.stringify({ id, method, params })) })
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

const child = spawn(electron, [root, `--remote-debugging-port=${port}`], {
  cwd: root,
  env: { ...process.env, AIISLAND_SKIP_HOOKS: '1', AIISLAND_ALLOW_AUDIT_INSTANCE: '1', AIISLAND_AUDIT_USER_DATA: profile },
  stdio: 'ignore',
  windowsHide: true
})

let cdp
try {
  const target = await waitForTarget()
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Input.setIgnoreInputEvents', { ignore: false })
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }
  const clickText = async (text) => evaluate(`(() => { const el = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(${JSON.stringify(text)})); el?.click(); return Boolean(el) })()`)
  const ensurePanelOpen = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await evaluate(`Boolean(document.querySelector('[role="tablist"]'))`)) break
      await sleep(100)
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await evaluate(`document.querySelector('[role="tablist"]')?.closest('[data-solid]')?.style.transform.startsWith('translateY(0')`)) return
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'\\u0060',ctrlKey:true,bubbles:true}));true`)
      for (let poll = 0; poll < 12; poll += 1) {
        await sleep(100)
        if (await evaluate(`document.querySelector('[role="tablist"]')?.closest('[data-solid]')?.style.transform.startsWith('translateY(0')`)) return
      }
    }
    assert.equal(await evaluate(`document.querySelector('[role="tablist"]')?.closest('[data-solid]')?.style.transform.startsWith('translateY(0')`), true, '灵动岛应处于展开状态')
  }

  await evaluate(`window.__terminalAuditErrors=[];window.addEventListener('error',(event)=>window.__terminalAuditErrors.push(event.message));window.addEventListener('unhandledrejection',(event)=>window.__terminalAuditErrors.push(String(event.reason)));true`)
  await sleep(800)
  await ensurePanelOpen()
  assert.equal(await evaluate(`(() => { const tab=[...document.querySelectorAll('[role="tab"][data-main-tab]')].find((item)=>item.textContent?.trim().startsWith('终端'));tab?.click();return Boolean(tab) })()`), true)
  await sleep(900)
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-host]'))`), true, '首次启动应创建空白终端')
  const terminalPoint = await evaluate(`(() => { const rect=document.querySelector('[data-terminal-host]').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+Math.min(80,rect.height/2)} })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: terminalPoint.x, y: terminalPoint.y })
  await sleep(100)

  await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus({preventScroll:true});true`)
  await sleep(100)
  const before = await evaluate(`(() => { const host=document.querySelector('[data-terminal-host]');const rect=host.getBoundingClientRect();const outer=host.closest('.ai-scroll');const frame=document.querySelector('[data-terminal-frame]').getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,scrollTop:outer?.scrollTop,frameY:frame.y} })()`)
  const geometrySamples = []
  for (const character of "Write-Output 'terminal-audit'") {
    await cdp.send('Input.insertText', { text: character })
    await sleep(24)
    geometrySamples.push(await evaluate(`(() => { const host=document.querySelector('[data-terminal-host]');const frame=document.querySelector('[data-terminal-frame]');const screen=document.querySelector('.xterm-screen');const outer=host.closest('.ai-scroll');const hr=host.getBoundingClientRect();const fr=frame.getBoundingClientRect();const sr=screen.getBoundingClientRect();return {hostX:hr.x,hostY:hr.y,hostW:hr.width,hostH:hr.height,frameY:fr.y,screenW:sr.width,screenH:sr.height,scrollTop:outer?.scrollTop,transform:frame.closest('[data-solid]')?.style.transform} })()`))
  }
  assert.equal(new Set(geometrySamples.map((sample) => JSON.stringify(sample))).size, 1, `逐字符输入期间终端几何发生变化：${JSON.stringify(geometrySamples)}`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(800)
  const after = await evaluate(`(() => { const host=document.querySelector('[data-terminal-host]');const rect=host.getBoundingClientRect();const outer=host.closest('.ai-scroll');const frame=document.querySelector('[data-terminal-frame]').getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,scrollTop:outer?.scrollTop,frameY:frame.y,text:document.body.innerText} })()`)
  assert.deepEqual({ x: after.x, y: after.y, width: after.width, height: after.height, scrollTop: after.scrollTop, frameY: after.frameY }, before, '终端输入不得引起画布晃动或缩放')
  assert.match(after.text, /exit 0/, 'PowerShell 提示符应回传命令退出码')

  const firstSessionId = await evaluate(`document.querySelector('[data-terminal-host]')?.dataset.terminalSessionId`)
  assert.equal(await evaluate(`(() => { const button=document.querySelector('[title^="新建终端标签"]');button?.click();return Boolean(button) })()`), true)
  await sleep(140)
  const secondSessionId = await evaluate(`document.querySelector('[data-terminal-host]')?.dataset.terminalSessionId`)
  assert.notEqual(secondSessionId, firstSessionId, '新建终端标签后必须切换到独立会话')
  assert.equal(await evaluate(`document.body.innerText.includes('__AIIslandPrompt')`), false, 'PowerShell 初始化脚本不得回显到新终端')
  await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus({preventScroll:true});true`)
  const secondSamples = []
  for (const character of "Write-Output 'second-terminal-audit'") {
    await cdp.send('Input.insertText', { text: character })
    await sleep(24)
    secondSamples.push(await evaluate(`(() => { const host=document.querySelector('[data-terminal-host]');const frame=document.querySelector('[data-terminal-frame]');const screen=document.querySelector('.xterm-screen');const outer=host.closest('.ai-scroll');const hr=host.getBoundingClientRect();const fr=frame.getBoundingClientRect();const sr=screen.getBoundingClientRect();return {session:host.dataset.terminalSessionId,hostX:hr.x,hostY:hr.y,hostW:hr.width,hostH:hr.height,frameY:fr.y,screenW:sr.width,screenH:sr.height,scrollTop:outer?.scrollTop,transform:frame.closest('[data-solid]')?.style.transform} })()`))
  }
  assert.equal(new Set(secondSamples.map((sample) => JSON.stringify(sample))).size, 1, `第二终端逐字符输入期间几何发生变化：${JSON.stringify(secondSamples)}`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(500)
  assert.match(await evaluate('document.body.innerText'), /exit 0/, '第二终端输入必须被 PowerShell 接收并正常执行')

  assert.equal(await evaluate(`(() => { const button=[...document.querySelectorAll('[title]')].find((item)=>item.title?.includes('命令工具、历史与收藏'));button?.click();return Boolean(button) })()`), true)
  await sleep(250)
  for (const view of ['命令', '历史', '收藏', '工作区', '项目任务', '输出摘要', 'AI', '恢复与隐私']) {
    assert.equal(await clickText(view), true, `工具抽屉应包含 ${view}`)
    await sleep(80)
  }
  assert.equal(await clickText('命令'), true)
  await evaluate(`(() => { const input=[...document.querySelectorAll('input')].find((item)=>item.placeholder?.includes('PowerShell 命令'));const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'git reset --hard HEAD~1');input.dispatchEvent(new Event('input',{bubbles:true}));return true })()`)
  assert.equal(await clickText('运行'), true)
  await sleep(100)
  assert.match(await evaluate('document.body.innerText'), /可能删除、覆盖或发布内容/, '危险命令必须进入行内确认，不得直接执行')

  assert.equal(await evaluate(`(() => { const button=[...document.querySelectorAll('[title]')].find((item)=>item.title?.startsWith('收起（Esc）'));button?.click();return Boolean(button) })()`), true)
  await sleep(700)
  const collapsedTransform = await evaluate(`document.querySelector('[data-terminal-frame]')?.closest('[data-solid]')?.style.transform`)
  assert.equal(collapsedTransform, 'translateY(-101%)', '终端获得过焦点后仍应允许主动收起')
  await sleep(600)
  assert.equal(await evaluate(`document.querySelector('[data-terminal-frame]')?.closest('[data-solid]')?.style.transform`), collapsedTransform, '主动收起后不得被残留键盘焦点再次唤出')

  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(1_000)
  await ensurePanelOpen()
  assert.equal(await evaluate(`(() => { const tab=[...document.querySelectorAll('[role="tab"][data-main-tab]')].find((item)=>item.textContent?.trim().startsWith('终端'));tab?.click();return Boolean(tab) })()`), true)
  await sleep(500)
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-recovery]'))`), true, '重启后应显示上次开发现场恢复中心')
  assert.equal(await clickText('恢复所选'), true)
  await sleep(700)
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-terminal-host]'))`), true, '恢复后应重新创建真实终端')
  assert.deepEqual(await evaluate('window.__terminalAuditErrors || []'), [], '终端交互期间不得出现 renderer 未处理异常')
  process.stdout.write('terminal Electron UI audit passed\n')
} finally {
  cdp?.close()
  if (child.pid) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break } catch { await sleep(150) }
  }
}
