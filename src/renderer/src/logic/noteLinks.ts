// 便签双向链接：解析正文里的 [[标题]]，构建笔记关系图（节点 + 边）。纯逻辑，可 raw-node 直测。

import type { StickyNote } from '../types'

/** 提取正文中的所有 [[标题]] 目标（去重、去空白） */
export function extractLinks(md: string): string[] {
  const out = new Set<string>()
  for (const m of md.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const t = m[1].trim()
    if (t) out.add(t)
  }
  return [...out]
}

export interface NoteGraph {
  nodes: { id: number; title: string; color: string; deg: number }[]
  edges: { from: number; to: number }[]
}

/** 构建关系图：仅纳入有出链或被链接的笔记，标题按大小写不敏感匹配 */
export function buildGraph(notes: StickyNote[]): NoteGraph {
  const byTitle = new Map<string, StickyNote>()
  for (const n of notes) if (n.title.trim()) byTitle.set(n.title.trim().toLowerCase(), n)

  const edges: { from: number; to: number }[] = []
  const deg = new Map<number, number>()
  const bump = (id: number): void => { deg.set(id, (deg.get(id) || 0) + 1) }

  for (const n of notes) {
    for (const link of extractLinks(n.md)) {
      const target = byTitle.get(link.toLowerCase())
      if (target && target.id !== n.id) {
        edges.push({ from: n.id, to: target.id })
        bump(n.id); bump(target.id)
      }
    }
  }
  const involved = new Set<number>()
  for (const e of edges) { involved.add(e.from); involved.add(e.to) }
  const nodes = notes
    .filter((n) => involved.has(n.id))
    .map((n) => ({ id: n.id, title: n.title || '无题', color: n.color, deg: deg.get(n.id) || 0 }))
  return { nodes, edges }
}

/** 反向链接：哪些笔记链接到了 title */
export function backlinks(notes: StickyNote[], title: string): StickyNote[] {
  const t = title.trim().toLowerCase()
  if (!t) return []
  return notes.filter((n) => extractLinks(n.md).some((l) => l.toLowerCase() === t))
}
