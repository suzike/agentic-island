// 附件外置（性能）：消息里的 base64 图片（thumb / dataUrl，单张数百 KB）此前随每次状态保存
// 全量加密落盘，导致 config.json 膨胀到数 MB、每次保存都要重新加密+写盘。
// 这里在持久化边界做两件事——写盘时把内联 base64 换成内容哈希引用，读取时按引用重新内联：
//   · 渲染层内存模型不变（仍持有 dataUrl），渲染、视觉模型调用、分支切换路径零改动
//   · 图片按内容哈希去重，重复粘贴的图只落一份
//   · 任何一步失败都保留内联形态（宁可不省空间，也绝不丢图）
// 纯逻辑 + 注入读写，可被 raw-node 测试直跑。

import { createHash } from 'node:crypto'

/** 消息里承载附件的已知路径：askThread（当前分支）与 askSessions[].msgs（归档会话） */
const MESSAGE_LISTS = ['askThread'] as const

interface AttachmentLike {
  /** 内联时为 dataURL 字符串；外置后为引用对象 */
  thumb?: string | AttachmentRef
  dataUrl?: string | AttachmentRef
  [key: string]: unknown
}

interface MessageLike {
  attachments?: AttachmentLike[]
  [key: string]: unknown
}

export interface AttachmentRef {
  /** 内容哈希：指向 attachments/<hash>.<ext> */
  ref: string
  /** 扩展名（png / jpeg / webp / gif） */
  ext: string
  /** 原始 base64 载荷的字符数（统计参考） */
  bytes: number
}

/** dataURL → { mime, base64 }；非 base64 图片返回 null（原样保留） */
export function splitImageDataUrl(value: unknown): { ext: string; base64: string } | null {
  if (typeof value !== 'string') return null
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value)
  if (!m) return null
  const raw = m[1].toLowerCase()
  const ext = raw === 'jpg' ? 'jpeg' : raw
  return { ext, base64: m[2].replace(/\s/g, '') }
}

/** 内容哈希（16 位十六进制足够避免碰撞，且文件名短） */
export function attachmentHash(base64: string): string {
  return createHash('sha256').update(base64).digest('hex').slice(0, 16)
}

export const attachmentFileName = (hash: string, ext: string): string => `${hash}.${ext}`

/** 深度遍历状态里的消息列表（当前分支 + 归档会话 + 可选额外键） */
function eachMessage(state: Record<string, unknown>, visit: (msg: MessageLike) => void): void {
  const list = (value: unknown): void => {
    if (!Array.isArray(value)) return
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      // 归档会话：{ title, msgs: [...] }
      if (Array.isArray(rec.msgs)) list(rec.msgs)
      else visit(rec as MessageLike)
    }
  }
  for (const key of MESSAGE_LISTS) list(state[key])
  list(state.askSessions)
}

export interface ExternalizeResult {
  /** 落盘写入的附件数（去重后） */
  written: number
  /** 因读取失败/非图片而保留内联的数量 */
  keptInline: number
  /** 被引用到的哈希集合（供 GC 判断孤儿文件） */
  referenced: Set<string>
}

/**
 * 把状态里的内联图片外置：对每个可解析的 dataURL 调用 writeFile(hash, ext, base64)，
 * 成功则把字段替换为 { ref } 引用对象；失败保留原值。
 */
export function externalizeAttachments(
  state: Record<string, unknown>,
  writeFile: (hash: string, ext: string, base64: string) => boolean
): ExternalizeResult {
  const result: ExternalizeResult = { written: 0, keptInline: 0, referenced: new Set() }
  const seen = new Set<string>()

  eachMessage(state, (msg) => {
    if (!Array.isArray(msg.attachments)) return
    for (const att of msg.attachments) {
      if (!att || typeof att !== 'object') continue
      for (const field of ['thumb', 'dataUrl'] as const) {
        const parsed = splitImageDataUrl(att[field])
        if (!parsed) continue
        const hash = attachmentHash(parsed.base64)
        const fileName = attachmentFileName(hash, parsed.ext)
        // 按"文件"去重：同一张图的 thumb/dataUrl 共用一份落盘文件
        const already = seen.has(fileName)
        const ok = already || writeFile(hash, parsed.ext, parsed.base64)
        if (!ok) { result.keptInline++; continue }
        if (!already) { seen.add(fileName); result.written++ }
        result.referenced.add(fileName)
        att[field] = { ref: hash, ext: parsed.ext, bytes: parsed.base64.length } satisfies AttachmentRef
      }
    }
  })
  return result
}

/**
 * 回填：把 { ref } 引用对象还原为 dataURL；文件缺失/读取失败则删除该字段（不留坏引用）。
 */
export function inlineAttachments(
  state: Record<string, unknown>,
  readFile: (hash: string, ext: string) => string | null
): { restored: number; missing: number } {
  const stats = { restored: 0, missing: 0 }
  eachMessage(state, (msg) => {
    if (!Array.isArray(msg.attachments)) return
    for (const att of msg.attachments) {
      if (!att || typeof att !== 'object') continue
      for (const field of ['thumb', 'dataUrl'] as const) {
        const value = att[field] as unknown
        if (!value || typeof value !== 'object') continue
        const ref = value as Partial<AttachmentRef>
        if (typeof ref.ref !== 'string' || typeof ref.ext !== 'string') continue
        const base64 = readFile(ref.ref, ref.ext)
        if (!base64) { delete att[field]; stats.missing++; continue }
        att[field] = `data:image/${ref.ext};base64,${base64}`
        stats.restored++
      }
    }
  })
  return stats
}

/** 从状态里收集所有被引用的附件文件名（GC 用） */
export function referencedAttachmentFiles(state: Record<string, unknown>): Set<string> {
  const files = new Set<string>()
  eachMessage(state, (msg) => {
    if (!Array.isArray(msg.attachments)) return
    for (const att of msg.attachments) {
      for (const field of ['thumb', 'dataUrl'] as const) {
        const value = att?.[field] as unknown
        if (!value || typeof value !== 'object') continue
        const ref = value as Partial<AttachmentRef>
        if (typeof ref.ref === 'string' && typeof ref.ext === 'string') files.add(attachmentFileName(ref.ref, ref.ext))
      }
    }
  })
  return files
}
