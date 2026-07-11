import type { FeedItem, NewsWatch } from '../types'

const tokenText = (item: FeedItem): string => `${item.title} ${item.brief || ''} ${item.summary || ''} ${item.desc || ''} ${item.tag || ''}`.toLowerCase()

export function matchesWatch(item: FeedItem, watch: NewsWatch): boolean {
  if (!watch.enabled || (item.score ?? 0) < watch.minScore) return false
  const text = tokenText(item)
  if ((watch.excludes || []).some((word) => word.trim() && text.includes(word.trim().toLowerCase()))) return false
  const keywords = watch.keywords.map((word) => word.trim().toLowerCase()).filter(Boolean)
  return keywords.length > 0 && keywords.some((word) => text.includes(word))
}

export function watchMatches(items: FeedItem[], watches: NewsWatch[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const item of items) {
    const ids = watches.filter((watch) => matchesWatch(item, watch)).map((watch) => watch.id)
    if (ids.length) result.set(item.id, ids)
  }
  return result
}

export interface TrendPoint { day: string; total: number; high: number; tags: Record<string, number> }

export function intelligenceTrend(items: FeedItem[], days = 7, now = Date.now()): TrendPoint[] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return Array.from({ length: days }, (_, index) => {
    const from = start.getTime() - (days - 1 - index) * 86400_000
    const to = from + 86400_000
    const current = items.filter((item) => item.pubDate >= from && item.pubDate < to)
    const tags: Record<string, number> = {}
    for (const item of current) tags[item.tag || '其它'] = (tags[item.tag || '其它'] || 0) + 1
    const date = new Date(from)
    return { day: `${date.getMonth() + 1}/${date.getDate()}`, total: current.length, high: current.filter((item) => (item.score || 0) >= 75).length, tags }
  })
}

const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2))

export function relatedItems(target: FeedItem, items: FeedItem[], limit = 4): FeedItem[] {
  const targetWords = words(`${target.title} ${target.tag || ''}`)
  return items
    .filter((item) => item.id !== target.id)
    .map((item) => {
      const candidate = words(`${item.title} ${item.tag || ''}`)
      const overlap = [...targetWords].filter((word) => candidate.has(word)).length
      const score = overlap / Math.max(1, new Set([...targetWords, ...candidate]).size) + (item.tag && item.tag === target.tag ? 0.25 : 0)
      return { item, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.pubDate - a.item.pubDate)
    .slice(0, limit)
    .map((entry) => entry.item)
}

export function synthesisPrompt(items: FeedItem[], projectName?: string): string {
  const material = items.map((item, index) => `【${index + 1}】${item.title}\n来源：${item.sourceName}\n评分：${item.score ?? '未评分'}\n${item.summary || item.brief || item.desc || ''}\n链接：${item.link}`).join('\n\n')
  return `请综合以下 ${items.length} 条资讯${projectName ? `，结合项目“${projectName}”` : ''}形成情报简报。必须区分：共同事实、观点分歧、趋势判断、潜在风险、可执行动作；不要编造材料之外的事实。\n\n${material}`
}
