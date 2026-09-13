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

const run = (test) => spawnSync(process.execPath, ['--experimental-strip-types', join('scripts', test)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

for (const test of tests) {
  process.stdout.write(`\n=== ${test} ===\n`)
  let result = run(test)
  if (result.status !== 0) {
    // Node 25.2.1 (Windows) 的 strip-types teardown 偶发 libuv 断言崩溃：断言已全部通过、
    // 且崩溃对象随时间轮换（与 preload 注入相互扰动）。失败重跑一次：teardown 崩溃重跑即过；
    // 真实断言失败重跑仍失败，不会被掩盖。
    process.stdout.write(`  ↻ ${test} 退出码 ${result.status}，重试一次（Node teardown 偶发崩溃防护）\n`)
    result = run(test)
  }
  if (result.status !== 0) process.exit(result.status || 1)
}

process.stdout.write(`\nAll ${tests.length} offline test scripts passed.\n`)
