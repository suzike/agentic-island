export type MarkdownPowerGroup = '结构' | '整理' | '审计' | '块'
export interface MarkdownPowerAction { id: string; group: MarkdownPowerGroup; label: string; hint: string; mode: 'replace' | 'append' }

export const MARKDOWN_POWER_ACTIONS: MarkdownPowerAction[] = [
  { id: 'promote', group: '结构', label: '标题升级', hint: '所有标题提升一级', mode: 'replace' },
  { id: 'demote', group: '结构', label: '标题降级', hint: '所有标题降低一级', mode: 'replace' },
  { id: 'number', group: '结构', label: '标题编号', hint: '按层级自动编号', mode: 'replace' },
  { id: 'unnumber', group: '结构', label: '移除编号', hint: '清除标题前自动编号', mode: 'replace' },
  { id: 'toc', group: '结构', label: '插入目录', hint: '生成文档内部目录', mode: 'replace' },
  { id: 'frontmatter', group: '结构', label: 'Frontmatter', hint: '添加 YAML 元数据', mode: 'replace' },
  { id: 'trim', group: '整理', label: '行尾清理', hint: '去除行尾空格', mode: 'replace' },
  { id: 'blanks', group: '整理', label: '收敛空行', hint: '连续空行收敛为一行', mode: 'replace' },
  { id: 'bullets', group: '整理', label: '统一列表', hint: '统一无序列表标记', mode: 'replace' },
  { id: 'task-case', group: '整理', label: '统一任务框', hint: '统一任务框大小写和符号', mode: 'replace' },
  { id: 'dedupe', group: '整理', label: '相邻去重', hint: '删除连续重复行', mode: 'replace' },
  { id: 'punctuation', group: '整理', label: '中文标点', hint: '修正常见中英文标点间距', mode: 'replace' },
  { id: 'tasks', group: '审计', label: '任务清单', hint: '追加任务审计报告', mode: 'append' },
  { id: 'links', group: '审计', label: '链接清单', hint: '追加链接清单', mode: 'append' },
  { id: 'images', group: '审计', label: '图片清单', hint: '追加图片清单', mode: 'append' },
  { id: 'code', group: '审计', label: '代码块清单', hint: '追加代码语言清单', mode: 'append' },
  { id: 'anchors', group: '审计', label: '锚点检查', hint: '检查内部锚点指向', mode: 'append' },
  { id: 'stats', group: '审计', label: '文档报告', hint: '追加字数与结构报告', mode: 'append' },
  { id: 'quote', group: '块', label: '转引用块', hint: '每行转换为引用', mode: 'replace' },
  { id: 'details', group: '块', label: '折叠块', hint: '包裹为 details 折叠区域', mode: 'replace' },
  { id: 'comment', group: '块', label: '注释块', hint: '包裹为 HTML 注释', mode: 'replace' },
  { id: 'csv-table', group: '块', label: 'CSV 转表格', hint: '把逗号分隔文本转 Markdown 表格', mode: 'replace' },
  { id: 'task-progress', group: '块', label: '任务进度块', hint: '生成任务进度摘要', mode: 'append' },
  { id: 'glossary', group: '块', label: '术语表', hint: '从加粗术语生成术语表', mode: 'append' }
]

const slug = (s: string): string => s.toLowerCase().trim().replace(/[`*_~]/g, '').replace(/[^\w\u4e00-\u9fff\s-]/g, '').replace(/\s+/g, '-')
const headings = (text: string): { level: number; title: string }[] => [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, title: m[2].trim() }))

export function applyMarkdownPowerAction(id: string, text: string, title = '未命名文档'): string {
  if (id === 'promote') return text.replace(/^(#{2,6})\s/gm, (m, h: string) => `${h.slice(1)} `)
  if (id === 'demote') return text.replace(/^(#{1,5})\s/gm, (_m, h: string) => `${h}# `)
  if (id === 'number') {
    const counts = [0, 0, 0, 0, 0, 0]
    return text.replace(/^(#{1,6})\s+(?:\d+(?:\.\d+)*[.、]?\s*)?(.+)$/gm, (_m, h: string, t: string) => { const l = h.length; counts[l - 1]++; for (let i = l; i < counts.length; i++) counts[i] = 0; return `${h} ${counts.slice(0, l).filter(Boolean).join('.')} ${t}` })
  }
  if (id === 'unnumber') return text.replace(/^(#{1,6})\s+\d+(?:\.\d+)*[.、]?\s+/gm, '$1 ')
  if (id === 'toc') {
    const toc = headings(text).map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- [${h.title}](#${slug(h.title)})`).join('\n')
    return `## 目录\n\n${toc || '- 暂无标题'}\n\n${text}`
  }
  if (id === 'frontmatter') return /^---\n/.test(text) ? text : `---\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${new Date().toISOString().slice(0, 10)}\ntags: []\nstatus: draft\n---\n\n${text}`
  if (id === 'trim') return text.split('\n').map((l) => l.trimEnd()).join('\n')
  if (id === 'blanks') return text.replace(/\n{3,}/g, '\n\n')
  if (id === 'bullets') return text.replace(/^(\s*)[*+]\s+/gm, '$1- ')
  if (id === 'task-case') return text.replace(/^(\s*)[*+]\s*\[\s*\]\s*/gm, '$1- [ ] ').replace(/^(\s*)[-*+]\s*\[[xX]\]\s*/gm, '$1- [x] ')
  if (id === 'dedupe') return text.split('\n').filter((line, i, arr) => i === 0 || line !== arr[i - 1]).join('\n')
  if (id === 'punctuation') return text.replace(/[ \t]+([，。！？；：、])/g, '$1').replace(/([，。！？；：、])(?=[A-Za-z0-9\u4e00-\u9fff])/g, '$1 ').replace(/[ \t]{2,}/g, ' ')
  if (id === 'tasks') {
    const rows = [...text.matchAll(/^\s*- \[([ xX])\]\s+(.+)$/gm)].map((m) => `- ${m[1].toLowerCase() === 'x' ? '已完成' : '未完成'} · ${m[2]}`)
    return `## 任务审计\n\n${rows.join('\n') || '没有任务项。'}`
  }
  if (id === 'links') { const rows = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => `- [${m[1]}](${m[2]})`); return `## 链接清单\n\n${rows.join('\n') || '没有链接。'}` }
  if (id === 'images') { const rows = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((m) => `- ${m[1] || '未命名图片'} · ${m[2]}`); return `## 图片清单\n\n${rows.join('\n') || '没有图片。'}` }
  if (id === 'code') { const langs = [...text.matchAll(/^```([^\n]*)/gm)].map((m) => m[1].trim() || '纯文本'); return `## 代码块清单\n\n${langs.map((l, i) => `- 第 ${i + 1} 块 · ${l}`).join('\n') || '没有代码块。'}` }
  if (id === 'anchors') {
    const known = new Set(headings(text).map((h) => slug(h.title))), refs = [...text.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)].map((m) => m[1])
    const broken = refs.filter((r) => !known.has(r)); return `## 锚点检查\n\n${broken.length ? broken.map((r) => `- 缺失：\`#${r}\``).join('\n') : '内部锚点均有效。'}`
  }
  if (id === 'stats') return `## 文档报告\n\n- 字符：${text.length}\n- 行数：${text.split('\n').length}\n- 标题：${headings(text).length}\n- 链接：${[...text.matchAll(/\[[^\]]+\]\([^)]+\)/g)].length}\n- 图片：${[...text.matchAll(/!\[[^\]]*\]\([^)]+\)/g)].length}\n- 代码块：${Math.floor(([...text.matchAll(/^```/gm)].length) / 2)}\n- 预计阅读：${Math.max(1, Math.ceil(text.length / 400))} 分钟`
  if (id === 'quote') return text.split('\n').map((l) => l ? `> ${l}` : '>').join('\n')
  if (id === 'details') return `<details>\n<summary>展开查看</summary>\n\n${text}\n\n</details>`
  if (id === 'comment') return `<!--\n${text}\n-->`
  if (id === 'csv-table') {
    const rows = text.trim().split('\n').map((r) => r.split(',').map((c) => c.trim())); if (!rows.length) return text
    const cols = Math.max(...rows.map((r) => r.length)); const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ')} |`
    return [line(rows[0]), line(Array(cols).fill('---')), ...rows.slice(1).map(line)].join('\n')
  }
  if (id === 'task-progress') { const all = [...text.matchAll(/^\s*- \[([ xX])\]/gm)], done = all.filter((m) => m[1].toLowerCase() === 'x').length; return `> [!INFO] 任务进度\n> ${done}/${all.length} 已完成 · ${all.length ? Math.round(done / all.length * 100) : 0}%` }
  if (id === 'glossary') { const terms = [...new Set([...text.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim()))]; return `## 术语表\n\n${terms.map((t) => `- **${t}**：`).join('\n') || '没有找到加粗术语。'}` }
  return text
}
