import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, safeStorage, screen, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'fs/promises'
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
import { complete as llmComplete, test as llmTest, embed as llmEmbed, listModels as llmListModels } from './llm-proxy'
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
import { netFetch, readBodyText } from './http-client'
import { setPtySink, ptyEnsure, ptyInput, ptyResize, ptyKill, ptyKillAll } from './term-pty'
import { createTerminalWorkspaceStore, terminalWorkspaceExportState } from './terminal-workspace-store'
import { inspectTerminalProject } from './terminal-project'
import { startClipboardWatch } from './clipboard-watch'
import { readClipboardImageDataUrl, writeClipboardImageDataUrl } from './clipboard-compat'
import { startDndWatch } from './dnd-watch'
import { initUpdater } from './updater'
import { setApprovalPolicy, approvalSessionAllow, setApprovalAuditSink, policyAutoDecision, clearSessionAllows } from './approval-policy'
import { createExternalYieldController, type ExternalYieldController } from './external-yield'
import { createScreenshotPoller } from './screenshot-poller'
import { drainMouseClicks, startMouseClickLog, stopMouseClickLog } from './mouse-hook'
import { buildRecordingRemuxArgs, createEncoderPicker, crfFor, probeRecordingOutput, recordingExportStrategy, recordingExportVerdict, type VideoEncoder, recordingExportSubtitleSegments, recordingHasEdits, startRecordingFfmpeg, startRecordingFfmpegWithArgs } from './recording-export'
import { sniffRecordingContainer } from '../shared/recording-format'
import { RecordingSessionStore } from './recording-session-store'
import { RecordingProjectStore } from './recording-project-store'
import { transcribeRecordingFile } from './recording-transcription'
import type { DecisionMessage, LlmRequestConfig, PinnedShotPayload, RecordingAnimeModel, RecordingExportProgress, RecordingExportRequest, RecordingProjectSaveInput, RecordingSessionCreateInput, RecordingSource, ScreenshotSnipRegion, ScreenshotTarget, ScrollHudState, TerminalShellProfile, TerminalWorkspaceState } from '../shared/protocol'
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
// 审批策略钩子装配：命中规则/本会话放行即自动放行并记审计；会话结束清理临时放行
store.setPolicyHooks({ autoDecision: policyAutoDecision, onSessionEnd: clearSessionAllows })

// 统一发送通道：退出收尾期窗口可能已销毁，裸 `win?.` 判空挡不住 "Object has been destroyed"
const safeSend = (channel: string, ...args: unknown[]): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}
const terminalWorkspace = createTerminalWorkspaceStore({
  filePath: () => join(app.getPath('userData'), 'terminal-workspace.json'),
  encrypt: (plain) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString('base64') : plain,
  decrypt: (cipher) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(cipher, 'base64')) : cipher
})
// 文档截图、安装验证和审计实例必须能隔离 discovery，避免覆盖真实 bridge.json。
const bridge = new BridgeServer(store, gitSummary, process.env.AIISLAND_BRIDGE_FILE || undefined)
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

/**
 * 审计实例（隔离 userData + 显式放行 + 指定导出目录）里免弹窗直接落盘。
 *
 * 原生保存框没法用 CDP 关掉，否则"导出"这条端到端链路在自动化里永远测不到——而这条链路恰好
 * 被"文件写成功但内容不对"坑过两次。三个环境变量缺一不可，正常运行时一个都不会有。
 */
const auditExportDir = (): string => {
  if (process.env['AIISLAND_ALLOW_AUDIT_INSTANCE'] !== '1') return ''
  if (!process.env['AIISLAND_AUDIT_USER_DATA']?.trim()) return ''
  return process.env['AIISLAND_AUDIT_EXPORT_DIR']?.trim() || ''
}

function showOwnedSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> {
  const auditDir = auditExportDir()
  if (auditDir && options.defaultPath) return Promise.resolve({ canceled: false, filePath: join(auditDir, basename(options.defaultPath)) })
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
    if (!win || win.isDestroyed()) return
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

// 定位代数：每次 positionWindow 递增，用于作废在途的 60ms 校验重试
let positionEpoch = 0
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
  // 混合 DPI 屏间移动时 setBounds 可能落到中间值（DIP 换算竞态）→ 60ms 后校验，不符强制重设一次。
  // epoch：期间若又发生了新的定位（切屏/全屏切换），本次过期重试直接作废，避免把窗口拉回旧位置
  const epoch = ++positionEpoch
  setTimeout(() => {
    if (w.isDestroyed() || epoch !== positionEpoch) return
    const now = w.getBounds()
    if (now.x !== x || now.y !== y || now.width !== width || now.height !== height) {
      w.setResizable(true)
      w.setBounds({ x, y, width, height })
      w.setResizable(false)
    }
  }, 60)
}

// 钉屏截图的窗口集合（声明在 onDisplayChange 之前：显示器变化时要遍历它重定位）
const pinnedShots = new Map<string, BrowserWindow>()
let snipWin: BrowserWindow | null = null
let scrollHudWin: BrowserWindow | null = null
let snipTarget: ScreenshotTarget = 'ask'
let snipMode: 'snip' | 'scroll' = 'snip'

/** 显示器热插拔 / 分辨率 / DPI 缩放变化：重定位全部岛系窗口（否则岛会偏、不再居中/铺满） */
function onDisplayChange(): void {
  try {
    const n = screen.getAllDisplays().length
    monitorIndex = Math.min(monitorIndex, Math.max(0, n - 1))
    if (win && !win.isDestroyed()) positionWindow(win, true)
    if (widgetWin && !widgetWin.isDestroyed()) placeWidget(widgetWin)
    // 钉屏截图也要跟着走：换屏/改分辨率后若留在原坐标，就会跑到不存在的显示器上
    for (const pinned of pinnedShots.values()) {
      if (pinned.isDestroyed()) continue
      const area = targetDisplay().workArea
      const bounds = pinned.getBounds()
      const x = Math.min(Math.max(bounds.x, area.x), area.x + Math.max(0, area.width - bounds.width))
      const y = Math.min(Math.max(bounds.y, area.y), area.y + Math.max(0, area.height - bounds.height))
      if (x !== bounds.x || y !== bounds.y) pinned.setBounds({ ...bounds, x, y })
    }
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
    collapse: () => safeSend('external-yield'),
    blur: () => win?.blur(),
    setClickThrough: (ignore) => {
      if (ignore) win?.setIgnoreMouseEvents(true, { forward: true })
      else win?.setIgnoreMouseEvents(false)
    },
    setTopmost: setAgenticWindowsTopmost
  })

  loadRenderer(win)

  // 无边框窗口开不了 DevTools —— 把渲染进程的报错转发到启动终端，便于排查
  // 无边框窗口开不了 DevTools —— 把渲染进程的报错转发到启动终端，便于排查
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId.split('/').pop()}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] crashed:', details.reason)
  })
  // reload/导航会丢弃防抖中的挂起状态：导航开始时先强制落盘，保证"状态能存活 reload"（截图脚本依赖此不变量）
  win.webContents.on('did-start-navigation', () => flushState())
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
  readImage: () => readClipboardImageDataUrl(),
  onCapture: (dataUrl) => {
    const target = screenshotTarget
    screenshotTarget = 'ask'
    finishScreenshotFlow()
    win?.setAlwaysOnTop(true, 'screen-saver')
    win?.setIgnoreMouseEvents(false)
    win?.show()
    win?.focus()
    safeSend('screenshot-captured', { dataUrl, target })
  },
  onTimeout: () => {
    screenshotTarget = 'ask'
    finishScreenshotFlow()
  }
})

/**
 * 应用内框选叠层（替代 Windows 截图工具）。
 *
 * 为什么自己做一个：`ms-screenclip:` 是工坊唯一的入口，**截图工具不可用或被策略禁用时整个工坊进不去**；
 * 而且它的输出要先落到剪贴板再读回来，多一道中转。自己做还顺手解决了多屏：叠层只覆盖**光标所在那块屏**，
 * 与抓帧路径（`prepareScreenCapture` 也是按光标挑屏）语义一致。
 *
 * 流程：叠层拖出矩形 → 主进程藏叠层 → 请渲染层按区域抓原生帧 → 打开工坊。
 * 抓图必须在叠层隐藏之后，否则会把自己那层暗底和选框拍进去。
 */
function openSnipOverlay(target: ScreenshotTarget, mode: 'snip' | 'scroll' = 'snip'): boolean {
  if (!win) return false
  if (snipWin && !snipWin.isDestroyed()) { snipWin.focus(); return true }
  const display = targetDisplay()
  const { bounds, scaleFactor } = display
  const overlay = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, fullscreenable: false, enableLargerThanScreen: true,
    webPreferences: appWebPreferences()
  })
  hardenWindow(overlay)
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadRenderer(overlay, 'snip')
  overlay.webContents.on('did-finish-load', () => overlay.webContents.send('snip-config', { displayId: String(display.id), scaleFactor, width: bounds.width, height: bounds.height, mode }))
  overlay.on('closed', () => { snipWin = null })
  snipWin = overlay
  snipWin.focus()
  snipTarget = target
  snipMode = mode
  return true
}

/**
 * 滚动截图的进度小窗：一条可点的小药丸，显示已拼接段数与高度，带"完成/取消"。
 * 为什么不复用框选叠层：叠层必须完全隐藏（否则会被拍进画面），而进度反馈得让用户看得见——
 * 两个需求冲突，只能分开。窗口放在目标屏顶部居中，不挡住选区。
 */
function openScrollHud(): boolean {
  if (!win) return false
  if (scrollHudWin && !scrollHudWin.isDestroyed()) { scrollHudWin.show(); return true }
  const { workArea } = targetDisplay()
  const width = 320
  const height = 44
  const hud = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + 12,
    width, height, frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, fullscreenable: false, focusable: false,
    webPreferences: appWebPreferences()
  })
  hardenWindow(hud)
  hud.setAlwaysOnTop(true, 'screen-saver')
  hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadRenderer(hud, 'scrollhud')
  hud.on('closed', () => { scrollHudWin = null })
  scrollHudWin = hud
  return true
}

function closeScrollHud(): void {
  if (scrollHudWin && !scrollHudWin.isDestroyed()) scrollHudWin.close()
  scrollHudWin = null
}

function updateScrollHud(state: ScrollHudState): void {
  if (!scrollHudWin || scrollHudWin.isDestroyed()) return
  scrollHudWin.webContents.send('scroll-hud-state', state)
}

function closeSnipOverlay(): void {
  if (snipWin && !snipWin.isDestroyed()) snipWin.close()
  snipWin = null
}

/** 框选确认：藏掉叠层（含岛），再请渲染层抓指定区域。 */
async function completeSnip(region: ScreenshotSnipRegion): Promise<void> {
  const target = snipTarget
  closeSnipOverlay()
  if (!win) return
  win.hide()
  // 藏窗要等一拍：透明叠层的退场动画/合成需要一帧，否则暗底会留在抓到的图上
  await new Promise((r) => setTimeout(r, 180))
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  safeSend('screen-capture-requested', { target, region: { ...region, mode: snipMode } })
}

async function openScreenshot(target: ScreenshotTarget = 'ask', mode: 'snip' | 'scroll' = 'snip'): Promise<void> {
  if (!win) return
  // 主路径：应用内框选。创建失败（极端情况）才退回 Windows 截图工具，保证功能不丢。
  if (openSnipOverlay(target, mode)) return
  await openScreenshotWindowsTool(target)
}

async function openScreenshotWindowsTool(target: ScreenshotTarget = 'ask'): Promise<void> {
  if (!win) return
  yieldToExternalApp()
  // 先取得新 hold，再释放旧 hold；重试瞬间不会闪回最高层。
  const nextRelease = externalYield?.suspendTopmost()
  screenshotPoller.stop()
  finishScreenshotFlow()
  screenshotTopmostRelease = nextRelease
  screenshotTarget = target

  const baseline = await readClipboardImageDataUrl()
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

/**
 * 截图的"取像素"交给渲染层，主进程只负责藏岛与挑源。
 *
 * 为什么不在这里出图（实测结论）：缩略图路径只能"按你请求的尺寸缩放"——逻辑尺寸
 * 1707x1067 乘 scaleFactor 1.5 得 2560.5，取整成 2561 去请求，必须重采样一次，
 * 同一张静态图锐度从 84.9 掉到 64.1（真物理尺寸是 2560x1600）。而**媒体流**给的是真原生帧：
 * 实测 Chromium 抓 2560x1600 的锐度与 DPI-aware .NET 直接抓物理像素**完全一致**（35.2983）。
 * 顺带让截图与录制走同一条采集链路。
 */
async function prepareScreenCapture(): Promise<{ ok: boolean; sourceId?: string; error?: string }> {
  try {
    const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    win?.hide()
    // 藏窗要等一拍，否则会把自己拍进去
    await new Promise((r) => setTimeout(r, 160))
    // 首屏的 getSources 偶尔拿不到全部 display_id（实测连拍 5 张有 1 张错屏），重试一次；
    // 仍不匹配就明确失败——**绝不退到 sources[0]**，那会静默拍到另一块屏。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      const match = sources.find((item) => item.display_id && item.display_id === String(target.id))
      if (match) return { ok: true, sourceId: match.id }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 240))
    }
    return { ok: false, error: '没有找到光标所在显示器的采集源，请重试' }
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) }
  }
}

/** 截图完成（成功或失败都要调）：还原岛的显示状态。 */
function finishScreenCapture(): void {
  win?.show()
}

// 屏幕理解：全局热键截整屏 → 交给渲染层（复用截图问 AI 卡）
async function openScreenAnalyze(): Promise<void> {
  if (!win) return
  // 抓帧在渲染层（媒体流拿原生像素），这里只负责藏岛与转发
  win.hide()
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  safeSend('screen-capture-requested', { target: 'ask' })
}

// 闪念胶囊：全局热键唤出居中输入框（临时让常驻窗口可聚焦，输完/取消后还原点击穿透）
function openCapsule(): void {
  if (!win) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false) // 让胶囊可输入
  win.show()
  win.focus()
  safeSend('capsule-toggle')
}

// 全局命令面板：热键唤出居中搜索框（展开岛并可聚焦，动作执行后停在对应分区）
function openPalette(): void {
  if (!win) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  win.show()
  win.focus()
  safeSend('palette-toggle')
}

// 第二大脑检索：热键唤出跨分区检索浮层
function openBrain(): void {
  if (!win) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(false)
  win.show()
  win.focus()
  safeSend('brain-toggle')
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
  const windows = [win, widgetWin, ...stickyWins.values(), ...pinnedShots.values()]
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
/**
 * 钉屏截图：把一张图贴在所有窗口最上层，可拖动、可缩放、可调透明度。
 *
 * 与"钉屏便利贴"同一范式（独立小窗 + 推送数据），但补了便利贴漏掉的两件事：
 * 进入 `setAgenticWindowsTopmost` 托管（否则外部应用抢占时它不会被降层/复原），
 * 以及显示器变化时重定位（否则拔掉外接屏后它会留在不存在的坐标上）。
 */
function openPinnedShot(payload: PinnedShotPayload): void {
  const exist = pinnedShots.get(payload.id)
  if (exist && !exist.isDestroyed()) { exist.show(); exist.focus(); return }
  const { workArea } = targetDisplay()
  const n = pinnedShots.size
  // 按图片比例给初始尺寸：最长边不超过工作区的 60%（贴上去看得清，又不会糊满屏）
  const ratio = payload.width > 0 && payload.height > 0 ? payload.width / payload.height : 16 / 9
  const maxW = Math.round(workArea.width * 0.6)
  const maxH = Math.round(workArea.height * 0.6)
  const width = Math.max(160, Math.min(maxW, Math.round(maxH * ratio)))
  const height = Math.max(120, Math.round(width / ratio))
  const w = new BrowserWindow({
    width, height, frame: false, transparent: true, resizable: true, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: true, fullscreenable: false, minWidth: 120, minHeight: 80,
    webPreferences: appWebPreferences()
  })
  hardenWindow(w)
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.setBounds({
    x: workArea.x + Math.round(workArea.width * 0.18) + (n % 4) * 32,
    y: workArea.y + Math.round(workArea.height * 0.16) + (n % 5) * 32,
    width, height
  })
  loadRenderer(w, 'pin')
  w.webContents.on('did-finish-load', () => w.webContents.send('pinned-shot', payload))
  w.on('closed', () => pinnedShots.delete(payload.id))
  pinnedShots.set(payload.id, w)
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
// save-state 防抖：渲染层流式回答期间会高频触发全量状态上报，直接同步写盘（JSON 序列化 + DPAPI 加密 + 双文件写）
// 会反复卡住主进程、拖慢审批链路。最新状态缓存在内存，700ms trailing 落盘，退出时强制冲刷兜底。
let pendingState: Record<string, unknown> | null = null
let saveTimer: NodeJS.Timeout | null = null
const flushState = (): void => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (pendingState) { const s = pendingState; pendingState = null; saveState(s) }
}
const scheduleSave = (state: Record<string, unknown>): void => {
  pendingState = state
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushState, 700)
  saveTimer.unref?.()
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
    stopClipboardWatch = startClipboardWatch((item) => safeSend('clipboard-new', item))
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
  safeSend('snapshot', snap)
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
// 外部抓取（网页正文等）响应体上限：慢速流式响应也能在超限后立刻中止，防主进程 OOM
const MAX_FETCH_BYTES = 8 * 1024 * 1024

async function fetchPageText(url: string, cap = 30000): Promise<{ ok: boolean; text?: string; title?: string; error?: string }> {
  try {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅支持 http/https 链接' }
    const res = await netFetch(url, { timeoutMs: 20000, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const html = await readBodyText(res, MAX_FETCH_BYTES)
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
      // owner/repo 直接拼进 API URL，必须白名单校验（只允许 GitHub 用户名/仓库名字符）
      if (!/^[\w.-]{1,100}$/.test(String(owner)) || !/^[\w.-]{1,100}$/.test(String(repo))) return { ok: false, error: 'owner/repo 格式无效' }
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
  ipcMain.handle('pick-directory', async (_e, initialPath?: string) => {
    try {
      const suggested = String(initialPath || '').trim()
      const r = await showOwnedOpenDialog({
        title: '选择 PowerShell 工作目录',
        properties: ['openDirectory', 'createDirectory'],
        ...(suggested && suggested.length <= 4096 && !hasNul(suggested) ? { defaultPath: suggested } : {})
      })
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
      return { ok: true, path: r.filePaths[0] }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('capture-screen-prepare', () => prepareScreenCapture())
  ipcMain.handle('capture-screen-finish', () => { finishScreenCapture(); return { ok: true } })

  // Markdown 本地文件：打开 / 另存为
  // 直写白名单：existingPath 只允许回写本次会话内经对话框打开/保存过的路径，渲染层不可任意指定写入位置
  const mdWritablePaths = new Set<string>()
  ipcMain.handle('open-md-file', async () => {
    try {
      const r = await showOwnedOpenDialog({ title: '打开 Markdown 文件', properties: ['openFile'], filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt', 'mdx'] }] })
      if (r.canceled || !r.filePaths[0]) return { ok: false }
      const path = r.filePaths[0]
      const content = await readFile(path, 'utf8')
      mdWritablePaths.add(path)
      return { ok: true, path, name: basename(path), content }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  ipcMain.handle('save-md-file', async (_e, content: string, suggestName: string, existingPath?: string) => {
    try {
      if (typeof content !== 'string' || content.length > 20_000_000 || hasNul(content)) return { ok: false, error: '内容无效或过大' }
      let path = typeof existingPath === 'string' && existingPath.length <= 4096 && !hasNul(existingPath) && mdWritablePaths.has(existingPath) ? existingPath : ''
      if (!path) {
        const r = await showOwnedSaveDialog({ title: '保存 Markdown', defaultPath: (suggestName || '未命名') + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] })
        if (r.canceled || !r.filePath) return { ok: false }
        path = r.filePath
      }
      await writeFile(path, content, 'utf8')
      mdWritablePaths.add(path)
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
      hardenWindow(w)
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
  setPtySink((id, data) => safeSend('pty-data', { id, data }))
  ipcMain.handle('pty-ensure', (_e, id: string, cols: number, rows: number, cwd?: string, profile?: TerminalShellProfile, environment?: Record<string, string>) => {
    const env = environment && typeof environment === 'object' ? Object.fromEntries(Object.entries(environment).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string').slice(0, 40)) : undefined
    return ptyEnsure(String(id), Number(cols), Number(rows), typeof cwd === 'string' ? cwd : undefined, profile, env)
  })
  ipcMain.on('pty-input', (_e, id: string, data: string) => ptyInput(String(id), String(data)))
  ipcMain.on('pty-resize', (_e, id: string, cols: number, rows: number) => ptyResize(String(id), Number(cols), Number(rows)))
  ipcMain.on('pty-kill', (_e, id: string) => ptyKill(String(id)))
  ipcMain.handle('terminal-workspace-load', () => terminalWorkspace.load())
  ipcMain.on('terminal-workspace-save', (_e, state: TerminalWorkspaceState) => terminalWorkspace.save(state))
  ipcMain.handle('terminal-workspace-clear-snapshots', () => terminalWorkspace.clearSnapshots())
  ipcMain.handle('terminal-project-inspect', (_e, cwd: string) => inspectTerminalProject(String(cwd || '')))
  ipcMain.handle('terminal-workspace-export', async (_e, state: TerminalWorkspaceState) => {
    try {
      const clean = terminalWorkspaceExportState(state)
      const result = await showOwnedSaveDialog({ title: '导出终端工作区', defaultPath: 'agentic-island-terminal-workspace.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await writeFile(result.filePath, JSON.stringify(clean, null, 2), 'utf8')
      return { ok: true, path: result.filePath }
    } catch (error) { return { ok: false, error: String(error) } }
  })
  ipcMain.handle('terminal-workspace-import', async () => {
    try {
      const result = await showOwnedOpenDialog({ title: '导入终端工作区', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
      const raw = JSON.parse(await readFile(result.filePaths[0], 'utf8')) as TerminalWorkspaceState
      return { ok: true, state: terminalWorkspace.save(raw) }
    } catch (error) { return { ok: false, error: String(error) } }
  })
  app.on('will-quit', () => { flushState(); stopClipboardWatch?.(); ptyKillAll(); globalShortcut.unregisterAll() })

  // 智能勿扰：渲染层把最终勿扰态告知主进程（真则不自动弹窗/响铃）
  ipcMain.on('set-dnd', (_e, active: boolean) => { dndActive = !!active })

  // 桌面挂件：开关 + 主渲染层推送速览数据 → 转发给挂件窗口
  ipcMain.on('toggle-widget', (_e, active: boolean) => { if (active) openWidget(); else closeWidget() })
  ipcMain.on('widget-push', (_e, data: unknown) => {
    lastWidgetData = data
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send('widget-data', data)
  })
  ipcMain.on('widget-reveal', () => { safeSend('reveal') })

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
  ipcMain.handle('llm-list-models', (_e, cfg: LlmRequestConfig) => llmListModels(cfg))
  // 截图工坊：渲染层主动触发框选截图（复用 ms-screenclip 流程，事件仍走 screenshot-captured）
  // 钉屏截图：渲染层把合成好的图交过来，主进程负责贴到屏幕上
  ipcMain.handle('pin-screenshot', (_e, input: { dataUrl?: string; name?: string; width?: number; height?: number }) => {
    const dataUrl = typeof input?.dataUrl === 'string' ? input.dataUrl : ''
    if (!validImageData(dataUrl)) return { ok: false, error: '图片数据无效或超过 160MB' }
    const id = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    openPinnedShot({
      id,
      dataUrl,
      name: safeName(String(input?.name || ''), 'screenshot'),
      width: Math.max(0, Math.round(Number(input?.width) || 0)),
      height: Math.max(0, Math.round(Number(input?.height) || 0))
    })
    return { ok: true, id }
  })
  ipcMain.on('close-pinned-shot', (_e, id: string) => {
    const w = pinnedShots.get(String(id || ''))
    if (w && !w.isDestroyed()) w.close()
    pinnedShots.delete(String(id || ''))
  })
  // 免对话框快速保存：直接写进「图片/Agentic-Island」，省掉每次挑目录
  ipcMain.handle('save-image-quick', async (_e, dataUrl: string, name: string, format: string) => {
    try {
      if (!validImageData(dataUrl)) return { ok: false, error: '图片数据无效或超过 160MB' }
      const ext = format === 'jpeg' || format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png'
      const dir = join(app.getPath('pictures'), 'Agentic-Island')
      await mkdir(dir, { recursive: true })
      const target = join(dir, `${safeName(name, 'screenshot')}.${ext}`)
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      await writeFile(target, bytes)
      return { ok: true, path: target }
    } catch (error) {
      return { ok: false, error: String(error instanceof Error ? error.message : error) }
    }
  })
  ipcMain.on('snip-complete', (_e, region: ScreenshotSnipRegion) => {
    void completeSnip({
      x: Number(region?.x) || 0,
      y: Number(region?.y) || 0,
      width: Math.max(0, Number(region?.width) || 0),
      height: Math.max(0, Number(region?.height) || 0),
      scaleFactor: Number(region?.scaleFactor) || undefined
    })
  })
  ipcMain.on('snip-cancel', () => { closeSnipOverlay() })
  // 滚动截图：进度上报（渲染层 → 小窗）与用户动作（小窗 → 渲染层）
  ipcMain.on('scroll-hud-open', () => { openScrollHud() })
  ipcMain.on('scroll-hud-update', (_e, state: ScrollHudState) => {
    // 顺带兜底：渲染层异常退出时不留孤儿窗口
    if (state?.state === 'done' || state?.state === 'canceled') {
      updateScrollHud(state)
      setTimeout(() => closeScrollHud(), 900)
      return
    }
    updateScrollHud(state)
  })
  ipcMain.on('scroll-hud-action', (_e, action: 'finish' | 'cancel') => { safeSend('scroll-hud-action', action) })
  ipcMain.on('trigger-scroll-capture', (_e, target: ScreenshotTarget) => { void openScreenshot(target === 'ask' ? 'ask' : 'studio', 'scroll') })
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
      scaleFactor: display.scaleFactor,
      // 顺带取走累积的点击：渲染层本来就在 80ms 轮询光标，不为点击再加一条 IPC
      clicks: drainMouseClicks()
    }
  })
  // 点击采集只跟随录制生命周期：开始录制时装钩子，停止时卸载（平时完全不监听）
  ipcMain.handle('recording-click-log', async (_e, active: boolean) => {
    if (active) return { ok: await startMouseClickLog() }
    stopMouseClickLog()
    return { ok: true }
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
  /** 只读文件头若干字节用于容器嗅探：整文件可达数百 MB，绝不能全读进内存。 */
async function readFileHead(path: string, bytes = 64): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** 编码器选取器按 ffmpeg 路径缓存（同一次运行内只试编码一次）。 */
const encoderPickers = new Map<string, ReturnType<typeof createEncoderPicker>>()
const encoderPickerFor = (ffmpegPath: string): ReturnType<typeof createEncoderPicker> => {
  const existing = encoderPickers.get(ffmpegPath)
  if (existing) return existing
  const created = createEncoderPicker(ffmpegPath)
  encoderPickers.set(ffmpegPath, created)
  return created
}

/**
 * 导出后读一遍成品并与请求对照。自检失败**不影响导出结果**——文件已经写好了，
 * 让人看到"导出成功但帧率对不上"比让人以为失败要好；探测本身出错则只报"未自检"。
 */
const verifyRecordingOutput = async (ffmpegPath: string, outputPath: string, request: RecordingExportRequest) => {
    try {
      const probe = await probeRecordingOutput(ffmpegPath, outputPath)
      const check = recordingExportVerdict(request, probe)
      if (!check.ok) console.warn('[recording-export] 成品自检未通过', check.warnings.join('；'), outputPath)
      return check
    } catch (error) {
      return { ok: true, summary: '未自检', warnings: [`自检未能执行：${String(error instanceof Error ? error.message : error)}`] }
    }
  }
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

      // 无剪辑时按真实容器选最快路径（嗅探文件头，比扩展名/mimeType 可信）
      const sourceContainer = sniffRecordingContainer(await readFileHead(inputPath))
      const strategy = recordingExportStrategy(request, sourceContainer)
      if (strategy === 'copy') {
        await copyFile(inputPath, outputPath)
        sendProgress('done', 1, '原始录制已保存')
        return { ok: true, path: outputPath }
      }
      if (strategy === 'remux') {
        const executable = app.isPackaged ? String(ffmpegStatic || '').replace('app.asar', 'app.asar.unpacked') : String(ffmpegStatic || '')
        if (!executable) return { ok: false, error: '内置 FFmpeg 不可用，请改用原始 WebM 导出' }
        sendProgress('encoding', 0.1, '无剪辑 · 直接封装（画质无损）')
        const remux = startRecordingFfmpegWithArgs(executable, buildRecordingRemuxArgs(inputPath, outputPath, request), (value) => {
          sendProgress('encoding', 0.1 + value * 0.88)
        }, request.durationMs)
        recordingExportJobs.set(jobId, remux.child)
        await remux.done
        const remuxCheck = await verifyRecordingOutput(executable, outputPath, request)
        sendProgress('done', 1, remuxCheck.ok ? `无剪辑 · 已直接封装 · ${remuxCheck.summary}` : `无剪辑 · 已直接封装（${remuxCheck.warnings[0]}）`)
        return { ok: true, path: outputPath, check: remuxCheck }
      }

      const configured = String(ffmpegStatic || '')
      const executable = app.isPackaged ? configured.replace('app.asar', 'app.asar.unpacked') : configured
      if (!executable) return { ok: false, error: '内置 FFmpeg 不可用，请改用原始 WebM 导出' }
      // 需要重编码时才做编码器选择：探测 + 用真实素材试编码计时，只有**明确更快**才用硬件编码。
      // 结果按进程缓存，一次会话只付一次试编码成本；失败一律回落 libx264。
      const encoder: VideoEncoder = format === 'mp4'
        ? await encoderPickerFor(executable)(inputPath, crfFor(request.quality))
        : 'libx264'
      sendProgress('encoding', 0.05, format === 'gif' ? '正在生成 GIF 调色板' : format === 'mp3' ? '正在编码音频' : '正在压缩视频')
      const running = startRecordingFfmpeg(executable, inputPath, outputPath, request, (value) => {
        sendProgress('encoding', 0.05 + value * 0.94)
      }, encoder)
      recordingExportJobs.set(jobId, running.child)
      await running.done
      const check = await verifyRecordingOutput(executable, outputPath, request)
      sendProgress('done', 1, check.ok ? `导出完成 · ${check.summary}` : `导出完成，但自检有疑问（${check.warnings[0]}）`)
      return { ok: true, path: outputPath, check }
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
      // 临时文件名不代表容器：导出侧按文件头嗅探真实容器，这里的名字只是占位
      const inputPath = join(tempDir, 'capture.bin')
      await writeFile(inputPath, data)
      return await exportRecordingPath(event, inputPath, rawRequest)
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
  const imageDataLimit = 160_000_000
  const validImageData = (value: string): boolean => /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value) && value.length <= imageDataLimit
  // 图片写剪贴板。返回结果，避免渲染层在失败时仍提示成功。
  ipcMain.handle('copy-image', async (_e, dataUrl: string) => {
    const url = String(dataUrl || '')
    if (!validImageData(url)) return { ok: false, error: '图片数据无效或超过 160MB' }
    try {
      const written = await writeClipboardImageDataUrl(url)
      if (!written) return { ok: false, error: '图片解码失败' }
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
  ipcMain.handle('read-clipboard-image', async () => {
    try {
      const dataUrl = await readClipboardImageDataUrl()
      if (!dataUrl) return { ok: false, error: '剪贴板中没有图片' }
      return { ok: true, dataUrl }
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
  ipcMain.on('clip-write-text', (_e, t: string) => { void clipboard.writeText(String(t)).catch(() => {}) })

  // 本地 Agent CLI（Claude Code / Codex 无头模式，JSONL 流式）：问答的另一种引擎，继承本机全部配置
  ipcMain.handle('agent-cli-check', (_e, engine: AgentEngine) => agentCliCheck(engine))
  let agentRunSeq = 0
  ipcMain.handle('agent-cli-stream', async (_e, engine: AgentEngine, prompt: string, cwd?: string, cont?: boolean) => {
    const runId = 'ar' + ++agentRunSeq
    const r = await agentCliStream(engine, String(prompt), cwd, !!cont, (ev) => safeSend('agent-cli-event', { runId, ev }))
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
  ipcMain.handle('kb-add-text', (_e, cfg: LlmRequestConfig, title: string, text: string, sourceKey: string) => kbGuard(() =>
    kb.addText(cfg, String(title), String(text), String(sourceKey), Date.now())
  ))
  ipcMain.handle('kb-remove', (_e, id: string) => kbGuard(() => kb.removeSource(String(id))))
  ipcMain.handle('kb-reindex', (_e, cfg: LlmRequestConfig) => kbGuard(() => kb.reindex(cfg)))
  ipcMain.handle('kb-search', (_e, cfg: LlmRequestConfig, query: string, k?: number) => kbGuard(() => kb.search(cfg, String(query), k || 8)))
  ipcMain.handle('kb-sample-chunks', (_e, max?: number, sourceId?: string) => kbGuard(() => kb.sampleChunks(max || 20, sourceId)))
  ipcMain.handle('kb-get-wiki', async () => { try { return await kb.getWiki() } catch { return {} } })
  ipcMain.handle('kb-save-wiki', (_e, key: string, md: string) => kbGuard(() => kb.saveWiki(String(key), String(md), Date.now())))
  ipcMain.handle('load-state', () => loadState())
  ipcMain.on('save-state', (_e, state: Record<string, unknown>) => {
    scheduleSave(state)
    // 同步主进程的提示音偏好（按类型的声效映射）—— 即时生效，不随防抖延迟
    const s = state as { settings?: { sound?: boolean; clipWatch?: boolean }; soundMap?: Record<string, string>; approvalPolicy?: Parameters<typeof setApprovalPolicy>[0] }
    if (typeof s.settings?.sound === 'boolean') soundPref.on = s.settings.sound
    if (typeof s.settings?.clipWatch === 'boolean') setClipboardWatch(s.settings.clipWatch)
    if (s.soundMap && typeof s.soundMap === 'object') Object.assign(soundPref.map, s.soundMap)
    // 审批策略随 save-state 全量同步（主进程为强制执行方）
    if (s.approvalPolicy && typeof s.approvalPolicy === 'object') setApprovalPolicy(s.approvalPolicy)
  })
  // 审批卡片「本会话放行」：记住该会话的这条命令（当前请求由渲染层另行 decide 放行）
  ipcMain.on('approval-session-allow', (_e, agentId: string, command: string) => approvalSessionAllow(String(agentId), String(command)))
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
  try {
    await bridge.start()
  } catch (err) {
    // 桥起失败（端口被占等）不能中断后续初始化，否则无窗无托盘成为僵尸进程；岛仍可用，仅 hook 转发不可达
    console.error('[bridge] start failed:', err)
  }
  codexTail.start() // Codex 实时接入：跟随 rollout 日志
  initUpdater((s) => safeSend('update-state', s)) // 自动更新：设置页可检查/安装
  setApprovalAuditSink((entry) => safeSend('approval-audit', entry)) // 审批策略审计流水推送
  kb.initKb(app.getPath('userData')) // 知识库索引存放于 userData/kb-index.json
  recordingSessions = new RecordingSessionStore(join(app.getPath('userData'), 'recordings'))
  await recordingSessions.initialize()
  recordingProjects = new RecordingProjectStore(join(app.getPath('userData'), 'recording-projects'))
  await recordingProjects.initialize()
  wireIpc()

  // 应用持久化的开机自启与显示器偏好，并按需自动接入所有 CLI/终端
  try {
    const st = loadState() as
      | { settings?: { autostart?: boolean; multiMonitor?: boolean; autoConnect?: boolean; sound?: boolean; largeSize?: boolean; clipWatch?: boolean }; activeMonitor?: number; selectedSound?: string; approvalPolicy?: Parameters<typeof setApprovalPolicy>[0] }
      | null
    if (st?.settings) {
      if (typeof st.settings.autostart === 'boolean') app.setLoginItemSettings({ openAtLogin: st.settings.autostart })
      if (typeof st.settings.multiMonitor === 'boolean') follow = st.settings.multiMonitor
      if (typeof st.settings.sound === 'boolean') soundPref.on = st.settings.sound
      if (typeof st.settings.clipWatch === 'boolean') clipWatchEnabled = st.settings.clipWatch
    }
    // 审批策略启动即生效（渲染层首帧前主进程就要能自动放行）
    if (st?.approvalPolicy && typeof st.approvalPolicy === 'object') setApprovalPolicy(st.approvalPolicy)
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
  startDndWatch((active) => safeSend('dnd-state', active))

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
