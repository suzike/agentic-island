export type NeuralStyleStatus = 'idle' | 'loading' | 'ready' | 'error'

interface WorkerFrame {
  type: 'frame'
  id: number
  pixels: ArrayBuffer
  width: number
  height: number
}

export class RecordingNeuralStyle {
  private worker: Worker | null = null
  private inFlight = false
  private sequence = 0
  private frameCanvas: OffscreenCanvas | null = null
  private status: NeuralStyleStatus = 'idle'
  private provider = ''
  private error = ''
  private listeners = new Set<() => void>()

  snapshot(): { status: NeuralStyleStatus; provider: string; error: string } {
    return { status: this.status, provider: this.provider, error: this.error }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void { this.listeners.forEach((listener) => listener()) }

  async initialize(model: ArrayBuffer): Promise<void> {
    if (this.status === 'ready' || this.status === 'loading') return
    this.status = 'loading'; this.error = ''; this.emit()
    this.worker = new Worker(new URL('../workers/recording-style.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent): void => {
      const message = event.data as ({ type: string; provider?: string; error?: string } | WorkerFrame)
      if (message.type === 'ready') {
        this.status = 'ready'; this.provider = 'provider' in message ? message.provider || '' : ''; this.emit(); return
      }
      if (message.type === 'error') {
        this.status = 'error'; this.error = 'error' in message ? message.error || '模型初始化失败' : '模型初始化失败'; this.emit(); return
      }
      if (message.type === 'frame') {
        const frame = message as WorkerFrame
        if (!this.frameCanvas || this.frameCanvas.width !== frame.width || this.frameCanvas.height !== frame.height) {
          this.frameCanvas = new OffscreenCanvas(frame.width, frame.height)
        }
        this.frameCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0)
        this.inFlight = false
        return
      }
      if (message.type === 'frame-error') {
        this.inFlight = false
        this.error = 'error' in message ? message.error || '人物风格化失败' : '人物风格化失败'
        this.emit()
      }
    }
    this.worker.onerror = (event) => {
      this.status = 'error'; this.error = event.message || '人物风格化线程异常'; this.inFlight = false; this.emit()
    }
    const transferable = model.slice(0)
    this.worker.postMessage({ type: 'init', model: transferable }, [transferable])
  }

  request(frame: ImageData): void {
    if (!this.worker || this.status !== 'ready' || this.inFlight) return
    this.inFlight = true
    const pixels = frame.data.buffer.slice(0)
    this.worker.postMessage({ type: 'frame', id: ++this.sequence, pixels, width: frame.width, height: frame.height }, [pixels])
  }

  paint(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, strength = 1): boolean {
    if (!this.frameCanvas) return false
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, strength))
    ctx.drawImage(this.frameCanvas, x, y, width, height)
    ctx.restore()
    return true
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.inFlight = false
    this.frameCanvas = null
    this.status = 'idle'
    this.provider = ''
    this.error = ''
    this.emit()
  }
}
