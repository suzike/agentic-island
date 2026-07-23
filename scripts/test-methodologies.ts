import assert from 'node:assert/strict'
import {
  ADVANCE_PROMPTS,
  ANALYSIS_METHOD_GROUPS,
  ANALYSIS_METHODS,
  ANSWER_METHOD_GROUPS,
  ANSWER_METHODS,
  analysisMethodById,
  answerMethodInstruction,
  recommendAnalysisMethods,
  recommendAnswerMethods
} from '../src/renderer/src/logic/methodologies.ts'

assert.ok(ANSWER_METHODS.length >= 15, '发送前回答方法不少于 15 种')
assert.equal(new Set(ANSWER_METHODS.map((method) => method.id)).size, ANSWER_METHODS.length, '回答方法 id 不得重复')
assert.ok(ANSWER_METHOD_GROUPS.every((group) => ANSWER_METHODS.some((method) => method.group === group.id)), '每个回答方法分组必须有内容')
assert.ok(ANSWER_METHODS.every((method) => method.prompt.length > 30 && method.description && method.outcome), '回答方法必须包含提示词、说明和产出')
assert.equal(answerMethodInstruction(), '', '未选择方法时不得注入隐藏指令')
assert.match(answerMethodInstruction('first-principles'), /仅本轮生效/)
assert.match(answerMethodInstruction('first-principles'), /第一性原理/)
assert.equal(recommendAnswerMethods('请比较 React 和 Vue，帮我做技术选型')[0].id, 'decision-matrix')
assert.equal(recommendAnswerMethods('请通俗解释这个算法的工作原理')[0].id, 'feynman')

assert.ok(ANALYSIS_METHODS.length >= 23, '气泡分析方法不少于 23 种')
assert.equal(new Set(ANALYSIS_METHODS.map((method) => method.id)).size, ANALYSIS_METHODS.length, '分析方法 id 不得重复')
assert.ok(ANALYSIS_METHOD_GROUPS.every((group) => ANALYSIS_METHODS.some((method) => method.group === group.id)), '每个分析方法分组必须有内容')
assert.ok(ANALYSIS_METHODS.every((method) => method.prompt.length > 30 && method.framework && method.outcome), '分析方法必须包含方法论、提示词和产出')
assert.deepEqual(Object.keys(ADVANCE_PROMPTS).sort(), ANALYSIS_METHODS.map((method) => method.id).sort(), '模型分析提示词必须与目录同源')
assert.equal(analysisMethodById('fmea').framework, 'Failure Mode and Effects Analysis')
assert.ok(recommendAnalysisMethods('这个 bug 为什么反复出现？', '系统出现异常和失败，需要寻找根因').slice(0, 3).some((method) => method.id === 'five-whys'))
assert.equal(recommendAnalysisMethods('制定上线迁移计划', '准备实施并交付这个项目')[0].id, 'premortem')

console.log(`methodology tests passed: ${ANSWER_METHODS.length} answer methods, ${ANALYSIS_METHODS.length} analysis methods`)
