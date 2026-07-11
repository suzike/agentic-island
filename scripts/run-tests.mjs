import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptsDir = join(root, 'scripts')
const excluded = new Set(['test-real-claude.ts'])
const tests = readdirSync(scriptsDir)
  .filter((name) => /^test-.+\.ts$/.test(name) && !excluded.has(name))
  .sort()

for (const test of tests) {
  process.stdout.write(`\n=== ${test} ===\n`)
  const result = spawnSync(process.execPath, ['--experimental-strip-types', join('scripts', test)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

process.stdout.write(`\nAll ${tests.length} offline test scripts passed.\n`)
