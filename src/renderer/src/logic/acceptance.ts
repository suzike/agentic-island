// 验收台纯逻辑：把一次会话的留档（计划 / 实际改动 / 回复 / 活动轨迹）拆成可核对的三段事实。
// 不调用模型、不访问文件系统——所有结论都是本地可复现的推导，供 scripts/test-acceptance.ts 直接加载。

import type { CommandRun } from '../../../shared/protocol'
import type { AcceptanceRecord, AgentVM } from '../types'

export interface PlanStep {
  text: string
  done: boolean
}

export interface ChangedFile {
  path: string
  status: string
  /** 计划里是否提到过该文件；无计划时为 null（不评判） */
  inPlan: boolean | null
}

export interface AcceptanceFinding {
  level: 'warn' | 'info'
  text: string
}

export interface AcceptanceAnalysis {
  steps: PlanStep[]
  /** 计划里声明的验证项（"验证方式/测试/验收"小节） */
  declaredChecks: string[]
  /** 有真实结果记录的验证命令（退出码/耗时可能缺失） */
  checks: CommandRun[]
  /** 命令文本：来自 checks；旧记录回退到活动轨迹（不含退出码） */
  checksObserved: string[]
  /** 明确失败的验证命令 */
  failedChecks: CommandRun[]
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
// 只把"真的执行过"的命令算作证据；出现在回复里的"建议先跑测试"不算
const CHECK_CMD = /(npm (?:run )?(?:test|build)|pnpm (?:test|build)|yarn (?:test|build)|vitest|jest|pytest|playwright|go test|cargo (?:test|build)|tsc\b|typecheck|eslint|lint|audit:)/i
const RISK = /(未验证|未测试|未跑|没跑|未运行|没运行|无法验证|未能验证|未做验证|待验证|待确认|待核实|暂未|尚未|未覆盖|没有测试|无测试|TODO|FIXME|假设)/
const VERIFIED = /(已验证|已测试|测试通过|构建通过|已运行|验证通过|全部通过)/

const dedupe = (list: string[]): string[] => [...new Set(list)]
const clip = (text: string, max = 140): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

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

/** 活动轨迹里真实执行过的测试/构建命令 */
export function observedChecks(history: AcceptanceRecord['history']): string[] {
  return dedupe((history || [])
    .map((h) => h.text)
    .filter((text) => CHECK_CMD.test(text) && /运行命令|命令[:：]/.test(text))
    .map((text) => text.replace(/^.*?运行命令[:：]\s*/, '').trim())
    .filter(Boolean)).slice(0, 6)
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

/** 变更文件 + 是否在计划里被提到 */
export function changedFilesOf(record: AcceptanceRecord): ChangedFile[] {
  const planText = record.plan?.text || ''
  const judge = planText.trim().length > 0
  return (record.summary?.paths || []).map((item) => {
    const base = item.path.split('/').pop() || item.path
    const mentioned = judge && (planText.includes(item.path) || (base.length >= 4 && planText.includes(base)))
    return { path: item.path, status: item.status, inPlan: judge ? mentioned : null }
  })
}

/** 文件状态码 → 展示标签（porcelain 的 XY 两位码） */
export function fileStatusLabel(code: string): { label: string; tone: 'add' | 'del' | 'edit' } {
  if (code === '??' || code.includes('A')) return { label: '新增', tone: 'add' }
  if (code.includes('D')) return { label: '删除', tone: 'del' }
  if (code.includes('R')) return { label: '重命名', tone: 'edit' }
  return { label: '修改', tone: 'edit' }
}

export function analyzeAcceptance(record: AcceptanceRecord): AcceptanceAnalysis {
  const planText = record.plan?.text || ''
  const steps = planSteps(planText)
  const declaredChecks = declaredVerifications(planText)
  const checks = record.checks || []
  const historyChecks = observedChecks(record.history)
  const checksObserved = checks.length > 0 ? checks.map((c) => c.command) : historyChecks
  const failedChecks = checks.filter(checkFailed)
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
    notes.push({ level: 'info', text: `会话期间产生了 ${record.summary.commits} 个提交，改动清单只覆盖工作区` })
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
  } else if (historyChecks.length > 0) {
    notes.push({ level: 'info', text: `活动轨迹里有 ${historyChecks.length} 条命令，但没有结果记录（不含退出码）` })
  }

  // 有未验证项时先亮"需核对"，不能被"无改动"盖掉（命令失败但没改文件也要看得见）
  const verdict: AcceptanceAnalysis['verdict'] = unverified.length > 0
    ? 'watch'
    : !hasChanges ? 'nochange' : checks.length > 0 ? 'clean' : 'watch'

  const files = record.summary?.files ?? changed.length
  const stat = record.summary ? `${files} 个文件 · +${record.summary.added}/−${record.summary.removed}` : `${files} 个文件`
  const headline = hasChanges
    ? `${stat}${checksObserved.length > 0 ? ` · 验证命令 ${checksObserved.length} 条` : ' · 未见验证命令'}`
    : '本轮无文件改动'

  return { steps, declaredChecks, checks, checksObserved, failedChecks, changed, outsidePlan, riskLines, unverified, notes, verdict, headline }
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
