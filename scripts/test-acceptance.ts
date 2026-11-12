// 验收台纯逻辑单测：计划项/验证声明/执行证据/计划外改动/未验证线索。
// 运行：node --experimental-strip-types scripts/test-acceptance.ts

import {
  analyzeAcceptance, archiveFromAgent, buildFollowUpPrompt, changedFilesOf, declaredVerifications,
  fileStatusLabel, observedChecks, planSteps, riskLinesOf, sessionIdOf, shouldArchive
} from '../src/renderer/src/logic/acceptance.ts'
import type { AcceptanceRecord, AgentVM } from '../src/renderer/src/types.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

const base = (patch: Partial<AcceptanceRecord> = {}): AcceptanceRecord => ({
  id: 'claude-code:s1', backend: 'claude-code', tool: 'Claude Code CLI', proj: 'demo',
  startedAt: 1000, endedAt: 2000, status: 'pending', ...patch
})

const planText = `## 目标
给网关加限流。

## 实施步骤
- [x] 加令牌桶中间件 \`src/mw/limit.ts\`
- [ ] 分级策略
- [ ] 补单元测试

## 验证方式
- 单测：桶耗尽/补充/并发抢占
- 压测：k6 200rps 突发

## 风险
- Redis 故障降级本地桶`

// 1. 计划勾选清单
const steps = planSteps(planText)
ok(steps.length === 3 && steps[0].done && !steps[1].done, '勾选清单解析（含已完成）')
ok(planSteps('没有清单') .length === 0, '无清单返回空')

// 2. 验证小节
const declared = declaredVerifications(planText)
ok(declared.length === 2 && declared[0].includes('桶耗尽'), '验证小节条目提取')
ok(!declared.some((d) => d.includes('Redis')), '风险小节不计入验证项')
ok(declaredVerifications('步骤\n- 调用 npm test 跑一遍\n- 写代码').length === 1, '无小节时只认含验证关键词的条目')

// 3. 执行证据只认真实命令
ok(observedChecks([{ ts: 1, text: '运行命令：npm test' }]).length === 1, '记录到 npm test')
ok(observedChecks([{ ts: 1, text: '运行命令：ls -la' }]).length === 0, '非测试命令不算证据')
ok(observedChecks([{ ts: 1, text: '对话中 · 正在处理你的消息…' }]).length === 0, '普通状态不算证据')

// 4. 计划外改动判定
const record = base({
  plan: { text: planText, at: 900, decision: 'allow' },
  summary: {
    files: 3, added: 42, removed: 7, commit: 'chore: x',
    paths: [
      { path: 'src/mw/limit.ts', status: 'M' },
      { path: 'src/core/router.ts', status: 'M' },
      { path: 'docs/rate-limit.md', status: '??' }
    ]
  },
  history: [{ ts: 1500, text: '运行命令：npm test' }],
  lastReply: '已完成限流中间件。\n- 已验证单测与压测\n- 压力测试尚未覆盖 429 恢复时间'
})
const files = changedFilesOf(record)
ok(files.length === 3 && files[0].inPlan === true, '计划内文件可识别')
ok(files[1].inPlan === false && files[2].inPlan === false, '计划外文件可识别')
ok(fileStatusLabel('??').label === '新增' && fileStatusLabel('M').label === '修改' && fileStatusLabel('D').label === '删除', '状态码映射')

// 5. 未验证线索（排除已验证陈述）
const risks = riskLinesOf(record.lastReply || '')
ok(risks.length === 1 && risks[0].includes('尚未覆盖'), '只留未验证线索，过滤已确认项')
ok(riskLinesOf('已验证，测试通过').length === 0, '全通过时无风险行')

// 6. 整体结论：有验证命令 + 计划外改动 → watch
const a1 = analyzeAcceptance(record)
ok(a1.checksObserved.length === 1, '命令进结论')
ok(a1.outsidePlan.length === 2, '计划外改动进结论')
ok(a1.verdict === 'watch', '存在未验证项时判 watch')
ok(a1.unverified.some((f) => f.text.includes('计划外改动')), '未验证项含计划外改动')
ok(a1.unverified.some((f) => f.text.includes('尚未覆盖')), '未验证项含回复线索')
ok(a1.headline.includes('3 个文件') && a1.headline.includes('+42/−7'), '标题带真实变更统计')

// 7. 计划声明了验证但一条命令都没跑
const a2 = analyzeAcceptance(base({ plan: { text: planText, at: 900 }, summary: record.summary }))
ok(a2.unverified.some((f) => f.text.includes('计划声明 2 项验证')), '计划验证项未执行会点名')
ok(a2.verdict === 'watch', '无执行证据判 watch')

// 8. 干净一轮：改动都在计划内 + 有带退出码的验证记录
const clean = analyzeAcceptance(base({
  plan: { text: planText, at: 900, decision: 'allow' },
  summary: { files: 1, added: 9, removed: 0, commit: 'x', paths: [{ path: 'src/mw/limit.ts', status: 'A' }] },
  checks: [{ command: 'npm test', at: 100, exitCode: 0, ms: 8200, ok: true }],
  lastReply: '已完成，单测通过。'
}))
ok(clean.verdict === 'clean' && clean.unverified.length === 0, '计划内改动 + 退出码证据判 clean')
ok(clean.notes.some((n) => n.text.includes('不等于结论正确')), '备注明确"退出 0 ≠ 结论正确"')
ok(clean.checks.length === 1 && clean.checksObserved[0] === 'npm test', '验证记录进入结论')

// 8b. 验证命令失败：直接进未验证项
const failedRun = analyzeAcceptance(base({
  plan: { text: planText, at: 900, decision: 'allow' },
  summary: { files: 1, added: 9, removed: 0, commit: 'x', paths: [{ path: 'src/mw/limit.ts', status: 'A' }] },
  checks: [
    { command: 'npm test', at: 100, exitCode: 0, ms: 8200, ok: true },
    { command: 'npm run build', at: 200, exitCode: 2, ms: 3100, ok: false, outputTail: 'error TS2339' }
  ]
}))
ok(failedRun.failedChecks.length === 1, '非零退出码记为失败')
ok(failedRun.unverified.some((f) => f.text.includes('验证命令失败') && f.text.includes('退出 2')), '失败命令点名退出码')
ok(failedRun.verdict === 'watch', '有失败命令判 watch')

// 8c. 只有活动轨迹命令、没有结果记录：不能算 clean
const historyOnly = analyzeAcceptance(base({
  summary: { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'src/mw/limit.ts', status: 'M' }] },
  history: [{ ts: 1, text: '运行命令：npm test' }]
}))
ok(historyOnly.verdict === 'watch', '无结果记录时判 watch')
ok(historyOnly.notes.some((n) => n.text.includes('不含退出码')), '备注说明轨迹命令不含退出码')

// 9. 计划被打回后仍有改动
const denied = analyzeAcceptance(base({
  plan: { text: planText, at: 900, decision: 'deny' },
  summary: { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'src/mw/limit.ts', status: 'M' }] }
}))
ok(denied.unverified.some((f) => f.text.includes('计划被打回后仍产生')), '打回后仍有改动会警示')

// 10. 无改动
ok(analyzeAcceptance(base({ lastReply: '只是回答问题，没有改文件。' })).verdict === 'nochange', '无改判 nochange')

// 10b. 未验证项 → 追问：只补验证、不扩大范围，逐项要结果
const follow = buildFollowUpPrompt(record, a1)
ok(follow.includes('## 需要补的验证') && follow.includes('计划外改动'), '追问包含未验证项')
ok(follow.includes('## 完成标准') && follow.includes('退出码'), '追问要求逐项给出退出码与输出')
ok(follow.includes('不要顺手重构'), '追问限定改动范围')
ok(follow.includes('单测：桶耗尽') || follow.includes('压测'), '追问带上计划声明的验证方式')
ok(buildFollowUpPrompt(base({ lastReply: '没有改动' }), analyzeAcceptance(base({ lastReply: '没有改动' }))) === '', '没有未验证项时不生成追问')

// 10c. 会话 id：只接受可安全续跑的 id，路径兜底值不能被当成 id
ok(sessionIdOf(base({ id: 'claude-code:695e6c8e-6efa-4ad9-99f4-bbed0c1f695a' })) === '695e6c8e-6efa-4ad9-99f4-bbed0c1f695a', '从记录 id 取出会话 id')
ok(sessionIdOf(base({ id: 'claude-code:C:\\work\\proj' })) === '', '路径兜底的 id 不可续跑')

// 11. 留档条件
const agent = { id: 'codex:s2', backend: 'codex', tool: 'Codex', proj: 'demo', status: 'running', detail: '', updatedAt: 1, startedAt: 5, lastReply: 'done' } as AgentVM
ok(shouldArchive(agent), '有回复即可留档')
ok(!shouldArchive({ ...agent, proj: '' }), '无项目不留档')
const archived = archiveFromAgent(agent, 9999)
ok(archived.endedAt === 9999 && archived.status === 'pending' && archived.startedAt === 5, '留档字段完整')

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n验收台逻辑全部通过')
