// Agents 分区 v2 —— 精致化重做：状态胶囊 + 后端徽标 + 运行时长 + 活动轨迹时间线 +
// 卡片入场动效 + 状态色辉光。审批 / 计划审阅 / 等待回复 / 变更小结的交互逻辑保持不变。

import { useState } from 'react'
import type { AgentVM } from '../types'
import { riskOf } from '../logic/risk'
import { Markdown, Collapsible } from './Markdown'

interface AgentsTabProps {
  agents: AgentVM[]
  armed: Record<string, boolean>
  autoAllowSafe: boolean
  onToggleAutoAllow: () => void
  onDecide: (a: AgentVM, d: 'allow' | 'deny') => void
  onJump: (a: AgentVM) => void
  onCopyCommit: (id: string, commit: string) => void
  copiedId: string | null
  waitSecs: Record<string, number>
}

/** 后端徽标：Claude（渐变菱形◆）/ Codex（六边形⬢），桌面端叠加窗口角标 */
const BackendGlyph = ({ a }: { a: AgentVM }): React.JSX.Element => {
  const isCodex = a.backend === 'codex'
  const isApp = /桌面/.test(a.tool)
  return (
    <div style={{ position: 'relative', width: 22, height: 22, flex: 'none' }}>
      <div
        style={{
          width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
          background: isCodex
            ? 'linear-gradient(135deg, oklch(0.45 0.03 250), oklch(0.3 0.03 250))'
            : 'linear-gradient(135deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.58 calc(0.14 * var(--cs, 1)) var(--th2)))',
          color: isCodex ? 'oklch(0.9 0.02 250)' : 'oklch(0.14 0.02 var(--th))',
          boxShadow: isCodex ? 'none' : '0 2px 8px oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)'
        }}
      >
        {isCodex ? '⬢' : '◆'}
      </div>
      {isApp && (
        <div style={{ position: 'absolute', right: -3, bottom: -3, width: 10, height: 8, borderRadius: 2, background: 'oklch(0.2 0.02 var(--th))', border: '1px solid oklch(0.75 0.1 205)', overflow: 'hidden' }}>
          <div style={{ height: 2, background: 'oklch(0.75 0.1 205)' }} />
        </div>
      )}
    </div>
  )
}

const fmtWait = (secs: number): string => `已等待 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

/** 运行时长（自会话首次出现） */
const fmtElapsed = (startedAt?: number): string => {
  if (!startedAt) return ''
  const min = Math.floor((Date.now() - startedAt) / 60000)
  if (min < 1) return '刚开始'
  if (min < 60) return `${min} 分钟`
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`
}

const fmtClock = (ts: number): string => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function AgentsTab(props: AgentsTabProps): React.JSX.Element {
  const { agents } = props
  const active = agents.filter((a) => a.status !== 'done').length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {agents.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '26px 14px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.09)' }}>
          <div style={{ fontSize: 22, opacity: 0.55 }}>📡</div>
          <div style={{ color: 'oklch(0.82 0.02 var(--th) / .85)', fontSize: 12, fontWeight: 600 }}>暂无活动 Agent</div>
          <div style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 10.5, textAlign: 'center', lineHeight: 1.7 }}>
            在任意终端运行 Claude Code / Codex 即自动接入<br />命令审批 · 计划审阅 · 等待提醒 · 完成小结都会实时出现
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 2px' }}>
          <span style={{ color: 'oklch(0.68 0.02 var(--th) / .65)', fontSize: 10, fontWeight: 600, letterSpacing: '.05em' }}>
            {active} 个活动会话{agents.length > active ? ` · ${agents.length - active} 个已结束` : ''}
          </span>
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.05)' }} />
        </div>
      )}
      {agents.map((a) => (
        <AgentCard key={a.id} a={a} {...props} />
      ))}
    </div>
  )
}

function AgentCard({
  a,
  armed,
  autoAllowSafe,
  onToggleAutoAllow,
  onDecide,
  onJump,
  onCopyCommit,
  copiedId,
  waitSecs
}: { a: AgentVM } & Omit<AgentsTabProps, 'agents'>): React.JSX.Element {
  const [showTrail, setShowTrail] = useState(false)
  const decided = a.status === 'running' && (a.detail.includes('已允许') || a.detail.includes('已拒绝'))
  const showApproval = a.status === 'needs_approval' && !!a.requestId
  const risk = riskOf(a.command)
  const isArmed = !!(a.requestId && armed[a.requestId])
  const wait = (a.requestId && waitSecs[a.requestId]) || 0
  const waitEsc = wait >= 20

  const isWaiting = a.status === 'waiting'
  const isDone = a.status === 'done'
  const dot =
    a.status === 'needs_approval' || isWaiting ? 'oklch(0.8 0.13 75)' : isDone ? 'oklch(0.6 0.02 var(--th) / .7)' : 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))'
  const label = a.status === 'needs_approval' ? '待处理' : isWaiting ? '等待回复' : isDone ? '已结束' : '运行中'
  const highlight = showApproval || isWaiting
  // 状态胶囊配色
  const chipBg = highlight ? 'oklch(0.35 0.08 75 / .4)' : isDone ? 'rgba(255,255,255,.05)' : 'oklch(0.32 calc(0.06 * var(--cs, 1)) var(--th) / .45)'
  const chipFg = highlight ? 'oklch(0.88 0.11 75)' : isDone ? 'oklch(0.68 0.02 var(--th) / .7)' : 'oklch(0.85 calc(0.12 * var(--cs, 1)) var(--th))'
  const elapsed = fmtElapsed(a.startedAt)

  return (
    <div
      className={highlight ? undefined : 'ai-card'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 13px',
        borderRadius: 15,
        background: highlight
          ? 'linear-gradient(180deg, oklch(0.3 0.06 75 / .22), oklch(0.24 0.04 75 / .12))'
          : isDone
            ? 'rgba(255,255,255,.028)'
            : 'linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.035))',
        border: `1px solid ${highlight ? 'oklch(0.8 0.13 75 / .42)' : isDone ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.07)'}`,
        boxShadow: highlight ? '0 6px 22px -8px oklch(0.6 0.12 75 / .35)' : 'none',
        opacity: isDone ? 0.72 : 1,
        transition: 'all .25s ease',
        animation: 'ai-fadein .25s ease' // 纯淡入：ai-toast 的 translate(-50%) 会把卡片甩出面板再弹回
      }}
    >
      {/* 头部：徽标 + 名称/项目 + 时长 + 状态胶囊 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <BackendGlyph a={a} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 12.5, fontWeight: 700, letterSpacing: '.01em' }}>{a.tool}</span>
            <span style={{ color: 'oklch(0.75 0.04 var(--th) / .75)', fontSize: 10, fontFamily: "ui-monospace,'Cascadia Code',monospace", background: 'rgba(0,0,0,.28)', padding: '1px 7px', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{a.proj}</span>
          </div>
          {elapsed && <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 9 }}>已运行 {elapsed}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: chipBg, flex: 'none' }}>
          <div style={{ width: 6, height: 6, borderRadius: 999, background: dot, boxShadow: `0 0 7px ${dot}`, animation: isDone ? undefined : 'ai-dotpulse 2s ease-in-out infinite' }} />
          <span style={{ color: chipFg, fontSize: 10, fontWeight: 700 }}>{label}</span>
        </div>
      </div>
      {/* 状态描述：长内容（如 Agent 提问/最近消息）渲染 Markdown + 可折叠 */}
      {a.detail.length > 90 || a.detail.includes('\n') ? (
        <div style={{ color: 'oklch(0.78 0.02 var(--th) / .85)' }}>
          <Collapsible collapsedHeight={72}>
            <Markdown text={a.detail} />
          </Collapsible>
        </div>
      ) : (
        <div style={{ color: 'oklch(0.78 0.02 var(--th) / .85)', fontSize: 11.5, lineHeight: 1.5 }}>{a.detail}</div>
      )}

      {isWaiting && (
        <div style={{ marginTop: 3, padding: '9px 11px', borderRadius: 11, background: 'oklch(0.28 0.05 75 / .3)', border: '1px solid oklch(0.8 0.13 75 / .3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 13 }}>⏳</span>
            <span style={{ color: 'oklch(0.86 0.1 75)', fontSize: 11.5, fontWeight: 600 }}>正在等待你回复</span>
            <div className="hv" onClick={() => onJump(a)} style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 999, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>↗ 去终端回复</div>
          </div>
        </div>
      )}

      {showApproval && a.isPlan && (
        <div style={{ marginTop: 3, padding: '10px 11px', borderRadius: 11, background: 'oklch(0.24 0.03 var(--th) / .5)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>📋</span>
            <span style={{ color: 'oklch(0.88 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 11.5, fontWeight: 700 }}>实施计划待审阅</span>
            {wait > 0 && <span style={{ marginLeft: 'auto', color: 'oklch(0.72 0.02 var(--th) / .6)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>⏱ {fmtWait(wait)}</span>}
          </div>
          {/* 计划全文：Markdown 渲染 + 默认折叠（长计划不再撑爆面板） */}
          <div style={{ background: 'rgba(0,0,0,.28)', padding: '8px 10px', borderRadius: 8, marginBottom: 9 }}>
            <Collapsible collapsedHeight={140}>
              <Markdown text={a.command || '(计划内容为空)'} />
            </Collapsible>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="hv" onClick={() => onDecide(a, 'allow')} style={{ flex: 1, textAlign: 'center', padding: 7, borderRadius: 999, background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>批准计划</div>
            <div className="hv" onClick={() => onDecide(a, 'deny')} style={{ flex: 1, textAlign: 'center', padding: 7, borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .85)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>继续规划</div>
          </div>
          <div style={{ color: 'oklch(0.6 0.02 var(--th) / .45)', fontSize: 9.5, marginTop: 8 }}>
            快捷键：<b style={{ color: 'oklch(0.75 0.02 var(--th) / .7)' }}>Y</b> 批准 · <b style={{ color: 'oklch(0.75 0.02 var(--th) / .7)' }}>N</b> 继续规划
          </div>
        </div>
      )}

      {showApproval && !a.isPlan && (
        <div style={{ marginTop: 3, padding: '9px 11px', borderRadius: 11, background: 'oklch(0.28 0.05 75 / .35)', border: '1px solid oklch(0.8 0.13 75 / .3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <span style={{ color: 'oklch(0.86 0.1 75)', fontSize: 11, fontWeight: 600 }}>需要你的确认</span>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 6,
                background: risk.level === 'danger' ? 'oklch(0.5 0.18 25 / .3)' : risk.level === 'safe' ? 'oklch(0.4 calc(0.1 * var(--cs, 1)) var(--th) / .3)' : 'rgba(255,255,255,.06)',
                color: risk.level === 'danger' ? 'oklch(0.82 0.16 25)' : risk.level === 'safe' ? 'oklch(0.82 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.75 0.02 var(--th) / .7)',
                fontSize: 10,
                fontWeight: 700
              }}
            >
              {risk.level === 'danger' ? '⚠ 危险' : risk.level === 'safe' ? '✓ 安全' : '· 一般'}
            </span>
            {wait > 0 && (
              <span style={{ marginLeft: 'auto', color: waitEsc ? 'oklch(0.72 0.18 25)' : 'oklch(0.72 0.02 var(--th) / .6)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>⏱ {fmtWait(wait)}</span>
            )}
          </div>
          {a.command && (
            <div
              style={{
                color: risk.level === 'danger' ? 'oklch(0.88 0.1 25)' : 'oklch(0.82 0.02 var(--th) / .9)',
                fontSize: 11.5,
                fontFamily: "ui-monospace,'Cascadia Code',monospace",
                background: risk.level === 'danger' ? 'oklch(0.28 0.08 25 / .35)' : 'rgba(0,0,0,.28)',
                padding: '6px 8px',
                borderRadius: 7,
                marginBottom: 9,
                wordBreak: 'break-all'
              }}
            >
              {a.command}
            </div>
          )}
          {risk.level === 'danger' && <div style={{ color: 'oklch(0.82 0.14 25)', fontSize: 10.5, marginBottom: 8 }}>⚠ {risk.reason}，请确认后再放行</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <div
              onClick={() => onDecide(a, 'allow')}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: 7,
                borderRadius: 999,
                background:
                  risk.level === 'danger'
                    ? isArmed
                      ? 'linear-gradient(180deg, oklch(0.62 0.19 25), oklch(0.52 0.19 25))'
                      : 'oklch(0.4 0.12 25 / .55)'
                    : 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))',
                color: risk.level === 'danger' && !isArmed ? 'oklch(0.9 0.08 25)' : 'oklch(0.14 0.02 var(--th))',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {risk.level === 'danger' ? (isArmed ? '确认执行 · 再点一次' : '允许（需确认）') : '允许 Allow'}
            </div>
            <div
              onClick={() => onDecide(a, 'deny')}
              style={{ flex: 1, textAlign: 'center', padding: 7, borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .85)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              拒绝 Deny
            </div>
          </div>
          {risk.level === 'safe' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, cursor: 'pointer' }} onClick={onToggleAutoAllow}>
              {autoAllowSafe ? (
                <div style={{ width: 15, height: 15, borderRadius: 4, background: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'oklch(0.14 0.02 var(--th))', fontSize: 10, fontWeight: 800 }}>✓</div>
              ) : (
                <div style={{ width: 15, height: 15, borderRadius: 4, border: '1.5px solid oklch(0.5 0.02 var(--th) / .5)' }} />
              )}
              <span style={{ color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 11 }}>本会话自动允许只读 / 测试类命令</span>
            </div>
          )}
          <div style={{ color: 'oklch(0.6 0.02 var(--th) / .45)', fontSize: 9.5, marginTop: 8 }}>
            快捷键：<b style={{ color: 'oklch(0.75 0.02 var(--th) / .7)' }}>Y</b> 允许 · <b style={{ color: 'oklch(0.75 0.02 var(--th) / .7)' }}>N</b> 拒绝
          </div>
        </div>
      )}

      {decided && a.detail.includes('已允许') && <div style={{ fontSize: 11, color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', fontWeight: 600 }}>✓ 已允许，继续执行中…</div>}
      {decided && a.detail.includes('已拒绝') && <div style={{ fontSize: 11, color: 'oklch(0.7 0.1 30)', fontWeight: 600 }}>✕ 已拒绝，已通知 Agent</div>}

      {a.summary && (
        <div style={{ marginTop: 3, padding: '10px 11px', borderRadius: 12, background: 'oklch(0.24 0.03 var(--th) / .5)', border: '1px solid oklch(0.5 calc(0.08 * var(--cs, 1)) var(--th) / .3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <span style={{ color: 'oklch(0.88 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 11, fontWeight: 700 }}>变更小结</span>
            <span style={{ color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5, fontFamily: 'ui-monospace,monospace' }}>{a.summary.files} 文件</span>
            <span style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontFamily: 'ui-monospace,monospace' }}>+{a.summary.added}</span>
            <span style={{ color: 'oklch(0.7 0.14 25)', fontSize: 10.5, fontFamily: 'ui-monospace,monospace' }}>−{a.summary.removed}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, color: 'oklch(0.82 0.02 var(--th) / .9)', fontSize: 11, fontFamily: "ui-monospace,'Cascadia Code',monospace", background: 'rgba(0,0,0,.28)', padding: '6px 8px', borderRadius: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.summary.commit}
            </div>
            <div onClick={() => onCopyCommit(a.id, a.summary!.commit)} style={{ padding: '6px 11px', borderRadius: 8, background: 'rgba(255,255,255,.07)', color: 'oklch(0.85 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              复制
            </div>
          </div>
          {copiedId === a.id && <div style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', fontSize: 10, marginTop: 5 }}>✓ 提交信息已复制</div>}
        </div>
      )}

      {/* 底部：跳转 + 活动轨迹开关 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
        <div className="hv" onClick={() => onJump(a)} style={{ padding: '4.5px 12px', borderRadius: 999, background: 'rgba(255,255,255,.055)', border: '1px solid rgba(255,255,255,.06)', color: 'oklch(0.84 0.02 var(--th) / .9)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
          ↗ 跳转到{a.backend === 'codex' ? ' Codex' : '终端'}
        </div>
        {(a.history?.length ?? 0) > 1 && (
          <div className="hv" onClick={() => setShowTrail((v) => !v)} style={{ padding: '4.5px 11px', borderRadius: 999, background: showTrail ? 'oklch(0.3 0.05 var(--th) / .4)' : 'transparent', color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
            ≡ 轨迹 {a.history!.length}
          </div>
        )}
        <span style={{ marginLeft: 'auto', color: 'oklch(0.55 0.02 var(--th) / .45)', fontSize: 8.5, fontFamily: 'ui-monospace,monospace' }}>{a.id.split(':')[1]?.slice(0, 8)}</span>
      </div>

      {/* 活动轨迹时间线：状态描述的演变（最多 10 条） */}
      {showTrail && (a.history?.length ?? 0) > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '7px 4px 2px', borderTop: '1px solid rgba(255,255,255,.05)' }}>
          {[...a.history!].reverse().map((h, i) => (
            <div key={h.ts + '-' + i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 8, flex: 'none' }}>
                <div style={{ width: 5, height: 5, borderRadius: 999, marginTop: 4, background: i === 0 ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' : 'oklch(0.5 0.02 var(--th) / .4)', boxShadow: i === 0 ? '0 0 6px oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))' : 'none' }} />
                {i < a.history!.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 9, background: 'rgba(255,255,255,.08)' }} />}
              </div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', paddingBottom: 6, minWidth: 0 }}>
                <span style={{ flex: 'none', color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 8.5, fontFamily: 'ui-monospace,monospace', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(h.ts)}</span>
                <span style={{ color: i === 0 ? 'oklch(0.85 0.02 var(--th) / .9)' : 'oklch(0.68 0.02 var(--th) / .65)', fontSize: 10, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
