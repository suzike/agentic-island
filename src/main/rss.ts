// RSS 抓取与解析（零依赖）：支持 RSS 2.0 与 Atom。用 electron net.fetch（走系统代理）。
// 解析尽力而为：title/link/时间/摘要；单源上限 30 条，异常源如实报错不拖垮其它源。
// electron 延迟导入：parseRss 保持纯函数，可被 raw-node 测试直接加载（项目约定）。

export interface RssItem {
  title: string
  link: string
  pubDate: number
  desc: string
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

const stripTags = (s: string): string => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()

const tagText = (block: string, tag: string): string => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}

export function parseRss(xml: string): RssItem[] {
  const out: RssItem[] = []
  // RSS 2.0 <item> 或 Atom <entry>
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
  for (const b of blocks.slice(0, 30)) {
    const title = stripTags(tagText(b, 'title'))
    // 链接：RSS <link>text</link>；Atom <link href="..."/>（优先 rel=alternate）
    let link = decode(tagText(b, 'link'))
    if (!link || link.startsWith('<')) {
      const href = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i)
      link = href ? decode(href[1]) : ''
    }
    const dateRaw = tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date')
    const ts = dateRaw ? Date.parse(dateRaw.trim()) : NaN
    const desc = stripTags(tagText(b, 'description') || tagText(b, 'summary') || tagText(b, 'content')).slice(0, 300)
    if (title && link) out.push({ title, link: link.trim(), pubDate: Number.isFinite(ts) ? ts : Date.now(), desc })
  }
  return out
}

export async function fetchRss(url: string): Promise<RssItem[]> {
  const { net } = await import('electron')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await net.fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) agentic-island-rss', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    const items = parseRss(xml)
    if (!items.length && !/<(rss|feed|rdf)[\s>]/i.test(xml)) throw new Error('返回内容不是 RSS/Atom 订阅源')
    return items
  } finally {
    clearTimeout(timer)
  }
}
