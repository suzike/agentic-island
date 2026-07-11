// ICS 解析单测：UTC/本地/全天时间、折行、转义、vc 链接提取、RRULE WEEKLY 展开、EXDATE、窗口过滤。
// 运行：node --experimental-strip-types scripts/test-ics.ts

import { parseIcs } from '../src/main/calendar-ics.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

// 固定同一个绝对时刻：2026-07-02 02:00Z（北京 10:00），避免 CI 所在时区改变过滤窗口。
const NOW = Date.UTC(2026, 6, 2, 2, 0, 0)
const pad = (n: number): string => String(n).padStart(2, '0')
const icsLocal = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`

const today14 = new Date(2026, 6, 2, 14, 0)
const ics = [
  'BEGIN:VCALENDAR',
  // ① 普通会议：今天 14:00-15:00，本地时间 + TZID，描述里带 vc 链接（折行）
  'BEGIN:VEVENT',
  'UID:ev1',
  `DTSTART;TZID=Asia/Shanghai:${icsLocal(today14)}`,
  `DTEND;TZID=Asia/Shanghai:${icsLocal(new Date(2026, 6, 2, 15, 0))}`,
  'SUMMARY:项目评审\\, 二期',
  'DESCRIPTION:入会链接 https://vc.feishu.cn/j/1234567',
  ' 89 （折行续传）',
  'LOCATION:会议室A',
  'END:VEVENT',
  // ② UTC 时间：今天 02:30Z-03:00Z（北京 10:30-11:00）
  'BEGIN:VEVENT',
  'UID:ev2',
  'DTSTART:20260702T023000Z',
  'DTEND:20260702T030000Z',
  'SUMMARY:海外同步会',
  'END:VEVENT',
  // ③ 全天事件
  'BEGIN:VEVENT',
  'UID:ev3',
  'DTSTART;VALUE=DATE:20260703',
  'SUMMARY:团建日',
  'END:VEVENT',
  // ④ 每周例会（周三 09:30，DTSTART 6-24 周三）：窗口内应展开出 7-08 一次
  'BEGIN:VEVENT',
  'UID:ev4',
  `DTSTART;TZID=Asia/Shanghai:${icsLocal(new Date(2026, 5, 24, 9, 30))}`,
  `DTEND;TZID=Asia/Shanghai:${icsLocal(new Date(2026, 5, 24, 10, 0))}`,
  'RRULE:FREQ=WEEKLY;BYDAY=WE',
  'SUMMARY:周例会',
  'END:VEVENT',
  // ④b 同样的周例会但 EXDATE 排除 7-08 → 窗口内应为 0 次
  'BEGIN:VEVENT',
  'UID:ev4b',
  `DTSTART;TZID=Asia/Shanghai:${icsLocal(new Date(2026, 5, 24, 9, 30))}`,
  `DTEND;TZID=Asia/Shanghai:${icsLocal(new Date(2026, 5, 24, 10, 0))}`,
  'RRULE:FREQ=WEEKLY;BYDAY=WE',
  `EXDATE;TZID=Asia/Shanghai:${icsLocal(new Date(2026, 6, 8, 9, 30))}`,
  'SUMMARY:被排除的例会',
  'END:VEVENT',
  // ⑤ 早已结束的旧会议：应被窗口过滤
  'BEGIN:VEVENT',
  'UID:ev5',
  'DTSTART:20260601T020000Z',
  'DTEND:20260601T030000Z',
  'SUMMARY:上月的会',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const events = parseIcs(ics, NOW)
const byTitle = (t: string) => events.filter((e) => e.title.includes(t))

const review = byTitle('项目评审')[0]
ok(!!review, '① 普通会议解析成功')
ok(review?.title === '项目评审, 二期', `转义 \\, 还原（实际：${review?.title}）`)
ok(review?.start === today14.getTime(), 'TZID 本地时间正确')
ok(review?.link === 'https://vc.feishu.cn/j/123456789', `折行拼接 + vc 链接提取（实际：${review?.link}）`)
ok(review?.location === '会议室A', 'LOCATION 解析')

const utc = byTitle('海外同步会')[0]
ok(utc?.start === Date.UTC(2026, 6, 2, 2, 30), 'UTC(Z) 时间正确')

const allday = byTitle('团建日')[0]
ok(!!allday && allday.allDay === true, '全天事件识别')

// 窗口 = NOW-1h ~ NOW+7d（7-02 09:00 ~ 7-09）：周三例会应恰好展开出 7-08 一次
const weekly = events.filter((e) => e.title === '周例会')
ok(weekly.length === 1, `RRULE WEEKLY 窗口内展开 1 次（实际 ${weekly.length}）`)
ok(weekly[0] && new Date(weekly[0].start).getDate() === 8 && new Date(weekly[0].start).getDay() === 3, `展开日为 7-08 周三 09:30（实际：${weekly[0] && new Date(weekly[0].start).toLocaleString()}）`)
ok(byTitle('被排除的例会').length === 0, 'EXDATE 排除后窗口内 0 次')

ok(byTitle('上月的会').length === 0, '过期事件被窗口过滤')
ok(events.every((e, i, arr) => i === 0 || arr[i - 1].start <= e.start), '按开始时间排序')

console.log(failed === 0 ? '\n✅ ICS 解析全部通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
