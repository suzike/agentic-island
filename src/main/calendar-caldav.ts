// 飞书日历 CalDAV 接入（官方支持的第三方同步方式）：
// 飞书 PC 端 → 头像 → 设置 → 日历 → CalDAV 同步 → 生成 用户名/密码/服务器地址。
// 流程（RFC4791 最小实现，零依赖）：
//   ① PROPFIND 服务器根 → current-user-principal
//   ② PROPFIND principal → calendar-home-set
//   ③ PROPFIND home (Depth:1) → 日历集合列表
//   ④ 对每个日历 REPORT calendar-query（未来 7 天 time-range）→ calendar-data(ICS) → 复用 parseIcs

import type { CalendarEvent } from '../shared/protocol'

export interface CaldavConfig {
  server: string
  username: string
  password: string
}

/** ICS 解析器由调用方注入（与 git-summary 相同的 DI 惯例：raw-node 测试无法解析无扩展名运行时 import） */
export type IcsParser = (text: string) => CalendarEvent[]

const DAV = (auth: string, method: string, url: string, depth: string, body: string): Promise<string> => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  return fetch(url, {
    method,
    signal: ctrl.signal,
    headers: {
      authorization: `Basic ${auth}`,
      depth,
      'content-type': 'application/xml; charset=utf-8'
    },
    body
  })
    .then(async (res) => {
      if (res.status === 401) throw new Error('认证失败（401）——请核对 CalDAV 用户名/密码（在飞书里重新生成一份）')
      if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`)
      return res.text()
    })
    .finally(() => clearTimeout(timer))
}

/** 从多状态 XML 里提取所有 <href>（命名空间前缀不定：D:/d:/无） */
const hrefsIn = (xml: string, aroundTag: string): string[] => {
  // 找 aroundTag 元素块，取其中的 href
  const out: string[] = []
  const re = new RegExp(`<[^>]*${aroundTag}[^>]*>([\\s\\S]*?)</[^>]*${aroundTag}[^>]*>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const h = m[1].match(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href[^>]*>/i)
    if (h) out.push(h[1].trim())
  }
  return out
}

/** ICS 时间戳（UTC，供 time-range） */
const icsUtc = (ts: number): string => {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00Z`
}

export async function fetchCaldav(cfg: CaldavConfig, parseIcs: IcsParser): Promise<CalendarEvent[]> {
  const base = cfg.server.replace(/\/+$/, '')
  const origin = new URL(base).origin
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')
  const abs = (href: string): string => (href.startsWith('http') ? href : origin + href)

  // ① principal
  const p1 = await DAV(auth, 'PROPFIND', base, '0', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>')
  const principal = hrefsIn(p1, 'current-user-principal')[0]
  // ② calendar home（principal 缺失时直接拿 base 当 home 试）
  let home = base
  if (principal) {
    const p2 = await DAV(auth, 'PROPFIND', abs(principal), '0', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>')
    const h = hrefsIn(p2, 'calendar-home-set')[0]
    if (h) home = abs(h)
  }
  // ③ 日历集合
  const p3 = await DAV(auth, 'PROPFIND', home, '1', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>')
  // 取带 <calendar/> resourcetype 的 response 的 href
  const calendars: string[] = []
  const respRe = /<[^>]*:?response[^>]*>([\s\S]*?)<\/[^>]*:?response>/gi
  let rm: RegExpExecArray | null
  while ((rm = respRe.exec(p3))) {
    const block = rm[1]
    if (/<[^>]*:?calendar\s*\/?>/i.test(block)) {
      const h = block.match(/<[^>]*:?href[^>]*>([^<]+)<\/[^>]*:?href[^>]*>/i)
      if (h) calendars.push(h[1].trim())
    }
  }
  if (calendars.length === 0) calendars.push(home) // 兜底：home 本身可能就是日历

  // ④ 逐日历：calendar-query 拿命中 time-range 的事件 href（飞书实测：query 不内联 calendar-data，
  //    calendar-data 返回 404，GET 单资源返回 403）→ ⑤ calendar-multiget 一次取回全部数据。
  const now = Date.now()
  const query =
    '<?xml version="1.0"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    '<d:prop><d:getetag/></d:prop>' +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${icsUtc(now - 24 * 3600_000)}" end="${icsUtc(now + 7 * 24 * 3600_000)}"/>` +
    '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'

  const all: CalendarEvent[] = []
  for (const cal of calendars.slice(0, 6)) {
    try {
      const qXml = await DAV(auth, 'REPORT', abs(cal), '1', query)
      const hrefs = [...qXml.matchAll(/<[^>]*:?href[^>]*>([^<]+\.ics)<\/[^>]*:?href[^>]*>/gi)].map((m) => m[1].trim()).slice(0, 60)
      if (hrefs.length === 0) continue
      const multiget =
        '<?xml version="1.0"?>' +
        '<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
        '<d:prop><c:calendar-data/></d:prop>' +
        hrefs.map((h) => `<d:href>${h}</d:href>`).join('') +
        '</c:calendar-multiget>'
      const xml = await DAV(auth, 'REPORT', abs(cal), '1', multiget)
      const dataRe = /<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data[^>]*>/gi
      let dm: RegExpExecArray | null
      while ((dm = dataRe.exec(xml))) {
        let ics = dm[1]
        const cdata = ics.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
        if (cdata) ics = cdata[1]
        all.push(...parseIcs(decodeXml(ics)))
      }
    } catch { /* 单个日历失败不影响其它 */ }
  }
  // 去重（同 uid+start 可能来自多个日历）+ 排序
  const seen = new Set<string>()
  return all
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.start - b.start)
    .slice(0, 120)
}

/** XML 实体解码（飞书把 ICS 以数字实体编码内联：&#xD;&#xA; 等） */
const decodeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
