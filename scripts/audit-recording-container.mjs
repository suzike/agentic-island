// 录屏容器与元数据审计：在隔离实例里**真录一段**，然后检查
//   ① 选中的编码器是否为 MP4/H.264（容器元数据可信的前提）
//   ② 分片与成品的扩展名是否与真实容器一致
//   ③ 成品是否有可用时长与合理帧率——WebM/MediaRecorder 产出没有 Duration、
//      且把时基当帧率（实测 tbr 1k），正是"导出画面飞快跑完"那类事故的根因。
// 录制的素材与配置都写在临时 profile 里，不碰用户真实数据。
//
// 用法：node scripts/audit-recording-container.mjs   （或 npm run audit:recording）
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises'
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
const port = 9441
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
class Cdp {
  constructor(u) { this.seq = 0; this.pending = new Map(); this.ws = new WebSocket(u) }
  async open() {
    await new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }) })
    this.ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); const w = this.pending.get(m.id); if (!w) return; this.pending.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result) })
  }
  send(method, params = {}) { const id = ++this.seq; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  close() { this.ws.close() }
}
const child = spawn(electron, [root, `--remote-debugging-port=${port}`], {
  cwd: root,
  env: { ...process.env, AIISLAND_ALLOW_AUDIT_INSTANCE: '1', AIISLAND_AUDIT_USER_DATA: profile, AIISLAND_SKIP_HOOKS: '1', AIISLAND_BRIDGE_FILE: join(profile, 'bridge.json') },
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
  console.log('点开始录制:', await ev(`(() => { const b=[...document.querySelectorAll('button')].find((n)=>/开始录制/.test(n.textContent||'')); b?.click(); return Boolean(b) })()`))

  let barReady = false
  for (let i = 0; i < 40; i += 1) { await sleep(750); barReady = Boolean(await ev(`Boolean(document.querySelector('[data-recording-control]'))`)); if (barReady) break }
  console.log('录制中控制条:', barReady)
  if (!barReady) {
    console.log('界面文案:', String(await ev(`(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,200)`)))
    throw new Error('录制未启动')
  }
  await sleep(8000)
  console.log('停止录制:', await ev(`(() => { const b=[...document.querySelectorAll('[data-recording-control] [title],[data-recording-control] button')].find((n)=>String(n.getAttribute('title')||'').includes('结束')); b?.click(); return Boolean(b) })()`))
  await sleep(3500)

  let mediaChecked = 0
  const recordingsDir = join(profile, 'recordings')
  const files = (await readdir(recordingsDir)).filter((f) => !f.endsWith('.json'))
  console.log('\n录制产物:', files.join(', '))
  for (const file of files) {
    const path = join(recordingsDir, file)
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
  process.stdout.write('recording container audit passed' + String.fromCharCode(10))
} finally {
  try { await Promise.race([cdp?.send('Runtime.evaluate', { expression: 'window.island.quitApp(); true', returnByValue: true }), sleep(1500)]) } catch {}
  cdp?.close()
  if (child.exitCode === null) spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  for (let i = 0; i < 8; i += 1) { try { await rm(profile, { recursive: true, force: true }); break } catch { await sleep(200) } }
}
