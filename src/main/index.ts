import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, screen, shell, Tray } from 'electron'
import { join } from 'path'
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
import { complete as llmComplete, test as llmTest } from './llm-proxy'
import { playSound } from './sound'
import { loadState, saveState } from './settings-store'
import { focusByHwnd, focusByPid, focusByTitle, focusAnyByTitle, selectWtTab } from './terminal-jump'
import { gitSummary } from './git-summary'
import { fetchIcs, parseIcs } from './calendar-ics'
import { fetchCaldav } from './calendar-caldav'
import { getMediaInfo, mediaKey } from './media'
import { fetchRss } from './rss'
import { setPtySink, ptyEnsure, ptyInput, ptyResize, ptyKill, ptyKillAll } from './term-pty'
import { startClipboardWatch } from './clipboard-watch'
import type { DecisionMessage, LlmRequestConfig } from '../shared/protocol'

// 允许 WebAudio 无需用户手势即可播放（提示音/试听）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// 双尺寸工作台：标准 / 大尺寸（设置或主界面按钮切换）；标准宽度可由设置滑杆自定义（380–880）
let largeMode = false
let customPanelW = 468
const winW = (): number => (largeMode ? 940 : Math.max(452, customPanelW + 72))
const winH = (): number => (largeMode ? 1020 : 780)

let win: BrowserWindow | null = null
const store = new AgentsStore()
const bridge = new BridgeServer(store, gitSummary)
// Codex 实时接入：跟随其 rollout 会话日志（Windows 上 hooks/notify 都不通，这是唯一可靠通道）
const codexTail = new CodexTail(store, gitSummary)

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

function positionWindow(w: BrowserWindow): void {
  const displays = screen.getAllDisplays()
  const display = follow
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : displays[monitorIndex] || displays[0]
  const { x, width, y, height } = display.workArea
  // 高度不超过工作区，避免小屏幕上窗口溢出
  const h = Math.min(winH(), height - 4)
  // 关键：resizable:false 的窗口在 Windows 上 setBounds 改宽会被忽略 → 先临时放开再收回
  w.setResizable(true)
  w.setBounds({ x: Math.round(x + (width - winW()) / 2), y, width: winW(), height: h })
  w.setResizable(false)
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
  win = new BrowserWindow({
    width: winW(),
    height: winH(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 窗口从不获得焦点（常驻叠层），必须关闭后台节流，否则定时器/WebAudio 会被挂起（提示音不响）
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  positionWindow(win)

  // 默认整窗点击穿透，转发鼠标移动以便渲染层做命中检测
  win.setIgnoreMouseEvents(true, { forward: true })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 无边框窗口开不了 DevTools —— 把渲染进程的报错转发到启动终端，便于排查
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId.split('/').pop()}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] crashed:', details.reason)
  })
}

// 提示音偏好（主进程权威缓存，随 save-state 更新）：按通知类型分声效
const soundPref = {
  on: true,
  map: { waiting: 'chime', approval: 'ping', danger: 'rising', todo: 'marimba' } as Record<string, string>
}
// 危险命令判定（与渲染层 logic/risk.ts 的 danger 正则同步）
const DANGER_RE = /(rm\s+-[rf]{1,2}|git\s+push\s+.*(--force|-f)|--force\b|sudo\s|dd\s+if=|mkfs|chmod\s+777|>\s*\/dev\/|\bdel\s+\/[fqs]|format\s+[a-z]:|DROP\s+TABLE|TRUNCATE\s+TABLE|shutdown|reboot)/i

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
  if (newPend.length > 0 || newWait.length > 0) {
    if (win) {
      win.setAlwaysOnTop(true, 'screen-saver')
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

function wireIpc(): void {
  ipcMain.handle('get-snapshot', () => store.snapshot())

  ipcMain.on('decide', (_e, msg: DecisionMessage) => {
    store.decide(msg.requestId, msg.decision, msg.reason)
  })

  // 渲染层命中检测：指针在岛面板上 → 关闭穿透；在透明空白 → 打开穿透
  ipcMain.on('set-ignore-mouse', (_e, ignore: boolean) => {
    if (ignore) win?.setIgnoreMouseEvents(true, { forward: true })
    else win?.setIgnoreMouseEvents(false)
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

  // 正在播放的媒体（SMTC）+ 媒体键控制（迷你条音乐模式）
  ipcMain.handle('media-info', () => getMediaInfo())
  ipcMain.on('media-key', (_e, cmd: string) => mediaKey(String(cmd)))

  // 内嵌真 PTY 终端（ConPTY PowerShell，多标签）
  setPtySink((id, data) => win?.webContents.send('pty-data', { id, data }))
  ipcMain.handle('pty-ensure', (_e, id: string, cols: number, rows: number) => ptyEnsure(String(id), Number(cols), Number(rows)))
  ipcMain.on('pty-input', (_e, id: string, data: string) => ptyInput(String(id), String(data)))
  ipcMain.on('pty-resize', (_e, id: string, cols: number, rows: number) => ptyResize(String(id), Number(cols), Number(rows)))
  ipcMain.on('pty-kill', (_e, id: string) => ptyKill(String(id)))
  app.on('will-quit', () => ptyKillAll())

  // 灵感便签：抓取网页正文（去标签的纯文本，供 AI 整理成便签）
  ipcMain.handle('fetch-url-text', async (_e, url: string) => {
    try {
      if (!/^https?:\/\//i.test(String(url))) return { ok: false, error: '仅支持 http/https 链接' }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20000)
      const res = await fetch(String(url), { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } })
      clearTimeout(timer)
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const html = await res.text()
      // 粗提正文：去 script/style/标签 → 压缩空白（够 AI 提炼用；不追求完美抽取）
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&(nbsp|#160);/g, ' ')
        .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[m] || ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 30000)
      return text.length > 50 ? { ok: true, text } : { ok: false, error: '未能提取到正文（可能是动态渲染页面/需登录）' }
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) }
    }
  })

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

  ipcMain.on('set-size-mode', (_e, large: boolean) => {
    largeMode = !!large
    if (win) positionWindow(win)
  })

  // 界面缩放（字体清晰度/可读性：0.9–1.3）
  ipcMain.on('set-zoom', (_e, z: number) => {
    win?.webContents.setZoomFactor(Math.max(0.85, Math.min(1.35, Number(z) || 1)))
  })

  // 灵动岛整体宽度（标准模式，380–880；迷你条宽度随之同步）
  ipcMain.on('set-island-width', (_e, w: number) => {
    customPanelW = Math.max(380, Math.min(880, Number(w) || 468))
    if (win) positionWindow(win)
  })

  ipcMain.handle('install-hooks', () => {
    doInstallHooks()
    return { ok: true }
  })

  ipcMain.handle('uninstall-hooks', () => {
    uninstallClaudeCode(forwarderPath('cc-forward.mjs'))
    uninstallCodex(forwarderPath('codex-forward.mjs'))
    uninstallCodexNotify()
    return { ok: true }
  })

  ipcMain.handle('llm-complete', (_e, cfg: LlmRequestConfig, system: string, user: string | Array<Record<string, unknown>>, deep?: boolean, history?: { role: 'user' | 'assistant'; content: string }[]) =>
    llmComplete(cfg, system, user, deep, history || []))

  ipcMain.on('open-external', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('llm-test', (_e, cfg: LlmRequestConfig) => llmTest(cfg))
  ipcMain.handle('load-state', () => loadState())
  ipcMain.on('save-state', (_e, state: Record<string, unknown>) => {
    saveState(state)
    // 同步主进程的提示音偏好（按类型的声效映射）
    const s = state as { settings?: { sound?: boolean }; soundMap?: Record<string, string> }
    if (typeof s.settings?.sound === 'boolean') soundPref.on = s.settings.sound
    if (s.soundMap && typeof s.soundMap === 'object') Object.assign(soundPref.map, s.soundMap)
  })
}

// 单实例锁：避免多开导致 bridge 端口/发现文件错乱，破坏实时连接
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); win.showInactive() }
  })
}

app.whenReady().then(async () => {
  await bridge.start()
  codexTail.start() // Codex 实时接入：跟随 rollout 日志
  wireIpc()

  // 应用持久化的开机自启与显示器偏好，并按需自动接入所有 CLI/终端
  try {
    const st = loadState() as
      | { settings?: { autostart?: boolean; multiMonitor?: boolean; autoConnect?: boolean; sound?: boolean; largeSize?: boolean }; activeMonitor?: number; selectedSound?: string }
      | null
    if (st?.settings) {
      if (typeof st.settings.autostart === 'boolean') app.setLoginItemSettings({ openAtLogin: st.settings.autostart })
      if (typeof st.settings.multiMonitor === 'boolean') follow = st.settings.multiMonitor
      if (typeof st.settings.sound === 'boolean') soundPref.on = st.settings.sound
      if (typeof st.settings.largeSize === 'boolean') largeMode = st.settings.largeSize
    }
    if (typeof st?.activeMonitor === 'number') monitorIndex = Math.max(0, st.activeMonitor - 1)
    const stw = (st as { islandWidth?: number } | null)?.islandWidth
    if (typeof stw === 'number') customPanelW = Math.max(380, Math.min(880, stw))
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
  // 剪贴板助手：变化推给渲染层（是否记录由渲染层 clipWatch 设置决定；历史仅内存不落盘）
  startClipboardWatch((text) => win?.webContents.send('clipboard-new', text))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  bridge.stop()
  if (process.platform !== 'darwin') app.quit()
})
