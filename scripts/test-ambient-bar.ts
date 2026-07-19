import assert from 'node:assert/strict'
import { buildAmbientSlots, clampBarRotation, deriveAmbientStatus } from '../src/renderer/src/logic/ambientBar.ts'

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

console.log('ambient bar logic tests passed')
