// 配置持久化：把设置与 LLM 配置写入 userData/config.json。
// 若 safeStorage 可用（Windows DPAPI），整个配置以密文存储，保护 API Key；否则明文兜底。
// 可靠性三重保险：
// ① 原子写（tmp+rename）——频繁全量写盘时进程被杀不会留下半截文件；
// ② 解析/解密失败时备份坏文件（config.bad.json）再返回 null——保留取证现场，且避免"静默丢弃后又被默认值覆盖"；
// ③ 自定义主题双写明文 themes.json（非敏感数据）——即使主 config 出任何问题，主题也能兜底恢复。

import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, appendFileSync, statSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { externalizeAttachments, inlineAttachments, attachmentFileName } from './attachment-store'
import { join } from 'path'

const filePath = (): string => join(app.getPath('userData'), 'config.json')
const themesPath = (): string => join(app.getPath('userData'), 'themes.json')
const logPath = (): string => join(app.getPath('userData'), 'store.log')
const attachmentsDir = (): string => join(app.getPath('userData'), 'attachments')

// 附件落盘/读取（base64 → 文件）；失败返回 false / null，由调用方保留内联形态
const writeAttachmentFile = (hash: string, ext: string, base64: string): boolean => {
  try {
    mkdirSync(attachmentsDir(), { recursive: true })
    const target = join(attachmentsDir(), attachmentFileName(hash, ext))
    if (!existsSync(target)) writeFileSync(target, Buffer.from(base64, 'base64'))
    return true
  } catch (e) {
    log(`writeAttachment FAILED: ${String(e instanceof Error ? e.message : e)}`)
    return false
  }
}
const readAttachmentFile = (hash: string, ext: string): string | null => {
  try {
    const file = join(attachmentsDir(), attachmentFileName(hash, ext))
    if (!existsSync(file)) return null
    return readFileSync(file).toString('base64')
  } catch { return null }
}

/** 清理未被当前状态引用的附件文件（保留 7 天宽限，避免误删尚未落盘的会话） */
const pruneAttachments = (referenced: Set<string>): void => {
  try {
    const dir = attachmentsDir()
    if (!existsSync(dir)) return
    const cutoff = Date.now() - 7 * 86_400_000
    for (const name of readdirSync(dir)) {
      if (referenced.has(name)) continue
      const file = join(dir, name)
      try {
        if (statSync(file).mtimeMs >= cutoff) continue // 宽限期内不动
        rmSync(file, { force: true })
      } catch { /* 单个文件失败不影响其余 */ }
    }
  } catch { /* 目录不可读时跳过 GC */ }
}

const log = (msg: string): void => {
  try {
    try { if (existsSync(logPath()) && statSync(logPath()).size > 1_000_000) renameSync(logPath(), logPath() + '.old') } catch { /* 首次写入前无文件 */ }
    appendFileSync(logPath(), `${new Date().toISOString()} ${msg}\n`)
  } catch { /* */ }
}

export function loadState(): Record<string, unknown> | null {
  const p = filePath()
  let state: Record<string, unknown> | null = null
  if (existsSync(p)) {
    try {
      const text = readFileSync(p).toString('utf8')
      // 密文以 "enc:" 前缀标记
      if (text.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
        const buf = Buffer.from(text.slice(4), 'base64')
        state = JSON.parse(safeStorage.decryptString(buf)) as Record<string, unknown>
      } else {
        state = JSON.parse(text) as Record<string, unknown>
      }
    } catch (e) {
      // 读坏了：备份现场（防止后续保存把默认值覆盖上去时连取证机会都没有）
      try { copyFileSync(p, p.replace(/\.json$/, '.bad.json')) } catch { /* */ }
      log(`loadState FAILED: ${String(e instanceof Error ? e.message : e)} — 已备份 config.bad.json`)
      state = null
    }
  }
  // 图片附件回填：把引用还原为 dataUrl（缺失文件则移除该字段）
  if (state) {
    try {
      const stats = inlineAttachments(state, readAttachmentFile)
      if (stats.restored) log(`附件回填 ${stats.restored} 项`)
      if (stats.missing) log(`附件缺失 ${stats.missing} 项（文件已被清理）`)
    } catch (e) {
      log(`inlineAttachments FAILED: ${String(e instanceof Error ? e.message : e)}`)
    }
  }
  // 主题兜底：仅当主 config 里**字段缺失**（整体丢失/损坏/新装）时回补；
  // `[]` 是用户明确删空的合法状态，不回补——否则删除过的主题会"复活"
  try {
    if (!Array.isArray(state?.customThemes) && existsSync(themesPath())) {
      const themes = JSON.parse(readFileSync(themesPath(), 'utf8')) as unknown
      if (Array.isArray(themes) && themes.length) {
        state = { ...(state || {}), customThemes: themes }
        log(`customThemes 从 themes.json 兜底恢复 ${themes.length} 个`)
      }
    }
  } catch { /* 兜底文件坏了就算了 */ }
  return state
}

// 原子写：先写临时文件再 rename（Windows 上 rename 到已存在目标前先删）
function atomicWrite(path: string, data: string, mode?: number): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, data, mode !== undefined ? { mode } : undefined)
  try { renameSync(tmp, path) } catch {
    // Windows 上目标被占用等情形：退回直写
    writeFileSync(path, data, mode !== undefined ? { mode } : undefined)
  }
}

export function saveState(state: Record<string, unknown>): void {
  try {
    // 图片附件外置（base64 → 文件 + 引用），避免 config.json 被数 MB 图片撑大；
    // 注意：只影响落盘副本，渲染层内存中的状态仍持有完整 dataUrl
    const external = externalizeAttachments(state, writeAttachmentFile)
    if (external.written || external.referenced.size) pruneAttachments(external.referenced)
    const json = JSON.stringify(state)
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(json).toString('base64')
      atomicWrite(filePath(), 'enc:' + enc, 0o600)
    } else {
      atomicWrite(filePath(), json, 0o600)
    }
    // 自定义主题双写（明文，非敏感）：始终同步（含空数组——用户删空是合法状态，兜底文件必须跟上）
    if (Array.isArray(state.customThemes)) {
      atomicWrite(themesPath(), JSON.stringify(state.customThemes))
    }
  } catch (e) {
    log(`saveState FAILED: ${String(e instanceof Error ? e.message : e)}`)
  }
}
