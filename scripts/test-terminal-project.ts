import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { inspectTerminalProject } from '../src/main/terminal-project.ts'

const dir = mkdtempSync(join(tmpdir(), 'aiisland-project-'))
mkdirSync(join(dir, '.git'))
mkdirSync(join(dir, '.vscode'))
mkdirSync(join(dir, 'node_modules'))
writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', test: 'node test.js' } }))
writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
writeFileSync(join(dir, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{ label: 'Lint', command: 'pnpm lint' }] }))
const result = inspectTerminalProject(dir)
assert.equal(result.ok, true)
assert.equal(result.packageManager, 'pnpm')
assert.ok(result.kind.includes('Node.js'))
assert.ok(result.tasks.some((task) => task.command === 'pnpm run dev'))
assert.ok(result.tasks.some((task) => task.command === 'pnpm lint'))
assert.ok(result.checks.some((check) => check.label === 'Git 仓库' && check.status === 'ok'))
assert.equal(inspectTerminalProject(join(dir, 'missing')).ok, false)
rmSync(dir, { recursive: true, force: true })

console.log('terminal project tests passed')
