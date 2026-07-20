import assert from 'node:assert/strict'
import { ambientTextWindow, buildAmbientSlots, buildAmbientTextDeck, clampBarRotation, deriveAmbientStatus } from '../src/renderer/src/logic/ambientBar.ts'

assert.deepEqual(deriveAmbientStatus({ pending: 0, waiting: 0, dueTodos: 0, runningAgents: 0 }), {
  kind: 'idle', label: '工作台就绪', detail: '暂无待处理事项', count: 0, urgent: false, target: null
})

assert.equal(deriveAmbientStatus({ pending: 2, waiting: 1, dueTodos: 3, runningAgents: 4, project: 'Vibe-Island' }).kind, 'approval')
assert.equal(deriveAmbientStatus({ pending: 0, waiting: 1, dueTodos: 3, runningAgents: 4 }).kind, 'waiting')
assert.equal(deriveAmbientStatus({ pending: 0, waiting: 0, dueTodos: 3, runningAgents: 4 }).target, 'todos')
assert.equal(deriveAmbientStatus({ pending: 2, waiting: 1, dueTodos: 0, runningAgents: 4, focusLabel: '24:18' }).detail, '24:18 · 3 项暂存')
assert.equal(deriveAmbientStatus({ pending: 1, waiting: 0, dueTodos: 0, runningAgents: 1, dnd: true }).kind, 'quiet')
assert.equal(clampBarRotation(2), 6)
assert.equal(clampBarRotation(40), 30)
assert.equal(clampBarRotation(undefined), 12)
assert.deepEqual(buildAmbientSlots(['quotes', 'flow', 'pet'], true), ['quotes', 'flow', 'pet'])
assert.deepEqual(buildAmbientSlots(['quotes', 'flow', 'pet'], false), ['quotes', 'flow'])
assert.deepEqual(buildAmbientSlots(['pet'], false), ['pet'])

const deck = buildAmbientTextDeck(
  ['quotes', 'agent', 'flow'],
  { quotes: ['名言 1', '名言 2', '名言 3'], agent: ['Agent 1', 'Agent 2'] },
  ['工作简报']
)
assert.deepEqual(deck.map((item) => `${item.mode}:${item.text}`), [
  'quotes:名言 1', 'agent:Agent 1', 'quotes:名言 2', 'agent:Agent 2', 'quotes:名言 3'
])
assert.deepEqual(ambientTextWindow(deck, 0, 2).map((item) => item.text), ['名言 1', 'Agent 1'])
assert.deepEqual(ambientTextWindow(deck, 1, 2).map((item) => item.text), ['名言 2', 'Agent 2'])
assert.deepEqual(ambientTextWindow(deck, 2, 2).map((item) => item.text), ['名言 3', '名言 1'])
assert.deepEqual(buildAmbientTextDeck(['flow', 'eq'], { quotes: ['离线名言'] }, ['今日 2 项待办']).map((item) => item.text), ['今日 2 项待办'])
assert.deepEqual(buildAmbientTextDeck(['flow'], { quotes: ['离线名言'] }, []).map((item) => item.text), ['离线名言'])
assert.deepEqual(buildAmbientTextDeck(['custom'], { quotes: ['离线名言'], custom: [] }, ['今日简报']).map((item) => item.text), ['今日简报'])
assert.deepEqual(buildAmbientTextDeck(['quotes'], { quotes: ['重复', '重复', '唯一'] }, []).map((item) => item.text), ['重复', '唯一'])

console.log('ambient bar logic tests passed')
