// buildQuotedPrompt 单测：引用片段 + 疑问 + 输入 → 发给模型的完整提问。
// 运行：node --experimental-strip-types scripts/test-quote.ts

import { buildQuotedPrompt } from '../src/renderer/src/logic/chat.ts'
import type { QuoteRef } from '../src/renderer/src/types.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

const q = (id: number, text: string, note?: string): QuoteRef => ({ id, text, note })

// 无引用 → 原样返回
ok(buildQuotedPrompt([], '你好') === '你好', '无引用时原样返回输入')

// 单引用 + 疑问 + 输入
const a = buildQuotedPrompt([q(1, 'useCallback 的依赖数组')], '这个为什么要写全')
ok(a.includes('【引用1】') && a.includes('    useCallback 的依赖数组') && a.includes('这个为什么要写全'), '单引用含引用块与输入问题')

// 引用带 note
const b = buildQuotedPrompt([q(1, '原文片段', '这里没懂')], '')
ok(b.includes('我的疑问：这里没懂'), '引用自带疑问被包含')
ok(!b.includes('请针对以上引用内容展开说明'), '有疑问时不追加默认问题')

// 引用无 note 且无输入 → 追加默认追问
const c = buildQuotedPrompt([q(1, '某段')], '')
ok(c.includes('请针对以上引用内容展开说明'), '无疑问无输入时追加默认追问')

// 多引用编号 + 多行原文逐行缩进（改用缩进而非 markdown `>`，避免把模型带进 markdown 语境丢失 JSON 块协议）
const d = buildQuotedPrompt([q(1, '第一段'), q(2, '第二行A\n第二行B')], '对比一下')
ok(d.includes('【引用1】') && d.includes('【引用2】'), '多引用各自编号')
ok(d.includes('    第二行A') && d.includes('    第二行B'), '多行原文每行缩进')
ok(d.includes('对比一下'), '多引用后附带用户问题')

console.log(failed === 0 ? '\n✅ buildQuotedPrompt 全部通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
