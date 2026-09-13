// 定时自动化调度测试：触发窗口 / 宽限补跑 / 已触发防重 / 非法输入。
import assert from 'node:assert/strict'
import { automationDue } from '../src/renderer/src/logic/automation.ts'

const ok = (cond: unknown, msg: string): void => {
  if (cond) console.log(`✓ ${msg}`)
  else { console.error(`❌ ${msg}`); process.exit(1) }
}

// 基准时刻：2026-09-13 09:35:00（本地时区）
const at = (h: number, min: number, sec = 0): Date => new Date(2026, 8, 13, h, min, sec, 0)
const now = at(9, 35)
const rule = { enabled: true, time: '09:30', lastRunDay: undefined as string | undefined }

// 到达时刻后的窗口内触发
const due1 = automationDue(rule, now)
ok(due1.fire && due1.missed, '到达时刻 5 分钟后：触发并标记为补跑（超一个轮询周期）')
ok(automationDue(rule, at(9, 30, 10)).fire && !automationDue(rule, at(9, 30, 10)).missed, '刚到点（10 秒内）：触发且非补跑')

// 已触发防重：lastRunDay 为今天不再触发
ok(automationDue({ ...rule, lastRunDay: '2026-09-13' }, now).fire === false, '今天已触发：不再触发（dayKey 格式一致）')
ok(automationDue({ ...rule, lastRunDay: '2026-09-12' }, now).fire === true, '昨天触发过：今天仍触发')

// 宽限边界：30 分钟内补跑（missed=true），31 分钟不再触发
const due2 = automationDue(rule, at(9, 59, 30))
ok(due2.fire && due2.missed, '29.5 分钟时仍触发且标记补跑')
ok(automationDue(rule, at(10, 0, 1)).fire === false, '超过 30 分钟宽限：不再补跑')

// 时刻未到 / 恰好到达
ok(automationDue(rule, at(9, 30, 0)).fire && !automationDue(rule, at(9, 30, 0)).missed, '恰好在设定时刻：触发且非补跑')
ok(automationDue(rule, at(8, 59)).fire === false, '时刻未到：不触发')

// 禁用 / 非法输入
ok(automationDue({ ...rule, enabled: false }, now).fire === false, '禁用规则：不触发')
ok(automationDue({ ...rule, time: '' }, now).fire === false, '空时间：不触发')
ok(automationDue({ ...rule, time: '25:00' }, now).fire === false, '非法小时：不触发')
ok(automationDue({ ...rule, time: '9:5' }, now).fire === false, '分钟缺位格式：不触发')

// 宽限参数可调
ok(automationDue(rule, at(10, 0, 1), 60).fire, '自定义 60 分钟宽限：可补跑')

console.log('automation scheduling tests passed')
process.exit(0)
