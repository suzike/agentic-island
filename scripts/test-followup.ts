// 补验证续跑的入口守卫：非法会话 id / 目录 / 空追问必须在 spawn 之前拦下（不启动任何进程）。
// 运行：node --experimental-strip-types scripts/test-followup.ts

import { startFollowup } from '../src/main/agent-followup.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

const base = {
  runId: 'run-1',
  engine: 'claude' as const,
  sessionId: '695e6c8e-6efa-4ad9-99f4-bbed0c1f695a',
  cwd: process.cwd(),
  prompt: '补一下验证'
}
const noop = (): void => {}

ok(startFollowup({ ...base, sessionId: 'C:\\work\\proj' }, noop).ok === false, '拒绝路径形式的"会话 id"（防命令注入）')
ok(startFollowup({ ...base, sessionId: '' }, noop).ok === false, '空会话 id 直接拒绝')
ok(startFollowup({ ...base, cwd: 'C:\\definitely\\not\\here' }, noop).ok === false, '工作目录不存在时拒绝')
ok(startFollowup({ ...base, cwd: '' }, noop).ok === false, '空工作目录拒绝')
ok(startFollowup({ ...base, prompt: '   ' }, noop).ok === false, '空追问拒绝')
ok(startFollowup({ ...base, runId: '' }, noop).ok === false, '缺任务标识拒绝')

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n补验证入口守卫全部通过（以上都没有真正启动 CLI）')
