// Autoloop 规则文件的读写与校验（可视化编排的后端）。
//
// 上游事实（2026-11 读源码核实）：
// - 规则文件 `$AGENT_AUTOLOOP_HOME/rules.json`（默认 ~/.agent-autoloop/rules.json），
//   读取走 **严格 JSON.parse**（protocol/rules.ts 的 parseRules）——注释会导致整份文件被拒、中台继续用旧规则。
//   因此这里读的时候也严格解析，并对"带注释/尾逗号"的文件给出明确提示，而不是悄悄改坏。
// - 校验的权威是 `agent-autoloop check [文件]`：只读文件、不碰运行中的中台、不打开数据库。
// - 中台对文件是"轮询 + 变更即热载"（几秒生效，改错保持旧规则并发卡片告知）。
//
// 保存策略：check 通过才写；写前把原文件备份成 rules.<时间戳>.bak（同目录）；tmp+rename 原子替换。
// 远程中台（地址是别的机器）时本地文件编辑没有意义 —— 由上层用 mode/url 判断并禁用编辑入口。

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AutoloopRules, SuperRulesResult } from '../shared/protocol'

export type RulesSpawn = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

export interface RulesConfigOptions {
  /** 中台 home（测试注入）；默认 $AGENT_AUTOLOOP_HOME 或 ~/.agent-autoloop */
  homeDir: string
  spawnImpl: RulesSpawn
  now?: () => number
  /** 演示/无 CLI 环境：保存时跳过官方 check（仍做严格 JSON 解析与结构校验） */
  skipCheck?: boolean
}

export const rulesPathOf = (homeDir: string): string => join(homeDir, 'rules.json')

/** 把官方 check 的输出压成一句人话（上游把问题列表写在 stderr/stdout 的这几行里） */
const tidyCheckError = (out: string): string => {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // 去掉 node 的 ExperimentalWarning 噪音
  const kept = lines.filter((l) => !/ExperimentalWarning|trace-warnings/.test(l))
  const text = kept.slice(-12).join('\n')
  return (text || '校验未通过').slice(0, 1200)
}

/** 严格解析 + 人话报错。返回 null 表示解析失败。 */
export function parseRulesText(text: string): { ok: true; rules: AutoloopRules } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: '规则文件是空的' }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '规则文件顶层必须是一个对象' }
    }
    return { ok: true, rules: parsed as AutoloopRules }
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    const hint = /\/\/|\/\*/.test(trimmed)
      ? '（注意：agent-autoloop 的 rules.json 是严格 JSON，不支持 // 或 /* */ 注释——注释会让整份文件被拒）'
      : ''
    return { ok: false, error: `不是合法 JSON：${msg.slice(0, 200)}${hint}` }
  }
}

export class AutoloopRulesStore {
  private homeDir: string
  private spawnImpl: RulesSpawn
  private now: () => number
  private skipCheck: boolean

  constructor(opts: RulesConfigOptions) {
    this.homeDir = opts.homeDir
    this.spawnImpl = opts.spawnImpl
    this.now = opts.now || Date.now
    this.skipCheck = opts.skipCheck === true
  }

  path(): string {
    return rulesPathOf(this.homeDir)
  }

  read(): SuperRulesResult {
    const path = this.path()
    if (!existsSync(path)) {
      return { ok: false, path, error: `找不到 ${path}——本机还没装 agent-autoloop（或 AGENT_AUTOLOOP_HOME 指到别处）` }
    }
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (e) {
      return { ok: false, path, error: `读不到 ${path}：${String((e as NodeJS.ErrnoException)?.code || (e as Error)?.message)}` }
    }
    const parsed = parseRulesText(text)
    if (!parsed.ok) return { ok: false, path, error: parsed.error }
    return { ok: true, path, rules: parsed.rules }
  }

  /** 新建一份最小可用规则模板（文件已存在时拒绝，绝不覆盖） */
  createTemplate(): SuperRulesResult {
    const path = this.path()
    if (existsSync(path)) return { ok: false, path, error: 'rules.json 已存在，请直接编辑' }
    const template: AutoloopRules = {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      askFirst: ['删数据', '停服', '花钱', '对外发消息'],
      sources: { local: { name: '本机' } },
      agents: {
        claude: { name: 'Claude Code', use: 'claude', access: 'edit' },
        codex: { name: 'Codex', use: 'codex', access: 'edit' }
      },
      channels: { desktop: { name: '桌面通知' } },
      rules: [{
        name: '试一下',
        when: { source: 'local', types: ['try.*'] },
        to: 'claude',
        cwd: '~',
        prompt: '读资料文件；没事可做就交「没事可做：原因」。'
      }],
      elsewhere: []
    }
    try {
      mkdirSync(this.homeDir, { recursive: true })
      writeFileSync(path, JSON.stringify(template, null, 2) + '\n', 'utf8')
      return { ok: true, path, rules: template }
    } catch (e) {
      return { ok: false, path, error: `创建失败：${String((e as Error)?.message || e).slice(0, 200)}` }
    }
  }

  /** 官方 check 校验一份草稿：写临时文件 → `agent-autoloop check <tmp>` → 删临时文件 */
  async validate(json: string): Promise<{ ok: boolean; error?: string }> {
    const parsed = parseRulesText(json)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    // 演示/无 CLI：跳过官方 check（结构已由 parseRulesText 把关），否则演示环境永远存不了
    if (this.skipCheck) return { ok: true }
    // 并发校验（快速连点/多窗口）用随机后缀，避免同一毫秒撞名互相覆盖
    const tmp = join(this.homeDir, `.island-check-${this.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
    try {
      if (!existsSync(this.homeDir)) return { ok: false, error: `中台目录不存在：${this.homeDir}` }
      writeFileSync(tmp, JSON.stringify(parsed.rules, null, 2) + '\n', 'utf8')
      const r = await this.spawnImpl(['check', tmp])
      if (r.code === 0) return { ok: true }
      return { ok: false, error: tidyCheckError(`${r.stderr}\n${r.stdout}`) }
    } catch (e) {
      return { ok: false, error: `校验命令跑不起来：${String((e as Error)?.message || e).slice(0, 300)}` }
    } finally {
      try { unlinkSync(tmp) } catch { /* 临时文件清理失败无害 */ }
    }
  }

  /** 保存：解析 → check → 备份 → 原子写。任何一步失败都不动原文件。 */
  async save(json: string): Promise<SuperRulesResult> {
    const path = this.path()
    const parsed = parseRulesText(json)
    if (!parsed.ok) return { ok: false, path, error: parsed.error }
    if (!existsSync(path)) {
      return { ok: false, path, error: `找不到 ${path}——先在「测试连通」里确认中台位置，或手动建好 rules.json` }
    }
    const checked = await this.validate(json)
    if (!checked.ok) return { ok: false, path, error: checked.error }

    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-')
    // 同一毫秒内多次保存也要各留一份：加随机后缀（备份多一份无害，覆盖丢历史才有害）
    const backupPath = join(this.homeDir, `rules.${stamp}-${Math.random().toString(36).slice(2, 6)}.bak`)
    try {
      copyFileSync(path, backupPath)
    } catch (e) {
      return { ok: false, path, error: `备份失败，未写入：${String((e as Error)?.message || e).slice(0, 200)}` }
    }
    const tmp = `${path}.island-tmp`
    try {
      writeFileSync(tmp, JSON.stringify(parsed.rules, null, 2) + '\n', 'utf8')
      renameSync(tmp, path)
    } catch (e) {
      try { unlinkSync(tmp) } catch { /* */ }
      return { ok: false, path, backupPath, error: `写入失败：${String((e as Error)?.message || e).slice(0, 200)}` }
    }
    return { ok: true, path, backupPath, rules: parsed.rules }
  }
}
