// Markdown → 富文本 HTML（用于"复制富文本"，粘进飞书/Word 保留排版）。轻量，覆盖便签常用语法。

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escAttr(s: string): string {
  return escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeUrl(url: string, image = false): string | null {
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (image && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(u)) return u.replace(/\s/g, '')
  return null
}

/** 行内：**粗体** / `代码` / [文字](链接) / 裸链接 / [[双链]] */
function inline(text: string): string {
  let t = escHtml(text)
  t = t.replace(/\[\[([^\]]+)\]\]/g, '<b>$1</b>')
  t = t.replace(/`([^`]+)`/g, '<code style="background:#f2f2f2;padding:1px 4px;border-radius:3px;font-family:Consolas,monospace">$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
    const safe = safeUrl(url.replace(/&amp;/g, '&'))
    return safe ? `<a href="${escAttr(safe)}">${label}</a>` : label
  })
  t = t.replace(/(^|[^"(])(https?:\/\/[^\s<]+)/g, (_m, prefix: string, url: string) => {
    const raw = url.replace(/&amp;/g, '&')
    const safe = safeUrl(raw)
    return safe ? `${prefix}<a href="${escAttr(safe)}">${escHtml(raw)}</a>` : `${prefix}${escHtml(raw)}`
  })
  return t
}

/** Markdown → HTML 字符串 */
export function mdToHtml(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      out.push(`<pre style="background:#f5f5f5;padding:8px 10px;border-radius:6px;font-family:Consolas,monospace;font-size:13px;overflow:auto"><code>${escHtml(buf.join('\n'))}</code></pre>`)
      continue
    }
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
    if (img) {
      const src = safeUrl(img[2], true)
      if (src) out.push(`<img src="${escAttr(src)}" alt="${escAttr(img[1])}" style="max-width:100%"/>`)
      i++
      continue
    }
    const bq = line.match(/^>\s?(.*)/)
    if (bq) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(`<blockquote style="border-left:3px solid #ccc;margin:6px 0;padding-left:10px;color:#666">${buf.map(inline).join('<br/>')}</blockquote>`)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) { const lv = h[1].length + 1; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue }
    const li = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)/)
    if (li) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(?:[-*]|\d+[.)])\s+(.*)/)
        if (!m) break
        items.push(`<li>${inline(m[1])}</li>`)
        i++
      }
      out.push(`<ul style="margin:4px 0;padding-left:22px">${items.join('')}</ul>`)
      continue
    }
    if (!line.trim()) { i++; continue }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>\s?|!\[|\s*(?:[-*]|\d+[.)])\s)/.test(lines[i])) { buf.push(lines[i].trim()); i++ }
    out.push(`<p style="margin:4px 0;line-height:1.6">${inline(buf.join(' '))}</p>`)
  }
  return out.join('\n')
}
