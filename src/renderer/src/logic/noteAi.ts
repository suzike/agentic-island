// 灵感便签的 AI 逻辑：内容 → 结构化便签（标题/emoji/Markdown/标签/配色）+ AI 增强搜索。

import type { StickyNote } from '../types'

/** 便签配色盘：色相令牌（卡片背景/边框由色相推导），AI 自动挑 + 用户可手动换 */
export const NOTE_COLORS: { key: string; label: string; h: number }[] = [
  { key: 'emerald', label: '青翠', h: 155 },
  { key: 'sky', label: '晴空', h: 230 },
  { key: 'violet', label: '星紫', h: 300 },
  { key: 'amber', label: '暖阳', h: 75 },
  { key: 'rose', label: '樱粉', h: 350 },
  { key: 'lime', label: '新芽', h: 120 },
  { key: 'coral', label: '珊瑚', h: 40 },
  { key: 'slate', label: '石板', h: 250 }
]

export const colorOf = (key: string): number => NOTE_COLORS.find((c) => c.key === key)?.h ?? 155

/** AI 生成便签的系统提示：把任意内容整理成图文并茂、排版优美的知识卡片 */
export function noteSystemPrompt(): string {
  return (
    '你是知识卡片整理师。把用户给的内容（文章/网页正文/段落/笔记）提炼成一张排版优美的知识便签。' +
    '\n只输出一个 JSON 对象（不要任何其它文字）：' +
    '\n{"emoji":"一个最贴切的 emoji","title":"简洁有力的标题(≤18字)","md":"Markdown 正文","tags":["标签1","标签2","标签3"],"color":"emerald|sky|violet|amber|rose|lime|coral|slate 之一"}' +
    '\nmd 排版要求：开头一句话核心观点（**加粗**）；然后用 ## 小节 + 要点列表提炼干货（保留关键数字/代码/命令，代码用 ``` 围栏）；' +
    '如原文有值得记的原句，用 > 引用；结尾一行"💡 启发"。总长 150–500 字，宁精炼勿冗长。' +
    '\ntags 恰好 2-4 个中文短标签（如：架构、效率、AI、管理）。color 按内容气质挑选。除非原文是英文，否则用简体中文。'
  )
}

/** 解析 AI 返回的便签 JSON（尽力而为，失败返回 null 由调用方兜底） */
export function parseAiNote(raw?: string): Pick<StickyNote, 'emoji' | 'title' | 'md' | 'tags' | 'color'> | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s === -1 || e === -1) return null
  try {
    const o = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.slice(0, 40) : ''
    const md = typeof o.md === 'string' ? o.md : ''
    if (!title || !md) return null
    return {
      emoji: typeof o.emoji === 'string' && o.emoji ? Array.from(o.emoji)[0] : '💡',
      title,
      md,
      tags: Array.isArray(o.tags) ? o.tags.map((x) => String(x).slice(0, 12)).filter(Boolean).slice(0, 4) : [],
      color: NOTE_COLORS.some((c) => c.key === o.color) ? String(o.color) : 'emerald'
    }
  } catch {
    return null
  }
}

/** AI 搜索提示：给出便签索引 + 查询，返回匹配 id 数组（语义匹配，不只是关键词） */
export function noteSearchPrompt(notes: StickyNote[], query: string): string {
  const index = notes
    .map((n) => `${n.id}｜${n.title}｜${n.tags.join(',')}｜${n.md.replace(/\n/g, ' ').slice(0, 60)}`)
    .join('\n')
  return (
    `根据用户的查询意图，在下面的便签索引里找出所有相关的便签（语义相关即可，不必字面匹配）。` +
    `\n只输出一个 JSON 数组，元素是便签 id 数字，按相关度排序，最多 12 个，没有则输出 []。` +
    `\n\n查询：${query}\n\n便签索引（id｜标题｜标签｜摘要）：\n${index}`
  )
}

export function parseSearchIds(raw?: string): number[] | null {
  if (!raw) return null
  const m = String(raw).match(/\[[\d,\s]*\]/)
  if (!m) return null
  try {
    const arr = JSON.parse(m[0])
    return Array.isArray(arr) ? arr.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : null
  } catch {
    return null
  }
}
