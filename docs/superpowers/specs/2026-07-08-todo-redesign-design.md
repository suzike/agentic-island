# 待办模块全面重构设计（2026-07-08）

> **文档状态（2026-07-22）：历史设计基线。** 本文保留待办重构时的约束与取舍，文中的行数、功能数量和“现状”描述不代表 `v0.6.3` 当前代码。现行工程结构与验证方式以 [开发指南](../../DEVELOPMENT.md) 和 [架构说明](../../ARCHITECTURE.md) 为准。

## 背景与目标

待办模块（`src/renderer/src/components/TodoTab.tsx`）已演进到 v4，功能丰富但成为 **927 行单文件巨石**（超仓库 800 行上限），承载 8 个视觉区块 + ~20 个处理器。已有 ~15 项常规 + ~13 项 AI 能力，数量已近达标，真正问题在**结构、视觉一致性、交互流畅度**，以及"多而不精、藏得深"。

本次目标（用户裁定：**重构 + 打磨 + 查漏补缺**，非推倒重来、非纯加法）：
1. 拆分巨石为聚焦子组件 + 纯逻辑模块；
2. 前端设计与交互全面打磨（信息层级、视觉令牌统一、动效、空间效率）；
3. 对照 **10 常规 + 10 AI** 精修：砍重叠、留精华、补真缺。追求"精"而非"多"。

### 已识别的具体债务（重构中一并清理）
- **重复统计块**：顶部日历卡（原行 517-547）与「统计概览」块（原行 637-670）各有一个进度环+统计，信息冗余 → 合并为一处。
- **死代码**：`quadrantOf`（四象限归类，原行 144）已定义但正文未使用 → 接上「四象限视图」而非删除。

## 非目标
- 不改动 App.tsx 之外的其它分区；不改后端 IPC 契约（除持久化新增 `order` 字段）。
- 不做推倒重来式的数据模型重设计。
- 不在本次做 git 提交（遵用户约定：显式要求才动 git）。

---

## 一、架构拆分（方案 A：全拆分）

```
logic/todo.ts          纯函数：dayStart / dueLabel / 分组 / quadrantOf 四象限 / 趋势序列 / PRIO 常量
                       （无运行时 import，可 raw-node 测试）
logic/todoAi.ts (扩充) 全部 AI prompt 构造 + 解析收拢至此：
                       parseJsonArray / parseJsonObject / parseDue / normPrio / stripFence
                       + 各工具 prompt（plan/schedule/diagnose/report/quadrant/paste/energy/…）
components/todo/
  ├─ TodoTab.tsx       瘦编排层：state + 布局 + 接线（目标 < 250 行）
  ├─ TodoHeader.tsx    日期 · 进度环 · 关键数字 chips · 7 天趋势（合并原两处重复统计）
  ├─ TodoMeetings.tsx  近期日程（可折叠）
  ├─ TodoComposer.tsx  智能输入胶囊（AI/手动双模，渐进展开时间/优先级/重复）
  ├─ TodoBoard.tsx     看板三栏拖拽
  ├─ TodoRow.tsx       单条任务 + 展开详情（子任务/备注/专注）
  ├─ TodoAiPanel.tsx   AI 工具底部抽屉
  ├─ ProgressRing.tsx  进度环
  └─ styles.ts         模块内设计令牌（间距/圆角/chip 变体/优先级色）
```

**接线方式**：延续现有"App 持有数据 + 处理器，经 props 下传"模式。TodoTab 持有 UI 局部 state（视图、搜索、展开 id、编辑态、AI 抽屉态等），向子组件下传。所有跨文件 props 接口显式定义。

**原则**：每个文件单一职责、可独立理解与测试；纯逻辑进 `logic/` 满足 raw-node 测试约束（顶层无无扩展名运行时 import）。

---

## 二、功能审计：最终 10 常规 + 10 AI

### 常规 10（现有精修 + 补 3 真缺）
1. 定时·重复提醒
2. 优先级（三级色环）
3. 子任务 + 进度条
4. 备注 Markdown
5. 专注番茄 25min + 工时统计
6. 标签 + 多维筛选
7. 看板三栏拖拽
8. 分组时间线 + 搜索
9. 飞书日程集成
10. 统计/进度/7 天趋势（**合并原两处重复**）

**新增（真缺）**：
- 撤销（删除/完成 可撤销，5s toast）
- 列表内手动拖拽排序（新增 `order` 字段）
- Markdown 导入/导出（备份/迁移）

**降为行内轻操作（保留能力，不占功能位）**：置顶 / 批量多选 / 归档 / 顺延 / 复制。

### AI 10（现有 13 收敛 + 补 3）
1. 口语添加·自动拆条
2. AI 拆解子任务
3. AI 估时
4. AI 打标签
5. SMART 改写
6. 一段话规划（批量入库）
7. 智能排期
8. 逾期诊断
9. 统一「AI 报告」（原站会/复盘/周计划/聚焦四合一，选类型）
10. 合并去重建议

**新增**：
- AI 四象限自动分类（接上闲置的 `quadrantOf`）
- AI 粘贴整理（贴会议记录/聊天 → 自动抽任务）
- AI 精力匹配（按当前时段 + 历史工时推荐"现在做哪件"）

---

## 三、视觉与交互重设计

### C1 信息架构与布局（自上而下）
```
顶部条（compact）  日期 · 进度环(小) · 关键数字 chips · 7 天趋势迷你柱   ← 合并原两处统计
智能输入胶囊       AI/手动双模（主 CTA，视觉聚焦）
视图分段器 + 搜索   列表 | 四象限 | 看板 | 已完成                       ← 新增「四象限」
近期日程（可折叠）  仅当有会议时展开，位于输入下方
内容区             按视图渲染
```
- **视图 = 4 个**：列表（分组时间线）/ 四象限（艾森豪威尔）/ 看板 / 已完成。
- 日程从"常驻第二块"降为输入下方可折叠。

### C2 视觉令牌统一（`todo/styles.ts`）
- **间距刻度**：4 / 8 / 12 / 16（替换现在混用的 5/6/7/9/11/13）。
- **圆角**：卡片 13 · chip 999 · 输入 8-10。
- **chip 系统**：3 变体 filled（选中）/ ghost（默认）/ semantic（语义色）。
- **优先级色**：P1 红 25 / P2 琥珀 75 / P3 灰，全走 `calc(C * var(--cs))` 跨主题令牌。
- **动效**：仅 `ai-fadein / ai-pop / ai-dotpulse`（**禁 translate 类**，遵踩坑约束 #8）；列表入场轻微 stagger。SVG 渐变 stop 用 `style={{ stopColor }}`（约束 #7）。

### C3 关键交互重做
1. **任务行悬停操作精简**：默认只显 3 个高频（完成环 / 详情 ▾ / ⋯更多）；`⋯` 悬停浮出次级（编辑/顺延/置顶/删除）。
2. **撤销 toast**（新）：删除/完成后底部浮出「已删除 · 撤销」，5s 内可撤销。渲染层临时栈实现，不落盘。
3. **列表内拖拽排序**（新）：`TodoItem.order?` 字段，同组内手动拖动排序，复用看板拖拽手感。
4. **AI 面板改底部抽屉**：AI 结果从中部 panel 改为底部滑出 sheet（结果 + 逐条勾选采纳 + 一键全采纳）。
5. **输入胶囊**：AI/手动切换保留；手动模式时间/优先级/重复 chips 渐进展开，套用新 chip 系统。

### C4 空态与反馈
- 每视图独立空态（列表 🎉 / 四象限 ✦ / 看板 📋 / 已完成 🌱 / 搜索 🔍），文案一致化。
- AI 操作统一 loading（三点动画）+ 统一 flash（✓ 主题色 / ✕ 语义红）。

---

## 数据模型变更（最小）
`TodoItem` 仅新增：
- `order?: number` — 列表内手动排序。

四象限复用现有 `priority + due`，无新字段。撤销靠渲染层临时栈，不改类型不落盘。

App.tsx 对应新增处理器：`onReorder(id, order)`（或批量）、`onImport(items)`、导出走渲染层现有 `saveText`/剪贴板。AI 新增能力（四象限/粘贴/精力匹配）复用现有 `onAI(system, user)` 通用通道，无新 IPC。

## 测试策略
- 新增 `scripts/test-todo.ts`（raw-node，`node --experimental-strip-types`）：
  - `logic/todo.ts`：分组归类、`quadrantOf` 四象限、`dueLabel` 相对时间、趋势序列。
  - `logic/todoAi.ts`：`parseJsonArray/Object`、`parseDue`（今天/明天/后天/N分钟后/绝对时间）、各 parser 的容错兜底（去 ```` ``` ````、非法 JSON 不抛）。
- 每轮改动跑 `npm run typecheck`（两套 tsconfig）+ `npm run build` + `scripts/test-todo.ts`。
- 视觉/交互在真实 Electron App（`npm run dev`）核对，AIISLAND_SKIP_HOOKS=1 视需要。

## 风险与约束
- 拆分涉及大量 props 接线，风险在遗漏/类型不匹配 → 靠 typecheck 兜底、分子组件逐个迁移。
- 遵守踩坑约束：无 `prompt/alert/confirm`（行内编辑）、SVG 不解析 CSS var()、入场动画禁 translate、raw-node 逻辑文件无运行时 import、OKLCH 令牌写法一致、最小 diff。
- 保持渲染层状态持久化"覆盖式单次水合"语义（约束：StrictMode 双调用不得翻倍）。

## 实施阶段建议
1. 抽 `logic/todo.ts` + `logic/todoAi.ts` + `scripts/test-todo.ts`（纯逻辑先行，测试保护）。
2. 建 `components/todo/` 骨架 + `styles.ts` 令牌 + `ProgressRing`。
3. 迁移子组件：Header → Composer → Meetings → Row → Board → AiPanel。
4. TodoTab 收敛为编排层；接入 App 新处理器（order/import/export + 3 个新 AI）。
5. 交互新件：撤销 toast、列表拖拽、四象限视图、AI 底部抽屉。
6. 全量 typecheck + build + test + 真机核对。
