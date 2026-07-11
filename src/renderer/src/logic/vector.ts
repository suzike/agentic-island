// 向量检索基础：余弦相似度 + 文本哈希（缓存键）。纯逻辑，可 raw-node 直测。

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

/** djb2 文本哈希（稳定，用作向量缓存键） */
export function hashText(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 按与 query 向量的余弦相似度排序，取前 k 的索引 */
export function topKByCosine(query: number[], vecs: (number[] | undefined)[], k: number): number[] {
  return vecs
    .map((v, i) => ({ i, s: v ? cosine(query, v) : -1 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.i)
}
