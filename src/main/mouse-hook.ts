/**
 * 鼠标点击事件采集（**只在录制期间运行**）。
 *
 * 三条边界，都是刻意的：
 *  1. **只监听鼠标点击，不碰键盘**。键盘钩子会拿到全系统的按键内容，那是另一回事，本项目不做。
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

let clicks: MouseClickEvent[] = []
let running = false
let unavailable = false

type UiohookModule = {
  uIOhook: {
    on: (event: string, handler: (payload: { x: number; y: number; button: number }) => void) => void
    off: (event: string, handler: (payload: { x: number; y: number; button: number }) => void) => void
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

const onClick = (payload: { x: number; y: number; button: number }): void => {
  if (!running) return
  // 上限兜底：一次录制最多 20 万个点击，防内存失控（正常用法远达不到）
  if (clicks.length >= 200_000) return
  clicks.push({ at: Date.now(), x: Math.round(payload.x), y: Math.round(payload.y), button: buttonName(payload.button) })
}

/** 开始采集（录制开始时调用）。重复调用是安全的。 */
export async function startMouseClickLog(): Promise<boolean> {
  const module = await loadModule()
  if (!module) return false
  clicks = []
  if (running) return true
  try {
    module.uIOhook.on('click', onClick)
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

/** 取走自上次调用以来累积的点击（渲染层每 80ms 轮询光标时顺带取一次，不额外增加 IPC）。 */
export function drainMouseClicks(): MouseClickEvent[] {
  if (!clicks.length) return []
  const drained = clicks
  clicks = []
  return drained
}

/** 是否真的在采集（供诊断与审计断言）。 */
export const mouseClickLogActive = (): boolean => running
