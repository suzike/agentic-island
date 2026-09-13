// 剪贴板兼容层（Electron 44 迁移）。
// Electron 44 把 clipboard 重构为 W3C 风格：read/write 走 ClipboardItem，readText/writeText 返回 Promise，
// 并移除了 readImage/writeImage。这里把"读/写图片"重新封装回 dataURL / NativeImage 语义，
// 调用方（截图轮询、剪贴板助手、图片写回）无需关心底层形态差异。

import { clipboard, nativeImage, ClipboardItem } from 'electron'

/** 从剪贴板读第一张图片为 dataURL；无图片返回 ''。 */
export async function readClipboardImageDataUrl(): Promise<string> {
  const items = await clipboard.read()
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (!type) continue
    const payload = await item.getType(type)
    // 图片 MIME 一律解析为 Blob（bookmark 类型不会命中上面的 image/ 分支）
    const blob = payload as Blob
    const bytes = Buffer.from(await blob.arrayBuffer())
    if (!bytes.length) return ''
    return `data:${type};base64,${bytes.toString('base64')}`
  }
  return ''
}

/** 读剪贴板图片为 NativeImage；无图片返回 null（保留尺寸/缩放能力供轮询降采样用）。 */
export async function readClipboardNativeImage(): Promise<Electron.NativeImage | null> {
  const dataUrl = await readClipboardImageDataUrl()
  if (!dataUrl) return null
  const image = nativeImage.createFromDataURL(dataUrl)
  return image.isEmpty() ? null : image
}

/** 把 dataURL 图片写入剪贴板；解码失败返回 false。 */
export async function writeClipboardImageDataUrl(dataUrl: string): Promise<boolean> {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) return false
  const png = image.toPNG()
  // 复制到独立 ArrayBuffer：Buffer 的共享内存视图不满足 BlobPart 类型
  const bytes = new Uint8Array(png).slice()
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })])
  return true
}
