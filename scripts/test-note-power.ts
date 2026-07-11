import assert from 'node:assert/strict'
import { NOTE_POWER_ACTIONS, runNotePowerAction } from '../src/renderer/src/logic/notePower.ts'
import type { StickyNote } from '../src/renderer/src/types.ts'

const now = Date.now()
const notes: StickyNote[] = [
  { id: 1, emoji: 'A', title: '架构', md: '内容  \n\n\n- [ ] 补测试\n[[缺失]]', color: 'sky', tags: [' 技术 ', '技术'], starred: true, createdAt: now, updatedAt: now },
  { id: 2, emoji: 'B', title: '旧想法', md: '短', color: 'amber', tags: [], later: true, createdAt: now - 100 * 86400_000, updatedAt: now - 100 * 86400_000 }
]

assert.ok(NOTE_POWER_ACTIONS.length >= 20)
assert.equal(new Set(NOTE_POWER_ACTIONS.map((x) => x.id)).size, NOTE_POWER_ACTIONS.length)
assert.equal(runNotePowerAction('space', notes, now).updates?.[0].md.includes('\n\n\n'), false)
assert.deepEqual(runNotePowerAction('tags', notes, now).updates?.[0].tags, ['技术'])
assert.match(runNotePowerAction('broken-links', notes, now).content || '', /缺失/)
assert.match(runNotePowerAction('task-index', notes, now).content || '', /补测试/)
assert.match(runNotePowerAction('task-progress', notes, now).content || '', /总任务：1/)
assert.equal(runNotePowerAction('json', notes, now).ext, 'json')
assert.match(runNotePowerAction('csv', notes, now).content || '', /id,title,tags/)

console.log(`note power tests passed: ${NOTE_POWER_ACTIONS.length} actions`)
