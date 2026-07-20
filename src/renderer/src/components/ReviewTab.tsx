// 今日复盘 / 周报：把当天完成的待办 + Agent 编码活动 + 代码变更汇成事实卡，
// 一键交给 AI 写成叙述性复盘/周报。数据源自岛内已有信号，不额外采集、不打扰主力工作流。
// 视觉层：ui/tokens 层级表面 + lucide 语义图标 + framer-motion 入场（功能逻辑保持不变）。

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3, Check, Copy, Loader2, NotebookPen, RefreshCw, Sparkles, StickyNote, Sunrise, Volume2
} from 'lucide-react'
import type { ActivityEntry, TodoItem } from '../types'
import {
  buildFacts, dayKey, hasContent, reviewPrompt, weeklyPrompt, morningPrompt,
  REVIEW_SYSTEM, WEEKLY_SYSTEM, MORNING_SYSTEM, type DayFacts, type MorningInput
} from '../logic/review'
import { Markdown, Collapsible } from './Markdown'
import { InsightsPanel } from './InsightsPanel'
import { PetPanel } from './PetPanel'
import { Button, Chip, IconButton } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, FS, ink, R, sem, SP, surface, text, tintSurface } from '../ui/tokens'

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

/** 统计小格：内嵌井表面 + 等大数字，拉开数字/标签层级 */
function Stat({ n, label }: { n: number | string; label: string }): React.JSX.Element {
  return (
    <div style={{
      flex: 1, minWidth: 74, padding: '9px 10px', ...surface.inset(),
      display: 'flex', flexDirection: 'column', gap: 3
    }}>
      <span style={{ ...text.num(18), lineHeight: 1 }}>{n}</span>
      <span style={{ ...text.faint(), fontSize: 10 }}>{label}</span>
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

  /** 生成按钮：busy 转圈 / 已有内容刷新 / 首次生成 */
  const genIcon = (key: string, hasMd: boolean): typeof Sparkles =>
    busy === key ? Loader2 : hasMd ? RefreshCw : Sparkles

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md }}>
      {/* 晨间简报：今日作战地图（聚合日程+待办+资讯+昨日复盘） */}
      <motion.div
        variants={fadeScaleIn}
        initial={false}
        animate="animate"
        style={{
          padding: `${SP.md + 1}px ${SP.md + 2}px`,
          borderRadius: R.xl,
          background: `linear-gradient(135deg, ${tintSurface('var(--th)', .72)}, ${tintSurface('var(--th2)', .5, true)})`,
          border: `0.5px solid ${accent(0.65, 0.3)}`,
          boxShadow: `0 8px 24px -12px ${accent(0.5, 0.4)}`,
          display: 'flex',
          flexDirection: 'column',
          gap: SP.sm
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Sunrise size={14} strokeWidth={1.75} style={{ color: accent(0.9), flex: 'none' }} />
          <span style={{ ...text.subtitle(), fontSize: FS.body }}>今日作战地图</span>
          <span style={{ flex: 1 }} />
          {morningMd && (
            <IconButton icon={Volume2} size={24} title="语音播报 / 停止" onClick={() => speak(morningMd)} />
          )}
          <Button sm variant="primary" icon={genIcon(morningKey, !!morningMd)} onClick={() => run(morningKey, MORNING_SYSTEM, morningPrompt(p.morning))}>
            {busy === morningKey ? '生成中…' : morningMd ? '刷新' : '生成简报'}
          </Button>
        </div>
        {err && busy === null && <div style={{ color: sem.danger, fontSize: FS.tiny }}>{err}</div>}
        {morningMd ? (
          <div style={{ fontSize: FS.small, lineHeight: 1.65 }}><Markdown text={morningMd} /></div>
        ) : (
          <div style={{ ...text.dim(), fontSize: FS.small, lineHeight: 1.6 }}>
            聚合今日日程 · {p.morning.meetings.length} 个会议 / {p.morning.todos.length} 项待办 / {p.morning.picks.length} 条精选 → 一键生成今日定调与优先级。
          </div>
        )}
      </motion.div>

      {/* 日期切换 */}
      <div className="ai-scroll" style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
        {days.map((k) => (
          <Chip key={k} active={sel === k} onClick={() => setSel(k)}>
            {k === todayKey ? '今天' : k.split('-').slice(1).join('/')}
          </Chip>
        ))}
      </div>

      {/* 事实卡 */}
      <motion.div variants={fadeScaleIn} initial={false} animate="animate" style={{ display: 'flex', gap: 7 }}>
        <Stat n={facts.doneTodos.length} label="完成待办" />
        <Stat n={facts.activities.length} label="编码会话" />
        <Stat n={facts.projects.length} label="涉及项目" />
        <Stat n={facts.files ? `+${facts.added}` : '—'} label={facts.files ? `${facts.files} 文件变更` : '代码变更'} />
      </motion.div>

      {/* 今日复盘 */}
      <motion.div variants={fadeScaleIn} initial={false} animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: SP.sm }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <NotebookPen size={13} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
          <span style={{ ...text.subtitle(), fontSize: FS.body }}>{sel === todayKey ? '今日复盘' : '当日复盘'}</span>
          <span style={{ flex: 1 }} />
          {dayMd && busy !== dayReviewKey && (
            <>
              <Button sm variant="ghost" icon={StickyNote} onClick={() => p.onSaveToNotes(dayMd)}>存为灵感便签</Button>
              <IconButton icon={Copy} size={24} title="复制 Markdown" onClick={() => navigator.clipboard?.writeText(dayMd).catch(() => {})} />
            </>
          )}
          {hasContent(facts) ? (
            <Button sm variant="primary" icon={genIcon(dayReviewKey, !!dayMd)} onClick={() => run(dayReviewKey, REVIEW_SYSTEM, reviewPrompt(facts))}>
              {busy === dayReviewKey ? '生成中…' : dayMd ? '重新生成' : '生成复盘'}
            </Button>
          ) : null}
        </div>
        {err && busy === null && <div style={{ color: sem.danger, fontSize: FS.tiny }}>{err}</div>}
        {!hasContent(facts) ? (
          <div style={{ ...text.faint(), padding: '10px 4px', lineHeight: 1.6 }}>
            这一天暂无可复盘的记录。完成待办、或让 Claude Code / Codex 会话在岛内跑起来后，这里会自动积累「今天做了什么」。
          </div>
        ) : dayMd ? (
          <div style={{ ...surface.inset(), padding: SP.md + 1, fontSize: FS.small, lineHeight: 1.6 }}>
            <Markdown text={dayMd} />
          </div>
        ) : (
          // 未生成时先给事实预览，让用户知道有哪些素材
          <div style={{ ...surface.inset(), padding: SP.md, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {facts.doneTodos.slice(0, 6).map((t, i) => (
              <div key={`t${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 6, color: ink(2), fontSize: FS.tiny }}>
                <Check size={11} strokeWidth={2.5} style={{ color: sem.calm, flex: 'none', position: 'relative', top: 1 }} />
                <span style={{ minWidth: 0 }}>{t}</span>
              </div>
            ))}
            {facts.activities.slice(0, 5).map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, ...text.mono(10.5) }}>
                <span style={{ width: 5, height: 5, borderRadius: R.pill, background: accent(0.82, 0.7), flex: 'none' }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  [{a.tool}] {a.proj}{a.files ? ` · +${a.added}/-${a.removed}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* 周报 */}
      <motion.div variants={fadeScaleIn} initial={false} animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: SP.sm, marginTop: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <BarChart3 size={13} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
          <span style={{ ...text.subtitle(), fontSize: FS.body }}>本周周报</span>
          <span style={{ flex: 1 }} />
          {weekMd && busy !== weekReviewKey && (
            <Button sm variant="ghost" icon={StickyNote} onClick={() => p.onSaveToNotes(weekMd)}>存为灵感便签</Button>
          )}
          <Button sm variant="primary" icon={genIcon(weekReviewKey, !!weekMd)} onClick={() => run(weekReviewKey, WEEKLY_SYSTEM, weeklyPrompt(weekFacts))}>
            {busy === weekReviewKey ? '生成中…' : weekMd ? '重新生成' : '生成周报'}
          </Button>
        </div>
        {weekMd && (
          <div style={{ ...surface.inset(), padding: SP.md + 1, fontSize: FS.small, lineHeight: 1.6 }}>
            <Collapsible collapsedHeight={140}><Markdown text={weekMd} /></Collapsible>
          </div>
        )}
      </motion.div>

      {/* 桌宠成长 */}
      <PetPanel pomoDone={p.pomoDone} todos={p.todos} activities={p.activities} />

      {/* 工作节律洞察 */}
      <InsightsPanel todos={p.todos} activities={p.activities} pomoDone={p.pomoDone} />
    </div>
  )
}
