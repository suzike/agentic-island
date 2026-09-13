// RSS 解析测试（零依赖纯函数）：RSS 2.0 / Atom / CDATA / 实体 / 30 条上限 / 坏输入。
import { parseRss } from '../src/main/rss.ts'

let passed = 0
const ok = (cond: unknown, msg: string): void => {
  if (cond) { passed++ } else { console.error(`❌ ${msg}`); process.exit(1) }
}

const rss20 = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>源标题</title>
<item><title>普通条目</title><link>https://a.test/x</link><pubDate>Mon, 13 Sep 2026 08:00:00 GMT</pubDate><description>正文 &lt;b&gt;加粗&lt;/b&gt; 内容</description></item>
<item><title><![CDATA[CDATA 标题]]></title><link>https://a.test/y</link><description><![CDATA[带 <em>标签</em> 的描述]]></description></item>
<item><title>无日期</title><link>https://a.test/z</link></item>
</channel></rss>`

const r1 = parseRss(rss20)
ok(r1.length === 3, 'RSS 2.0：解析出全部条目')
ok(r1[0].title === '普通条目' && r1[0].link === 'https://a.test/x', 'RSS 2.0：标题与链接')
ok(r1[0].pubDate === Date.parse('2026-09-13T08:00:00Z'), 'RSS 2.0：pubDate 转时间戳')
ok(r1[0].desc === '正文 加粗 内容', 'RSS 2.0：描述剥实体与标签')
ok(r1[1].title === 'CDATA 标题' && r1[1].desc === '带 标签 的描述', 'RSS 2.0：CDATA 解包')
ok(r1[2].pubDate > 0, 'RSS 2.0：缺日期回退为当前时间')

const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom 条目</title><link rel="alternate" href="https://b.test/1"/><published>2026-09-12T10:00:00Z</published><summary>摘要文本</summary></entry>
<entry><title>无 alternate</title><link href="https://b.test/2"/></entry>
</feed>`
const r2 = parseRss(atom)
ok(r2.length === 2, 'Atom：解析 entry 条目')
ok(r2[0].link === 'https://b.test/1', 'Atom：优先 rel=alternate 链接')
ok(r2[0].pubDate === Date.parse('2026-09-12T10:00:00Z'), 'Atom：published 转时间戳')
ok(r2[1].link === 'https://b.test/2' && r2[1].desc === '', 'Atom：无摘要时为空、href 兜底')

const many = Array.from({ length: 40 }, (_, i) => `<item><title>t${i}</title><link>https://c.test/${i}</link></item>`).join('')
ok(parseRss(`<rss><channel>${many}</channel></rss>`).length === 30, '单源上限 30 条')

ok(parseRss('not xml at all').length === 0, '坏输入返回空数组')
ok(parseRss('<item><title>裸条目</title><link>https://d.test/1</link></item>').length === 1, '裸 item 也能解析')

console.log(`rss tests passed: ${passed}`)
