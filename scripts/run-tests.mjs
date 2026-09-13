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

// 子进程 stdout/stderr 走管道再转发（而非 inherit）：本机 Node 25.2.1 (Windows) 在 strip-types 下、
// 子进程 stdout 直接继承文件句柄时，退出阶段会触发 libuv 断言（STATUS_STACK_BUFFER_OVERRUN，与断言结果无关）。
// 管道转发在终端/管道/CI(Node 22) 下均正常，且能统一输出顺序。
const run = (test) => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', join('scripts', test)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result
}

for (const test of tests) {
  process.stdout.write(`\n=== ${test} ===\n`)
  let result = run(test)
  if (result.status !== 0) {
    // 兜底重试：断言已全部通过、仅进程退出阶段异常时重跑一次即可通过；真实断言失败重跑仍失败，不会被掩盖。
    process.stdout.write(`  ↻ ${test} 退出码 ${result.status}，重试一次（Node teardown 偶发崩溃防护）\n`)
    result = run(test)
  }
  if (result.status !== 0) process.exit(result.status || 1)
}

process.stdout.write(`\nAll ${tests.length} offline test scripts passed.\n`)
