// 飞书日历接入（零权限方案）：拉取用户的 ICS 订阅链接（飞书日历 → 设置 → 导出/订阅），
// 解析 VEVENT 为未来 7 天内的会议列表。支持：UTC(Z)/TZID 本地时间/全天(VALUE=DATE)、
// 简单周期会议（RRULE FREQ=DAILY/WEEKLY + INTERVAL/BYDAY/UNTIL/COUNT）与 EXDATE 排除。
// 如实局限：MONTHLY/YEARLY 周期不展开（会议场景罕见）；TZID 按本机时区解释（国内使用无碍）。

import type { CalendarEvent } from '../shared/protocol'

const WINDOW_MS = 7 * 24 * 3600_000
const MAX_OCCUR = 90

// ---- ICS 基础解析 ----

/** 展开折行（RFC5545：续行以空格/Tab 开头）并拆成行 */
const unfold = (text: string): string[] =>
  text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')

/** 解析一行 "KEY;PARAM=V:value" → { key, params, value } */
const parseLine = (line: string): { key: string; params: Record<string, string>; value: string } | null => {
  const colon = line.indexOf(':')
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const parts = head.split(';')
  const key = parts[0].toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1)
  }
  return { key, params, value }
}

/** ICS 时间 → 毫秒时间戳。Z=UTC；带 TZID/无后缀=按本机时区；YYYYMMDD=全天（本地零点） */
const parseIcsTime = (value: string): { ts: number; allDay: boolean } | null => {
  let m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m
    const ts = z
      ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
      : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime()
    return { ts, allDay: false }
  }
  m = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return { ts: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true }
  return null
}

/** 从 URL/LOCATION/DESCRIPTION 提取会议链接（飞书 vc 优先，兼容 zoom/meet/teams） */
const extractLink = (...fields: string[]): string => {
  const re = /https:\/\/(?:vc\.feishu\.cn|[\w.-]*larksuite\.com\/vc|[\w.-]*zoom\.us\/j|meet\.google\.com|teams\.microsoft\.com\/l\/meetup-join)[^\s"'<>\\]*/i
  for (const f of fields) {
    const m = (f || '').match(re)
    if (m) return m[0]
  }
  return ''
}

// ---- RRULE 展开（DAILY/WEEKLY） ----

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

const expandRrule = (rrule: string, start: number, dur: number, exdates: Set<number>, now: number): { start: number; end: number }[] => {
  const rules: Record<string, string> = {}
  for (const kv of rrule.split(';')) {
    const eq = kv.indexOf('=')
    if (eq > 0) rules[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1)
  }
  const freq = rules['FREQ']
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return [] // 其余频率不展开（如实局限）
  const interval = Math.max(1, parseInt(rules['INTERVAL'] || '1', 10))
  const until = rules['UNTIL'] ? (parseIcsTime(rules['UNTIL'])?.ts ?? Infinity) : Infinity
  const count = rules['COUNT'] ? parseInt(rules['COUNT'], 10) : Infinity
  const bydays = freq === 'WEEKLY'
    ? (rules['BYDAY'] || '').split(',').map((d) => BYDAY[d.trim()]).filter((d) => d !== undefined)
    : []
  const windowEnd = now + WINDOW_MS

  const out: { start: number; end: number }[] = []
  let occurrences = 0
  const dayMs = 24 * 3600_000
  // 逐日推进（窗口最多 7 天 + 历史，上限步数防御）
  const stepStart = new Date(start)
  for (let i = 0; i < 3660 && occurrences < count; i++) {
    const cur = new Date(stepStart.getFullYear(), stepStart.getMonth(), stepStart.getDate() + i, stepStart.getHours(), stepStart.getMinutes(), stepStart.getSeconds()).getTime()
    if (cur > until || cur > windowEnd) break
    let hit = false
    if (freq === 'DAILY') {
      hit = i % interval === 0
    } else {
      // WEEKLY：按周间隔 + BYDAY（缺省=DTSTART 当天的星期）
      const weeks = Math.floor(i / 7)
      const dow = new Date(cur).getDay()
      const days = bydays.length ? bydays : [new Date(start).getDay()]
      hit = weeks % interval === 0 && days.includes(dow)
    }
    if (!hit) continue
    occurrences++
    if (exdates.has(cur)) continue
    if (cur + dur >= now - 3600_000) out.push({ start: cur, end: cur + dur })
    if (out.length >= MAX_OCCUR) break
  }
  return out
}

// ---- 主入口 ----

export function parseIcs(text: string, now: number = Date.now()): CalendarEvent[] {
  const lines = unfold(text)
  const events: CalendarEvent[] = []
  let cur: Record<string, { params: Record<string, string>; value: string }[]> | null = null

  const flush = (ev: NonNullable<typeof cur>): void => {
    const get = (k: string): { params: Record<string, string>; value: string } | undefined => ev[k]?.[0]
    const dtstart = get('DTSTART')
    if (!dtstart) return
    const st = parseIcsTime(dtstart.value)
    if (!st) return
    const dtend = get('DTEND') ? parseIcsTime(get('DTEND')!.value) : null
    const dur = dtend ? Math.max(0, dtend.ts - st.ts) : st.allDay ? 24 * 3600_000 : 3600_000
    // 反转义 ICS 文本（\n \, \;）
    const unesc = (s: string): string => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
    const title = unesc(get('SUMMARY')?.value || '(无标题)')
    const location = unesc(get('LOCATION')?.value || '')
    const desc = unesc(get('DESCRIPTION')?.value || '')
    const link = extractLink(get('URL')?.value || '', location, desc)
    const uid = get('UID')?.value || `${title}-${st.ts}`
    const exdates = new Set<number>()
    for (const ex of ev['EXDATE'] || []) {
      for (const v of ex.value.split(',')) {
        const t = parseIcsTime(v.trim())
        if (t) exdates.add(t.ts)
      }
    }
    const rrule = get('RRULE')?.value
    const spans = rrule
      ? expandRrule(rrule, st.ts, dur, exdates, now)
      : st.ts + dur >= now - 3600_000 && st.ts <= now + WINDOW_MS
        ? [{ start: st.ts, end: st.ts + dur }]
        : []
    for (const s of spans) {
      events.push({ id: `${uid}@${s.start}`, title, start: s.start, end: s.end, allDay: st.allDay, link: link || undefined, location: location || undefined })
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (line === 'BEGIN:VEVENT') { cur = {} }
    else if (line === 'END:VEVENT') { if (cur) flush(cur); cur = null }
    else if (cur) {
      const p = parseLine(line)
      if (p) (cur[p.key] = cur[p.key] || []).push({ params: p.params, value: p.value })
    }
  }
  return events.sort((a, b) => a.start - b.start).slice(0, 120)
}

/** 拉取并解析 ICS 订阅链接（webcal:// 自动转 https://） */
export async function fetchIcs(url: string): Promise<CalendarEvent[]> {
  const real = url.replace(/^webcal:\/\//i, 'https://')
  const { net } = await import('electron')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await net.fetch(real, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    // 常见错误：贴的是「分享日历」网页链接（返回 HTML），不是 ICS 数据 —— 如实报错并给出正确路径
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('该链接返回的是网页而非日历数据。「分享日历」链接不行——请在飞书日历 → 该日历的 设置 → 「其他日历应用订阅（导出日历）」里复制 .ics/webcal 地址')
    }
    return parseIcs(text)
  } finally {
    clearTimeout(timer)
  }
}
