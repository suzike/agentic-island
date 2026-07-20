// buildQuotedPrompt 单测：引用片段 + 疑问 + 输入 → 发给模型的完整提问。
// 运行：node --experimental-strip-types scripts/test-quote.ts

import { buildQuotedPrompt, chatMessageText, conversationContextStats, conversationToMarkdown, forkConversation, historyFromThread } from '../src/renderer/src/logic/chat.ts'
import type { ChatMessage, QuoteRef } from '../src/renderer/src/types.ts'

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

// 会话上下文：附件持续携带、钉选越过最近窗口、排除项不送入模型、长期记忆置顶
const thread: ChatMessage[] = [
  { role: 'user', text: '固定约束', contextMode: 'pinned', ts: 1 },
  { role: 'agent', blocks: [{ t: 'p', text: '旧回答' }], ts: 2 },
  { role: 'user', text: '不要再发送', contextMode: 'excluded', ts: 3 },
  { role: 'user', text: '分析附件', attachments: [{ type: 'file', name: 'spec.md', content: '# 规格\n必须离线' }], ts: 4 },
  { role: 'agent', blocks: [{ t: 'p', text: '最新回答' }], ts: 5 }
]
const history = historyFromThread(thread, 2, '用户偏好本地优先')
ok(history[0].content.includes('本会话长期记忆') && history[0].content.includes('本地优先'), '长期记忆位于模型历史首部')
ok(history.some((item) => item.content.includes('固定约束')), '钉选消息越过最近窗口仍保留')
ok(!history.some((item) => item.content.includes('不要再发送')), '排除消息不进入模型历史')
ok(history.some((item) => item.content.includes('附件：spec.md') && item.content.includes('必须离线')), '文本附件在后续轮次持续进入上下文')

const stats = conversationContextStats(thread, '记忆', 2)
ok(stats.pinned === 1 && stats.excluded === 1 && stats.attachments === 1, '上下文统计区分钉选、排除与附件')
ok(stats.estimatedTokens > 0 && stats.included === 3, '上下文预算只统计真实送入模型的消息')

const forked = forkConversation([...thread, { role: 'agent', typing: true }], 3)
ok(forked.length === 4 && !forked.some((item) => item.typing), 'Fork 按节点截断且不携带进行中占位')
ok(chatMessageText(thread[3]).includes('规格'), '消息正文序列化包含文本附件')
const markdown = conversationToMarkdown(thread)
ok(markdown.includes('## 用户 · 长期上下文') && markdown.includes('## AI') && !markdown.includes('think'), '对话可稳定序列化为知识库 Markdown')

console.log(failed === 0 ? '\n✅ buildQuotedPrompt 全部通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
