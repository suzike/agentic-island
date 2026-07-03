// noteAi 解析器单测：AI 便签 JSON 解析（含围栏/坏输入）与搜索 id 解析。
// 运行：node --experimental-strip-types scripts/test-notes.ts

import { parseAiNote, parseSearchIds, NOTE_COLORS, colorOf } from '../src/renderer/src/logic/noteAi.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}

// 围栏包裹的标准返回
const good = parseAiNote('```json\n{"emoji":"🚀","title":"WebSocket 心跳设计","md":"**核心**\\n\\n- 要点一\\n- 要点二","tags":["网络","架构"],"color":"sky"}\n```')
ok(!!good && good.title === 'WebSocket 心跳设计', '标准 JSON 解析')
ok(good?.color === 'sky' && good?.emoji === '🚀', 'color/emoji 正确')
ok(good?.tags.length === 2, 'tags 解析')

// 前后带废话
const noisy = parseAiNote('好的，这是整理结果：{"emoji":"💡","title":"T","md":"内容","tags":["a"],"color":"amber"} 希望有帮助')
ok(!!noisy && noisy.title === 'T' && noisy.color === 'amber', '带废话包裹仍可解析')

// 非法 color 回退
const badColor = parseAiNote('{"emoji":"x","title":"T","md":"m","tags":[],"color":"rainbow"}')
ok(badColor?.color === 'emerald', '非法 color 回退 emerald')

// 坏输入
ok(parseAiNote('完全不是 JSON') === null, '坏输入返回 null')
ok(parseAiNote('{"title":"没有md"}') === null, '缺 md 返回 null')

// 搜索 id
ok(parseSearchIds('结果：[3, 1, 8]')?.join() === '3,1,8', '搜索 id 解析')
ok(parseSearchIds('[]')?.length === 0, '空数组')
ok(parseSearchIds('没有数组') === null, '无数组返回 null')

// 配色盘
ok(NOTE_COLORS.length === 8 && colorOf('violet') === 300 && colorOf('不存在') === 155, '配色盘与回退')

console.log(failed === 0 ? '\n✅ noteAi 全部通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
