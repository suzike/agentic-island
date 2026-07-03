// 剪贴板助手：轮询系统剪贴板文本，变化时回调（供问答区"剪贴板 AI"用）。
// 隐私约定：历史只存在渲染层内存，绝不落盘、绝不上传；开关在设置里（clipWatch）。

import { clipboard } from 'electron'

const POLL_MS = 1500
const MAX_LEN = 100_000 // 超长内容（如整文件二进制粘贴）跳过

export function startClipboardWatch(onNew: (text: string) => void): () => void {
  let last = ''
  try { last = clipboard.readText() } catch { /* */ } // 基线：启动时已有的内容不触发
  const timer = setInterval(() => {
    try {
      const cur = clipboard.readText()
      if (cur && cur !== last) {
        last = cur
        if (cur.trim() && cur.length <= MAX_LEN) onNew(cur)
      }
    } catch { /* 剪贴板被独占等瞬态错误，下轮再试 */ }
  }, POLL_MS)
  return () => clearInterval(timer)
}
