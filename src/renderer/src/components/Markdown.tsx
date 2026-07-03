// 轻量 Markdown 渲染（零依赖）：标题 / 列表 / 围栏代码 / 行内代码 / 粗体。
// 用于计划审阅、Agent 提问等上下文内容，替代生肉 Markdown 文本。
// 另含 Collapsible：长内容默认折叠，可展开/收起。

import { useRef, useState, useLayoutEffect } from 'react'
import { island } from '../bridge'

/* ---------- 行内：`code`、**bold** 与可点击链接 ---------- */
function Inline({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`'))
          return (
            <code key={i} style={{ fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: '0.94em', color: 'oklch(0.86 calc(0.1 * var(--cs, 1)) var(--th))', background: 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: 4 }}>
              {p.slice(1, -1)}
            </code>
          )
        if (p.startsWith('**') && p.endsWith('**'))
          return (
            <b key={i} style={{ color: 'oklch(0.93 0.02 var(--th))', fontWeight: 700 }}>
              {p.slice(2, -2)}
            </b>
          )
        if (/^https?:\/\//.test(p))
          return (
            <span key={i} onClick={() => island.openExternal(p)} title="在浏览器打开" style={{ color: 'oklch(0.8 calc(0.1 * var(--cs, 1)) var(--th))', textDecoration: 'underline', cursor: 'pointer', wordBreak: 'break-all' }}>
              {p}
            </span>
          )
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

/* ---------- 围栏代码块：带一键复制 ---------- */
function CodeBlock({ code }: { code: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ position: 'relative', margin: '4px 0' }}>
      <div className="ai-scroll" style={{ fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 11, lineHeight: 1.55, color: 'oklch(0.86 calc(0.1 * var(--cs, 1)) var(--th))', background: 'rgba(0,0,0,.32)', padding: '7px 9px', paddingRight: 46, borderRadius: 7, overflowX: 'auto', whiteSpace: 'pre' }}>
        {code}
      </div>
      <div
        className="hv"
        onClick={() => { navigator.clipboard?.writeText(code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        style={{ position: 'absolute', top: 5, right: 6, padding: '2px 7px', borderRadius: 6, background: 'rgba(255,255,255,.08)', color: copied ? 'oklch(0.8 calc(0.14 * var(--cs, 1)) var(--th))' : 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 9, fontWeight: 600, cursor: 'pointer' }}
      >
        {copied ? '✓' : '⧉ 复制'}
      </div>
    </div>
  )
}

/* ---------- 块级解析 ---------- */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  const out: React.JSX.Element[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块
    if (/^```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++ // 跳过闭合 ```
      out.push(<CodeBlock key={key++} code={buf.join('\n')} />)
      continue
    }

    // 图片（独立成行的 ![alt](url)，支持 http 外链与 dataURL）
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
    if (img) {
      out.push(
        <img key={key++} src={img[2]} alt={img[1]} style={{ maxWidth: '100%', borderRadius: 9, margin: '4px 0', display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
      )
      i++
      continue
    }

    // 引用（> 开头）
    const bq = line.match(/^>\s?(.*)/)
    if (bq) {
      const buf2: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf2.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(
        <div key={key++} style={{ borderLeft: '2.5px solid oklch(0.7 calc(0.12 * var(--cs, 1)) var(--th) / .5)', paddingLeft: 9, margin: '3px 0', color: 'oklch(0.78 0.02 var(--th) / .8)', fontStyle: 'italic', lineHeight: 1.55 }}>
          {buf2.map((b, j) => <div key={j}><Inline text={b} /></div>)}
        </div>
      )
      continue
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) {
      const level = h[1].length
      out.push(
        <div key={key++} style={{ color: 'oklch(0.94 0.02 var(--th))', fontWeight: 700, fontSize: level <= 2 ? 12.5 : 11.5, margin: '6px 0 2px' }}>
          <Inline text={h[2]} />
        </div>
      )
      i++
      continue
    }

    // 列表（- / * / 1.）
    const li = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)/)
    if (li) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(?:[-*]|\d+[.)])\s+(.*)/)
        if (!m) break
        items.push(m[1])
        i++
      }
      out.push(
        <div key={key++} style={{ display: 'flex', flexDirection: 'column', gap: 3, margin: '2px 0' }}>
          {items.map((it, j) => (
            <div key={j} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <span style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', lineHeight: 1.55 }}>•</span>
              <span style={{ lineHeight: 1.55 }}><Inline text={it} /></span>
            </div>
          ))}
        </div>
      )
      continue
    }

    // 空行
    if (!line.trim()) { i++; continue }

    // 段落（合并连续普通行）
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>\s?|!\[|\s*(?:[-*]|\d+[.)])\s)/.test(lines[i])) {
      buf.push(lines[i].trim())
      i++
    }
    out.push(
      <div key={key++} style={{ lineHeight: 1.6, margin: '2px 0' }}>
        <Inline text={buf.join(' ')} />
      </div>
    )
  }

  return <div style={{ color: 'oklch(0.85 0.02 var(--th) / .92)', fontSize: 11.5 }}>{out}</div>
}

/* ---------- 可折叠容器：超过 collapsedHeight 时默认折叠 ---------- */
export function Collapsible({ children, collapsedHeight = 120 }: { children: React.ReactNode; collapsedHeight?: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (ref.current) setOverflowing(ref.current.scrollHeight > collapsedHeight + 24)
  })

  return (
    <div>
      <div
        ref={ref}
        className="ai-scroll"
        style={{
          maxHeight: open ? 320 : collapsedHeight,
          overflowY: open ? 'auto' : 'hidden',
          position: 'relative',
          transition: 'max-height .2s ease'
        }}
      >
        {children}
        {!open && overflowing && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 34, background: 'linear-gradient(180deg, transparent, oklch(calc(0.17 * var(--pl, 1)) calc(0.02 * var(--css, 1)) var(--ths) / .95))', pointerEvents: 'none' }} />
        )}
      </div>
      {overflowing && (
        <div
          onClick={() => setOpen((v) => !v)}
          style={{ textAlign: 'center', padding: '4px 0 1px', color: 'oklch(0.8 calc(0.08 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}
        >
          {open ? '收起 ▴' : '展开全部 ▾'}
        </div>
      )}
    </div>
  )
}
