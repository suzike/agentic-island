export interface ExternalYieldPort {
  collapse: () => void
  blur: () => void
  setClickThrough: (ignore: boolean) => void
  setTopmost: (topmost: boolean) => void
}

export interface ExternalYieldController {
  yieldWindow: () => void
  suspendTopmost: () => () => void
  isLowered: () => boolean
  restore: () => void
  dispose: () => void
}

/**
 * 外部应用接管焦点前，先让铺满工作区的透明主窗口退出最高层。
 * 延迟恢复置顶只用于保留顶部迷你入口；渲染层收到 collapse 后不会恢复完整面板。
 */
export function createExternalYieldController(port: ExternalYieldPort, restoreDelay = 1400): ExternalYieldController {
  let timer: ReturnType<typeof setTimeout> | undefined
  let holds = 0
  const restore = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (holds > 0) return
    port.setTopmost(true)
  }
  const yieldWindow = (): void => {
    if (timer) clearTimeout(timer)
    port.collapse()
    port.setClickThrough(true)
    port.blur()
    port.setTopmost(false)
    timer = setTimeout(restore, restoreDelay)
  }
  const suspendTopmost = (): (() => void) => {
    if (timer) clearTimeout(timer)
    timer = undefined
    holds++
    port.setTopmost(false)
    let released = false
    return (): void => {
      if (released) return
      released = true
      holds = Math.max(0, holds - 1)
      if (holds === 0) port.setTopmost(true)
    }
  }
  const dispose = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    holds = 0
  }
  return { yieldWindow, suspendTopmost, isLowered: () => holds > 0 || timer !== undefined, restore, dispose }
}
