/**
 * 输入事件采集（**只在录制期间运行**）：鼠标点击 + **快捷键/导航键**。
 *
 * 四条边界，都是刻意的：
 *  1. 键盘**只记快捷键与导航键**：修饰键组合（Ctrl/Alt/Shift/Win + X）、Enter/Tab/Esc/Backspace/
 *     Delete/方向键/F1–F12/Home/End/PageUp/PageDown，以及独立的修饰键按下。
 *     可打印字符（字母、数字、符号、输入法候选）**一律丢弃**——角标功能需要的是"他按了 Ctrl+S"，
 *     而不是"他打了什么字"，把后者记下来性质就变成键盘记录器了。
 *  2. **只在录制期间运行**。录屏时那块屏幕本来就在被逐像素记录，点击日志不引入新的隐私面；
 *     不录制时钩子完全卸载（`uIOhook.stop()`）。
 *  3. **失败即静默降级**。原生模块缺预编译产物时自动跳过点击采集，录屏照常——就像 hooks 转发脚本
 *     必须 fail-open 一样，不能因为一个可选能力把主功能拖下水。
 *
 * 为什么需要它：光标轨迹只能说明"人在动"，说明不了"点了哪里"。点击是**事后无法补录**的信号
 * （录完再想补是没有的），剪除空白需要它区分"发呆"与"盯着看并且点了"，导出期的点击涟漪与
 * 按点击自动推近也都依赖它。
 */
export interface MouseClickEvent {
  /** 主进程时间戳（毫秒）；渲染层按录制开始时间换算成素材偏移 */
  at: number
  x: number
  y: number
  button: 'left' | 'right' | 'middle'
}

/** 按键角标事件：只有"快捷键与导航键"，绝不含可打印字符。 */
export interface KeyStrokeEvent {
  at: number
  /** 展示用标签，例如 `Ctrl+Shift+S`、`Enter`、`Tab` */
  label: string
}

/**
 * 允许进入日志的键（uiohook 的 keycode → 标签）。
 * 只列**导航与功能键**；字母数字等可打印键不在此表，因此永远不会被记录。
 */
const NAVIGATION_KEYS: Record<number, string> = {
  1: 'Esc', 14: 'Backspace', 15: 'Tab', 28: 'Enter', 29: 'Ctrl', 42: 'Shift', 54: 'Shift', 56: 'Alt',
  57: 'Space', 58: 'CapsLock', 3617: 'Delete', 3655: 'Home', 3663: 'End', 3657: 'PageUp', 3665: 'PageDown',
  57416: 'Up', 57424: 'Down', 57419: 'Left', 57421: 'Right',
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6', 65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10',
  87: 'F11', 88: 'F12'
}

/** 修饰键位（uiohook）：用于拼 `Ctrl+Shift+X` 这类标签 */
const MODIFIER_KEYS: Record<number, string> = { 29: 'Ctrl', 3613: 'Ctrl', 42: 'Shift', 54: 'Shift', 56: 'Alt', 3640: 'Alt', 3675: 'Win', 3676: 'Win' }

let clicks: MouseClickEvent[] = []
let keys: KeyStrokeEvent[] = []
let running = false
let unavailable = false

type UiohookPayload = { x?: number; y?: number; button?: number; keycode?: number }
type UiohookModule = {
  uIOhook: {
    on: (event: string, handler: (payload: UiohookPayload) => void) => void
    off: (event: string, handler: (payload: UiohookPayload) => void) => void
    start: () => void
    stop: () => void
  }
}

const buttonName = (button: number): MouseClickEvent['button'] => (button === 2 ? 'right' : button === 3 ? 'middle' : 'left')

let moduleCache: UiohookModule | null = null
const loadModule = async (): Promise<UiohookModule | null> => {
  if (moduleCache) return moduleCache
  if (unavailable) return null
  try {
    // 原生模块：打包后被 asarUnpack 到 app.asar.unpacked，由 node-gyp-build 按平台挑预编译产物
    moduleCache = (await import('uiohook-napi')) as unknown as UiohookModule
    return moduleCache
  } catch (error) {
    unavailable = true
    console.warn('[mouse-hook] 点击采集不可用（原生模块未就绪），录屏功能不受影响：', String(error instanceof Error ? error.message : error))
    return null
  }
}

/** 当前按下的修饰键（按下/抬起维护），用来给可记录的键拼标签 */
const heldModifiers = new Set<string>()

const onKeyDown = (payload: UiohookPayload): void => {
  if (!running) return
  const keycode = Number(payload.keycode) || 0
  const modifier = MODIFIER_KEYS[keycode]
  if (modifier) { heldModifiers.add(modifier); return }
  const name = NAVIGATION_KEYS[keycode]
  if (!name) return // 可打印字符：明确不记录
  const combo = [...heldModifiers].filter((item) => item !== name).join('+')
  const label = combo ? `${combo}+${name}` : name
  if (keys.length >= 20_000) return
  keys.push({ at: Date.now(), label })
}

const onKeyUp = (payload: UiohookPayload): void => {
  const modifier = MODIFIER_KEYS[Number(payload.keycode) || 0]
  if (modifier) heldModifiers.delete(modifier)
}

const onClick = (payload: UiohookPayload): void => {
  if (!running) return
  // 上限兜底：一次录制最多 20 万个点击，防内存失控（正常用法远达不到）
  if (clicks.length >= 200_000) return
  clicks.push({ at: Date.now(), x: Math.round(Number(payload.x) || 0), y: Math.round(Number(payload.y) || 0), button: buttonName(Number(payload.button)) })
}

/** 开始采集（录制开始时调用）。重复调用是安全的。 */
export async function startMouseClickLog(): Promise<boolean> {
  const module = await loadModule()
  if (!module) return false
  clicks = []
  keys = []
  heldModifiers.clear()
  if (running) return true
  try {
    module.uIOhook.on('click', onClick)
    module.uIOhook.on('keydown', onKeyDown)
    module.uIOhook.on('keyup', onKeyUp)
    module.uIOhook.start()
    running = true
    return true
  } catch (error) {
    module.uIOhook.off('click', onClick)
    console.warn('[mouse-hook] 启动失败，已跳过点击采集：', String(error instanceof Error ? error.message : error))
    return false
  }
}

/** 停止采集并卸载钩子（录制结束时调用）。 */
export function stopMouseClickLog(): void {
  if (!running) return
  running = false
  try {
    const module = moduleCache
    module?.uIOhook.off('click', onClick)
    module?.uIOhook.stop()
  } catch (error) {
    console.warn('[mouse-hook] 停止失败（已忽略）：', String(error instanceof Error ? error.message : error))
  }
}

/** 取走自上次调用以来累积的输入事件（渲染层每 80ms 轮询光标时顺带取一次，不额外增加 IPC）。 */
export function drainMouseClicks(): MouseClickEvent[] {
  if (!clicks.length) return []
  const drained = clicks
  clicks = []
  return drained
}

/** 取走累积的按键角标事件（只含快捷键与导航键）。 */
export function drainKeyStrokes(): KeyStrokeEvent[] {
  if (!keys.length) return []
  const drained = keys
  keys = []
  return drained
}

/** 是否真的在采集（供诊断与审计断言）。 */
export const mouseClickLogActive = (): boolean => running
