// 配置持久化：把设置与 LLM 配置写入 userData/config.json。
// 若 safeStorage 可用（Windows DPAPI），整个配置以密文存储，保护 API Key；否则明文兜底。
// 可靠性三重保险：
// ① 原子写（tmp+rename）——频繁全量写盘时进程被杀不会留下半截文件；
// ② 解析/解密失败时备份坏文件（config.bad.json）再返回 null——保留取证现场，且避免"静默丢弃后又被默认值覆盖"；
// ③ 自定义主题双写明文 themes.json（非敏感数据）——即使主 config 出任何问题，主题也能兜底恢复。

import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, appendFileSync } from 'fs'
import { join } from 'path'

const filePath = (): string => join(app.getPath('userData'), 'config.json')
const themesPath = (): string => join(app.getPath('userData'), 'themes.json')
const logPath = (): string => join(app.getPath('userData'), 'store.log')

const log = (msg: string): void => {
  try { appendFileSync(logPath(), `${new Date().toISOString()} ${msg}\n`) } catch { /* */ }
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
