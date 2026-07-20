export interface ScreenshotPollerPort {
  readImage: () => string
  onCapture: (dataUrl: string) => void
  onTimeout: () => void
}

export interface ScreenshotPoller {
  start: (baseline: string) => void
  stop: () => void
  isActive: () => boolean
}

/**
 * 轮询系统剪贴板中的新截图。start 可重复调用；新一轮会立即替换旧轮询，
 * 避免用户取消一次框选后入口被锁到超时结束。
 */
export function createScreenshotPoller(
  port: ScreenshotPollerPort,
  intervalMs = 500,
  maxTries = 120
): ScreenshotPoller {
  let timer: ReturnType<typeof setInterval> | undefined
  let generation = 0

  const stop = (): void => {
    generation++
    if (timer) clearInterval(timer)
    timer = undefined
  }

  const start = (baseline: string): void => {
    stop()
    const currentGeneration = generation
    let tries = 0
    timer = setInterval(() => {
      if (generation !== currentGeneration) return
      tries++
      let dataUrl = ''
      try { dataUrl = port.readImage() } catch { /* 剪贴板可能被其它进程短暂占用 */ }
      if (dataUrl && dataUrl !== baseline) {
        stop()
        port.onCapture(dataUrl)
        return
      }
      if (tries >= maxTries) {
        stop()
        port.onTimeout()
      }
    }, intervalMs)
  }

  return { start, stop, isActive: () => timer !== undefined }
}
