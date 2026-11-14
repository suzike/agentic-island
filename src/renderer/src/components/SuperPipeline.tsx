// 循环流水线可视化 v2：两层真实视图，不是装饰面板。
//
// ① 系统管道（顶部 7 节点）：来源 → 规则 → 排队 → 执行 → 回执 → 拍板 → 复查。
//    计数全部来自中台 totals；流光速度随活跃轮次变化；只有真有活时才流动（空闲完全静止）。
// ② 规则拓扑（下方多行）：每条规则一行，显示它真实的触发方式（cron / 事件来源）、执行它的 Agent，
//    以及它名下此刻的活跃实体（并行轮次 / 等你拍的卡片 / 约定复查）。多个事件同时进来时，
//    会分别落到各自的规则行——这才是"看到分流"，而不是一条线上的一个点。
//
// 动画全部由真实事实（SSE fact 的 type + changes 里的 rule/lane/source）驱动：
// 哪条事实作用在哪条规则上，就闪哪一行、让光从上一阶段流到它命中的阶段。
//
// 性能硬约束（实测踩过：透明置顶窗口里持续重绘会拖慢整机指针）：
// - 无限动画只碰 transform / opacity；不用 background-position / box-shadow 动画
// - 岛收起（animate=false）时全部动画停掉；没有活跃实体时管道不流动
// - 行级闪光是一次性短动画，不是循环

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SuperDecision, SuperFactPulse, SuperPipeline as PipelineCounts, SuperRule, SuperTimer, SuperWork } from '../../../shared/protocol'
import { Ico } from '../ui/icons'
import { accentText, accent, fill, gradient, hairline, ink, R, sem, semBg } from '../ui/tokens'

/** 流水线节点跳转目标：阶段 key 由 SuperTab 决定去哪个视图（来源/规则进编排，运行面进分段） */
type PipeStageKey = 'source' | 'rule' | 'queue' | 'run' | 'report' | 'decide' | 'timer'

/** 一条规则的实时轨道 */
interface RuleTrack {
  key: string
  name: string
  trigger: string
  triggerKind: 'cron' | 'event'
  agent: string | null
  paused: boolean
  /** 今日完成数（来自规则 tally；未知为 0） */
  todayDone: number
  works: SuperWork[]
  decisions: SuperDecision[]
  timers: SuperTimer[]
  active: number
}

interface SuperPipelineProps {
  pipeline: PipelineCounts
  work: SuperWork[]
  decisions: SuperDecision[]
  timers: SuperTimer[]
  rules: SuperRule[]
  /** 最近真实事实（SSE）：驱动节点闪光、区间流光与规则行闪光 */
  facts: SuperFactPulse[]
  live: boolean
  /** 演示模式：仅影响空状态文案 */
  demo?: boolean
  /** 岛是否可见：不可见时停掉全部动画 */
  animate: boolean
  onJump: (seg: PipeStageKey) => void
}

/** 真实事实 type → 系统管道上的阶段 */
const FACT_STAGE: Record<string, number> = {
  ingest: 0,
  rules: 1, rulesError: 1,
  heartbeat: 2, channelSeen: 2,
  started: 3, cancel: 3,
  result: 4,
  createCard: 5, ask: 5, tell: 5, resolve: 5, delivered: 5, failed: 5,
  tick: 6
}

const FACT_LABEL: Record<string, string> = {
  ingest: '来源收到事件',
  rules: '规则已热载',
  rulesError: '规则写错了',
  heartbeat: '接单程序心跳',
  channelSeen: '通道心跳',
  started: '轮次开始执行',
  cancel: '停止轮次',
  result: '回执已提交',
  createCard: '卡片已创建',
  ask: 'Agent 在问你',
  tell: '收到通知',
  resolve: '卡片已结案',
  delivered: '卡片已送达',
  failed: '投递失败',
  tick: '定时/复查到期'
}

const stageOf = (p: PipelineCounts): { key: string; label: string; icon: typeof Ico.rss; count: number; seg: PipeStageKey; tone: 'idle' | 'live' | 'warn' }[] => [
  { key: 'source', label: '来源', icon: Ico.rss, count: p.sources, seg: 'rule', tone: p.sources > 0 ? 'live' : 'idle' },
  { key: 'rule', label: '规则', icon: Ico.magic, count: p.rules, seg: 'rule', tone: p.rules > 0 ? 'live' : 'idle' },
  { key: 'queue', label: '排队', icon: Ico.history, count: p.queued + p.retrying, seg: 'run', tone: p.queued + p.retrying > 0 ? 'live' : 'idle' },
  { key: 'run', label: '执行', icon: Ico.running, count: p.running, seg: 'run', tone: p.running > 0 ? 'live' : 'idle' },
  { key: 'report', label: '回执', icon: Ico.send, count: p.doneToday, seg: 'report', tone: p.doneToday > 0 ? 'live' : 'idle' },
  { key: 'decide', label: '拍板', icon: Ico.approval, count: p.attention, seg: 'decide', tone: p.attention > 0 ? 'warn' : 'idle' },
  { key: 'timer', label: '复查', icon: Ico.timer, count: p.timers, seg: 'report', tone: p.timers > 0 ? 'live' : 'idle' }
]

const fmtClock = (ts: number): string => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 把 work/decisions/timers 按规则名归组，再与 rules 定义合并成拓扑行（规则索引用 Map，避免 O(n²)） */
function buildTracks(rules: SuperRule[], work: SuperWork[], decisions: SuperDecision[], timers: SuperTimer[]): RuleTrack[] {
  const ruleByName = new Map(rules.map((r) => [r.name, r]))
  const byName = new Map<string, RuleTrack>()
  const ensure = (name: string): RuleTrack => {
    let t = byName.get(name)
    if (!t) {
      const rule = ruleByName.get(name) || null
      const kind: RuleTrack['triggerKind'] = rule?.every ? 'cron' : 'event'
      t = {
        key: name,
        name,
        trigger: kind === 'cron' ? (rule?.every || '定时') : (rule?.sourceType || '事件'),
        triggerKind: kind,
        agent: rule?.agent || null,
        paused: !!rule?.paused,
        todayDone: rule?.today?.done ?? 0,
        works: [], decisions: [], timers: [], active: 0
      }
      byName.set(name, t)
    }
    return t
  }
  // 规则定义先建行（没有活跃实体的规则也显示——空行代表"待命"）
  for (const r of rules) ensure(r.name)
  for (const w of work) { const t = ensure(w.rule); t.works.push(w); t.active += 1 }
  for (const d of decisions) { if (!d.rule) continue; const t = ensure(d.rule); t.decisions.push(d); t.active += 1 }
  for (const tm of timers) { const t = ensure(tm.rule); t.timers.push(tm); t.active += 1 }
  // 活跃多的排前，其次按名字（稳定、不跳）
  return [...byName.values()].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export function SuperPipeline({ pipeline, work, decisions, timers, rules, facts, live, demo, animate, onJump }: SuperPipelineProps): React.JSX.Element {
  const stages = stageOf(pipeline)
  const tracks = useMemo(() => buildTracks(rules, work, decisions, timers), [rules, work, decisions, timers])

  const active = pipeline.running + pipeline.queued + pipeline.attention + pipeline.timers
  const busy = active > 0
  // 越忙流得越快；实时流在线时更亮（0.9–2.6s 一圈）
  const speed = busy ? Math.max(0.9, 2.6 - Math.min(active, 8) * 0.2) : 3.6

  // ---- 真实事实 → 动画（只播比已播 seq 新的；积压时 260ms 间隔依次播） ----
  const playedSeq = useRef(0)
  const queueRef = useRef<SuperFactPulse[]>([])
  const [pulse, setPulse] = useState<SuperFactPulse | null>(null)
  const [lastFact, setLastFact] = useState<SuperFactPulse | null>(null)
  useEffect(() => {
    const fresh = facts.filter((f) => f.seq > playedSeq.current && FACT_STAGE[f.type] !== undefined)
    if (fresh.length === 0) return
    // 首次连接不补播历史（否则一开面板炸一串动画）
    if (playedSeq.current === 0 && fresh.length > 1) {
      playedSeq.current = fresh[fresh.length - 1].seq
      return
    }
    queueRef.current.push(...fresh.slice(0, 8))
    playedSeq.current = Math.max(playedSeq.current, fresh[fresh.length - 1].seq)
  }, [facts])

  useEffect(() => {
    if (pulse || queueRef.current.length === 0) return
    const next = queueRef.current.shift() as SuperFactPulse
    setPulse(next)
    setLastFact(next)
    const t = setTimeout(() => setPulse(null), animate ? 900 : 120)
    return () => clearTimeout(t)
  }, [pulse, facts, animate])

  const pulseStage = pulse ? FACT_STAGE[pulse.type] : -1
  const connected = pipeline.sources + pipeline.rules > 0
  // 岛收起时不渲染拓扑行（面板已移出视口，少一棵 DOM 树；只有展开态才需要）
  const visibleTracks = animate ? tracks.slice(0, 7) : []

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: R.lg,
        border: `0.5px solid ${hairline(0.1)}`,
        background: `linear-gradient(180deg, ${fill(2)} 0%, ${fill(1)} 58%, ${fill(1)} 100%)`,
        boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.07), inset 0 -12px 24px -20px rgba(0,0,0,0.35)',
        padding: '10px 12px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: 7
      }}
    >
      <style>{`
        /* 性能：无限动画只碰 transform/opacity；不用 background-position / box-shadow 动画 */
        @keyframes pipe-shift { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes pipe-ring { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(1.9); opacity: 0 } }
        @keyframes pipe-run { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.5); opacity: .6 } }
        @keyframes pipe-breathe { 0%,100% { opacity: .5 } 50% { opacity: 1 } }
        @keyframes pipe-nodeflash { 0% { transform: scale(.7); opacity: .9 } 100% { transform: scale(2.1); opacity: 0 } }
        @keyframes pipe-segflow { 0% { opacity: 0; transform: scaleX(.15) } 25% { opacity: 1 } 100% { opacity: 0; transform: scaleX(1) } }
        .sp-track { position: absolute; left: 3%; right: 3%; height: 2px; overflow: hidden; border-radius: 999px; pointer-events: none; }
        .sp-flow {
          position: absolute; top: 0; bottom: 0; left: 0; width: 200%;
          background-image: repeating-linear-gradient(90deg, transparent 0 26px, var(--flow) 26px 44px, transparent 44px 70px);
          background-size: 70px 100%;
          will-change: transform;
        }
        .sp-node:hover { transform: translateY(-1px) }
        .sp-flash { animation: pipe-nodeflash .8s ease-out 1 both; will-change: transform, opacity }
        .sp-seg { transform-origin: left center; animation: pipe-segflow .8s cubic-bezier(.25,.8,.3,1) 1 both; will-change: transform, opacity }
        /* 规则行被事实命中：一次性的底色闪（不是循环） */
        .sp-rowflash { animation: pipe-rowflash .9s ease-out 1 both }
        @keyframes pipe-rowflash { 0% { background-color: var(--hit) } 100% { background-color: transparent } }
        .sp-trackrow:hover { background-color: var(--hover) }
      `}</style>

      {/* 管道流光（合成层；仅可见且有活时流动） */}
      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        // eslint-disable-next-line react/no-unknown-property
        ref={(el) => {
          if (!el) return
          el.style.setProperty('--flow', accent(0.85, 0.55))
        }}
      >
        <div className="sp-track" style={{ top: 26, opacity: busy ? (live ? 0.95 : 0.7) : 0.2 }}>
          {animate && busy && <div className="sp-flow" style={{ animation: `pipe-shift ${speed}s linear infinite` }} />}
        </div>
        {/* 分段连线：每一段继承左端节点是否活跃（有活的那几段才有存在感） */}
        <div style={{ position: 'absolute', left: '5%', right: '5%', top: 26, display: 'flex', gap: 0, pointerEvents: 'none' }}>
          {stages.slice(0, -1).map((s, i) => (
            <span key={s.key} style={{
              flex: 1, height: 1.5, borderRadius: 999,
              background: s.tone === 'idle' ? hairline(0.08) : semBg(s.tone === 'warn' ? sem.warn : accent(), 0.55)
            }} />
          ))}
        </div>
        {/* 事实驱动的区间流光：从上一节点流到它命中的节点 */}
        {animate && pulse && pulseStage > 0 && (
          <div
            key={`seg-${pulse.seq}`}
            className="sp-seg"
            style={{
              position: 'absolute', top: 25,
              left: `${3 + (94 * (pulseStage - 1)) / (stages.length - 1)}%`,
              width: `${(94 / (stages.length - 1)) * 0.86}%`,
              height: 3, borderRadius: 999,
              background: `linear-gradient(90deg, transparent, ${accent(0.9, 0.75)}, transparent)`,
              pointerEvents: 'none'
            }}
          />
        )}
      </div>

      {/* ① 系统管道：7 阶段 */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        {stages.map((s, i) => {
          const Icon = s.icon
          const tone = s.tone === 'warn' ? sem.warn : s.tone === 'live' ? accent() : ink(4)
          const liveHere = s.tone !== 'idle'
          return (
            <button
              key={s.key}
              type="button"
              className="sp-node"
              title={`${s.label} · ${s.count}${s.tone === 'warn' ? '（需要你）' : ''} — 点击查看`}
              onClick={() => onJump(s.key as PipeStageKey)}
              style={{
                position: 'relative', flex: 1, minWidth: 0, border: 0, background: 'transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'transform .16s ease', padding: 0
              }}
            >
              <span style={{ position: 'relative', width: 26, height: 26, flex: 'none', display: 'grid', placeItems: 'center' }}>
                {animate && liveHere && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute', inset: -2, borderRadius: 999, pointerEvents: 'none',
                      border: `1px solid ${tone}`, opacity: 0.5,
                      animation: s.key === 'run' ? 'pipe-ring 1.7s ease-out infinite'
                        : s.key === 'decide' ? 'pipe-breathe 2.2s ease-in-out infinite'
                          : s.key === 'queue' ? 'pipe-breathe 3.2s ease-in-out infinite' : undefined
                    }}
                  />
                )}
                {animate && pulseStage === i && (
                  <span
                    key={`flash-${pulse?.seq}`}
                    aria-hidden
                    className="sp-flash"
                    style={{ position: 'absolute', inset: -2, borderRadius: 999, border: `1.5px solid ${tone}`, pointerEvents: 'none' }}
                  />
                )}
                <span
                  style={{
                    position: 'relative', width: 26, height: 26, borderRadius: 999,
                    display: 'grid', placeItems: 'center',
                    background: liveHere ? semBg(s.tone === 'warn' ? sem.warn : accent(), 0.16) : fill(2),
                    border: `0.5px solid ${liveHere ? semBg(s.tone === 'warn' ? sem.warn : accent(), 0.4) : hairline(0.1)}`,
                    color: liveHere ? (s.tone === 'warn' ? sem.warn : accentText(0.9)) : ink(3)
                  }}
                >
                  <Icon size={13} strokeWidth={2} />
                  {s.count > 0 && (
                    <span
                      style={{
                        position: 'absolute', top: -3, right: -5, minWidth: 13, height: 13, padding: '0 3px',
                        borderRadius: 999, display: 'grid', placeItems: 'center',
                        background: s.tone === 'warn' ? sem.warn : accent(),
                        color: s.tone === 'warn' ? 'oklch(0.2 0.02 75)' : gradient.onPrimary(),
                        fontSize: 8.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      {s.count > 99 ? '99+' : s.count}
                    </span>
                  )}
                </span>
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 650, color: liveHere ? ink(2) : ink(4), letterSpacing: '.02em' }}>{s.label}</span>
            </button>
          )
        })}
      </div>

      {/* ② 规则拓扑：每条规则一行，多个事件分流到各自的规则 */}
      {visibleTracks.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {visibleTracks.map((t) => (
            <TrackRow
              key={t.key}
              t={t}
              animate={animate}
              hit={!!pulse && (pulse.rule === t.name || (!pulse.rule && !!pulse.source && t.triggerKind === 'event' && t.trigger === pulse.source))}
              hitKey={pulse?.seq || 0}
              onJump={onJump}
            />
          ))}
          {tracks.length > visibleTracks.length && (
            <button
              type="button"
              onClick={() => onJump('rule')}
              style={{ border: 0, background: 'transparent', color: ink(4), fontSize: 8.5, textAlign: 'left', cursor: 'pointer', padding: '1px 2px', fontFamily: 'inherit' }}
            >
              还有 {tracks.length - visibleTracks.length} 条规则 · 点开规则列表
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 17 }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: connected ? accent(0.7, 0.5) : ink(4), animation: animate && connected ? 'pipe-breathe 3s ease-in-out infinite' : undefined }} />
          <span style={{ fontSize: 9, color: ink(3), lineHeight: 1.4 }}>
            {connected ? (demo ? '演示管道：真实接入后这里会按规则分流' : '管道待命——事件到达或定时到点后，会落到对应规则行') : '还没有接入中台：装好 agent-autoloop 后这里会亮起来'}
          </span>
        </div>
      )}

      {/* 最近一条真实事实：管道"此刻在动"的可读证据 */}
      {lastFact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 4, height: 4, borderRadius: 999, background: accent(), animation: animate ? 'pipe-breathe 2s ease-in-out infinite' : undefined, flex: 'none' }} />
          <span style={{ fontSize: 8.5, color: ink(4), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            最近事实：{FACT_LABEL[lastFact.type] || lastFact.type}
            {lastFact.rule ? ` · ${lastFact.rule}${lastFact.lane ? `/${lastFact.lane}` : ''}` : lastFact.source ? ` · ${lastFact.source}` : ''}
            {live ? ' · 实时流' : ''}
          </span>
        </div>
      )}
    </div>
  )
}

/** 一条规则行：[触发方式] [规则名 · Agent] [活跃实体 chips] */
function TrackRow({ t, animate, hit, hitKey, onJump }: {
  t: RuleTrack
  animate: boolean
  hit: boolean
  hitKey: number
  onJump: (seg: PipeStageKey) => void
}): React.JSX.Element {
  const runChips = t.works.slice(0, 3)
  const extra = t.works.length - runChips.length
  return (
    <div
      className={`sp-trackrow${hit && animate ? ' sp-rowflash' : ''}`}
      key={hit && animate ? `hit-${hitKey}` : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, minHeight: 18, padding: '0 2px',
        borderRadius: R.sm, opacity: t.paused ? 0.62 : 1,
        // eslint-disable-next-line react/no-unknown-property
        ['--hit' as string]: semBg(accent(), 0.2),
        ['--hover' as string]: fill(1)
      } as React.CSSProperties}
    >
      {/* 触发方式：cron 或事件来源 */}
      {/* 树状连接：竖线 + 横线（活跃行用强调色，一眼看出哪条在转） */}
      <span aria-hidden style={{ position: 'relative', width: 7, height: 18, flex: 'none' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: t.active > 0 ? semBg(accent(), 0.45) : hairline(0.1) }} />
        <span style={{ position: 'absolute', left: 0, top: '50%', width: 5, height: 1, background: t.active > 0 ? semBg(accent(), 0.45) : hairline(0.1) }} />
      </span>
      <span
        title={t.triggerKind === 'cron' ? `定时：${t.trigger}` : `事件来源：${t.trigger}`}
        style={{
          width: 16, height: 16, borderRadius: 5, flex: 'none', display: 'grid', placeItems: 'center',
          background: t.triggerKind === 'cron' ? fill(2) : semBg(sem.focus, 0.14),
          color: t.triggerKind === 'cron' ? ink(3) : sem.focus
        }}
      >
        {t.triggerKind === 'cron' ? <Ico.timer size={9} strokeWidth={2} /> : <Ico.rss size={9} strokeWidth={2} />}
      </span>
      {/* 规则名 + Agent */}
      <button
        type="button"
        onClick={() => onJump('rule')}
        title={`${t.name}${t.agent ? ` · ${t.agent}` : ''}${t.paused ? ' · 已暂停' : ''}`}
        style={{
          border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left',
          display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0, width: '38%', flex: 'none'
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 650, color: ink(1), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {t.name}
        </span>
        {t.agent && <span style={{ fontSize: 8, color: ink(4), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 'none', maxWidth: 62 }}>{t.agent}</span>}
        {t.paused && <span style={{ fontSize: 8, fontWeight: 700, color: sem.warn, flex: 'none' }}>暂停</span>}
      </button>
      {/* 活跃实体 chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {runChips.map((w) => {
          const tone = w.state === 'unknown' ? sem.warn : w.stopping ? ink(3) : accent()
          const label = w.stopping ? '停止中' : w.state === 'claimed' ? '执行' : w.attempts > 0 ? `重试${w.attempts}` : '排队'
          return (
            <span
              key={w.runId}
              title={`run #${w.runId} · ${w.agent || 'Agent'}${w.lane ? ` · ${w.lane}` : ''}${w.summary ? `\n${w.summary}` : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: R.sm,
                background: semBg(w.state === 'unknown' ? sem.warn : accent(), 0.13), flex: 'none', maxWidth: 96
              }}
            >
              <span style={{
                width: 4, height: 4, borderRadius: 999, background: tone, flex: 'none',
                animation: animate && w.state === 'claimed' && !w.stopping ? 'pipe-run 1.4s ease-in-out infinite' : undefined
              }} />
              <span style={{ fontSize: 8, color: ink(2), fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {w.lane ? `${w.lane} ` : ''}{label}
              </span>
            </span>
          )
        })}
        {extra > 0 && <span style={{ fontSize: 8, color: ink(4), flex: 'none' }}>+{extra}</span>}
        {t.decisions.length > 0 && (
          <button
            type="button"
            onClick={() => onJump('decide')}
            title={t.decisions.map((d) => d.title).join('\n')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: R.sm,
              border: 0, fontFamily: 'inherit', cursor: 'pointer', flex: 'none',
              background: semBg(sem.warn, 0.18), color: ink(1), fontSize: 8, fontWeight: 700
            }}
          >
            <Ico.approval size={8} strokeWidth={2.4} />{t.decisions.length} 待拍板
          </button>
        )}
        {t.timers.length > 0 && (
          <span
            title={t.timers.map((x) => `${fmtClock(x.at)} ${x.about}`).join('\n')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: R.sm, background: fill(1), flex: 'none' }}
          >
            <Ico.clock size={8} strokeWidth={2} style={{ color: ink(3) }} />
            <span style={{ fontSize: 8, color: ink(3) }}>{fmtClock(t.timers[0].at)}</span>
          </span>
        )}
        {/* 空闲时显示今日完成数（真实 tally），否则"待命" */}
        {t.active === 0 && (
          <span style={{ fontSize: 8, color: ink(4), flex: 'none' }} title="今日完成">
            {t.todayDone > 0 ? `今日 ${t.todayDone}` : '待命'}
          </span>
        )}
      </div>
    </div>
  )
}
