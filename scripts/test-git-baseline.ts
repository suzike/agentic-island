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
  ok(again === summary, '工作区没变时命中缓存（返回同一结果）')

  // 改动一个文件：签名变化，缓存失效并重算
  writeFileSync(join(repo, 'c.txt'), 'c1\nc2\nc3\n')
  const afterEdit = await diffSinceBaseline(baseline!)
  ok(afterEdit !== again && afterEdit?.added === 5, '文件变化后缓存失效并重算')

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

  // 会话期间提交掉的改动：工作区已干净，仍要计入清单
  const repo3 = mkdtempSync(join(tmpdir(), 'aiisland-baseline-test3-'))
  const git3 = (...args: string[]): string => execFileSync('git', args, { cwd: repo3, encoding: 'utf8' })
  git3('init', '-q')
  git3('config', 'user.email', 'test@example.com')
  git3('config', 'user.name', 'Test')
  writeFileSync(join(repo3, 'c.txt'), 'c1\n')
  git3('add', '-A')
  git3('commit', '-qm', 'init')
  const base3 = await captureBaseline(repo3)
  writeFileSync(join(repo3, 'c.txt'), 'c1\nc2\n')
  writeFileSync(join(repo3, 'new.txt'), 'n1\nn2\n')
  git3('add', '-A')
  git3('commit', '-qm', 'agent work')
  const committedSummary = await diffSinceBaseline(base3!)
  const committedPaths = (committedSummary?.paths || []).map((p) => p.path).sort()
  ok(JSON.stringify(committedPaths) === JSON.stringify(['c.txt', 'new.txt']), `已提交的改动也进清单：${committedPaths.join(',')}`)
  ok((committedSummary?.paths || []).every((p) => p.committed === true), '已提交文件带 committed 标记')
  ok(committedSummary?.added === 3, `已提交改动行数正确（实际 ${committedSummary?.added}）`)
  ok(committedSummary?.commits === 1, '提交数仍然如实记录')

  // 提交后再改工作区：签名变化，旧缓存不能盖住新改动
  writeFileSync(join(repo3, 'c.txt'), 'c1\nc2\nc3\n')
  const afterCommitEdit = await diffSinceBaseline(base3!)
  ok(afterCommitEdit !== committedSummary && afterCommitEdit?.added === 3, '提交后再改工作区仍能算出增量')
  rmSync(repo3, { recursive: true, force: true })
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
