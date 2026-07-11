// 第二大脑：跨分区（便签/问答/复盘/资讯/剪贴板）统一检索。
// 无向量库——关键词预筛（CJK 2-gram + 拉丁词）取候选，再交 AI 重排+答疑并给出出处。

import type { ChatMessage, ClipItem, FeedItem, StickyNote } from '../types'
import { blocksToText } from './chat'

export type BrainTab = 'notes' | 'ask' | 'review' | 'news'

export interface BrainDoc {
  id: string
  source: string
  title: string
  text: string
  tab: BrainTab
}

export interface BrainSources {
  notes: StickyNote[]
  ask: ChatMessage[]
  reviews: Record<string, string>
  feed: FeedItem[]
  clips: ClipItem[]
}

/** 把各分区内容摊平成统一文档集 */
export function buildCorpus(s: BrainSources): BrainDoc[] {
  const docs: BrainDoc[] = []
  for (const n of s.notes) docs.push({ id: 'note:' + n.id, source: '便签', title: n.title || '便签', text: `${n.title} ${n.md} ${n.tags.join(' ')}`, tab: 'notes' })
  // 问答：把每个用户提问与其后的回答配对成一条
  for (let i = 0; i < s.ask.length; i++) {
    const m = s.ask[i]
    if (m.role === 'user' && m.text) {
      const ans = s.ask[i + 1] && s.ask[i + 1].role === 'agent' ? blocksToText(s.ask[i + 1].blocks || []) : ''
      docs.push({ id: 'ask:' + i, source: '问答', title: m.text.slice(0, 40), text: `${m.text}\n${ans}`, tab: 'ask' })
    }
  }
  for (const [k, v] of Object.entries(s.reviews)) {
    const label = k.startsWith('w:') ? '周报' : k.startsWith('m:') ? '晨间简报' : '复盘'
    docs.push({ id: 'review:' + k, source: label, title: `${label} ${k.slice(2)}`, text: v, tab: 'review' })
  }
  for (const f of s.feed) if (f.summary || f.brief) docs.push({ id: 'feed:' + f.id, source: '资讯', title: f.title, text: `${f.title}\n${f.summary || f.brief}`, tab: 'news' })
  for (const c of s.clips) if (c.fav && c.text) docs.push({ id: 'clip:' + c.id, source: '剪贴板', title: c.text.slice(0, 40), text: c.text, tab: 'ask' })
  return docs
}

/** 查询分词：拉丁词 + CJK 2-gram */
function terms(q: string): string[] {
  const s = q.toLowerCase().trim()
  const out = new Set<string>()
  for (const w of s.match(/[a-z0-9]+/g) || []) if (w.length >= 2) out.add(w)
  const cjk = s.match(/[一-龥]+/g) || []
  for (const seg of cjk) {
    if (seg.length === 1) out.add(seg)
    for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2))
  }
  return [...out]
}

/** 关键词预筛：按命中词数降序，取前 limit（无命中回退最近若干条） */
export function prefilter(docs: BrainDoc[], query: string, limit = 14): BrainDoc[] {
  const ts = terms(query)
  if (!ts.length) return docs.slice(0, limit)
  const scored = docs
    .map((d) => {
      const low = d.text.toLowerCase()
      let s = 0
      for (const t of ts) if (low.includes(t)) s++
      return { d, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  return (scored.length ? scored.map((x) => x.d) : docs).slice(0, limit)
}

export const BRAIN_SYSTEM =
  '你是用户的"第二大脑"检索助理。用户会给出一个问题，以及从他自己的便签/问答/复盘/资讯/剪贴板里检索到的候选片段（带编号）。' +
  '请只依据这些片段作答：先用 2-4 句直接回答，再用 Markdown 列出你引用了哪几条（形如「- [来源·标题]」）。' +
  '若候选里没有相关信息，直言"你的第二大脑里暂时没有相关记录"。简体中文，简洁。'

export function brainPrompt(query: string, docs: BrainDoc[]): string {
  const blocks = docs.map((d, i) => `【${i + 1}·${d.source}】${d.title}\n${d.text.slice(0, 500)}`).join('\n\n')
  return `问题：${query}\n\n候选片段：\n${blocks || '（无候选）'}`
}
