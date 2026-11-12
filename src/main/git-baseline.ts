// 会话级改动归属：在会话开始时给工作区拍快照（脏文件 + 未跟踪文件的内容指纹），
// 之后只把"与基线不一致"的文件算作这次会话的改动。
// 这样做是因为 `git diff HEAD` 会把用户自己的未提交改动一起算进来——验收台据此会误判归属。

import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ChangeSummary } from '../shared/protocol'

const MAX_FILES = 120
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_REPORT_FILES = 200

export interface BaselineFile {
  path: string
  status: string
  /** 内容 sha1；二进制/超大文件用 size+mtime 指纹 */
  hash: string
  /** 仅文本且不超过上限时保留原文，用于精确算行数 */
  content?: Buffer
}

export interface WorktreeBaseline {
  cwd: string
  at: number
  /** 会话开始时的 HEAD：用于提示"期间有提交，清单不含已提交内容" */
  head?: string
  files: BaselineFile[]
  /** 脏文件超过上限：超出部分不纳入归属判断 */
  truncated?: boolean
  /** 上一次计算结果：工作区签名没变时直接复用，省掉逐文件读内容 + git diff */
  cache?: { sig: string; summary: ChangeSummary | null }
}

const sha1 = (buf: Buffer): string => createHash('sha1').update(buf).digest('hex')

const gitOut = (cwd: string, args: string[], timeout = 6000): Promise<string> =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout }, (err, stdout) => {
      resolve(err && !stdout ? '' : stdout.toString())
    })
  })

/** `git status --porcelain=v1 -z -uall` → 路径与 XY 状态码 */
export function parsePorcelainZ(out: string): { path: string; status: string }[] {
  const list: { path: string; status: string }[] = []
  const entries = out.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry || entry.length < 4) continue
    const code = entry.slice(0, 2).trim() || 'M'
    // 重命名/复制时下一段是原路径
    if (code.startsWith('R') || code.startsWith('C')) i++
    list.push({ path: entry.slice(3), status: code })
  }
  return list
}

interface Fingerprint {
  hash: string
  content?: Buffer
}

async function fingerprint(abs: string, wantContent: boolean): Promise<Fingerprint> {
  let st
  try {
    st = await stat(abs)
  } catch {
    return { hash: 'missing' }
  }
  if (!st.isFile()) return { hash: 'nonfile' }
  if (st.size > MAX_FILE_BYTES) return { hash: `big:${st.size}:${st.mtimeMs}` }
  try {
    const content = await readFile(abs)
    if (content.includes(0)) return { hash: `bin:${content.length}:${st.mtimeMs}` }
    return wantContent ? { hash: sha1(content), content } : { hash: sha1(content) }
  } catch {
    return { hash: `err:${st.size}:${st.mtimeMs}` }
  }
}

export async function captureBaseline(cwd: string): Promise<WorktreeBaseline | null> {
  if (!cwd) return null
  if ((await gitOut(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return null
  const head = (await gitOut(cwd, ['rev-parse', 'HEAD'])).trim() || undefined
  const entries = parsePorcelainZ(await gitOut(cwd, ['status', '--porcelain=v1', '-z', '-uall']))
  const files: BaselineFile[] = []
  let total = 0
  for (const entry of entries.slice(0, MAX_FILES)) {
    const fp = await fingerprint(join(cwd, entry.path), true)
    if (fp.content && total + fp.content.length > MAX_TOTAL_BYTES) {
      files.push({ path: entry.path, status: entry.status, hash: fp.hash })
      continue
    }
    total += fp.content?.length || 0
    files.push({ path: entry.path, status: entry.status, hash: fp.hash, content: fp.content })
  }
  return { cwd, at: Date.now(), head, files, truncated: entries.length > MAX_FILES || undefined }
}

/** 逐文件行数（相对基线内容，而不是 HEAD）；二进制/超大文件返回 null */
const numstat = (before: string, after: string): Promise<{ added: number; removed: number } | null> =>
  new Promise((resolve) => {
    execFile('git', ['diff', '--no-index', '--numstat', '--', before, after], { windowsHide: true, timeout: 6000 }, (_err, stdout) => {
      const line = stdout.toString().split('\n')[0]?.trim()
      if (!line) return resolve(null)
      const [add, del] = line.split('\t')
      if (!/^\d+$/.test(add || '') || !/^\d+$/.test(del || '')) return resolve(null)
      resolve({ added: Number(add), removed: Number(del) })
    })
  })

/** 干净文件（基线时不在 git status 里）直接用 HEAD 对比：HEAD 即基线内容 */
const numstatHead = (cwd: string, paths: string[]): Promise<{ added: number; removed: number }> =>
  new Promise((resolve) => {
    execFile('git', ['diff', '--numstat', 'HEAD', '--', ...paths], { cwd, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      let added = 0
      let removed = 0
      for (const line of stdout.toString().split('\n')) {
        const [add, del] = line.split('\t')
        if (/^\d+$/.test(add || '') && /^\d+$/.test(del || '')) {
          added += Number(add)
          removed += Number(del)
        }
      }
      resolve({ added, removed })
    })
  })

/** 会话期间提交掉的文件：用基线 HEAD → 当前 HEAD 的区间统计 */
const numstatRange = (cwd: string, from: string, to: string, paths: string[]): Promise<{ added: number; removed: number }> =>
  new Promise((resolve) => {
    execFile('git', ['diff', '--numstat', from, to, '--', ...paths], { cwd, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      let added = 0
      let removed = 0
      for (const line of stdout.toString().split('\n')) {
        const [add, del] = line.split('\t')
        if (/^\d+$/.test(add || '') && /^\d+$/.test(del || '')) {
          added += Number(add)
          removed += Number(del)
        }
      }
      resolve({ added, removed })
    })
  })

/** `git diff --name-status -z` → 路径与状态字母（重命名取新路径） */
export function parseNameStatusZ(out: string): { path: string; status: string }[] {
  const parts = out.split('\0').filter(Boolean)
  const list: { path: string; status: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i]
    if (!/^[A-Z]\d*$/.test(status)) continue
    const path = parts[i + 1]
    if (!path) break
    i += 1
    if (status.startsWith('R') || status.startsWith('C')) {
      const next = parts[i + 1]
      if (next) { list.push({ path: next, status: status[0] }); i += 1 }
      continue
    }
    list.push({ path, status })
  }
  return list
}

/** 新文件行数（二进制/不可读返回 0） */
async function countLines(abs: string): Promise<number> {
  try {
    const buf = await readFile(abs)
    if (buf.length > MAX_FILE_BYTES || buf.includes(0)) return 0
    const text = buf.toString('utf8')
    if (!text) return 0
    return text.endsWith('\n') ? text.split(/\r\n|\r|\n/).length - 1 : text.split(/\r\n|\r|\n/).length
  } catch {
    return 0
  }
}

/**
 * 基线之后真正发生变化的文件。内容相同但状态码变了（如 M → A）不算改动：
 * 只有工作区字节变了才是这次会话的产出。
 */
export async function diffSinceBaseline(baseline: WorktreeBaseline): Promise<ChangeSummary | null> {
  const { cwd } = baseline
  if ((await gitOut(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return null
  const statusOut = await gitOut(cwd, ['status', '--porcelain=v1', '-z', '-uall'])
  const current = parsePorcelainZ(statusOut)
  const headNow = (await gitOut(cwd, ['rev-parse', 'HEAD'])).trim()

  // 签名只用"状态 + HEAD + 每个脏文件的 size/mtime"，不做内容读取：
  // 没变化时直接复用上次结果，多轮会话不必反复 hash 全部脏文件。
  const stamp = await Promise.all(current.slice(0, MAX_REPORT_FILES).map(async (entry) => {
    try {
      const st = await stat(join(cwd, entry.path))
      return `${entry.path}:${st.size}:${st.mtimeMs}`
    } catch {
      return `${entry.path}:missing`
    }
  }))
  const sig = sha1(Buffer.from(`${headNow}\n${statusOut}\n${stamp.join('\n')}`))
  if (baseline.cache?.sig === sig) return baseline.cache.summary
  const remember = (summary: ChangeSummary | null): ChangeSummary | null => {
    baseline.cache = { sig, summary }
    return summary
  }

  const baseMap = new Map(baseline.files.map((f) => [f.path, f]))
  const changed: { path: string; status: string; base?: BaselineFile }[] = []
  const seen = new Set<string>()

  for (const entry of current.slice(0, MAX_REPORT_FILES)) {
    seen.add(entry.path)
    const base = baseMap.get(entry.path)
    const fp = await fingerprint(join(cwd, entry.path), false)
    if (base && base.hash === fp.hash) continue
    changed.push({ path: entry.path, status: entry.status, base })
  }
  // 基线下脏、现在从 git status 消失：要么被改回 HEAD（内容不同），要么被删除
  for (const base of baseline.files) {
    if (seen.has(base.path)) continue
    const fp = await fingerprint(join(cwd, base.path), false)
    if (fp.hash === base.hash) continue
    changed.push({ path: base.path, status: fp.hash === 'missing' ? 'D' : 'M', base })
  }
  // 会话期间被提交掉的改动：工作区已经干净，只看 git status 会整段漏掉
  const committed: { path: string; status: string }[] = []
  if (baseline.head && headNow && headNow !== baseline.head) {
    const inWorktree = new Set(changed.map((c) => c.path))
    for (const item of parseNameStatusZ(await gitOut(cwd, ['diff', '--name-status', '-z', baseline.head, headNow]))) {
      if (!inWorktree.has(item.path)) committed.push(item)
    }
  }
  if (changed.length === 0 && committed.length === 0) return remember(null)

  let added = 0
  let removed = 0
  const paths: { path: string; status: string; committed?: boolean }[] = []
  const dir = await mkdtemp(join(tmpdir(), 'aiisland-baseline-'))
  const empty = join(dir, 'empty')
  const before = join(dir, 'before')
  await writeFile(empty, '')
  try {
    // 基线时干净的文件：HEAD 即基线内容，合并成一次 git 调用
    const headPaths = changed.filter((c) => !c.base && c.status !== '??').map((c) => c.path)
    if (headPaths.length > 0) {
      const sum = await numstatHead(cwd, headPaths)
      added += sum.added
      removed += sum.removed
    }
    for (const item of changed.slice(0, MAX_REPORT_FILES)) {
      const missing = (await fingerprint(join(cwd, item.path), false)).hash === 'missing'
      if (item.base?.content) {
        await writeFile(before, item.base.content)
        const lines = await numstat(before, missing ? empty : join(cwd, item.path))
        if (lines) {
          added += lines.added
          removed += lines.removed
        }
      } else if (!item.base && item.status === '??') {
        // 基线后新建的未跟踪文件：直接数行，省一次 git 进程
        added += missing ? 0 : await countLines(join(cwd, item.path))
      }
      paths.push({ path: item.path, status: item.status })
    }
    if (committed.length > 0 && baseline.head) {
      const slice = committed.slice(0, MAX_REPORT_FILES)
      const sum = await numstatRange(cwd, baseline.head, headNow, slice.map((c) => c.path))
      added += sum.added
      removed += sum.removed
      for (const item of slice) paths.push({ path: item.path, status: item.status, committed: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  const first = paths[0]?.path || ''
  const scope = first.split('/')[0] || first
  const commit = paths.length === 1 ? `chore: 更新 ${first}` : `chore(${scope}): 更新 ${paths.length} 个文件`
  const commits = baseline.head
    ? Number((await gitOut(cwd, ['rev-list', '--count', `${baseline.head}..HEAD`])).trim() || 0)
    : 0
  return remember({ files: paths.length, added, removed, commit, paths, commits: commits || undefined })
}
