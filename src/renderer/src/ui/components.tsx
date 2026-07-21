// 共享组件库 v2 —— Apple（macOS/iOS）设计语言。
//  按钮=圆角矩形（R.md 10，非胶囊）；分段控件=iOS 滑动 thumb（layoutId）；开关=iOS 白钮；
//  卡片=填充制无描边；分组列表=inset grouped + hairline 分隔行；按压=透明度下沉。
import React from 'react'
import { motion } from 'framer-motion'
import { accent, fill, FS, gradient, hairline, ink, R, sem, semBg, SP, surface, text, transition } from './tokens'
import { pressable, pressableGentle, springSoft } from './motion'
import type { LucideIcon } from './icons'

/* ---------------- Button（iOS 圆角矩形按钮） ---------------- */

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'warn' | 'tinted'

export function Button(props: {
  variant?: ButtonVariant
  icon?: LucideIcon
  children?: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  disabled?: boolean
  title?: string
  style?: React.CSSProperties
  /** 小号（默认中号） */
  sm?: boolean
}) {
  const { variant = 'ghost', icon: Icon, children, onClick, disabled, title, style, sm } = props
  const bg: Record<ButtonVariant, string> = {
    primary: gradient.primary(),
    tinted: semBg(accent(), 0.16),
    ghost: fill(3),
    danger: semBg(sem.danger, 0.15),
    warn: semBg(sem.warn, 0.15),
  }
  const fg: Record<ButtonVariant, string> = {
    primary: gradient.onPrimary(),
    tinted: accent(0.9),
    ghost: ink(1),
    danger: sem.danger,
    warn: sem.warn,
  }
  return (
    <motion.button
      {...(disabled ? {} : pressable)}
      className={variant === 'primary' ? 'ui-shine' : undefined}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: sm ? '4.5px 11px' : '7px 14px',
        borderRadius: R.md,
        border: variant === 'primary' ? 'none' : `0.5px solid ${variant === 'ghost' ? hairline(0.08) : 'transparent'}`,
        background: bg[variant],
        color: fg[variant],
        fontSize: sm ? FS.small : FS.body,
        fontWeight: 600,
        letterSpacing: '-0.006em',
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        boxShadow: variant === 'primary' ? `0 4px 14px -5px ${accent(0.7, 0.4)}, inset 0 0.5px 0 rgba(255,255,255,0.22)` : 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {Icon && <Icon size={sm ? 12 : 14} strokeWidth={2} />}
      {children}
    </motion.button>
  )
}

/* ---------------- IconButton ---------------- */

export function IconButton(props: {
  icon: LucideIcon
  onClick?: (e: React.MouseEvent) => void
  title?: string
  size?: number
  color?: string
  active?: boolean
  disabled?: boolean
  style?: React.CSSProperties
}) {
  const { icon: Icon, onClick, title, size = 26, color, active, disabled, style } = props
  return (
    <motion.button
      {...(disabled ? {} : pressable)}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        padding: 0,
        border: active ? `0.5px solid ${accent(0.7, 0.3)}` : 'none',
        borderRadius: R.sm,
        display: 'grid',
        placeItems: 'center',
        background: active ? semBg(accent(), 0.16) : fill(2),
        color: color || (active ? accent() : ink(2)),
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: transition('background, color'),
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <Icon size={Math.round(size * 0.54)} strokeWidth={1.75} />
    </motion.button>
  )
}

/* ---------------- Card（填充制，无 1px 边框） ---------------- */

export function Card(props: {
  children?: React.ReactNode
  highlight?: boolean
  onClick?: (e: React.MouseEvent) => void
  style?: React.CSSProperties
  /** 可按压反馈（点击型卡片） */
  press?: boolean
}) {
  const { children, highlight, onClick, style, press } = props
  const base: React.CSSProperties = {
    ...surface.card(highlight),
    padding: `${SP.md}px ${SP.md + 1}px`,
    cursor: onClick ? 'pointer' : 'default',
    transition: transition('background', '.2s'),
    ...style,
  }
  if (press || onClick) {
    return (
      <motion.div {...pressableGentle} className="ai-card" onClick={onClick} style={base}>
        {children}
      </motion.div>
    )
  }
  return (
    <div className="ai-card" onClick={onClick} style={base}>
      {children}
    </div>
  )
}

/* ---------------- Chip / Badge（iOS 标签） ---------------- */

export function Chip(props: {
  children?: React.ReactNode
  icon?: LucideIcon
  active?: boolean
  color?: string
  onClick?: (e: React.MouseEvent) => void
  title?: string
  style?: React.CSSProperties
}) {
  const { children, icon: Icon, active, color, onClick, title, style } = props
  const c = color || accent()
  return (
    <motion.button
      {...(onClick ? pressable : {})}
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3.5px 10px',
        borderRadius: R.pill,
        border: 'none',
        background: active ? semBg(c, 0.2) : fill(2),
        color: active ? c : ink(2),
        fontSize: FS.small,
        fontWeight: active ? 600 : 500,
        letterSpacing: '-0.004em',
        fontFamily: 'inherit',
        cursor: onClick ? 'pointer' : 'default',
        transition: transition('background, color'),
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {Icon && <Icon size={11} strokeWidth={2} />}
      {children}
    </motion.button>
  )
}

/** 数字/文字小徽标（iOS notification badge 风） */
export function Badge(props: { children?: React.ReactNode; color?: string; style?: React.CSSProperties }) {
  const c = props.color || accent()
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 15,
        height: 15,
        padding: '0 4px',
        borderRadius: R.pill,
        background: semBg(c, 0.2),
        color: c,
        fontSize: 9.5,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        ...props.style,
      }}
    >
      {props.children}
    </span>
  )
}

/* ---------------- Input（iOS 搜索框观感） ---------------- */

export function Input(props: {
  value: string
  onChange: (v: string) => void
  type?: React.HTMLInputTypeAttribute
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
  icon?: LucideIcon
  style?: React.CSSProperties
  autoFocus?: boolean
}) {
  const { value, onChange, type = 'text', placeholder, onKeyDown, icon: Icon, style, autoFocus } = props
  return (
    <div
      style={{
        ...surface.inset(),
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        transition: transition('border-color, box-shadow'),
        ...style,
      }}
      className="ui-input"
    >
      {Icon && <Icon size={13} strokeWidth={1.75} style={{ color: ink(3), flex: 'none' }} />}
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          minWidth: 0,
          height: 30,
          border: 0,
          outline: 'none',
          background: 'transparent',
          color: ink(1),
          fontSize: FS.body,
          letterSpacing: '-0.004em',
          fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

/* ---------------- Segmented（iOS 分段控件：滑动 thumb） ---------------- */

export function Segmented<T extends string>(props: {
  options: { key: T; label: React.ReactNode; icon?: LucideIcon }[]
  value: T
  onChange: (k: T) => void
  style?: React.CSSProperties
}) {
  const { options, value, onChange, style } = props
  const id = React.useId()
  return (
    <div
      style={{
        ...surface.inset(),
        display: 'inline-flex',
        padding: 2,
        gap: 0,
        borderRadius: R.md + 1,
        ...style,
      }}
    >
      {options.map((o) => {
        const active = o.key === value
        const Icon = o.icon
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4.5px 11px',
              border: 0,
              borderRadius: R.md - 1,
              background: 'transparent',
              color: active ? ink(1) : ink(2),
              fontSize: FS.small,
              fontWeight: active ? 600 : 500,
              letterSpacing: '-0.004em',
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: transition('color'),
              whiteSpace: 'nowrap',
              zIndex: active ? 1 : 0,
            }}
          >
            {active && (
              <motion.span
                layoutId={`seg-thumb-${id}`}
                transition={springSoft}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: R.md - 1,
                  // iOS thumb：抬升的亮填充 + 弥散影
                  background: fill(4),
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3), 0 0.5px 1px rgba(0,0,0,0.2), inset 0 0.5px 0 rgba(255,255,255,0.1)',
                }}
              />
            )}
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {Icon && <Icon size={11} strokeWidth={2} />}
              {o.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- SectionHeader（iOS 分组列表头） ---------------- */

export function SectionHeader(props: {
  icon?: LucideIcon
  title: React.ReactNode
  extra?: React.ReactNode
  style?: React.CSSProperties
}) {
  const { icon: Icon, title, extra, style } = props
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: SP.sm,
        ...style,
      }}
    >
      {Icon && <Icon size={13} strokeWidth={2} style={{ color: accent(), flex: 'none' }} />}
      <div style={{ ...text.subtitle(), flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </div>
      {extra}
    </div>
  )
}

/* ---------------- EmptyState ---------------- */

export function EmptyState(props: {
  icon?: LucideIcon
  title: string
  desc?: string
  action?: React.ReactNode
  style?: React.CSSProperties
}) {
  const { icon: Icon, title: t, desc, action, style } = props
  return (
    <div
      style={{
        borderRadius: R.lg,
        background: fill(1),
        padding: `${SP.xl}px ${SP.lg}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        textAlign: 'center',
        ...style,
      }}
    >
      {Icon && (
        <div
          style={{
            position: 'relative',
            width: 36,
            height: 36,
            borderRadius: R.md + 1,
            display: 'grid',
            placeItems: 'center',
            background: semBg(accent(), 0.12),
            color: accent(0.85, 0.8),
            marginBottom: 2,
          }}
        >
          <div style={{ position: 'absolute', inset: -14, borderRadius: '50%', background: `radial-gradient(circle, ${accent(0.7, 0.14)} 0%, transparent 68%)`, pointerEvents: 'none' }} />
          <Icon size={18} strokeWidth={1.5} style={{ position: 'relative' }} />
        </div>
      )}
      <div style={text.subtitle()}>{t}</div>
      {desc && <div style={{ ...text.faint(), maxWidth: 320, lineHeight: 1.6 }}>{desc}</div>}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  )
}

/* ---------------- Switch（iOS 白钮开关） ---------------- */

export function Switch(props: { on: boolean; onChange: (on: boolean) => void; color?: string; disabled?: boolean }) {
  const { on, onChange, color, disabled } = props
  const c = color || accent(0.72)
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        position: 'relative',
        width: 36,
        height: 21,
        padding: 0,
        border: 'none',
        borderRadius: R.pill,
        background: on ? c : fill(4),
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: transition('background', '.22s'),
        flex: 'none',
        fontFamily: 'inherit',
      }}
    >
      <motion.span
        animate={{ x: on ? 16 : 0 }}
        transition={springSoft}
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: 17,
          height: 17,
          borderRadius: '50%',
          // iOS 白钮 + 柔和投影
          background: 'oklch(0.98 0 0)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.3), 0 0 1px rgba(0,0,0,0.2)',
          display: 'block',
        }}
      />
    </button>
  )
}

/* ---------------- Slider ---------------- */

export function Slider(props: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  style?: React.CSSProperties
}) {
  const { min, max, step = 1, value, onChange, style } = props
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="ui-slider"
      style={{
        width: '100%',
        height: 4,
        appearance: 'none',
        borderRadius: R.pill,
        outline: 'none',
        background: `linear-gradient(90deg, ${accent()} ${pct}%, ${fill(3)} ${pct}%)`,
        cursor: 'pointer',
        ...style,
      }}
    />
  )
}

/* ---------------- Group（iOS inset grouped 列表容器：行间 hairline 分隔） ---------------- */

export function Group(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  const kids = React.Children.toArray(props.children)
  return (
    <div style={{ ...surface.group(), ...props.style }}>
      {kids.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <div style={{ height: 0.5, background: hairline(0.07), marginLeft: SP.md }} />}
          {k}
        </React.Fragment>
      ))}
    </div>
  )
}
