import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Activity, BellRing, Bot, ChevronDown, ChevronLeft, ChevronRight, Clock3, Coffee,
  Focus, Github, Lightbulb, ListTodo, MessageCircleQuestion, Music2, Pause, Play,
  Radio, SkipBack, SkipForward, Sparkles, Volume1, Volume2, Waves
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BarConfig } from '../types'
import type { AmbientStatus, AmbientStatusKind } from '../logic/ambientBar'
import { AMBIENT_TEXT_MODES, buildAmbientSlots, clampBarRotation } from '../logic/ambientBar'
import { parseLrc, currentLine, type LrcLine } from '../logic/lrc'
import { accent as dsAccent, ink } from '../ui/tokens'

export interface BarMedia {
  title: string
  artist: string
  playing: boolean
  thumb: string
}

interface AmbientBarProps {
  cfg: BarConfig
  media: BarMedia | null
  brief: string[]
  pools: Record<string, string[]>
  width: number
  status: AmbientStatus
  onMediaKey: (cmd: string) => void
  onOpen: () => void
  onOpenTarget: (target: 'agents' | 'todos') => void
  fetchLyrics?: (title: string, artist: string) => Promise<{ ok: boolean; lrc?: string; plain?: string }>
}

const VISUAL_MODES = ['flow', 'eq', 'neon']
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const TEXT_COLOR = ink(1)
const RAINBOW = 'linear-gradient(90deg, oklch(0.76 0.15 150), oklch(0.76 0.14 225), oklch(0.76 0.15 305), oklch(0.79 0.13 75), oklch(0.76 0.15 150))'

const STATUS_ICONS: Record<AmbientStatusKind, LucideIcon> = {
  approval: BellRing,
  waiting: MessageCircleQuestion,
  due: ListTodo,
  focus: Focus,
  quiet: Coffee,
  running: Bot,
  idle: Activity
}

const MODE_ICONS: Record<string, LucideIcon> = {
  quotes: Sparkles,
  exp: Lightbulb,
  agent: Bot,
  thermal: Activity,
  github: Github,
  custom: Sparkles,
  brief: Radio,
  clock: Clock3,
  music: Music2,
  flow: Waves,
  eq: Activity,
  neon: Sparkles,
  pet: Activity
}

const accentOf = (cfg: BarConfig): string =>
  cfg.colorMode === 'custom' ? `oklch(0.78 0.14 ${cfg.hue})` : dsAccent(0.78)

const controlStyle: CSSProperties = {
  width: 20,
  height: 20,
  padding: 0,
  border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 6,
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  cursor: 'pointer',
  color: ink(1),
  background: 'rgba(255,255,255,.055)'
}

export function AmbientBar({ cfg, media, brief, pools, width, status, onMediaKey, onOpen, onOpenTarget, fetchLyrics }: AmbientBarProps): React.JSX.Element {
  const modes = cfg.modes.length ? cfg.modes : ['quotes']
  const rotationSeconds = clampBarRotation(cfg.rotationSeconds)
  const [slot, setSlot] = useState(0)
  const [textIdx, setTextIdx] = useState(() => Math.floor(Math.random() * 997))
  const [hovered, setHovered] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [lyric, setLyric] = useState<{ key: string; lines: LrcLine[]; startAt: number }>({ key: '', lines: [], startAt: 0 })
  const [lyricNow, setLyricNow] = useState(0)

  const accent = accentOf(cfg)
  const rainbow = cfg.colorMode === 'rainbow'
  const barW = Math.max(240, Math.min(width, (typeof window !== 'undefined' ? window.innerWidth : 940) - 36))
  const compact = barW < 520
  const roomy = barW >= 520
  const showStatus = cfg.showStatus !== false

  const slots = useMemo(() => buildAmbientSlots(modes, compact), [modes, compact])

  const mode = slots[slot % slots.length]
  const petOverlay = !compact && modes.includes('pet') && mode !== 'pet' && !VISUAL_MODES.includes(mode)
  const text = useMemo(() => {
    if (mode === 'brief') return brief.length ? brief[textIdx % brief.length] : '今日暂无日程与到期待办 · 一切安静'
    const pool = pools[mode] || []
    if (!pool.length) {
      if (mode === 'github') return '正在拉取 GitHub 本周热门…'
      if (mode === 'custom') return '在设置中添加自定义主题，AI 会持续生成内容'
      return '保持专注，下一条动态即将到来'
    }
    return pool[textIdx % pool.length]
  }, [mode, textIdx, pools, brief])

  useEffect(() => {
    if (hovered || slots.length <= 1) return
    const timer = setInterval(() => {
      setSlot((value) => value + 1)
      setTextIdx((value) => value + 1)
    }, rotationSeconds * 1000)
    return () => clearInterval(timer)
  }, [hovered, rotationSeconds, slots.length])

  useEffect(() => {
    if (mode !== 'clock') return
    setClockNow(new Date())
    const timer = setInterval(() => setClockNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [mode])

  const songKey = media ? `${media.title}|${media.artist}` : ''
  useEffect(() => {
    if (!media || !songKey || !fetchLyrics || lyric.key === songKey) return
    let cancelled = false
    void fetchLyrics(media.title, media.artist).then((result) => {
      if (!cancelled) setLyric({ key: songKey, lines: result.ok && result.lrc ? parseLrc(result.lrc) : [], startAt: Date.now() })
    })
    return () => { cancelled = true }
  }, [songKey, media, fetchLyrics, lyric.key])

  useEffect(() => {
    if (!lyric.lines.length || !media?.playing) return
    const timer = setInterval(() => setLyricNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [lyric.lines.length, media?.playing])

  const lyricLine = lyric.lines.length ? currentLine(lyric.lines, (lyricNow - lyric.startAt) / 1000) : ''
  const eqBars = useMemo(() => Array.from({ length: Math.max(14, Math.floor(barW / 13)) }, (_, i) => ({
    duration: 0.52 + ((i * 37) % 48) / 100,
    delay: ((i * 53) % 90) / 100
  })), [barW])

  const goSlot = (delta: number): void => {
    setSlot((value) => (value + delta + slots.length) % slots.length)
    setTextIdx((value) => value + delta)
  }

  const renderText = (value: string): React.JSX.Element => {
    const available = barW - (showStatus ? (compact ? 104 : 176) : 92) - (petOverlay ? 30 : 0)
    const marquee = value.length * 10.5 > available
    return marquee ? (
      <div className="ambient-text-clip" key={`${mode}-${textIdx}`}>
        <div className="ambient-marquee" style={{ animationDuration: `${Math.max(11, value.length * 0.34)}s` }}>
          <span>{value}</span><span aria-hidden>{value}</span>
        </div>
      </div>
    ) : (
      <div className="ambient-copy" key={`${mode}-${textIdx}`}>{value}</div>
    )
  }

  const StatusIcon = STATUS_ICONS[status.kind]
  const ModeIcon = MODE_ICONS[mode] || Sparkles
  const appearance = cfg.appearance || 'glass'
  const motion = cfg.motion || 'balanced'
  const customStyle = {
    width: barW,
    '--ambient-accent': accent,
    '--ambient-rotation': `${rotationSeconds}s`
  } as CSSProperties

  return (
    <div className="ambient-shell" style={{ width: barW }}>
      <div className="ambient-notch ambient-notch-left" />
      <div className="ambient-notch ambient-notch-right" />
      <div
        data-solid
        data-ambient-bar
        className={`ambient-bar ambient-${appearance} ambient-motion-${motion} ambient-kind-${status.kind}${compact ? ' ambient-compact' : ''}${status.urgent ? ' ambient-urgent' : ''}`}
        style={customStyle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onOpen}
        title="点击展开灵动岛"
      >
        <div className="ambient-depth-grid" />
        <div className="ambient-surface-flow" />
        <div className="ambient-top-highlight" />
        <div className="ambient-state-rail" />
        <div className="ambient-telemetry" aria-hidden>
          {[0.42, 0.68, 0.52, 0.86, 0.58, 0.74, 0.46].map((height, index) => <span key={index} style={{ '--telemetry-height': height, animationDelay: `${index * 0.11}s` } as CSSProperties} />)}
        </div>

        {showStatus && (
          <button
            type="button"
            className={`ambient-status ambient-status-${status.kind}`}
            title={`${status.label} · ${status.detail}`}
            onClick={(event) => {
              event.stopPropagation()
              if (status.target) onOpenTarget(status.target)
              else onOpen()
            }}
          >
            <span className="ambient-status-icon"><span className="ambient-status-ping" /><StatusIcon size={13} strokeWidth={2.2} /></span>
            {!compact && (
              <span className="ambient-status-copy">
                <strong>{status.label}</strong>
                <small>{status.detail}</small>
              </span>
            )}
            {status.count > 0 && <span className="ambient-status-count">{status.count > 9 ? '9+' : status.count}</span>}
          </button>
        )}

        <div className={`ambient-stage${petOverlay ? ' ambient-stage-with-pet' : ''}`} key={`${mode}-${slot}`}>
          <span className="ambient-content-wipe" aria-hidden />
          {mode === 'clock' && (
            <div className="ambient-clock">
              <Clock3 size={13} strokeWidth={2} />
              <strong>{String(clockNow.getHours()).padStart(2, '0')}:{String(clockNow.getMinutes()).padStart(2, '0')}</strong>
              <span>:{String(clockNow.getSeconds()).padStart(2, '0')}</span>
              {!compact && <small>{clockNow.getMonth() + 1}月{clockNow.getDate()}日 · {WEEKDAYS[clockNow.getDay()]}</small>}
            </div>
          )}

          {mode === 'flow' && <div className="ambient-visual-line" style={{ background: rainbow ? RAINBOW : `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />}
          {mode === 'neon' && <div className="ambient-visual-line ambient-neon-line" style={{ background: rainbow ? RAINBOW : accent }} />}
          {mode === 'eq' && (
            <div className="ambient-eq">
              {eqBars.map((bar, index) => (
                <span key={index} style={{ background: rainbow ? `oklch(0.76 0.15 ${Math.round((index * 360) / eqBars.length)})` : accent, animationDuration: `${bar.duration}s`, animationDelay: `${bar.delay}s` }} />
              ))}
            </div>
          )}
          {mode === 'pet' && (
            <div className="ambient-pet-stage">
              <span className="ambient-pet">{cfg.petEmoji || '🐈'}</span>
              <span className="ambient-pet-track" />
            </div>
          )}
          {(AMBIENT_TEXT_MODES as readonly string[]).includes(mode) && (
            <div className="ambient-text-stage">
              <ModeIcon size={13} strokeWidth={2} />
              {renderText(text)}
            </div>
          )}
          {petOverlay && <span className="ambient-pet-mini">{cfg.petEmoji || '🐈'}</span>}
          {mode === 'music' && (
            media ? (
              <div className="ambient-music">
                {media.thumb ? <img src={`data:image/jpeg;base64,${media.thumb}`} alt="" /> : <Music2 size={14} />}
                <div className="ambient-music-eq" data-playing={media.playing}>
                  {[0.52, 0.74, 0.61].map((duration, index) => <span key={index} style={{ animationDuration: `${duration}s`, animationDelay: `${index * 0.1}s`, background: accent }} />)}
                </div>
                <span className="ambient-music-title">{lyricLine || `${media.title}${media.artist ? ` · ${media.artist}` : ''}`}</span>
                <div className="ambient-media-controls">
                  <button type="button" title="上一首" style={controlStyle} onClick={(e) => { e.stopPropagation(); onMediaKey('prev') }}><SkipBack size={11} fill="currentColor" /></button>
                  <button type="button" title={media.playing ? '暂停' : '播放'} style={controlStyle} onClick={(e) => { e.stopPropagation(); onMediaKey('playpause') }}>{media.playing ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}</button>
                  <button type="button" title="下一首" style={controlStyle} onClick={(e) => { e.stopPropagation(); onMediaKey('next') }}><SkipForward size={11} fill="currentColor" /></button>
                  {roomy && <button type="button" title="减小音量" style={controlStyle} onClick={(e) => { e.stopPropagation(); onMediaKey('voldown') }}><Volume1 size={11} /></button>}
                  {roomy && <button type="button" title="增大音量" style={controlStyle} onClick={(e) => { e.stopPropagation(); onMediaKey('volup') }}><Volume2 size={11} /></button>}
                </div>
              </div>
            ) : (
              <div className="ambient-empty"><Music2 size={13} /> 未检测到正在播放的音乐</div>
            )
          )}
        </div>

        {mode !== 'music' && (
          <div className="ambient-nav" onClick={(event) => event.stopPropagation()}>
            {!compact && slots.length > 1 && <button type="button" title="上一项" onClick={() => goSlot(-1)}><ChevronLeft size={12} /></button>}
            {slots.length > 1 && <button type="button" title="下一项" onClick={() => goSlot(1)}><ChevronRight size={12} /></button>}
            <span>{String((slot % slots.length) + 1).padStart(2, '0')}/{String(slots.length).padStart(2, '0')}</span>
            <ChevronDown className="ambient-open-hint" size={12} />
          </div>
        )}

        {cfg.showProgress !== false && slots.length > 1 && (
          <div className="ambient-progress-track">
            <span key={`${slot}-${hovered}`} className="ambient-progress" style={{ animationPlayState: hovered ? 'paused' : 'running', background: rainbow ? RAINBOW : accent }} />
          </div>
        )}
      </div>
    </div>
  )
}
