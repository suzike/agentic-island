// 常驻迷你条 v3：宽度与灵动岛同步 · 文字一律白色（彩色只给光效）· 组合显示（文字+宠物叠加）
// 模式：名言 / 开发经验 / AI 个性语录 / 智能简报(日程·待办·Agent 实时速览) / 正在播放 ♪
//      流动光带 / 跳动律动 / 霓虹脉冲 / 小宠物（与文字类叠加散步，单选时全条散步）
// 点击展开岛；配置在 Settings › 常驻迷你条；头部 〰 一键开关。

import { useEffect, useMemo, useState } from 'react'
import type { BarConfig } from '../types'
import { parseLrc, currentLine, type LrcLine } from '../logic/lrc'

export interface BarMedia {
  title: string
  artist: string
  playing: boolean
  thumb: string
}

// 内容池由 App 合并注入（内置库 + AI 每 10 分钟刷新 + GitHub 热门 + 自定义主题），见 logic/barContent.ts

const rainbowGrad = 'linear-gradient(90deg, oklch(0.75 0.15 150), oklch(0.75 0.14 230), oklch(0.75 0.15 300), oklch(0.78 0.13 75), oklch(0.75 0.15 150))'
/** 文字一律近白（用户定），彩色只给光效元素 */
const TEXT_COLOR = 'oklch(0.95 0.005 var(--th) / .95)'

const accentOf = (cfg: BarConfig): string =>
  cfg.colorMode === 'custom' ? `oklch(0.78 0.14 ${cfg.hue})` : 'oklch(0.78 calc(0.14 * var(--cs, 1)) var(--th))'

const TEXT_MODES = ['quotes', 'exp', 'agent', 'thermal', 'github', 'custom', 'brief']
const VISUAL_MODES = ['flow', 'eq', 'neon']
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function AmbientBar({ cfg, media, brief, pools, width, onMediaKey, onOpen, fetchLyrics }: {
  cfg: BarConfig
  media: BarMedia | null
  /** 智能简报条目（App 实时拼装：下个会议/到期待办/活动 Agent） */
  brief: string[]
  /** 各文字模式的内容池（内置 + AI 刷新 + GitHub + 自定义主题，App 合并） */
  pools: Record<string, string[]>
  /** 迷你条宽度（独立设置） */
  width: number
  onMediaKey: (cmd: string) => void
  onOpen: () => void
  /** 拉取当前歌曲的 LRC 歌词（迷你条歌词滚动用） */
  fetchLyrics?: (title: string, artist: string) => Promise<{ ok: boolean; lrc?: string; plain?: string }>
}): React.JSX.Element {
  const modes = cfg.modes.length ? cfg.modes : ['quotes']

  // 歌词：按曲目变化拉取 LRC，按"检测起始"近似计时滚动（无播放位置，仅氛围展示）
  const [lyric, setLyric] = useState<{ key: string; lines: LrcLine[]; startAt: number }>({ key: '', lines: [], startAt: 0 })
  const [lyricNow, setLyricNow] = useState(0)
  const songKey = media ? `${media.title}|${media.artist}` : ''
  useEffect(() => {
    if (!media || !songKey || !fetchLyrics) return
    if (lyric.key === songKey) return
    let dead = false
    void fetchLyrics(media.title, media.artist).then((r) => {
      if (dead) return
      setLyric({ key: songKey, lines: r.ok && r.lrc ? parseLrc(r.lrc) : [], startAt: Date.now() })
    })
    return () => { dead = true }
  }, [songKey, media, fetchLyrics, lyric.key])
  useEffect(() => {
    if (!lyric.lines.length || !media?.playing) return
    const t = setInterval(() => setLyricNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [lyric.lines.length, media?.playing])
  const lyricLine = lyric.lines.length ? currentLine(lyric.lines, (lyricNow - lyric.startAt) / 1000) : ''
  const [slot, setSlot] = useState(0)
  const [textIdx, setTextIdx] = useState(() => Math.floor(Math.random() * 997))
  useEffect(() => {
    const t = setInterval(() => { setSlot((s) => s + 1); setTextIdx((i) => i + 1) }, 12000)
    return () => clearInterval(t)
  }, [])

  const accent = accentOf(cfg)
  const rainbow = cfg.colorMode === 'rainbow'
  const barW = Math.max(240, Math.min(width, (typeof window !== 'undefined' ? window.innerWidth : 940) - 28))

  // 轮播槽位：文字类 + 时钟 + 音乐 + 视觉类；宠物默认叠加在文字/时钟/音乐上（仅当只选宠物时独占）
  const slots = useMemo(() => {
    const s = [
      ...modes.filter((m) => TEXT_MODES.includes(m)),
      ...(modes.includes('clock') ? ['clock'] : []),
      ...(modes.includes('music') ? ['music'] : []),
      ...modes.filter((m) => VISUAL_MODES.includes(m))
    ]
    return s.length ? s : ['pet']
  }, [modes])
  const mode = slots[slot % slots.length]
  const petOverlay = modes.includes('pet') && mode !== 'pet' && !VISUAL_MODES.includes(mode)

  // 时钟模式：秒级刷新
  const [clockNow, setClockNow] = useState(() => new Date())
  useEffect(() => {
    if (mode !== 'clock') return
    const t = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [mode])

  const text = useMemo(() => {
    if (mode === 'brief') return brief.length ? brief[textIdx % brief.length] : '今日暂无日程与到期待办 · 一切安静'
    const pool = pools[mode] || []
    if (!pool.length) return mode === 'github' ? '⭐ 正在拉取 GitHub 本周热门…' : mode === 'custom' ? '在 设置 › 常驻迷你条 里添加自定义主题，AI 会为你生成内容' : '…'
    return pool[textIdx % pool.length]
  }, [mode, textIdx, pools, brief])

  const eqBars = useMemo(() => Array.from({ length: Math.floor(barW / 12) }, (_, i) => ({ d: 0.55 + ((i * 37) % 50) / 100, delay: ((i * 53) % 90) / 100 })), [barW])

  // 文字渲染：装不下自动跑马灯（不限字数），否则上浮模糊入场
  const renderText = (t: string, rightPad: number): React.JSX.Element =>
    t.length * 11 > barW - 60 - rightPad ? (
      <div key={textIdx} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'inline-flex', gap: 56, whiteSpace: 'nowrap', animation: `ai-marquee ${Math.max(10, t.length * 0.3)}s linear infinite`, fontSize: 10.5, letterSpacing: '.015em', color: TEXT_COLOR }}>
          <span>{t}</span>
          <span>{t}</span>
        </div>
      </div>
    ) : (
      <div key={textIdx} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '.015em', color: TEXT_COLOR, animation: 'ai-riseblur .7s cubic-bezier(.22,.61,.36,1)' }}>
        {t}
      </div>
    )

  return (
    <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }}>
      {/* 两侧凹角内弧：半径与条身圆角一致（17px），颜色/透明度与条身完全相同 → 自然过渡 */}
      <div style={{ position: 'absolute', top: 0, left: -17, width: 17, height: 17, background: 'radial-gradient(circle at 0% 100%, transparent 0 17px, oklch(calc(0.15 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.95) 17.5px)' }} />
      <div style={{ position: 'absolute', top: 0, right: -17, width: 17, height: 17, background: 'radial-gradient(circle at 100% 100%, transparent 0 17px, oklch(calc(0.15 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.95) 17.5px)' }} />
      <div
        data-solid
        className="hv"
        onClick={onOpen}
        title="点击展开灵动岛（内容与样式在 Settings › 常驻迷你条 自定义）"
        style={{
          width: barW, height: 36, borderRadius: '0 0 17px 17px', overflow: 'hidden',
          background: 'oklch(calc(0.15 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / 0.95)',
          backdropFilter: 'blur(18px) saturate(150%)',
          border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / 0.16)', borderTop: 'none',
          display: 'flex', alignItems: 'center', padding: '0 16px',
          cursor: 'pointer', boxSizing: 'border-box', position: 'relative'
        }}
      >
        {/* 背景光斑（景深）+ 内容切换时的高光扫过 —— 常驻氛围特效 */}
        <div style={{ position: 'absolute', left: '12%', top: -10, width: 60, height: 42, borderRadius: 999, background: rainbow ? 'oklch(0.7 0.14 230 / .3)' : accent, opacity: 0.14, filter: 'blur(16px)', animation: 'ai-drift1 6s ease-in-out infinite alternate', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', right: '14%', top: -8, width: 46, height: 38, borderRadius: 999, background: rainbow ? 'oklch(0.72 0.15 320 / .3)' : accent, opacity: 0.1, filter: 'blur(14px)', animation: 'ai-drift2 7.5s ease-in-out infinite alternate', pointerEvents: 'none' }} />
        <div key={'sh' + slot} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '38%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.09), transparent)', animation: 'ai-shimmer 1.4s ease-out 1', pointerEvents: 'none' }} />

        {mode === 'clock' && (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 9, width: '100%', animation: 'ai-riseblur .7s ease' }}>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '.06em', fontVariantNumeric: 'tabular-nums', color: TEXT_COLOR }}>
              {String(clockNow.getHours()).padStart(2, '0')}:{String(clockNow.getMinutes()).padStart(2, '0')}
              <span style={{ fontSize: 10.5, opacity: 0.6 }}>:{String(clockNow.getSeconds()).padStart(2, '0')}</span>
            </span>
            <span style={{ fontSize: 10, color: 'oklch(0.8 0.01 var(--th) / .7)' }}>
              {clockNow.getMonth() + 1} 月 {clockNow.getDate()} 日 · {WEEKDAYS[clockNow.getDay()]}
            </span>
          </div>
        )}
        {mode === 'flow' && <div style={{ width: '100%', height: 3, borderRadius: 999, background: rainbow ? rainbowGrad : `linear-gradient(90deg, transparent, ${accent}, transparent)`, backgroundSize: '300% 100%', animation: 'ai-flow 7s linear infinite', opacity: 0.9 }} />}
        {mode === 'neon' && (
          <div style={{ width: '100%', height: 2.5, borderRadius: 999, background: rainbow ? rainbowGrad : accent, backgroundSize: '300% 100%', animation: 'ai-neon 1.6s ease-in-out infinite, ai-flow 9s linear infinite' }} />
        )}
        {mode === 'eq' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, width: '100%', height: '100%' }}>
            {eqBars.map((b, i) => (
              <div key={i} style={{ width: 3.5, height: 16, borderRadius: 999, transformOrigin: 'center', background: rainbow ? `oklch(0.75 0.15 ${Math.round((i * 360) / eqBars.length)})` : accent, animation: `ai-eq ${b.d}s ease-in-out ${b.delay}s infinite alternate`, opacity: 0.9 }} />
            ))}
          </div>
        )}
        {mode === 'pet' && (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <span style={{ position: 'absolute', bottom: 4, left: 0, animation: 'ai-walk 11s ease-in-out infinite alternate' }}>
              <span style={{ display: 'inline-block', fontSize: 21, animation: 'ai-hop .55s ease-in-out infinite alternate' }}>{cfg.petEmoji || '🐈'}</span>
            </span>
            <div style={{ position: 'absolute', left: 6, right: 6, bottom: 4, height: 1, background: 'rgba(255,255,255,.14)' }} />
          </div>
        )}
        {TEXT_MODES.includes(mode) && (
          <>
            {mode === 'brief' && <span style={{ flex: 'none', fontSize: 11, marginRight: 7, opacity: 0.85 }}>📋</span>}
            {renderText(text, petOverlay ? 34 : 0)}
          </>
        )}
        {/* 组合显示：小宠物叠加在文字/时钟/音乐上，右侧小步踱步 */}
        {petOverlay && (
          <span style={{ position: 'absolute', right: 14, bottom: 2, width: 32, height: 24, pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', bottom: 1, left: 0, animation: 'ai-walkmini 4.5s ease-in-out infinite alternate' }}>
              <span style={{ display: 'inline-block', fontSize: 17, animation: 'ai-hop .5s ease-in-out infinite alternate' }}>{cfg.petEmoji || '🐈'}</span>
            </span>
          </span>
        )}
        {mode === 'music' && (
          media ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
              {media.thumb ? (
                <img src={`data:image/jpeg;base64,${media.thumb}`} style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
              ) : (
                <span style={{ fontSize: 13, flex: 'none' }}>♪</span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                {[0.5, 0.72, 0.6, 0.85].map((d, i) => (
                  <div key={i} style={{ width: 2.5, height: 12, borderRadius: 999, transformOrigin: 'center', background: rainbow ? `oklch(0.75 0.15 ${i * 90})` : accent, animation: media.playing ? `ai-eq ${d}s ease-in-out ${i * 0.12}s infinite alternate` : undefined, transform: media.playing ? undefined : 'scaleY(0.3)' }} />
                ))}
              </div>
              <span key={lyricLine} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5, color: TEXT_COLOR, animation: lyricLine ? 'ai-riseblur .4s ease' : undefined }}>
                {lyricLine || `${media.title}${media.artist ? ` · ${media.artist}` : ''}`}
              </span>
              {([['prev', '⏮'], ['playpause', media.playing ? '⏸' : '⏵'], ['next', '⏭'], ['voldown', '−'], ['volup', '＋']] as const).map(([c, icon]) => (
                <span key={c} className="hv" onClick={(e) => { e.stopPropagation(); onMediaKey(c) }} style={{ flex: 'none', width: 19, height: 19, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: c === 'voldown' || c === 'volup' ? 11 : 10, cursor: 'pointer', color: TEXT_COLOR, background: 'rgba(255,255,255,.08)' }}>
                  {icon}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ width: '100%', textAlign: 'center', fontSize: 10.5, color: 'oklch(0.7 0.01 var(--th) / .7)' }}>♪ 未检测到正在播放的音乐</span>
          )
        )}
        {/* 底部呼吸微光线（彩色只出现在这类光效上） */}
        <div style={{ position: 'absolute', left: '14%', right: '14%', bottom: 0, height: 1.5, borderRadius: 999, background: rainbow ? rainbowGrad : `linear-gradient(90deg, transparent, ${accent}, transparent)`, backgroundSize: '200% 100%', animation: 'ai-flow 5s ease-in-out infinite', opacity: 0.5 }} />
      </div>
    </div>
  )
}
