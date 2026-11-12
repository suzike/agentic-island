// 验收台纯逻辑：把一次会话的留档（计划 / 实际改动 / 回复 / 活动轨迹）拆成可核对的三段事实。
// 不调用模型、不访问文件系统——所有结论都是本地可复现的推导，供 scripts/test-acceptance.ts 直接加载。

import type { CommandRun } from '../../../shared/protocol'
import type { AcceptanceFollowup, AcceptanceGate, AcceptanceRecord, AgentVM } from '../types'

export interface PlanStep {
  text: string
  done: boolean
}

export interface ChangedFile {
  path: string
  status: string
  /** 计划里是否提到过该文件；无计划时为 null（不评判） */
  inPlan: boolean | null
  /** 来自补验证那一轮的改动 */
  followup?: boolean
  /** 会话期间已提交的改动 */
  committed?: boolean
}

/** 展示用的验证记录：原始轮次 + 各次补验证 */
export type AcceptanceCheck = CommandRun & { followup?: boolean }

export interface AcceptanceFinding {
  level: 'warn' | 'info'
  text: string
}

/** 门禁未满足项：kind 决定展示图标与文案归类 */
export interface GateViolation {
  kind: 'exit' | 'count' | 'path'
  text: string
}

export interface AcceptanceAnalysis {
  steps: PlanStep[]
  /** 计划里声明的验证项（"验证方式/测试/验收"小节） */
  declaredChecks: string[]
  /** 有真实结果记录的验证命令（含补验证轮次，按时间排序） */
  checks: AcceptanceCheck[]
  /** 每条命令的最新一次结果：判断"现在还失败吗"只看它 */
  latestChecks: AcceptanceCheck[]
  /** 命令文本：来自 checks；旧记录回退到活动轨迹（不含退出码） */
  checksObserved: string[]
  /** 最新一次仍然失败的验证命令 */
  failedChecks: AcceptanceCheck[]
  /** 补验证次数 */
  followupCount: number
  changed: ChangedFile[]
  outsidePlan: string[]
  /** 最后回复里明示"未验证/待确认"的线索 */
  riskLines: string[]
  /** 未验证项：判断前必须由人核对的点 */
  unverified: AcceptanceFinding[]
  /** 备注：不构成风险的事实 */
  notes: AcceptanceFinding[]
  verdict: 'clean' | 'watch' | 'nochange'
  headline: string
}

const CHECKBOX = /^\s*[-*+]\s*\[([ xX])\]\s+(.+)$/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/
const HEADING = /^(#{1,6})\s+(.*)$/
const VERIFY_HEADING = /(验证|测试|验收|自检|回归|检查)/
const VERIFY_WORD = /(验证|测试|单测|验收|自检|回归|npm test|pytest|vitest|jest)/
const RISK = /(未验证|未测试|未跑|没跑|未运行|没运行|无法验证|未能验证|未做验证|待验证|待确认|待核实|暂未|尚未|未覆盖|没有测试|无测试|TODO|FIXME|假设)/
const VERIFIED = /(已验证|已测试|测试通过|构建通过|已运行|验证通过|全部通过)/
// 需求编号：显式前缀（SWR-123 / SRS_45 / REQ-7）或 SourceID 标注
const REQ_PREFIXED = /\b(?:SWR|SRS|SRSW|REQ|SPEC)[-_ ]?\d{1,6}(?:[-_][A-Z0-9]{1,3}){0,3}(?![A-Za-z0-9])/g
const REQ_LABELED = /(?:SourceID|需求编号|需求\s*ID|Requirement\s*ID)\s*[:：#=]?\s*([A-Za-z0-9][A-Za-z0-9._-]{2,40})/gi

const dedupe = (list: string[]): string[] => [...new Set(list)]
const clip = (text: string, max = 140): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** 从一段文本里抽需求编号（只认明确格式，避免把标准号/版本号当需求） */
export function requirementIdsIn(text: string): string[] {
  const found: string[] = []
  for (const m of (text || '').matchAll(REQ_PREFIXED)) found.push(m[0].replace(/\s+/g, '-').toUpperCase())
  for (const m of (text || '').matchAll(REQ_LABELED)) found.push(m[1].toUpperCase())
  return dedupe(found).slice(0, 8)
}

/** 记录里出现的需求编号：计划、改动文件路径、最后回复 */
export function requirementIdsOf(record: AcceptanceRecord): string[] {
  const changed = (record.summary?.paths || []).map((p) => p.path).join('\n')
  const follow = (record.followups || []).flatMap((f) => (f.summary?.paths || []).map((p) => p.path)).join('\n')
  return requirementIdsIn([record.plan?.text || '', changed, follow, record.lastReply || ''].join('\n'))
}

/** 搜索用的归一化文本：项目、工具、计划、文件、命令、回复（含补验证轮次） */
export function searchTextOf(record: AcceptanceRecord): string {
  return [
    record.proj,
    record.tool,
    record.plan?.text || '',
    record.lastReply || '',
    ...(record.summary?.paths || []).map((f) => f.path),
    ...(record.checks || []).map((c) => c.command),
    ...(record.followups || []).flatMap((f) => [
      ...(f.summary?.paths || []).map((x) => x.path),
      ...(f.checks || []).map((c) => c.command),
      f.lastReply || ''
    ])
  ].join('\n').toLowerCase()
}

/**
 * 落盘用的压缩副本：最近的记录保留全文，旧的把计划/回复/输出尾部截短。
 * 只影响持久化，不改内存里的完整记录（界面仍可看到原文，直到记录被挤出列表）。
 */
export function compactAcceptance(records: AcceptanceRecord[], keepFull = 10, cap = 40): AcceptanceRecord[] {
  const trim = (text: string | undefined, max: number): string | undefined =>
    text && text.length > max ? `${text.slice(0, max)}…` : text
  return records.slice(0, cap).map((r, i) => {
    if (i < keepFull) return r
    return {
      ...r,
      plan: r.plan ? { ...r.plan, text: trim(r.plan.text, 1500) || '' } : undefined,
      lastReply: trim(r.lastReply, 800),
      checks: r.checks?.map((c) => ({ ...c, outputTail: trim(c.outputTail, 160) })),
      followups: r.followups?.map((f) => ({
        ...f,
        lastReply: trim(f.lastReply, 600),
        checks: f.checks?.map((c) => ({ ...c, outputTail: trim(c.outputTail, 160) }))
      }))
    }
  })
}

/** 计划里的勾选清单（`- [ ]` / `- [x]`） */
export function planSteps(text: string): PlanStep[] {
  const out: PlanStep[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = CHECKBOX.exec(line)
    if (m) out.push({ text: m[2].trim(), done: m[1].toLowerCase() === 'x' })
  }
  return out
}

/** 计划声明的验证项：优先取"验证/测试/验收"小节里的列表，没有小节时退回含验证关键词的条目 */
export function declaredVerifications(text: string): string[] {
  const out: string[] = []
  let inSection = false
  let foundSection = false
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line)
    if (heading) {
      inSection = VERIFY_HEADING.test(heading[2])
      if (inSection) foundSection = true
      continue
    }
    if (!inSection) continue
    const item = LIST_ITEM.exec(line)
    if (item) out.push(item[1].trim())
  }
  if (foundSection) return dedupe(out).slice(0, 8)
  // 没有独立小节：只认明确提到验证的列表条目，避免把普通步骤当成验证声明
  return dedupe(
    text.split(/\r?\n/).map((line) => LIST_ITEM.exec(line)?.[1]?.trim()).filter((s): s is string => !!s && VERIFY_WORD.test(s))
  ).slice(0, 4)
}

/** 失败判定：明确的 ok=false，或已知非零退出码 */
export function checkFailed(run: CommandRun): boolean {
  return run.ok === false || (run.exitCode !== undefined && run.exitCode !== 0)
}

/** 证据是否带真实退出码（决定文案是"退出 0"还是"已执行"） */
export function checkHasExit(run: CommandRun): boolean {
  return run.exitCode !== undefined
}

/** 最后回复里明示的未验证/待确认线索（排除已经明确验证过的陈述） */
export function riskLinesOf(reply: string): string[] {
  return dedupe(reply
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*\-+]+/, '').trim())
    .filter((line) => line.length >= 6 && RISK.test(line) && !VERIFIED.test(line)))
    .slice(0, 5)
    .map((line) => clip(line))
}

/**
 * 从计划文本里抽出路径级线索：显式文件路径、目录引用、代码片段里的文件名。
 * 之前用"计划全文包含文件名"做判定，提到一个目录不会覆盖其中的文件，
 * 而提到 `index.ts` 这种通用名又会把无关改动算进计划内。
 */
export function planPathHints(planText: string): { files: string[]; dirs: string[] } {
  const files = new Set<string>()
  const dirs = new Set<string>()
  const text = planText || ''
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim()

  const consider = (raw: string): void => {
    const token = norm(raw)
    if (!token || token.includes(' ') || token.length < 3) return
    if (/\/$/.test(token) || !/\.[a-z0-9]{1,8}$/i.test(token)) {
      // 目录引用（`src/mw/`）或没有扩展名的路径片段（`src/mw`）
      if (token.includes('/')) dirs.add(token.replace(/\/+$/, ''))
      return
    }
    files.add(token)
    const dir = token.split('/').slice(0, -1).join('/')
    if (dir) dirs.add(dir)
  }

  // 1) 行内代码里的路径/文件名
  for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) consider(m[1])
  // 2) 裸路径（至少带一个斜杠）：src/mw/limit.ts、config/ratelimit.yaml、model/
  for (const m of text.matchAll(/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\/?/g)) consider(m[0])
  // 3) 带扩展名的裸文件名：router.ts、plant.slx
  for (const m of text.matchAll(/\b[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|c|h|cc|cpp|hpp|java|kt|cs|go|rs|m|slx|mdl|mat|md|json|ya?ml|toml|xml|ini|cfg|txt)\b/g)) consider(m[0])

  // 只要计划里写了完整路径，就不再按"同名文件"放宽：避免 other/limit.ts 被 src/mw/limit.ts 带进计划内
  const fullPathBases = new Set([...files].filter((f) => f.includes('/')).map((f) => (f.split('/').pop() || '').toLowerCase()))
  for (const f of [...files]) {
    if (!f.includes('/') && fullPathBases.has(f.toLowerCase())) files.delete(f)
  }

  return { files: [...files], dirs: [...dirs] }
}

/** 变更文件 + 是否在计划里被提到（路径级：精确文件 / 所在目录 / 同名文件） */
export function changedFilesOf(record: AcceptanceRecord): ChangedFile[] {
  const planText = record.plan?.text || ''
  const judge = planText.trim().length > 0
  const hints = judge ? planPathHints(planText) : { files: [], dirs: [] }
  const toFile = (item: { path: string; status: string; committed?: boolean }, followup: boolean): ChangedFile => {
    const p = item.path.replace(/\\/g, '/').replace(/^\.\//, '')
    const base = (p.split('/').pop() || p).toLowerCase()
    const mentioned = judge && (
      hints.files.some((h) => p === h || p.endsWith(`/${h}`)) ||
      hints.dirs.some((d) => p.startsWith(`${d}/`)) ||
      // 只认"计划里只写了文件名"的情况；写了完整路径就用路径精确匹配
      hints.files.some((h) => !h.includes('/') && h.toLowerCase() === base)
    )
    return { path: item.path, status: item.status, inPlan: judge ? mentioned : null, followup: followup || undefined, committed: item.committed || undefined }
  }
  const out = (record.summary?.paths || []).map((item) => toFile(item, false))
  const seen = new Set(out.map((f) => f.path))
  // 补验证那一轮的改动并进来（同一路径以最新状态为准，并标记来自补验证）
  for (const fu of record.followups || []) {
    for (const item of fu.summary?.paths || []) {
      const idx = out.findIndex((f) => f.path === item.path)
      if (idx >= 0) out[idx] = toFile(item, true)
      else if (!seen.has(item.path)) { out.push(toFile(item, true)); seen.add(item.path) }
    }
  }
  return out
}

/** 原始轮次 + 各次补验证的命令记录，按时间排序 */
export function allChecksOf(record: AcceptanceRecord): AcceptanceCheck[] {
  const list: AcceptanceCheck[] = (record.checks || []).map((c) => ({ ...c }))
  for (const fu of record.followups || []) {
    for (const c of fu.checks || []) list.push({ ...c, followup: true })
  }
  return list.sort((a, b) => a.at - b.at)
}

/** 同一条命令只保留最新一次结果：补验证通过后，旧的失败不该继续挂着 */
export function latestChecksOf(checks: AcceptanceCheck[]): AcceptanceCheck[] {
  const byCommand = new Map<string, AcceptanceCheck>()
  for (const c of checks) byCommand.set(c.command, c)
  return [...byCommand.values()]
}

/** 文件状态码 → 展示标签（porcelain 的 XY 两位码） */
export function fileStatusLabel(code: string): { label: string; tone: 'add' | 'del' | 'edit' } {
  if (code === '??' || code.includes('A')) return { label: '新增', tone: 'add' }
  if (code.includes('D')) return { label: '删除', tone: 'del' }
  if (code.includes('R')) return { label: '重命名', tone: 'edit' }
  return { label: '修改', tone: 'edit' }
}

/**
 * 受保护路径匹配：目录以 / 结尾（或直接写目录名）按前缀匹配，
 * 以 * 结尾按前缀匹配任意文件；返回命中的规则原文，便于提示用户是哪条规则拦下的。
 */
export function blockedBy(path: string, patterns: string[]): string | null {
  const p = String(path || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!p) return null
  for (const raw of patterns) {
    const rule = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!rule) continue
    if (rule.endsWith('*')) {
      if (p.startsWith(rule.slice(0, -1))) return raw
      continue
    }
    const bare = rule.replace(/\/+$/, '')
    if (p === bare || p.startsWith(`${bare}/`)) return raw
  }
  return null
}

/**
 * 验收门禁：退出码必须全 0、验证记录条数达标、不得改动受保护路径。
 * 只判"已知事实"——命令没回传退出码不算通过，也不算失败，会在提示里单独说明。
 */
export function evaluateGate(record: AcceptanceRecord, analysis: AcceptanceAnalysis, gate?: AcceptanceGate): GateViolation[] {
  if (!gate) return []
  const out: GateViolation[] = []
  if (gate.requireExitZero && analysis.failedChecks.length > 0) {
    const list = analysis.failedChecks.slice(0, 3).map((c) => `${c.command}${c.exitCode !== undefined ? `（退出 ${c.exitCode}）` : ''}`)
    out.push({ kind: 'exit', text: `验证未全部通过：${list.join('、')}` })
  }
  if (gate.minChecks > 0 && analysis.checks.length < gate.minChecks) {
    out.push({ kind: 'count', text: `验证记录不足：${analysis.checks.length}/${gate.minChecks} 条` })
  }
  const patterns = [...(gate.forbiddenPaths || []), ...(gate.byProject?.[record.proj] || [])]
  if (patterns.length > 0) {
    const hits = analysis.changed.filter((f) => blockedBy(f.path, patterns))
    if (hits.length > 0) {
      const names = hits.slice(0, 3).map((f) => f.path)
      out.push({ kind: 'path', text: `改动了受保护路径：${names.join('、')}${hits.length > 3 ? ` 等 ${hits.length} 个` : ''}` })
    }
  }
  return out
}

export function analyzeAcceptance(record: AcceptanceRecord): AcceptanceAnalysis {
  const planText = record.plan?.text || ''
  const steps = planSteps(planText)
  const declaredChecks = declaredVerifications(planText)
  const checks = allChecksOf(record)
  const latestChecks = latestChecksOf(checks)
  // 命令是否算"验证命令"由主进程按共享规则判定，这里只消费结果，不再自己匹配
  const checksObserved = latestChecks.map((c) => c.command)
  const failedChecks = latestChecks.filter(checkFailed)
  const followupCount = record.followups?.length || 0
  const changed = changedFilesOf(record)
  const outsidePlan = changed.filter((c) => c.inPlan === false).map((c) => c.path)
  const riskLines = riskLinesOf(record.lastReply || '')
  const hasChanges = changed.length > 0 || (record.summary?.files || 0) > 0
  const unverified: AcceptanceFinding[] = []
  const notes: AcceptanceFinding[] = []

  if (hasChanges && !record.summary) {
    unverified.push({ level: 'warn', text: '没有取得 git 变更清单，改动范围无法核对（非 git 仓库或采集失败）' })
  }
  if (declaredChecks.length > 0 && checksObserved.length === 0) {
    unverified.push({ level: 'warn', text: `计划声明 ${declaredChecks.length} 项验证，本轮没有记录到测试/构建命令` })
  } else if (hasChanges && checksObserved.length === 0) {
    unverified.push({ level: 'warn', text: '本轮有文件改动，但没有记录到测试/构建命令' })
  }
  for (const run of failedChecks.slice(0, 3)) {
    const exit = run.exitCode !== undefined ? `（退出 ${run.exitCode}）` : ''
    unverified.push({ level: 'warn', text: `验证命令失败：${clip(run.command, 80)}${exit}` })
  }
  if (outsidePlan.length > 0) {
    unverified.push({ level: 'warn', text: `计划外改动 ${outsidePlan.length} 个文件：${outsidePlan.slice(0, 4).join('、')}` })
  }
  if (record.summary?.commits) {
    notes.push({ level: 'info', text: `会话期间产生了 ${record.summary.commits} 个提交，已提交的文件也计入清单` })
  }
  if (record.baselineLate) {
    unverified.push({ level: 'warn', text: '岛接上时会话已在运行，基线晚于会话开始，改动清单可能不完整' })
  }
  if (record.plan?.decision === 'deny') {
    if (hasChanges) unverified.push({ level: 'warn', text: '计划被打回后仍产生了文件改动，请确认是否为预期' })
    else notes.push({ level: 'info', text: '计划已打回，本轮没有文件改动' })
  }
  for (const line of riskLines) unverified.push({ level: 'warn', text: `回复：${line}` })

  if (!hasChanges) notes.push({ level: 'info', text: '本轮没有文件改动' })
  const pendingSteps = steps.filter((s) => !s.done)
  if (pendingSteps.length > 0) notes.push({ level: 'info', text: `计划还有 ${pendingSteps.length} 步未勾选完成` })
  if (checks.length > 0) {
    const withExit = checks.filter(checkHasExit).length
    notes.push({ level: 'info', text: `记录到 ${checks.length} 条验证命令（${withExit} 条带退出码；退出 0 也不等于结论正确）` })
  }
  if (followupCount > 0) {
    notes.push({ level: 'info', text: `已补验证 ${followupCount} 次，失败判定只看每条命令的最新一次结果` })
  }

  // 有未验证项时先亮"需核对"，不能被"无改动"盖掉（命令失败但没改文件也要看得见）
  const verdict: AcceptanceAnalysis['verdict'] = unverified.length > 0
    ? 'watch'
    : !hasChanges ? 'nochange' : checks.length > 0 ? 'clean' : 'watch'

  const summaries = [record.summary, ...(record.followups || []).map((f) => f.summary)].filter(Boolean) as NonNullable<AcceptanceRecord['summary']>[]
  const added = summaries.reduce((n, s) => n + s.added, 0)
  const removed = summaries.reduce((n, s) => n + s.removed, 0)
  const stat = summaries.length > 0 ? `${changed.length} 个文件 · +${added}/−${removed}` : `${changed.length} 个文件`
  const headline = hasChanges
    ? `${stat}${checksObserved.length > 0 ? ` · 验证命令 ${checksObserved.length} 条` : ' · 未见验证命令'}`
    : '本轮无文件改动'

  return { steps, declaredChecks, checks, latestChecks, checksObserved, failedChecks, followupCount, changed, outsidePlan, riskLines, unverified, notes, verdict, headline }
}

/** 会话结束 → 留档记录（不含人工处置状态） */
export function archiveFromAgent(a: AgentVM, now = Date.now()): AcceptanceRecord {
  const trim = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)
  return {
    id: a.id,
    backend: a.backend,
    tool: a.tool,
    proj: a.proj,
    cwd: a.cwd,
    startedAt: a.startedAt || now,
    endedAt: now,
    model: a.model,
    termHwnd: a.termHwnd,
    ppid: a.ppid,
    plan: a.plan ? { ...a.plan, text: trim(a.plan.text, 8000) } : undefined,
    baselineLate: a.baselineLate,
    lastReply: a.lastReply ? trim(a.lastReply, 4000) : undefined,
    summary: a.summary,
    checks: a.checks?.slice(-12).map((c) => ({ ...c, outputTail: c.outputTail ? trim(c.outputTail, 400) : undefined })),
    history: a.history,
    status: 'pending'
  }
}

/** 是否值得留档：有项目、且留下了改动/计划/回复之一 */
export function shouldArchive(a: AgentVM): boolean {
  return !!a.proj && !!(a.summary || a.plan || a.lastReply)
}

/**
 * 同一会话再次结束（补验证续跑）→ 把新证据并进原记录，而不是新开一条。
 * Claude `--resume` 与 Codex `exec resume` 都复用同一 session id（已实测），
 * 所以这里按 id 合并；原始轮次的计划与改动保留，新增部分单独挂在 followups 上。
 */
export function mergeFollowup(record: AcceptanceRecord, a: AgentVM, now = Date.now()): AcceptanceRecord {
  const trim = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)
  const entry: AcceptanceFollowup = {
    at: now,
    checks: a.checks?.slice(-12),
    summary: a.summary,
    lastReply: a.lastReply ? trim(a.lastReply, 4000) : undefined
  }
  return {
    ...record,
    endedAt: now,
    lastReply: entry.lastReply || record.lastReply,
    followups: [...(record.followups || []), entry].slice(-6),
    // 有了新证据就要重新核对，人工处置状态回到待核对
    status: 'pending',
    markedAt: undefined,
    gateOverride: undefined
  }
}

const STEP_HEADING = /(步骤|实施|任务|计划|todo)/i
const plain = (text: string): string => text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

/** 计划里可转成待办的条目：优先未勾选的清单，其次"实施步骤"小节的列表 */
export function planTodoTexts(record: AcceptanceRecord): string[] {
  const text = record.plan?.text || ''
  const unchecked = planSteps(text).filter((s) => !s.done).map((s) => plain(s.text))
  if (unchecked.length > 0) return dedupe(unchecked).slice(0, 12)
  const out: string[] = []
  let inSection = false
  for (const line of text.split(/\r?\n/)) {
    const heading = HEADING.exec(line)
    if (heading) { inSection = STEP_HEADING.test(heading[2]); continue }
    if (!inSection) continue
    const item = LIST_ITEM.exec(line)
    if (item) out.push(plain(item[1]))
  }
  return dedupe(out.filter(Boolean)).slice(0, 12)
}

/** 验收凭证：把计划、改动、验证证据与未验证项拼成可归档的 Markdown */
export function buildAcceptanceCertificate(record: AcceptanceRecord, analysis: AcceptanceAnalysis): string {
  const time = new Date(record.endedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
  const statusLabel = record.status === 'accepted' ? '已验收' : record.status === 'followup' ? '待跟进' : '待核对'
  const reqIds = requirementIdsOf(record)
  const lines: string[] = [
    `# 验收记录 · ${record.proj}`,
    '',
    `- 会话：${record.tool}（${record.id}）`,
    `- 时间：${stamp}`,
    `- 结论：${statusLabel} · ${analysis.headline}`,
    ...(analysis.followupCount > 0 ? [`- 补验证：${analysis.followupCount} 次`] : []),
    ...(reqIds.length > 0 ? [`- 需求：${reqIds.join('、')}`] : []),
    ...(record.gateOverride ? [`- 门禁覆盖：${record.gateOverride.violations.join('；')}`] : []),
    ''
  ]
  if (reqIds.length > 0) {
    lines.push('## 需求追溯', '', ...reqIds.map((id) => `- ${id}`), '')
  }
  if (record.plan?.text) {
    lines.push('## 计划', '', record.plan.text.trim(), '')
  }
  lines.push('## 实际改动', '')
  if (analysis.changed.length === 0) lines.push('本轮没有取得文件改动。', '')
  else {
    for (const f of analysis.changed.slice(0, 40)) {
      const tags = [fileStatusLabel(f.status).label, f.inPlan === false ? '计划外' : '', f.followup ? '补验证' : '', f.committed ? '已提交' : ''].filter(Boolean).join(' · ')
      lines.push(`- \`${f.path}\`（${tags}）`)
    }
    if (analysis.changed.length > 40) lines.push(`- …另有 ${analysis.changed.length - 40} 个文件`)
    lines.push('')
  }
  lines.push('## 验证证据', '')
  if (analysis.checks.length === 0) lines.push('没有带结果的命令记录。', '')
  else {
    for (const c of analysis.checks.slice(-12)) {
      const exit = c.exitCode !== undefined ? `退出 ${c.exitCode}` : '未回传退出码'
      const ms = c.ms !== undefined ? ` · ${(c.ms / 1000).toFixed(1)}s` : ''
      lines.push(`- \`${c.command}\` — ${exit}${ms}${c.followup ? '（补验证）' : ''}`)
    }
    lines.push('', '> 退出 0 只代表命令成功，不代表结论正确。', '')
  }
  lines.push('## 未验证项', '')
  if (analysis.unverified.length === 0) lines.push('未发现明示的未验证线索（仍需人工确认）。', '')
  else {
    for (const f of analysis.unverified) lines.push(`- ${f.text}`)
    lines.push('')
  }
  if (record.lastReply) lines.push('## 最后回复', '', record.lastReply.trim(), '')
  return lines.join('\n').trim() + '\n'
}

/** 从记录 id（backend:sessionId）里取可续跑的会话 id；取不到返回空串 */
export function sessionIdOf(record: AcceptanceRecord): string {
  const prefix = `${record.backend}:`
  const raw = record.id.startsWith(prefix) ? record.id.slice(prefix.length) : record.id
  return /^[A-Za-z0-9][A-Za-z0-9._-]{7,}$/.test(raw) ? raw : ''
}

/**
 * 把未验证项整理成发给 Agent 的追问：只要求补验证/必要修复，不扩大改动范围，
 * 并要求逐项给出命令、退出码和关键输出。空数组时返回空串（UI 据此隐藏入口）。
 */
export function buildFollowUpPrompt(record: AcceptanceRecord, analysis: AcceptanceAnalysis): string {
  const items = analysis.unverified.map((f) => f.text.trim()).filter(Boolean)
  if (items.length === 0) return ''
  const bullets = items.slice(0, 6).map((text, i) => `${i + 1}. ${text}`)
  const changed = analysis.changed.slice(0, 4).map((f) => f.path)
  const changedLine = analysis.changed.length > 0
    ? `本轮改动 ${analysis.changed.length} 个文件${changed.length ? `（${changed.join('、')}${analysis.changed.length > changed.length ? ' 等' : ''}）` : ''}`
    : '本轮没有文件改动'
  const checksLine = analysis.checks.length > 0
    ? analysis.checks.slice(-4).map((c) => `${c.command}${c.exitCode !== undefined ? `（退出 ${c.exitCode}）` : '（无退出码）'}`).join('、')
    : '暂无带结果的命令记录'
  const planTitle = (record.plan?.text || '').split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)
  const declared = analysis.declaredChecks.slice(0, 4)

  return [
    '请继续刚才这个会话，把下面的未验证项补齐。只做验证和必要的修复，不要顺手重构或扩大改动范围。',
    '',
    '## 需要补的验证',
    ...bullets,
    ...(declared.length > 0 ? ['', '## 计划里声明的验证方式', ...declared.map((s) => `- ${s}`)] : []),
    '',
    '## 上下文',
    `- ${changedLine}`,
    `- 已记录的命令：${checksLine}`,
    ...(planTitle ? [`- 计划：${clip(planTitle, 80)}`] : []),
    '',
    '## 完成标准',
    '逐项说明：跑了什么命令、退出码是多少、关键输出是什么；确实无法执行的说明原因。不要用"应该没问题"代替实际结果。'
  ].join('\n')
}
