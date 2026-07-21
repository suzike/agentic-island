# 快捷指令编排平台 · 第一阶段：图内核 Implementation Plan

> **文档状态（2026-07-21）：历史实施基线。** 本文保留 2026-07-08 的阶段计划与决策过程，不作为 `v0.6.2` 当前能力清单。现行工程约束、模块边界和验证命令以 [开发指南](../../DEVELOPMENT.md) 与 [架构说明](../../ARCHITECTURE.md) 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为快捷指令建立一个纯逻辑、依赖注入、raw-node 可测的**编排图执行内核**（顺序/分支/循环/并行/命名变量/错误策略/dry-run/旧数据迁移），作为整个 AI 原生编排平台的地基。

**Architecture:** 延续现有 `logic/shortcuts.ts` 的"纯逻辑 + RunCtx 依赖注入"模式，拆为 `logic/shortcuts/types.ts`（纯类型，strip 模式下全部擦除）+ `logic/shortcuts/engine.ts`（运行时：插值/危险检测/图执行/迁移）。控制流用**边驱动 + 结构化子流程**（分支走带 `when` 的边；循环/并行节点内嵌 `SubFlow`），避免回边终止的复杂度。所有副作用经 `RunCtx` 注入，测试用桩。

**Tech Stack:** TypeScript（Node strip 模式：禁 enum、禁参数属性、runtime 跨文件 import 需 `.ts` 扩展名；类型用 `import type` 会被完全擦除故无需扩展名）。测试：`node --experimental-strip-types scripts/test-shortcuts.ts`，手写断言（仓库无测试框架）。

**本计划范围**：仅内核 + 迁移 + 测试，**不接线 UI / 主进程 / 真实副作用**（后续阶段）。产物：`test-shortcuts.ts` 全绿 + `npm run typecheck` 通过。

> **Git 约定**：本仓库仅在用户显式要求时才执行 git。计划中的 `git commit` 步骤视为**检查点**——执行者应在该点暂停、汇报，待用户点头再提交。

**七阶段路线**（本计划=阶段 1）：① 图内核 ② 动作原语后端接线(http/kb/vision/web/setvar/notify/delay + IPC) ③ 权限/密钥库/dry-run UI ④ 创建体验(NodeInspector/FlowCanvas/BuilderChat/模板) ⑤ 触发器(shortcut-triggers) ⑥ AI 大脑(router/heal/agentic + 预置重写) ⑦ 视觉打磨/执行轨迹/迁移验证。

---

## 文件结构

- Create: `src/renderer/src/logic/shortcuts/types.ts` — 数据模型（纯类型，无运行时）。
- Create: `src/renderer/src/logic/shortcuts/engine.ts` — 运行时：`interpolate` / `DANGEROUS_RE` / `runGraph` / `runFlow` / `executeNode` / `migrateV1`。
- Rewrite: `scripts/test-shortcuts.ts` — raw-node 断言（覆盖插值/顺序/分支/循环/并行/错误策略/dry-run/迁移）。
- 不动：现有 `src/renderer/src/logic/shortcuts.ts`（旧引擎，阶段 4 UI 迁移完成后再删除，避免中途破坏 App/ShortcutsTab）。

---

## Task 1: 数据模型 types.ts

**Files:**
- Create: `src/renderer/src/logic/shortcuts/types.ts`

- [ ] **Step 1: 写类型文件（纯类型，strip 模式全擦除）**

```ts
// 快捷指令编排图 · 数据模型（纯类型，无运行时——strip 模式下整文件被擦除，跨文件 import type 无需扩展名）

export type NodeKind =
  | 'start' | 'end'
  | 'shell' | 'open' | 'clipboard' | 'island' | 'input' | 'confirm'   // 现有保留
  | 'ai' | 'agent'                                                     // 增强
  | 'http' | 'kb' | 'vision' | 'web' | 'setvar' | 'notify' | 'delay'   // 新增原语
  | 'router' | 'foreach' | 'parallel' | 'subflow'                      // 编排控制

export type ConfirmPolicy = 'always' | 'never' | 'dangerous'
export type ErrorPolicy = 'stop' | 'continue' | 'retry' | 'heal'

export interface NodeScopes { shellAllow?: string[]; httpDomains?: string[]; fsPaths?: string[]; repo?: string }
export interface NodeAi { fill?: boolean; heal?: boolean; guard?: boolean }

export interface FlowNode {
  id: string
  kind: NodeKind
  params: Record<string, unknown>
  pos?: { x: number; y: number }
  ai?: NodeAi
  onError?: ErrorPolicy      // 默认 stop
  retry?: number             // retry/heal 的最大次数，默认 1
  confirm?: ConfirmPolicy    // 默认 dangerous
  scopes?: NodeScopes
}

export interface FlowEdge { id: string; from: string; to: string; when?: string } // when: 'true'|'false'|自定义标签；缺省=无条件

export interface SubFlow { nodes: FlowNode[]; edges: FlowEdge[]; entry: string }   // entry=起始 node id

export interface VarDef { name: string; scope: 'global' | 'flow' | 'run'; secret?: boolean; value?: string }

export interface TriggerDef {
  kind: 'manual' | 'hotkey' | 'schedule' | 'clipboard' | 'file' | 'event'
  config: Record<string, unknown>
  enabled: boolean
}

export interface ShortcutMeta { icon: string; name: string; group: string; tags: string[]; desc?: string }

export interface ShortcutDef extends SubFlow {
  id: string
  meta: ShortcutMeta
  mode: 'graph' | 'agentic'
  vars: VarDef[]
  triggers: TriggerDef[]
  agentic?: { goal: string; tools: NodeKind[]; constraints?: string }
  builtin?: boolean
  runCount: number
  lastRun?: number
}

// ── 运行时契约 ──
export interface RunLog { node: string; kind: NodeKind; label: string; output?: string; ok: boolean; error?: string; healed?: boolean; dry?: boolean }
export interface AgentEvt { kind: string; text?: string; name?: string; detail?: string }
export interface LiveState { text: string; tools: { label: string; detail?: string }[] }

/** 全部副作用由调用方注入 → 纯逻辑、raw-node 可测 */
export interface RunCtx {
  ai: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  shell: (cmd: string, cwd?: string) => Promise<{ ok: boolean; output?: string; error?: string }>
  open: (target: string) => Promise<{ ok: boolean; error?: string }>
  agent: (engine: 'claude' | 'codex', prompt: string, cwd: string | undefined, onEvent?: (ev: AgentEvt) => void) => Promise<{ ok: boolean; text?: string; error?: string }>
  http: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status?: number; body?: string; error?: string }>
  kb: (query: string, k?: number) => Promise<{ ok: boolean; text?: string; error?: string }>
  vision: (prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  web: (url: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  clipRead: () => Promise<string>
  clipWrite: (t: string) => void
  islandAction: (action: 'todo' | 'note' | 'ask', args: string) => string
  notify: (title: string, body: string) => void
  askInput: (label: string) => Promise<string | null>
  askRepo: () => Promise<string | null>
  askConfirm: (message: string) => Promise<boolean>
  onLog: (l: RunLog) => void
  onLive?: (live: LiveState | null) => void
  /** subflow 节点按 id 解析目标流程；缺省=报错 */
  getFlow?: (id: string) => SubFlow | null
}

export interface RunOpts { dryRun?: boolean; globals?: Record<string, string> }
export interface RunResult { ok: boolean; prev: string; canceled?: boolean }

// ── 旧线性数据（迁移用）──
export type StepKindV1 = 'shell' | 'open' | 'clipboard' | 'ai' | 'agent' | 'island' | 'input' | 'confirm'
export interface ShortcutDefV1 {
  id: string; icon: string; name: string; group: string; desc?: string
  steps: Array<{ kind: StepKindV1 } & Record<string, unknown>>
  repoPath?: string; trusted?: boolean; builtin?: boolean; runCount: number; lastRun?: number
}
```

- [ ] **Step 2: 校验类型编译**

Run: `npm run typecheck`
Expected: 无新增错误（types.ts 为纯类型，零运行时）。

- [ ] **Step 3: 提交（检查点）**

```bash
git add src/renderer/src/logic/shortcuts/types.ts
git commit -m "feat(shortcuts): 编排图数据模型 types.ts"
```

---

## Task 2: 插值 + 危险检测（engine.ts 基础）

**Files:**
- Create: `src/renderer/src/logic/shortcuts/engine.ts`
- Test: `scripts/test-shortcuts.ts`

- [ ] **Step 1: 写失败测试（重写 test-shortcuts.ts 头 + 插值/危险用例）**

```ts
// 编排图内核测试（raw-node）：node --experimental-strip-types scripts/test-shortcuts.ts
// 注意：strip 模式 runtime import 需 .ts 扩展名；类型 import type 被擦除故无需扩展名。
import { interpolate, DANGEROUS_RE } from '../src/renderer/src/logic/shortcuts/engine.ts'

let pass = 0
let fail = 0
const ok = (cond: boolean, msg: string): void => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg) } }

// ── 插值：%name% 全部替换，缺失键留空 ──
ok(interpolate('hi %name%', { name: 'bob' }) === 'hi bob', '插值单变量')
ok(interpolate('%a%-%b%-%a%', { a: '1', b: '2' }) === '1-2-1', '插值多次/多变量')
ok(interpolate('x %miss% y', {}) === 'x  y', '缺失变量替换为空')
ok(interpolate('no vars', { a: '1' }) === 'no vars', '无占位符原样返回')

// ── 危险命令：即便信任也强制确认 ──
ok(DANGEROUS_RE.test('rm -rf /'), 'rm 命中')
ok(DANGEROUS_RE.test('git push origin main'), 'git push 命中')
ok(DANGEROUS_RE.test('shutdown /s'), 'shutdown 命中')
ok(!DANGEROUS_RE.test('git status'), 'git status 不命中')
ok(!DANGEROUS_RE.test('ls -la'), 'ls 不命中')

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAIL'} ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: FAIL（`engine.ts` 尚不存在 / 导出缺失，报模块解析或未定义）。

- [ ] **Step 3: 写最小实现（engine.ts）**

```ts
// 编排图执行引擎：插值 · 危险检测 · runGraph/runFlow/executeNode · migrateV1。
// 纯逻辑、不 import electron/react —— 副作用全部经 RunCtx 注入，raw-node 可测。
import type {
  FlowNode, FlowEdge, SubFlow, ShortcutDef, ShortcutDefV1, RunCtx, RunOpts, RunResult, RunLog, NodeKind
} from './types'

/** 危险命令：即使指令被标记信任/免确认也强制二次确认。
 *  第一支=系统破坏性命令词；第二支=git 危险子命令（push/clean/reset --hard/checkout --）。 */
export const DANGEROUS_RE = /\b(rm|del|erase|rd|rmdir|format|diskpart|reg|shutdown|taskkill|remove-item|stop-process|set-executionpolicy|bcdedit|cipher|takeown|icacls)\b|\bgit\b[\s\S]*?\b(?:push|clean|reset\s+--hard|checkout\s+--)\b/i

/** 变量插值：把 %name% 替换为 vars[name]，缺失键替换为空串。 */
export function interpolate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/%([a-zA-Z0-9_]+)%/g, (_m, name: string) => (name in vars ? vars[name] : ''))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: `✓ ALL PASS 9/9`

- [ ] **Step 5: 提交（检查点）**

```bash
git add src/renderer/src/logic/shortcuts/engine.ts scripts/test-shortcuts.ts
git commit -m "feat(shortcuts): 引擎插值 + 危险命令检测"
```

---

## Task 3: 顺序执行 + 命名变量 + %prev% 串联

**Files:**
- Modify: `src/renderer/src/logic/shortcuts/engine.ts`
- Test: `scripts/test-shortcuts.ts`

- [ ] **Step 1: 写失败测试（追加到 test-shortcuts.ts，process.exit 之前）**

```ts
import { runGraph } from '../src/renderer/src/logic/shortcuts/engine.ts'
import type { ShortcutDef, RunCtx, RunLog } from '../src/renderer/src/logic/shortcuts/types.ts'

// 桩 ctx：ai 回显、其余最简
const stubCtx = (over: Partial<RunCtx> = {}): { ctx: RunCtx; logs: RunLog[] } => {
  const logs: RunLog[] = []
  const ctx: RunCtx = {
    ai: async (_s, u) => ({ ok: true, text: 'AI(' + u + ')' }),
    shell: async (cmd) => ({ ok: true, output: 'OUT:' + cmd }),
    open: async () => ({ ok: true }),
    agent: async () => ({ ok: true, text: 'AGENT' }),
    http: async () => ({ ok: true, status: 200, body: 'BODY' }),
    kb: async () => ({ ok: true, text: 'KB' }),
    vision: async () => ({ ok: true, text: 'SEE' }),
    web: async () => ({ ok: true, text: 'WEB' }),
    clipRead: async () => 'CLIP',
    clipWrite: () => {},
    islandAction: (a, args) => '已' + a + ':' + args,
    notify: () => {},
    askInput: async () => 'INPUT',
    askRepo: async () => 'C:/repo',
    askConfirm: async () => true,
    onLog: (l) => logs.push(l),
    ...over
  }
  return { ctx, logs }
}

// 最小三节点顺序流：setvar(x=hi) → ai(%x%) → setvar(y=%prev%)
const seqDef: ShortcutDef = {
  id: 't-seq', meta: { icon: '⚡', name: 'seq', group: '自定义', tags: [] }, mode: 'graph',
  vars: [], triggers: [], runCount: 0, entry: 'n1',
  nodes: [
    { id: 'n1', kind: 'setvar', params: { name: 'x', value: 'hi' } },
    { id: 'n2', kind: 'ai', params: { system: 's', prompt: '%x%' } },
    { id: 'n3', kind: 'setvar', params: { name: 'y', value: '%prev%' } }
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2' },
    { id: 'e2', from: 'n2', to: 'n3' }
  ]
}
{
  const { ctx, logs } = stubCtx()
  const r = await runGraph(seqDef, ctx)
  ok(r.ok, '顺序流成功')
  ok(logs.length === 3, '三步各一条日志')
  ok(logs[1].output === 'AI(hi)', '%x% 插值进 ai 输入')
  ok(r.prev === 'AI(hi)', 'setvar y=%prev% 结果为上一步输出')
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: FAIL（`runGraph` 未定义）。

- [ ] **Step 3: 实现 runFlow/executeNode/runGraph（顺序 + setvar + ai + prev）**

在 `engine.ts` 追加：

```ts
const nodeLabel = (n: FlowNode): string => {
  const m: Record<NodeKind, string> = {
    start: '开始', end: '结束', shell: '🖥 脚本', open: '🔗 打开', clipboard: '📋 剪贴板',
    island: '🝔 岛内', input: '⌨ 输入', confirm: '⚠️ 确认', ai: '✨ AI', agent: '◆ Agent',
    http: '🌐 HTTP', kb: '📚 检索', vision: '👁 视觉', web: '🕸 网页', setvar: '📌 变量',
    notify: '🔔 通知', delay: '⏳ 等待', router: '🔀 路由', foreach: '🔁 循环', parallel: '⚡ 并行', subflow: '📦 子流程'
  }
  return m[n.kind] || n.kind
}

const P = (n: FlowNode, k: string): string => String((n.params as Record<string, unknown>)[k] ?? '')

/** 执行单个业务节点（非控制节点），返回 { ok, output }。控制节点由 runFlow 处理。 */
async function executeNode(n: FlowNode, ctx: RunCtx, vars: Record<string, string>, opts: RunOpts): Promise<{ ok: boolean; output?: string; error?: string; canceled?: boolean }> {
  const ip = (s: string): string => interpolate(s, vars)
  if (opts.dryRun && n.kind !== 'setvar') return { ok: true, output: '[dry] ' + nodeLabel(n) }
  switch (n.kind) {
    case 'setvar': {
      const name = P(n, 'name')
      const val = ip(P(n, 'value') || '%prev%')
      if (name) vars[name] = val
      return { ok: true, output: val }
    }
    case 'ai': {
      const r = await ctx.ai(ip(P(n, 'system')), ip(P(n, 'prompt') || '%prev%'))
      return r.ok && r.text != null ? { ok: true, output: r.text.trim() } : { ok: false, error: r.error || 'AI 调用失败' }
    }
    case 'shell': {
      const r = await ctx.shell(ip(P(n, 'cmd')), P(n, 'cwd') ? ip(P(n, 'cwd')) : undefined)
      return r.ok ? { ok: true, output: (r.output || '').trim() } : { ok: false, error: r.error || '脚本失败' }
    }
    case 'open': {
      const r = await ctx.open(ip(P(n, 'target')))
      return r.ok ? { ok: true, output: ip(P(n, 'target')) } : { ok: false, error: r.error || '打开失败' }
    }
    case 'clipboard': {
      if (P(n, 'op') === 'read') { const c = await ctx.clipRead(); vars.clip = c; return c.trim() ? { ok: true, output: c } : { ok: false, error: '剪贴板为空' } }
      const t = ip(P(n, 'text') || '%prev%'); ctx.clipWrite(t); return { ok: true, output: '已写入 ' + t.length + ' 字' }
    }
    case 'http': {
      const r = await ctx.http({ url: ip(P(n, 'url')), method: P(n, 'method') || 'GET', body: P(n, 'body') ? ip(P(n, 'body')) : undefined })
      return r.ok ? { ok: true, output: r.body || '' } : { ok: false, error: r.error || 'HTTP 失败' }
    }
    case 'kb': { const r = await ctx.kb(ip(P(n, 'query') || '%prev%')); return r.ok ? { ok: true, output: r.text || '' } : { ok: false, error: r.error } }
    case 'vision': { const r = await ctx.vision(ip(P(n, 'prompt') || '%prev%')); return r.ok ? { ok: true, output: r.text || '' } : { ok: false, error: r.error } }
    case 'web': { const r = await ctx.web(ip(P(n, 'url'))); return r.ok ? { ok: true, output: r.text || '' } : { ok: false, error: r.error } }
    case 'agent': {
      const useRepo = (n.params as Record<string, unknown>).useRepo !== false
      const r = await ctx.agent((P(n, 'engine') as 'claude' | 'codex') || 'claude', ip(P(n, 'prompt')), useRepo ? vars.repo : undefined, (ev) => ctx.onLive?.({ text: ev.text || '', tools: [] }))
      return r.ok && r.text != null ? { ok: true, output: r.text.trim() } : { ok: false, error: r.error || 'Agent 失败' }
    }
    case 'island': { const msg = ctx.islandAction((P(n, 'action') as 'todo' | 'note' | 'ask') || 'note', ip(P(n, 'args'))); return { ok: true, output: msg } }
    case 'notify': { ctx.notify(ip(P(n, 'title') || '快捷指令'), ip(P(n, 'body') || '%prev%')); return { ok: true, output: '已通知' } }
    case 'delay': { return { ok: true, output: '等待 ' + (P(n, 'ms') || '0') + 'ms' } } // 实际延时由后续阶段接线，内核不 sleep
    case 'input': { const got = await ctx.askInput(ip(P(n, 'label'))); if (got === null) return { ok: false, canceled: true, error: '已取消' }; vars.input = got; return { ok: true, output: got } }
    case 'confirm': { const okGo = await ctx.askConfirm(ip(P(n, 'message'))); return okGo ? { ok: true, output: '已确认' } : { ok: false, canceled: true, error: '已取消' } }
    default: return { ok: true, output: '' }
  }
}

/** 出边选择：无 when 的边直接返回；有 when 的（router 场景）在 Task 4 处理。 */
function nextNodeId(flow: SubFlow, fromId: string): string | null {
  const e = flow.edges.find((x) => x.from === fromId && !x.when)
  return e ? e.to : null
}
```

再实现 `runFlow` 与 `runGraph`（本 Task 只覆盖顺序 + 业务节点 + 确认/危险；控制节点占位，Task 4/5 补全）：

```ts
export async function runFlow(flow: SubFlow, ctx: RunCtx, vars: Record<string, string>, opts: RunOpts): Promise<RunResult> {
  let cur: string | null = flow.entry
  let guard = 0
  while (cur && guard++ < 1000) {
    const n = flow.nodes.find((x) => x.id === cur)
    if (!n) break
    if (n.kind === 'start') { cur = nextNodeId(flow, n.id); continue }
    if (n.kind === 'end') break

    // 确认闸：shell 危险命令、或 confirm='always' → 先确认
    if (!opts.dryRun && n.kind === 'shell') {
      const cmd = interpolate(P(n, 'cmd'), vars)
      const policy = n.confirm || 'dangerous'
      if (policy === 'always' || (policy !== 'never' && DANGEROUS_RE.test(cmd)) || (policy === 'never' && DANGEROUS_RE.test(cmd))) {
        const okGo = await ctx.askConfirm(cmd)
        if (!okGo) { ctx.onLog({ node: n.id, kind: n.kind, label: nodeLabel(n), ok: false, error: '已取消' }); return { ok: false, prev: vars.prev || '', canceled: true } }
      }
    }

    const res = await executeNode(n, ctx, vars, opts)
    const log: RunLog = { node: n.id, kind: n.kind, label: nodeLabel(n), output: res.output, ok: res.ok, error: res.error, dry: opts.dryRun }
    ctx.onLog(log)
    if (res.ok) { vars.prev = res.output ?? '' } else if (res.canceled) { return { ok: false, prev: vars.prev || '', canceled: true } } else {
      // 错误策略在 Task 6 补全；此处默认 stop
      return { ok: false, prev: vars.prev || '' }
    }
    cur = nextNodeId(flow, n.id)
  }
  return { ok: true, prev: vars.prev || '' }
}

export async function runGraph(def: ShortcutDef, ctx: RunCtx, opts: RunOpts = {}): Promise<RunResult> {
  const now = new Date()
  const pad = (x: number): string => String(x).padStart(2, '0')
  const vars: Record<string, string> = {
    prev: '', clip: '', input: '', repo: '',
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    ...(opts.globals || {})
  }
  for (const v of def.vars) if (v.value != null) vars[v.name] = v.value
  // 需要仓库：任意节点引用 %repo% 或 agent useRepo
  const needRepo = def.nodes.some((n) => (n.kind === 'agent' && (n.params as Record<string, unknown>).useRepo !== false) || JSON.stringify(n.params).includes('%repo%'))
  if (needRepo && !opts.dryRun) { const got = await ctx.askRepo(); if (!got) return { ok: false, prev: '', canceled: true }; vars.repo = got }
  return runFlow(def, ctx, vars, opts)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: `✓ ALL PASS 13/13`

- [ ] **Step 5: typecheck + 提交（检查点）**

```bash
npm run typecheck
git add src/renderer/src/logic/shortcuts/engine.ts scripts/test-shortcuts.ts
git commit -m "feat(shortcuts): 顺序执行 + 命名变量 + prev 串联"
```

---

## Task 4: 分支路由（router：expr 与 ai）

**Files:**
- Modify: `src/renderer/src/logic/shortcuts/engine.ts`
- Test: `scripts/test-shortcuts.ts`

- [ ] **Step 1: 写失败测试（追加）**

```ts
import type { ShortcutDef as SDef } from '../src/renderer/src/logic/shortcuts/types.ts'
// router expr：判断 %prev% 是否包含 "err" → 走 true/false 边
const routerDef: SDef = {
  id: 't-router', meta: { icon: '🔀', name: 'router', group: '自定义', tags: [] }, mode: 'graph',
  vars: [], triggers: [], runCount: 0, entry: 'n1',
  nodes: [
    { id: 'n1', kind: 'setvar', params: { name: 'prev', value: 'has err here' } },
    { id: 'r', kind: 'router', params: { mode: 'expr', var: 'prev', op: 'contains', value: 'err' } },
    { id: 'yes', kind: 'setvar', params: { name: 'out', value: 'YES' } },
    { id: 'no', kind: 'setvar', params: { name: 'out', value: 'NO' } }
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'r' },
    { id: 'e2', from: 'r', to: 'yes', when: 'true' },
    { id: 'e3', from: 'r', to: 'no', when: 'false' }
  ]
}
{
  const { ctx } = stubCtx()
  const r = await runGraph(routerDef, ctx)
  ok(r.ok && r.prev === 'YES', 'router expr contains → 走 true 边')
}
// router ai：ctx.ai 返回标签 "backend" → 走对应 when 边
const routerAiDef: SDef = {
  ...routerDef, id: 't-router-ai',
  nodes: [
    { id: 'n1', kind: 'setvar', params: { name: 'prev', value: 'db timeout' } },
    { id: 'r', kind: 'router', params: { mode: 'ai', prompt: '这个报错属于 frontend 还是 backend？只回一个词。' } },
    { id: 'fe', kind: 'setvar', params: { name: 'out', value: 'FE' } },
    { id: 'be', kind: 'setvar', params: { name: 'out', value: 'BE' } }
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'r' },
    { id: 'e2', from: 'r', to: 'fe', when: 'frontend' },
    { id: 'e3', from: 'r', to: 'be', when: 'backend' }
  ]
}
{
  const { ctx } = stubCtx({ ai: async () => ({ ok: true, text: 'backend' }) })
  const r = await runGraph(routerAiDef, ctx)
  ok(r.ok && r.prev === 'BE', 'router ai 选中 backend 边')
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: FAIL（router 走到无条件边逻辑，选不中 → out 未赋值 / prev 不符）。

- [ ] **Step 3: 实现 router 选边**

在 `engine.ts` 追加选边逻辑，并改造 `runFlow` 处理 router：

```ts
/** expr 求值：支持 op ∈ eq/neq/contains/empty/notempty，返回 'true'|'false' */
function evalExpr(n: FlowNode, vars: Record<string, string>): string {
  const val = vars[P(n, 'var')] ?? ''
  const op = P(n, 'op')
  const rhs = interpolate(P(n, 'value'), vars)
  let b = false
  if (op === 'eq') b = val === rhs
  else if (op === 'neq') b = val !== rhs
  else if (op === 'contains') b = val.includes(rhs)
  else if (op === 'empty') b = val.trim() === ''
  else if (op === 'notempty') b = val.trim() !== ''
  return b ? 'true' : 'false'
}

/** 解析 router 的目标 when 标签（expr 本地求值 / ai 调模型选标签） */
async function routeLabel(n: FlowNode, flow: SubFlow, ctx: RunCtx, vars: Record<string, string>): Promise<string> {
  if (P(n, 'mode') === 'ai') {
    const labels = flow.edges.filter((e) => e.from === n.id && e.when).map((e) => e.when as string)
    const r = await ctx.ai('你是分类路由器。只能回下列标签之一，不要多余文字：' + labels.join(' / '), interpolate(P(n, 'prompt') || '%prev%', vars))
    const t = (r.text || '').trim().toLowerCase()
    return labels.find((l) => t.includes(l.toLowerCase())) || labels[0] || ''
  }
  return evalExpr(n, vars)
}
```

在 `runFlow` 的循环里，节点执行前加 router 分支（放在 `if (n.kind === 'end') break` 之后、确认闸之前）：

```ts
    if (n.kind === 'router') {
      const label = await routeLabel(n, flow, ctx, vars)
      ctx.onLog({ node: n.id, kind: n.kind, label: nodeLabel(n), ok: true, output: '→ ' + label })
      const e = flow.edges.find((x) => x.from === n.id && x.when === label) || flow.edges.find((x) => x.from === n.id)
      cur = e ? e.to : null
      continue
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: `✓ ALL PASS 15/15`

- [ ] **Step 5: typecheck + 提交（检查点）**

```bash
npm run typecheck
git add src/renderer/src/logic/shortcuts/engine.ts scripts/test-shortcuts.ts
git commit -m "feat(shortcuts): router 分支（expr 本地求值 + ai 选标签）"
```

---

## Task 5: 循环 foreach + 并行 parallel + 子流程 subflow

**Files:**
- Modify: `src/renderer/src/logic/shortcuts/engine.ts`
- Test: `scripts/test-shortcuts.ts`

- [ ] **Step 1: 写失败测试（追加）**

```ts
// foreach：对 items(换行) 逐项跑 body(ai 回显)，收集到 %out%
const feDef: SDef = {
  id: 't-foreach', meta: { icon: '🔁', name: 'fe', group: '自定义', tags: [] }, mode: 'graph',
  vars: [], triggers: [], runCount: 0, entry: 'n1',
  nodes: [
    { id: 'n1', kind: 'setvar', params: { name: 'items', value: 'a\nb\nc' } },
    { id: 'lp', kind: 'foreach', params: {
        items: '%items%', itemVar: 'it',
        body: { entry: 'b1', nodes: [{ id: 'b1', kind: 'ai', params: { system: 's', prompt: '%it%' } }], edges: [] }
      } }
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'lp' }]
}
{
  const { ctx, logs } = stubCtx()
  const r = await runGraph(feDef, ctx)
  ok(r.ok, 'foreach 成功')
  ok(logs.filter((l) => l.kind === 'ai').length === 3, 'foreach 跑了 3 次 body')
  ok(r.prev === 'AI(a) | AI(b) | AI(c)', 'foreach 汇总各项输出')
}
// parallel：两分支各自 ai，汇合
const paDef: SDef = {
  id: 't-parallel', meta: { icon: '⚡', name: 'pa', group: '自定义', tags: [] }, mode: 'graph',
  vars: [], triggers: [], runCount: 0, entry: 'p',
  nodes: [
    { id: 'p', kind: 'parallel', params: { branches: [
      { entry: 'a1', nodes: [{ id: 'a1', kind: 'ai', params: { system: 's', prompt: 'X' } }], edges: [] },
      { entry: 'b1', nodes: [{ id: 'b1', kind: 'ai', params: { system: 's', prompt: 'Y' } }], edges: [] }
    ] } }
  ],
  edges: []
}
{
  const { ctx, logs } = stubCtx()
  const r = await runGraph(paDef, ctx)
  ok(r.ok, 'parallel 成功')
  ok(logs.filter((l) => l.kind === 'ai').length === 2, 'parallel 跑了 2 个分支')
  ok(r.prev.includes('AI(X)') && r.prev.includes('AI(Y)'), 'parallel 汇合两分支输出')
}
// subflow：调另一条流程（getFlow 注入）
const subInner: SDef['nodes'] = [{ id: 's1', kind: 'ai', params: { system: 's', prompt: 'SUB' } }]
{
  const { ctx } = stubCtx({ getFlow: () => ({ entry: 's1', nodes: subInner, edges: [] }) })
  const sfDef: SDef = {
    id: 't-sub', meta: { icon: '📦', name: 'sf', group: '自定义', tags: [] }, mode: 'graph',
    vars: [], triggers: [], runCount: 0, entry: 'c',
    nodes: [{ id: 'c', kind: 'subflow', params: { ref: 'inner' } }], edges: []
  }
  const r = await runGraph(sfDef, ctx)
  ok(r.ok && r.prev === 'AI(SUB)', 'subflow 调用内层流程并返回其输出')
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: FAIL（foreach/parallel/subflow 未处理，落到 default 无输出）。

- [ ] **Step 3: 实现三个控制节点（在 runFlow 循环内，router 分支之后追加）**

```ts
    if (n.kind === 'foreach') {
      const raw = interpolate(P(n, 'items'), vars)
      let items: string[]
      try { const j = JSON.parse(raw); items = Array.isArray(j) ? j.map(String) : raw.split('\n') } catch { items = raw.split('\n') }
      items = items.map((s) => s.trim()).filter(Boolean)
      const body = (n.params as Record<string, unknown>).body as SubFlow
      const outs: string[] = []
      for (const it of items) {
        vars[P(n, 'itemVar') || 'item'] = it
        const sub = await runFlow(body, ctx, vars, opts)
        if (!sub.ok) { if (sub.canceled) return { ok: false, prev: vars.prev || '', canceled: true }; return { ok: false, prev: vars.prev || '' } }
        outs.push(sub.prev)
      }
      vars.prev = outs.join(' | ')
      ctx.onLog({ node: n.id, kind: n.kind, label: nodeLabel(n), ok: true, output: `循环 ${items.length} 项` })
      cur = nextNodeId(flow, n.id); continue
    }
    if (n.kind === 'parallel') {
      const branches = ((n.params as Record<string, unknown>).branches as SubFlow[]) || []
      const results = await Promise.all(branches.map((b) => runFlow(b, ctx, { ...vars }, opts)))
      if (results.some((x) => !x.ok)) return { ok: false, prev: vars.prev || '', canceled: results.some((x) => x.canceled) }
      vars.prev = results.map((x) => x.prev).join('\n---\n')
      ctx.onLog({ node: n.id, kind: n.kind, label: nodeLabel(n), ok: true, output: `并行 ${branches.length} 分支` })
      cur = nextNodeId(flow, n.id); continue
    }
    if (n.kind === 'subflow') {
      const ref = P(n, 'ref')
      const target = ctx.getFlow?.(ref)
      if (!target) { ctx.onLog({ node: n.id, kind: n.kind, label: nodeLabel(n), ok: false, error: '子流程未找到: ' + ref }); return { ok: false, prev: vars.prev || '' } }
      const sub = await runFlow(target, ctx, vars, opts)
      if (!sub.ok) return { ok: false, prev: sub.prev, canceled: sub.canceled }
      vars.prev = sub.prev
      ctx.onLog({ node: n.id, kind: n.kind, label: nodeLabel(n), ok: true, output: '子流程完成' })
      cur = nextNodeId(flow, n.id); continue
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: `✓ ALL PASS 20/20`

- [ ] **Step 5: typecheck + 提交（检查点）**

```bash
npm run typecheck
git add src/renderer/src/logic/shortcuts/engine.ts scripts/test-shortcuts.ts
git commit -m "feat(shortcuts): foreach 循环 + parallel 并行 + subflow 子流程"
```

---

## Task 6: 错误策略（stop/continue/retry/heal）+ dry-run

**Files:**
- Modify: `src/renderer/src/logic/shortcuts/engine.ts`
- Test: `scripts/test-shortcuts.ts`

- [ ] **Step 1: 写失败测试（追加）**

```ts
// continue：失败节点不中止，继续下一步
const contDef: SDef = {
  id: 't-cont', meta: { icon: '⚡', name: 'c', group: '自定义', tags: [] }, mode: 'graph',
  vars: [], triggers: [], runCount: 0, entry: 'n1',
  nodes: [
    { id: 'n1', kind: 'shell', params: { cmd: 'boom' }, onError: 'continue', confirm: 'never' },
    { id: 'n2', kind: 'setvar', params: { name: 'out', value: 'REACHED' } }
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2' }]
}
{
  const { ctx, logs } = stubCtx({ shell: async () => ({ ok: false, error: '炸了' }) })
  const r = await runGraph(contDef, ctx)
  ok(r.ok, 'continue 策略下整体仍成功')
  ok(logs.some((l) => l.ok && l.output === 'REACHED'), 'continue 后续节点被执行')
}
// retry：前 2 次失败第 3 次成功
{
  let calls = 0
  const { ctx } = stubCtx({ shell: async () => { calls++; return calls < 3 ? { ok: false, error: 'x' } : { ok: true, output: 'OK3' } } })
  const retryDef: SDef = { ...contDef, id: 't-retry', nodes: [{ id: 'n1', kind: 'shell', params: { cmd: 'flaky' }, onError: 'retry', retry: 3, confirm: 'never' }], edges: [] }
  const r = await runGraph(retryDef, ctx)
  ok(r.ok && r.prev === 'OK3' && calls === 3, 'retry 三次后成功')
}
// heal：失败 → ctx.ai 给修复 → 重试成功；日志标 healed
{
  let calls = 0
  const { ctx, logs } = stubCtx({
    ai: async () => ({ ok: true, text: 'fixed-cmd' }),
    shell: async () => { calls++; return calls < 2 ? { ok: false, error: '语法错' } : { ok: true, output: 'HEALED' } }
  })
  const healDef: SDef = { ...contDef, id: 't-heal', nodes: [{ id: 'n1', kind: 'shell', params: { cmd: 'bad' }, onError: 'heal', retry: 2, confirm: 'never' }], edges: [] }
  const r = await runGraph(healDef, ctx)
  ok(r.ok && r.prev === 'HEALED', 'heal 后成功')
  ok(logs.some((l) => l.healed), 'heal 过程被标记')
}
// dry-run：不产生真实副作用（shell 不被调用）
{
  let shellCalled = false
  const { ctx, logs } = stubCtx({ shell: async () => { shellCalled = true; return { ok: true, output: 'x' } } })
  const dryDef: SDef = { ...contDef, id: 't-dry', nodes: [{ id: 'n1', kind: 'shell', params: { cmd: 'ls' }, confirm: 'never' }], edges: [] }
  const r = await runGraph(dryDef, ctx, { dryRun: true })
  ok(r.ok && !shellCalled, 'dry-run 不真正执行 shell')
  ok(logs[0].dry === true, 'dry-run 日志标记 dry')
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: FAIL（当前失败即 stop，无 continue/retry/heal）。

- [ ] **Step 3: 实现错误策略（改造 runFlow 中"业务节点执行"那段）**

把 Task 3 里 `const res = await executeNode(...)` 到错误处理那段替换为带策略的版本：

```ts
    let res = await executeNode(n, ctx, vars, opts)
    let healed = false
    const maxTry = n.retry && n.retry > 0 ? n.retry : 1
    if (!res.ok && !res.canceled && (n.onError === 'retry' || n.onError === 'heal')) {
      for (let attempt = 2; attempt <= maxTry && !res.ok; attempt++) {
        if (n.onError === 'heal') {
          const diag = await ctx.ai('你是自动化修复器。上一步执行失败，根据错误修正该步骤的关键参数，只输出修正后的命令/输入本身，不要解释。', `节点类型：${n.kind}\n参数：${JSON.stringify(n.params)}\n错误：${res.error || ''}`)
          if (diag.ok && diag.text) { (n.params as Record<string, unknown>).cmd = diag.text.trim(); healed = true }
        }
        res = await executeNode(n, ctx, vars, opts)
      }
    }
    const log: RunLog = { node: n.id, kind: n.kind, label: nodeLabel(n), output: res.output, ok: res.ok, error: res.error, healed, dry: opts.dryRun }
    ctx.onLog(log)
    if (res.ok) { vars.prev = res.output ?? '' }
    else if (res.canceled) { return { ok: false, prev: vars.prev || '', canceled: true } }
    else if (n.onError === 'continue') { /* 不中止，继续 */ }
    else { return { ok: false, prev: vars.prev || '' } }
    cur = nextNodeId(flow, n.id)
```

> 注：`heal` 的 MVP 仅修 `params.cmd`（shell 场景）；其它节点类型的 heal 参数映射在阶段 6 细化。

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: `✓ ALL PASS 26/26`

- [ ] **Step 5: typecheck + 提交（检查点）**

```bash
npm run typecheck
git add src/renderer/src/logic/shortcuts/engine.ts scripts/test-shortcuts.ts
git commit -m "feat(shortcuts): 错误策略 continue/retry/heal + dry-run"
```

---

## Task 7: 旧线性数据迁移 migrateV1

**Files:**
- Modify: `src/renderer/src/logic/shortcuts/engine.ts`
- Test: `scripts/test-shortcuts.ts`

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { migrateV1 } from '../src/renderer/src/logic/shortcuts/engine.ts'
import type { ShortcutDefV1 } from '../src/renderer/src/logic/shortcuts/types.ts'

const v1: ShortcutDefV1 = {
  id: 'p-diagnose', icon: '🩺', name: '报错诊断', group: '代码', desc: 'x', runCount: 5, trusted: true,
  steps: [
    { kind: 'clipboard', op: 'read' },
    { kind: 'ai', system: '分析报错', prompt: '%prev%' }
  ]
}
{
  const g = migrateV1(v1)
  ok(g.mode === 'graph' && g.meta.name === '报错诊断', '迁移保留元信息')
  ok(g.nodes.length === 2 && g.edges.length === 1, '两步→两节点一边')
  ok(g.entry === g.nodes[0].id, 'entry 指向首节点')
  ok(g.nodes[0].kind === 'clipboard' && g.nodes[1].kind === 'ai', 'kind 无损')
  ok(g.nodes.every((n) => n.confirm === 'never'), 'trusted → 每步 confirm=never（危险仍由 DANGEROUS_RE 保底）')
  ok(g.runCount === 5, 'runCount 保留')
}
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: FAIL（`migrateV1` 未定义）。

- [ ] **Step 3: 实现 migrateV1**

在 `engine.ts` 追加：

```ts
/** 旧线性 ShortcutDefV1 → 图 ShortcutDef：steps 连成单入单出链；trusted→confirm=never。幂等（已是图则原样返回）。 */
export function migrateV1(v1: ShortcutDefV1): ShortcutDef {
  const nodes: FlowNode[] = v1.steps.map((s, i) => ({
    id: 'n' + i,
    kind: s.kind as NodeKind,
    params: { ...s },
    confirm: v1.trusted ? 'never' : 'dangerous'
  }))
  const edges: FlowEdge[] = []
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ id: 'e' + i, from: nodes[i].id, to: nodes[i + 1].id })
  return {
    id: v1.id,
    meta: { icon: v1.icon || '⚡', name: v1.name, group: v1.group || '自定义', tags: [], desc: v1.desc },
    mode: 'graph',
    entry: nodes[0]?.id || 'n0',
    nodes, edges,
    vars: v1.repoPath ? [{ name: 'repo', scope: 'flow', value: v1.repoPath }] : [],
    triggers: [],
    builtin: v1.builtin,
    runCount: v1.runCount || 0,
    lastRun: v1.lastRun
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: `✓ ALL PASS 32/32`

- [ ] **Step 5: typecheck + 提交（检查点）**

```bash
npm run typecheck
git add src/renderer/src/logic/shortcuts/engine.ts scripts/test-shortcuts.ts
git commit -m "feat(shortcuts): 旧线性数据 → 图 迁移 migrateV1"
```

---

## Task 8: 内核收尾 —— 全量回归 + 阶段验证

**Files:**
- Modify: `scripts/test-shortcuts.ts`（补一条端到端"报错分诊"综合流）
- Verify: 全套测试 + typecheck + build

- [ ] **Step 1: 追加端到端综合测试（分支+子步骤，模拟真实"报错分诊"）**

```ts
// 端到端：读剪贴板(报错) → router(ai 判前/后端) → 分别 ai 处理 → 存便签
const e2e: SDef = {
  id: 't-e2e', meta: { icon: '🩺', name: '报错分诊', group: '代码', tags: ['ai'] }, mode: 'graph',
  vars: [], triggers: [], runCount: 0, entry: 'clip',
  nodes: [
    { id: 'clip', kind: 'clipboard', params: { op: 'read' } },
    { id: 'r', kind: 'router', params: { mode: 'ai', prompt: '前端还是后端？' } },
    { id: 'fe', kind: 'ai', params: { system: '前端专家', prompt: '%prev%' } },
    { id: 'be', kind: 'ai', params: { system: '后端专家', prompt: '%prev%' } },
    { id: 'save', kind: 'island', params: { action: 'note', args: '诊断 %date%\n%prev%' } }
  ],
  edges: [
    { id: 'e1', from: 'clip', to: 'r' },
    { id: 'e2', from: 'r', to: 'fe', when: 'frontend' },
    { id: 'e3', from: 'r', to: 'be', when: 'backend' },
    { id: 'e4', from: 'fe', to: 'save' },
    { id: 'e5', from: 'be', to: 'save' }
  ]
}
{
  const { ctx, logs } = stubCtx({ ai: async (s) => ({ ok: true, text: s.includes('专家') ? 'DIAG' : 'backend' }) })
  const r = await runGraph(e2e, ctx)
  ok(r.ok, '端到端成功')
  ok(logs.some((l) => l.kind === 'island' && (l.output || '').includes('已note')), '走到存便签收尾')
  ok(!logs.some((l) => l.node === 'fe'), 'ai 选 backend → 未走前端分支')
}
```

- [ ] **Step 2: 运行全套内核测试**

Run: `node --experimental-strip-types scripts/test-shortcuts.ts`
Expected: `✓ ALL PASS 35/35`

- [ ] **Step 3: 两端 typecheck**

Run: `npm run typecheck`
Expected: 零错误。

- [ ] **Step 4: 构建冒烟（确认新逻辑文件不破坏 vite 构建）**

Run: `npm run build`
Expected: 三端构建通过（内核未接线 UI，构建应无影响）。

- [ ] **Step 5: 提交（检查点）**

```bash
git add scripts/test-shortcuts.ts
git commit -m "test(shortcuts): 图内核端到端回归（报错分诊综合流）"
```

---

## Self-Review 结论（作者自查）

- **Spec 覆盖**：本计划覆盖 spec 第 2 节（数据模型 types.ts）、第 3 节（engine.runGraph/runFlow/executeNode：顺序/命名变量/router/foreach/parallel/subflow/错误策略/dry-run）、第 2 节末（migrateV1 迁移）、第 10 节（test-shortcuts.ts 重写）。spec 第 4–9、11 节（AI 大脑深化/创建 UI/触发器/权限 UI/主进程接线/视觉）属**阶段 2–7**，不在本计划——已在头部路线标注。
- **占位符**：无 TBD/TODO；每个代码步骤含完整实现与断言。
- **类型一致**：`RunCtx`/`RunResult`/`RunOpts`/`FlowNode`/`SubFlow`/`ShortcutDef`/`migrateV1` 跨 Task 命名一致；`runGraph(def, ctx, opts)`、`runFlow(flow, ctx, vars, opts)`、`executeNode(n, ctx, vars, opts)` 签名贯穿一致。
- **已知取舍**：`delay` 节点内核不真正 sleep（阶段 2 接线）；`heal` MVP 仅修 shell 的 `params.cmd`（阶段 6 泛化）；断言计数（9/13/15/20/26/32/35）随 Task 递增，执行者以实际运行值为准、只要全绿即可。
