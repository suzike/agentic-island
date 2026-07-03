// Plan 分区 v2：集中审阅所有待批的实施计划（与 Agents 页的计划卡同源同交互）。
// 触发条件：Claude Code 计划模式（Shift+Tab 切到 plan mode）下 Claude 提交计划（ExitPlanMode）。
// 无真实计划时可跑 `npm run demo:plan` 在本机注入一条演示计划，看真实交互长什么样。

import type { AgentVM } from '../types'
import { Markdown, Collapsible } from './Markdown'

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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '28px 16px', textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>◷</div>
        <div style={{ color: 'oklch(0.88 0.02 var(--th) / .9)', fontSize: 13, fontWeight: 600 }}>暂无待审阅的计划</div>
        <div style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 11.5, lineHeight: 1.7, maxWidth: 320 }}>
          在 Claude Code 里按 <b style={{ color: 'oklch(0.8 0.02 var(--th) / .8)' }}>Shift+Tab</b> 切到计划模式，Claude 提交实施方案时会弹到这里，你可以批准或打回继续规划。
        </div>
        <div style={{ padding: '7px 13px', borderRadius: 9, background: 'rgba(0,0,0,.3)', color: 'oklch(0.78 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontFamily: "ui-monospace,'Cascadia Code',monospace" }}>
          想先看看效果？项目目录里运行：npm run demo:plan
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {p.plans.map((a) => {
        const wait = (a.requestId && p.waitSecs[a.requestId]) || 0
        return (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 13px', borderRadius: 15, background: 'oklch(0.24 0.03 var(--th) / .5)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', animation: 'ai-fadein .25s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14 }}>📋</span>
              <span style={{ color: 'oklch(0.92 calc(0.05 * var(--cs, 1)) var(--th))', fontSize: 12.5, fontWeight: 700 }}>实施计划待审阅</span>
              <span style={{ color: 'oklch(0.75 0.04 var(--th) / .75)', fontSize: 10, fontFamily: 'ui-monospace,monospace', background: 'rgba(0,0,0,.28)', padding: '1px 7px', borderRadius: 6 }}>{a.tool} · {a.proj}</span>
              {wait > 0 && <span style={{ marginLeft: 'auto', color: 'oklch(0.72 0.02 var(--th) / .6)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>⏱ {fmtWait(wait)}</span>}
            </div>
            <div style={{ background: 'rgba(0,0,0,.28)', padding: '9px 11px', borderRadius: 9 }}>
              <Collapsible collapsedHeight={220}>
                <Markdown text={a.command || '(计划内容为空)'} />
              </Collapsible>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="hv" onClick={() => p.onDecide(a, 'allow')} style={{ flex: 1, textAlign: 'center', padding: 8, borderRadius: 999, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ 批准计划，开始执行</div>
              <div className="hv" onClick={() => p.onDecide(a, 'deny')} style={{ flex: 1, textAlign: 'center', padding: 8, borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.82 0.02 var(--th) / .85)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>↩ 打回，继续规划</div>
              <div className="hv" onClick={() => p.onJump(a)} title="跳转到终端" style={{ padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,.05)', color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 12, cursor: 'pointer' }}>↗</div>
            </div>
            <div style={{ color: 'oklch(0.6 0.02 var(--th) / .45)', fontSize: 9.5 }}>快捷键：<b style={{ color: 'oklch(0.75 0.02 var(--th) / .7)' }}>Y</b> 批准 · <b style={{ color: 'oklch(0.75 0.02 var(--th) / .7)' }}>N</b> 继续规划</div>
          </div>
        )
      })}
    </div>
  )
}
