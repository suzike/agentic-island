// 知识库（本地 RAG）：把本地文件夹/文件/网页切块 → 向量化(OpenAI 兼容 /embeddings) → 存本机 → 语义检索。
// 设计约束：存储目录由外部注入（不 import electron，便于 raw-node 测试）；pdf/docx 解析器惰性 import（避免顶层副作用）。

import { promises as fs } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { embed } from './llm-proxy'
import type { LlmRequestConfig } from '../shared/protocol'

export type KbKind = 'folder' | 'files' | 'url' | 'conversation'
export interface KbSource { id: string; kind: KbKind; target: string; label: string; addedAt: number }
export interface KbDoc { id: string; sourceId: string; title: string; path: string; chunk: number; text: string; vector: number[]; mtime: number }
// wiki：LLM 合成的持久化知识页（key='overview' 为全库总览；或按 sourceId）——"编译一次、长期复用"（LLM-Wiki 模式）
interface KbStore { sources: KbSource[]; docs: KbDoc[]; wiki?: Record<string, { md: string; at: number }> }
export interface KbHit { title: string; source: string; path: string; text: string; score: number }

// 纯文本/代码扩展名（直接按 UTF-8 读）
const TEXT_EXT = new Set(['.md', '.markdown', '.mdx', '.txt', '.rst', '.org', '.tex', '.csv', '.json', '.yaml', '.yml', '.toml', '.ini', '.log', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.java', '.c', '.cpp', '.cc', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.cs', '.vue', '.svelte', '.html', '.css', '.scss', '.sql', '.sh', '.ps1', '.bat', '.m', '.r', '.lua'])
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target', 'vendor'])
const MAX_FILES = 2000
const MAX_TEXT_BYTES = 1_500_000
const CHUNK = 900
const OVERLAP = 150
// 向量化分批：同时限"条数"与"总字符"——很多 embedding 端点对单请求 token 有硬上限（大批量 900 字块一撞就 400）
const EMBED_MAX_ITEMS = 16
const EMBED_MAX_CHARS = 24000

let storeDir = ''
const storeFile = (): string => join(storeDir, 'kb-index.json')
export function initKb(dir: string): void { storeDir = dir }

async function load(): Promise<KbStore> {
  try { return JSON.parse(await fs.readFile(storeFile(), 'utf8')) as KbStore } catch {
    try {
      await fs.copyFile(storeFile(), storeFile().replace(/\.json$/, '.bad.json'))
    } catch { /* 无旧索引或备份失败时继续返回空库 */ }
    return { sources: [], docs: [] }
  }
}
async function save(s: KbStore): Promise<void> {
  const p = storeFile()
  const tmp = p + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(s), 'utf8')
  try {
    await fs.rename(tmp, p)
  } catch {
    await fs.writeFile(p, JSON.stringify(s), 'utf8')
    try { await fs.rm(tmp, { force: true }) } catch { /* */ }
  }
}

/** 按扩展名读取文本：pdf→pdf-parse，docx→mammoth，其余按 UTF-8。返回 null 表示跳过（二进制/过大/失败）。 */
export async function readFileText(path: string): Promise<string | null> {
  const ext = extname(path).toLowerCase()
  try {
    if (ext === '.pdf') {
      const buf = await fs.readFile(path)
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(buf) })
      const r = await parser.getText()
      await parser.destroy()
      // pdf-parse v2 会在每页间插入「-- N of M --」页码标记，剥掉以免污染切块/向量
      return (r.text || '').replace(/\n*-- \d+ of \d+ --\n*/g, '\n\n').trim() || null
    }
    if (ext === '.docx') {
      const mammoth = await import('mammoth')
      const r = await mammoth.extractRawText({ path })
      return r.value || null
    }
    if (TEXT_EXT.has(ext)) {
      const st = await fs.stat(path)
      if (st.size > MAX_TEXT_BYTES) return null
      return await fs.readFile(path, 'utf8')
    }
    return null
  } catch { return null }
}

/** 递归收集可索引文件（跳过噪声目录/隐藏文件，限量）。 */
async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  if (acc.length >= MAX_FILES) return acc
  let entries: import('node:fs').Dirent[]
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) break
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) await walk(full, acc) }
    else { const ext = extname(e.name).toLowerCase(); if (TEXT_EXT.has(ext) || ext === '.pdf' || ext === '.docx') acc.push(full) }
  }
  return acc
}

/** 按段落聚合切块（~900 字，150 重叠），保序。 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  const paras = clean.split(/\n\n+/)
  const chunks: string[] = []
  let buf = ''
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > CHUNK && buf) { chunks.push(buf.trim()); buf = buf.slice(Math.max(0, buf.length - OVERLAP)) }
    buf += (buf ? '\n\n' : '') + p
    // 单段超长：硬切
    while (buf.length > CHUNK * 1.6) { chunks.push(buf.slice(0, CHUNK).trim()); buf = buf.slice(CHUNK - OVERLAP) }
  }
  if (buf.trim()) chunks.push(buf.trim())
  return chunks
}

/** 分批向量化（按条数+总字符双限），任一批失败即整体失败（保证"必须向量嵌入"契约）。 */
async function embedAll(cfg: LlmRequestConfig, texts: string[]): Promise<number[][] | { error: string }> {
  const out: number[][] = []
  let i = 0
  while (i < texts.length) {
    let j = i
    let chars = 0
    while (j < texts.length && j - i < EMBED_MAX_ITEMS && (j === i || chars + texts[j].length <= EMBED_MAX_CHARS)) { chars += texts[j].length; j++ }
    const batch = texts.slice(i, j)
    const r = await embed(cfg, batch)
    if (!r.ok || !r.vectors) return { error: r.error || '向量化失败' }
    if (r.vectors.length !== batch.length) return { error: `向量数量不匹配（发 ${batch.length} 收 ${r.vectors.length}）——该 embedding 端点可能不支持批量输入` }
    out.push(...r.vectors)
    i = j
  }
  return out
}

/** 把若干文件读取→切块→向量化，产出 KbDoc（已带 mtime）。 */
async function indexFiles(cfg: LlmRequestConfig, sourceId: string, files: string[]): Promise<{ docs: KbDoc[]; skipped: number; error?: string }> {
  const pending: { title: string; path: string; chunk: number; text: string; mtime: number }[] = []
  let skipped = 0
  for (const f of files) {
    const text = await readFileText(f)
    if (!text) { skipped++; continue }
    let mtime = 0
    try { mtime = (await fs.stat(f)).mtimeMs } catch { /* */ }
    const parts = chunkText(text)
    parts.forEach((t, i) => pending.push({ title: basename(f), path: f, chunk: i, text: t, mtime }))
  }
  if (!pending.length) return { docs: [], skipped }
  const vectors = await embedAll(cfg, pending.map((p) => p.text))
  if ('error' in vectors) return { docs: [], skipped, error: vectors.error }
  const docs: KbDoc[] = pending.map((p, i) => ({ id: `${sourceId}:${p.path}#${p.chunk}`, sourceId, title: p.title, path: p.path, chunk: p.chunk, text: p.text, vector: vectors[i], mtime: p.mtime }))
  return { docs, skipped }
}

function newId(kind: string, target: string): string {
  // 稳定 id：kind + target 哈希（避免依赖 Date.now，也便于同源去重）
  let h = 0
  const s = kind + '|' + target
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return kind + '_' + (h >>> 0).toString(36)
}

export interface KbSourceView extends KbSource { docCount: number }
export async function listSources(): Promise<KbSourceView[]> {
  const s = await load()
  return s.sources.map((src) => ({ ...src, docCount: s.docs.filter((d) => d.sourceId === src.id).length }))
}

/** 添加本地文件夹：遍历→索引；同 target 覆盖重建。 */
export async function addFolder(cfg: LlmRequestConfig, dir: string, addedAt: number): Promise<{ ok: boolean; added?: number; skipped?: number; error?: string }> {
  const files = await walk(dir)
  if (!files.length) return { ok: false, error: '该文件夹下没有可索引的文本/代码/PDF/Word 文件' }
  const id = newId('folder', dir)
  const r = await indexFiles(cfg, id, files)
  if (r.error) return { ok: false, error: r.error }
  if (!r.docs.length) return { ok: false, error: `扫到 ${files.length} 个文件但未能提取到可索引文本（可能都是空文件/不支持的格式，已跳过 ${r.skipped}）` }
  const s = await load()
  s.sources = s.sources.filter((x) => x.id !== id).concat({ id, kind: 'folder', target: dir, label: basename(dir) || dir, addedAt })
  s.docs = s.docs.filter((d) => d.sourceId !== id).concat(r.docs)
  await save(s)
  return { ok: true, added: r.docs.length, skipped: r.skipped }
}

/** 添加若干独立文件（归到一个"文件"源）。 */
export async function addFiles(cfg: LlmRequestConfig, paths: string[], addedAt: number): Promise<{ ok: boolean; added?: number; skipped?: number; error?: string }> {
  if (!paths.length) return { ok: false, error: '未选择文件' }
  const id = newId('files', paths.slice().sort().join('|'))
  const r = await indexFiles(cfg, id, paths)
  if (r.error) return { ok: false, error: r.error }
  const s = await load()
  const label = paths.length === 1 ? basename(paths[0]) : `${basename(paths[0])} 等 ${paths.length} 个文件`
  s.sources = s.sources.filter((x) => x.id !== id).concat({ id, kind: 'files', target: paths.join('|'), label, addedAt })
  s.docs = s.docs.filter((d) => d.sourceId !== id).concat(r.docs)
  await save(s)
  return { ok: true, added: r.docs.length, skipped: r.skipped }
}

/** 添加网页：正文由外部注入的抓取器提供（复用 net.fetch）。 */
export async function addUrl(cfg: LlmRequestConfig, url: string, title: string, text: string, addedAt: number): Promise<{ ok: boolean; added?: number; error?: string }> {
  const clean = (text || '').trim()
  if (!clean) return { ok: false, error: '网页正文为空或抓取失败' }
  const id = newId('url', url)
  const parts = chunkText(clean)
  const vectors = await embedAll(cfg, parts)
  if ('error' in vectors) return { ok: false, error: vectors.error }
  const docs: KbDoc[] = parts.map((t, i) => ({ id: `${id}:${url}#${i}`, sourceId: id, title: title || url, path: url, chunk: i, text: t, vector: vectors[i], mtime: addedAt }))
  const s = await load()
  s.sources = s.sources.filter((x) => x.id !== id).concat({ id, kind: 'url', target: url, label: title || url, addedAt })
  s.docs = s.docs.filter((d) => d.sourceId !== id).concat(docs)
  await save(s)
  return { ok: true, added: docs.length }
}

/** 添加岛内对话文本：与文件/网页使用同一切块、向量化和本地索引，不经过临时文件。 */
export async function addText(cfg: LlmRequestConfig, title: string, text: string, sourceKey: string, addedAt: number): Promise<{ ok: boolean; added?: number; error?: string }> {
  const clean = (text || '').trim()
  if (!clean) return { ok: false, error: '对话内容为空' }
  if (clean.length > 500_000) return { ok: false, error: '对话内容过长，请先压缩会话上下文' }
  const key = (sourceKey || `${title}|${addedAt}`).slice(0, 512)
  const id = newId('conversation', key)
  const parts = chunkText(clean)
  const vectors = await embedAll(cfg, parts)
  if ('error' in vectors) return { ok: false, error: vectors.error }
  const path = `conversation://${encodeURIComponent(key)}`
  const label = (title || '问答会话').trim().slice(0, 120)
  const docs: KbDoc[] = parts.map((part, i) => ({ id: `${id}:${i}`, sourceId: id, title: label, path, chunk: i, text: part, vector: vectors[i], mtime: addedAt }))
  const s = await load()
  s.sources = s.sources.filter((x) => x.id !== id).concat({ id, kind: 'conversation', target: path, label, addedAt })
  s.docs = s.docs.filter((d) => d.sourceId !== id).concat(docs)
  await save(s)
  return { ok: true, added: docs.length }
}

export async function removeSource(id: string): Promise<{ ok: boolean }> {
  const s = await load()
  s.sources = s.sources.filter((x) => x.id !== id)
  s.docs = s.docs.filter((d) => d.sourceId !== id)
  await save(s)
  return { ok: true }
}

/** 增量重扫所有文件夹源：按 mtime 只重嵌变更/新增文件，删除已消失文件的块。 */
export async function reindex(cfg: LlmRequestConfig): Promise<{ ok: boolean; changed: number; error?: string }> {
  const s = await load()
  let changed = 0
  for (const src of s.sources.filter((x) => x.kind === 'folder')) {
    const files = await walk(src.target)
    const fileSet = new Set(files)
    const known = new Map<string, number>() // path → 已索引 mtime
    for (const d of s.docs) if (d.sourceId === src.id) known.set(d.path, d.mtime)
    // 需要重嵌的文件：新增，或 mtime 变了
    const stale: string[] = []
    for (const f of files) {
      let m = 0
      try { m = (await fs.stat(f)).mtimeMs } catch { /* */ }
      if (!known.has(f) || Math.abs((known.get(f) || 0) - m) > 1) stale.push(f)
    }
    // 删除已消失文件的块
    const before = s.docs.length
    s.docs = s.docs.filter((d) => d.sourceId !== src.id || fileSet.has(d.path))
    changed += before - s.docs.length
    if (stale.length) {
      const r = await indexFiles(cfg, src.id, stale)
      if (r.error) return { ok: false, changed, error: r.error }
      const staleSet = new Set(stale)
      s.docs = s.docs.filter((d) => d.sourceId !== src.id || !staleSet.has(d.path)).concat(r.docs)
      changed += r.docs.length
    }
  }
  await save(s)
  return { ok: true, changed }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/** 语义检索：向量化 query → 余弦相似 → top-k（同文件多块时适度去重，保多样性）。 */
export async function search(cfg: LlmRequestConfig, query: string, k = 8): Promise<{ ok: boolean; hits?: KbHit[]; error?: string }> {
  const s = await load()
  if (!s.docs.length) return { ok: false, error: '知识库为空，请先在管理面板添加文件夹/文件/网页' }
  const qv = await embed(cfg, [query])
  if (!qv.ok || !qv.vectors?.[0]) return { ok: false, error: qv.error || 'query 向量化失败' }
  const q = qv.vectors[0]
  const scored = s.docs.map((d) => ({ d, score: cosine(q, d.vector) })).sort((a, b) => b.score - a.score)
  const hits: KbHit[] = []
  const perFile = new Map<string, number>()
  for (const { d, score } of scored) {
    const c = perFile.get(d.path) || 0
    if (c >= 3) continue // 单文件最多 3 块，保来源多样
    perFile.set(d.path, c + 1)
    hits.push({ title: d.title, source: d.path, path: d.path, text: d.text, score })
    if (hits.length >= k) break
  }
  return { ok: true, hits }
}

/** 代表性取样：按文件轮询抽块，尽量覆盖更多来源（供 LLM 合成"知识总览/Wiki"）。sourceId 省略=全库。 */
export async function sampleChunks(max = 20, sourceId?: string): Promise<{ ok: boolean; chunks?: { title: string; text: string }[]; error?: string }> {
  const s = await load()
  const docs = sourceId ? s.docs.filter((d) => d.sourceId === sourceId) : s.docs
  if (!docs.length) return { ok: false, error: '知识库为空' }
  const byFile = new Map<string, KbDoc[]>()
  for (const d of docs) { const a = byFile.get(d.path) || []; a.push(d); byFile.set(d.path, a) }
  const files = [...byFile.values()].map((a) => a.slice().sort((x, y) => x.chunk - y.chunk))
  const out: { title: string; text: string }[] = []
  let guard = 0
  while (out.length < max && files.some((a) => a.length) && guard++ < max * 10) {
    const f = files[guard % files.length]
    if (f && f.length) { const d = f.shift()!; out.push({ title: d.title, text: d.text }) }
  }
  return { ok: true, chunks: out }
}

/** 读取所有已合成的 wiki 页（key → {md, at}）。 */
export async function getWiki(): Promise<Record<string, { md: string; at: number }>> {
  return (await load()).wiki || {}
}

/** 保存一页合成 wiki（key='overview' 或 sourceId）。 */
export async function saveWiki(key: string, md: string, at: number): Promise<{ ok: boolean }> {
  const s = await load()
  s.wiki = { ...(s.wiki || {}), [key]: { md, at } }
  await save(s)
  return { ok: true }
}
