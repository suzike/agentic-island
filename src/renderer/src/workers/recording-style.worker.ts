import * as ort from 'onnxruntime-web'

type InitMessage = { type: 'init'; model: ArrayBuffer }
type FrameMessage = { type: 'frame'; id: number; pixels: ArrayBuffer; width: number; height: number }
type WorkerMessage = InitMessage | FrameMessage

let session: ort.InferenceSession | null = null
let inputName = 'input'
let outputName = 'output'

ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false

async function createSession(model: ArrayBuffer): Promise<{ provider: string }> {
  let provider = 'WebGPU'
  try {
    session = await ort.InferenceSession.create(model, {
      executionProviders: ['webgpu'],
      graphOptimizationLevel: 'all'
    })
  } catch {
    provider = 'WASM'
    session = await ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    })
  }
  inputName = session.inputNames[0] || 'input'
  outputName = session.outputNames[0] || 'output'
  return { provider }
}

async function runFrame(message: FrameMessage): Promise<void> {
  if (!session) throw new Error('神经风格模型尚未初始化')
  const rgba = new Uint8ClampedArray(message.pixels)
  const pixelCount = message.width * message.height
  const input = new Float32Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    const source = i * 4
    input[i] = rgba[source] / 127.5 - 1
    input[pixelCount + i] = rgba[source + 1] / 127.5 - 1
    input[pixelCount * 2 + i] = rgba[source + 2] / 127.5 - 1
  }
  const output = await session.run({ [inputName]: new ort.Tensor('float32', input, [1, 3, message.height, message.width]) })
  const tensor = output[outputName]
  if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error('神经风格模型输出无效')
  const result = new Uint8ClampedArray(pixelCount * 4)
  const values = tensor.data
  for (let i = 0; i < pixelCount; i++) {
    const target = i * 4
    result[target] = Math.max(0, Math.min(255, Math.round((values[i] + 1) * 127.5)))
    result[target + 1] = Math.max(0, Math.min(255, Math.round((values[pixelCount + i] + 1) * 127.5)))
    result[target + 2] = Math.max(0, Math.min(255, Math.round((values[pixelCount * 2 + i] + 1) * 127.5)))
    result[target + 3] = 255
  }
  ;(self as unknown as { postMessage: (message: unknown, transfer: Transferable[]) => void }).postMessage(
    { type: 'frame', id: message.id, pixels: result.buffer, width: message.width, height: message.height },
    [result.buffer]
  )
}

self.onmessage = (event: MessageEvent<WorkerMessage>): void => {
  const message = event.data
  if (message.type === 'init') {
    void createSession(message.model)
      .then(({ provider }) => postMessage({ type: 'ready', provider }))
      .catch((error) => postMessage({ type: 'error', error: String(error instanceof Error ? error.message : error) }))
    return
  }
  void runFrame(message).catch((error) => postMessage({ type: 'frame-error', id: message.id, error: String(error instanceof Error ? error.message : error) }))
}
