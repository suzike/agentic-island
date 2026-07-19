// Plan 分区 v3：集中审阅所有待批的实施计划（与 Agents 页的计划卡同源同交互）。
// 设计系统重做：ui/tokens + lucide 图标 + framer-motion 入场；交互逻辑不变。
// 触发条件：Claude Code 计划模式（Shift+Tab 切到 plan mode）下 Claude 提交计划（ExitPlanMode）。
// 无真实计划时可跑 `npm run demo:plan` 在本机注入一条演示计划，看真实交互长什么样。

import { motion } from 'framer-motion'
import { ArrowUpRight, Check, ClipboardList, Clock, Undo2 } from 'lucide-react'
import type { AgentVM } from '../types'
import { Markdown, Collapsible } from './Markdown'
import { Button, EmptyState } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, fill, FS, ink, R, semBg, SP, surface, text } from '../ui/tokens'

interface PlanTabProps {
  /** 待审阅的计划（agents 里 isPlan 的待审批项） */
  plans: AgentVM[]
  onDecide: (a: AgentVM, d: 'allow' | 'deny') => void
  onJump: (a: AgentVM) => void
  waitSecs: Record<string, number>
}

const fmtWait = (secs: number): string => `已等待 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

export function PlanTab(p: PlanTabProps): React.JSX.Element {
  if (p.plans.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="暂无待审阅的计划"
        desc="在 Claude Code 里按 Shift+Tab 切到计划模式，Claude 提交实施方案时会弹到这里，你可以批准或打回继续规划。"
        action={
          <div style={{ ...surface.inset(), padding: '7px 13px', color: accent(0.78), fontSize: FS.tiny, fontFamily: "ui-monospace,'Cascadia Code',monospace" }}>
            想先看看效果？项目目录里运行：npm run demo:plan
          </div>
        }
        style={{ padding: `${SP.xxl - 4}px ${SP.lg}px` }}
      />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {p.plans.map((a) => {
        const wait = (a.requestId && p.waitSecs[a.requestId]) || 0
        return (
          <motion.div
            key={a.id}
            variants={fadeScaleIn}
            initial="initial"
            animate="animate"
            style={{
              display: 'flex', flexDirection: 'column', gap: 8, padding: `${SP.md}px ${SP.md + 1}px`,
              borderRadius: R.lg,
              background: 'linear-gradient(180deg, oklch(0.26 0.035 var(--th) / .55), oklch(0.22 0.03 var(--th) / .45))',
              border: `0.5px solid ${accent(0.7, 0.35)}`,
              boxShadow: `0 8px 24px -10px ${accent(0.5, 0.3)}`
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: semBg(accent(), 0.14), color: accent(), flex: 'none' }}>
                <ClipboardList size={13} strokeWidth={1.75} />
              </div>
              <span style={{ color: accent(0.92, 0.95), fontSize: FS.body, fontWeight: 700 }}>实施计划待审阅</span>
              <span style={{ ...text.mono(10), background: fill(2), padding: '1px 7px', borderRadius: R.sm }}>{a.tool} · {a.proj}</span>
              {wait > 0 && (
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: ink(3), fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                  <Clock size={10} strokeWidth={2} />{fmtWait(wait)}
                </span>
              )}
            </div>
            <div style={{ ...surface.inset(), padding: '9px 11px' }}>
              <Collapsible collapsedHeight={220}>
                <Markdown text={a.command || '(计划内容为空)'} />
              </Collapsible>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" icon={Check} onClick={() => p.onDecide(a, 'allow')} style={{ flex: 1 }}>批准计划，开始执行</Button>
              <Button variant="ghost" icon={Undo2} onClick={() => p.onDecide(a, 'deny')} style={{ flex: 1 }}>打回，继续规划</Button>
              <Button variant="ghost" icon={ArrowUpRight} title="跳转到终端" onClick={() => p.onJump(a)} />
            </div>
            <div style={{ ...text.faint(), fontSize: 9.5 }}>快捷键：<b style={{ color: ink(2) }}>Y</b> 批准 · <b style={{ color: ink(2) }}>N</b> 继续规划</div>
          </motion.div>
        )
      })}
    </div>
  )
}
