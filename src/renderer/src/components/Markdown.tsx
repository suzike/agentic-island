// 轻量 Markdown 渲染（零依赖）：标题 / 列表 / 围栏代码 / 行内代码 / 粗体。
// 用于计划审阅、Agent 提问等上下文内容，替代生肉 Markdown 文本。
// 另含 Collapsible：长内容默认折叠，可展开/收起。

import { createContext, useContext, useRef, useState, useLayoutEffect } from 'react'
import { island } from '../bridge'

// 双向链接跳转回调（便签用）：Markdown 提供，Inline 消费；不提供时 [[..]] 按普通文字渲染
const WikiCtx = createContext<((title: string) => void) | null>(null)
// 明暗：light=true 时改用深色文字（配浅色背景，Markdown 工作台明色主题用）
const LightCtx = createContext(false)

/* ---------- 行内：`code`、**bold**、可点击链接、[[双链]] ---------- */
function Inline({ text }: { text: string }): React.JSX.Element {
  const onWiki = useContext(WikiCtx)
  const lt = useContext(LightCtx)
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*|\[[^\]]+\]\((?:https?:\/\/|data:)[^)\s]+\)|\[\[[^\]]+\]\]|https?:\/\/[^\s)]+)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('~~') && p.endsWith('~~'))
          return <s key={i} style={{ opacity: 0.65 }}>{p.slice(2, -2)}</s>
        if (p.startsWith('*') && p.endsWith('*') && !p.startsWith('**'))
          return <i key={i}>{p.slice(1, -1)}</i>
        // [文字](链接)
        {
          const md = p.match(/^\[([^\]]+)\]\(((?:https?:\/\/|data:)[^)\s]+)\)$/)
          if (md) return <span key={i} onClick={() => island.openExternal(md[2])} title="在浏览器打开" style={{ color: 'oklch(0.8 calc(0.1 * var(--cs, 1)) var(--th))', textDecoration: 'underline', cursor: 'pointer' }}>{md[1]}</span>
        }
        if (p.startsWith('[[') && p.endsWith(']]')) {
          const title = p.slice(2, -2).trim()
          return (
            <span key={i} onClick={() => onWiki?.(title)} title={onWiki ? '跳到该便签' : undefined} style={{ color: 'oklch(0.82 calc(0.12 * var(--cs, 1)) var(--th))', background: 'oklch(0.4 calc(0.08 * var(--cs, 1)) var(--th) / .25)', padding: '0 5px', borderRadius: 5, cursor: onWiki ? 'pointer' : 'default', fontWeight: 600, fontSize: '0.94em' }}>
              🔗 {title}
            </span>
          )
        }
        if (p.startsWith('`') && p.endsWith('`'))
          return (
            <code key={i} style={{ fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: '0.94em', color: lt ? '#b02a5b' : 'oklch(0.86 calc(0.1 * var(--cs, 1)) var(--th))', background: lt ? 'rgba(0,0,0,.06)' : 'rgba(0,0,0,.3)', padding: '1px 5px', borderRadius: 4 }}>
              {p.slice(1, -1)}
            </code>
          )
        if (p.startsWith('**') && p.endsWith('**'))
          return (
            <b key={i} style={{ color: lt ? '#111' : 'oklch(0.93 0.02 var(--th))', fontWeight: 700 }}>
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
  const lt = useContext(LightCtx)
  return (
    <div style={{ position: 'relative', margin: '4px 0' }}>
      <div className="ai-scroll" style={{ fontFamily: "ui-monospace,'Cascadia Code',monospace", fontSize: 11, lineHeight: 1.55, color: lt ? '#2f3b47' : 'oklch(0.86 calc(0.1 * var(--cs, 1)) var(--th))', background: lt ? 'rgba(0,0,0,.05)' : 'rgba(0,0,0,.32)', padding: '7px 9px', paddingRight: 46, borderRadius: 7, overflowX: 'auto', whiteSpace: 'pre' }}>
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

const splitRow = (line: string): string[] =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

/* ---------- 块级解析（支持标题1-6 / 列表·任务清单·缩进 / 表格 / 引用 / 代码 / 分割线 / 图片）---------- */
export function Markdown({ text, onWikiLink, reader, light }: { text: string; onWikiLink?: (title: string) => void; reader?: boolean; light?: boolean }): React.JSX.Element {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  const out: React.JSX.Element[] = []
  let i = 0
  let key = 0
  let hIdx = 0 // 标题序号（供工作台 TOC 定位滚动）
  // 阅读版放大排版，紧凑版沿用岛内小字
  const bodyFz = reader ? 15 : 11.5
  const lh = reader ? 1.8 : 1.6
  const hFz = (lv: number): number => (reader ? [26, 21, 17.5, 15.5, 14, 13][lv - 1] : lv <= 2 ? 12.5 : 11.5)
  const hMargin = reader ? '20px 0 9px' : '6px 0 2px'
  // 明暗配色
  const cBody = light ? '#2b2b2b' : 'oklch(0.85 0.02 var(--th) / .92)'
  const cHead = light ? '#0f0f14' : 'oklch(0.95 0.02 var(--th))'
  const cPara = light ? '#333' : 'oklch(0.84 0.02 var(--th) / .9)'
  const cQuote = light ? '#555' : 'oklch(0.78 0.02 var(--th) / .8)'
  const cTh = light ? '#111' : 'oklch(0.92 calc(0.05 * var(--cs, 1)) var(--th))'
  const cTd = light ? '#333' : 'oklch(0.83 0.02 var(--th) / .9)'

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块
    if (/^```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      out.push(<CodeBlock key={key++} code={buf.join('\n')} />)
      continue
    }

    // 分割线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={key++} style={{ border: 'none', borderTop: '1px solid oklch(0.6 0.02 var(--th) / .22)', margin: reader ? '20px 0' : '8px 0' }} />)
      i++
      continue
    }

    // 表格：表头行 + 分隔行(---) + 数据行
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++ }
      out.push(
        <div key={key++} className="ai-scroll" style={{ overflowX: 'auto', margin: reader ? '12px 0' : '5px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: reader ? 13.5 : 11 }}>
            <thead>
              <tr>{header.map((c, j) => <th key={j} style={{ textAlign: 'left', padding: reader ? '7px 11px' : '4px 8px', borderBottom: '2px solid oklch(0.6 calc(0.1 * var(--cs, 1)) var(--th) / .4)', color: cTh, fontWeight: 700 }}><Inline text={c} /></th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} style={{ background: ri % 2 ? 'rgba(255,255,255,.025)' : undefined }}>
                  {r.map((c, j) => <td key={j} style={{ padding: reader ? '7px 11px' : '4px 8px', borderBottom: `1px solid ${light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.06)'}`, color: cTd, verticalAlign: 'top' }}><Inline text={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // 图片
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
    if (img) {
      out.push(<img key={key++} src={img[2]} alt={img[1]} style={{ maxWidth: '100%', borderRadius: 10, margin: reader ? '12px auto' : '4px 0', display: 'block' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />)
      i++
      continue
    }

    // 引用（可多行）
    if (/^>\s?/.test(line)) {
      const buf2: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf2.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(
        <div key={key++} style={{ borderLeft: '3px solid oklch(0.7 calc(0.12 * var(--cs, 1)) var(--th) / .5)', paddingLeft: reader ? 14 : 9, margin: reader ? '12px 0' : '3px 0', color: cQuote, fontStyle: 'italic', lineHeight: lh, fontSize: bodyFz }}>
          {buf2.map((b, j) => <div key={j}><Inline text={b} /></div>)}
        </div>
      )
      continue
    }

    // 标题 1-6
    const h = line.match(/^(#{1,6})\s+(.*)/)
    if (h) {
      const lv = h[1].length
      out.push(
        <div key={key++} data-mdh={hIdx++} style={{ color: cHead, fontWeight: lv <= 2 ? 800 : 700, fontSize: hFz(lv), lineHeight: 1.3, margin: hMargin, borderBottom: reader && lv === 1 ? `1px solid ${light ? 'rgba(0,0,0,.12)' : 'oklch(0.6 0.02 var(--th) / .2)'}` : undefined, paddingBottom: reader && lv === 1 ? 6 : undefined }}>
          <Inline text={h[2]} />
        </div>
      )
      i++
      continue
    }

    // 列表（有序/无序/任务清单，按缩进分级）
    const li = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)/)
    if (li) {
      const items: { indent: number; task: 0 | 1 | 2; text: string }[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)/)
        if (!m) break
        const indent = Math.floor(m[1].replace(/\t/g, '  ').length / 2)
        const t = m[2]
        const tk = /^\[ \]\s+/.test(t) ? 1 : /^\[[xX]\]\s+/.test(t) ? 2 : 0
        items.push({ indent, task: tk as 0 | 1 | 2, text: tk ? t.replace(/^\[[ xX]\]\s+/, '') : t })
        i++
      }
      out.push(
        <div key={key++} style={{ display: 'flex', flexDirection: 'column', gap: reader ? 5 : 3, margin: reader ? '8px 0' : '2px 0' }}>
          {items.map((it, j) => (
            <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingLeft: it.indent * (reader ? 20 : 14) }}>
              {it.task ? (
                <span style={{ flex: 'none', width: reader ? 15 : 13, height: reader ? 15 : 13, marginTop: reader ? 3 : 2, borderRadius: 4, border: `1.5px solid oklch(0.7 calc(0.12 * var(--cs, 1)) var(--th) / .6)`, background: it.task === 2 ? 'oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th))' : 'transparent', color: 'oklch(0.14 0.02 var(--th))', fontSize: reader ? 11 : 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>{it.task === 2 ? '✓' : ''}</span>
              ) : (
                <span style={{ color: 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th))', lineHeight: lh, flex: 'none' }}>•</span>
              )}
              <span style={{ lineHeight: lh, fontSize: bodyFz, textDecoration: it.task === 2 ? 'line-through' : undefined, opacity: it.task === 2 ? 0.6 : 1 }}><Inline text={it.text} /></span>
            </div>
          ))}
        </div>
      )
      continue
    }

    // 空行
    if (!line.trim()) { i++; continue }

    // 段落
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|!\[|\s*(?:[-*+]|\d+[.)])\s|\s*([-*_])\2{2,}\s*$|\s*\|.*\|\s*$)/.test(lines[i])) {
      buf.push(lines[i].trim())
      i++
    }
    if (buf.length) out.push(
      <div key={key++} style={{ lineHeight: lh, margin: reader ? '9px 0' : '2px 0', fontSize: bodyFz, color: cPara }}>
        <Inline text={buf.join(' ')} />
      </div>
    )
  }

  return (
    <LightCtx.Provider value={!!light}>
      <WikiCtx.Provider value={onWikiLink || null}>
        <div style={{ color: cBody, fontSize: bodyFz }}>{out}</div>
      </WikiCtx.Provider>
    </LightCtx.Provider>
  )
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
