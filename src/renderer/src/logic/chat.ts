// 真实 Q&A 的系统提示与响应解析 —— 移植自原型 systemFor(561-576) + parseBlocks(578-596)。
// 让模型只输出富文本块 JSON 数组，渲染层解析为 h/p/ul/code/note。

import type { Block, ChatMessage, QuoteRef } from '../types'

/**
 * 引用追问：把用户选中的若干片段（各带可选疑问）+ 本轮输入，组装成发给模型的完整提问。
 * 只影响发给 LLM 的文本；对话气泡仍分开展示（引用卡片 + 纯净问题）。
 */
export function buildQuotedPrompt(quotes: QuoteRef[], text: string): string {
  if (!quotes.length) return text
  const refs = quotes
    .map((q, i) => {
      const quoted = q.text.split('\n').map((l) => `> ${l}`).join('\n')
      const note = q.note && q.note.trim() ? `\n我的疑问：${q.note.trim()}` : ''
      return `【引用${i + 1}】\n${quoted}${note}`
    })
    .join('\n\n')
  const q = text.trim()
  // 无输入且引用也无疑问时，给一个默认追问，避免发出空问题
  const tail = q || (quotes.some((x) => x.note && x.note.trim()) ? '' : '请针对以上引用内容展开说明。')
  return `关于你上一条回复中的以下内容：\n\n${refs}${tail ? `\n\n${tail}` : ''}`
}

/** 把富文本块还原为纯文本/Markdown（跳过思考过程），用于复制与多轮上下文 */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .filter((b) => b.t !== 'think')
    .map((b) => {
      if (b.t === 'h') return `## ${b.text || ''}`
      if (b.t === 'ul') return (b.items || []).map((i) => `- ${i}`).join('\n')
      if (b.t === 'code') return '```\n' + (b.text || '') + '\n```'
      return b.text || ''
    })
    .join('\n\n')
}

/** 从对话线程构建多轮上下文（最近 N 条，剔除 typing 占位） */
export function historyFromThread(msgs: ChatMessage[], limit = 12): { role: 'user' | 'assistant'; content: string }[] {
  return msgs
    .filter((m) => !m.typing)
    .map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.role === 'user' ? m.text || '' : blocksToText(m.blocks || [])
    }))
    .filter((m) => m.content.trim())
    .slice(-limit)
}

export function systemFor(key: string, deep = false): string {
  let base: string
  if (key === 'plan') {
    base = '你是编码 Agent，正在与用户讨论一项实施计划。请根据用户的反馈调整或解释计划，语气像协作的工程师。'
  } else if (key.startsWith('agent')) {
    base = '你是编码 Agent，正在某个代码仓库里工作。请根据用户的最新回复调整你的做法，给出更安全或更符合意图的方案，语气像协作的工程师。'
  } else {
    base = '你是嵌入 Windows 顶部灵动岛工具里的编程助手，服务专业工程师。回答要准确、面向工程实践。'
  }
  const blocks =
    '\n\n只输出一个 JSON 数组，不要任何数组以外的文字。每个元素是一个 block，t 取值：' +
    '"h"(小标题,含 text)、"p"(段落,含 text)、"ul"(要点列表,含 items 字符串数组)、"code"(代码/命令,含 text 可多行)、"note"(一句提示,含 text)' +
    (deep ? '、"think"(思考过程,含 text，可多段)' : '') +
    '。除非用户用英文提问，否则用简体中文。'
  if (deep) {
    return (
      base +
      '\n\n采用「深度思考」模式：先用若干个 "think" block 展示你的完整思考过程（拆解问题、列出方案与权衡、推理），' +
      '然后再给出详细、结构完整的回答（h/p/ul/code/note）。think blocks 必须放在最前面。回答要详尽、覆盖边界情况。' +
      blocks
    )
  }
  return base + '\n\n采用「快速」模式：直接给结论，整体控制在 2–5 个 block，简洁准确。' + blocks
}

export function parseBlocks(raw?: string): Block[] | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1)
  try {
    const arr = JSON.parse(t)
    if (!Array.isArray(arr) || !arr.length) return null
    const ok = ['h', 'p', 'ul', 'code', 'note', 'think']
    const blocks: Block[] = arr
      .filter((b: { t?: string }) => b && ok.includes(b.t as string))
      .map((b: { t: string; text?: unknown; items?: unknown }) => ({
        t: b.t as Block['t'],
        text: typeof b.text === 'string' ? b.text : '',
        items: Array.isArray(b.items) ? b.items.map((x) => String(x)) : []
      }))
    return blocks.length ? blocks : null
  } catch {
    return null
  }
}
