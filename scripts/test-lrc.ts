// LRC 解析单测：时间标签解析、多标签同行、当前行选取。
// 运行：node --experimental-strip-types scripts/test-lrc.ts

import { parseLrc, currentLine } from '../src/renderer/src/logic/lrc.ts'

let failed = 0
const ok = (c: boolean, m: string): void => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) failed++ }

const lrc = ['[ti:Demo]', '[00:01.00]第一句', '[00:05.50]第二句', '[00:10.00][00:20.00]副歌', '[bad]忽略'].join('\n')
const lines = parseLrc(lrc)
ok(lines.length === 4, `解析出 4 行（含重复标签展开），实际 ${lines.length}`)
ok(lines[0].t === 1 && lines[0].text === '第一句', '首行时间/文本')
ok(lines[1].t === 5.5, '小数秒解析 5.5')
ok(lines.filter((l) => l.text === '副歌').length === 2, '同行多标签各生成一行')
ok(lines[lines.length - 1].t === 20, '整体按时间升序')

ok(currentLine(lines, 0) === '', '开头前无当前行')
ok(currentLine(lines, 3) === '第一句', '3s → 第一句')
ok(currentLine(lines, 6) === '第二句', '6s → 第二句')
ok(currentLine(lines, 25) === '副歌', '25s → 副歌')
ok(currentLine([], 5) === '', '空歌词安全')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
