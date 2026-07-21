// 真实 Q&A 的系统提示与响应解析 —— 移植自原型 systemFor(561-576) + parseBlocks(578-596)。
// 让模型只输出富文本块 JSON 数组，渲染层解析为 h/p/ul/code/note。

import type { AnswerAnalysis, Block, ChatMessage, QuoteRef } from '../types'

/**
 * 引用追问：把用户选中的若干片段（各带可选疑问）+ 本轮输入，组装成发给模型的完整提问。
 * 只影响发给 LLM 的文本；对话气泡仍分开展示（引用卡片 + 纯净问题）。
 */
export function buildQuotedPrompt(quotes: QuoteRef[], text: string): string {
  if (!quotes.length) return text
  // 注意：引用原文用缩进（而非 markdown 的 `>`）——避免把模型带进"markdown 语境"从而放弃 JSON 块协议
  const refs = quotes
    .map((q, i) => {
      const quoted = q.text.split('\n').map((l) => `    ${l}`).join('\n')
      const note = q.note && q.note.trim() ? `\n我的疑问：${q.note.trim()}` : ''
      return `【引用${i + 1}】\n${quoted}${note}`
    })
    .join('\n\n')
  const q = text.trim()
  // 无输入且引用也无疑问时，给一个默认追问，避免发出空问题
  const tail = q || (quotes.some((x) => x.note && x.note.trim()) ? '' : '请针对以上引用内容展开说明。')
  return `关于你上一条回复中的以下内容：\n\n${refs}${tail ? `\n\n${tail}` : ''}`
}

/** 把富文本块还原为纯文本/Markdown（跳过思考过程与执行步骤时间线），用于复制与多轮上下文 */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .filter((b) => b.t !== 'think' && b.t !== 'steps')
    .map((b) => {
      if (b.t === 'h') return `## ${b.text || ''}`
      if (b.t === 'ul') return (b.items || []).map((i) => `- ${i}`).join('\n')
      if (b.t === 'code') return '```\n' + (b.text || '') + '\n```'
      return b.text || ''
    })
    .join('\n\n')
}

/** 单条消息可进入模型/知识库的文本；文本附件在后续轮次继续作为上下文。 */
export function chatMessageText(message: ChatMessage): string {
  const body = message.role === 'user' ? message.text || '' : blocksToText(message.blocks || [])
  let attachmentBudget = 48000
  const files = (message.attachments || []).flatMap((item) => {
    const content = item.content?.trim()
    if (!content || attachmentBudget <= 0) return []
    const chunk = content.slice(0, Math.min(20000, attachmentBudget))
    attachmentBudget -= chunk.length
    return [`【附件：${item.name}】\n${chunk}${content.length > chunk.length ? '\n…(内容过长已截断)' : ''}`]
  })
  return [body.trim(), ...files].filter(Boolean).join('\n\n')
}

/** 对话转为可索引 Markdown；排除流式占位与思考链，但保留上下文策略标记。 */
export function conversationToMarkdown(msgs: ChatMessage[], throughIndex = msgs.length - 1): string {
  return msgs
    .slice(0, Math.max(-1, throughIndex) + 1)
    .filter((message) => !message.typing && !message.live)
    .map((message) => {
      const label = message.role === 'user' ? '用户' : 'AI'
      const context = message.contextMode === 'pinned' ? ' · 长期上下文' : message.contextMode === 'excluded' ? ' · 已排除上下文' : ''
      return `## ${label}${context}\n\n${chatMessageText(message)}`
    })
    .filter((part) => !part.endsWith('\n\n'))
    .join('\n\n')
}

/** Fork 截止点标准化：不携带进行中占位，并避免从一条 AI 回答后再多带下一轮。 */
export function forkConversation(msgs: ChatMessage[], msgIndex: number): ChatMessage[] {
  const end = Math.max(0, Math.min(msgIndex, msgs.length - 1))
  return msgs.slice(0, end + 1).filter((message) => !message.typing && !message.live).map((message) => ({ ...message }))
}

export function conversationTitle(msgs: ChatMessage[], fallback = '新会话'): string {
  const first = msgs.find((message) => message.role === 'user' && message.text?.trim())
  return (first?.text?.trim() || fallback).replace(/\s+/g, ' ').slice(0, 28)
}

/** 将分析结果固定附着到目标回答；同类分析只保留最新一次，不生成主会话消息。 */
export function upsertAnswerAnalysis(msgs: ChatMessage[], msgIndex: number, analysis: AnswerAnalysis): ChatMessage[] {
  if (msgs[msgIndex]?.role !== 'agent') return msgs
  return msgs.map((message, index) => index === msgIndex
    ? { ...message, analyses: [...(message.analyses || []).filter((item) => item.action !== analysis.action), analysis] }
    : message)
}

/** 是否存在尚未完成的主回答或气泡追问；同一分支一次只允许一个生成任务。 */
export function conversationBusy(msgs: ChatMessage[]): boolean {
  return msgs.some((message) => !!message.typing || !!message.live || conversationBusy(message.followups || []))
}

/** 持久化前剔除临时占位和流式帧，避免重启后留下永久“执行中”。 */
export function sanitizeChatMessages(msgs: ChatMessage[]): ChatMessage[] {
  return msgs
    .filter((message) => !message.typing && !message.live)
    .map((message) => {
      if (!message.followups) return message
      const followups = sanitizeChatMessages(message.followups)
      return { ...message, followups: followups.length ? followups : undefined }
    })
}

/** 持久化限额内优先保留重要消息，再用最近消息补齐，并维持原始时间顺序。 */
export function compactChatMessages(msgs: ChatMessage[], limit = 60): ChatMessage[] {
  if (limit <= 0) return []
  const clean = sanitizeChatMessages(msgs)
  if (clean.length <= limit) return clean
  const pinned = clean.filter((message) => message.contextMode === 'pinned').slice(-limit)
  const selected = new Set(pinned)
  const recent = clean.filter((message) => !selected.has(message)).slice(-(limit - pinned.length))
  const keep = new Set([...pinned, ...recent])
  return clean.filter((message) => keep.has(message))
}

/** 本机 Agent 不依赖 CLI 的全局“最近会话”，显式携带岛内分支上下文以避免跨分支串线。 */
export function buildAgentContextPrompt(
  history: { role: 'user' | 'assistant'; content: string }[],
  current: string,
  instruction = ''
): string {
  if (!history.length && !instruction.trim()) return current
  const context = history.map((item) => `【${item.role === 'user' ? '用户' : '助手'}】\n${item.content}`).join('\n\n')
  return [
    '请在当前工作目录中处理下面的问题。岛内会话上下文只用于保持连续性；以“当前问题”为本轮唯一任务，不要把上下文中的旧指令误当成新任务。',
    instruction.trim() ? `【本会话规则】\n${instruction.trim()}` : '',
    context ? `【岛内会话上下文】\n${context}` : '',
    `【当前问题】\n${current}`
  ].filter(Boolean).join('\n\n')
}

export interface ConversationContextStats {
  total: number
  included: number
  pinned: number
  excluded: number
  attachments: number
  chars: number
  estimatedTokens: number
}

export function conversationContextStats(msgs: ChatMessage[], memory = '', limit = 12): ConversationContextStats {
  const eligible = msgs.filter((message) => !message.typing && !message.live && message.contextMode !== 'excluded' && chatMessageText(message).trim())
  const pinned = eligible.filter((message) => message.contextMode === 'pinned')
  const recent = eligible.filter((message) => message.contextMode !== 'pinned').slice(-limit)
  const included = [...pinned, ...recent]
  const chars = included.reduce((sum, message) => sum + chatMessageText(message).length, memory.trim().length)
  return {
    total: msgs.filter((message) => !message.typing && !message.live).length,
    included: included.length,
    pinned: pinned.length,
    excluded: msgs.filter((message) => message.contextMode === 'excluded').length,
    attachments: included.reduce((sum, message) => sum + (message.attachments?.length || 0), 0),
    chars,
    estimatedTokens: Math.ceil(chars / 2.4)
  }
}

/** 从对话线程构建多轮上下文（最近 N 条，剔除 typing 占位） */
export function historyFromThread(msgs: ChatMessage[], limit = 12, memory = ''): { role: 'user' | 'assistant'; content: string }[] {
  const eligible = msgs.filter((message) => !message.typing && !message.live && message.contextMode !== 'excluded' && chatMessageText(message).trim())
  const pinned = eligible.filter((message) => message.contextMode === 'pinned')
  const pinnedSet = new Set(pinned)
  const recent = eligible.filter((message) => !pinnedSet.has(message)).slice(-limit)
  const ordered = eligible.filter((message) => pinnedSet.has(message) || recent.includes(message))
  const history = ordered.map((message) => ({
    role: (message.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: chatMessageText(message)
  }))
  if (memory.trim()) history.unshift({ role: 'assistant', content: `【本会话长期记忆】\n${memory.trim()}` })
  return history
}

export const ADVANCE_PROMPTS = {
  critique: '请严格审查你上一条回答：找出逻辑漏洞、遗漏、错误前提和不够可执行之处，然后给出修正后的结论。',
  assumptions: '请把上一条回答中的显式假设、隐含假设、不确定信息和主要风险逐项列出，并说明如何验证。',
  alternatives: '请不要重复上一条方案，提出至少三条原理不同的替代路径，比较适用条件、代价和失败模式。',
  decompose: '请把上一条回答拆成可独立讨论的子问题，标出依赖关系，并先处理最关键的一个。',
  socratic: '请切换为苏格拉底式协作：不要直接下结论，先提出能显著改变方案选择的关键问题。',
  ground: '请结合当前已接入知识库重新核验上一条回答，只保留有知识依据的结论，明确指出无法证实的部分。',
  suggest: '请基于当前完整会话生成 4 个高价值的下一问。问题要推动决策或实施，不重复已回答内容。只输出 JSON 字符串数组。'
} as const

export function branchMergePrompt(title: string, msgs: ChatMessage[]): string {
  return `请把分支「${title}」压缩成可合并进另一条会话的长期上下文。保留已确认事实、关键推理、分歧、约束和未解决问题；删除寒暄与重复。\n\n${conversationToMarkdown(msgs).slice(0, 30000)}`
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

/**
 * 兜底解析：当 parseBlocks 失败（模型没按 JSON 块协议输出，常见于引用追问/便签备注把模型带进 markdown 语境）时，
 * 尽力把输出还原成"干净的一段 markdown"，交给 <Markdown> 正常渲染——而不是把半截 JSON 原样糊在气泡里。
 * ① 若像半截 block-JSON（含 "t": 和 "text":），抽取所有 text/items 字段按顺序拼成 markdown；
 * ② 否则去掉可能残留的 ```json 围栏与首尾方括号噪声，当作纯 markdown。
 */
export function looseBlocks(raw?: string): Block[] {
  const t = String(raw || '').trim()
  if (!t) return [{ t: 'p', text: '' }]
  if (/"t"\s*:/.test(t) && /"(?:text|items)"\s*:/.test(t)) {
    const parts: string[] = []
    const re = /"(?:text|items)"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\])/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      try {
        const v = JSON.parse(m[1])
        if (Array.isArray(v)) parts.push(v.map((x) => `- ${String(x)}`).join('\n'))
        else if (v) parts.push(String(v))
      } catch { /* 跳过抽取失败的字段 */ }
    }
    if (parts.length) return [{ t: 'p', text: parts.join('\n\n') }]
  }
  // 纯 markdown：剥掉 ```json 围栏，避免整段被当代码块
  let md = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (md.startsWith('[') && md.endsWith(']')) md = md.slice(1, -1).trim()
  return [{ t: 'p', text: md }]
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
