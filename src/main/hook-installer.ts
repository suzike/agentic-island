// hook 安装器：把"转发脚本"注册进各 CLI 的配置。
// 原则：合并而非覆盖；幂等（重复安装不重复添加）；可一键卸载还原。
// 识别我方条目的方式：命令行内包含转发脚本的绝对路径。

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const CC_SETTINGS = join(homedir(), '.claude', 'settings.json')
const CODEX_HOOKS = join(homedir(), '.codex', 'hooks.json')
const CODEX_CONFIG = join(homedir(), '.codex', 'config.toml')

const NOTIFY_BEGIN = '# >>> agentic-island notify (auto) — 请勿手改'
const NOTIFY_END = '# <<< agentic-island notify'

interface HookCommand {
  type: 'command'
  command: string
  /** 秒。审批 hook 需要长超时，避免被 CLI 默认 60s 杀掉导致回退原生提示 */
  timeout?: number
}
interface HookMatcher {
  matcher?: string
  hooks: HookCommand[]
}

const readJson = (p: string): Record<string, unknown> => {
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

const backup = (p: string): void => {
  if (existsSync(p) && !existsSync(p + '.aiisland.bak')) {
    copyFileSync(p, p + '.aiisland.bak')
  }
}

const nodeCmd = (script: string, arg: string): string => `node "${script}" ${arg}`

const isOurs = (h: HookCommand, script: string): boolean =>
  typeof h.command === 'string' && h.command.includes(script)

/** 在某事件的 matcher 数组里，确保存在一条指向我方脚本的 hook（幂等） */
const ensureHook = (
  events: Record<string, HookMatcher[]>,
  event: string,
  matcher: string | undefined,
  script: string,
  arg: string,
  timeoutSec?: number
): void => {
  const arr = (events[event] ||= [])
  // 先移除我方旧条目
  for (const m of arr) m.hooks = (m.hooks || []).filter((h) => !isOurs(h, script))
  // 找到匹配的 matcher 组或新建
  let group = arr.find((m) => (m.matcher || '') === (matcher || ''))
  if (!group) {
    group = matcher ? { matcher, hooks: [] } : { hooks: [] }
    arr.push(group)
  }
  const entry: HookCommand = { type: 'command', command: nodeCmd(script, arg) }
  if (timeoutSec) entry.timeout = timeoutSec
  group.hooks.push(entry)
  // 清理空组
  events[event] = arr.filter((m) => (m.hooks || []).length > 0)
}

const removeOurs = (events: Record<string, HookMatcher[]>, script: string): void => {
  for (const event of Object.keys(events)) {
    const arr = events[event]
    if (!Array.isArray(arr)) continue
    for (const m of arr) m.hooks = (m.hooks || []).filter((h) => !isOurs(h, script))
    events[event] = arr.filter((m) => (m.hooks || []).length > 0)
    if (events[event].length === 0) delete events[event]
  }
}

export function installClaudeCode(ccForwardScript: string): void {
  backup(CC_SETTINGS)
  const settings = readJson(CC_SETTINGS)
  const hooks = ((settings.hooks as Record<string, HookMatcher[]>) ||= {})
  // 覆盖会话全生命周期，实时反映每个 Claude Code 会话：
  ensureHook(hooks, 'SessionStart', undefined, ccForwardScript, 'claude-code SessionStart')
  ensureHook(hooks, 'UserPromptSubmit', undefined, ccForwardScript, 'claude-code UserPromptSubmit')
  // PreToolUse 是阻塞审批 hook：600s 长超时，避免被默认 60s 杀掉回退原生提示
  ensureHook(hooks, 'PreToolUse', undefined, ccForwardScript, 'claude-code PreToolUse', 600)
  ensureHook(hooks, 'Stop', undefined, ccForwardScript, 'claude-code Stop')
  ensureHook(hooks, 'SessionEnd', undefined, ccForwardScript, 'claude-code SessionEnd')
  ensureHook(hooks, 'Notification', undefined, ccForwardScript, 'claude-code Notification')
  mkdirSync(dirname(CC_SETTINGS), { recursive: true })
  writeFileSync(CC_SETTINGS, JSON.stringify(settings, null, 2))
}

export function uninstallClaudeCode(ccForwardScript: string): void {
  if (!existsSync(CC_SETTINGS)) return
  const settings = readJson(CC_SETTINGS)
  if (settings.hooks) {
    removeOurs(settings.hooks as Record<string, HookMatcher[]>, ccForwardScript)
  }
  writeFileSync(CC_SETTINGS, JSON.stringify(settings, null, 2))
}

// Codex：官方支持从 ~/.codex/hooks.json 读取生命周期 hooks（command 类型）。
// 字段细节需在真实 Codex 版本二次验证（见计划风险 #1）。这里按文档形态写入。
export function installCodex(codexForwardScript: string): void {
  backup(CODEX_HOOKS)
  const doc = readJson(CODEX_HOOKS)
  const hooks = ((doc.hooks as Record<string, HookMatcher[]>) ||= {})
  // Codex 支持的生命周期 matcher（字段细节以真实版本为准）
  ensureHook(hooks, 'SessionStart', undefined, codexForwardScript, 'codex SessionStart')
  ensureHook(hooks, 'UserPromptSubmit', undefined, codexForwardScript, 'codex UserPromptSubmit')
  ensureHook(hooks, 'PermissionRequest', undefined, codexForwardScript, 'codex PermissionRequest')
  ensureHook(hooks, 'PreToolUse', undefined, codexForwardScript, 'codex PreToolUse')
  ensureHook(hooks, 'Stop', undefined, codexForwardScript, 'codex Stop')
  mkdirSync(dirname(CODEX_HOOKS), { recursive: true })
  writeFileSync(CODEX_HOOKS, JSON.stringify(doc, null, 2))
}

export function uninstallCodex(codexForwardScript: string): void {
  if (!existsSync(CODEX_HOOKS)) return
  const doc = readJson(CODEX_HOOKS)
  if (doc.hooks) removeOurs(doc.hooks as Record<string, HookMatcher[]>, codexForwardScript)
  writeFileSync(CODEX_HOOKS, JSON.stringify(doc, null, 2))
}

// Codex 的 hooks 在 Windows 被禁用 → 用 notify（config.toml，Windows 可用）收完成/通知事件。
// notify 是单一顶层键：若用户已有自己的 notify，我们不覆盖，只在没有时追加（带标记块，便于卸载）。
export function installCodexNotify(notifyScript: string): void {
  let text = ''
  if (existsSync(CODEX_CONFIG)) {
    backup(CODEX_CONFIG)
    text = readFileSync(CODEX_CONFIG, 'utf8')
  }
  // 先移除旧的标记块
  text = stripBlock(text, NOTIFY_BEGIN, NOTIFY_END)
  // 若用户在标记块之外已自定义 notify，则不动它（尊重用户配置）
  if (/^\s*notify\s*=/m.test(text)) return
  const fwd = notifyScript.replace(/\\/g, '/')
  const block = `\n${NOTIFY_BEGIN}\nnotify = ["node", "${fwd}"]\n${NOTIFY_END}\n`
  mkdirSync(dirname(CODEX_CONFIG), { recursive: true })
  writeFileSync(CODEX_CONFIG, text.replace(/\s*$/, '') + '\n' + block)
}

export function uninstallCodexNotify(): void {
  if (!existsSync(CODEX_CONFIG)) return
  const text = readFileSync(CODEX_CONFIG, 'utf8')
  writeFileSync(CODEX_CONFIG, stripBlock(text, NOTIFY_BEGIN, NOTIFY_END).replace(/\n{3,}/g, '\n\n'))
}

function stripBlock(text: string, begin: string, end: string): string {
  const b = text.indexOf(begin)
  if (b === -1) return text
  const e = text.indexOf(end, b)
  if (e === -1) return text
  return text.slice(0, b) + text.slice(e + end.length)
}
