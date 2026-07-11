// 剪贴板 AI 聚类：把散落的收藏片段按主题聚成若干集，返回 {组名 → 条目 id}。

export const CLUSTER_SYSTEM =
  '你是整理助手。用户给出若干剪贴板片段（带 id）。请按主题把它们聚成 2-6 个有意义的集合，' +
  '每个集合起一个简短中文名（≤8 字）。只输出 JSON：{"groups":[{"name":"组名","ids":[1,2]}]}，不要多余文字。每个 id 只归一个组。'

export function clusterPrompt(items: { id: number; text: string }[]): string {
  const body = items.map((it) => `#${it.id}: ${it.text.replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')
  return `请对以下 ${items.length} 个片段聚类：\n${body}`
}

export interface ClipGroup {
  name: string
  ids: number[]
}

export function parseClusters(raw?: string): ClipGroup[] | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s !== -1 && e !== -1) t = t.slice(s, e + 1)
  try {
    const obj = JSON.parse(t) as { groups?: { name?: unknown; ids?: unknown }[] }
    if (!Array.isArray(obj.groups)) return null
    const groups = obj.groups
      .map((g) => ({
        name: typeof g.name === 'string' ? g.name : '未命名',
        ids: Array.isArray(g.ids) ? g.ids.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : []
      }))
      .filter((g) => g.ids.length)
    return groups.length ? groups : null
  } catch {
    return null
  }
}
