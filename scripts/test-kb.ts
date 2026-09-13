// 知识库纯逻辑测试：readFileText（大小上限/扩展名分流）+ chunkText 切块 + wiki 读写回环。
// embedding 相关（addText/search/reindex 需要真实端点）不在离线覆盖范围。
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { chunkText, getWiki, initKb, readFileText, saveWiki } from '../src/main/kb.ts'

let passed = 0
const ok = (cond: unknown, msg: string): void => {
  if (cond) { passed++ } else { console.error(`❌ ${msg}`); process.exit(1) }
}

const dir = mkdtempSync(join(tmpdir(), 'aiisland-kb-'))
initKb(dir)

// 文本类：UTF-8 直读
const mdFile = join(dir, 'note.md')
writeFileSync(mdFile, '# 标题\n\n正文段落，用于验证文本读取。', 'utf8')
ok((await readFileText(mdFile))?.includes('正文段落') === true, 'readFileText：Markdown 按 UTF-8 读取')

// 超限文本：1.5MB 上限，直接跳过（返回 null）而不是读入
const bigFile = join(dir, 'big.log')
writeFileSync(bigFile, 'x'.repeat(1_600_000), 'utf8')
ok((await readFileText(bigFile)) === null, 'readFileText：超 1.5MB 的文本被跳过')

// PDF 超限：30MB 上限在解析器之前生效——不需要真的解析 PDF 即可验证守卫
const bigPdf = join(dir, 'huge.pdf')
writeFileSync(bigPdf, Buffer.alloc(31 * 1024 * 1024))
ok((await readFileText(bigPdf)) === null, 'readFileText：超 30MB 的 PDF 在解析前被拦截')

// 不支持的扩展名（二进制）→ null
ok((await readFileText(join(dir, 'x.exe'))) === null, 'readFileText：未知扩展名返回 null')

// 切块：长度受限（CHUNK=900，硬切上限 1.6×CHUNK）、重叠保证内容不丢
const long = Array.from({ length: 40 }, (_, i) => `第${i}段。这是一段足够长的中文内容用来触发切块逻辑的边界。`).join('\n\n')
const chunks = chunkText(long)
ok(chunks.length > 1, 'chunkText：长文本切成多块')
ok(chunks.every((c) => c.length <= 1450), `chunkText：单块长度受限（实际最大 ${Math.max(...chunks.map((c) => c.length))}）`)
ok(chunks.join('').length >= long.length, 'chunkText：重叠切块不丢内容')
ok(chunkText('短文本').length === 1 && chunkText('   ').length === 0, 'chunkText：短文本单块、空白输入为空')

// wiki 读写回环
await saveWiki('weekly', '## 本周主线\n- 测试内容', 12345)
const wiki = await getWiki()
ok(wiki.weekly?.md.includes('本周主线') && wiki.weekly.at === 12345, 'getWiki/saveWiki：回环一致')

rmSync(dir, { recursive: true, force: true })
console.log(`kb tests passed: ${passed}`)
