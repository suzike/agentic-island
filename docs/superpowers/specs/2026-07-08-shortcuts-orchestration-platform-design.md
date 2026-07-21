# 快捷指令 → AI 原生编排平台 · 设计文档

> **文档状态（2026-07-21）：历史设计基线。** 本文用于追溯快捷编排平台的原始目标，不能替代 `v0.6.1` 当前实现说明。现行架构、开发流程与发布状态请参阅 [架构说明](../../ARCHITECTURE.md)、[开发指南](../../DEVELOPMENT.md) 和 [v0.6.1 发布说明](../../releases/v0.6.1.md)。

- 日期：2026-07-08
- 模块：⚡ 快捷指令（Shortcuts）
- 决策：**混合图内核 + AI 副驾 + 可切 Agentic**；**一次到位覆盖六层**
- 现状：`logic/shortcuts.ts`（线性引擎）+ `components/ShortcutsTab.tsx`（网格/编辑器/运行浮层），本设计将其从"线性脚本器"升级为"编排平台"。

## 0. 目标与非目标

**目标**：把快捷指令做成一个 **AI 原生、高自由度、可视化编排**的自动化平台——能分支/循环/并行、命名变量、每步可插 AI、失败自愈、可切 Agentic 动态编排；多种触发；对话式快速创建；细粒度权限全放给用户。

**非目标**：不做云端同步、不做多用户协作、不做跨机分享市场（仅本地 JSON 导入导出）。

## 1. 架构总览（六层）

```
L5 触发层   手动 · 全局热键 · 定时(cron) · 剪贴板变化 · 文件监听 · 岛内事件 · 迷你条
L4 创建层   对话共建（说需求→AI 画图→增量改） · 可视画布 · 模板库/导入导出
L3 AI 大脑  AI 步骤 · AI 路由 · AI 自愈 · Agentic(目标→动态编排)
L2 编排层   分支 if/else · 循环 foreach · 并行 · 命名变量 · 子流程 · 错误策略 · 重试
L1 动作原语 shell·agent·ai·kb(RAG)·http·vision·web·clipboard·island·setvar·notify·delay
L0 权限沙箱 每步授权范围 + 确认策略三档 + 密钥库 + dry-run + 变量作用域
```

后端复用现状：shell/open/clipboard/agent(agent-cli)/kb(kb.ts)/http(http-client.ts)/vision(captureScreen)/web(fetchUrlText)/hotkey(globalShortcut) 已存在，主要新增编排图内核、画布、对话共建、触发器管理、权限/密钥。

## 2. 数据模型（`logic/shortcuts/types.ts`）

```ts
type NodeKind =
  | 'start' | 'end'
  | 'shell' | 'open' | 'clipboard' | 'island' | 'input' | 'confirm'   // 现有保留
  | 'ai' | 'agent'                                                     // 增强
  | 'http' | 'kb' | 'vision' | 'web' | 'setvar' | 'notify' | 'delay'   // 新增原语
  | 'router' | 'foreach' | 'parallel' | 'subflow'                      // 编排控制

interface FlowNode {
  id: string
  kind: NodeKind
  params: Record<string, unknown>          // 各 kind 自有参数
  pos: { x: number; y: number }            // 画布坐标
  ai?: { fill?: boolean; heal?: boolean; guard?: boolean }
  onError: 'stop' | 'continue' | 'retry' | 'heal'
  retry?: number
  confirm: 'always' | 'never' | 'dangerous'
  scopes?: { shellAllow?: string[]; httpDomains?: string[]; fsPaths?: string[]; repo?: string }
}

interface FlowEdge { id: string; from: string; to: string; when?: 'true' | 'false' | string }

interface VarDef { name: string; scope: 'global' | 'flow' | 'run'; secret?: boolean; value?: string }

interface Trigger {
  kind: 'manual' | 'hotkey' | 'schedule' | 'clipboard' | 'file' | 'event'
  config: Record<string, unknown>          // hotkey:accelerator / schedule:cron / clipboard:regex / file:path / event:type
  enabled: boolean
}

interface ShortcutDef {
  id: string
  meta: { icon: string; name: string; group: string; tags: string[]; desc?: string }
  mode: 'graph' | 'agentic'
  nodes: FlowNode[]
  edges: FlowEdge[]
  vars: VarDef[]
  triggers: Trigger[]
  agentic?: { goal: string; tools: NodeKind[]; constraints?: string }
  builtin?: boolean
  runCount: number
  lastRun?: number
}
```

**旧数据迁移**：旧 `ShortcutStep[]` → 一串单入单出 node + 顺序 edge，`trusted` → 每步 `confirm:'dangerous'|'never'`。迁移函数 `migrateV1(def): ShortcutDef` 幂等，加载时自动升级。

## 3. 执行引擎（`logic/shortcuts/engine.ts`）

- `runGraph(def, ctx, opts)`：从 start 节点边驱动遍历。
- **命名变量存储** `VarStore`：`setvar` 写、任意 params 用 `%name%`/`{{expr}}` 读；作用域 global（跨运行，落盘）/ flow（本指令）/ run（单次运行）。
- **控制节点**：`router`（AI 或表达式选出边 `when`）；`foreach`（对数组/行迭代子图）；`parallel`（并发分支，全部完成再汇合）；`subflow`（调另一条 ShortcutDef）。
- **错误策略**：`onError` = stop/continue/retry(retry 次)/heal（AI 诊断→改 params→重试）。
- **dry-run**：不产生真实副作用，只记录"将执行什么"。
- **RunCtx 依赖注入**（延续现有）：所有副作用（shell/ai/agent/http/kb/vision/clip/island/notify/askInput/askConfirm/askRepo）由调用方注入 → 纯逻辑、raw-node 可测。
- **Agentic 模式**：`mode:'agentic'` 时，引擎把 `agentic.goal + tools` 交给 LLM 规划循环（plan→act→observe），每个 act 映射到一个 node 执行，关键动作走 `askConfirm`。

## 4. L3 · AI 原生五能力（"每个指令都有强 AI"）

1. **AI 步骤**（`ai` node 增强）：可选模型、读多变量、输出文本/JSON/结构化。
2. **AI 路由**（`router` node）：AI 看输入决定走哪条 `when` 边。
3. **AI 自愈**（`onError:'heal'`）：失败→AI 诊断→改 params→重试（≤ retry 次），过程记入执行轨迹。
4. **AI 编排**（`mode:'agentic'`）：只写目标+工具箱，运行时 AI 动态规划执行。
5. **AI 收尾**（`ai.fill` 装饰 / 预置"智能收尾"子流程）：任意节点自动填参 / 一键加"整理成人话+存便签"。

## 5. L4 · 创建平台

- **对话共建（主入口，`BuilderChat.tsx` + `builder.ts`）**：用户自然语言 → AI 输出/增量修改 `nodes+edges` JSON → 画布实时渲染。支持"把第2步改并行""加个确认"等增量指令。产物即可执行图。
- **可视画布（`FlowCanvas.tsx`）**：节点玻璃卡 + 连线；拖拽增删节点、连线画流向、点节点开 `NodeInspector` 配参数。分支/循环用带 `when` 标签的连线表达。
- **模板库/导入导出**：内置高质量模板（全 AI 增强，可编辑）、复制、导出 JSON、粘贴导入、"恢复预置"。
- **创建即测试**：单步调试、从任意节点重跑、每步真实 I/O 可见、dry-run 预览。

## 6. L5 · 触发器（`main/shortcut-triggers.ts`）

| 触发 | 实现 |
|------|------|
| 手动 | 卡片点击 / 命令面板 / autoRunId |
| 全局热键 | `globalShortcut.register(accelerator)` |
| 定时 | node 侧 cron 解析 + setInterval 调度（对齐分钟） |
| 剪贴板变化 | 复用 `clipboard-watch` 的 onClipboard + regex 匹配 |
| 文件监听 | `fs.watch(path)` 去抖 |
| 岛内事件 | Agent 完成 / 会议将至 / 待办到时 → 事件总线 |

触发器注册集中在主进程，渲染层经 IPC 增删；触发时 fire 对应 ShortcutDef 运行（后台运行 + 结果通知）。

## 7. L0 · 权限与自由度

- **确认策略三档**（每步）：`always / never / dangerous`（`danger.ts` 的 `DANGEROUS_RE` 保底，命中即使 never 也强制确认）。
- **每步授权范围** `scopes`：shell 命令白名单 / HTTP 允许域名 / 文件路径白名单 / agent 仓库锁定。
- **密钥库 & 自定义变量**：`VarDef.secret` 走 settings-store DPAPI 加密；用户自定义 `%my_key%` 等，任意步骤引用。
- **dry-run**：全局开关，预览不副作用。
- **预置可编辑**：改后仍可"恢复预置"回滚。

## 8. 视觉与交互

- **令牌统一**（`components/shortcuts/styles.ts`）：沿用 OKLCH `--th/--cs/--pl`，统一 chip/卡片/节点样式；间距刻度 4/8/12/16。
- **指令卡**：使用热度色温、上次结果预览、运行中实时态直接在卡上跑、收藏置顶、触发器角标（🔥热键/⏰定时/📋剪贴板/📁仓库）。
- **执行轨迹**（`RunTrace.tsx`）：时间线，每步可展开真实 I/O、失败处显示 AI 自愈过程、"从此步重跑"。
- **画布**：节点玻璃卡 + 连线动效；**禁用带 translate 的 keyframes**（用 ai-fadein，遵守踩坑约束）；SVG 连线渐变用 `style.stopColor`（SVG 属性不解析 var()）。
- **浮层层级**：运行 > 编辑/画布 > 卡片（现有 zIndex 约定延续）。

## 9. 主进程新增/接线

- 新增 `main/shortcut-triggers.ts`（触发器管理）。
- 接线现有 `http-client.ts`（http node）、`kb.ts`（kb node，需确认 preload 暴露）、`captureScreen`（vision node，多模态 LLM）、`fetchUrlText`（web node）。
- `settings-store` 增密钥库（DPAPI 加密存 secret 变量）。
- 新增 IPC：trigger 注册/注销、shortcut-http（若未接）、shortcut-vision、secrets 读写。
- **约束**：被 raw-node 测试加载的主进程文件顶层不得有无扩展名运行时 import → 触发器/后端接线走依赖注入或函数内 `await import`。

## 10. 测试（`scripts/test-shortcuts.ts` 重写，raw-node）

- 图引擎：顺序 / 分支(router by expr) / 循环(foreach) / 并行(parallel) / 命名变量作用域 / 错误策略(stop/continue/retry/heal 桩) / dry-run。
- interpolate：`%var%` + `{{expr}}` 求值 + 缺失变量兜底。
- 迁移：`migrateV1` 旧线性 → 图幂等。
- builder：`parseBuilder` 增量改图解析容错。
- danger：`DANGEROUS_RE` 边界匹配。
- 全部经 RunCtx 注入桩，不触真实副作用。

## 11. 风险与边界（如实）

- 工程量大：图内核 + 画布 + 对话共建 + 触发器 + 权限，多新文件 + 主进程改动，需分模块推进（即使"一次到位"也按依赖顺序实现）。
- 画布交互（拖拽/连线）零依赖手写复杂度高；如引入库需评估（当前仓库倾向零依赖 + N-API 原生）。
- Agentic 模式确定性弱，定位"探索型"，关键动作强制审批。
- 触发器涉及系统级注册（热键冲突、文件监听资源），需去重与生命周期管理（will-quit 清理）。

## 12. 分期实现顺序（即便一次交付，按此依赖链推进）

1. **内核**：types + engine（图/变量/控制/错误）+ migrateV1 + 测试。
2. **动作原语**：新 node 后端接线（http/kb/vision/web/setvar/notify/delay）+ IPC。
3. **权限/密钥**：confirm 三档 + scopes + VarVault + dry-run。
4. **创建体验**：NodeInspector + FlowCanvas + BuilderChat + 模板/导入导出。
5. **触发器**：shortcut-triggers + 各触发 + IPC + 卡片角标。
6. **AI 大脑**：router / heal / agentic 模式 + 预置全 AI 增强重写。
7. **视觉打磨 + 执行轨迹 + 迁移验证**。
