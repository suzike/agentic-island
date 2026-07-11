// 全屏 Markdown 工作台：编辑 / 分屏 / 阅读；本地文件打开·保存；查找替换；行号；同步滚动；
// 自动配对括号·Tab 缩进·智能回车续列表；块插入菜单；速查卡；阅读排版调节；专注模式；复制 HTML/MD。

import { useMemo, useRef, useState, useEffect } from 'react'
import { Markdown } from './Markdown'
import { escHtml, mdToHtml } from '../logic/mdHtml'
import { applyMarkdownPowerAction, MARKDOWN_POWER_ACTIONS, type MarkdownPowerGroup } from '../logic/markdownPower'
import { island } from '../bridge'

interface Props {
  open: boolean
  initial: { title: string; md: string }
  onClose: () => void
  onSave: (title: string, md: string) => void
  /** AI 增强：对选区/全文执行 AI 操作 */
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  llmReady: boolean
}

type Mode = 'edit' | 'split' | 'read'

// 20+ 处 AI 增强：对选区（无选区则全文）执行；mode 决定结果如何落回文档；raw=top 模式原样插入（不套引用块）
type AiMode = 'replace' | 'append' | 'top' | 'title'
interface AiAction { label: string; icon: string; mode: AiMode; sys: string; wrap: (t: string) => string; raw?: boolean }
const AI_ACTIONS: AiAction[] = [
  { label: '润色改写', icon: '✨', mode: 'replace', sys: '你是中文写作润色助手。把用户给的内容改写得更通顺、专业、有条理，保持原意与 Markdown 结构。只输出结果。', wrap: (t) => t },
  { label: '精简', icon: '✂️', mode: 'replace', sys: '把内容压缩到最精炼，去冗余保信息，保持 Markdown。只输出结果。', wrap: (t) => t },
  { label: '扩写', icon: '➕', mode: 'replace', sys: '把内容展开充实：补充细节、例子、解释，保持风格与 Markdown。只输出结果。', wrap: (t) => t },
  { label: '续写', icon: '⤵️', mode: 'append', sys: '你是写作助手。顺着下面的内容自然地继续往下写一段，风格一致。只输出续写部分。', wrap: (t) => t },
  { label: '翻译', icon: '🌐', mode: 'replace', sys: '翻译下面的内容：中文→英文，英文→中文，保留术语与 Markdown 结构。只输出译文。', wrap: (t) => t },
  { label: '修语法错字', icon: '🩹', mode: 'replace', sys: '修正下面内容的语法、错别字、标点，不改变原意与结构。只输出修正后的内容。', wrap: (t) => t },
  { label: '提炼要点', icon: '•', mode: 'replace', sys: '把下面的内容提炼成简洁的 Markdown 要点列表（- 开头），抓重点。只输出列表。', wrap: (t) => t },
  { label: '转表格', icon: '⊞', mode: 'replace', sys: '把下面的内容整理成一个合适的 Markdown 表格（含表头与分隔行）。只输出表格。', wrap: (t) => t },
  { label: '改正式语气', icon: '🎩', mode: 'replace', sys: '把下面的内容改写成正式、书面的语气，保持 Markdown。只输出结果。', wrap: (t) => t },
  { label: '摘要(插到顶部)', icon: '📄', mode: 'top', sys: '为下面的全文写一段 3-5 句的中文摘要。只输出摘要文字，不要标题。', wrap: (t) => t },
  { label: '生成大纲', icon: '🗂️', mode: 'top', raw: true, sys: '为下面的内容生成一个 Markdown 标题大纲（## 开头的若干小标题）。只输出大纲。', wrap: (t) => t },
  { label: '起个标题', icon: '🏷️', mode: 'title', sys: '为下面的内容起一个简洁有力的标题（≤20 字），只输出标题本身。', wrap: (t) => t },
  // ===== 第二批：语气 / 结构化 / 审阅类 =====
  { label: '学术语气', icon: '🎓', mode: 'replace', sys: '把下面的内容改写成严谨的学术语气：客观、精确、有逻辑连接词，保持 Markdown。只输出结果。', wrap: (t) => t },
  { label: '口语化', icon: '💬', mode: 'replace', sys: '把下面的内容改写成轻松口语化的表达，像和朋友聊天，但信息不丢失，保持 Markdown。只输出结果。', wrap: (t) => t },
  { label: '讲给小白听', icon: '🧒', mode: 'replace', sys: '用费曼技巧把下面的内容重写：假设读者零基础，用类比和最简单的语言解释清楚，保持 Markdown。只输出结果。', wrap: (t) => t },
  { label: '提炼金句', icon: '❝', mode: 'top', raw: true, sys: '从下面的内容里提炼 1-3 句最有价值的金句，每句一行，用 Markdown 引用块格式（> 开头）。只输出引用块。', wrap: (t) => t },
  { label: '编辑评审', icon: '🧐', mode: 'append', sys: '你是严格的资深编辑。审阅下面的内容，给出 3-5 条具体、可执行的修改意见（指出位置与改法）。输出一个「## ✍️ 修改意见」小节 + 有序列表。', wrap: (t) => t },
  { label: '备选标题×5', icon: '🏷', mode: 'top', raw: true, sys: '为下面的内容拟 5 个风格各异的备选标题（信息型/悬念型/数字型/对比型/金句型），输出「## 🏷 备选标题」+ 无序列表。只输出这个小节。', wrap: (t) => t },
  { label: '提行动项', icon: '✅', mode: 'append', sys: '从下面的内容里提取可执行的行动项，输出一个「## ✅ 行动项」小节 + Markdown 任务清单（- [ ] 开头）。没有就输出"- [ ] （无明确行动项）"。只输出小节。', wrap: (t) => t },
  { label: '生成 FAQ', icon: '❓', mode: 'append', sys: '根据下面的内容生成 3-5 个读者最可能问的问题及简答，输出「## ❓ FAQ」小节，问题用 **加粗**。只输出小节。', wrap: (t) => t },
  { label: '术语表', icon: '📖', mode: 'append', sys: '提取下面内容中的专业术语/概念，输出「## 📖 术语表」小节 + Markdown 表格（术语 | 解释），解释一句话。只输出小节。', wrap: (t) => t },
  { label: '智能排版', icon: '🪄', mode: 'replace', sys: '把下面的原始文本整理成规范的 Markdown：合理的标题层级、列表、强调、段落切分，不改变内容本身。只输出结果。', wrap: (t) => t },
  { label: '标点规范', icon: '🔡', mode: 'replace', sys: '按中文排版规范修正下面的内容：全角标点统一、中英文之间加空格、数字与单位规范，不改内容。只输出结果。', wrap: (t) => t },
  { label: '双语对照', icon: '🌍', mode: 'replace', sys: '把下面的内容改为逐段中英对照：每段原文后紧跟英文翻译（斜体）。保持 Markdown 结构。只输出结果。', wrap: (t) => t }
]

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"', '“': '”', '（': '）' }

const BLOCKS: [string, string, string][] = [
  ['H1', '一级标题', '# '], ['H2', '二级标题', '## '], ['H3', '三级标题', '### '],
  ['•', '无序列表', '- '], ['1.', '有序列表', '1. '], ['☑', '任务', '- [ ] '],
  ['❝', '引用', '> '], ['▤', '代码块', '```\n\n```'], ['⊞', '表格', '| 列1 | 列2 |\n| --- | --- |\n| a | b |'], ['—', '分割线', '\n---\n']
]

const CHEATS: [string, string][] = [
  ['# 标题', 'H1~H6'], ['**粗** *斜* ~~删~~', '强调'], ['`代码`', '行内代码'], ['- 项 / 1. 项', '列表'],
  ['- [ ] 待办', '任务清单'], ['> 引用', '引用块'], ['```\\n代码\\n```', '代码块'], ['| a | b |\\n|---|---|', '表格'],
  ['[文字](url)', '链接'], ['![alt](url)', '图片'], ['[[便签标题]]', '双链'], ['---', '分割线']
]

const TOOLBAR: [string, string, (w: (b: string, a?: string, ph?: string) => void, l: (t: string) => void) => void][] = [
  ['𝐁', '加粗', (w) => w('**', '**', '粗体')],
  ['𝑰', '斜体', (w) => w('*', '*', '斜体')],
  ['~', '删除线', (w) => w('~~', '~~', '删除')],
  ['‹›', '行内代码', (w) => w('`', '`', 'code')],
  ['🔗', '链接', (w) => w('[', '](https://)', '链接文字')],
  ['⟦⟧', '双链', (w) => w('[[', ']]', '便签标题')]
]

// 表格美化：把文档里所有 Markdown 表格的列宽对齐（CJK 按 2 宽计）
const vw = (s: string): number => [...s].reduce((a, c) => a + (/[ᄀ-￿]/.test(c) ? 2 : 1), 0)
function formatTables(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const block: string[] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { block.push(lines[i]); i++ }
      const rows = block.map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
      const cols = Math.max(...rows.map((r) => r.length))
      const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r, ri) => (ri === 1 ? 3 : vw(r[c] || '')))))
      out.push(...rows.map((r, ri) => '| ' + Array.from({ length: cols }, (_, c) => (ri === 1 ? '-'.repeat(widths[c]) : (r[c] || '') + ' '.repeat(Math.max(0, widths[c] - vw(r[c] || ''))))).join(' | ') + ' |'))
    } else { out.push(lines[i]); i++ }
  }
  return out.join('\n')
}

const KEYS: [string, string][] = [
  ['Ctrl+S', '保存'], ['Ctrl+Z / Ctrl+Y', '撤销 / 重做'], ['Ctrl+F', '查找替换'],
  ['Ctrl+1 / 2 / 3', '当前行设为 H1/H2/H3'], ['Alt+↑ / Alt+↓', '当前行上移 / 下移'],
  ['Tab', '缩进两格'], ['Enter', '智能续列表/任务'], ['( [ { ` "', '自动配对括号引号'],
  ['粘贴图片', '直接嵌入文档'], ['选中文字后粘贴网址', '自动变成链接']
]

// 导出样式主题（PDF/HTML 共用）
const EXPORT_THEMES: Record<string, { label: string; css: string }> = {
  clean: { label: '简洁', css: "body{font-family:'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.75;color:#222}h1,h2,h3{line-height:1.3}code{background:#f2f2f2;padding:1px 5px;border-radius:3px}pre{background:#f5f5f5;padding:10px;border-radius:6px;overflow:auto}blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#666}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 10px}img{max-width:100%}" },
  github: { label: 'GitHub', css: "body{font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;max-width:860px;margin:36px auto;padding:0 28px;line-height:1.6;color:#1f2328}h1,h2{border-bottom:1px solid #d1d9e0;padding-bottom:.3em;margin-top:1.4em}h1{font-size:2em}code{background:#f0f1f2;padding:.2em .4em;border-radius:6px;font-size:.9em}pre{background:#f6f8fa;padding:14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}blockquote{border-left:4px solid #d1d9e0;margin:0;padding:0 1em;color:#59636e}table{border-collapse:collapse}th,td{border:1px solid #d1d9e0;padding:6px 13px}tr:nth-child(2n){background:#f6f8fa}img{max-width:100%}" },
  mag: { label: '杂志', css: "body{font-family:Georgia,'Songti SC','SimSun',serif;max-width:680px;margin:52px auto;padding:0 26px;line-height:1.95;color:#2b2b2b;font-size:17px}h1{font-size:2.2em;letter-spacing:.02em;border-bottom:3px double #999;padding-bottom:.35em}h2{margin-top:1.8em}code{font-family:Consolas,monospace;background:#f4f1ea;padding:1px 5px;border-radius:3px;font-size:.85em}pre{background:#f7f5f0;padding:14px;border-radius:4px;overflow:auto;border-left:3px solid #c9b992}blockquote{border:none;margin:1.4em 0;padding:0 1.6em;color:#6b5f4a;font-style:italic;font-size:1.05em}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #d8d2c4;padding:8px 12px}th{border-bottom:2px solid #a89f8d}img{max-width:100%}" }
}

export function MarkdownStudio({ open, initial, onClose, onSave, onAI, llmReady }: Props): React.JSX.Element | null {
  const [title, setTitle] = useState(initial.title)
  const [md, setMd] = useState(initial.md)
  const [mode, setMode] = useState<Mode>('split')
  const [tocOpen, setTocOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [dirty, setDirty] = useState(false)
  const [filePath, setFilePath] = useState<string | undefined>()
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [blockMenu, setBlockMenu] = useState(false)
  const [cheat, setCheat] = useState(false)
  const [zen, setZen] = useState(false)
  const [rFont, setRFont] = useState(15)
  const [rWidth, setRWidth] = useState(760)
  const [aiMenu, setAiMenu] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [light, setLight] = useState(false) // 编辑器明暗
  const [autoSave, setAutoSave] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  const [tableGrid, setTableGrid] = useState(false)
  const [emojiPick, setEmojiPick] = useState(false)
  const [customAi, setCustomAi] = useState('')
  const [askOpen, setAskOpen] = useState(false)
  const [askQ, setAskQ] = useState('')
  const [askA, setAskA] = useState('')
  const [powerOpen, setPowerOpen] = useState(false)
  const [powerGroup, setPowerGroup] = useState<MarkdownPowerGroup>('结构')
  // 第二批功能补全：正则查找 / 打字机 / 行列 / 快照 / 快捷键 / 导出主题
  const [useRegex, setUseRegex] = useState(false)
  const [typewriter, setTypewriter] = useState(false)
  const [curPos, setCurPos] = useState({ ln: 1, col: 1 })
  const [snapMenu, setSnapMenu] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const [exportTheme, setExportTheme] = useState<'clean' | 'github' | 'mag'>('clean')
  const snaps = useRef<{ t: number; title: string; md: string }[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  // 撤销/重做历史（按时间合并连续输入）
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const lastPush = useRef(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setTitle(initial.title); setMd(initial.md); setMode('split'); setDirty(false); setFilePath(undefined); setFindOpen(false); setZen(false); undoStack.current = []; redoStack.current = [] } }, [open])

  const change = (v: string): void => {
    const t = Date.now()
    if (t - lastPush.current > 400 || !undoStack.current.length) { undoStack.current.push(md); if (undoStack.current.length > 200) undoStack.current.shift(); lastPush.current = t }
    redoStack.current = []
    setMd(v); setDirty(true)
  }
  const undo = (): void => { if (!undoStack.current.length) return; redoStack.current.push(md); setMd(undoStack.current.pop()!); setDirty(true) }
  const redo = (): void => { if (!redoStack.current.length) return; undoStack.current.push(md); setMd(redoStack.current.pop()!); setDirty(true) }
  // 自动保存（到便签，防抖 1.5s）
  useEffect(() => {
    if (!autoSave || !dirty) return
    const t = setTimeout(() => { onSave(title, md); setDirty(false) }, 1500)
    return () => clearTimeout(t)
  }, [autoSave, dirty, md, title, onSave])

  const wrapSel = (before: string, after = '', ph = '文字'): void => {
    const ta = taRef.current; if (!ta) return
    const s = ta.selectionStart, e = ta.selectionEnd
    const sel = md.slice(s, e) || ph
    change(md.slice(0, s) + before + sel + after + md.slice(e))
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length) })
  }
  // 光标 行:列（底栏显示）+ 打字机模式（光标行滚动居中）；读 ta.value 而非 md，避免 setState 异步导致的旧值
  const trackCursor = (): void => {
    const ta = taRef.current; if (!ta) return
    const pre = ta.value.slice(0, ta.selectionStart)
    const lines = pre.split('\n')
    setCurPos((p) => (p.ln === lines.length && p.col === lines[lines.length - 1].length + 1 ? p : { ln: lines.length, col: lines[lines.length - 1].length + 1 }))
    if (typewriter) { ta.scrollTop = Math.max(0, lines.length * 22 - ta.clientHeight / 2); syncScroll() }
  }
  const insertBlock = (t: string): void => {
    const ta = taRef.current; const s = ta?.selectionStart ?? md.length
    const pre = md.slice(0, s)
    const ins = (pre && !pre.endsWith('\n') ? '\n' : '') + t
    change(pre + ins + md.slice(s))
    requestAnimationFrame(() => { ta?.focus(); const p = s + ins.length; ta?.setSelectionRange(p, p) })
    setBlockMenu(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFindOpen(true); return }
    const s = ta.selectionStart, en = ta.selectionEnd
    // Ctrl+1/2/3：当前行设为对应级别标题（重复按同级则原样保留 # 数）
    if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault()
      const ls = md.lastIndexOf('\n', s - 1) + 1
      const le = md.indexOf('\n', s)
      const end = le === -1 ? md.length : le
      const line = md.slice(ls, end).replace(/^#{1,6}\s*/, '')
      const head = '#'.repeat(Number(e.key)) + ' '
      change(md.slice(0, ls) + head + line + md.slice(end))
      requestAnimationFrame(() => ta.setSelectionRange(ls + head.length + line.length, ls + head.length + line.length))
      return
    }
    // Alt+↑/↓：当前行与相邻行交换（移动行）
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const lines = md.split('\n')
      const ln = md.slice(0, s).split('\n').length - 1
      const col = s - (md.lastIndexOf('\n', s - 1) + 1)
      const target = e.key === 'ArrowUp' ? ln - 1 : ln + 1
      if (target < 0 || target >= lines.length) return
      ;[lines[ln], lines[target]] = [lines[target], lines[ln]]
      change(lines.join('\n'))
      const before = lines.slice(0, target).reduce((a, l) => a + l.length + 1, 0)
      const npos = before + Math.min(col, lines[target].length)
      requestAnimationFrame(() => ta.setSelectionRange(npos, npos))
      return
    }
    if (e.key === 'Tab') { e.preventDefault(); change(md.slice(0, s) + '  ' + md.slice(en)); requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2)); return }
    // 自动配对
    if (PAIRS[e.key] && s === en) { e.preventDefault(); const close = PAIRS[e.key]; change(md.slice(0, s) + e.key + close + md.slice(s)); requestAnimationFrame(() => ta.setSelectionRange(s + 1, s + 1)); return }
    // 回车续列表/任务
    if (e.key === 'Enter' && s === en) {
      const lineStart = md.lastIndexOf('\n', s - 1) + 1
      const line = md.slice(lineStart, s)
      const m = line.match(/^(\s*)(- \[ \] |- \[x\] |[-*+] |\d+\. )/)
      if (m) {
        const marker = m[2].replace(/\[x\]/, '[ ]')
        const content = line.slice(m[0].length)
        if (!content.trim()) { e.preventDefault(); change(md.slice(0, lineStart) + md.slice(s)); requestAnimationFrame(() => ta.setSelectionRange(lineStart, lineStart)); return }
        e.preventDefault()
        const nextMarker = /\d+\. /.test(m[2]) ? `${m[1]}${parseInt(m[2]) + 1}. ` : `${m[1]}${marker}`
        const ins = '\n' + nextMarker
        change(md.slice(0, s) + ins + md.slice(s)); requestAnimationFrame(() => ta.setSelectionRange(s + ins.length, s + ins.length))
      }
    }
  }

  const toc = useMemo(() => {
    const items: { level: number; text: string; idx: number }[] = []
    let idx = 0
    for (const l of md.split('\n')) { const m = l.match(/^(#{1,6})\s+(.*)/); if (m) items.push({ level: m[1].length, text: m[2].replace(/[*`~[\]]/g, ''), idx: idx++ }) }
    return items
  }, [md])
  const stats = useMemo(() => {
    const cjk = (md.match(/[一-龥]/g) || []).length
    const en = (md.match(/[a-zA-Z0-9]+/g) || []).length
    const taskTotal = (md.match(/^\s*- \[[ x]\]/gim) || []).length
    const taskDone = (md.match(/^\s*- \[x\]/gim) || []).length
    return { chars: md.length, words: cjk + en, min: Math.max(1, Math.ceil((cjk + en) / 300)), lines: md.split('\n').length, taskTotal, taskDone }
  }, [md])
  // 查找计数：普通模式按子串；正则模式按 RegExp（非法正则返回 -1 → 界面提示）
  const findCount = useMemo(() => {
    if (!findText) return 0
    if (!useRegex) return md.split(findText).length - 1
    try { return (md.match(new RegExp(findText, 'g')) || []).length } catch { return -1 }
  }, [md, findText, useRegex])

  if (!open) return null

  const flash = (t: string): void => { setMsg(t); setTimeout(() => setMsg(''), 2200) }

  // AI 增强：对选区（无选区=全文）执行，结果按 mode 落回
  const runAI = async (a: AiAction): Promise<void> => {
    if (!llmReady) { flash('请先在设置里配置问答模型'); return }
    const ta = taRef.current
    const s = ta?.selectionStart ?? 0, e = ta?.selectionEnd ?? 0
    const hasSel = e > s
    const target = (hasSel ? md.slice(s, e) : md).trim()
    if (!target) { flash('没有内容可处理'); return }
    setAiBusy(a.label)
    const r = await onAI(a.sys, a.wrap(target))
    setAiBusy(null); setAiMenu(false)
    if (!r.ok || !r.text) { flash(r.error || 'AI 处理失败'); return }
    const out = r.text.trim().replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    setDirty(true)
    if (a.mode === 'title') { setTitle(out.split('\n')[0].replace(/^#+\s*/, '').slice(0, 40)); flash('✓ 已生成标题'); return }
    if (a.mode === 'top') { change((a.raw ? out : `> ${out.replace(/\n/g, '\n> ')}`) + '\n\n' + md); flash('✓ 已插到顶部'); return }
    if (a.mode === 'append') { const at = hasSel ? e : (ta?.selectionStart ?? md.length); const pre = md.slice(0, at); change(pre + (pre.endsWith('\n') ? '' : '\n\n') + out + md.slice(at)); flash('✓ 已续写'); return }
    if (hasSel) { change(md.slice(0, s) + out + md.slice(e)); requestAnimationFrame(() => taRef.current?.setSelectionRange(s, s + out.length)) } else change(out)
    flash('✓ ' + a.label)
  }
  const save = async (): Promise<void> => {
    onSave(title, md); setDirty(false)
    if (filePath) { const r = await island.saveMdFile(md, title, filePath); flash(r.ok ? '✓ 已保存到文件' : '✓ 已保存到便签') }
    else flash('✓ 已保存到便签')
  }
  const saveAs = async (): Promise<void> => {
    const r = await island.saveMdFile(md, title || '未命名')
    if (r.ok) { setFilePath(r.path); if (r.name) setTitle(r.name.replace(/\.md$/, '')); setDirty(false); flash('✓ 已另存为 ' + r.name) }
  }
  const openFile = async (): Promise<void> => {
    const r = await island.openMdFile()
    if (r.ok && typeof r.content === 'string') { setMd(r.content); setFilePath(r.path); setTitle((r.name || '').replace(/\.(md|markdown|txt|mdx)$/i, '')); setDirty(false); flash('✓ 已打开 ' + r.name) }
  }
  const copyRich = (): void => {
    try { void navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([`<h2>${escHtml(title)}</h2>` + mdToHtml(md)], { type: 'text/html' }), 'text/plain': new Blob([md], { type: 'text/plain' }) })]); flash('✓ 已复制富文本') }
    catch { void navigator.clipboard?.writeText(md); flash('✓ 已复制 Markdown') }
  }
  const replaceAll = (): void => {
    if (!findText) return
    if (useRegex) {
      try { change(md.replace(new RegExp(findText, 'g'), replaceText)); flash(`已按正则替换 ${findCount} 处`) } catch { flash('正则表达式无效') }
    } else { change(md.split(findText).join(replaceText)); flash(`已替换 ${findCount} 处`) }
  }
  // 版本快照：会话内最多保留 10 版，可一键回滚
  const takeSnap = (): void => { snaps.current = [{ t: Date.now(), title, md }, ...snaps.current].slice(0, 10); flash('✓ 已存快照（本次打开期间可回滚）') }
  const restoreSnap = (s: { t: number; title: string; md: string }): void => { change(s.md); setTitle(s.title); setSnapMenu(false); flash('✓ 已回滚到快照') }

  // 完整 HTML（导出 PDF/HTML 用；样式按所选主题：简洁 / GitHub / 杂志）
  const fullHtml = (): string => {
    const safeTitle = escHtml(title)
    return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>${EXPORT_THEMES[exportTheme].css}</style></head><body><h1>${safeTitle}</h1>${mdToHtml(md)}</body></html>`
  }
  const exportAs = async (kind: 'pdf' | 'html' | 'txt' | 'md'): Promise<void> => {
    setExportMenu(false)
    if (kind === 'pdf') { const r = await island.exportPdf(fullHtml(), title || '文档'); flash(r.ok ? '✓ 已导出 PDF' : '导出失败') }
    else if (kind === 'html') { const r = await island.saveText(fullHtml(), title || '文档', 'html'); flash(r.ok ? '✓ 已导出 HTML' : '取消') }
    else if (kind === 'txt') { const r = await island.saveText(md, title || '文档', 'txt'); flash(r.ok ? '✓ 已导出 TXT' : '取消') }
    else { const r = await island.saveMdFile(md, title || '文档'); flash(r.ok ? '✓ 已导出 MD' : '取消') }
  }
  // 图片粘贴/拖入 → 内嵌 dataURL
  const insertImage = (file: File): void => {
    const reader = new FileReader()
    reader.onload = (): void => { const url = String(reader.result); insertBlock(`![${file.name}](${url})`) }
    reader.readAsDataURL(file)
  }
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const img = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'))
    if (img) { const f = img.getAsFile(); if (f) { e.preventDefault(); insertImage(f) }; return }
    // 选中文字时粘贴纯网址 → 自动变成 [选中文字](url)
    const txt = e.clipboardData.getData('text').trim()
    if (/^https?:\/\/\S+$/.test(txt)) {
      const ta = e.currentTarget
      const s = ta.selectionStart, en = ta.selectionEnd
      if (en > s) {
        e.preventDefault()
        const sel = md.slice(s, en)
        change(md.slice(0, s) + `[${sel}](${txt})` + md.slice(en))
        requestAnimationFrame(() => ta.setSelectionRange(s, s + sel.length + txt.length + 4))
      }
    }
  }
  const onDrop = (e: React.DragEvent<HTMLTextAreaElement>): void => {
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
    if (f) { e.preventDefault(); insertImage(f) }
  }
  // AI 自定义指令
  const runCustom = async (): Promise<void> => {
    const ins = customAi.trim(); if (!ins) return
    await runAI({ label: '自定义', icon: '🪄', mode: 'replace', sys: `你是 Markdown 写作助手。按用户指令处理下面的内容，只输出结果。指令：${ins}`, wrap: (t) => t })
    setCustomAi('')
  }
  // AI 生成 Mermaid 图
  const runMermaid = async (): Promise<void> => {
    if (!llmReady) { flash('请先配置模型'); return }
    setAiBusy('Mermaid'); setAiMenu(false)
    const ta = taRef.current; const sel = ta && ta.selectionEnd > ta.selectionStart ? md.slice(ta.selectionStart, ta.selectionEnd) : md
    const r = await onAI('根据内容生成一段 Mermaid 图表代码（flowchart/sequence 等），只输出 mermaid 代码本身，不要 ``` 包裹。', sel.slice(0, 2000))
    setAiBusy(null)
    if (r.ok && r.text) { insertBlock('```mermaid\n' + r.text.trim().replace(/^```(mermaid)?\n?|```$/g, '').trim() + '\n```'); flash('✓ 已插入 Mermaid') } else flash('生成失败')
  }
  // AI 问文档
  const runAsk = async (): Promise<void> => {
    const q = askQ.trim(); if (!q) return
    if (!llmReady) { setAskA('请先在设置里配置问答模型'); return }
    setAskA('思考中…')
    const r = await onAI('你是文档问答助手。只依据下面的文档内容回答用户的问题，简洁准确，用 Markdown。', `文档：\n${md.slice(0, 8000)}\n\n问题：${q}`)
    setAskA(r.ok && r.text ? r.text.trim() : (r.error || '回答失败'))
  }

  const runMarkdownPower = (id: string): void => {
    const action = MARKDOWN_POWER_ACTIONS.find((x) => x.id === id)
    if (!action) return
    const ta = taRef.current
    const start = ta?.selectionStart ?? 0
    const end = ta?.selectionEnd ?? 0
    const hasSelection = end > start
    const target = hasSelection ? md.slice(start, end) : md
    const output = applyMarkdownPowerAction(id, target, title)
    if (action.mode === 'append') {
      change(md.trimEnd() + `\n\n${output}\n`)
    } else if (hasSelection) {
      change(md.slice(0, start) + output + md.slice(end))
      requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(start, start + output.length) })
    } else change(output)
    flash(`✓ ${action.label}`)
  }
  const jumpToc = (idx: number): void => previewRef.current?.querySelector(`[data-mdh="${idx}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const syncScroll = (): void => {
    const ta = taRef.current; if (!ta) return
    if (gutRef.current) gutRef.current.scrollTop = ta.scrollTop
    if (mode === 'split' && previewRef.current) {
      const p = previewRef.current
      const ratio = ta.scrollHeight - ta.clientHeight > 0 ? ta.scrollTop / (ta.scrollHeight - ta.clientHeight) : 0
      p.scrollTop = ratio * (p.scrollHeight - p.clientHeight)
    }
  }

  // 明暗主题作用于整个工作台
  const ui = light
    ? { card: '#faf9f6', fg: '#1a1a1a', sub: 'rgba(0,0,0,.55)', bd: 'rgba(0,0,0,.1)', btn: 'rgba(0,0,0,.05)', btnA: 'rgba(0,0,0,.13)', prev: '#ffffff', panel: 'rgba(0,0,0,.03)' }
    : { card: 'oklch(calc(0.16 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .99)', fg: 'oklch(0.96 0.01 var(--th))', sub: 'oklch(0.7 0.02 var(--th) / .7)', bd: 'rgba(255,255,255,.07)', btn: 'rgba(255,255,255,.06)', btnA: 'oklch(0.4 0.08 var(--th) / .5)', prev: 'rgba(255,255,255,.02)', panel: 'rgba(255,255,255,.02)' }
  const modeBtn = (m: Mode, label: string): React.JSX.Element => (
    <div className="hv" onClick={() => setMode(m)} style={{ padding: '4px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600, background: mode === m ? (light ? 'rgba(0,0,0,.1)' : 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .22)') : 'transparent', color: mode === m ? (light ? '#111' : 'oklch(0.88 calc(0.12 * var(--cs, 1)) var(--th))') : ui.sub }}>{label}</div>
  )
  const iconBtn = (icon: string, tip: string, on: () => void, active?: boolean): React.JSX.Element => (
    <div key={tip} className="hv" onClick={on} title={tip} style={{ minWidth: 26, height: 26, padding: '0 7px', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: active ? ui.btnA : ui.btn, color: ui.fg, fontSize: 11.5, fontWeight: 700 }}>{icon}</div>
  )

  const editor = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      {!zen && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: 'none', position: 'relative' }}>
          {iconBtn('↶', '撤销 (Ctrl+Z)', undo)}
          {iconBtn('↷', '重做 (Ctrl+Y)', redo)}
          {TOOLBAR.map(([icon, t, fn]) => iconBtn(icon, t, () => fn(wrapSel, insertBlock)))}
          {iconBtn('⊞表', '表格生成器', () => setTableGrid((v) => !v), tableGrid)}
          {iconBtn('😀', 'Emoji', () => setEmojiPick((v) => !v), emojiPick)}
          {iconBtn('＋块', '插入块', () => setBlockMenu((v) => !v), blockMenu)}
          {iconBtn('🔍', '查找替换 (Ctrl+F)', () => setFindOpen((v) => !v), findOpen)}
          {iconBtn('⇥⊞', '表格美化（对齐所有 Markdown 表格列宽）', () => { change(formatTables(md)); flash('✓ 表格已对齐') })}
          {iconBtn('🎯', typewriter ? '打字机模式:开（光标行居中）' : '打字机模式:关', () => setTypewriter((v) => !v), typewriter)}
          {iconBtn('📸', '存版本快照（可回滚）', () => { takeSnap(); setSnapMenu(false) })}
          {snaps.current.length > 0 && iconBtn(`⏱${snaps.current.length}`, '版本快照列表（点击回滚）', () => setSnapMenu((v) => !v), snapMenu)}
          {iconBtn('⌨', '快捷键速查', () => setKeysOpen((v) => !v), keysOpen)}
          {iconBtn('?', 'Markdown 速查', () => setCheat((v) => !v), cheat)}
          {iconBtn(`⚙${MARKDOWN_POWER_ACTIONS.length}`, '高级文档工具', () => setPowerOpen((v) => !v), powerOpen)}
          <div className="hv" onClick={() => setAiMenu((v) => !v)} title="AI 增强（对选区/全文）" style={{ height: 26, padding: '0 10px', borderRadius: 7, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: aiMenu ? 'oklch(0.5 0.13 var(--th) / .5)' : 'linear-gradient(180deg, oklch(0.7 0.14 var(--th) / .45), oklch(0.55 0.13 var(--th2) / .4))', color: 'oklch(0.95 0.02 var(--th))', fontSize: 11, fontWeight: 700 }}>{aiBusy ? `✨ ${aiBusy}…` : '✨ AI'}</div>
          {powerOpen && (
            <div className="ai-scroll" style={{ position: 'absolute', top: 30, left: 0, zIndex: 8, width: 'min(430px, calc(100vw - 90px))', maxHeight: 410, overflowY: 'auto', padding: 9, borderRadius: 8, background: 'oklch(0.18 0.025 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)', boxShadow: '0 14px 34px rgba(0,0,0,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 7 }}>
                <span style={{ color: 'oklch(0.84 0.04 var(--th))', fontSize: 10.5, fontWeight: 750, marginRight: 5 }}>文档工具</span>
                {(['结构', '整理', '审计', '块'] as MarkdownPowerGroup[]).map((group) => (
                  <button key={group} type="button" onClick={() => setPowerGroup(group)} style={{ height: 23, padding: '0 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,.07)', background: powerGroup === group ? 'oklch(0.4 0.08 var(--th) / .45)' : 'rgba(255,255,255,.04)', color: powerGroup === group ? 'oklch(0.9 0.08 var(--th))' : 'oklch(0.66 0.02 var(--th) / .65)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 9.5, fontWeight: 650 }}>{group}</button>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 8.5 }}>{MARKDOWN_POWER_ACTIONS.length} 项</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 5 }}>
                {MARKDOWN_POWER_ACTIONS.filter((x) => x.group === powerGroup).map((action) => (
                  <button key={action.id} type="button" className="hv" onClick={() => runMarkdownPower(action.id)} title={action.hint} style={{ height: 30, minWidth: 0, padding: '0 7px', borderRadius: 7, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.045)', color: 'oklch(0.8 0.03 var(--th))', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 9.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.label}</button>
                ))}
              </div>
            </div>
          )}
          {aiMenu && (
            <div className="ai-scroll" style={{ position: 'absolute', top: 30, right: 0, zIndex: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, width: 300, maxHeight: 380, overflowY: 'auto', padding: 9, borderRadius: 11, background: 'oklch(0.19 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.12 var(--th) / .4)' }}>
              <div style={{ gridColumn: '1 / -1', color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 9, marginBottom: 2 }}>选中文字则处理选区,否则处理全文</div>
              {AI_ACTIONS.map((a) => (
                <div key={a.label} className="hv" onClick={() => void runAI(a)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.05)', color: 'oklch(0.86 0.02 var(--th))', fontSize: 10.5, fontWeight: 600 }}>
                  <span style={{ flex: 'none' }}>{a.icon}</span>{a.label}
                </div>
              ))}
              <div className="hv" onClick={() => void runMermaid()} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.05)', color: 'oklch(0.86 0.02 var(--th))', fontSize: 10.5, fontWeight: 600 }}>📊 生成图表</div>
              <div className="hv" onClick={() => { setAskOpen(true); setAiMenu(false) }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.05)', color: 'oklch(0.86 0.02 var(--th))', fontSize: 10.5, fontWeight: 600 }}>💬 问文档</div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 4, marginTop: 3 }}>
                <input value={customAi} onChange={(e) => setCustomAi(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runCustom() }} placeholder="🪄 自定义指令，如：改成产品文案…" style={{ flex: 1, background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 10, padding: '5px 8px' }} />
                <div className="hv" onClick={() => void runCustom()} style={{ padding: '0 10px', borderRadius: 7, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'oklch(0.6 0.13 var(--th) / .5)', color: 'oklch(0.95 0.02 var(--th))', fontSize: 10, fontWeight: 700 }}>执行</div>
              </div>
            </div>
          )}
          {tableGrid && (
            <div style={{ position: 'absolute', top: 30, left: 40, zIndex: 6, padding: 9, borderRadius: 10, background: 'oklch(0.2 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)' }}>
              <div style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 9, marginBottom: 5 }}>选择表格大小</div>
              {Array.from({ length: 5 }, (_, r) => (
                <div key={r} style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
                  {Array.from({ length: 6 }, (_, c) => (
                    <div key={c} className="hv" onClick={() => { const cols = c + 1, rows = r + 1; const header = `| ${Array.from({ length: cols }, (_, i) => '列' + (i + 1)).join(' | ')} |`; const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`; const body = Array.from({ length: rows }, () => `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`).join('\n'); insertBlock(`${header}\n${sep}\n${body}`); setTableGrid(false) }} style={{ width: 15, height: 15, borderRadius: 3, background: 'oklch(0.4 0.06 var(--th) / .4)', cursor: 'pointer', border: '1px solid rgba(255,255,255,.1)' }} />
                  ))}
                </div>
              ))}
            </div>
          )}
          {emojiPick && (
            <div style={{ position: 'absolute', top: 30, left: 70, zIndex: 6, width: 220, padding: 9, borderRadius: 10, background: 'oklch(0.2 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {'😀 😎 🤔 🚀 ✨ 🔥 💡 ✅ ⚠️ ❌ 📌 📎 🎯 📊 🧩 🛠️ 🐛 ⚡ 🌟 💪 👍 🎉 📝 🔑 🧠 ⏱️ 📅 🔗 💬 ⭐'.split(' ').map((em) => (
                <span key={em} className="hv" onClick={() => { wrapSel(em, '', ''); setEmojiPick(false) }} style={{ cursor: 'pointer', fontSize: 16, padding: 2 }}>{em}</span>
              ))}
            </div>
          )}
          {blockMenu && (
            <div style={{ position: 'absolute', top: 30, left: 0, zIndex: 5, display: 'flex', flexWrap: 'wrap', gap: 4, width: 220, padding: 8, borderRadius: 10, background: 'oklch(0.2 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)' }}>
              {BLOCKS.map(([ic, t, ins]) => <div key={t} className="hv" onClick={() => insertBlock(ins)} title={t} style={{ minWidth: 30, padding: '4px 8px', borderRadius: 7, textAlign: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.06)', fontSize: 11, fontWeight: 700, color: 'oklch(0.85 0.02 var(--th))' }}>{ic}</div>)}
            </div>
          )}
          {cheat && (
            <div style={{ position: 'absolute', top: 30, left: 0, zIndex: 5, width: 260, padding: 10, borderRadius: 10, background: 'oklch(0.2 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {CHEATS.map(([syn, desc]) => <div key={desc} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10 }}><code style={{ color: 'oklch(0.86 0.1 var(--th))', fontFamily: 'ui-monospace,monospace' }}>{syn}</code><span style={{ color: 'oklch(0.6 0.02 var(--th) / .6)' }}>{desc}</span></div>)}
            </div>
          )}
          {keysOpen && (
            <div style={{ position: 'absolute', top: 30, left: 60, zIndex: 5, width: 280, padding: 10, borderRadius: 10, background: 'oklch(0.2 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 9, marginBottom: 2 }}>⌨ 快捷键</div>
              {KEYS.map(([k, desc]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10 }}><code style={{ color: 'oklch(0.86 0.1 var(--th))', fontFamily: 'ui-monospace,monospace' }}>{k}</code><span style={{ color: 'oklch(0.6 0.02 var(--th) / .6)' }}>{desc}</span></div>)}
            </div>
          )}
          {snapMenu && snaps.current.length > 0 && (
            <div style={{ position: 'absolute', top: 30, left: 120, zIndex: 6, width: 250, padding: 8, borderRadius: 10, background: 'oklch(0.2 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 9, marginBottom: 2 }}>⏱ 版本快照（点击回滚，本次会话内有效）</div>
              {snaps.current.map((sn) => (
                <div key={sn.t} className="hv" onClick={() => restoreSnap(sn)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', borderRadius: 7, cursor: 'pointer', background: 'rgba(255,255,255,.05)' }}>
                  <span style={{ color: 'oklch(0.88 0.06 var(--th))', fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{new Date(sn.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
                  <span style={{ flex: 1, color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sn.title}</span>
                  <span style={{ color: 'oklch(0.55 0.02 var(--th) / .5)', fontSize: 9 }}>{sn.md.length} 字</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {findOpen && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
          <input value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="查找" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11, padding: '5px 9px' }} />
          <input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="替换为" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11, padding: '5px 9px' }} />
          <div className="hv" onClick={() => setUseRegex((v) => !v)} title="正则表达式模式" style={{ flex: 'none', padding: '4px 8px', borderRadius: 7, cursor: 'pointer', background: useRegex ? 'oklch(0.45 0.1 var(--th) / .55)' : 'rgba(255,255,255,.06)', color: useRegex ? 'oklch(0.92 0.08 var(--th))' : 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 10, fontWeight: 700, fontFamily: 'ui-monospace,monospace' }}>.*</div>
          <span style={{ color: findCount === -1 ? 'oklch(0.75 0.12 30)' : 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 10, flex: 'none' }}>{findCount === -1 ? '正则无效' : `${findCount} 处`}</span>
          <div className="hv" onClick={replaceAll} style={{ flex: 'none', padding: '5px 10px', borderRadius: 7, cursor: 'pointer', background: 'oklch(0.4 0.08 var(--th) / .5)', color: 'oklch(0.88 0.1 var(--th))', fontSize: 10.5, fontWeight: 600 }}>全部替换</div>
          <div className="hv" onClick={() => setFindOpen(false)} style={{ flex: 'none', cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 12 }}>✕</div>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', background: light ? 'rgba(250,250,248,.96)' : 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 11, overflow: 'hidden' }}>
        <div ref={gutRef} style={{ flex: 'none', width: 38, overflow: 'hidden', padding: '13px 0', textAlign: 'right', color: light ? 'rgba(0,0,0,.28)' : 'oklch(0.5 0.02 var(--th) / .4)', fontSize: 12, lineHeight: '22px', fontFamily: 'ui-monospace,monospace', userSelect: 'none' }}>
          {Array.from({ length: stats.lines }, (_, i) => <div key={i} style={{ padding: '0 7px' }}>{i + 1}</div>)}
        </div>
        <textarea
          ref={taRef}
          value={md}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          onKeyUp={trackCursor}
          onClick={trackCursor}
          onScroll={syncScroll}
          onPaste={onPaste}
          onDrop={onDrop}
          placeholder="在此撰写 Markdown…（Ctrl+S 保存 · Ctrl+Z/Y 撤销重做 · Ctrl+F 查找 · 可粘贴/拖入图片）"
          className="ai-scroll"
          spellCheck={false}
          style={{ flex: 1, minHeight: 0, resize: 'none', background: 'transparent', border: 'none', outline: 'none', color: light ? '#222' : 'oklch(0.93 0.01 var(--th))', fontSize: 13.5, lineHeight: '22px', fontFamily: "ui-monospace,'Cascadia Code',Consolas,monospace", padding: '13px 15px 13px 5px' }}
        />
      </div>
    </div>
  )

  const preview = (
    <div ref={previewRef} className="ai-scroll" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', background: mode === 'read' ? (light ? '#ffffff' : 'transparent') : ui.prev, borderRadius: 11, border: mode === 'read' ? 'none' : `1px solid ${ui.bd}` }}>
      <div style={{ maxWidth: mode === 'read' ? rWidth : '100%', margin: '0 auto', padding: mode === 'read' ? '8px 34px 70px' : '16px 20px', fontSize: mode === 'read' ? rFont : undefined }}>
        {mode === 'read' && <div style={{ fontSize: rFont * 2, fontWeight: 900, color: light ? '#0f0f14' : 'oklch(0.97 0.02 var(--th))', margin: '10px 0 22px', lineHeight: 1.25 }}>{title}</div>}
        <Markdown text={md} reader light={light} />
      </div>
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: zen ? 0 : '3vh 3vw', background: 'oklch(0.08 0.02 var(--ths) / .6)', backdropFilter: 'blur(6px)', animation: 'ai-fadein .15s ease' }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: zen ? 0 : 18, overflow: 'hidden', background: ui.card, border: zen ? 'none' : `1px solid ${ui.bd}`, boxShadow: 'none' }}>
        {/* 顶栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderBottom: `1px solid ${ui.bd}`, flex: 'none', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15 }}>✍️</span>
          <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} placeholder="文档标题" style={{ flex: 1, minWidth: 120, background: 'transparent', border: 'none', outline: 'none', color: ui.fg, fontSize: 14.5, fontWeight: 700 }} />
          {dirty && <span title="未保存" style={{ width: 7, height: 7, borderRadius: 999, background: 'oklch(0.8 0.13 75)', flex: 'none' }} />}
          {filePath && <span title={filePath} style={{ color: ui.sub, fontSize: 9.5, flex: 'none', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {filePath.split(/[\\/]/).pop()}</span>}
          <div style={{ display: 'flex', gap: 2, background: ui.btn, borderRadius: 9, padding: 2, flex: 'none' }}>{modeBtn('edit', '编辑')}{modeBtn('split', '分屏')}{modeBtn('read', '阅读')}</div>
          {iconBtn('☰', '大纲', () => setTocOpen((v) => !v), tocOpen)}
          {iconBtn(light ? '🌙' : '☀️', light ? '暗色编辑' : '亮色编辑', () => setLight((v) => !v))}
          {iconBtn(autoSave ? '💾' : '🅰', autoSave ? '自动保存:开' : '自动保存:关', () => setAutoSave((v) => !v), autoSave)}
          {iconBtn(zen ? '◱' : '⛶', zen ? '退出专注' : '专注写作', () => setZen((v) => !v), zen)}
          {msg && <span style={{ color: 'oklch(0.82 calc(0.12 * var(--cs, 1)) var(--th))', fontSize: 10.5, flex: 'none' }}>{msg}</span>}
          {iconBtn('📂', '打开本地 .md', () => void openFile())}
          {iconBtn('⧉', '复制富文本', copyRich)}
          <div style={{ position: 'relative', flex: 'none' }}>
            {iconBtn('⤓导出', '导出 PDF/HTML/TXT/MD', () => setExportMenu((v) => !v), exportMenu)}
            {exportMenu && (
              <div style={{ position: 'absolute', top: 30, right: 0, zIndex: 7, width: 168, padding: 6, borderRadius: 9, background: 'oklch(0.2 0.03 var(--ths) / .99)', border: '1px solid oklch(0.6 0.1 var(--th) / .35)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 8.5, padding: '2px 5px' }}>样式主题（PDF/HTML）</div>
                <div style={{ display: 'flex', gap: 3, padding: '0 3px 4px' }}>
                  {(Object.entries(EXPORT_THEMES) as [typeof exportTheme, { label: string }][]).map(([k, t]) => (
                    <div key={k} className="hv" onClick={() => setExportTheme(k)} style={{ flex: 1, textAlign: 'center', padding: '3px 0', borderRadius: 6, cursor: 'pointer', background: exportTheme === k ? 'oklch(0.45 0.1 var(--th) / .55)' : 'rgba(255,255,255,.05)', color: exportTheme === k ? 'oklch(0.92 0.06 var(--th))' : 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 9.5, fontWeight: 600 }}>{t.label}</div>
                  ))}
                </div>
                {([['pdf', '📕 PDF'], ['html', '🌐 HTML'], ['txt', '📄 TXT'], ['md', '⬇ Markdown']] as const).map(([k, l]) => (
                  <div key={k} className="hv" onClick={() => void exportAs(k)} style={{ padding: '5px 9px', borderRadius: 7, cursor: 'pointer', color: 'oklch(0.86 0.02 var(--th))', fontSize: 11 }}>{l}</div>
                ))}
              </div>
            )}
          </div>
          <div className="hv" onClick={() => void save()} title="保存（Ctrl+S）" style={{ padding: '5px 13px', borderRadius: 8, cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11, fontWeight: 700, flex: 'none' }}>保存</div>
          <div className="hv" onClick={() => { onSave(title, md); onClose() }} title="关闭（自动保存到便签）" style={{ padding: '5px 10px', borderRadius: 8, cursor: 'pointer', color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 15, flex: 'none' }}>✕</div>
        </div>
        {/* 阅读排版调节条 */}
        {mode === 'read' && !zen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px', borderBottom: `1px solid ${ui.bd}`, flex: 'none' }}>
            <span style={{ color: ui.sub, fontSize: 10.5 }}>字号</span>
            <input type="range" min={13} max={22} value={rFont} onChange={(e) => setRFont(Number(e.target.value))} style={{ width: 90, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }} />
            <span style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 10.5 }}>页宽</span>
            <input type="range" min={560} max={1000} step={20} value={rWidth} onChange={(e) => setRWidth(Number(e.target.value))} style={{ width: 120, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }} />
          </div>
        )}
        {/* 主体 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: zen ? '14px 8vw' : 14 }}>
          {tocOpen && !zen && (
            <div className="ai-scroll" style={{ width: 190, flex: 'none', overflowY: 'auto', borderRight: `1px solid ${ui.bd}`, paddingRight: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ color: ui.sub, fontSize: 9.5, fontWeight: 700, marginBottom: 4 }}>大纲</div>
              {toc.length ? toc.map((t) => <div key={t.idx} className="hv" onClick={() => jumpToc(t.idx)} style={{ cursor: 'pointer', fontSize: 11, padding: '3px 6px', borderRadius: 6, color: ui.fg, opacity: t.level <= 2 ? 0.9 : 0.7, paddingLeft: 6 + (t.level - 1) * 11, fontWeight: t.level <= 2 ? 600 : 400 }}>{t.text.slice(0, 22)}</div>) : <div style={{ color: ui.sub, fontSize: 10 }}>用 # 写标题生成大纲</div>}
            </div>
          )}
          {mode === 'edit' && editor}
          {mode === 'split' && <>{editor}{preview}</>}
          {mode === 'read' && preview}
          {/* 问文档面板 */}
          {askOpen && !zen && (
            <div style={{ width: 260, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, borderLeft: `1px solid ${ui.bd}`, paddingLeft: 12, minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'oklch(0.9 0.06 var(--th))', fontSize: 11.5, fontWeight: 800 }}>💬 问文档</span>
                <span style={{ flex: 1 }} />
                <span className="hv" onClick={() => setAskOpen(false)} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 12 }}>✕</span>
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                <input value={askQ} onChange={(e) => setAskQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runAsk() }} placeholder="就本文提问…" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11, padding: '6px 9px' }} />
                <div className="hv" onClick={() => void runAsk()} style={{ padding: '0 11px', borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11, fontWeight: 700 }}>问</div>
              </div>
              <div className="ai-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: askA ? 10 : 0, borderRadius: 10, background: askA ? 'rgba(255,255,255,.03)' : 'transparent', fontSize: 11.5, lineHeight: 1.6 }}>
                {askA ? <Markdown text={askA} light={light} /> : <div style={{ color: ui.sub, fontSize: 10.5, lineHeight: 1.7 }}>只依据当前文档内容回答,不改动正文。适合快速回顾、答疑。</div>}
              </div>
            </div>
          )}
        </div>
        {/* 底栏 */}
        {!zen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '7px 16px', borderTop: `1px solid ${ui.bd}`, color: ui.sub, fontSize: 10, flex: 'none' }}>
            <span>{stats.words} 词</span><span>{stats.chars} 字符</span><span>{stats.lines} 行</span><span>约 {stats.min} 分钟读完</span><span>{toc.length} 个标题</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>行 {curPos.ln} : 列 {curPos.col}</span>
            {stats.taskTotal > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                ☑ {stats.taskDone}/{stats.taskTotal}
                <span style={{ width: 52, height: 4, borderRadius: 999, background: 'rgba(255,255,255,.1)', overflow: 'hidden', display: 'inline-block' }}>
                  <span style={{ display: 'block', width: `${Math.round((stats.taskDone / stats.taskTotal) * 100)}%`, height: '100%', background: 'oklch(0.72 0.13 150)' }} />
                </span>
              </span>
            )}
            {typewriter && <span style={{ color: 'oklch(0.8 0.1 var(--th))' }}>🎯 打字机</span>}
          </div>
        )}
      </div>
    </div>
  )
}
