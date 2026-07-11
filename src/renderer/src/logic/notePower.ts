import type { StickyNote } from '../types'

export type NotePowerGroup = '整理' | '质检' | '索引' | '洞察' | '导出'
export type NotePowerKind = 'report' | 'document' | 'updates' | 'export'

export interface NotePowerAction { id: string; group: NotePowerGroup; label: string; hint: string }
export interface NotePowerResult {
  kind: NotePowerKind
  title: string
  content?: string
  updates?: StickyNote[]
  ext?: 'json' | 'csv' | 'opml'
}

export const NOTE_POWER_ACTIONS: NotePowerAction[] = [
  { id: 'space', group: '整理', label: '清理空行', hint: '移除行尾空格并收敛连续空行' },
  { id: 'tags', group: '整理', label: '规范标签', hint: '去空格、去重并限制标签长度' },
  { id: 'tasks', group: '整理', label: '规范任务', hint: '统一 Markdown 任务框格式' },
  { id: 'sort-tags', group: '整理', label: '标签排序', hint: '按中文顺序整理每条便签标签' },
  { id: 'dup-title', group: '整理', label: '重复标题', hint: '找出标题相同的便签' },
  { id: 'dup-content', group: '整理', label: '重复内容', hint: '找出正文完全相同的便签' },
  { id: 'empty', group: '质检', label: '过短便签', hint: '列出正文不足 20 字的便签' },
  { id: 'stale', group: '质检', label: '长期未更新', hint: '列出 90 天未更新的便签' },
  { id: 'untagged', group: '质检', label: '缺少标签', hint: '列出无标签便签' },
  { id: 'no-source', group: '质检', label: '缺少来源', hint: '列出没有来源记录的便签' },
  { id: 'broken-links', group: '质检', label: '失效双链', hint: '检查 [[便签链接]] 指向是否存在' },
  { id: 'orphans', group: '质检', label: '孤立便签', hint: '找出既无出链也无入链的便签' },
  { id: 'task-index', group: '索引', label: '任务索引', hint: '汇总全部未完成任务' },
  { id: 'tag-index', group: '索引', label: '标签索引', hint: '按标签生成便签目录' },
  { id: 'source-index', group: '索引', label: '来源索引', hint: '按来源汇总便签' },
  { id: 'timeline', group: '索引', label: '时间线', hint: '按创建日期生成时间线' },
  { id: 'star-index', group: '索引', label: '收藏合集', hint: '汇总全部星标便签' },
  { id: 'later-index', group: '索引', label: '稍后读合集', hint: '汇总稍后读队列' },
  { id: 'words', group: '洞察', label: '高频词', hint: '统计正文高频词语' },
  { id: 'reading', group: '洞察', label: '阅读时间', hint: '估算每条便签阅读时间' },
  { id: 'task-progress', group: '洞察', label: '任务进度', hint: '统计任务完成情况' },
  { id: 'lengths', group: '洞察', label: '内容长度', hint: '分析短中长便签分布' },
  { id: 'colors', group: '洞察', label: '配色分布', hint: '统计便签颜色使用情况' },
  { id: 'activity', group: '洞察', label: '活跃周期', hint: '统计 7/30/90 天记录活跃度' },
  { id: 'json', group: '导出', label: 'JSON 备份', hint: '导出完整结构化便签数据' },
  { id: 'csv', group: '导出', label: 'CSV 清单', hint: '导出可用于表格分析的清单' },
  { id: 'opml', group: '导出', label: 'OPML 大纲', hint: '导出通用大纲交换格式' }
]

const liveNotes = (notes: StickyNote[]): StickyNote[] => notes.filter((n) => !n.trashed)
const norm = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase()
const escCsv = (v: string): string => `"${v.replace(/"/g, '""')}"`
const escXml = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const listReport = (title: string, notes: StickyNote[], detail?: (n: StickyNote) => string): string =>
  `# ${title}\n\n${notes.length ? notes.map((n) => `- [[${n.title}]]${detail ? ` · ${detail(n)}` : ''}`).join('\n') : '没有发现相关便签。'}`

export function runNotePowerAction(id: string, notes: StickyNote[], now = Date.now()): NotePowerResult {
  const live = liveNotes(notes)
  if (id === 'space') return { kind: 'updates', title: '已清理空行', updates: live.map((n) => ({ ...n, md: n.md.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n'), updatedAt: now })) }
  if (id === 'tags') return { kind: 'updates', title: '已规范标签', updates: live.map((n) => ({ ...n, tags: [...new Set(n.tags.map((t) => t.trim()).filter(Boolean).map((t) => t.slice(0, 16)))], updatedAt: now })) }
  if (id === 'tasks') return { kind: 'updates', title: '已规范任务', updates: live.map((n) => ({ ...n, md: n.md.replace(/^\s*[*+]\s*\[\s*\]/gm, '- [ ]').replace(/^\s*[-*+]\s*\[[xX]\]/gm, '- [x]'), updatedAt: now })) }
  if (id === 'sort-tags') return { kind: 'updates', title: '已排序标签', updates: live.map((n) => ({ ...n, tags: [...n.tags].sort((a, b) => a.localeCompare(b, 'zh-CN')), updatedAt: now })) }
  if (id === 'dup-title' || id === 'dup-content') {
    const groups = new Map<string, StickyNote[]>()
    for (const n of live) { const key = id === 'dup-title' ? norm(n.title) : norm(n.md); if (key) groups.set(key, [...(groups.get(key) || []), n]) }
    const dup = [...groups.values()].filter((g) => g.length > 1)
    return { kind: 'report', title: id === 'dup-title' ? '重复标题' : '重复内容', content: `# ${id === 'dup-title' ? '重复标题' : '重复内容'}\n\n${dup.length ? dup.map((g, i) => `## 第 ${i + 1} 组\n${g.map((n) => `- [[${n.title}]]`).join('\n')}`).join('\n\n') : '没有发现重复。'}` }
  }
  if (id === 'empty') return { kind: 'report', title: '过短便签', content: listReport('过短便签', live.filter((n) => n.md.trim().length < 20), (n) => `${n.md.trim().length} 字`) }
  if (id === 'stale') return { kind: 'report', title: '长期未更新', content: listReport('长期未更新', live.filter((n) => now - n.updatedAt > 90 * 86400_000), (n) => `${Math.floor((now - n.updatedAt) / 86400_000)} 天`) }
  if (id === 'untagged') return { kind: 'report', title: '缺少标签', content: listReport('缺少标签', live.filter((n) => !n.tags.length)) }
  if (id === 'no-source') return { kind: 'report', title: '缺少来源', content: listReport('缺少来源', live.filter((n) => !n.source)) }
  const titleSet = new Set(live.map((n) => n.title.trim().toLowerCase()))
  const linksOf = (n: StickyNote): string[] => [...n.md.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim())
  if (id === 'broken-links') {
    const rows = live.flatMap((n) => linksOf(n).filter((t) => !titleSet.has(t.toLowerCase())).map((t) => `- [[${n.title}]] → \`${t}\``))
    return { kind: 'report', title: '失效双链', content: `# 失效双链\n\n${rows.join('\n') || '没有发现失效双链。'}` }
  }
  if (id === 'orphans') {
    const inbound = new Set(live.flatMap(linksOf).map((x) => x.toLowerCase()))
    return { kind: 'report', title: '孤立便签', content: listReport('孤立便签', live.filter((n) => !linksOf(n).length && !inbound.has(n.title.toLowerCase()))) }
  }
  if (id === 'task-index') {
    const rows = live.flatMap((n) => [...n.md.matchAll(/^\s*- \[ \]\s+(.+)$/gm)].map((m) => `- [ ] ${m[1]} · [[${n.title}]]`))
    return { kind: 'document', title: '未完成任务索引', content: `# 未完成任务索引\n\n${rows.join('\n') || '暂无未完成任务。'}` }
  }
  if (id === 'tag-index') {
    const tags = new Map<string, StickyNote[]>(); live.forEach((n) => n.tags.forEach((t) => tags.set(t, [...(tags.get(t) || []), n])))
    return { kind: 'document', title: '标签索引', content: `# 标签索引\n\n${[...tags.entries()].sort().map(([t, ns]) => `## ${t}\n${ns.map((n) => `- [[${n.title}]]`).join('\n')}`).join('\n\n') || '暂无标签。'}` }
  }
  if (id === 'source-index') {
    const sourced = live.filter((n) => n.source)
    return { kind: 'document', title: '来源索引', content: `# 来源索引\n\n${sourced.map((n) => `- [[${n.title}]] · ${n.source}`).join('\n') || '暂无来源记录。'}` }
  }
  if (id === 'timeline') return { kind: 'document', title: '便签时间线', content: `# 便签时间线\n\n${[...live].sort((a, b) => b.createdAt - a.createdAt).map((n) => `- ${new Date(n.createdAt).toLocaleDateString('zh-CN')} · [[${n.title}]]`).join('\n')}` }
  if (id === 'star-index') return { kind: 'document', title: '收藏合集', content: listReport('收藏合集', live.filter((n) => n.starred)) }
  if (id === 'later-index') return { kind: 'document', title: '稍后读合集', content: listReport('稍后读合集', live.filter((n) => n.later)) }
  if (id === 'words') {
    const words = (live.map((n) => `${n.title} ${n.md}`).join(' ').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,6}/g) || []).filter((w) => !['这个', '一个', '可以', '我们', '以及', '进行'].includes(w))
    const count = new Map<string, number>(); words.forEach((w) => count.set(w, (count.get(w) || 0) + 1))
    return { kind: 'report', title: '高频词', content: `# 高频词\n\n${[...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([w, n]) => `- ${w} · ${n}`).join('\n') || '内容不足。'}` }
  }
  if (id === 'reading') return { kind: 'report', title: '阅读时间', content: `# 阅读时间\n\n${[...live].sort((a, b) => b.md.length - a.md.length).map((n) => `- [[${n.title}]] · ${Math.max(1, Math.ceil(n.md.length / 400))} 分钟`).join('\n')}` }
  if (id === 'task-progress') {
    const all = live.flatMap((n) => [...n.md.matchAll(/^\s*- \[([ xX])\]\s+(.+)$/gm)].map((m) => m[1].toLowerCase() === 'x'))
    const done = all.filter(Boolean).length
    return { kind: 'report', title: '任务进度', content: `# 任务进度\n\n- 总任务：${all.length}\n- 已完成：${done}\n- 未完成：${all.length - done}\n- 完成率：${all.length ? Math.round(done / all.length * 100) : 0}%` }
  }
  if (id === 'lengths') {
    const short = live.filter((n) => n.md.length < 200).length, long = live.filter((n) => n.md.length >= 1000).length
    return { kind: 'report', title: '内容长度', content: `# 内容长度\n\n- 短便签（<200）：${short}\n- 中等（200-999）：${live.length - short - long}\n- 长文（≥1000）：${long}\n- 平均字数：${live.length ? Math.round(live.reduce((s, n) => s + n.md.length, 0) / live.length) : 0}` }
  }
  if (id === 'colors') {
    const count = new Map<string, number>(); live.forEach((n) => count.set(n.color, (count.get(n.color) || 0) + 1))
    return { kind: 'report', title: '配色分布', content: `# 配色分布\n\n${[...count.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `- ${c} · ${n}`).join('\n')}` }
  }
  if (id === 'activity') return { kind: 'report', title: '活跃周期', content: `# 活跃周期\n\n- 最近 7 天：${live.filter((n) => now - n.createdAt <= 7 * 86400_000).length}\n- 最近 30 天：${live.filter((n) => now - n.createdAt <= 30 * 86400_000).length}\n- 最近 90 天：${live.filter((n) => now - n.createdAt <= 90 * 86400_000).length}\n- 全部：${live.length}` }
  if (id === 'json') return { kind: 'export', title: '灵感便签备份', ext: 'json', content: JSON.stringify(live, null, 2) }
  if (id === 'csv') return { kind: 'export', title: '灵感便签清单', ext: 'csv', content: ['id,title,tags,color,source,createdAt,updatedAt,words', ...live.map((n) => [n.id, escCsv(n.title), escCsv(n.tags.join('|')), n.color, escCsv(n.source || ''), new Date(n.createdAt).toISOString(), new Date(n.updatedAt).toISOString(), n.md.length].join(','))].join('\n') }
  if (id === 'opml') return { kind: 'export', title: '灵感便签大纲', ext: 'opml', content: `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>灵感便签</title></head><body>${live.map((n) => `<outline text="${escXml(n.title)}" _note="${escXml(n.md)}"/>`).join('')}</body></opml>` }
  return { kind: 'report', title: '未知操作', content: '未找到对应工具。' }
}
