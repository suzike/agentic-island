// RSS 资讯的 AI 智能体逻辑：内置源预设 + 批量增强（价值分/点评/分类）+ AI 日报。
// 参考 aihot.virxact.com 的形态：每条资讯带热度分与一句话有观点的点评，按天时间线，可生成日报。

import type { FeedItem, FeedSource } from '../types'

/** 内置源预设（一键启停；也可添加任意自定义 RSS/Atom 链接）。含高质量个人技术博客。 */
export const PRESET_FEEDS: FeedSource[] = [
  { id: 'ithome', name: 'IT之家', url: 'https://www.ithome.com/rss/', enabled: true },
  { id: '36kr', name: '36氪', url: 'https://36kr.com/feed', enabled: false },
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed', enabled: false },
  { id: 'ruanyf', name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', enabled: true },
  { id: 'hn', name: 'Hacker News', url: 'https://hnrss.org/frontpage', enabled: true },
  { id: 'v2ex', name: 'V2EX', url: 'https://www.v2ex.com/index.xml', enabled: false },
  { id: 'decoder', name: 'The Decoder (AI)', url: 'https://the-decoder.com/feed/', enabled: true },
  { id: 'mtp', name: 'MarkTechPost (AI)', url: 'https://www.marktechpost.com/feed/', enabled: false },
  { id: 'hf', name: 'HuggingFace Blog', url: 'https://huggingface.co/blog/feed.xml', enabled: true },
  { id: 'simonw', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', enabled: true },
  // 高质量个人技术博客
  { id: 'lilian', name: 'Lilian Weng (AI 深度)', url: 'https://lilianweng.github.io/index.xml', enabled: true },
  { id: 'chip', name: 'Chip Huyen (ML 工程)', url: 'https://huyenchip.com/feed.xml', enabled: false },
  { id: 'eugene', name: 'Eugene Yan (ML 系统)', url: 'https://eugeneyan.com/rss/', enabled: false },
  { id: 'raschka', name: 'Sebastian Raschka (LLM)', url: 'https://magazine.sebastianraschka.com/feed', enabled: false },
  { id: 'fowler', name: 'Martin Fowler (架构)', url: 'https://martinfowler.com/feed.atom', enabled: false },
  { id: 'atwood', name: 'Coding Horror', url: 'https://blog.codinghorror.com/rss/', enabled: false }
]

export const FEED_TAGS = ['模型', '产品', '行业', '论文', '技巧', '开发', '其它']

/** 默认关注方向（可在源管理面板编辑，注入评分提示词） */
export const DEFAULT_FEED_INTERESTS =
  '① 深度技术介绍/原理剖析；② 高质量高关注度的论文、软件工程方法论、开发技巧；③ AI 行业头等大事（新模型发布、重大能力突破）。' +
  '明确不关注：融资/估值/商业运作、人事变动、营销软文、娱乐八卦——这些一律低分。'

/** 逐条流水线提示：基于全文 一次产出 评分+分类+点评+详细总结（达标才写总结） */
export function processPrompt(item: FeedItem, fullText: string, interests: string, minScore: number): string {
  return (
    '你是极其严格的科技主编，为一位工程师逐篇审稿。他的口味：' + interests +
    '\n对下面这篇文章输出 JSON 对象（只输出 JSON）：' +
    `\n{"score":0-100,"tag":"模型|产品|行业|论文|技巧|开发|其它 之一","brief":"≤50字有观点的一句话点评","summary":"见下"}` +
    `\n- score：严格把关。不相关/浅尝辄止/融资商业新闻 <40；相关但普通 45-${minScore + 5}；深度技术/重要论文/重大模型发布 75+。宁缺毋滥。` +
    `\n- summary：仅当 score ≥ ${minScore} 时写 300-500 字 Markdown 详细总结，把全文核心内容提炼出来：` +
    '\n  ## 核心内容（2-3 句讲清这是什么、做了什么）；然后 4-6 条要点列表（保留关键技术细节/数字/方法）；最后一行 **对工程师的意义**。' +
    `\n  score < ${minScore} 时 summary 给空字符串 ""。` +
    `\n\n标题：${item.title}\n来源：${item.sourceName}\n\n正文（可能截断）：\n${fullText.slice(0, 6000)}`
  )
}

export function parseProcess(raw?: string): { score: number; tag: string; brief: string; summary: string } | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s === -1 || e === -1) return null
  try {
    const o = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(o.score) || 0))),
      tag: FEED_TAGS.includes(String(o.tag)) ? String(o.tag) : '其它',
      brief: String(o.brief || '').slice(0, 90),
      summary: String(o.summary || '')
    }
  } catch {
    return null
  }
}

/** 链接 → 去重 id（轻量哈希） */
export function linkId(link: string): string {
  let h = 0
  for (let i = 0; i < link.length; i++) h = ((h << 5) - h + link.charCodeAt(i)) | 0
  return 'f' + (h >>> 0).toString(36)
}

/** AI 批量增强提示：一次调用给 N 条打分/点评/分类（按用户关注方向打分） */
export function enrichPrompt(items: FeedItem[], interests: string): string {
  const list = items.map((it) => `${it.id}｜${it.title}｜${(it.desc || '').slice(0, 120)}`).join('\n')
  return (
    '你是资深科技编辑，为一位工程师筛选资讯。他的关注方向：' + interests +
    '\n给下面每条资讯：' +
    '\n- score：价值分 0-100，**以他的关注方向为准**（高度相关且有深度 80+，相关但一般 55-75，不相关/水文/营销 <40，坚决打低分不要客气）' +
    '\n- tag：从 [模型,产品,行业,论文,技巧,开发,其它] 中选一个' +
    '\n- brief：≤50 字的一句话点评，要有观点（为什么值得看/对谁有用），不要复述标题' +
    '\n只输出 JSON 数组：[{"id":"...","score":78,"tag":"模型","brief":"..."}]，中文。' +
    `\n\n资讯（id｜标题｜摘要）：\n${list}`
  )
}

/** 单条详细解读提示（展开时按需生成，结果缓存） */
export function summaryPrompt(item: FeedItem): string {
  return (
    '为这条资讯写一份 150-250 字的中文详细解读（Markdown）：' +
    '\n先用一句话说清"这是什么"；然后 2-4 个要点（- 列表，讲关键事实/数字/技术点）；最后一句"对你的意义"（读者是工程师/AI 从业者）。' +
    '\n只基于给出的信息合理概括，不要编造具体细节；信息不足就聚焦标题所述事实本身。' +
    `\n\n标题：${item.title}\n来源：${item.sourceName}\n原文摘要：${item.desc || '（无）'}`
  )
}

export function parseEnrich(raw?: string): { id: string; score: number; tag: string; brief: string }[] | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('[')
  const e = t.lastIndexOf(']')
  if (s === -1 || e === -1) return null
  try {
    const arr = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>[]
    if (!Array.isArray(arr)) return null
    return arr
      .map((o) => ({
        id: String(o.id || ''),
        score: Math.max(0, Math.min(100, Math.round(Number(o.score) || 0))),
        tag: FEED_TAGS.includes(String(o.tag)) ? String(o.tag) : '其它',
        brief: String(o.brief || '').slice(0, 90)
      }))
      .filter((x) => x.id)
  } catch {
    return null
  }
}

/** 抓取预筛：标题命中即不入库（融资/商业/人事/营销类，用户明确不要） */
const TITLE_BLOCK_RE = /(融资|投资|估值|上市|IPO|募资|营收|财报|股价|市值|收购|并购|裁员|离职|加盟|任命|人事|招聘|促销|优惠|折扣|降价|补贴|双1[12]|618|开售|预售|首销|直播带货|八卦|绯闻|明星|综艺)/
export function titleBlocked(title: string): boolean {
  return TITLE_BLOCK_RE.test(title)
}

/** AI 日报 v2（结构化）：每个要点挂来源文章 id，前端渲染成图文卡片并可一键定位到精选 */
export function dailyPrompt(items: FeedItem[]): string {
  const list = items
    .map((it) => `${it.id}｜${it.score ?? '?'}分｜${it.tag || ''}｜${it.title}｜${(it.brief || it.summary || '').replace(/\n/g, ' ').slice(0, 140)}`)
    .join('\n')
  return (
    '把今天的高分科技/AI 资讯编成一份日报。只输出一个 JSON 对象：' +
    '\n{"intro":"2-3 句导语，点出今天的主线与氛围","highlights":[{"id":"来源条目的 id","headline":"≤18 字的小标题","insight":"2-4 句解读：先讲清发生了什么（保留关键数字/技术点），再讲意味着什么"}],"outlook":"一句有味道的展望"}' +
    '\nhighlights 取 4-7 条最重要的，id 必须来自素材列表，观点鲜明，不要复述标题。中文。' +
    `\n\n素材（id｜分｜类｜标题｜摘要）：\n${list}`
  )
}

export interface DailyReport {
  intro: string
  highlights: { id: string; headline: string; insight: string }[]
  outlook: string
}

export function parseDaily(raw?: string): DailyReport | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s === -1 || e === -1) return null
  try {
    const o = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>
    const hl = Array.isArray(o.highlights) ? (o.highlights as Record<string, unknown>[]) : []
    const highlights = hl
      .map((h) => ({ id: String(h.id || ''), headline: String(h.headline || '').slice(0, 40), insight: String(h.insight || '') }))
      .filter((h) => h.headline && h.insight)
    if (!highlights.length) return null
    return { intro: String(o.intro || ''), highlights, outlook: String(o.outlook || '') }
  } catch {
    return null
  }
}
