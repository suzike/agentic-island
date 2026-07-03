// 配置持久化：把设置与 LLM 配置写入 userData/config.json。
// 若 safeStorage 可用（Windows DPAPI），整个配置以密文存储，保护 API Key；否则明文兜底。

import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const filePath = (): string => join(app.getPath('userData'), 'config.json')

export function loadState(): Record<string, unknown> | null {
  const p = filePath()
  if (!existsSync(p)) return null
  try {
    const raw = readFileSync(p)
    // 密文以 "enc:" 前缀标记
    const text = raw.toString('utf8')
    if (text.startsWith('enc:') && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(text.slice(4), 'base64')
      return JSON.parse(safeStorage.decryptString(buf))
    }
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function saveState(state: Record<string, unknown>): void {
  const p = filePath()
  try {
    const json = JSON.stringify(state)
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(json).toString('base64')
      writeFileSync(p, 'enc:' + enc, { mode: 0o600 })
    } else {
      writeFileSync(p, json, { mode: 0o600 })
    }
  } catch {
    /* 忽略写入失败 */
  }
}
