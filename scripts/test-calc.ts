// 工程计算逐行求值单测。
// 运行：node --experimental-strip-types scripts/test-calc.ts

import { evalSheet } from '../src/renderer/src/logic/calc.ts'

let failed = 0
const ok = (c: boolean, m: string): void => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) failed++ }

const cells = evalSheet(['# 注释', '2 + 3 * 4', 'r = 2', 'area = PI * r**2', 'cToK(0)', 'avg(2,4,6)', '', '2 == 2', '1 / 0', 'nope +', 'sum.constructor("return globalThis")()'].join('\n'))

ok(cells[0].kind === 'comment' && cells[0].text === '注释', '注释行')
ok(cells[1].kind === 'result' && cells[1].result === '14', '表达式 2+3*4=14')
ok(cells[2].kind === 'result' && cells[2].name === 'r' && cells[2].result === '2', '赋值 r=2')
ok(cells[3].name === 'area' && Number(cells[3].result).toFixed(4) === '12.5664', '变量贯穿 area=PI*r^2')
ok(cells[4].result === '273.15', '温度助手 cToK(0)')
ok(cells[5].result === '4', 'avg 助手')
ok(cells[6].kind === 'blank', '空行')
ok(cells[7].kind === 'result' && cells[7].name === undefined && cells[7].result === 'true', '== 不误判为赋值（作为表达式求值）')
ok(cells[8].result === 'Infinity', '1/0=Infinity')
ok(cells[9].kind === 'error', '语法错→error 不炸整表')
ok(cells[10].kind === 'error', '禁止通过函数 constructor 逃逸到全局对象')

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 个失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
