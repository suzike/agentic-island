// 知识库问答：把检索到的片段拼成"接地"上下文，约束模型只依据这些片段作答（RAG）。
// 答案走纯 Markdown（渲染层用 looseBlocks 兜底成一段 Markdown），避免 JSON 块协议在长引用下的脆弱性。

import type { KbHit } from '../../../shared/protocol'

export const KB_SYSTEM =
  '你是用户的私有知识库问答助手。下面提供从用户自己的知识库里语义检索到的片段（带编号与来源标题）。' +
  '请严格只依据这些片段回答：\n' +
  '- 综合相关片段，给出准确、有条理的回答，可用 Markdown（小标题/列表/代码块）组织；\n' +
  '- 关键结论后可用（片段N）标注依据；\n' +
  '- 若片段信息不足或与问题无关，明确说“知识库里没有足够的相关内容”，绝不编造；\n' +
  '- 除非用户用英文提问，否则一律用简体中文。'

/** 把 query + 命中片段拼成发给模型的接地提问 */
export function kbGroundPrompt(query: string, hits: KbHit[]): string {
  const ctx = hits.map((h, i) => `【片段${i + 1} · ${h.title}】\n${h.text}`).join('\n\n')
  return `问题：${query}\n\n知识库检索到的片段：\n${ctx || '（无）'}`
}

/** 命中片段 → 去重来源标题（用于回答末尾的“依据”脚注） */
export function citeSources(hits: KbHit[], limit = 6): string {
  return [...new Set(hits.map((h) => h.title))].slice(0, limit).join(' · ')
}
