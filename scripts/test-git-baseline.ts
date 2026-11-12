// 会话级改动归属单测：基线之前的未提交改动不算本次会话产出，只报基线之后真正变化的文件。
// 运行：node --experimental-strip-types scripts/test-git-baseline.ts

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureBaseline, diffSinceBaseline } from '../src/main/git-baseline.ts'
import { SessionChanges } from '../src/main/session-changes.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

const repo = mkdtempSync(join(tmpdir(), 'aiisland-baseline-test-'))
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const write = (name: string, text: string): void => writeFileSync(join(repo, name), text)

async function run(): Promise<void> {
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('a.txt', 'line1\n')
  write('b.txt', 'b1\n')
  write('d.txt', 'd1\n')
  write('e.txt', 'e1\n')
  git('add', '-A')
  git('commit', '-qm', 'init')

  // 基线之前：用户自己的未提交改动（不应该被算到 Agent 头上）
  write('a.txt', 'line1\nuser\n')
  write('b.txt', 'b1\nb2\n')
  write('d.txt', 'd1\nuser\n')
  write('e.txt', 'e1\nuser\n')
  write('u.txt', 'untracked by user\n')

  const baseline = await captureBaseline(repo)
  ok(!!baseline && baseline.files.length === 5, '基线拍到全部脏文件（含未跟踪）')
  ok(!!baseline?.files.find((f) => f.path === 'a.txt')?.content, '文本文件保留原文用于精确算行数')

  // 基线之后：Agent 的改动
  write('a.txt', 'line1\nuser\nagent\n')
  write('b.txt', 'b1\nb2\nagent\n')
  write('c.txt', 'c1\nc2\n')
  unlinkSync(join(repo, 'd.txt'))
  // 用户把自己的 e.txt 改回 HEAD：工作区确实变了，算作本次变化
  git('checkout', '--', 'e.txt')

  const summary = await diffSinceBaseline(baseline!)
  const paths = (summary?.paths || []).map((p) => p.path).sort()
  ok(JSON.stringify(paths) === JSON.stringify(['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']), `只报基线后变化的文件：${paths.join(',')}`)
  ok(!paths.includes('u.txt'), '基线就存在的未跟踪文件不算本次改动')
  ok(summary?.files === 5, '文件数按会话改动计')
  ok(summary?.added === 4, `新增行只算基线之后的部分（实际 ${summary?.added}）`)
  ok(summary?.removed === 3, `删除行含删掉的基线内容（实际 ${summary?.removed}）`)

  // 同一基线重复计算应稳定（工作区没再变）
  const again = await diffSinceBaseline(baseline!)
  ok(again?.files === 5 && again?.added === 4, '同一基线重复计算稳定')

  // 会话级追踪器：ensure 之后 summary 走基线
  const changes = new SessionChanges(captureBaseline, diffSinceBaseline)
  const repo2 = mkdtempSync(join(tmpdir(), 'aiisland-baseline-test2-'))
  const git2 = (...args: string[]): string => execFileSync('git', args, { cwd: repo2, encoding: 'utf8' })
  git2('init', '-q')
  git2('config', 'user.email', 'test@example.com')
  git2('config', 'user.name', 'Test')
  writeFileSync(join(repo2, 'x.txt'), 'x1\n')
  git2('add', '-A')
  git2('commit', '-qm', 'init')
  await changes.ensure('claude-code:s1', repo2)
  writeFileSync(join(repo2, 'x.txt'), 'x1\nx2\n')
  const tracked = await changes.summary(repo2, 'claude-code:s1')
  ok(tracked?.files === 1 && tracked?.added === 1, 'SessionChanges 只报 ensure 之后的改动')
  changes.forget('claude-code:s1')

  rmSync(repo2, { recursive: true, force: true })
}

run()
  .catch((e) => {
    console.error('测试异常:', e)
    failed++
  })
  .finally(() => {
    rmSync(repo, { recursive: true, force: true })
    if (failed > 0) {
      console.error(`\n${failed} 项失败`)
      process.exit(1)
    }
    console.log('\n会话基线归属全部通过')
  })
