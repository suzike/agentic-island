// 验收台纯逻辑单测：计划项/验证声明/执行证据/计划外改动/未验证线索。
// 运行：node --experimental-strip-types scripts/test-acceptance.ts

import {
  allChecksOf, analyzeAcceptance, archiveFromAgent, blockedBy, buildAcceptanceCertificate, buildFollowUpPrompt,
  changedFilesOf, compactAcceptance, declaredVerifications, evaluateGate, fileStatusLabel, latestChecksOf,
  mergeFollowup, planPathHints, planSteps, planTodoTexts, requirementIdsIn, requirementIdsOf, riskLinesOf,
  searchTextOf, sessionIdOf, shouldArchive
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

// 3. 计划外改动判定
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
  checks: [{ command: 'npm test', at: 1500, exitCode: 0, ms: 5000, ok: true }],
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

// 8c. 没有结果记录（只有活动轨迹）时不能算 clean
const historyOnly = analyzeAcceptance(base({
  summary: { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'src/mw/limit.ts', status: 'M' }] },
  history: [{ ts: 1, text: '运行命令：npm test' }]
}))
ok(historyOnly.verdict === 'watch', '无结果记录时判 watch')
ok(historyOnly.unverified.some((f) => f.text.includes('没有记录到测试/构建命令')), '无结果记录时未验证项点名')

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

// 10d. 补验证：同一会话再次结束时合并证据，失败判定只看最新一次结果
const original = base({
  status: 'accepted',
  plan: { text: planText, at: 900, decision: 'allow' },
  summary: { files: 1, added: 2, removed: 1, commit: 'x', paths: [{ path: 'src/mw/limit.ts', status: 'M' }] },
  checks: [{ command: 'npm test', at: 1500, exitCode: 1, outputTail: 'failed' }]
})
const merged = mergeFollowup(original, {
  id: 'claude-code:s1', backend: 'claude-code', tool: 'Claude Code CLI', proj: 'demo',
  status: 'running', detail: '', updatedAt: 1, startedAt: 5,
  checks: [{ command: 'npm test', at: 3000, exitCode: 0 }],
  summary: { files: 1, added: 3, removed: 0, commit: 'y', paths: [{ path: 'src/mw/limit.ts', status: 'M' }] }
} as AgentVM, 4000)
ok(merged.status === 'pending' && merged.markedAt === undefined, '补验证后回到待核对')
ok(merged.followups?.length === 1, '补验证增量留在 followups')
const mergedChecks = latestChecksOf(allChecksOf(merged))
ok(mergedChecks.length === 1 && mergedChecks[0].exitCode === 0, '同一命令只保留最新一次结果（旧失败被覆盖）')
ok(changedFilesOf(merged).some((f) => f.followup), '补验证改动会标记来源')
const cert = buildAcceptanceCertificate(merged, analyzeAcceptance(merged))
ok(cert.includes('补验证：1 次') && cert.includes('退出 0'), '验收凭证包含补验证次数与最新结果')
ok(planTodoTexts(merged).length === 2 && planTodoTexts(merged)[0].includes('分级策略'), '计划未勾选步骤可转待办')

// 11. 留档条件
const agent = { id: 'codex:s2', backend: 'codex', tool: 'Codex', proj: 'demo', status: 'running', detail: '', updatedAt: 1, startedAt: 5, lastReply: 'done' } as AgentVM
ok(shouldArchive(agent), '有回复即可留档')
ok(!shouldArchive({ ...agent, proj: '' }), '无项目不留档')
const archived = archiveFromAgent(agent, 9999)
ok(archived.endedAt === 9999 && archived.status === 'pending' && archived.startedAt === 5, '留档字段完整')

// 12. 基线晚于会话开始：如实提示清单可能不完整
const late = analyzeAcceptance(base({ baselineLate: true, lastReply: '做完了' }))
ok(late.unverified.some((f) => f.text.includes('基线晚于会话开始')), '附着到已在跑的会话会提示清单可能不完整')
ok(archiveFromAgent({ ...agent, baselineLate: true } as AgentVM).baselineLate === true, '基线偏晚标记随留档保存')

// 13. 会话期间已提交的改动
const committedRecord = base({
  summary: { files: 1, added: 2, removed: 0, commit: 'x', commits: 1, paths: [{ path: 'src/a.ts', status: 'M', committed: true }] },
  checks: [{ command: 'npm test', at: 10, exitCode: 0, ms: 900, ok: true }]
})
const committedAnalysis = analyzeAcceptance(committedRecord)
ok(committedAnalysis.changed[0].committed === true, '已提交文件带标记')
ok(committedAnalysis.notes.some((n) => n.text.includes('已提交的文件也计入清单')), '提交说明改为已计入清单')
ok(buildAcceptanceCertificate(committedRecord, committedAnalysis).includes('已提交'), '凭证标注已提交')

// 14. 受保护路径匹配
ok(blockedBy('model/plant.slx', ['model/']) === 'model/', '目录前缀命中')
ok(blockedBy('model/plant.slx', ['model']) === 'model', '不带斜杠的目录也按前缀')
ok(blockedBy('src/generated/api.ts', ['src/generated*']) === 'src/generated*', '通配前缀命中')
ok(blockedBy('src\\generated\\api.ts', ['src/generated/']) === 'src/generated/', '反斜杠路径也能匹配')
ok(blockedBy('src/app.ts', ['model/']) === null, '无关文件不命中')
ok(blockedBy('src/modeling/app.ts', ['model/']) === null, '不误伤同名片段')

// 15. 门禁判定
const gateBase = { requireExitZero: true, minChecks: 0, forbiddenPaths: [] as string[] }
const gateSummary = { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'src/a.ts', status: 'M' }] }
const failedRecord = base({ checks: [{ command: 'npm run build', at: 1, exitCode: 1, ok: false }], summary: gateSummary })
const failedAnalysis = analyzeAcceptance(failedRecord)
ok(evaluateGate(failedRecord, failedAnalysis, gateBase).some((v) => v.kind === 'exit'), '非零退出码触发门禁')
ok(evaluateGate(committedRecord, committedAnalysis, gateBase).length === 0, '全部退出 0 时门禁通过')

const quietRecord = base({ lastReply: '只聊了聊' })
const quietAnalysis = analyzeAcceptance(quietRecord)
ok(evaluateGate(quietRecord, quietAnalysis, { ...gateBase, requireExitZero: false, minChecks: 2 }).some((v) => v.kind === 'count'), '验证条数不足触发门禁')
ok(evaluateGate(quietRecord, quietAnalysis, { ...gateBase, requireExitZero: false }).length === 0, '门禁关闭且无条数要求时通过')

const pathRecord = base({ summary: { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'model/plant.slx', status: 'M' }] } })
const pathAnalysis = analyzeAcceptance(pathRecord)
ok(evaluateGate(pathRecord, pathAnalysis, { ...gateBase, requireExitZero: false, forbiddenPaths: ['model/'] }).some((v) => v.kind === 'path'), '全局受保护路径命中')
ok(evaluateGate({ ...pathRecord, proj: 'TMS' }, pathAnalysis, { ...gateBase, requireExitZero: false, byProject: { TMS: ['model/'] } }).some((v) => v.kind === 'path'), '项目受保护路径命中')
ok(evaluateGate({ ...pathRecord, proj: 'Other' }, pathAnalysis, { ...gateBase, requireExitZero: false, byProject: { TMS: ['model/'] } }).length === 0, '项目规则不串项目')
ok(evaluateGate(pathRecord, pathAnalysis, undefined).length === 0, '未配置门禁时不拦截')

// 16. 门禁覆盖留痕会在补验证后清空
const overridden = { ...record, status: 'accepted' as const, gateOverride: { at: 1, violations: ['v'] } }
ok(mergeFollowup(overridden, agent).gateOverride === undefined, '新证据到达后清除门禁覆盖留痕')

// 17. 计划外改动的路径级判定
const hints = planPathHints('在 src/mw/ 下加中间件，改 `config/ratelimit.yaml`，顺带更新 README.md')
ok(hints.dirs.includes('src/mw'), '计划里的目录被识别')
ok(hints.files.includes('config/ratelimit.yaml') && hints.files.includes('README.md'), '计划里的文件路径与裸文件名被识别')

const pathRecord2 = base({
  plan: { text: '在 src/mw/ 下加中间件，更新 router.ts', at: 1 },
  summary: {
    files: 3, added: 1, removed: 0, commit: 'x',
    paths: [
      { path: 'src/mw/a.ts', status: 'A' },
      { path: 'src/core/router.ts', status: 'M' },
      { path: 'src/other/x.ts', status: 'M' }
    ]
  }
})
const pathFiles = changedFilesOf(pathRecord2)
ok(pathFiles[0].inPlan === true, '计划提到的目录下的文件算计划内')
ok(pathFiles[1].inPlan === true, '计划里只写文件名时按同名匹配')
ok(pathFiles[2].inPlan === false, '计划没提到的路径算计划外')

const sameName = base({ plan: { text: '修改 src/mw/limit.ts', at: 1 }, summary: { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'other/limit.ts', status: 'M' }] } })
ok(changedFilesOf(sameName)[0].inPlan === false, '同名但路径不同不算计划内（路径级判定）')

// 18. 需求编号回链
ok(requirementIdsIn('按 SWR-123 与 SRS_45 实现，SourceID: TM-889').length === 3, '需求前缀与 SourceID 标注都能抽出来')
ok(requirementIdsIn('升级到 UTF-8，兼容 ISO-26262').length === 0, '标准号/编码不会被当成需求')
ok(requirementIdsIn('见 SRS-45_impl.ts').join(',') === 'SRS-45', '路径里的需求号只取编号本身')

const reqRecord = base({
  plan: { text: '实现 SWR-123', at: 1 },
  summary: { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'src/SRS-45_impl.ts', status: 'A' }] },
  lastReply: 'REQ-9 也一并完成'
})
const reqIds = requirementIdsOf(reqRecord)
ok(reqIds.includes('SWR-123') && reqIds.includes('SRS-45') && reqIds.includes('REQ-9'), '记录级需求编号覆盖计划/路径/回复')
ok(buildAcceptanceCertificate(reqRecord, analyzeAcceptance(reqRecord)).includes('## 需求追溯'), '凭证包含需求追溯小节')

// 19. 搜索文本（组件按记录缓存它，避免每次按键重建全文）
const searchRec = base({
  plan: { text: '实现 SWR-123 限流', at: 1 },
  summary: { files: 1, added: 1, removed: 0, commit: 'x', paths: [{ path: 'src/mw/limit.ts', status: 'M' }] },
  checks: [{ command: 'matlab -batch "runtests"', at: 1, exitCode: 0 }],
  lastReply: '完成 ROUTER 调整',
  followups: [{
    at: 2,
    checks: [{ command: 'ctest --output-on-failure', at: 2, exitCode: 0 }],
    summary: { files: 1, added: 1, removed: 0, commit: 'y', paths: [{ path: 'tests/a.cpp', status: 'A' }] },
    lastReply: '补了 TEST'
  }]
})
const searchText = searchTextOf(searchRec)
ok(
  searchText.includes('swr-123') && searchText.includes('src/mw/limit.ts') && searchText.includes('matlab') &&
  searchText.includes('ctest') && searchText.includes('router') && searchText.includes('tests/a.cpp') && searchText.includes('补了 test'),
  '搜索文本覆盖计划/路径/命令/回复/补验证'
)

// 20. 持久化压缩：最近记录保留全文，旧的截短
const bulky = Array.from({ length: 15 }, (_, i) => base({
  id: `bulk-${i}`,
  plan: { text: 'p'.repeat(5000), at: 1 },
  lastReply: 'r'.repeat(3000),
  checks: [{ command: 'npm test', at: 1, exitCode: 0, outputTail: 'o'.repeat(500) }]
}))
const compacted = compactAcceptance(bulky, 10, 40)
ok(compacted.length === 15, '压缩不丢记录')
ok(compacted[0].plan?.text.length === 5000, '最近 10 条保留全文')
ok((compacted[10].plan?.text.length || 0) === 1501, '更早的记录计划被截短')
ok((compacted[10].lastReply?.length || 0) === 801 && (compacted[10].checks?.[0].outputTail?.length || 0) === 161, '回复与输出尾部一并截短')
ok(compactAcceptance(bulky, 10, 12).length === 12, '总数上限生效')

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n验收台逻辑全部通过')
