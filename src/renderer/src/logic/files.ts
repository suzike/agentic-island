// 问答附件真实读取：文本类文件读入内容（发送时拼进提问），图片读成 dataURL（发给视觉模型）。
// 此前附件只是装饰（AI 声称"无法读取"）——现在是真的读。

import type { Attachment } from '../types'
import { island } from '../bridge'

const TEXT_EXT = /\.(md|markdown|txt|log|json|jsonc|yaml|yml|toml|ini|cfg|conf|xml|html?|css|scss|less|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|swift|m|sql|sh|bash|ps1|bat|cmd|dockerfile|env|gitignore|vue|svelte|php|lua|r|pl|scala|dart|gradle|properties|diff|patch)$/i
const MAX_TEXT_BYTES = 512 * 1024 // 超过 512KB 的文本不读（提示过大）
const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // 视觉模型请求体上限考虑

/** 打开 Chromium 文件选择器，并在其整个生命周期内让主窗口退出最高层。 */
export function selectLocalFiles(accept = '', multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    if (accept) input.accept = accept
    input.tabIndex = -1
    input.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(input)

    let settled = false
    let focusTimer: number | undefined
    const finish = (files: File[]): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (focusTimer !== undefined) clearTimeout(focusTimer)
      window.removeEventListener('focus', onFocus)
      input.remove()
      island.setNativeDialogOpen(false)
      resolve(files)
    }
    const onFocus = (): void => {
      // Windows 可能先恢复窗口焦点、稍后才填充 input.files；给 change 事件充分时间。
      if (focusTimer !== undefined) clearTimeout(focusTimer)
      focusTimer = window.setTimeout(() => finish(Array.from(input.files || [])), 600)
    }
    const timeout = window.setTimeout(() => finish([]), 5 * 60_000)
    input.onchange = () => finish(Array.from(input.files || []))
    input.addEventListener('cancel', () => finish([]), { once: true })
    window.addEventListener('focus', onFocus)
    island.setNativeDialogOpen(true)
    try {
      input.click()
    } catch {
      finish([])
    }
  })
}

const readAsText = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsText(f)
  })

const readAsDataUrl = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })

/** 读取一个文件为附件（尽力而为：读不了内容也保留文件名，发送时如实说明） */
export async function readAttachment(f: File): Promise<Attachment> {
  try {
    if (f.type.startsWith('image/')) {
      if (f.size > MAX_IMAGE_BYTES) return { type: 'screenshot', name: `${f.name}（超过 4MB，未读取）` }
      const dataUrl = await readAsDataUrl(f)
      return { type: 'screenshot', name: f.name, thumb: dataUrl, dataUrl }
    }
    const looksText = TEXT_EXT.test(f.name) || f.type.startsWith('text/') || f.type === 'application/json'
    if (looksText) {
      if (f.size > MAX_TEXT_BYTES) return { type: 'file', name: `${f.name}（超过 512KB，未读取）` }
      const content = await readAsText(f)
      return { type: 'file', name: f.name, content }
    }
    return { type: 'file', name: `${f.name}（二进制文件，无法读取内容）` }
  } catch {
    return { type: 'file', name: `${f.name}（读取失败）` }
  }
}

/** 把 dataURL 降采样（最宽 maxW、JPEG 质量 q），控制发给视觉模型的体积 */
export function downscaleDataUrl(dataUrl: string, maxW = 1280, q = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      ctx.drawImage(img, 0, 0, w, h)
      try { resolve(canvas.toDataURL('image/jpeg', q)) } catch { resolve(dataUrl) }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/** 便签插图：读图并降采样（最宽 720px、JPEG 0.82），控制持久化体积（典型 30-90KB） */
export async function imageToCompactDataUrl(f: File): Promise<string | null> {
  try {
    if (!f.type.startsWith('image/')) return null
    const bmp = await createImageBitmap(f)
    const scale = Math.min(1, 720 / bmp.width)
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)
    // PNG 截图类内容 JPEG 也够用；透明背景会变白，属可接受折衷
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}

/** 把带内容的附件拼接为提问尾部的文件块（每个截断 20k 字符，总量 48k） */
export function attachmentsToPrompt(atts: Attachment[]): string {
  let budget = 48000
  const parts: string[] = []
  for (const a of atts) {
    if (a.type === 'file' && a.content) {
      const chunk = a.content.slice(0, Math.min(20000, budget))
      budget -= chunk.length
      parts.push(`\n\n【文件 ${a.name}】\n\`\`\`\n${chunk}${a.content.length > chunk.length ? '\n…(内容过长已截断)' : ''}\n\`\`\``)
      if (budget <= 0) break
    } else if (!a.dataUrl) {
      parts.push(`\n\n[附件 ${a.name}：无法读取内容，请让用户粘贴关键部分]`)
    }
  }
  return parts.join('')
}
