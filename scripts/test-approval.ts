// 审批策略测试：规则匹配纯函数 + agents-store 集成（钩子注入式，与主进程装配一致）。
import assert from 'node:assert/strict'
import type { BridgeEvent } from '../src/shared/protocol.ts'
import { matchApprovalRule, DEFAULT_APPROVAL_POLICY } from '../src/main/approval-policy.ts'
import { setApprovalPolicy, getApprovalPolicy, approvalSessionAllow, clearSessionAllows, approvalAudit, policyAutoDecision } from '../src/main/approval-policy.ts'
import { AgentsStore } from '../src/main/agents-store.ts'

const ok = (cond: unknown, msg: string): void => {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`❌ ${msg}`); process.exit(1) }
}

// ── 匹配器：纯函数 ──
ok(matchApprovalRule({ enabled: false, rules: ['git status'] }, 'git status -sb') === null, '策略未启用时不匹配')
ok(matchApprovalRule({ enabled: true, rules: [] }, 'git status') === null, '无规则时不匹配')
ok(matchApprovalRule({ enabled: true, rules: ['npm test'] }, undefined) === null, '无命令时不匹配')
ok(matchApprovalRule({ enabled: true, rules: ['git status'] }, 'GIT STATUS -sb') !== null, '子串匹配且大小写不敏感')
ok(matchApprovalRule({ enabled: true, rules: [' npm test '] }, 'npm test') === ' npm test '.trim() || matchApprovalRule({ enabled: true, rules: [' npm test '] }, 'npm test') !== null, '规则两端空白被忽略')
ok(matchApprovalRule(DEFAULT_APPROVAL_POLICY, 'anything') === null, '默认策略（关闭）不匹配')

// ── 主进程策略模块：规则 / 会话放行 / 审计 ──
setApprovalPolicy(undefined)
ok(getApprovalPolicy().enabled === false && getApprovalPolicy().rules.length === 0, '非法输入不破坏策略缓存')
setApprovalPolicy({ enabled: true, rules: ['git status', 'npm run test'] })
ok(getApprovalPolicy().enabled === true && getApprovalPolicy().rules.length === 2, '策略设置生效（规则去空白后入缓存）')
clearSessionAllows('a1')
ok(policyAutoDecision('a1', 'git status -sb')?.scope === 'rule', '命中规则 → rule 审计')
// 会话放行：精确命令
approvalSessionAllow('a1', 'npm run build')
const auditLenBefore = approvalAudit().length
ok(policyAutoDecision('a1', 'npm run build')?.scope === 'session', '本会话放行 → session 审计')
ok(approvalAudit().length === auditLenBefore + 1, '审计流水追加')
ok(policyAutoDecision('a1', 'npm run build --silent') === null, '会话放行是精确匹配，不外溢')
clearSessionAllows('a1')
ok(policyAutoDecision('a1', 'npm run build') === null, '清理会话放行后，未配置规则的命令不再自动放行')

// ── agents-store 集成：钩子注入式自动放行 ──
const ev = (over: Partial<BridgeEvent>): BridgeEvent => ({
  token: '', backend: 'claude-code', kind: 'permission', sessionId: 's1', cwd: 'C:\\work',
  ...over
} as BridgeEvent)

// 1) 未注入钩子：照常阻塞审批
{
  const store = new AgentsStore()
  const p = store.handlePermission(ev({ command: 'git status' }))
  let settled = false
  void p.then(() => { settled = true })
  await new Promise((r) => setTimeout(r, 50))
  ok(!settled && store.snapshot().agents[0]?.status === 'needs_approval', '无钩子：正常阻塞并出现待审批卡')
  store.decide(store.snapshot().agents[0].requestId!, 'allow')
  await p
}

// 2) 注入钩子：命中规则不阻塞、直接 allow，卡片提示策略放行
setApprovalPolicy({ enabled: true, rules: ['git status'] })
clearSessionAllows('claude-code:s1')
{
  const store = new AgentsStore()
  store.setPolicyHooks({ autoDecision: policyAutoDecision, onSessionEnd: clearSessionAllows })
  const r = await store.handlePermission(ev({ command: 'git status -sb' }))
  ok(r.decision === 'allow', '命中规则：handlePermission 立即放行')
  const agent = store.snapshot().agents.find((a) => a.id === 'claude-code:s1')
  ok(agent?.status === 'running' && (agent?.detail || '').includes('已按策略自动放行'), '卡片显示策略放行提示')
  ok(!agent?.requestId, '策略放行不产生待审批 requestId')

  // 3) 会话放行流程：先阻塞 → 会话放行 + 裁决 → 同命令再次到来不再阻塞
  clearSessionAllows('claude-code:s1')
  const p2 = store.handlePermission(ev({ command: 'npm run build', detail: '构建' }))
  const card = store.snapshot().agents.find((a) => a.id === 'claude-code:s1')
  ok(card?.status === 'needs_approval' && card.requestId, '未命中：阻塞等待裁决')
  approvalSessionAllow('claude-code:s1', 'npm run build')
  store.decide(card!.requestId!, 'allow')
  await p2
  const r3 = await store.handlePermission(ev({ command: 'npm run build' }))
  ok(r3.decision === 'allow', '同会话相同命令第二次自动放行')

  // 4) 会话结束清理：结束后同命令重新阻塞
  store.handleEnd(ev({ kind: 'end' }))
  const p4 = store.handlePermission(ev({ command: 'npm run build' }))
  let settled4 = false
  void p4.then(() => { settled4 = true })
  await new Promise((r) => setTimeout(r, 50))
  ok(!settled4 && store.snapshot().agents[0]?.status === 'needs_approval', '会话结束：临时放行被清理，重新阻塞')
  store.decide(store.snapshot().agents[0].requestId!, 'allow')
  await p4
}

console.log('approval policy tests passed')
// 显式退出：AgentsStore 的常驻句柄在 Windows 上偶发触发 libuv 退出断言（同 test-loop 的先例）
process.exit(0)
