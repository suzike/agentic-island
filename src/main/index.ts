import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, screen, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { pathToFileURL } from 'url'
import ffmpegStatic from 'ffmpeg-static'
import { AgentsStore } from './agents-store'
import { BridgeServer } from './bridge-server'
import { CodexTail } from './codex-tail'
import {
  installClaudeCode,
  uninstallClaudeCode,
  installCodex,
  uninstallCodex,
  installCodexNotify,
  uninstallCodexNotify
} from './hook-installer'
import { complete as llmComplete, test as llmTest, embed as llmEmbed } from './llm-proxy'
import { agentCliStream, agentCliCancel, agentCliCheck, type AgentEngine } from './agent-cli'
import * as kb from './kb'
import { playSound } from './sound'
import { loadState, saveState } from './settings-store'
import { focusByHwnd, focusByPid, focusByTitle, focusAnyByTitle, selectWtTab } from './terminal-jump'
import { gitSummary } from './git-summary'
import { fetchIcs, parseIcs } from './calendar-ics'
import { fetchCaldav } from './calendar-caldav'
import { getMediaInfo, mediaKey } from './media'
import { fetchRss } from './rss'
import { netFetch } from './http-client'
import { setPtySink, ptyEnsure, ptyInput, ptyResize, ptyKill, ptyKillAll } from './term-pty'
import { startClipboardWatch } from './clipboard-watch'
import { startDndWatch } from './dnd-watch'
import { createExternalYieldController, type ExternalYieldController } from './external-yield'
import { createScreenshotPoller } from './screenshot-poller'
import { recordingExportSubtitleSegments, recordingHasEdits, startRecordingFfmpeg } from './recording-export'
import { RecordingSessionStore } from './recording-session-store'
import { RecordingProjectStore } from './recording-project-store'
import { transcribeRecordingFile } from './recording-transcription'
import type { DecisionMessage, LlmRequestConfig, RecordingAnimeModel, RecordingExportProgress, RecordingExportRequest, RecordingProjectSaveInput, RecordingSessionCreateInput, RecordingSource, ScreenshotTarget } from '../shared/protocol'
import { recordingWindowHandle } from '../shared/recording-source'

// 允许 WebAudio 无需用户手势即可播放（提示音/试听）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// 窗口策略：**常驻铺满当前显示器工作区，永不 resize**。
// 曾按面板尺寸开窗、覆盖层/尺寸切换时再 resize——透明无边框窗口每次 resize 都会让整岛肉眼可见地抖一下
// （"部分按钮点击时整岛抖动"的根因），且窗口边界还带来隐形暗框/阴影裁切/flare 余量等一整族问题。
// 铺满后：面板大小纯属渲染层布局（largeSize/islandWidth/fullscreen 都只改 CSS），点击穿透仍由命中检测决定。

let win: BrowserWindow | null = null
let externalYield: ExternalYieldController | null = null
let rendererDialogRelease: (() => void) | null = null
const store = new AgentsStore()
const bridge = new BridgeServer(store, gitSummary)
// Codex 实时接入：跟随其 rollout 会话日志（Windows 上 hooks/notify 都不通，这是唯一可靠通道）
const codexTail = new CodexTail(store, gitSummary)
const recordingExportJobs = new Map<string, ChildProcess>()
const recordingPreviewDirs = new Map<string, string>()
let recordingSessions: RecordingSessionStore
let recordingProjects: RecordingProjectStore

function yieldToExternalApp(): void {
  externalYield?.yieldWindow()
}

function openExternalTarget(url: string): Promise<void> {
  yieldToExternalApp()
  return shell.openExternal(url)
}

function openPathTarget(path: string): Promise<string> {
  yieldToExternalApp()
  return shell.openPath(path)
}

async function withNativeDialog<T>(open: () => Promise<T>): Promise<T> {
  const release = externalYield?.suspendTopmost()
  try {
    return await open()
  } finally {
    release?.()
  }
}

function showOwnedOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return withNativeDialog(() => win && !win.isDestroyed()
    ? dialog.showOpenDialog(win, options)
    : dialog.showOpenDialog(options))
}

function showOwnedSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  return withNativeDialog(() => win && !win.isDestroyed()
    ? dialog.showSaveDialog(win, options)
    : dialog.showSaveDialog(options))
}

// 转发脚本的绝对路径（dev 指向源码，打包后指向 resources）
const forwarderPath = (name: string): string => {
  if (app.isPackaged) return join(process.resourcesPath, 'hooks-bin', name)
  return join(app.getAppPath(), 'src', 'hooks-bin', name)
}

// 全局接入：
// - Claude Code：hooks（PreToolUse 阻塞审批 + 生命周期），全功能。
// - Codex：双通道——① rollout 日志跟随（CodexTail，实时监控+完成，永远可靠）；
//   ② hooks（实测：桌面端会触发审批/事件，CLI 不触发）→ 有则获得审批能力，没有也不影响 ①。
//   notify 在 Windows 被 OpenAI computer-use 独占，不安装。
function doInstallHooks(): void {
  installClaudeCode(forwarderPath('cc-forward.mjs'))
  installCodex(forwarderPath('codex-forward.mjs'))
  if (process.platform !== 'win32') installCodexNotify(forwarderPath('codex-notify.mjs'))
}

// 系统托盘：常驻应用的可见入口（窗口不在任务栏，没有托盘就无法正常退出）
let tray: Tray | null = null
function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon-256.png')
    : join(app.getAppPath(), 'build', 'icon-256.png')
  let img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('Agentic-Island · 灵动岛')
  const reveal = (): void => {
    if (!win) return
    win.showInactive()
    win.moveTop()
    win.webContents.send('reveal')
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '展开灵动岛', click: reveal },
      { label: '命令面板  Ctrl+Alt+K', click: () => openPalette() },
      { label: '第二大脑  Ctrl+Alt+F', click: () => openBrain() },
      { label: '闪念胶囊  Ctrl+Alt+Space', click: () => openCapsule() },
      { label: '智能截图  Ctrl+Alt+S', click: () => openScreenshot() },
      { label: '分析当前屏幕  Ctrl+Alt+A', click: () => void openScreenAnalyze() },
      { type: 'separator' },
      { label: '重启应用', click: () => { app.relaunch(); app.quit() } },
      { label: '退出 Agentic-Island', click: () => app.quit() }
    ])
  )
  tray.on('double-click', reveal)
}

// 多显示器定位：follow=跟随鼠标所在屏；否则用选定显示器索引
let follow = true
let monitorIndex = 0
// 全屏模式：窗口铺满整个物理显示器（display.bounds，含任务栏区域）；否则只铺工作区
let fullMode = false

/** 岛当前的目标显示器（follow=光标所在屏；否则选定索引，索引失效回退首屏） */
function targetDisplay(): Electron.Display {
  const displays = screen.getAllDisplays()
  return follow
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : displays[monitorIndex] || displays[0]
}

function positionWindow(w: BrowserWindow, force = false): void {
  const display = targetDisplay()
  const { x, y, width, height } = fullMode ? display.bounds : display.workArea
  // 恒定铺满工作区；边界相同就直接跳过（避免任何多余的 setBounds——透明窗 resize/重设都可能闪/抖）
  const cur = w.getBounds()
  if (!force && cur.x === x && cur.y === y && cur.width === width && cur.height === height) return
  // 关键：resizable:false 的窗口在 Windows 上 setBounds 改宽会被忽略 → 先临时放开再收回
  w.setResizable(true)
  w.setBounds({ x, y, width, height })
  w.setResizable(false)
  // 注意：这里不要 webContents.invalidate()——透明窗口上强制全量重绘会产生肉眼可见的闪屏
  // 混合 DPI 屏间移动时 setBounds 可能落到中间值（DIP 换算竞态）→ 60ms 后校验，不符强制重设一次
  setTimeout(() => {
    if (w.isDestroyed()) return
    const now = w.getBounds()
    if (now.x !== x || now.y !== y || now.width !== width || now.height !== height) {
      w.setResizable(true)
      w.setBounds({ x, y, width, height })
      w.setResizable(false)
    }
  }, 60)
}

/** 显示器热插拔 / 分辨率 / DPI 缩放变化：重定位全部岛系窗口（否则岛会偏、不再居中/铺满） */
function onDisplayChange(): void {
  try {
    const n = screen.getAllDisplays().length
    monitorIndex = Math.min(monitorIndex, Math.max(0, n - 1))
    if (win && !win.isDestroyed()) positionWindow(win, true)
    if (widgetWin && !widgetWin.isDestroyed()) placeWidget(widgetWin)
  } catch {
    /* 显示器枚举竞态期忽略 */
  }
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const rendererHtmlPath = (): string => join(__dirname, '../renderer/index.html')
const appWebPreferences = (): Electron.BrowserWindowConstructorOptions['webPreferences'] => ({
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  // 窗口从不获得焦点（常驻叠层），必须关闭后台节流，否则定时器/WebAudio 会被挂起（提示音不响）
  backgroundThrottling: false
})

function safeExternalUrl(raw: unknown): string | null {
  const text = String(raw || '').trim()
  if (!text || text.length > 4096 || hasNul(text)) return null
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function devRendererUrl(hash?: string): string | null {
  if (app.isPackaged || !process.env['ELECTRON_RENDERER_URL']) return null
  try {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !loopbackHosts.has(url.hostname)) {
      console.warn('[security] ignore untrusted ELECTRON_RENDERER_URL:', process.env['ELECTRON_RENDERER_URL'])
      return null
    }
    if (hash) url.hash = hash.replace(/^#/, '')
    return url.toString()
  } catch {
    console.warn('[security] ignore invalid ELECTRON_RENDERER_URL')
    return null
  }
}

function fileUrlPath(raw: string): string {
  return decodeURIComponent(raw).replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\').toLowerCase()
}

function isTrustedRendererNavigation(raw: string): boolean {
  try {
    const url = new URL(raw)
    const dev = devRendererUrl()
    if (dev && (url.protocol === 'http:' || url.protocol === 'https:')) return url.origin === new URL(dev).origin
    if (url.protocol === 'file:') return fileUrlPath(url.pathname) === rendererHtmlPath().toLowerCase()
  } catch {
    return false
  }
  return false
}

function loadRenderer(w: BrowserWindow, hash?: string): void {
  const dev = devRendererUrl(hash)
  if (dev) void w.loadURL(dev)
  else void w.loadFile(rendererHtmlPath(), hash ? { hash } : undefined)
}

function hardenWindow(w: BrowserWindow): void {
  w.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url)
    if (external) void openExternalTarget(external)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererNavigation(url)) return
    event.preventDefault()
    const external = safeExternalUrl(url)
    if (external) void openExternalTarget(external)
  })
}

// 多显示器跟随：持续跟踪光标所在显示器，变化时把岛移过去（此前只在启动时定位一次，导致"跟随"失效）
let followTimer: NodeJS.Timeout | null = null
function startFollowLoop(): void {
  if (followTimer) clearInterval(followTimer)
  followTimer = setInterval(() => {
    if (!win || !follow) return
    try {
      const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const winDisplay = screen.getDisplayMatching(win.getBounds())
      if (cursorDisplay.id !== winDisplay.id) positionWindow(win)
    } catch {
      /* 忽略 */
    }
  }, 700)
}

function createWindow(): void {
  const wa = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: appWebPreferences()
  })
  hardenWindow(win)

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  positionWindow(win)

  // 默认整窗点击穿透，转发鼠标移动以便渲染层做命中检测
  win.setIgnoreMouseEvents(true, { forward: true })
  externalYield?.dispose()
  externalYield = createExternalYieldController({
    collapse: () => win?.webContents.send('external-yield'),
    blur: () => win?.blur(),
    setClickThrough: (ignore) => {
      if (ignore) win?.setIgnoreMouseEvents(true, { forward: true })
      else win?.setIgnoreMouseEvents(false)
    },
    setTopmost: setAgenticWindowsTopmost
  })

  loadRenderer(win)

  // 无边框窗口开不了 DevTools —— 把渲染进程的报错转发到启动终端，便于排查
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId.split('/').pop()}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] crashed:', details.reason)
  })
}

// 智能截图：拉起 Windows 原生框选截图（ms-screenclip），图进剪贴板后轮询取到。
// 重复触发会替换旧轮询；框选期间持续降低岛层级，避免取消后锁死或中途重新盖住系统截图层。
let screenshotTarget: ScreenshotTarget = 'ask'
let screenshotTopmostRelease: (() => void) | undefined
const finishScreenshotFlow = (): void => {
  const release = screenshotTopmostRelease
  screenshotTopmostRelease = undefined
  release?.()
}
const screenshotPoller = createScreenshotPoller({
  readImage: () => {
    const image = clipboard.readImage()
    return image.isEmpty() ? '' : image.toDataURL()
  },
  onCapture: (dataUrl) => {
    const target = screenshotTarget
    screenshotTarget = 'ask'
    finishScreenshotFlow()
    win?.setAlwaysOnTop(true, 'screen-saver')
    win?.setIgnoreMouseEvents(false)
    win?.show()
    win?.focus()
    win?.webContents.send('screenshot-captured', { dataUrl, target })
  },
  onTimeout: () => {
    screenshotTarget = 'ask'
    finishScreenshotFlow()
  }
})

function openScreenshot(target: ScreenshotTarget = 'ask'): void {
  if (!win) return
  yieldToExternalApp()
  // 先取得新 hold，再释放旧 hold；重试瞬间不会闪回最高层。
  const nextRelease = externalYield?.suspendTopmost()
  screenshotPoller.stop()
  finishScreenshotFlow()
  screenshotTopmostRelease = nextRelease
  screenshotTarget = target

  const image = clipboard.readImage()
  const baseline = image.isEmpty() ? '' : image.toDataURL()
  try {
    const child = spawn('explorer.exe', ['ms-screenclip:'], { detached: true, windowsHide: true })
    child.once('error', () => {
      screenshotPoller.stop()
      screenshotTarget = 'ask'
      finishScreenshotFlow()
    })
    child.unref()
    screenshotPoller.start(baseline)
  } catch {
    screenshotTarget = 'ask'
    finishScreenshotFlow()
  }
}

// 屏幕理解：截取主屏（先藏岛避免拍到自己），返回 dataURL 交给视觉模型
async function captureScreenDataUrl(): Promise<string | null> {
  try {
    const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win?.hide()
    await new Promise((r) => setTimeout(r, 160))
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(target.size.width * target.scaleFactor),
        height: Math.round(target.size.height * target.scaleFactor)
      }
    })
    const source = sources.find((item) => item.display_id === String(target.id)) || sources[0]
    return source && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : null
  } catch {
    return null
  } finally {
    win?.show()
  }
}

// 屏幕理解：全局热键截整屏 → 交给渲染层（复用截图问 AI 卡）
async function openScreenAnalyze(): Promise<void> {
  if (!win) return
  const url = await captureScreenDataUrl()
  if (!url) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  win.show()
  win.focus()
  win.webContents.send('screenshot-captured', { dataUrl: url, target: 'ask' })
}

// 闪念胶囊：全局热键唤出居中输入框（临时让常驻窗口可聚焦，输完/取消后还原点击穿透）
function openCapsule(): void {
  if (!win) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false) // 让胶囊可输入
  win.show()
  win.focus()
  win.webContents.send('capsule-toggle')
}

// 全局命令面板：热键唤出居中搜索框（展开岛并可聚焦，动作执行后停在对应分区）
function openPalette(): void {
  if (!win) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  win.show()
  win.focus()
  win.webContents.send('palette-toggle')
}

// 第二大脑检索：热键唤出跨分区检索浮层
function openBrain(): void {
  if (!win) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  win.show()
  win.focus()
  win.webContents.send('brain-toggle')
}

// 可拆分桌面挂件：独立小窗常驻桌面角，展示主渲染层每秒推送的速览数据（番茄/待办/Agent/媒体）
let widgetWin: BrowserWindow | null = null
let lastWidgetData: unknown = null

/** 挂件锚定到岛所在显示器的右下角（跟随 positionWindow 同一目标屏） */
function placeWidget(w: BrowserWindow): void {
  const W = 268
  const H = 236
  const { workArea } = targetDisplay()
  w.setBounds({ x: workArea.x + workArea.width - W - 20, y: workArea.y + workArea.height - H - 20, width: W, height: H })
}

function openWidget(): void {
  if (widgetWin && !widgetWin.isDestroyed()) { widgetWin.show(); return }
  widgetWin = new BrowserWindow({
    width: 268, height: 236, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, fullscreenable: false, maximizable: false, minimizable: false,
    webPreferences: appWebPreferences()
  })
  hardenWindow(widgetWin)
  widgetWin.setAlwaysOnTop(true, 'screen-saver')
  widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  placeWidget(widgetWin)
  loadRenderer(widgetWin, 'widget')
  widgetWin.webContents.on('did-finish-load', () => { if (lastWidgetData) widgetWin?.webContents.send('widget-data', lastWidgetData) })
  widgetWin.on('closed', () => { widgetWin = null })
}
function closeWidget(): void {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.close()
  widgetWin = null
}

// 钉屏便利贴：每条被钉的便签一个独立浮贴小窗（按便签 id 去重）
interface StickyNoteData { id: number; emoji: string; title: string; md: string; color: string }
const stickyWins = new Map<number, BrowserWindow>()

function setAgenticWindowsTopmost(topmost: boolean): void {
  const windows = [win, widgetWin, ...stickyWins.values()]
  for (const current of windows) {
    if (!current || current.isDestroyed()) continue
    if (topmost) current.setAlwaysOnTop(true, 'screen-saver')
    else current.setAlwaysOnTop(false)
  }
}

function openSticky(note: StickyNoteData): void {
  const exist = stickyWins.get(note.id)
  if (exist && !exist.isDestroyed()) { exist.show(); exist.focus(); return }
  const w = new BrowserWindow({
    width: 240, height: 200, frame: false, transparent: true, resizable: true, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, fullscreenable: false, minWidth: 180, minHeight: 120,
    webPreferences: appWebPreferences()
  })
  hardenWindow(w)
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const { workArea } = targetDisplay()
  const n = stickyWins.size
  w.setBounds({ x: workArea.x + workArea.width - 268 - (n % 3) * 30, y: workArea.y + 60 + (n % 4) * 30, width: 240, height: 200 })
  loadRenderer(w, 'sticky')
  w.webContents.on('did-finish-load', () => w.webContents.send('sticky-data', note))
  w.on('closed', () => stickyWins.delete(note.id))
  stickyWins.set(note.id, w)
}
function closeSticky(id: number): void {
  const w = stickyWins.get(id)
  if (w && !w.isDestroyed()) w.close()
  stickyWins.delete(id)
}

// 提示音偏好（主进程权威缓存，随 save-state 更新）：按通知类型分声效
const soundPref = {
  on: true,
  map: { waiting: 'chime', approval: 'ping', danger: 'rising', todo: 'marimba' } as Record<string, string>
}
// 智能勿扰：渲染层据"会议检测 + 用户开关"算出的最终勿扰态；置真时主进程不自动弹窗、不响铃
let dndActive = false
let clipWatchEnabled = true
let stopClipboardWatch: (() => void) | null = null
function setClipboardWatch(on: boolean): void {
  clipWatchEnabled = on
  if (!on) {
    stopClipboardWatch?.()
    stopClipboardWatch = null
    return
  }
  if (!stopClipboardWatch) {
    stopClipboardWatch = startClipboardWatch((item) => win?.webContents.send('clipboard-new', item))
  }
}
// 危险命令判定（与渲染层 logic/risk.ts 的 danger 正则同步）
const DANGER_RE = /(rm\s+-[rf]{1,2}|git\s+push\s+.*(--force|-f)|--force\b|sudo\s|dd\s+if=|mkfs|chmod\s+777|>\s*\/dev\/|\bdel\s+\/[fqs]|format\s+[a-z]:|DROP\s+TABLE|TRUNCATE\s+TABLE|shutdown|reboot)/i

const hasNul = (s: string): boolean => s.includes('\0')
const safeName = (name: string, fallback: string): string =>
  String(name || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120) || fallback
const safeExt = (ext: string): string | null => {
  const e = String(ext || '').replace(/^\./, '').toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(e) ? e : null
}

// 状态变化 → 推送快照给渲染层；出现新的待审批/等待回复时：置顶 + 主进程按类型响铃
// （声音在主进程触发，不依赖渲染层——渲染层触发链曾在无焦点窗口下失效）
let prevPending = new Set<string>()
let prevWaiting = new Set<string>()
store.on('change', () => {
  const snap = store.snapshot()
  win?.webContents.send('snapshot', snap)
  const pend = snap.agents.filter((a) => a.status === 'needs_approval')
  const wait = snap.agents.filter((a) => a.status === 'waiting')
  const newPend = pend.filter((a) => a.requestId && !prevPending.has(a.requestId))
  const newWait = wait.filter((a) => !prevWaiting.has(a.id))
  if ((newPend.length > 0 || newWait.length > 0) && !dndActive) {
    if (win) {
      if (!externalYield?.isLowered()) win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
      win.showInactive() // 显示但不抢键盘焦点
    }
    if (soundPref.on) {
      // 优先级：危险审批 > 一般审批 > 等待回复（同时到达时只响最重要的一声）
      const key = newPend.some((a) => !a.isPlan && DANGER_RE.test(a.command || ''))
        ? soundPref.map.danger
        : newPend.length > 0
          ? soundPref.map.approval
          : soundPref.map.waiting
      playSound(key)
    }
  }
  prevPending = new Set(pend.map((a) => a.requestId as string).filter(Boolean))
  prevWaiting = new Set(wait.map((a) => a.id))
})

// 抓取网页正文 + <title>（问答附件与知识库共用）；粗提正文，压缩空白，截断上限
async function fetchPageText(url: string, cap = 30000): Promise<{ ok: boolean; text?: string; title?: string; error?: string }> {
  try {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅支持 http/https 链接' }
    const res = await netFetch(url, { timeoutMs: 20000, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const html = await res.text()
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(nbsp|#160);/g, ' ')
      .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m] || ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, cap)
    return text.length > 50 ? { ok: true, text, title } : { ok: false, error: '未能提取到正文（可能是动态渲染页面/需登录）' }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

function wireIpc(): void {
  ipcMain.handle('runtime-info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    security: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  }))
  ipcMain.handle('get-snapshot', () => store.snapshot())

  ipcMain.on('decide', (_e, msg: DecisionMessage) => {
    store.decide(msg.requestId, msg.decision, msg.reason)
  })

  // 渲染层命中检测：指针在岛面板上 → 关闭穿透；在透明空白 → 打开穿透
  ipcMain.on('set-ignore-mouse', (_e, ignore: boolean) => {
    if (ignore) win?.setIgnoreMouseEvents(true, { forward: true })
    else win?.setIgnoreMouseEvents(false)
  })

  // Chromium 的 <input type="file"> 不经过 Electron dialog API，由渲染层显式标记其生命周期。
  ipcMain.on('set-native-dialog-open', (_e, active: boolean) => {
    if (active) {
      if (!rendererDialogRelease) rendererDialogRelease = externalYield?.suspendTopmost() || null
      return
    }
    rendererDialogRelease?.()
    rendererDialogRelease = null
  })

  ipcMain.on('play-sound', (_e, key: string) => playSound(key))

  // 退出应用（设置页按钮；托盘菜单也可退出）
  ipcMain.on('app-quit', () => app.quit())

  // RSS 资讯：抓取并解析单个订阅源
  ipcMain.handle('rss-fetch', async (_e, url: string) => {
    try {
      if (!/^https?:\/\//i.test(String(url))) return { ok: false, error: '链接需以 http(s):// 开头' }
      return { ok: true, items: await fetchRss(String(url)) }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })

  // GitHub 本周热门仓库（迷你条轮播；electron net 走系统代理）
  ipcMain.handle('github-trending', async () => {
    try {
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
      const res = await net.fetch(`https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=15`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'agentic-island' }
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { items?: { full_name: string; stargazers_count: number; description?: string }[] }
      const items = (data.items || []).map((r) => `⭐ ${r.stargazers_count >= 1000 ? (r.stargazers_count / 1000).toFixed(1) + 'k' : r.stargazers_count} ${r.full_name}${r.description ? ' — ' + r.description.slice(0, 50) : ''}`)
      return { ok: true, items }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })

  // GitHub 富接入：结构化 trending（日/周/月高星）/ 我的仓库 / README（供 AI 解读）。走 net.fetch 继承代理。
  const ghHeaders = (token?: string): Record<string, string> => ({
    accept: 'application/vnd.github+json', 'user-agent': 'agentic-island',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  })
  interface GhRepo { full_name: string; owner: { login: string; avatar_url?: string }; name: string; description?: string; stargazers_count: number; forks_count?: number; language?: string; html_url: string; created_at?: string; updated_at?: string; topics?: string[] }
  const mapRepo = (r: GhRepo): Record<string, unknown> => ({ fullName: r.full_name, owner: r.owner?.login, avatar: r.owner?.avatar_url, name: r.name, desc: r.description || '', stars: r.stargazers_count, forks: r.forks_count || 0, language: r.language || '', url: r.html_url, createdAt: r.created_at, updatedAt: r.updated_at, topics: r.topics || [] })

  ipcMain.handle('github-trending-repos', async (_e, range: 'daily' | 'weekly' | 'monthly', token?: string) => {
    try {
      const days = range === 'daily' ? 1 : range === 'weekly' ? 7 : 30
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
      const res = await net.fetch(`https://api.github.com/search/repositories?q=created:%3E=${since}&sort=stars&order=desc&per_page=25`, { headers: ghHeaders(token) })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { items?: GhRepo[] }
      return { ok: true, repos: (data.items || []).map(mapRepo) }
    } catch (e) { return { ok: false, error: String(e) } }
  })
  ipcMain.handle('github-my-repos', async (_e, token: string) => {
    if (!token) return { ok: false, error: '需要 GitHub Token' }
    try {
      const me = await net.fetch('https://api.github.com/user', { headers: ghHeaders(token) })
      if (!me.ok) return { ok: false, error: me.status === 401 ? 'Token 无效' : `HTTP ${me.status}` }
      const user = (await me.json()) as { login: string; avatar_url?: string; public_repos?: number; followers?: number; following?: number }
      const res = await net.fetch('https://api.github.com/user/repos?sort=updated&per_page=30&affiliation=owner', { headers: ghHeaders(token) })
      const data = res.ok ? ((await res.json()) as GhRepo[]) : []
      return { ok: true, user: { login: user.login, avatar: user.avatar_url, repos: user.public_repos, followers: user.followers, following: user.following }, repos: data.map(mapRepo) }
    } catch (e) { return { ok: false, error: String(e) } }
  })
  ipcMain.handle('github-search', async (_e, q: string, token?: string) => {
    try {
      const res = await net.fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`, { headers: ghHeaders(token) })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const data = (await res.json()) as { items?: GhRepo[] }
      return { ok: true, repos: (data.items || []).map(mapRepo) }
    } catch (e) { return { ok: false, error: String(e) } }
  })
  ipcMain.handle('github-readme', async (_e, owner: string, repo: string, token?: string) => {
    try {
      const res = await net.fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers: { ...ghHeaders(token), accept: 'application/vnd.github.raw+json' } })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      return { ok: true, text: (await res.text()).slice(0, 8000) }
    } catch (e) { return { ok: false, error: String(e) } }
  })

  // 正在播放的媒体（SMTC）+ 媒体键控制（迷你条音乐模式）
  // 多仓库仪表盘：读单个本地仓库的 git 状态（只读，不改动仓库）
  ipcMain.handle('git-status', async (_e, dir: string) => {
    const run = (args: string[]): Promise<string> =>
      new Promise((resolve) => {
        const p = spawn('git', ['-C', dir, ...args], { windowsHide: true })
        let out = ''
        p.stdout.on('data', (d) => { out += String(d) })
        p.on('close', () => resolve(out.trim()))
        p.on('error', () => resolve(''))
      })
    try {
      const inside = await run(['rev-parse', '--is-inside-work-tree'])
      if (inside !== 'true') return { ok: false, error: '不是 git 仓库' }
      const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD'])
      const porcelain = await run(['status', '--porcelain'])
      const dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0
      const last = await run(['log', '-1', '--format=%h|%s|%cr'])
      const [commit = '', subject = '', when = ''] = last.split('|')
      let ahead = 0, behind = 0
      const counts = await run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
      if (counts && /\d+\s+\d+/.test(counts)) { const [a, b] = counts.split(/\s+/).map(Number); ahead = a || 0; behind = b || 0 }
      return { ok: true, branch, dirty, commit, subject, when, ahead, behind }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  ipcMain.on('open-folder', (_e, dir: string) => {
    const target = String(dir || '')
    if (!target || target.length > 4096 || hasNul(target)) return
    void openPathTarget(target)
  })

  ipcMain.handle('capture-screen', async () => {
    const url = await captureScreenDataUrl()
    return url ? { ok: true, dataUrl: url } : { ok: false }
  })

  // Markdown 本地文件：打开 / 另存为
  ipcMain.handle('open-md-file', async () => {
    try {
      const r = await showOwnedOpenDialog({ title: '打开 Markdown 文件', properties: ['openFile'], filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt', 'mdx'] }] })
      if (r.canceled || !r.filePaths[0]) return { ok: false }
      const path = r.filePaths[0]
      const content = await readFile(path, 'utf8')
      return { ok: true, path, name: basename(path), content }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  ipcMain.handle('save-md-file', async (_e, content: string, suggestName: string, existingPath?: string) => {
    try {
      let path = existingPath
      if (!path) {
        const r = await showOwnedSaveDialog({ title: '保存 Markdown', defaultPath: (suggestName || '未命名') + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] })
        if (r.canceled || !r.filePath) return { ok: false }
        path = r.filePath
      }
      await writeFile(path, content, 'utf8')
      return { ok: true, path, name: basename(path) }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // 导出 PDF：离屏窗口渲染 HTML → printToPDF → 另存
  ipcMain.handle('export-pdf', async (_e, html: string, name: string) => {
    let w: BrowserWindow | null = null
    try {
      if (typeof html !== 'string' || html.length > 5_000_000 || hasNul(html)) return { ok: false, error: 'HTML 内容无效或过大' }
      w = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          allowRunningInsecureContent: false
        }
      })
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
      const r = await showOwnedSaveDialog({ title: '导出 PDF', defaultPath: safeName(name, '文档') + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
      if (r.canceled || !r.filePath) return { ok: false }
      await writeFile(r.filePath, pdf)
      return { ok: true, path: r.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    } finally {
      w?.destroy()
    }
  })
  // 导出任意文本文件（HTML / TXT 等）
  ipcMain.handle('save-text', async (_e, content: string, name: string, ext: string) => {
    try {
      const safe = safeExt(ext)
      if (!safe) return { ok: false, error: '文件扩展名无效' }
      if (typeof content !== 'string' || content.length > 10_000_000 || hasNul(content)) return { ok: false, error: '内容无效或过大' }
      const r = await showOwnedSaveDialog({ title: '导出', defaultPath: `${safeName(name, '文档')}.${safe}`, filters: [{ name: safe.toUpperCase(), extensions: [safe] }] })
      if (r.canceled || !r.filePath) return { ok: false }
      await writeFile(r.filePath, content, 'utf8')
      return { ok: true, path: r.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('media-info', () => getMediaInfo())
  ipcMain.on('media-key', (_e, cmd: string) => mediaKey(String(cmd)))
  // 歌词：从 lrclib.net（免费无鉴权）按曲名+歌手取 LRC；走 net.fetch 继承系统代理
  ipcMain.handle('lyrics-fetch', async (_e, title: string, artist: string) => {
    try {
      const u = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist || '')}`
      const res = await net.fetch(u)
      if (!res.ok) return { ok: false }
      const j = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string }
      return { ok: true, lrc: j.syncedLyrics || '', plain: j.plainLyrics || '' }
    } catch {
      return { ok: false }
    }
  })

  // 内嵌真 PTY 终端（ConPTY PowerShell，多标签）
  setPtySink((id, data) => win?.webContents.send('pty-data', { id, data }))
  ipcMain.handle('pty-ensure', (_e, id: string, cols: number, rows: number) => ptyEnsure(String(id), Number(cols), Number(rows)))
  ipcMain.on('pty-input', (_e, id: string, data: string) => ptyInput(String(id), String(data)))
  ipcMain.on('pty-resize', (_e, id: string, cols: number, rows: number) => ptyResize(String(id), Number(cols), Number(rows)))
  ipcMain.on('pty-kill', (_e, id: string) => ptyKill(String(id)))
  app.on('will-quit', () => { stopClipboardWatch?.(); ptyKillAll(); globalShortcut.unregisterAll() })

  // 智能勿扰：渲染层把最终勿扰态告知主进程（真则不自动弹窗/响铃）
  ipcMain.on('set-dnd', (_e, active: boolean) => { dndActive = !!active })

  // 桌面挂件：开关 + 主渲染层推送速览数据 → 转发给挂件窗口
  ipcMain.on('toggle-widget', (_e, active: boolean) => { if (active) openWidget(); else closeWidget() })
  ipcMain.on('widget-push', (_e, data: unknown) => {
    lastWidgetData = data
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send('widget-data', data)
  })
  ipcMain.on('widget-reveal', () => { win?.webContents.send('reveal') })

  // 钉屏便利贴：开关 / 内容更新 / 浮贴自身关闭
  ipcMain.on('toggle-sticky', (_e, note: StickyNoteData) => {
    if (stickyWins.has(note.id)) closeSticky(note.id)
    else openSticky(note)
  })
  ipcMain.on('sticky-push', (_e, note: StickyNoteData) => {
    const w = stickyWins.get(note.id)
    if (w && !w.isDestroyed()) w.webContents.send('sticky-data', note)
  })
  ipcMain.on('close-sticky', (_e, id: number) => closeSticky(id))

  // 闪念胶囊：渲染层关闭后还原（若面板未展开则恢复点击穿透，让键盘焦点归还桌面）
  ipcMain.on('capsule-closed', () => {
    if (!win) return
    win.blur()
    win.setIgnoreMouseEvents(true, { forward: true })
  })

  // 灵感便签：抓取网页正文（去标签的纯文本，供 AI 整理成便签）
  ipcMain.handle('fetch-url-text', async (_e, url: string) => fetchPageText(String(url), 30000))

  // 飞书日历：拉取并解析 ICS 订阅链接（主进程 fetch，避免渲染层跨域限制）
  ipcMain.handle('calendar-fetch', async (_e, url: string) => {
    try {
      if (!/^(https|webcal):\/\//i.test(String(url))) return { ok: false, error: '链接需以 https:// 或 webcal:// 开头' }
      return { ok: true, events: await fetchIcs(String(url)) }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })

  // 飞书日历 CalDAV（官方支持路径：设置→日历→CalDAV 同步 生成账号）
  ipcMain.handle('caldav-fetch', async (_e, cfg: { server: string; username: string; password: string }) => {
    try {
      // 飞书给的地址是裸域名（caldav.feishu.cn）——自动补 https:// 前缀
      const server = /^https?:\/\//i.test(String(cfg?.server || '')) ? cfg.server : `https://${String(cfg?.server || '').trim()}`
      if (!cfg?.username || !cfg?.password) return { ok: false, error: '请填写 CalDAV 用户名与密码' }
      return { ok: true, events: await fetchCaldav({ ...cfg, server }, parseIcs) }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })

  // 跳转到终端/桌面端：
  //  1) 已捕获窗口句柄 → 聚焦(最小化自动还原) + WT 多标签时 UIA 精确切到该会话的标签页
  //  2) 进程链反查 → 同上
  //  3) 终端标题含项目名 → 4) 桌面端应用窗口（Claude/Codex/ChatGPT，任意进程按标题/进程名，最小化还原）
  ipcMain.handle('jump-to-terminal', async (_e, agentId: string) => {
    const agent = store.snapshot().agents.find((a) => a.id === agentId)
    if (!agent) return false
    yieldToExternalApp()
    const tabHints = [agent.proj, agent.backend === 'codex' ? 'codex' : 'claude'].filter(Boolean)
    if (agent.termHwnd && (await focusByHwnd(agent.termHwnd))) {
      selectWtTab(agent.termHwnd, tabHints).catch(() => {}) // 尽力切标签页，失败不影响窗口聚焦
      return true
    }
    if (agent.ppid && (await focusByPid(agent.ppid))) return true
    if (await focusByTitle(agent.proj || '')) return true
    // 桌面端兜底：不限进程名按标题匹配（终端名单外的 Electron 应用）
    const apps = agent.backend === 'codex' ? ['Codex', 'ChatGPT'] : ['Claude']
    for (const t of apps) {
      if (await focusAnyByTitle(t)) return true
    }
    return false
  })

  ipcMain.on('set-autostart', (_e, on: boolean) => {
    app.setLoginItemSettings({ openAtLogin: on })
  })

  ipcMain.on('reposition', (_e, opts: { follow: boolean; monitorIndex: number }) => {
    follow = opts.follow
    monitorIndex = opts.monitorIndex
    if (win) positionWindow(win)
  })

  // 尺寸切换只是渲染层布局变化，保留为空实现（兼容旧调用）
  ipcMain.on('set-size-mode', () => { /* no-op */ })
  // 全屏模式：窗口铺满整个物理显示器（display.bounds，screen-saver 层级可盖任务栏）；退出回到工作区
  ipcMain.on('set-full-mode', (_e, full: boolean) => {
    fullMode = !!full
    if (win) positionWindow(win, true)
  })
  // 真实显示器列表（设置页选择用）
  ipcMain.handle('get-displays', () => {
    const primaryId = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      index: i,
      label: d.label || `显示器 ${i + 1}`,
      primary: d.id === primaryId,
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor
    }))
  })

  // 界面缩放（字体清晰度/可读性：0.9–1.3）
  ipcMain.on('set-zoom', (_e, z: number) => {
    win?.webContents.setZoomFactor(Math.max(0.85, Math.min(1.35, Number(z) || 1)))
  })

  // 灵动岛整体宽度（标准模式，380–880；迷你条宽度随之同步）
  ipcMain.on('set-island-width', () => { /* 窗口恒定铺满，岛宽只是渲染层布局，无需 resize */ })

  ipcMain.handle('install-hooks', () => {
    try {
      doInstallHooks()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) }
    }
  })

  ipcMain.handle('uninstall-hooks', () => {
    try {
      uninstallClaudeCode(forwarderPath('cc-forward.mjs'))
      uninstallCodex(forwarderPath('codex-forward.mjs'))
      uninstallCodexNotify()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) }
    }
  })

  ipcMain.handle('llm-complete', (_e, cfg: LlmRequestConfig, system: string, user: string | Array<Record<string, unknown>>, deep?: boolean, history?: { role: 'user' | 'assistant'; content: string }[]) =>
    llmComplete(cfg, system, user, deep, history || []))

  ipcMain.on('open-external', (_e, url: string) => {
    const external = safeExternalUrl(url)
    if (external) void openExternalTarget(external)
  })
  ipcMain.handle('llm-test', (_e, cfg: LlmRequestConfig) => llmTest(cfg))
  // 截图工坊：渲染层主动触发框选截图（复用 ms-screenclip 流程，事件仍走 screenshot-captured）
  ipcMain.on('trigger-screenshot', (_e, target: ScreenshotTarget) => openScreenshot(target === 'studio' ? 'studio' : 'ask'))

  ipcMain.handle('recording-sources', async () => {
    try {
      const displayList = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
      const displays = new Map(displayList.map((display) => [String(display.id), display]))
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 360, height: 203 },
        fetchWindowIcons: true
      })
      const ownSourceIds = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).map((window) => window.getMediaSourceId())
      const ownWindowHandles = new Set(ownSourceIds.map(recordingWindowHandle).filter((handle): handle is string => Boolean(handle)))
      const items: RecordingSource[] = sources.filter((source) => {
        const handle = recordingWindowHandle(source.id)
        return !ownSourceIds.includes(source.id) && (!handle || !ownWindowHandles.has(handle))
      }).map((source, sourceOrder) => {
        const display = displays.get(source.display_id)
        const kind: RecordingSource['kind'] = source.id.startsWith('screen:') ? 'screen' : 'window'
        const thumbnail = source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL()
        const displayIndex = display ? displayList.findIndex((item) => item.id === display.id) : -1
        const physicalWidth = display ? Math.max(2, Math.round(display.bounds.width * display.scaleFactor)) : 0
        const physicalHeight = display ? Math.max(2, Math.round(display.bounds.height * display.scaleFactor)) : 0
        const nativeSize = display ? { width: physicalWidth - (physicalWidth % 2), height: physicalHeight - (physicalHeight % 2) } : undefined
        return {
          id: source.id,
          name: source.name,
          kind,
          displayId: source.display_id || undefined,
          thumbnail,
          appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : undefined,
          available: Boolean(thumbnail),
          unavailableReason: thumbnail ? undefined : (kind === 'window' ? '窗口可能已最小化、关闭或禁止捕获' : '显示器画面暂不可用'),
          displayLabel: kind === 'screen' && displayIndex >= 0 ? `${display?.id === screen.getPrimaryDisplay().id ? '主显示器' : `显示器 ${displayIndex + 1}`} · ${nativeSize?.width}×${nativeSize?.height}` : undefined,
          aspectRatio: source.thumbnail.isEmpty() ? undefined : source.thumbnail.getAspectRatio(),
          bounds: kind === 'screen' && display ? { ...display.bounds } : undefined,
          scaleFactor: kind === 'screen' ? display?.scaleFactor : undefined,
          displayIndex: kind === 'screen' && displayIndex >= 0 ? displayIndex : undefined,
          isPrimary: kind === 'screen' ? display?.id === screen.getPrimaryDisplay().id : undefined,
          rotation: kind === 'screen' ? display?.rotation : undefined,
          workArea: kind === 'screen' && display ? { ...display.workArea } : undefined,
          nativeSize: kind === 'screen' ? nativeSize : undefined,
          sourceOrder
        }
      }).sort((a, b) => a.kind === b.kind ? Number(b.available) - Number(a.available) || a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'screen' ? -1 : 1)
      return { ok: true, sources: items }
    } catch (e) {
      return { ok: false, error: String(e instanceof Error ? e.message : e) }
    }
  })
  ipcMain.handle('recording-cursor', () => {
    const point = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(point)
    return {
      x: point.x,
      y: point.y,
      displayId: String(display.id),
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor
    }
  })
  ipcMain.on('recording-protection', (_e, active: boolean) => {
    for (const window of BrowserWindow.getAllWindows()) window.setContentProtection(Boolean(active))
  })
  ipcMain.handle('recording-anime-model', async (_event, requested: RecordingAnimeModel = 'handdrawn') => {
    try {
      const model = requested === 'portrait' || requested === 'comic' ? requested : 'handdrawn'
      const files: Record<RecordingAnimeModel, string> = {
        handdrawn: 'recording-anime-handdrawn.onnx',
        portrait: 'recording-anime-face-v2.onnx',
        comic: 'recording-anime-comic.onnx'
      }
      const names: Record<RecordingAnimeModel, string> = {
        handdrawn: '日系手绘动画',
        portrait: '柔和动画人像',
        comic: '漫画人物'
      }
      const path = app.isPackaged
        ? join(process.resourcesPath, 'models', files[model])
        : join(app.getAppPath(), 'resources', 'models', files[model])
      const data = await readFile(path)
      return {
        ok: true,
        name: names[model],
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      }
    } catch (error) {
      return { ok: false, error: String(error instanceof Error ? error.message : error) }
    }
  })
  ipcMain.handle('recording-preview', async (_event, input: ArrayBuffer | Uint8Array) => {
    let previewDir = ''
    try {
      const data = input instanceof ArrayBuffer
        ? Buffer.from(input)
        : ArrayBuffer.isView(input)
          ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
          : null
      if (!data || data.length < 1024) return { ok: false, error: '录制数据为空' }
      if (data.length > 1_600_000_000) return { ok: false, error: '单次预览不能超过 1.6GB' }
      const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      previewDir = await mkdtemp(join(tmpdir(), 'agentic-island-recording-preview-'))
      const filePath = join(previewDir, 'capture.webm')
      await writeFile(filePath, data)
      recordingPreviewDirs.set(id, previewDir)
      return { ok: true, id, url: pathToFileURL(filePath).href }
    } catch (e) {
      if (previewDir) await rm(previewDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {})
      return { ok: false, error: String(e instanceof Error ? e.message : e) }
    }
  })
  ipcMain.on('recording-preview-release', (_event, id: string) => {
    const previewDir = recordingPreviewDirs.get(String(id || ''))
    if (!previewDir) return
    recordingPreviewDirs.delete(String(id || ''))
    void rm(previewDir, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 }).catch(() => {})
  })
  ipcMain.on('recording-export-cancel', (_e, jobId: string) => {
    recordingExportJobs.get(String(jobId || ''))?.kill()
  })
  const exportRecordingPath = async (event: IpcMainInvokeEvent, inputPath: string, rawRequest: RecordingExportRequest) => {
    const jobId = String(rawRequest?.jobId || `recording-${Date.now()}`)
    const sendProgress = (phase: RecordingExportProgress['phase'], progress: number, message?: string): void => {
      event.sender.send('recording-export-progress', { jobId, phase, progress, message } satisfies RecordingExportProgress)
    }
    let outputPath = ''
    let exportTempDir = ''
    try {
      const format = rawRequest.format === 'mp4' || rawRequest.format === 'gif' || rawRequest.format === 'mp3' ? rawRequest.format : 'webm'
      const request: RecordingExportRequest = {
        ...rawRequest,
        jobId,
        format,
        quality: rawRequest.quality || 'balanced',
        durationMs: Math.max(1, Number(rawRequest.durationMs) || 1),
        trimStartMs: Math.max(0, Number(rawRequest.trimStartMs) || 0),
        trimEndMs: Math.max(1, Number(rawRequest.trimEndMs) || Number(rawRequest.durationMs) || 1),
        width: Math.max(1, Number(rawRequest.width) || 1920),
        height: Math.max(1, Number(rawRequest.height) || 1080),
        fps: Math.max(1, Number(rawRequest.fps) || 30),
        outputWidth: Math.max(2, Math.min(7680, Number(rawRequest.outputWidth) || Number(rawRequest.width) || 1920)),
        outputHeight: Math.max(2, Math.min(4320, Number(rawRequest.outputHeight) || Number(rawRequest.height) || 1080)),
        outputFps: Math.max(1, Math.min(120, Number(rawRequest.outputFps) || Number(rawRequest.fps) || 30)),
        subtitleFilePath: undefined
      }
      if (format === 'mp3' && !request.hasAudio) return { ok: false, error: '该录制没有音轨，无法导出 MP3' }
      const label = format === 'gif' ? 'GIF 动图' : format === 'mp4' ? 'MP4 视频' : format === 'mp3' ? 'MP3 音频' : 'WebM 视频'
      const save = await showOwnedSaveDialog({
        title: '导出录屏',
        defaultPath: `${safeName(request.name, 'recording')}.${format}`,
        filters: [{ name: label, extensions: [format] }]
      })
      if (save.canceled || !save.filePath) return { ok: false, canceled: true }
      outputPath = save.filePath
      sendProgress('preparing', 0.02, '正在准备录制数据')

      if ((format === 'mp4' || format === 'webm') && request.subtitle?.mode === 'embedded' && request.subtitle.segments.length) {
        const timecode = (value: number): string => {
          const total = Math.max(0, Math.round(value))
          const hours = Math.floor(total / 3_600_000)
          const minutes = Math.floor(total % 3_600_000 / 60_000)
          const seconds = Math.floor(total % 60_000 / 1000)
          const millis = total % 1000
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
        }
        const segments = recordingExportSubtitleSegments(request).slice(0, 20_000)
        if (segments.length) {
          exportTempDir = await mkdtemp(join(tmpdir(), 'agentic-island-subtitle-'))
          const subtitlePath = join(exportTempDir, 'subtitle.srt')
          const body = segments.map((item, index) => `${index + 1}\n${timecode(item.startMs)} --> ${timecode(item.endMs)}\n${item.text.replace(/\r?\n/g, ' ')}\n`).join('\n')
          await writeFile(subtitlePath, body, 'utf8')
          request.subtitleFilePath = subtitlePath
        }
      }

      const fullRange = request.trimStartMs === 0 && request.trimEndMs === request.durationMs
      if (format === 'webm' && request.quality === 'original' && fullRange && !recordingHasEdits(request)) {
        await copyFile(inputPath, outputPath)
        sendProgress('done', 1, '原始录制已保存')
        return { ok: true, path: outputPath }
      }

      const configured = String(ffmpegStatic || '')
      const executable = app.isPackaged ? configured.replace('app.asar', 'app.asar.unpacked') : configured
      if (!executable) return { ok: false, error: '内置 FFmpeg 不可用，请改用原始 WebM 导出' }
      sendProgress('encoding', 0.05, format === 'gif' ? '正在生成 GIF 调色板' : format === 'mp3' ? '正在编码音频' : '正在压缩视频')
      const running = startRecordingFfmpeg(executable, inputPath, outputPath, request, (value) => {
        sendProgress('encoding', 0.05 + value * 0.94)
      })
      recordingExportJobs.set(jobId, running.child)
      await running.done
      sendProgress('done', 1, '导出完成')
      return { ok: true, path: outputPath }
    } catch (e) {
      const canceled = String(e instanceof Error ? e.message : e).includes('取消')
      if (outputPath && canceled) await rm(outputPath, { force: true }).catch(() => {})
      sendProgress(canceled ? 'canceled' : 'error', 0, canceled ? '已取消导出' : String(e instanceof Error ? e.message : e))
      return { ok: false, canceled, error: canceled ? undefined : String(e instanceof Error ? e.message : e) }
    } finally {
      recordingExportJobs.delete(jobId)
      if (exportTempDir) await rm(exportTempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
  ipcMain.handle('recording-session-create', async (_event, input: RecordingSessionCreateInput) => {
    try { return { ok: true, session: await recordingSessions.create(input) } }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-session-append', async (_event, id: string, index: number, input: ArrayBuffer | Uint8Array) => {
    try { return { ok: true, session: await recordingSessions.append(String(id || ''), Number(index), input) } }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-session-finalize', async (_event, id: string, durationMs: number) => {
    try {
      const result = await recordingSessions.finalize(String(id || ''), durationMs)
      return { ok: true, session: result.manifest, url: pathToFileURL(result.filePath).href }
    } catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-session-list', () => {
    try { return { ok: true, sessions: recordingSessions.list() } }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-session-recover', async (_event, id: string) => {
    try {
      const result = await recordingSessions.recover(String(id || ''))
      return { ok: true, session: result.manifest, url: pathToFileURL(result.filePath).href }
    } catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-session-discard', async (_event, id: string) => {
    try {
      const sessionId = String(id || '')
      await recordingSessions.discard(sessionId)
      await recordingProjects.deleteBySession(sessionId)
      return { ok: true }
    }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-export-session', async (event, id: string, request: RecordingExportRequest) => {
    const session = recordingSessions.getFile(String(id || ''))
    if (!session) return { ok: false, error: '录制会话不存在或已清理' }
    return exportRecordingPath(event, session.filePath, request)
  })
  ipcMain.handle('recording-transcribe-session', async (_event, id: string, cfg: LlmRequestConfig, model: string, language: 'auto' | 'zh' | 'en') => {
    const session = recordingSessions.getFile(String(id || ''))
    if (!session) return { ok: false, error: '录制会话不存在或已清理' }
    if (!session.manifest.hasAudio) return { ok: false, error: '该录制没有音轨' }
    const configured = String(ffmpegStatic || '')
    const executable = app.isPackaged ? configured.replace('app.asar', 'app.asar.unpacked') : configured
    if (!executable) return { ok: false, error: '内置 FFmpeg 不可用' }
    return transcribeRecordingFile(executable, session.filePath, cfg, model, language)
  })
  ipcMain.handle('recording-project-save', async (_event, input: RecordingProjectSaveInput) => {
    try {
      if (!recordingSessions.getFile(String(input?.sessionId || ''))) return { ok: false, error: '工程关联的录屏素材不存在或已清理' }
      return { ok: true, project: await recordingProjects.save(input) }
    } catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-project-list', async () => {
    try { return { ok: true, projects: recordingProjects.list() } }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-project-load', async (_event, id: string) => {
    try {
      const project = recordingProjects.load(String(id || ''))
      if (!project) return { ok: false, error: '录屏工程不存在' }
      if (!recordingSessions.getFile(project.sessionId)) return { ok: false, error: '工程素材已被清理，无法继续编辑' }
      return { ok: true, project }
    } catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-project-duplicate', async (_event, id: string) => {
    try { return { ok: true, project: await recordingProjects.duplicate(String(id || '')) } }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-project-delete', async (_event, id: string) => {
    try { await recordingProjects.delete(String(id || '')); return { ok: true } }
    catch (error) { return { ok: false, error: String(error instanceof Error ? error.message : error) } }
  })
  ipcMain.handle('recording-export', async (event, input: ArrayBuffer | Uint8Array, rawRequest: RecordingExportRequest) => {
    let tempDir = ''
    try {
      const data = input instanceof ArrayBuffer
        ? Buffer.from(input)
        : ArrayBuffer.isView(input)
          ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
          : null
      if (!data?.length) return { ok: false, error: '录制数据为空' }
      if (data.length > 1_600_000_000) return { ok: false, error: '内存录制导出不能超过 1.6GB，请使用分块录制' }
      tempDir = await mkdtemp(join(tmpdir(), 'agentic-island-recording-'))
      const inputPath = join(tempDir, 'capture.webm')
      await writeFile(inputPath, data)
      return await exportRecordingPath(event, inputPath, rawRequest)
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
  const imageDataLimit = 160_000_000
  const validImageData = (value: string): boolean => /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value) && value.length <= imageDataLimit
  // 图片写剪贴板。返回结果，避免渲染层在失败时仍提示成功。
  ipcMain.handle('copy-image', (_e, dataUrl: string) => {
    const url = String(dataUrl || '')
    if (!validImageData(url)) return { ok: false, error: '图片数据无效或超过 160MB' }
    try {
      const image = nativeImage.createFromDataURL(url)
      if (image.isEmpty()) return { ok: false, error: '图片解码失败' }
      clipboard.writeImage(image)
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e instanceof Error ? e.message : e) } }
  })
  // 图片存盘，格式由 data URL 决定。
  ipcMain.handle('save-image', async (_e, dataUrl: string, name: string) => {
    try {
      const url = String(dataUrl || '')
      if (!validImageData(url)) return { ok: false, error: '图片数据无效或超过 160MB' }
      const mime = /^data:image\/(png|jpe?g|webp);/i.exec(url)?.[1]?.toLowerCase() || 'png'
      const ext = mime === 'jpeg' || mime === 'jpg' ? 'jpg' : mime
      const label = ext === 'png' ? 'PNG 图片' : ext === 'jpg' ? 'JPEG 图片' : 'WebP 图片'
      const r = await showOwnedSaveDialog({ title: '保存截图', defaultPath: `${safeName(name, 'screenshot')}.${ext}`, filters: [{ name: label, extensions: [ext] }] })
      if (r.canceled || !r.filePath) return { ok: false, canceled: true }
      const b64 = url.replace(/^data:image\/[\w+.-]+;base64,/, '')
      await writeFile(r.filePath, Buffer.from(b64, 'base64'))
      return { ok: true, path: r.filePath }
    } catch (e) { return { ok: false, error: String(e instanceof Error ? e.message : e) } }
  })
  ipcMain.handle('open-image-file', async () => {
    try {
      const r = await showOwnedOpenDialog({ title: '打开图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
      if (r.canceled || !r.filePaths[0]) return { ok: false }
      const path = r.filePaths[0]
      const ext = path.toLowerCase().split('.').pop() || 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      const raw = await readFile(path)
      if (raw.length > imageDataLimit * 0.75) return { ok: false, error: '图片文件超过 120MB' }
      return { ok: true, dataUrl: `data:${mime};base64,${raw.toString('base64')}`, name: basename(path).replace(/\.[^.]+$/, '') }
    } catch (e) { return { ok: false, error: String(e instanceof Error ? e.message : e) } }
  })
  ipcMain.handle('read-clipboard-image', () => {
    try {
      const image = clipboard.readImage()
      if (image.isEmpty()) return { ok: false, error: '剪贴板中没有图片' }
      return { ok: true, dataUrl: image.toDataURL() }
    } catch (e) { return { ok: false, error: String(e instanceof Error ? e.message : e) } }
  })
  // ===== 快捷指令（M1）：PowerShell 执行 / 万能打开 / 剪贴板读写 =====
  ipcMain.handle('shortcut-shell', (_e, cmd: string, cwd?: string) => {
    const command = String(cmd || '')
    const workdir = cwd === undefined ? undefined : String(cwd)
    if (!command.trim()) return Promise.resolve({ ok: false, error: '命令为空' })
    if (command.length > 12000 || hasNul(command)) return Promise.resolve({ ok: false, error: '命令无效或过长' })
    if (workdir && (workdir.length > 1000 || hasNul(workdir))) return Promise.resolve({ ok: false, error: '工作目录无效' })
    return new Promise((resolve) => {
      let done = false
      const settle = (r: { ok: boolean; output?: string; error?: string }): void => { if (!done) { done = true; resolve(r) } }
      try {
        const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { cwd: workdir || app.getPath('home'), windowsHide: true })
        let out = ''
        let err = ''
        const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(p.pid), '/t', '/f'], { windowsHide: true }) } catch { /* */ } settle({ ok: false, output: out.trim(), error: '执行超时（60s），已终止' }) }, 60_000)
        p.stdout.on('data', (d) => { out += String(d) })
        p.stderr.on('data', (d) => { err += String(d) })
        p.on('close', (code) => { clearTimeout(timer); settle({ ok: code === 0, output: out.trim().slice(0, 8000), error: err.trim().slice(0, 2000) || undefined }) })
        p.on('error', (e) => { clearTimeout(timer); settle({ ok: false, error: String(e instanceof Error ? e.message : e) }) })
        // 中文输出必须显式 UTF-8，否则 GBK 乱码（工程约束 #6）
        p.stdin.write('[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n' + command + '\n', 'utf8')
        p.stdin.end()
      } catch (e) { settle({ ok: false, error: String(e) }) }
    })
  })
  ipcMain.handle('shortcut-open', async (_e, target: string) => {
    const t = String(target).trim().replace(/%home%/gi, app.getPath('home'))
    if (t.length > 4096 || hasNul(t)) return { ok: false, error: '目标无效或过长' }
    if (!t) return { ok: false, error: '目标为空' }
    const external = safeExternalUrl(t)
    if (external) { void openExternalTarget(external); return { ok: true } }
    const r = await openPathTarget(t)
    return r ? { ok: false, error: r } : { ok: true }
  })
  ipcMain.handle('clip-read-text', () => clipboard.readText())
  ipcMain.on('clip-write-text', (_e, t: string) => clipboard.writeText(String(t)))

  // 本地 Agent CLI（Claude Code / Codex 无头模式，JSONL 流式）：问答的另一种引擎，继承本机全部配置
  ipcMain.handle('agent-cli-check', (_e, engine: AgentEngine) => agentCliCheck(engine))
  let agentRunSeq = 0
  ipcMain.handle('agent-cli-stream', async (_e, engine: AgentEngine, prompt: string, cwd?: string, cont?: boolean) => {
    const runId = 'ar' + ++agentRunSeq
    const r = await agentCliStream(engine, String(prompt), cwd, !!cont, (ev) => win?.webContents.send('agent-cli-event', { runId, ev }))
    return r.ok ? { ok: true, runId } : { ok: false, error: r.error }
  })
  ipcMain.on('agent-cli-cancel', (_e, engine: AgentEngine) => agentCliCancel(engine))
  ipcMain.handle('llm-embed', (_e, cfg: LlmRequestConfig, texts: string[]) => llmEmbed(cfg, texts))

  // ===== 知识库（本地 RAG）===== 所有异步入口 try/catch，避免主进程抛出让渲染层 invoke 挂起（面板一直转圈=“失败”）
  const kbGuard = async <T,>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> => {
    try { return await fn() } catch (e) { console.error('[kb]', e); return { ok: false, error: String(e instanceof Error ? e.message : e) } }
  }
  ipcMain.handle('kb-list', async () => { try { return await kb.listSources() } catch { return [] } })
  ipcMain.handle('kb-add-folder', (_e, cfg: LlmRequestConfig) => kbGuard(async () => {
    const r = await showOwnedOpenDialog({ title: '选择要接入知识库的文件夹', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    return kb.addFolder(cfg, r.filePaths[0], Date.now())
  }))
  ipcMain.handle('kb-add-files', (_e, cfg: LlmRequestConfig) => kbGuard(async () => {
    const r = await showOwnedOpenDialog({
      title: '选择要接入知识库的文件', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文档/文本/代码', extensions: ['md', 'markdown', 'mdx', 'txt', 'pdf', 'docx', 'json', 'csv', 'py', 'ts', 'js', 'tsx', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'html', 'css', 'sql', 'yaml', 'yml'] }]
    })
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true }
    return kb.addFiles(cfg, r.filePaths, Date.now())
  }))
  ipcMain.handle('kb-add-url', (_e, cfg: LlmRequestConfig, url: string) => kbGuard(async () => {
    const page = await fetchPageText(String(url), 60000)
    if (!page.ok || !page.text) return { ok: false, error: page.error || '抓取失败' }
    return kb.addUrl(cfg, String(url), page.title || String(url), page.text, Date.now())
  }))
  ipcMain.handle('kb-remove', (_e, id: string) => kbGuard(() => kb.removeSource(String(id))))
  ipcMain.handle('kb-reindex', (_e, cfg: LlmRequestConfig) => kbGuard(() => kb.reindex(cfg)))
  ipcMain.handle('kb-search', (_e, cfg: LlmRequestConfig, query: string, k?: number) => kbGuard(() => kb.search(cfg, String(query), k || 8)))
  ipcMain.handle('kb-sample-chunks', (_e, max?: number, sourceId?: string) => kbGuard(() => kb.sampleChunks(max || 20, sourceId)))
  ipcMain.handle('kb-get-wiki', async () => { try { return await kb.getWiki() } catch { return {} } })
  ipcMain.handle('kb-save-wiki', (_e, key: string, md: string) => kbGuard(() => kb.saveWiki(String(key), String(md), Date.now())))
  ipcMain.handle('load-state', () => loadState())
  ipcMain.on('save-state', (_e, state: Record<string, unknown>) => {
    saveState(state)
    // 同步主进程的提示音偏好（按类型的声效映射）
    const s = state as { settings?: { sound?: boolean; clipWatch?: boolean }; soundMap?: Record<string, string> }
    if (typeof s.settings?.sound === 'boolean') soundPref.on = s.settings.sound
    if (typeof s.settings?.clipWatch === 'boolean') setClipboardWatch(s.settings.clipWatch)
    if (s.soundMap && typeof s.soundMap === 'object') Object.assign(soundPref.map, s.soundMap)
  })
}

// 单实例锁：隔离运行审计可显式放行多实例，但生产环境始终保持单实例。
const auditUserData = process.env['AIISLAND_AUDIT_USER_DATA']?.trim()
const allowAuditInstance = process.env['AIISLAND_ALLOW_AUDIT_INSTANCE'] === '1' && Boolean(auditUserData)
if (allowAuditInstance) app.setPath('userData', auditUserData!)
if (!allowAuditInstance && !app.requestSingleInstanceLock()) {
  app.quit()
} else if (!allowAuditInstance) {
  app.on('second-instance', () => {
    if (win) { if (!externalYield?.isLowered()) win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); win.showInactive() }
  })
}

app.whenReady().then(async () => {
  await bridge.start()
  codexTail.start() // Codex 实时接入：跟随 rollout 日志
  kb.initKb(app.getPath('userData')) // 知识库索引存放于 userData/kb-index.json
  recordingSessions = new RecordingSessionStore(join(app.getPath('userData'), 'recordings'))
  await recordingSessions.initialize()
  recordingProjects = new RecordingProjectStore(join(app.getPath('userData'), 'recording-projects'))
  await recordingProjects.initialize()
  wireIpc()

  // 应用持久化的开机自启与显示器偏好，并按需自动接入所有 CLI/终端
  try {
    const st = loadState() as
      | { settings?: { autostart?: boolean; multiMonitor?: boolean; autoConnect?: boolean; sound?: boolean; largeSize?: boolean; clipWatch?: boolean }; activeMonitor?: number; selectedSound?: string }
      | null
    if (st?.settings) {
      if (typeof st.settings.autostart === 'boolean') app.setLoginItemSettings({ openAtLogin: st.settings.autostart })
      if (typeof st.settings.multiMonitor === 'boolean') follow = st.settings.multiMonitor
      if (typeof st.settings.sound === 'boolean') soundPref.on = st.settings.sound
      if (typeof st.settings.clipWatch === 'boolean') clipWatchEnabled = st.settings.clipWatch
    }
    if (typeof st?.activeMonitor === 'number') monitorIndex = Math.max(0, st.activeMonitor - 1)
    const stm = (st as { soundMap?: Record<string, string> } | null)?.soundMap
    if (stm && typeof stm === 'object') Object.assign(soundPref.map, stm)

    // 全局自动接入：默认开启（未显式关闭即安装）。AIISLAND_SKIP_HOOKS=1 可跳过（开发用）。
    const autoConnect = st?.settings?.autoConnect !== false
    if (autoConnect && !process.env['AIISLAND_SKIP_HOOKS']) {
      doInstallHooks()
    }
  } catch {
    /* 忽略 */
  }

  createWindow()
  createTray()
  startFollowLoop()
  // 显示器热插拔 / 分辨率 / DPI 变化 → 全部岛系窗口重定位
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-metrics-changed', onDisplayChange)
  // 全局热键：命令面板 Ctrl+Alt+K · 闪念胶囊 Ctrl+Alt+Space · 智能截图 Ctrl+Alt+S（注册失败不影响其它功能）
  try { globalShortcut.register('CommandOrControl+Alt+K', openPalette) } catch { /* 热键被占用 */ }
  try { globalShortcut.register('CommandOrControl+Alt+F', openBrain) } catch { /* 热键被占用 */ }
  try { globalShortcut.register('CommandOrControl+Alt+Space', openCapsule) } catch { /* 热键被占用 */ }
  try { globalShortcut.register('CommandOrControl+Alt+S', openScreenshot) } catch { /* 热键被占用 */ }
  try { globalShortcut.register('CommandOrControl+Alt+A', () => void openScreenAnalyze()) } catch { /* 热键被占用 */ }
  // 剪贴板助手：clipWatch 关闭时主进程也停止读取系统剪贴板
  setClipboardWatch(clipWatchEnabled)
  // 会议检测：麦克风/摄像头占用变化推给渲染层（渲染层结合"自动勿扰"开关决定是否静默）
  startDndWatch((active) => win?.webContents.send('dnd-state', active))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const process of recordingExportJobs.values()) process.kill()
  recordingExportJobs.clear()
  for (const previewDir of recordingPreviewDirs.values()) void rm(previewDir, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 }).catch(() => {})
  recordingPreviewDirs.clear()
  screenshotPoller.stop()
  finishScreenshotFlow()
  externalYield?.dispose()
  bridge.stop()
  if (process.platform !== 'darwin') app.quit()
})
