// 验收台：一个分区装两件事。
//   1) 计划待审阅——沿用原 Plan 页的批准/打回/跳终端交互（ExitPlanMode 的唯一入口之一）。
//   2) 会话留档——会话结束时自动落账，把"计划 → 实际改动 → 未验证项"摊开供核对。
// 留档只呈现可核验的事实（git 文件清单、活动轨迹里的命令、回复里的明示线索），
// 不做"是否通过"的自动结论：执行过 ≠ 通过。

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowUpRight, Check, ChevronDown, ClipboardCheck, ClipboardList, Clock, Copy,
  FileCode2, Flag, ListPlus, Loader2, NotebookPen, Play, ShieldQuestion, Square, TerminalSquare, Trash2, Undo2, Wand2, XCircle
} from 'lucide-react'
import type { AcceptanceGate, AcceptanceRecord, AgentVM } from '../types'
import {
  analyzeAcceptance, buildAcceptanceCertificate, buildFollowUpPrompt, checkFailed, evaluateGate,
  fileStatusLabel, planTodoTexts, requirementIdsOf, searchTextOf, sessionIdOf, type AcceptanceAnalysis
} from '../logic/acceptance'
import { island } from '../bridge'
import { Markdown, Collapsible } from './Markdown'
import { Button, Chip, EmptyState, IconButton, Input, SectionHeader } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, accentText, fill, FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'

interface AcceptTabProps {
  /** 待审阅的计划（agents 里 isPlan 的待审批项） */
  plans: AgentVM[]
  /** 已结束会话的留档（新的在前） */
  records: AcceptanceRecord[]
  /** 项目级门禁规则 */
  gate?: AcceptanceGate
  onDecide: (a: AgentVM, d: 'allow' | 'deny') => void
  onJump: (a: AgentVM) => void
  onJumpRecord: (r: AcceptanceRecord) => void
  onMark: (id: string, status: AcceptanceRecord['status'], violations?: string[]) => void
  onRemove: (id: string) => void
  /** 计划项转待办，返回实际新增条数 */
  onPlanToTodos: (record: AcceptanceRecord, texts: string[]) => number
  /** 验收凭证存为便签 */
  onSaveCertificate: (record: AcceptanceRecord, markdown: string) => void
  waitSecs: Record<string, number>
}

interface FollowupRunView {
  status: 'running' | 'done' | 'error'
  text: string
  exitCode?: number
}

const fmtWait = (secs: number): string => `已等待 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
const fmtTime = (ts: number): string => {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const VERDICT_META: Record<AcceptanceAnalysis['verdict'], { label: string; color: string }> = {
  clean: { label: '有验证证据', color: sem.calm },
  watch: { label: '需核对', color: sem.warn },
  nochange: { label: '无改动', color: ink(3) }
}

/** 计划审阅卡（沿用原 Plan 页交互） */
function PlanCard(p: { a: AgentVM; wait: number; onDecide: AcceptTabProps['onDecide']; onJump: AcceptTabProps['onJump'] }): React.JSX.Element {
  return (
    <motion.div
      variants={fadeScaleIn}
      initial={false}
      animate="animate"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: `${SP.md}px ${SP.md + 1}px`,
        borderRadius: R.lg,
        background: `linear-gradient(180deg, ${semBg(accent(), 0.08)}, ${fill(2)})`,
        border: `0.5px solid ${accent(0.6, 0.18)}`,
        boxShadow: `0 8px 24px -14px ${accent(0.5, 0.25)}`
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 24, height: 24, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: semBg(accent(), 0.14), color: accentText(), flex: 'none' }}>
          <ClipboardList size={13} strokeWidth={1.75} />
        </div>
        <span style={{ color: ink(1), fontSize: FS.body, fontWeight: 700 }}>实施计划待审阅</span>
        <span style={{ ...text.mono(10), background: fill(2), padding: '1px 7px', borderRadius: R.sm }}>{p.a.tool} · {p.a.proj}</span>
        {p.wait > 0 && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: ink(3), fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
            <Clock size={10} strokeWidth={2} />{fmtWait(p.wait)}
          </span>
        )}
      </div>
      <div style={{ ...surface.inset(), padding: '9px 11px' }}>
        <Collapsible collapsedHeight={220}>
          <Markdown text={p.a.plan?.text || p.a.command || '(计划内容为空)'} />
        </Collapsible>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" icon={Check} onClick={() => p.onDecide(p.a, 'allow')} style={{ flex: 1 }}>批准计划，开始执行</Button>
        <Button variant="ghost" icon={Undo2} onClick={() => p.onDecide(p.a, 'deny')} style={{ flex: 1 }}>打回，继续规划</Button>
        <Button variant="ghost" icon={ArrowUpRight} title="跳转到终端" onClick={() => p.onJump(p.a)} />
      </div>
      <div style={{ ...text.faint(), fontSize: 9.5 }}>快捷键：<b style={{ color: ink(2) }}>Y</b> 批准 · <b style={{ color: ink(2) }}>N</b> 继续规划</div>
    </motion.div>
  )
}

function FileRow(p: { file: AcceptanceAnalysis['changed'][number] }): React.JSX.Element {
  const meta = fileStatusLabel(p.file.status)
  const tone = meta.tone === 'add' ? sem.calm : meta.tone === 'del' ? sem.danger : accent(0.7)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2.5px 0', minWidth: 0 }}>
      <span style={{ ...text.mono(10), color: tone, background: semBg(tone, 0.13), padding: '0 5px', borderRadius: 4, flex: 'none' }}>{meta.label}</span>
      <span title={p.file.path} style={{ ...text.mono(10.5), color: ink(2), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.file.path}</span>
      {p.file.inPlan === false && (
        <span title="计划里没有提到这个文件" style={{ fontSize: 10, color: sem.warn, background: semBg(sem.warn, 0.14), padding: '0 5px', borderRadius: 4, flex: 'none' }}>计划外</span>
      )}
      {p.file.followup && (
        <span title="来自补验证那一轮的改动" style={{ fontSize: 10, color: sem.focus, background: semBg(sem.focus, 0.14), padding: '0 5px', borderRadius: 4, flex: 'none' }}>补验证</span>
      )}
      {p.file.committed && (
        <span title="会话期间已提交" style={{ fontSize: 10, color: sem.calm, background: semBg(sem.calm, 0.14), padding: '0 5px', borderRadius: 4, flex: 'none' }}>已提交</span>
      )}
    </div>
  )
}

/** 验证记录：命令 + 真实退出码/耗时（拿不到就不编），失败直接红标 */
function CheckRow(p: { run: AcceptanceAnalysis['checks'][number] }): React.JSX.Element {
  const { run } = p
  const failed = checkFailed(run)
  const tone = failed ? sem.danger : run.exitCode === 0 ? sem.calm : ink(3)
  const meta = [
    run.exitCode !== undefined ? `退出 ${run.exitCode}` : '未回传退出码',
    run.ms !== undefined ? `${(run.ms / 1000).toFixed(1)}s` : ''
  ].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2.5px 0', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {failed
          ? <XCircle size={10} strokeWidth={2} style={{ color: sem.danger, flex: 'none' }} />
          : <Check size={10} strokeWidth={2.5} style={{ color: tone, flex: 'none' }} />}
        <span title={run.command} style={{ ...text.mono(10.5), color: ink(2), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.command}</span>
        {run.followup && <span style={{ fontSize: 9, color: accentText(0.8), background: semBg(accent(), 0.12), padding: '0 4px', borderRadius: 3, flex: 'none' }}>补验证</span>}
        <span style={{ fontSize: 10, color: tone, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{meta}</span>
      </div>
      {failed && run.outputTail && (
        <div style={{ ...text.mono(10), color: sem.danger, opacity: 0.85, paddingLeft: 16, maxHeight: 34, overflow: 'hidden', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{run.outputTail.slice(-240)}</div>
      )}
    </div>
  )
}

function RecordCard(p: {
  r: AcceptanceRecord
  open: boolean
  run?: FollowupRunView
  gate?: AcceptanceGate
  onToggle: () => void
  onJump: () => void
  onMark: (status: AcceptanceRecord['status'], violations?: string[]) => void
  onRemove: () => void
  onStartFollow: (prompt: string) => Promise<{ ok: boolean; error?: string }>
  onCancelFollow: () => void
  onPlanToTodos: (texts: string[]) => number
  onSaveCertificate: (markdown: string) => void
}): React.JSX.Element {
  const { r } = p
  const a = useMemo(() => analyzeAcceptance(r), [r])
  const gateHits = useMemo(() => evaluateGate(r, a, p.gate), [r, a, p.gate])
  const reqIds = useMemo(() => requirementIdsOf(r), [r])
  const v = VERDICT_META[a.verdict]
  const [copied, setCopied] = useState(false)
  const [followOpen, setFollowOpen] = useState(false)
  const [followPrompt, setFollowPrompt] = useState('')
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [todosAdded, setTodosAdded] = useState<number | null>(null)
  const [certSaved, setCertSaved] = useState(false)
  const [certCopied, setCertCopied] = useState(false)
  const todoTexts = useMemo(() => planTodoTexts(r), [r])
  const canResume = !!sessionIdOf(r) && !!r.cwd
  const toggleFollow = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!followOpen) setFollowPrompt(buildFollowUpPrompt(r, a))
    setFollowOpen(!followOpen)
  }
  const copyPrompt = (e: React.MouseEvent): void => {
    e.stopPropagation()
    navigator.clipboard?.writeText(followPrompt).catch(() => {})
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 1500)
  }
  // 删除是两段式：第一下只武装，避免手滑丢掉留档
  const [delArmed, setDelArmed] = useState(false)
  const [gateArmed, setGateArmed] = useState(false)
  const armDelete = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!delArmed) {
      setDelArmed(true)
      setTimeout(() => setDelArmed(false), 2500)
      return
    }
    setDelArmed(false)
    p.onRemove()
  }
  const commit = r.summary?.commit
  const copyCommit = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!commit) return
    navigator.clipboard?.writeText(commit).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div style={{
      ...surface.card(), padding: '10px 12px', borderRadius: R.lg,
      border: r.status === 'accepted' ? `0.5px solid ${semBg(sem.calm, 0.28)}` : `0.5px solid ${hairline(0.04)}`,
      opacity: r.status === 'accepted' ? 0.88 : 1
    }}>
      <div onClick={p.onToggle} style={{ display: 'flex', flexDirection: 'column', gap: 3, cursor: 'pointer', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: v.color, flex: 'none' }} />
          <span style={{ color: ink(1), fontSize: FS.small, fontWeight: 650, flex: 'none' }}>{r.tool}</span>
          <span style={{ ...text.mono(10), color: ink(3), flex: 'none' }}>{r.proj}</span>
          <span style={{ color: v.color, fontSize: 10, flex: 'none' }}>{v.label}</span>
          {a.followupCount > 0 && <span style={{ fontSize: 10, color: accentText(0.82), background: semBg(accent(), 0.12), padding: '0 5px', borderRadius: 4, flex: 'none' }}>补验证 {a.followupCount}</span>}
          <span style={{ ...text.faint(), fontSize: 10, marginLeft: 'auto', flex: 'none' }}>{fmtTime(r.endedAt)}</span>
          <ChevronDown size={12} strokeWidth={2} style={{ color: ink(3), flex: 'none', transform: p.open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }} />
        </div>
        {/* 统计单独一行：岛只有 468px 宽，挤在一行会把"未见验证命令"裁掉 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 13, minWidth: 0 }}>
          <span style={{ ...text.faint(), fontSize: 10.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.headline}</span>
          {a.unverified.length > 0 && <span style={{ fontSize: 10, color: sem.warn, background: semBg(sem.warn, 0.14), padding: '0 5px', borderRadius: 4, flex: 'none' }}>未验证 {a.unverified.length}</span>}
        </div>
      </div>

      {p.open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 9 }}>
          {reqIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <span style={{ ...text.faint(), fontSize: 10 }}>需求</span>
              {reqIds.map((id) => (
                <span key={id} style={{ ...text.mono(10), color: accentText(0.82), background: semBg(accent(), 0.12), padding: '0 6px', borderRadius: 4 }}>{id}</span>
              ))}
            </div>
          )}
          {r.plan && (
            <div>
              <SectionHeader
                icon={ClipboardList}
                title="计划"
                extra={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: ink(3) }}>{r.plan.decision === 'allow' ? '已批准' : r.plan.decision === 'deny' ? '已打回' : '未裁决'}</span>
                  </span>
                }
              />
              <div style={{ ...surface.inset(), padding: '7px 9px' }}>
                <Collapsible collapsedHeight={180}><Markdown text={r.plan.text} /></Collapsible>
              </div>
            </div>
          )}

          <div>
            <SectionHeader
              icon={FileCode2}
              title={`实际改动 · ${r.summary?.files ?? a.changed.length}`}
              extra={commit ? (
                <button onClick={copyCommit} title={commit} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: 'none', background: 'transparent', color: copied ? sem.calm : ink(3), fontSize: 10, cursor: 'pointer', padding: 0 }}>
                  <Copy size={9} strokeWidth={2} />{copied ? '已复制' : '提交信息'}
                </button>
              ) : undefined}
            />
            {a.changed.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {a.changed.slice(0, 12).map((f) => <FileRow key={f.path} file={f} />)}
                {a.changed.length > 12 && <span style={{ ...text.faint(), fontSize: 10 }}>另有 {a.changed.length - 12} 个文件未展开</span>}
              </div>
            ) : (
              <div style={{ ...text.faint(), fontSize: 10.5 }}>{r.summary ? 'git 未返回文件清单' : '没有取得变更记录（非 git 仓库，或本轮未改文件）'}</div>
            )}
          </div>

          {a.checks.length > 0 && (
            <div>
              <SectionHeader icon={TerminalSquare} title={`验证记录 · ${a.checks.length}`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {a.checks.slice(-8).map((run, i) => <CheckRow key={`${run.at}-${i}`} run={run} />)}
              </div>
            </div>
          )}

          <div>
            <SectionHeader
              icon={ShieldQuestion}
              title={`未验证项 · ${a.unverified.length}`}
              extra={a.unverified.length > 0
                ? <Button sm variant="tinted" icon={Wand2} onClick={toggleFollow}>{followOpen ? '收起' : '补验证'}</Button>
                : undefined}
            />
            {a.unverified.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {a.unverified.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 10.5, color: ink(2), lineHeight: 1.5 }}>
                    <span style={{ width: 4, height: 4, borderRadius: 999, background: sem.warn, marginTop: 5, flex: 'none' }} />
                    <span>{f.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ ...text.faint(), fontSize: 10.5 }}>未发现明示的未验证线索（执行过不等于通过，仍需你自己确认）</div>
            )}
            {a.notes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 5 }}>
                {a.notes.map((f, i) => <div key={i} style={{ ...text.faint(), fontSize: 10 }}>· {f.text}</div>)}
              </div>
            )}
            {followOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ ...text.faint(), fontSize: 10 }}>
                  这是发给同一会话的追问；「在岛内续跑」会以 --resume 接着原会话执行，输出回显在这里。
                </div>
                <textarea
                  value={followPrompt}
                  onChange={(e) => setFollowPrompt(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  rows={7}
                  spellCheck={false}
                  style={{
                    width: '100%', resize: 'vertical', padding: '7px 9px', borderRadius: R.sm,
                    border: `0.5px solid ${hairline(0.12)}`, background: fill(1), color: ink(1),
                    fontSize: 11, lineHeight: 1.55, outline: 'none', boxSizing: 'border-box',
                    fontFamily: "ui-monospace,'Cascadia Code',monospace"
                  }}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button sm icon={Copy} onClick={copyPrompt}>{copiedPrompt ? '已复制' : '复制追问'}</Button>
                  <Button
                    sm
                    variant="primary"
                    icon={Play}
                    disabled={!canResume || p.run?.status === 'running'}
                    onClick={(e) => { e.stopPropagation(); void p.onStartFollow(followPrompt) }}
                  >
                    在岛内续跑
                  </Button>
                  <Button sm icon={ArrowUpRight} onClick={(e) => { e.stopPropagation(); p.onJump() }}>回到终端</Button>
                  {p.run?.status === 'running' && (
                    <Button sm variant="warn" icon={Square} onClick={(e) => { e.stopPropagation(); p.onCancelFollow() }}>停止</Button>
                  )}
                </div>
                {!canResume && (
                  <div style={{ ...text.faint(), fontSize: 10 }}>
                    这条记录缺少会话 id 或工作目录（旧记录/目录已清理），请复制追问后到终端继续。
                  </div>
                )}
                {p.run && (
                  <div style={{ ...surface.inset(), padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      {p.run.status === 'running'
                        ? <Loader2 size={10} strokeWidth={2} style={{ color: sem.run }} />
                        : p.run.status === 'error'
                          ? <XCircle size={10} strokeWidth={2} style={{ color: sem.danger }} />
                          : <Check size={10} strokeWidth={2.5} style={{ color: sem.calm }} />}
                      <span style={{ fontSize: 10.5, color: ink(2) }}>
                        {p.run.status === 'running'
                          ? '补验证进行中…'
                          : p.run.status === 'error'
                            ? '补验证异常'
                            : `补验证结束${p.run.exitCode !== undefined ? ` · 退出 ${p.run.exitCode}` : ''}`}
                      </span>
                    </div>
                    <div className="ai-scroll" style={{ maxHeight: 120, overflowY: 'auto' }}>
                      <pre style={{
                        margin: 0, ...text.mono(10), whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        color: p.run.status === 'error' ? sem.danger : ink(2), lineHeight: 1.45
                      }}>{p.run.text.slice(-4000) || '（暂无输出）'}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {r.lastReply && (
            <div>
              <SectionHeader icon={ClipboardCheck} title="最后回复" />
              <div style={{ ...surface.inset(), padding: '7px 9px' }}>
                <Collapsible collapsedHeight={150}><Markdown text={r.lastReply} /></Collapsible>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {todoTexts.length > 0 && (
              <Button
                sm
                variant="ghost"
                icon={ListPlus}
                title="把计划里未勾选的步骤转成待办"
                onClick={(e) => { e.stopPropagation(); setTodosAdded(p.onPlanToTodos(todoTexts)) }}
              >
                {todosAdded === null ? `计划转待办 ${todoTexts.length}` : todosAdded > 0 ? `已加 ${todosAdded} 条` : '已在待办'}
              </Button>
            )}
            <Button
              sm
              variant="ghost"
              icon={NotebookPen}
              onClick={(e) => {
                e.stopPropagation()
                p.onSaveCertificate(buildAcceptanceCertificate(r, a))
                setCertSaved(true)
                setTimeout(() => setCertSaved(false), 1800)
              }}
            >
              {certSaved ? '已存便签' : '存验收凭证'}
            </Button>
            <Button
              sm
              variant="ghost"
              icon={Copy}
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard?.writeText(buildAcceptanceCertificate(r, a)).catch(() => {})
                setCertCopied(true)
                setTimeout(() => setCertCopied(false), 1500)
              }}
            >
              {certCopied ? '已复制' : '复制 Markdown'}
            </Button>
          </div>

          {(gateHits.length > 0 || r.gateOverride) && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: R.sm,
              background: semBg(gateHits.length > 0 ? sem.warn : sem.calm, 0.1),
              border: `0.5px solid ${semBg(gateHits.length > 0 ? sem.warn : sem.calm, 0.3)}`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 650, color: gateHits.length > 0 ? sem.warn : sem.calm }}>
                <ShieldQuestion size={11} strokeWidth={2} />
                {gateHits.length > 0 ? `门禁未满足 · ${gateHits.length} 项` : '带未满足项验收'}
              </div>
              {gateHits.map((v, i) => (
                <div key={i} style={{ fontSize: 10, color: ink(2), lineHeight: 1.45 }}>· {v.text}</div>
              ))}
              {r.gateOverride && (
                <div style={{ fontSize: 9.5, color: ink(3) }}>
                  {fmtTime(r.gateOverride.at)} 仍然验收：{r.gateOverride.violations.join('；') || '（无记录）'}
                </div>
              )}
            </div>
          )}

          {gateArmed && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 8px',
              borderRadius: R.sm, background: semBg(sem.warn, 0.12), border: `0.5px solid ${semBg(sem.warn, 0.32)}`
            }}>
              <span style={{ fontSize: 10, color: ink(2), flex: 1, minWidth: 120 }}>门禁未满足，确认仍然验收？该决定会留痕。</span>
              <Button
                sm
                variant="warn"
                icon={Check}
                onClick={(e) => { e.stopPropagation(); p.onMark('accepted', gateHits.map((v) => v.text)); setGateArmed(false) }}
              >
                仍然验收
              </Button>
              <Button sm onClick={(e) => { e.stopPropagation(); setGateArmed(false) }}>取消</Button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Button
              sm
              variant={r.status === 'accepted' ? 'tinted' : gateHits.length > 0 ? 'warn' : 'ghost'}
              icon={Check}
              onClick={(e) => {
                e.stopPropagation()
                if (r.status === 'accepted') { p.onMark('pending'); return }
                // 门禁未满足：先亮出原因，再点一次才落地（留痕 override）
                if (gateHits.length > 0 && !gateArmed) { setGateArmed(true); return }
                p.onMark('accepted', gateHits.length > 0 ? gateHits.map((v) => v.text) : undefined)
                setGateArmed(false)
              }}
            >
              {r.status === 'accepted' ? '已验收' : '标记已验收'}
            </Button>
            <Button sm variant={r.status === 'followup' ? 'warn' : 'ghost'} icon={Flag} onClick={(e) => { e.stopPropagation(); p.onMark(r.status === 'followup' ? 'pending' : 'followup') }}>
              {r.status === 'followup' ? '待跟进中' : '待跟进'}
            </Button>
            <Button sm variant="ghost" icon={ArrowUpRight} onClick={(e) => { e.stopPropagation(); p.onJump() }}>回到终端</Button>
            <IconButton
              icon={Trash2}
              title={delArmed ? '再点一次删除' : '删除这条留档'}
              color={delArmed ? sem.danger : undefined}
              onClick={armDelete}
              style={{ marginLeft: 'auto' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function AcceptTab(p: AcceptTabProps): React.JSX.Element {
  const [filter, setFilter] = useState<'pending' | 'accepted' | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // 补验证的流式输出按记录 id 归集（主进程经 followup-event 推送）
  const [runs, setRuns] = useState<Record<string, FollowupRunView>>({})
  useEffect(() => island.onFollowupEvent((ev) => {
    setRuns((map) => {
      const cur = map[ev.runId] || { status: 'running' as const, text: '' }
      const append = (extra?: string): string => ((cur.text || '') + (extra || '')).slice(-6000)
      if (ev.kind === 'start') return { ...map, [ev.runId]: { status: 'running', text: '' } }
      if (ev.kind === 'output') return { ...map, [ev.runId]: { ...cur, status: 'running', text: append(ev.text) } }
      if (ev.kind === 'done') {
        return { ...map, [ev.runId]: { status: cur.status === 'error' ? 'error' : 'done', text: append(ev.text), exitCode: ev.exitCode } }
      }
      return { ...map, [ev.runId]: { status: 'error', text: append(ev.text ? `\n${ev.text}` : '') } }
    })
  }), [])
  const projects = useMemo(() => [...new Set(p.records.map((r) => r.proj).filter(Boolean))].sort(), [p.records])
  // 搜索文本按记录缓存：每次按键只做 includes，不重建全文
  const haystacks = useMemo(() => new Map(p.records.map((r) => [r.id, searchTextOf(r)])), [p.records])
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase()
    return p.records.filter((r) => {
      if (project && r.proj !== project) return false
      if (!q) return true
      return (haystacks.get(r.id) || '').includes(q)
    })
  }, [p.records, project, query, haystacks])
  const counts = useMemo(() => ({
    pending: scoped.filter((r) => r.status !== 'accepted').length,
    accepted: scoped.filter((r) => r.status === 'accepted').length,
    all: scoped.length
  }), [scoped])
  const visible = useMemo(
    () => scoped.filter((r) => (filter === 'all' ? true : filter === 'accepted' ? r.status === 'accepted' : r.status !== 'accepted')),
    [scoped, filter]
  )

  if (p.plans.length === 0 && p.records.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="还没有可验收的会话"
        desc="Agent 会话结束时，岛会把最后回复、git 变更文件和计划原文留在这里，按「计划 → 实际改动 → 未验证项」对照。计划模式提交的计划也仍然在这里审阅。"
        action={
          <div style={{ ...surface.inset(), padding: '7px 13px', color: accentText(0.78), fontSize: FS.tiny, fontFamily: "ui-monospace,'Cascadia Code',monospace" }}>
            想先看看效果？项目目录里运行：npm run demo:plan
          </div>
        }
        style={{ padding: `${SP.xxl - 4}px ${SP.lg}px` }}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {p.plans.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
          {p.plans.map((a) => (
            <PlanCard key={a.id} a={a} wait={(a.requestId && p.waitSecs[a.requestId]) || 0} onDecide={p.onDecide} onJump={p.onJump} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <SectionHeader icon={ClipboardCheck} title={`验收记录 · ${counts.all}`} style={{ marginBottom: 0, flex: 1 }} />
        <Chip active={filter === 'pending'} onClick={() => setFilter('pending')}>待核对 {counts.pending}</Chip>
        <Chip active={filter === 'accepted'} onClick={() => setFilter('accepted')}>已验收 {counts.accepted}</Chip>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>全部 {counts.all}</Chip>
      </div>

      {p.records.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Input
            value={query}
            onChange={setQuery}
            placeholder="搜索项目 / 文件 / 命令 / 计划…"
            style={{ fontSize: FS.small }}
          />
          {projects.length > 1 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <Chip active={project === null} onClick={() => setProject(null)}>全部项目</Chip>
              {projects.map((name) => (
                <Chip key={name} active={project === name} onClick={() => setProject(project === name ? null : name)}>{name}</Chip>
              ))}
            </div>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div style={{ ...text.faint(), fontSize: 10.5, padding: '6px 2px' }}>
          {p.records.length === 0
            ? '还没有会话结束；结束时会自动留档。'
            : scoped.length === 0
              ? '没有匹配的记录，换个关键词或项目试试。'
              : filter === 'accepted' ? '还没有标记为已验收的记录。' : '待核对的记录都处理完了。'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map((r) => (
            <RecordCard
              key={r.id}
              r={r}
              open={openId === r.id}
              run={runs[r.id]}
              gate={p.gate}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onJump={() => p.onJumpRecord(r)}
              onMark={(status, violations) => p.onMark(r.id, status, violations)}
              onRemove={() => p.onRemove(r.id)}
              onPlanToTodos={(texts) => p.onPlanToTodos(r, texts)}
              onSaveCertificate={(markdown) => p.onSaveCertificate(r, markdown)}
              onStartFollow={async (prompt) => {
                const sid = sessionIdOf(r)
                if (!sid || !r.cwd) return { ok: false, error: '这条记录缺少会话 id 或工作目录' }
                const res = await island.startFollowup({
                  runId: r.id,
                  engine: r.backend === 'codex' ? 'codex' : 'claude',
                  sessionId: sid,
                  cwd: r.cwd,
                  prompt
                })
                if (!res.ok) setRuns((map) => ({ ...map, [r.id]: { status: 'error', text: res.error || '启动失败' } }))
                return res
              }}
              onCancelFollow={() => island.cancelFollowup(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
