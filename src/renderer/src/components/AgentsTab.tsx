// Agents 分区 v3 —— 设计系统重做：ui/tokens 层级表面 + lucide 语义图标 + framer-motion 入场。
// 审批 / 计划审阅 / 等待回复 / 变更小结的交互逻辑保持不变。

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, Check, ClipboardList, Clock, Copy, History, Hourglass, Radar, X } from 'lucide-react'
import type { AgentVM } from '../types'
import { riskOf } from '../logic/risk'
import { Markdown, Collapsible } from './Markdown'
import { Button, EmptyState } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'

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

/** 后端徽标：Claude（渐变菱形 SVG）/ Codex（六边形 SVG），桌面端叠加窗口角标 */
const BackendGlyph = ({ a }: { a: AgentVM }): React.JSX.Element => {
  const isCodex = a.backend === 'codex'
  const isApp = /桌面/.test(a.tool)
  return (
    <div style={{ position: 'relative', width: 24, height: 24, flex: 'none' }}>
      <div
        style={{
          width: 24, height: 24, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isCodex
            ? 'linear-gradient(135deg, oklch(0.45 0.03 250), oklch(0.3 0.03 250))'
            : gradient.brand(),
          color: isCodex ? 'oklch(0.9 0.02 250)' : gradient.onPrimary(),
          boxShadow: isCodex ? 'inset 0 1px 0 rgba(255,255,255,0.08)' : `0 2px 8px ${accent(0.7, 0.35)}, inset 0 1px 0 rgba(255,255,255,0.3)`
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          {isCodex
            ? <path d="M12 2.5 21 7.5v9l-9 5-9-5v-9l9-5z" />
            : <path d="M12 2 22 12 12 22 2 12z" />}
        </svg>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {agents.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="暂无活动 Agent"
          desc="在任意终端运行 Claude Code / Codex 即自动接入。命令审批 · 计划审阅 · 等待提醒 · 完成小结都会实时出现。"
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 2px' }}>
          <span style={text.overline()}>
            {active} 个活动会话{agents.length > active ? ` · ${agents.length - active} 个已结束` : ''}
          </span>
          <span style={{ flex: 1, height: 0.5, background: hairline(0.08) }} />
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
    a.status === 'needs_approval' || isWaiting ? sem.warn : isDone ? ink(3) : accent()
  const label = a.status === 'needs_approval' ? '待处理' : isWaiting ? '等待回复' : isDone ? '已结束' : '运行中'
  const highlight = showApproval || isWaiting
  // 状态胶囊配色
  const chipBg = highlight ? semBg(sem.warn, 0.2) : isDone ? fill(1) : semBg(accent(), 0.16)
  const chipFg = highlight ? 'oklch(0.88 0.11 75)' : isDone ? ink(3) : accent(0.85)
  const elapsed = fmtElapsed(a.startedAt)

  return (
    <motion.div
      variants={fadeScaleIn}
      initial={false}
      animate="animate"
      className={highlight ? undefined : 'ai-card'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: `${SP.md}px ${SP.md + 1}px`,
        ...surface.card(highlight),
        ...(isDone ? { background: fill(1), border: 'none' } : {}),
        opacity: isDone ? 0.72 : 1
      }}
    >
      {/* 头部：徽标 + 名称/项目 + 时长 + 状态胶囊 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <BackendGlyph a={a} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ ...text.subtitle(), fontSize: FS.body, letterSpacing: '.01em' }}>{a.tool}</span>
            <span style={{ ...text.mono(10), background: fill(1), padding: '1px 7px', borderRadius: R.sm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{a.proj}</span>
          </div>
          {elapsed && <span style={{ ...text.faint(), fontSize: 9 }}>已运行 {elapsed}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: R.pill, background: chipBg, border: highlight ? '0.5px solid oklch(0.8 0.13 75 / 0.4)' : 'none', flex: 'none' }}>
          <div style={{ width: 6, height: 6, borderRadius: 999, background: dot, boxShadow: `0 0 7px ${dot}`, animation: isDone ? undefined : 'ai-dotpulse 2s ease-in-out infinite' }} />
          <span style={{ color: chipFg, fontSize: 10, fontWeight: 700 }}>{label}</span>
        </div>
      </div>
      {/* 状态描述：长内容（如 Agent 提问/最近消息）渲染 Markdown + 可折叠 */}
      {a.detail.length > 90 || a.detail.includes('\n') ? (
        <div style={{ color: ink(2) }}>
          <Collapsible collapsedHeight={72}>
            <Markdown text={a.detail} />
          </Collapsible>
        </div>
      ) : (
        <div style={{ color: ink(2), fontSize: FS.small, lineHeight: 1.5 }}>{a.detail}</div>
      )}

      {isWaiting && (
        <div style={{ marginTop: 3, padding: '9px 11px', borderRadius: R.lg, background: semBg(sem.warn, 0.14), border: '0.5px solid oklch(0.8 0.13 75 / 0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Hourglass size={14} strokeWidth={1.75} style={{ color: sem.warn, flex: 'none' }} />
            <span style={{ color: 'oklch(0.86 0.1 75)', fontSize: FS.small, fontWeight: 600 }}>正在等待你回复</span>
            <Button sm icon={ArrowUpRight} onClick={() => onJump(a)} variant="primary" style={{ marginLeft: 'auto' }}>去终端回复</Button>
          </div>
        </div>
      )}

      {showApproval && a.isPlan && (
        <div style={{ marginTop: 3, padding: '10px 11px', borderRadius: R.lg, background: fill(3), border: `0.5px solid ${accent(0.7, 0.3)}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <ClipboardList size={14} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
            <span style={{ color: accent(0.88, 0.95), fontSize: FS.small, fontWeight: 700 }}>实施计划待审阅</span>
            {wait > 0 && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: ink(3), fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                <Clock size={10} strokeWidth={2} />{fmtWait(wait)}
              </span>
            )}
          </div>
          {/* 计划全文：Markdown 渲染 + 默认折叠（长计划不再撑爆面板） */}
          <div style={{ ...surface.inset(), padding: '8px 10px', marginBottom: 9 }}>
            <Collapsible collapsedHeight={140}>
              <Markdown text={a.command || '(计划内容为空)'} />
            </Collapsible>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={() => onDecide(a, 'allow')} style={{ flex: 1 }}>批准计划</Button>
            <Button variant="ghost" onClick={() => onDecide(a, 'deny')} style={{ flex: 1 }}>继续规划</Button>
          </div>
          <div style={{ ...text.faint(), fontSize: 9.5, marginTop: 8 }}>
            快捷键：<b style={{ color: ink(2) }}>Y</b> 批准 · <b style={{ color: ink(2) }}>N</b> 继续规划
          </div>
        </div>
      )}

      {showApproval && !a.isPlan && (
        <div className="ui-attention" style={{ marginTop: 3, padding: '9px 11px', borderRadius: R.lg, background: semBg(sem.warn, 0.16), border: '0.5px solid oklch(0.8 0.13 75 / 0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <span style={{ color: 'oklch(0.86 0.1 75)', fontSize: 11, fontWeight: 600 }}>需要你的确认</span>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 7px',
                borderRadius: R.sm,
                background: risk.level === 'danger' ? semBg(sem.danger, 0.2) : risk.level === 'safe' ? semBg(accent(), 0.18) : fill(3),
                color: risk.level === 'danger' ? 'oklch(0.82 0.16 25)' : risk.level === 'safe' ? accent(0.85) : ink(2),
                fontSize: 10,
                fontWeight: 700
              }}
            >
              {risk.level === 'danger' ? <><X size={10} strokeWidth={2.5} />危险</> : risk.level === 'safe' ? <><Check size={10} strokeWidth={2.5} />安全</> : '· 一般'}
            </span>
            {wait > 0 && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: waitEsc ? 'oklch(0.72 0.18 25)' : ink(3), fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                <Clock size={10} strokeWidth={2} />{fmtWait(wait)}
              </span>
            )}
          </div>
          {a.command && (
            <div
              style={{
                color: risk.level === 'danger' ? 'oklch(0.88 0.1 25)' : ink(1),
                fontSize: FS.small,
                fontFamily: "ui-monospace,'Cascadia Code',monospace",
                background: risk.level === 'danger' ? semBg(sem.danger, 0.2) : surface.inset().background,
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
              className="hv"
              style={{
                flex: 1,
                textAlign: 'center',
                padding: 7,
                borderRadius: R.md,
                background:
                  risk.level === 'danger'
                    ? isArmed
                      ? 'linear-gradient(180deg, oklch(0.62 0.19 25), oklch(0.52 0.19 25))'
                      : 'oklch(0.4 0.12 25 / .55)'
                    : gradient.primary(),
                color: risk.level === 'danger' && !isArmed ? 'oklch(0.9 0.08 25)' : gradient.onPrimary(),
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {risk.level === 'danger' ? (isArmed ? '确认执行 · 再点一次' : '允许（需确认）') : '允许 Allow'}
            </div>
            <Button variant="ghost" onClick={() => onDecide(a, 'deny')} style={{ flex: 1 }}>拒绝 Deny</Button>
          </div>
          {risk.level === 'safe' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, cursor: 'pointer' }} onClick={onToggleAutoAllow}>
              {autoAllowSafe ? (
                <div style={{ width: 15, height: 15, borderRadius: 4, background: gradient.primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', color: gradient.onPrimary() }}>
                  <Check size={10} strokeWidth={3} />
                </div>
              ) : (
                <div style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${ink(3)}` }} />
              )}
              <span style={{ color: ink(2), fontSize: 11 }}>本会话自动允许只读 / 测试类命令</span>
            </div>
          )}
          <div style={{ ...text.faint(), fontSize: 9.5, marginTop: 8 }}>
            快捷键：<b style={{ color: ink(2) }}>Y</b> 允许 · <b style={{ color: ink(2) }}>N</b> 拒绝
          </div>
        </div>
      )}

      {decided && a.detail.includes('已允许') && <div style={{ fontSize: 11, color: accent(), fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} strokeWidth={2.5} />已允许，继续执行中…</div>}
      {decided && a.detail.includes('已拒绝') && <div style={{ fontSize: 11, color: 'oklch(0.7 0.1 30)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><X size={12} strokeWidth={2.5} />已拒绝，已通知 Agent</div>}

      {a.summary && (
        <div style={{ marginTop: 3, padding: '10px 11px', borderRadius: R.lg, background: fill(3), border: `0.5px solid ${accent(0.6, 0.25)}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <span style={{ color: accent(0.88, 0.95), fontSize: 11, fontWeight: 700 }}>变更小结</span>
            <span style={{ ...text.mono(10.5) }}>{a.summary.files} 文件</span>
            <span style={{ color: accent(), fontSize: 10.5, fontFamily: 'ui-monospace,monospace' }}>+{a.summary.added}</span>
            <span style={{ color: sem.danger, fontSize: 10.5, fontFamily: 'ui-monospace,monospace' }}>−{a.summary.removed}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, color: ink(1), fontSize: 11, fontFamily: "ui-monospace,'Cascadia Code',monospace", background: surface.inset().background, padding: '6px 8px', borderRadius: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.summary.commit}
            </div>
            <Button sm variant="ghost" icon={Copy} onClick={() => onCopyCommit(a.id, a.summary!.commit)}>复制</Button>
          </div>
          {copiedId === a.id && <div style={{ color: accent(), fontSize: 10, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={10} strokeWidth={2.5} />提交信息已复制</div>}
        </div>
      )}

      {/* 底部：跳转 + 活动轨迹开关 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
        <Button sm variant="ghost" icon={ArrowUpRight} onClick={() => onJump(a)}>
          跳转到{a.backend === 'codex' ? ' Codex' : '终端'}
        </Button>
        {(a.history?.length ?? 0) > 1 && (
          <Button sm variant="ghost" icon={History} onClick={() => setShowTrail((v) => !v)} style={showTrail ? { background: semBg(accent(), 0.16), border: 'none' } : undefined}>
            轨迹 {a.history!.length}
          </Button>
        )}
        <span style={{ marginLeft: 'auto', ...text.mono(8.5), opacity: 0.5 }}>{a.id.split(':')[1]?.slice(0, 8)}</span>
      </div>

      {/* 活动轨迹时间线：状态描述的演变（最多 10 条） */}
      {showTrail && (a.history?.length ?? 0) > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '7px 4px 2px', borderTop: `0.5px solid ${hairline(0.08)}` }}>
          {[...a.history!].reverse().map((h, i) => (
            <div key={h.ts + '-' + i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 8, flex: 'none' }}>
                <div style={{ width: 5, height: 5, borderRadius: 999, marginTop: 4, background: i === 0 ? accent() : ink(4), boxShadow: i === 0 ? `0 0 6px ${accent()}` : 'none' }} />
                {i < a.history!.length - 1 && <div style={{ width: 0.5, flex: 1, minHeight: 9, background: hairline(0.14) }} />}
              </div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', paddingBottom: 6, minWidth: 0 }}>
                <span style={{ flex: 'none', ...text.mono(8.5), fontVariantNumeric: 'tabular-nums' }}>{fmtClock(h.ts)}</span>
                <span style={{ color: i === 0 ? ink(1) : ink(3), fontSize: 10, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.text}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
