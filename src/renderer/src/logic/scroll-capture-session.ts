/**
 * 滚动截图的抓帧会话（需要 DOM / 媒体流，因此单独成文件）。
 *
 * 为什么从 `logic/screenshot.ts` 拆出来：那个文件被 `scripts/test-screenshot.ts` **直接用 node 加载**，
 * 而 node 的 strip-types 模式要求 import 带显式扩展名（AGENTS 约束 1）。把需要运行时的部分挪走后，
 * `screenshot.ts` 继续保持"零运行时依赖"，纯函数才能留在离线测试里。
 */
import { stitchScrollFrames } from './scroll-capture'

/**
 * 滚动截图的抓帧循环。
 *
 * 节奏取 260ms：比抓帧能力（实测 30fps）慢得多，但足够跟上"人在滚"的节奏，而且给拼接留出明确的
 * 重叠区。结束条件用"连续 N 次没有新内容"＝用户停下/到底了——不需要用户按任何键，
 * 这比"滚完再回去点按钮"符合直觉。硬上限防呆：超时或超长自动收尾。
 */
export interface ScrollCaptureSession {
  stop: () => void
  finished: Promise<{ dataUrl: string; width: number; height: number; segments: number; skipped: number } | null>
}

export interface ScrollCaptureOptions {
  region: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  intervalMs?: number
  idleRounds?: number
  maxMs?: number
  maxHeight?: number
  onProgress?: (state: { segments: number; height: number }) => void
}

export async function startScrollCapture(sourceId: string, options: ScrollCaptureOptions): Promise<ScrollCaptureSession> {
  const intervalMs = Math.max(120, options.intervalMs ?? 260)
  const idleRounds = Math.max(2, options.idleRounds ?? 6)
  const maxMs = Math.max(5_000, options.maxMs ?? 120_000)
  const width = Math.max(2, Math.round(options.region.width * options.scaleFactor))
  const height = Math.max(2, Math.round(options.region.height * options.scaleFactor))

  const constraints = { audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } } as unknown as MediaStreamConstraints
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  if (!video.videoWidth) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('抓帧超时（未拿到画面尺寸）')), 6_000)
      video.addEventListener('loadedmetadata', () => { window.clearTimeout(timer); resolve() }, { once: true })
    })
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    stream.getTracks().forEach((track) => track.stop())
    video.srcObject = null
  }

  const finished = (async () => {
    const frames: Array<{ data: Uint8ClampedArray; width: number; height: number }> = []
    let idle = 0
    const startedAt = Date.now()
    try {
      while (!stopped) {
        // 每帧都重新按选区抠图：滚动的是内容，选区本身不动
        ctx.drawImage(video, Math.round(options.region.x * options.scaleFactor), Math.round(options.region.y * options.scaleFactor), width, height, 0, 0, width, height)
        const image = ctx.getImageData(0, 0, width, height)
        frames.push({ data: image.data, width, height })
        const stitched = stitchScrollFrames(frames, { maxHeight: options.maxHeight ?? 40_000 })
        const gained = stitched ? stitched.advances.at(-1) ?? 0 : 0
        idle = gained > 0 ? 0 : idle + 1
        if (stitched) options.onProgress?.({ segments: frames.length, height: stitched.height })
        // 拼接结果只保留一份精简副本，避免每帧都留全量数据吃内存
        if (stitched && frames.length > 2 && gained > 0) { frames.splice(0, frames.length - 2, { data: stitched.data, width: stitched.width, height: stitched.height }) }
        if (idle >= idleRounds) break
        if (Date.now() - startedAt > maxMs) break
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
    } catch { /* 抓帧失败按结束处理，已拼到的部分照常交付 */ }
    stop()
    const result = stitchScrollFrames(frames, { maxHeight: options.maxHeight ?? 40_000 })
    if (!result) return null
    const output = document.createElement('canvas')
    output.width = result.width
    output.height = result.height
    const octx = output.getContext('2d')!
    // putImageData 要的是 Uint8ClampedArray<ArrayBuffer>；拼接结果是按需新建的数组，
    // 这里显式拷进一个普通 ArrayBuffer 视图，避免 SharedArrayBuffer 的类型分支
    const pixels = new Uint8ClampedArray(new ArrayBuffer(result.data.length))
    pixels.set(result.data)
    octx.putImageData(new ImageData(pixels, result.width, result.height), 0, 0)
    return { dataUrl: output.toDataURL('image/png'), width: result.width, height: result.height, segments: frames.length, skipped: result.skipped }
  })()

  return { stop, finished }
}

