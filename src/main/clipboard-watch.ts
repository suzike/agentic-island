// 剪贴板助手：轮询系统剪贴板文本与图片，变化时回调（供问答区"剪贴板"面板用）。
// 隐私约定：历史只存在渲染层内存（收藏项才持久化），绝不上传。开关在设置里（clipWatch）。

import { clipboard, type NativeImage } from 'electron'
import { readClipboardImageDataUrl, readClipboardNativeImage } from './clipboard-compat'

const POLL_MS = 1500
const MAX_LEN = 100_000 // 超长文本（如整文件二进制粘贴）跳过

/** 文本读取（Electron 44 起为 Promise）；失败返回空串交给轮询静默跳过 */
const readTextSafe = async (): Promise<string> => {
  try { return await clipboard.readText() } catch { return '' }
}

/**
 * 图片变更指纹：只裁四角与中心的小块（各 8×8）。
 * 之前每 1.5s 对未变化的图重新 resize + PNG 编码（截图在剪贴板里时是一张 2560×3040 的大图），
 * 主进程会被这条轮询长期占住；现在指纹不变就直接跳过编码。
 */
const imageSignature = (im: NativeImage): string => {
  try {
    const { width, height } = im.getSize()
    if (!width || !height) return ''
    const n = Math.max(1, Math.min(8, width, height))
    const spots: Array<[number, number]> = [
      [0, 0],
      [Math.max(0, width - n), 0],
      [0, Math.max(0, height - n)],
      [Math.max(0, width - n), Math.max(0, height - n)],
      [Math.max(0, Math.floor(width / 2 - n / 2)), Math.max(0, Math.floor(height / 2 - n / 2))]
    ]
    let h = 2166136261
    for (const [x, y] of spots) {
      const buf = im.crop({ x, y, width: Math.min(n, width), height: Math.min(n, height) }).toBitmap()
      for (let i = 0; i < buf.length; i += 4) { h ^= buf[i]; h = Math.imul(h, 16777619) }
      h = Math.imul(h ^ buf.length, 16777619)
    }
    return `${width}x${height}:${h >>> 0}`
  } catch { return '' }
}

export interface ClipPayload {
  kind: 'text' | 'image'
  text?: string
  dataUrl?: string
}

export function startClipboardWatch(onNew: (item: ClipPayload) => void): () => void {
  let lastText = ''
  let lastImg = ''
  let lastSig = ''
  // 轮询改为异步串行：Elektron 44 的剪贴板读取均为 Promise，重叠读取会互相干扰
  void (async () => {
    try { lastText = await readTextSafe() } catch { /* */ }
    try { lastImg = await readClipboardImageDataUrl() } catch { /* */ }
  })()

  const tick = async (): Promise<void> => {
    // 文本
    try {
      const cur = await readTextSafe()
      if (cur && cur !== lastText) {
        lastText = cur
        if (cur.trim() && cur.length <= MAX_LEN) onNew({ kind: 'text', text: cur })
      }
    } catch { /* 剪贴板被独占等瞬态错误 */ }
    // 图片（过大则降到宽 1200，控制内存）
    try {
      const im = await readClipboardNativeImage()
      if (im) {
        const sig = imageSignature(im)
        if (sig && sig !== lastSig) {
          lastSig = sig
          const out = im.getSize().width > 1200 ? im.resize({ width: 1200 }) : im
          const url = out.toDataURL()
          if (url && url !== lastImg) { lastImg = url; onNew({ kind: 'image', dataUrl: url }) }
        }
      }
    } catch { /* */ }
  }

  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void tick().finally(() => { running = false })
  }, POLL_MS)
  return () => clearInterval(timer)
}
