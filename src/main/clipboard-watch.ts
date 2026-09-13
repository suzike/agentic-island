// 剪贴板助手：轮询系统剪贴板文本与图片，变化时回调（供问答区"剪贴板"面板用）。
// 隐私约定：历史只存在渲染层内存（收藏项才持久化），绝不上传。开关在设置里（clipWatch）。

import { clipboard } from 'electron'
import { readClipboardImageDataUrl, readClipboardNativeImage } from './clipboard-compat'

const POLL_MS = 1500
const MAX_LEN = 100_000 // 超长文本（如整文件二进制粘贴）跳过

/** 文本读取（Electron 44 起为 Promise）；失败返回空串交给轮询静默跳过 */
const readTextSafe = async (): Promise<string> => {
  try { return await clipboard.readText() } catch { return '' }
}

export interface ClipPayload {
  kind: 'text' | 'image'
  text?: string
  dataUrl?: string
}

export function startClipboardWatch(onNew: (item: ClipPayload) => void): () => void {
  let lastText = ''
  let lastImg = ''
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
        const out = im.getSize().width > 1200 ? im.resize({ width: 1200 }) : im
        const url = out.toDataURL()
        if (url && url !== lastImg) { lastImg = url; onNew({ kind: 'image', dataUrl: url }) }
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
