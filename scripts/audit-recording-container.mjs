// 录屏容器与元数据审计：在隔离实例里**真录一段**，然后检查
//   ① 选中的编码器是否为 MP4/H.264（容器元数据可信的前提）
//   ② 分片与成品的扩展名是否与真实容器一致
//   ③ 成品是否有可用时长与合理帧率——WebM/MediaRecorder 产出没有 Duration、
//      且把时基当帧率（实测 tbr 1k），正是"导出画面飞快跑完"那类事故的根因。
// 录制的素材与配置都写在临时 profile 里，不碰用户真实数据。
//
// 用法：node scripts/audit-recording-container.mjs   （或 npm run audit:recording）
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sniffRecordingContainer } from '../src/shared/recording-format.ts'
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'

const root = 'E:/Agentic_Engineering/Claude_Desktop/Vibe-Island'
const ffmpeg = join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const profile = await mkdtemp(join(tmpdir(), 'aiisland-recverify-'))
await mkdir(join(profile, 'audit-exports'), { recursive: true })
const port = 9441
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
class Cdp {
  constructor(u) { this.seq = 0; this.pending = new Map(); this.ws = new WebSocket(u) }
  async open() {
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }) })
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data))
      if (m.method === 'Runtime.exceptionThrown') console.log('[渲染层异常]', m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text)
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params?.type)) console.log('[' + m.params.type + ']', (m.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 240))
      const w = this.pending.get(m.id); if (!w) return; this.pending.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result)
    })
  }
  send(method, params = {}) { const id = ++this.seq; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  close() { this.ws.close() }
}
const child = spawn(electron, [root, `--remote-debugging-port=${port}`], {
  cwd: root,
  env: { ...process.env, AIISLAND_ALLOW_AUDIT_INSTANCE: '1', AIISLAND_AUDIT_USER_DATA: profile, AIISLAND_AUDIT_EXPORT_DIR: join(profile, 'audit-exports'), AIISLAND_SKIP_HOOKS: '1', AIISLAND_BRIDGE_FILE: join(profile, 'bridge.json') },
  stdio: 'ignore', windowsHide: true
})
let cdp
try {
  let t
  for (let i = 0; i < 120; i += 1) { try { const ts = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()); t = ts.find((x) => x.type === 'page' && x.title === 'Agentic-Island'); if (t) break } catch {} await sleep(250) }
  if (!t) throw new Error('未找到渲染进程目标')
  cdp = new Cdp(t.webSocketDebuggerUrl); await cdp.open(); await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'ERR ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''); return r.result?.value }
  await sleep(2200)

  console.log('打开录屏工坊:', await ev(`(() => { const b=[...document.querySelectorAll('button,[title]')].find((n)=>String(n.getAttribute('title')||'').includes('录屏工坊')); b?.click(); return Boolean(b) })()`))
  await sleep(2600)
  console.log('关倒计时:', await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>n.textContent?.trim()==='关闭'); b?.click(); return Boolean(b) })()`))
  await sleep(300)
  // 录制前把运镜切成"固定画面"：只有画面稳定的素材才能在导出期按轨迹重建运镜（否则是双重运镜）
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>n.textContent?.trim()==='运镜'); b?.click(); return Boolean(b) })()`)
  await sleep(900)
  const fixedFraming = await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/固定画面/.test(n.textContent||'')); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  console.log('运镜切固定画面:', fixedFraming)
  assert.equal(fixedFraming, 'clicked', '运镜页应有"固定画面"档')
  await sleep(400)
  const recordingsDir = join(profile, 'recordings')
  let mediaChecked = 0
  let compositeFps = 0
  let compositeSize = ''
  /** 从 ffmpeg 的流信息里取时长/编码/帧率/尺寸（不依赖 ffprobe）。 */
  const probeFile = (path) => {
    const info = spawnSync(ffmpeg, ['-hide_banner', '-i', path], { encoding: 'utf8', windowsHide: true })
    const text = `${info.stderr}${info.stdout}`
    return {
      duration: /Duration: ([^\s,]+)/.exec(text)?.[1] || 'N/A',
      video: /Stream #0:0.*/.exec(text)?.[0]?.trim() || '',
      fps: Number(/Video:.*?(\d+(?:\.\d+)?) fps/.exec(text)?.[1] || 0),
      size: /Video:.*?, (\d{3,5})x(\d{3,5})/.exec(text)?.slice(1).join('x') || ''
    }
  }
  /** 录一段并返回新产出的素材文件（多次录制要能分别归属）。 */
  const recordOnce = async (label, seconds) => {
    let startEnabled = false
    for (let i = 0; i < 60; i += 1) {
      startEnabled = Boolean(await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/开始录制/.test(n.textContent||'')); return b && !b.disabled })()`))
      if (startEnabled) break
      await sleep(500)
    }
    console.log(`[${label}] 开始录制按钮可用:`, startEnabled)
    assert.ok(startEnabled, `[${label}] "开始录制"应可用（来源枚举中它是 disabled，点了会静默无动作）`)
    const before = new Set(await readdir(recordingsDir).catch(() => []))
    await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/开始录制/.test(n.textContent||'')); b?.click(); return Boolean(b) })()`)
    let barReady = false
    for (let i = 0; i < 40; i += 1) { await sleep(750); barReady = Boolean(await ev(`Boolean(document.querySelector('[data-recording-control]'))`)); if (barReady) break }
    if (!barReady) console.log(`[${label}] 界面文案:`, String(await ev(`(document.body.innerText||'').replace(/\s+/g,' ').slice(0,300)`)))
    assert.ok(barReady, `[${label}] 录制未启动`)
    await sleep(seconds * 1000)
    if (process.env.AIISLAND_AUDIT_NO_CLICK !== '1') {
      // 用真实 OS 输入点一下：CDP 的合成事件只进渲染层，装在系统上的鼠标钩子看不到。
      // 点完把光标放回原处（这毕竟是用户的桌面）。失败就跳过——这只是可选能力的验证。
      const click = spawnSync('powershell.exe', ['-NoProfile', '-Command', [
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        'Add-Type -AssemblyName System.Windows.Forms',
        '$p = [System.Windows.Forms.Cursor]::Position',
        "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);' -Name M -Namespace A",
        '[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(400, 300)',
        '[A.M]::mouse_event(0x0002, 0, 0, 0, 0); [A.M]::mouse_event(0x0004, 0, 0, 0, 0)',
        'Start-Sleep -Milliseconds 150',
        '[System.Windows.Forms.Cursor]::Position = $p'
      ].join('; ')], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
      console.log(`[${label}] 真实点击注入:`, click.status === 0 ? 'ok' : `失败（${String(click.stderr || '').slice(0, 80)}）`)
    }
    await ev(`(() => { const b=[...document.querySelectorAll('[data-recording-control] [title],[data-recording-control] button')].find((n)=>String(n.getAttribute('title')||'').includes('结束')); b?.click(); return Boolean(b) })()`)
    await sleep(5500)
    const after = (await readdir(recordingsDir)).filter((name) => !name.endsWith('.json') && !before.has(name))
    assert.equal(after.length, 1, `[${label}] 应恰好新增一个素材文件（实测 ${after.length}）`)
    return join(recordingsDir, after[0])
  }
  /**
   * 屏幕活动发生器：桌面采集是**变化驱动**的——画面不动就没有帧（静止屏幕上原始采集实测只有
   * 1.11fps，那不是丢帧，是"屏幕没变，没什么可录"）。比较两种采集方式就必须让屏幕真的在变。
   *
   * 必须是**另一个进程**的窗口：录制期间应用会对自己的所有窗口开 `setContentProtection`，
   * 岛自己窗口里的动画对采集器是隐形的（踩过）。这里起一个独立 Electron 实例铺满主显示器。
   */
  const activityMain = join(profile, 'activity-main.js')
  // 单行 main.js：避免在脚本里嵌多行字符串时被转义坑到（\n 反复被吃掉）
  const activitySource = [
    "const { app, BrowserWindow, screen } = require('electron')",
    "app.disableHardwareAcceleration()",
    "app.whenReady().then(() => {",
    "  const bounds = screen.getPrimaryDisplay().bounds",
    "  const win = new BrowserWindow({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false })",
    "  const html = '<html><body style=\"margin:0;overflow:hidden\"><div id=\"b\" style=\"position:fixed;inset:0;background:#c00\"></div><scr' + 'ipt>let i=0;setInterval(()=>{document.getElementById(\"b\").style.background=\"hsl(\"+(i=(i+9)%360)+\",85%,50%)\"},16)</scr' + 'ipt></body></html>'",
    "  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))",
    "})"
  ].join(String.fromCharCode(10))
  await writeFile(activityMain, activitySource, 'utf8')
  const activityChild = spawn(electron, [activityMain, '--user-data-dir=' + join(profile, 'activity-userdata')], { stdio: 'ignore', windowsHide: true })
  await sleep(3500)
  console.log('屏幕活动窗口:', child.exitCode === null && activityChild.exitCode === null ? '已启动' : '启动失败')
  await sleep(1200)
  const compositeFile = await recordOnce('合成', 8)
  console.log('\n录制产物:', compositeFile.slice(recordingsDir.length + 1))
  for (const path of [compositeFile]) {
    const size = (await stat(path)).size
    const head = Buffer.alloc(16)
    const { open } = await import('node:fs/promises')
    const handle = await open(path, 'r')
    await handle.read(head, 0, 16, 0)
    await handle.close()
    console.log(`  容器嗅探: ${sniffRecordingContainer(head)}  大小: ${(size / 1048576).toFixed(2)} MB`)
    const info = spawnSync(ffmpeg, ['-hide_banner', '-i', path], { encoding: 'utf8', windowsHide: true })
    const text = `${info.stderr}${info.stdout}`
    const duration = /Duration: ([^\s,]+)/.exec(text)?.[1] || 'N/A'
    const video = /Stream #0:0.*/.exec(text)?.[0]?.trim() || ''
    console.log(`  时长: ${duration}`)
    console.log(`  视频轨: ${video}`)
    assert.equal(sniffRecordingContainer(head), 'mp4', '录制容器应为 MP4（元数据可信 + 导出可直通封装）')
    assert.notEqual(duration, 'N/A', '成品必须带可用时长（WebM/MediaRecorder 产出实测没有 Duration）')
    assert.match(video, /Video: h264/, '视频编码应为 H.264')
    assert.doesNotMatch(video, /tbr 1k|1000 fps/, '容器不得把时基当帧率（tbr 1k 是 WebM 路径的坑）')
    compositeFps = Math.max(compositeFps, probeFile(path).fps)
    compositeSize = probeFile(path).size
    mediaChecked += 1
  }
  const manifests = (await readdir(recordingsDir)).filter((f) => f.endsWith('.json'))
  for (const file of manifests) {
    const manifest = JSON.parse(await readFile(join(recordingsDir, file), 'utf8'))
    console.log(`  会话 manifest: mimeType=${manifest.mimeType} | fileName=${manifest.fileName} | ${manifest.width}x${manifest.height}@${manifest.fps} | hasAudio=${manifest.hasAudio} | status=${manifest.status}`)
    assert.match(String(manifest.mimeType), /mp4/, '会话 manifest 应记录 MP4 容器')
    assert.match(String(manifest.fileName), /\.mp4$/, '成品扩展名应跟随真实容器（不能把 MP4 存成 .webm）')
    assert.equal(manifest.status, 'ready', '停止录制后会话状态应为 ready')
  }
  // 拍摄与后期分离：录制期必须真的采集到光标轨迹并落进工程。
  // 这是"剪除空白"和导出期重建运镜的数据来源，事后无法补录，采不到就是功能整体失效。
  // 工程是录制结束后**延迟 1 秒防抖落盘**的，读得太早会拿到还没有轨迹的版本——轮询到写出为止。
  const projectsDir = join(profile, 'recording-projects')
  let trackPoints = 0
  let clickPoints = 0
  let motionReady = false
  let projectFiles = []
  for (let attempt = 0; attempt < 14; attempt += 1) {
    projectFiles = await readdir(projectsDir).catch(() => [])
    trackPoints = 0
    for (const file of projectFiles.filter((name) => name.endsWith('.json'))) {
      const project = JSON.parse(await readFile(join(projectsDir, file), 'utf8'))
      const track = Array.isArray(project.cursorTrack) ? project.cursorTrack : []
      trackPoints = Math.max(trackPoints, track.length)
      clickPoints = Math.max(clickPoints, Array.isArray(project.clickTrack) ? project.clickTrack.length : 0)
      motionReady = motionReady || project.exportMotionReady === true
      const last = track.at(-1)
      if (track.length && attempt === 0) console.log(`  光标轨迹: ${track.length} 点 | 末点 t=${last.t}ms (${last.x}, ${last.y}) 速度=${last.s}`)
    }
    if (trackPoints > 0) break
    await sleep(500)
  }
  if (trackPoints > 0) console.log(`  光标轨迹: ${trackPoints} 点（工程数 ${projectFiles.length}）`)
  else console.log(`  光标轨迹: 空（工程目录内容: ${projectFiles.join(', ') || '空'}）`)
  assert.ok(trackPoints >= 20, `8 秒录制应采到足够的光标轨迹点（实测 ${trackPoints} 个；0 表示采样或落盘链路断了）`)
  assert.equal(motionReady, true, '"固定画面"录制的素材应标注为可在导出期重建运镜')
  console.log(`  鼠标点击: ${clickPoints} 次`)
  assert.ok(clickPoints >= 1, `录制期间注入的真实点击应被采集到（实测 ${clickPoints} 次；0 说明系统钩子没装上或没生效）`)

  // 剪除空白的入口必须真的挂在剪辑页上，并且是**两段式**（先给方案，再落地）。
  // 这次录制用的是合成光标，正是"录播放中的视频"那类退化素材——绝不能一次点击就把成片剪到只剩几秒。
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/剪辑与预览/.test(n.textContent||'')); b?.click(); return Boolean(b) })()`)
  await sleep(1200)
  const trimPlan = await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/算出待剪空白/.test(n.textContent||'')); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  await sleep(500)
  const planText = String(await ev(`(() => { const nodes=[...document.querySelectorAll('div')].filter((n)=>/将剪掉/.test(n.textContent||'')); nodes.sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length); return (nodes[0]?.textContent||'').replace(/\\s+/g,' ').trim() })()`))
  console.log('剪除空白 · 方案:', trimPlan, '|', planText)
  assert.equal(trimPlan, 'clicked', '剪辑页应存在"剪除空白"入口')
  assert.match(planText, /将剪掉\s*[\d.]+s/, '应先给出"剪多少、留几段"的方案而不是直接改时间线')
  const applied = await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/应用剪除/.test(n.textContent||'')); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  await sleep(600)
  const trimToast = String(await ev(`(() => { const nodes=[...document.querySelectorAll('*')].filter((n)=>n.children.length===0&&/已剪除|未做改动|不足|不可靠/.test(n.textContent||'')); return nodes.map((n)=>n.textContent.trim()).slice(-1).join('') })()`))
  console.log('剪除空白 · 落地:', applied, '|', trimToast)
  assert.equal(applied, 'clicked', '方案展示后应能确认应用')
  assert.match(trimToast, /已剪除/, '确认后应落到时间线并如实报告剪掉多少')
  // 播放验证：录出的 MP4 音轨是 Opus，必须确认**应用自己的预览**能解码（含声音），
  // 否则就是"录得到、放不出"的静默回归。
  // 直接复用工作室页面上那个 <video>（停止录制后它就在播预览），比自建 URL 更忠实——
  // 也避免踩到应用 CSP（media-src 只允许 'self' 与 data:）这类自建探针的假阴性。
  const playback = await ev(`(async () => {
    const video = [...document.querySelectorAll('video')].find((node) => node.duration > 0 || node.readyState >= 1)
    if (!video) {
      const anyVideo = document.querySelector('video')
      return JSON.stringify({ ok: false, reason: anyVideo ? '预览元素存在但未加载元数据' : '页面上没有预览 <video>' })
    }
    if (video.readyState < 1) {
      await new Promise((resolve) => { const timer = setTimeout(resolve, 5000); video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve() }, { once: true }) })
    }
    try { await video.play() } catch { /* 自动播放被拦时仍可读计数器 */ }
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const result = {
      ok: true,
      readyState: video.readyState,
      duration: Math.round((video.duration || 0) * 100) / 100,
      width: video.videoWidth,
      videoBytes: video.webkitVideoDecodedByteCount || 0,
      audioBytes: video.webkitAudioDecodedByteCount || 0
    }
    video.pause()
    return JSON.stringify(result)
  })()`)
  console.log('  应用内预览播放:', playback)
  const played = JSON.parse(playback)
  assert.equal(played.ok, true, `录制成品应能在应用内预览（${played.reason || ''}）`)
  assert.ok(played.duration > 1, `预览应读到真实时长（实测 ${played.duration}s）`)
  assert.ok(played.videoBytes > 0, '预览应真的解出视频帧')
  assert.ok(played.audioBytes > 0, 'MP4 音轨应能被应用解码（否则预览没声音）')

  assert.ok(mediaChecked > 0, '应至少校验一个录制成品')
  // 原始采集：同样时长，画面不做任何合成。这是"合成管线掉帧"的直接对照——
  // 合成模式实测 21–28fps（叠加层多时更低），原始采集应当基本跑满目标帧率。
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/重新录制/.test(n.textContent||'')); b?.click(); return Boolean(b) })()`)
  await sleep(1500)
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>n.textContent?.trim()==='采集'); b?.click(); return Boolean(b) })()`)
  await sleep(900)
  // 原始采集按屏幕原始画幅录制，输出画幅在导出期重组——所以"画面比例"不再是前置条件
  //（默认 16:9 也能直接用，这正是本轮修的那条限制）。
  const rawPick = await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/原始画面/.test(n.textContent||'')); if (!b) return 'missing'; if (/不可用/.test(b.textContent||'')) return 'blocked'; b.click(); return 'clicked' })()`)
  console.log('采集方式切原始画面:', rawPick)
  if (rawPick === 'blocked') console.log('  被挡住的原因:', String(await ev(`(() => { const n=[...document.querySelectorAll('div')].filter((x)=>x.children.length===0&&/切到"原始画面"需要先关掉/.test(x.textContent||'')); return n[0]?.textContent?.trim() || '（未找到说明）' })()`)))
  assert.equal(rawPick, 'clicked', '采集页应能切到"原始画面"（blocked 表示前置项没被清干净）')
  const rawFile = await recordOnce('原始', 8)
  if (activityChild.exitCode === null) spawnSync('taskkill.exe', ['/pid', String(activityChild.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  const rawInfo = probeFile(rawFile)
  console.log(`  帧率对照：合成 ${compositeFps}fps → 原始 ${rawInfo.fps}fps（尺寸 ${compositeSize} → ${rawInfo.size}）`)
  assert.match(rawInfo.video, /Video: h264/, '原始采集同样应是 H.264')
  assert.notEqual(rawInfo.duration, 'N/A', '原始采集的容器也必须带可用时长')
  assert.ok(compositeFps > 0, '应测得合成模式的帧率作为对照')
  // 屏幕在动的前提下：原始采集没有画布重绘，帧率应不低于合成模式（合成实测 21–28fps 且随叠加层增加而下降）
  assert.ok(rawInfo.fps >= compositeFps, `同样的活动画面下原始采集帧率不应低于合成模式（原始 ${rawInfo.fps}fps vs 合成 ${compositeFps}fps）`)
  // 桌面采集是变化驱动的：源静止时不会产出重复帧，这里只要求"动起来之后确实有帧"
  assert.ok(rawInfo.fps >= 20, `活动画面下原始采集应跑满目标帧率（实测 ${rawInfo.fps}fps，静止屏幕实测只有 1.11fps）`)
  // 导出 + 成品自检：走**应用自己的导出链路**（审计实例下保存框被改成直接落盘），
  // 断言成功提示里带自检结论，并读回真实产物核对元数据。
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/导出设置/.test(n.textContent||'')); b?.click(); return Boolean(b) })()`)
  await sleep(1200)
  // 输出画布切成竖屏：素材是横屏，导出必须真的重组成 1080x1920（这正是"原始采集不必再被画幅挡住"的验证）
  const aspectPick = await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/竖屏/.test(n.textContent||'')); if (!b) return 'missing'; b.click(); return 'clicked' })()`)
  console.log('输出画布切竖屏:', aspectPick)
  assert.equal(aspectPick, 'clicked', '导出页应有"竖屏"画布档')
  await sleep(400)
  // 这里刻意**开着**导出期运镜去导出竖屏：跨画幅时应用会先按"铺满"把画面裁齐、再把轨迹重映射，
  // 所以既该出 1080x1920，也不该有任何告警，摘要里要写明"画幅按铺满重组"。
  const motionState = await ev(`(() => { const span=[...document.querySelectorAll('span')].find((n)=>(n.textContent||'').trim()==='导出期运镜'); const sw=span?.parentElement?.querySelector('button'); if (!sw) return 'missing'; return /accent/.test(sw.style.background || '') ? 'on' : 'off' })()`)
  console.log('导出期运镜开关:', motionState)
  assert.equal(motionState, 'on', '原始采集切过来时应默认打开导出期运镜')
  await sleep(400)
  console.log('导出页就绪:', String(await ev(`(() => { const t=(document.body.innerText||''); return /压缩策略/.test(t) ? '是' : '否' })()`)))
  const exportClick = await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/导出 MP4/.test(n.textContent||'')); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'clicked' })()`)
  console.log('点导出 MP4:', exportClick)
  assert.equal(exportClick, 'clicked', '导出页应有"导出 MP4"按钮')
  let exportToast = ''
  for (let i = 0; i < 86; i += 1) {
    await sleep(700)
    // toast 是工坊里唯一 maxWidth=340px 的 span（见 ScreenRecorderStudio 的 toast 渲染），按样式定位最稳
    exportToast = String(await ev(`(() => { const n=[...document.querySelectorAll('span')].filter((x)=>x.style.maxWidth==='340px'); return n.map((x)=>x.textContent.trim()).join(' | ') })()`))
    if (/已导出|导出失败/.test(exportToast)) break
  }
  console.log('导出结果提示:', exportToast)
  const exportDir = join(profile, 'audit-exports')
  const exported = (await readdir(exportDir).catch(() => [])).filter((name) => name.endsWith('.mp4'))
  console.log('导出产物:', exported.join(', ') || '（无）')
  assert.ok(exported.length >= 1, `应用导出应写出成品文件（实测 ${exported.length} 个）`)
  const exportedPath = join(exportDir, exported[0])
  const exportedProbe = probeFile(exportedPath)
  console.log(`  导出成品元数据: 时长 ${exportedProbe.duration} · ${exportedProbe.fps}fps · ${exportedProbe.size}`)
  assert.notEqual(exportedProbe.duration, 'N/A', '导出成品必须带可用时长')
  assert.ok(Math.abs(exportedProbe.fps - 30) <= 1, `导出成品帧率应为请求的 30fps（实测 ${exportedProbe.fps}）`)
  assert.equal(exportedProbe.size, '1080x1920', `横屏素材导出竖屏画布应真的重组尺寸（实测 ${exportedProbe.size}）`)
  assert.match(exportToast, /已导出/, `导出成功应给出提示（实测"${exportToast}"）`)
  assert.match(exportToast, /自检通过/, `成功提示应带成品自检结论（实测"${exportToast}"）`)
  assert.match(exportToast, /画幅按铺满重组/, `跨画幅应在摘要里说明画幅被重组过（实测"${exportToast}"）`)
  assert.doesNotMatch(exportToast, /自检有疑问/, `画幅重组是预期行为，不该报成"有疑问"（实测"${exportToast}"）`)
  process.stdout.write('recording container audit passed' + String.fromCharCode(10))
} finally {
  try { await Promise.race([cdp?.send('Runtime.evaluate', { expression: 'window.island.quitApp(); true', returnByValue: true }), sleep(1500)]) } catch {}
  cdp?.close()
  if (child.exitCode === null) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  for (let i = 0; i < 8; i += 1) { try { await rm(profile, { recursive: true, force: true }); break } catch { await sleep(200) } }
}
