import assert from 'node:assert/strict'
import type { FeedItem, NewsWatch } from '../src/renderer/src/types.ts'
import { intelligenceTrend, matchesWatch, relatedItems, synthesisPrompt, watchMatches } from '../src/renderer/src/logic/newsIntel.ts'

const now = new Date(2026, 6, 11, 12).getTime()
const items: FeedItem[] = [
  { id: '1', sourceName: 'A', title: 'Electron 发布安全更新', link: 'https://a/1', pubDate: now, score: 82, tag: '开发', brief: '修复 Chromium 漏洞' },
  { id: '2', sourceName: 'B', title: 'Electron 桌面应用性能实践', link: 'https://b/2', pubDate: now - 86400_000, score: 76, tag: '开发' },
  { id: '3', sourceName: 'C', title: '无关产品新闻', link: 'https://c/3', pubDate: now, score: 90, tag: '产品' }
]
const watch: NewsWatch = { id: 'w1', name: 'Electron', keywords: ['electron', 'chromium'], excludes: ['招聘'], minScore: 70, enabled: true, createdAt: now }
assert.equal(matchesWatch(items[0], watch), true)
assert.equal(watchMatches(items, [watch]).get('1')?.[0], 'w1')
assert.equal(intelligenceTrend(items, 2, now)[1].high, 2)
assert.equal(relatedItems(items[0], items)[0]?.id, '2')
assert.match(synthesisPrompt(items.slice(0, 2), '灵动岛'), /共同事实/)
console.log('news intelligence tests passed')
