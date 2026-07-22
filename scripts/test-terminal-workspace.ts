import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTerminalWorkspaceStore, defaultTerminalWorkspace, normalizeTerminalWorkspace, redactTerminalText, terminalWorkspaceExportState } from '../src/main/terminal-workspace-store.ts'

const now = new Date('2026-07-22T08:00:00Z').getTime()
const normalized = normalizeTerminalWorkspace({
  sessions: [{ id: 's1', name: '项目', profile: 'bad', commandCount: -2, outputSnapshot: 'secret', outputSavedAt: now }],
  activeSessionId: 'missing',
  settings: { captureOutput: false, retentionDays: 999, maxSnapshotChars: 1 }
}, now)
assert.equal(normalized.version, 2)
assert.equal(normalized.sessions[0].profile, 'powershell')
assert.equal(normalized.sessions[0].commandCount, 0)
assert.equal(normalized.sessions[0].outputSnapshot, undefined, '默认不得持久化终端输出')
assert.equal(normalized.settings.retentionDays, 90)
assert.equal(normalized.settings.maxSnapshotChars, 2_000)

assert.equal(redactTerminalText('Authorization: Bearer abcdef123456'), 'Authorization: Bearer [REDACTED]')
assert.equal(redactTerminalText('API_KEY=super-secret-value'), 'API_KEY=[REDACTED]')
assert.equal(redactTerminalText('https://x.test?a=1&token=hello-world'), 'https://x.test?a=1&token=[REDACTED]')

const dir = mkdtempSync(join(tmpdir(), 'aiisland-terminal-'))
const file = join(dir, 'terminal-workspace.json')
const store = createTerminalWorkspaceStore({
  filePath: () => file,
  encrypt: (plain) => Buffer.from(plain).toString('base64'),
  decrypt: (cipher) => Buffer.from(cipher, 'base64').toString('utf8')
})
const state = defaultTerminalWorkspace(now)
state.settings.captureOutput = true
state.sessions = [{ id: 's1', name: '项目', profile: 'powershell', createdAt: now, lastActiveAt: now, commandCount: 1, outputSnapshot: 'token=unsafe-value', outputSavedAt: now }]
state.envProfiles = [{ id: 'env-1', name: '开发', variables: [{ key: 'API_KEY', value: 'private-value' }], createdAt: now }]
const exported = terminalWorkspaceExportState(state)
assert.equal(exported.sessions[0].outputSnapshot, undefined, '工作区导出必须排除输出快照')
assert.equal(exported.envProfiles[0].variables[0].value, '', '工作区导出必须排除环境变量值')
store.save(state)
assert.ok(readFileSync(file, 'utf8').startsWith('enc:'))
assert.equal(store.load().sessions[0].outputSnapshot, 'token=[REDACTED]')
assert.equal(store.clearSnapshots().sessions[0].outputSnapshot, undefined)
writeFileSync(file, 'enc:not-valid-base64')
assert.deepEqual(store.load().sessions, [])
rmSync(dir, { recursive: true, force: true })

console.log('terminal workspace tests passed')
