// 向量检索基础单测：余弦、哈希稳定性、topK。
// 运行：node --experimental-strip-types scripts/test-vector.ts

import { cosine, hashText, topKByCosine } from '../src/renderer/src/logic/vector.ts'

let failed = 0
const ok = (c: boolean, m: string): void => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) failed++ }

ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9, '同向 → 1')
ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9, '正交 → 0')
ok(Math.abs(cosine([1, 1], [2, 2]) - 1) < 1e-9, '共线 → 1（与模长无关）')
ok(cosine([], []) === 0, '空向量安全')

ok(hashText('灵动岛') === hashText('灵动岛'), '哈希稳定')
ok(hashText('a') !== hashText('b'), '不同文本不同哈希')

const q = [1, 0, 0]
const vecs = [[0, 1, 0], [0.9, 0.1, 0], undefined, [1, 0, 0]]
ok(JSON.stringify(topKByCosine(q, vecs, 2)) === JSON.stringify([3, 1]), 'topK 按相似度排序、跳过缺失向量')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
