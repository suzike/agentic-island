// 今日复盘 / 周报：把当天完成的待办 + Agent 编码活动 + 代码变更汇成事实卡，
// 一键交给 AI 写成叙述性复盘/周报。数据源自岛内已有信号，不额外采集、不打扰主力工作流。

import { useMemo, useState } from 'react'
import type { ActivityEntry, TodoItem } from '../types'
import {
  buildFacts, dayKey, hasContent, reviewPrompt, weeklyPrompt, morningPrompt,
  REVIEW_SYSTEM, WEEKLY_SYSTEM, MORNING_SYSTEM, type DayFacts, type MorningInput
} from '../logic/review'
import { Markdown, Collapsible } from './Markdown'
import { InsightsPanel } from './InsightsPanel'
import { PetPanel } from './PetPanel'

interface ReviewTabProps {
  todos: TodoItem[]
  activities: ActivityEntry[]
  pomoDone: Record<string, number>
  /** 晨间简报素材 */
  morning: MorningInput
  /** 已生成的复盘：键 d:YYYY-MM-DD（日）/ w:YYYY-MM-DD（周，值为该周任一天键） */
  reviews: Record<string, string>
  onSaveReview: (key: string, md: string) => void
  onGenerate: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  onSaveToNotes: (md: string) => void
  llmReady: boolean
  onOpenLlmSettings: () => void
}

const chip = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
  background: active ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .2)' : 'rgba(255,255,255,.05)',
  color: active ? 'oklch(0.88 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.72 0.02 var(--th) / .7)',
  border: `1px solid ${active ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)' : 'rgba(255,255,255,.06)'}`
})

const statBox: React.CSSProperties = {
  flex: 1, minWidth: 74, padding: '9px 10px', borderRadius: 11,
  background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)',
  display: 'flex', flexDirection: 'column', gap: 3
}

function Stat({ n, label }: { n: number | string; label: string }): React.JSX.Element {
  return (
    <div style={statBox}>
      <span style={{ color: 'oklch(0.92 calc(0.08 * var(--cs, 1)) var(--th))', fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{n}</span>
      <span style={{ color: 'oklch(0.66 0.02 var(--th) / .65)', fontSize: 10 }}>{label}</span>
    </div>
  )
}

export function ReviewTab(p: ReviewTabProps): React.JSX.Element {
  const todayKey = dayKey(Date.now())
  const [sel, setSel] = useState(todayKey)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // 有内容的日期（当天 + 有待办/活动的往日），倒序
  const days = useMemo(() => {
    const keys = new Set<string>([todayKey])
    p.activities.forEach((a) => keys.add(dayKey(a.ts)))
    p.todos.forEach((t) => { if (t.done && t.doneAt) keys.add(dayKey(t.doneAt)) })
    return [...keys].sort().reverse().slice(0, 14)
  }, [p.activities, p.todos, todayKey])

  const facts: DayFacts = useMemo(() => buildFacts(sel, p.todos, p.activities), [sel, p.todos, p.activities])

  // 本周（近 7 天）事实
  const weekFacts: DayFacts[] = useMemo(() => {
    const out: DayFacts[] = []
    for (let i = 0; i < 7; i++) {
      const k = dayKey(Date.now() - i * 86400_000)
      out.push(buildFacts(k, p.todos, p.activities))
    }
    return out
  }, [p.todos, p.activities])

  const dayReviewKey = `d:${sel}`
  const weekReviewKey = `w:${todayKey}`
  const dayMd = p.reviews[dayReviewKey]
  const weekMd = p.reviews[weekReviewKey]
  const morningKey = `m:${todayKey}`
  const morningMd = p.reviews[morningKey]

  // 语音播报：去掉 Markdown 记号后朗读（Web Speech API，中文）
  const speak = (md: string): void => {
    try {
      const synth = window.speechSynthesis
      if (synth.speaking) { synth.cancel(); return }
      const text = md.replace(/[#>*`_-]+/g, ' ').replace(/\n+/g, '。').replace(/\s+/g, ' ').trim()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'; u.rate = 1.05
      synth.speak(u)
    } catch { /* 环境不支持则静默 */ }
  }

  const run = async (storeKey: string, system: string, user: string): Promise<void> => {
    if (!p.llmReady) { p.onOpenLlmSettings(); return }
    setBusy(storeKey); setErr(null)
    const res = await p.onGenerate(system, user)
    setBusy(null)
    if (res.ok && res.text) p.onSaveReview(storeKey, res.text.trim())
    else setErr(res.error || '生成失败，请检查模型配置')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 晨间简报：今日作战地图（聚合日程+待办+资讯+昨日复盘） */}
      <div style={{ padding: '13px 14px', borderRadius: 15, background: 'linear-gradient(135deg, oklch(0.34 calc(0.07 * var(--cs, 1)) var(--th) / .5), oklch(0.24 calc(0.05 * var(--cs, 1)) var(--th2) / .3))', border: '1px solid oklch(0.65 calc(0.12 * var(--cs, 1)) var(--th) / .35)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 12.5, fontWeight: 800 }}>🌅 今日作战地图</span>
          <span style={{ flex: 1 }} />
          {morningMd && (
            <span className="hv" onClick={() => speak(morningMd)} title="语音播报 / 停止" style={chip(false)}>🔊</span>
          )}
          <span className="hv" onClick={() => run(morningKey, MORNING_SYSTEM, morningPrompt(p.morning))} style={chip(true)}>
            {busy === morningKey ? '✨ 生成中…' : morningMd ? '↺ 刷新' : '✨ 生成简报'}
          </span>
        </div>
        {err && busy === null && <div style={{ color: 'oklch(0.75 0.1 30)', fontSize: 11 }}>{err}</div>}
        {morningMd ? (
          <div style={{ fontSize: 12, lineHeight: 1.65 }}><Markdown text={morningMd} /></div>
        ) : (
          <div style={{ color: 'oklch(0.82 0.02 var(--th) / .82)', fontSize: 11, lineHeight: 1.6 }}>
            聚合今日日程 · {p.morning.meetings.length} 个会议 / {p.morning.todos.length} 项待办 / {p.morning.picks.length} 条精选 → 一键生成今日定调与优先级。
          </div>
        )}
      </div>

      {/* 日期切换 */}
      <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
        {days.map((k) => (
          <div key={k} className="hv" onClick={() => setSel(k)} style={chip(sel === k)}>
            {k === todayKey ? '今天' : k.split('-').slice(1).join('/')}
          </div>
        ))}
      </div>

      {/* 事实卡 */}
      <div style={{ display: 'flex', gap: 7 }}>
        <Stat n={facts.doneTodos.length} label="完成待办" />
        <Stat n={facts.activities.length} label="编码会话" />
        <Stat n={facts.projects.length} label="涉及项目" />
        <Stat n={facts.files ? `+${facts.added}` : '—'} label={facts.files ? `${facts.files} 文件变更` : '代码变更'} />
      </div>

      {/* 今日复盘 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color: 'oklch(0.92 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 12.5, fontWeight: 800 }}>📝 {sel === todayKey ? '今日复盘' : '当日复盘'}</span>
          <span style={{ flex: 1 }} />
          {dayMd && busy !== dayReviewKey && (
            <>
              <span className="hv" onClick={() => p.onSaveToNotes(dayMd)} style={chip(false)}>存为灵感便签</span>
              <span className="hv" onClick={() => navigator.clipboard?.writeText(dayMd).catch(() => {})} style={chip(false)}>⧉</span>
            </>
          )}
          {hasContent(facts) ? (
            <span className="hv" onClick={() => run(dayReviewKey, REVIEW_SYSTEM, reviewPrompt(facts))} style={chip(true)}>
              {busy === dayReviewKey ? '✨ 生成中…' : dayMd ? '↺ 重新生成' : '✨ 生成复盘'}
            </span>
          ) : null}
        </div>
        {err && busy === null && <div style={{ color: 'oklch(0.75 0.1 30)', fontSize: 11 }}>{err}</div>}
        {!hasContent(facts) ? (
          <div style={{ color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 11, padding: '10px 4px', lineHeight: 1.6 }}>
            这一天暂无可复盘的记录。完成待办、或让 Claude Code / Codex 会话在岛内跑起来后，这里会自动积累「今天做了什么」。
          </div>
        ) : dayMd ? (
          <div style={{ padding: 13, borderRadius: 13, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)', fontSize: 12, lineHeight: 1.6 }}>
            <Markdown text={dayMd} />
          </div>
        ) : (
          // 未生成时先给事实预览，让用户知道有哪些素材
          <div style={{ padding: 12, borderRadius: 13, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {facts.doneTodos.slice(0, 6).map((t, i) => (
              <div key={`t${i}`} style={{ color: 'oklch(0.8 0.02 var(--th) / .82)', fontSize: 11 }}>✓ {t}</div>
            ))}
            {facts.activities.slice(0, 5).map((a) => (
              <div key={a.id} style={{ color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 10.5 }}>
                ◆ [{a.tool}] {a.proj}{a.files ? ` · +${a.added}/-${a.removed}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 周报 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ color: 'oklch(0.9 calc(0.06 * var(--cs, 1)) var(--th))', fontSize: 12, fontWeight: 800 }}>📊 本周周报</span>
          <span style={{ flex: 1 }} />
          {weekMd && busy !== weekReviewKey && (
            <span className="hv" onClick={() => p.onSaveToNotes(weekMd)} style={chip(false)}>存为灵感便签</span>
          )}
          <span className="hv" onClick={() => run(weekReviewKey, WEEKLY_SYSTEM, weeklyPrompt(weekFacts))} style={chip(true)}>
            {busy === weekReviewKey ? '✨ 生成中…' : weekMd ? '↺ 重新生成' : '✨ 生成周报'}
          </span>
        </div>
        {weekMd && (
          <div style={{ padding: 13, borderRadius: 13, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)', fontSize: 12, lineHeight: 1.6 }}>
            <Collapsible collapsedHeight={140}><Markdown text={weekMd} /></Collapsible>
          </div>
        )}
      </div>

      {/* 桌宠成长 */}
      <PetPanel pomoDone={p.pomoDone} todos={p.todos} activities={p.activities} />

      {/* 工作节律洞察 */}
      <InsightsPanel todos={p.todos} activities={p.activities} pomoDone={p.pomoDone} />
    </div>
  )
}
