// 工程计算 Notebook：逐行求值，变量跨行贯穿。纯逻辑，可 raw-node 直测。
// 本地自用、只跑用户自己输入的表达式，故用 Function 求值（非远程代码）。

/** 求值作用域：Math 全量 + 工程助手 + 常量 */
export function makeScope(): Record<string, unknown> {
  const s: Record<string, unknown> = {}
  for (const k of Object.getOwnPropertyNames(Math)) s[k] = (Math as unknown as Record<string, unknown>)[k]
  Object.assign(s, {
    round: (x: number, n = 2): number => Number(Number(x).toFixed(n)),
    rad: (d: number): number => (d * Math.PI) / 180,
    deg: (r: number): number => (r * 180) / Math.PI,
    cToK: (c: number): number => c + 273.15,
    kToC: (k: number): number => k - 273.15,
    cToF: (c: number): number => (c * 9) / 5 + 32,
    fToC: (f: number): number => ((f - 32) * 5) / 9,
    sum: (...a: number[]): number => a.flat(Infinity as number).reduce((x, y) => x + Number(y), 0),
    avg: (...a: number[]): number => { const f = a.flat(Infinity as number); return f.reduce((x, y) => x + Number(y), 0) / (f.length || 1) },
    G: 9.80665, // 重力加速度
    TAU: Math.PI * 2,
    Infinity,
    NaN
  })
  return s
}

export type CellKind = 'blank' | 'comment' | 'result' | 'error'
export interface Cell { kind: CellKind; text: string; result?: string; name?: string }

const fmt = (v: unknown): string => {
  if (typeof v === 'number') return Number.isFinite(v) ? String(+Number(v).toPrecision(10)) : String(v)
  if (typeof v === 'function') return 'ƒ'
  if (v === undefined) return ''
  try { return typeof v === 'object' ? JSON.stringify(v) : String(v) } catch { return String(v) }
}

const BLOCKED_IDENTIFIERS = new Set([
  'constructor', 'prototype', '__proto__', 'globalThis', 'window', 'document',
  'Function', 'eval', 'import', 'require', 'process', 'this', 'self', 'top', 'parent'
])

function assertSafeExpr(expr: string, scope: Record<string, unknown>): void {
  if (expr.length > 2000) throw new Error('表达式过长')
  if (!/^[\w$+\-*/%().,\s<>=!&|?:]+$/.test(expr)) throw new Error('表达式包含不允许的字符')
  if (/[A-Za-z_$][\w$]*\s*\./.test(expr) || /\)\s*\./.test(expr)) throw new Error('表达式不允许成员访问')
  const names = expr.match(/[A-Za-z_$][\w$]*/g) || []
  const allowed = new Set(Object.keys(scope))
  for (const name of names) {
    if (name === 'true' || name === 'false') continue
    if (BLOCKED_IDENTIFIERS.has(name) || !allowed.has(name)) throw new Error(`未知或不允许的标识符：${name}`)
  }
}

/** 求值一整张表：每行一格；赋值行 (x = ...) 写入作用域并显示值 */
export function evalSheet(text: string): Cell[] {
  const scope = makeScope()
  return text.split('\n').map((raw): Cell => {
    const line = raw.trim()
    if (!line) return { kind: 'blank', text: raw }
    if (/^(#|\/\/)/.test(line)) return { kind: 'comment', text: line.replace(/^(#|\/\/)\s?/, '') }
    const asg = line.match(/^([a-zA-Z_$][\w$]*)\s*=\s*(.+)$/)
    const isAssign = !!asg && !asg[2].startsWith('=') // 排除 ==
    const expr = isAssign ? asg![2] : line
    try {
      if (isAssign && BLOCKED_IDENTIFIERS.has(asg![1])) throw new Error(`不允许赋值给：${asg![1]}`)
      assertSafeExpr(expr, scope)
      const keys = Object.keys(scope)
      const fn = new Function(...keys, `"use strict"; return (${expr})`)
      const val = fn(...keys.map((k) => scope[k]))
      if (isAssign) scope[asg![1]] = val
      return { kind: 'result', text: raw, result: fmt(val), name: isAssign ? asg![1] : undefined }
    } catch (e) {
      return { kind: 'error', text: raw, result: e instanceof Error ? e.message : '错误' }
    }
  })
}
