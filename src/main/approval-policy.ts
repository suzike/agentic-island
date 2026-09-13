// 审批策略（主进程权威缓存）：用户自定义放行规则 + 本会话放行命令 + 自动放行审计流水。
// 纯逻辑、不 import electron —— 可被 raw-node 测试直跑；审计推送经 sink 注入（index.ts 接 safeSend）。
// 强制点在 agents-store（经 PolicyHooks 注入）：命中即不阻塞、直接 allow 并记审计。
// 注意：本模块对 src 内只做 type 导入（值导入必须无扩展名会破坏 raw-node 直跑——项目约定）。

import type { ApprovalAuditEntry, ApprovalPolicy } from '../shared/protocol'

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = { enabled: false, rules: [] }

/** 返回命中的放行规则原文；未启用/无命令/无命中返回 null。子串匹配、大小写不敏感。 */
export function matchApprovalRule(policy: ApprovalPolicy, command?: string): string | null {
  if (!policy?.enabled || !command) return null
  const cmd = command.toLowerCase()
  if (!cmd) return null
  for (const rule of policy.rules) {
    const r = String(rule || '').trim().toLowerCase()
    if (r && cmd.includes(r)) return rule
  }
  return null
}

const AUDIT_MAX = 100

let policy: ApprovalPolicy = { ...DEFAULT_APPROVAL_POLICY }
const sessionAllows = new Map<string, Set<string>>()
const audit: ApprovalAuditEntry[] = []
let auditSink: ((entry: ApprovalAuditEntry) => void) | null = null

/** 渲染层随 save-state 推送全量策略（启用开关 + 规则列表） */
export function setApprovalPolicy(next: Partial<ApprovalPolicy> | undefined): void {
  if (!next || typeof next !== 'object') return
  const rules = Array.isArray(next.rules)
    ? next.rules.map((r) => String(r || '').trim()).filter(Boolean).slice(0, 100)
    : []
  policy = { enabled: next.enabled === true, rules }
}

export function getApprovalPolicy(): ApprovalPolicy {
  return { ...policy, rules: [...policy.rules] }
}

/** 卡片「本会话放行」：同一 Agent 会话内完全相同的命令后续不再询问 */
export function approvalSessionAllow(agentId: string, command: string): void {
  const cmd = String(command || '')
  if (!agentId || !cmd) return
  const set = sessionAllows.get(agentId) || new Set<string>()
  set.add(cmd)
  sessionAllows.set(agentId, set)
}

/** 会话结束清理其临时放行 */
export function clearSessionAllows(agentId: string): void {
  sessionAllows.delete(agentId)
}

export function setApprovalAuditSink(cb: (entry: ApprovalAuditEntry) => void): void {
  auditSink = cb
}

export function approvalAudit(): ApprovalAuditEntry[] {
  return audit.map((e) => ({ ...e }))
}

/**
 * 阻塞审批前询问：命中「本会话放行」或「策略规则」则返回审计记录（调用方据此直接 allow），
 * 否则返回 null 走正常阻塞审批。命中即记审计并推送。
 */
export function policyAutoDecision(agentId: string, command?: string): ApprovalAuditEntry | null {
  if (!command) return null
  const sessionHit = sessionAllows.get(agentId)?.has(command)
  if (sessionHit) return record({ ts: Date.now(), command, rule: command, scope: 'session' })
  const rule = matchApprovalRule(policy, command)
  if (rule) return record({ ts: Date.now(), command, rule, scope: 'rule' })
  return null
}

function record(entry: ApprovalAuditEntry): ApprovalAuditEntry {
  audit.unshift(entry)
  if (audit.length > AUDIT_MAX) audit.length = AUDIT_MAX
  try { auditSink?.(entry) } catch { /* 推送失败不影响放行 */ }
  return entry
}
