import assert from 'node:assert/strict'
import { applyMarkdownPowerAction, MARKDOWN_POWER_ACTIONS } from '../src/renderer/src/logic/markdownPower.ts'

const md = '# 标题\n\n## 子标题\n\n- [ ] 任务\n\n[跳转](#不存在)\n'
assert.ok(MARKDOWN_POWER_ACTIONS.length >= 20)
assert.equal(new Set(MARKDOWN_POWER_ACTIONS.map((x) => x.id)).size, MARKDOWN_POWER_ACTIONS.length)
assert.match(applyMarkdownPowerAction('number', md), /^# 1 标题/m)
assert.match(applyMarkdownPowerAction('toc', md), /\[子标题\]\(#子标题\)/)
assert.match(applyMarkdownPowerAction('frontmatter', md, '测试'), /title: "测试"/)
assert.match(applyMarkdownPowerAction('tasks', md), /未完成 · 任务/)
assert.match(applyMarkdownPowerAction('anchors', md), /缺失：`#不存在`/)
assert.match(applyMarkdownPowerAction('task-progress', md), /0\/1 已完成/)
assert.equal(applyMarkdownPowerAction('csv-table', 'a,b\n1,2'), '| a | b |\n| --- | --- |\n| 1 | 2 |')
assert.equal(applyMarkdownPowerAction('punctuation', '第一行  ，测试\n第二行'), '第一行， 测试\n第二行')

console.log(`markdown power tests passed: ${MARKDOWN_POWER_ACTIONS.length} actions`)
