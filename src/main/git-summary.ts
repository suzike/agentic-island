// 任务完成时，在项目 cwd 里用真实 git 数据生成变更小结（文件数 / +行 / −行 / 建议提交信息）。
// 全部来自 `git` 命令的真实输出；非 git 仓库或无改动时返回 null。

import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ChangeSummary } from '../shared/protocol'

const git = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 4000 }, (err, stdout) => {
      resolve(err ? '' : stdout.toString())
    })
  })

async function countNewFileLines(cwd: string, files: string[]): Promise<number> {
  let total = 0
  for (const f of files) {
    try {
      const buf = await readFile(join(cwd, f))
      if (buf.length > 1_000_000 || buf.includes(0)) continue
      const text = buf.toString('utf8')
      if (!text) continue
      total += text.endsWith('\n') ? text.split(/\r\n|\r|\n/).length - 1 : text.split(/\r\n|\r|\n/).length
    } catch {
      /* 跳过无法读取/二进制/瞬时消失的未跟踪文件 */
    }
  }
  return total
}

export async function gitSummary(cwd: string): Promise<ChangeSummary | null> {
  if (!cwd) return null
  // 是否 git 仓库
  const inside = (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim()
  if (inside !== 'true') return null

  // 工作区相对 HEAD 的改动统计
  const shortstat = await git(cwd, ['diff', '--shortstat', 'HEAD'])
  const nameOnly = (await git(cwd, ['diff', '--name-only', 'HEAD'])).split('\n').map((s) => s.trim()).filter(Boolean)
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard'])).split('\n').map((s) => s.trim()).filter(Boolean)

  const files = new Set([...nameOnly, ...untracked])
  if (files.size === 0) return null

  const added = Number((shortstat.match(/(\d+) insertion/) || [])[1] || 0) + await countNewFileLines(cwd, untracked)
  const removed = Number((shortstat.match(/(\d+) deletion/) || [])[1] || 0)

  // 变更文件清单（验收台"计划 → 实际改动"对照用）：-z 输出避免中文/空格路径被引号转义
  const statusOut = await git(cwd, ['status', '--porcelain=v1', '-z', '-uall'])
  const paths: { path: string; status: string }[] = []
  const entries = statusOut.split('\0')
  for (let i = 0; i < entries.length && paths.length < 200; i++) {
    const entry = entries[i]
    if (!entry || entry.length < 4) continue
    const code = entry.slice(0, 2).trim() || 'M'
    // 重命名/复制时下一段是原路径，跳过
    if (code.startsWith('R') || code.startsWith('C')) i++
    paths.push({ path: entry.slice(3), status: code })
  }

  // 建议提交信息：从真实改动文件推导一个可编辑的模板
  const first = [...files][0]
  const scope = first.split('/')[0] || first
  const commit =
    files.size === 1
      ? `chore: 更新 ${first}`
      : `chore(${scope}): 更新 ${files.size} 个文件`

  return { files: files.size, added, removed, commit, paths }
}
