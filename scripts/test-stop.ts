// 验证真实 git 变更小结：建临时 git 仓库、制造改动、断言 gitSummary 反映真实统计。

import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gitSummary } from '../src/main/git-summary.ts'

const g = (cwd: string, ...args: string[]): void => { execFileSync('git', args, { cwd, stdio: 'ignore' }) }

async function run(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'aiisland-'))
  try {
    g(dir, 'init')
    g(dir, 'config', 'user.email', 't@t.co')
    g(dir, 'config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'line1\nline2\nline3\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-m', 'init')
    // 改 a.txt（+2/-1）+ 新增未跟踪 b.txt
    writeFileSync(join(dir, 'a.txt'), 'line1\nline2 changed\nline3\nline4\n')
    writeFileSync(join(dir, 'b.txt'), 'new file\n')

    const sum = await gitSummary(dir)
    console.log('[gitSummary]', JSON.stringify(sum))

    // 非 git 目录应返回 null
    const none = await gitSummary(tmpdir())
    console.log('[non-git]', JSON.stringify(none))

    if (sum && sum.files >= 2 && sum.added >= 2 && sum.commit && none === null) {
      console.log('\n✅ Stop → 真实 git 变更小结 验证通过（文件数/增删行来自真实 git）')
      process.exit(0)
    }
    console.error('❌ 小结不符合预期')
    process.exit(1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

run().catch((e) => { console.error('异常', e); process.exit(1) })
