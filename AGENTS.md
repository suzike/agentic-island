# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 仓库现状（先读这一段）

这**已经不是设计交付包**，而是一个功能完整、可打包安装的 Windows 桌面应用 **Agentic-Island（灵动岛）**：常驻屏幕顶部的 AI 编码 Agent 监控/审批/协作面板 + 个人工作台。技术栈 **Electron 39 + React 19 + TypeScript**（electron-vite 构建，Vite 锁在 5.x）。已产出 NSIS 安装包（`dist/Agentic-Island-Setup-*.exe`）。

`Vibeisland Windows 端复刻-handoff/` 是最初的 Codex Design 设计交付包（PRD + 高保真原型），**只作历史设计参考，勿改动**；视觉规范（OKLCH 主题、动效、字体栈）源于其中。

## 常用命令

```bash
npm run dev          # 开发运行（app ready 会自动安装全局 hooks；AIISLAND_SKIP_HOOKS=1 可跳过）
npm run typecheck    # 两套 tsconfig（node=main/preload+shared, web=renderer+shared）
npm test             # 顺序执行 23 个离线 test-*.ts（排除真实 Claude 登录探针）
npm run build        # electron-vite 三端构建
npm run package      # NSIS 安装包（原生模块经 asarUnpack **/*.node）
npm run docs:capture # 隔离演示数据启动 Electron，重建 README 真实截图
npm run demo:plan    # 向运行中的岛注入一条演示计划（看 Plan 审阅长什么样）
npm run probe        # 诊断：一键接入+实时打印 hook 事件，Ctrl+C 还原

# 测试（raw node 直跑 TS，无测试框架）
node --experimental-strip-types scripts/test-lifecycle.ts   # hook→桥→状态机全生命周期 + 安装器幂等
node --experimental-strip-types scripts/test-loop.ts        # 审批阻塞闭环 + deny 理由回传
node --experimental-strip-types scripts/test-stop.ts        # git 变更小结（真实临时仓库）
node --experimental-strip-types scripts/test-codex-tail.ts  # Codex rollout 跟随
node --experimental-strip-types scripts/test-ics.ts         # ICS 解析（时区/RRULE/EXDATE）
node --experimental-strip-types scripts/test-notes.ts       # 便签 AI 解析器
node --experimental-strip-types scripts/test-quote.ts       # 问答引用组装
node --experimental-strip-types scripts/test-external-yield.ts # 外部应用让位
node --experimental-strip-types scripts/test-shortcuts.ts   # 快捷编排与安全闸
node --experimental-strip-types scripts/test-todo.ts        # 待办规划/统计/导入导出
```

## 架构总览

```
Codex (CLI/桌面端) ──hooks──► src/hooks-bin/cc-forward.mjs ──HTTP 127.0.0.1──►┐
Codex (CLI/桌面端) ────rollout 日志──► src/main/codex-tail.ts（轮询跟随）──────────►│
                                                                                    ▼
              ┌────────────────────── Electron 主进程 (src/main) ──────────────────────┐
              │ bridge-server  本地桥(随机端口+token→~/.agentic-island/bridge.json,    │
              │                15s 自愈防覆盖)；permission 事件阻塞至用户裁决           │
              │ agents-store   Agent 状态机(会话键=backend:sessionId；done 3min 自动隐藏)│
              │ hook-installer 合并式安装/卸载 ~/.Codex settings.json + ~/.codex hooks │
              │ term-pty       真 PTY 终端(@lydell/node-pty N-API, ConPTY, 多会话)      │
              │ calendar-ics / calendar-caldav  飞书日历(CalDAV multiget 两段式)        │
              │ rss / media(SMTC) / clipboard-watch / sound / llm-proxy / git-summary  │
              │ terminal-jump(HWND/UIA 切 WT 标签页) / settings-store(DPAPI 加密)      │
              └───────────────────────────┬── Electron IPC ────────────────────────────┘
                                          ▼
              渲染进程 (src/renderer)：App.tsx 编排 + components/*Tab + logic/* + ui/*
              十一个分区：Agents · Plan · 问答 · 快捷 · 待办 · 灵感便签 · 资讯 · 复盘 · 仓库 · 终端 · 设置
              + AmbientBar 常驻迷你条（收起后的小状态条，多模式轮播）
```

- **设计系统（src/renderer/src/ui/）**：2026-07 前端视觉全面重设计 + Apple（macOS/iOS）化后，**所有新 UI 必须走这里**：
  - `tokens.ts`：**填充制层级**——`fill(1-4)` 填充阶梯代替 rgba 白透明度与 1px 描边、`hairline()` 0.5px 发型线分隔、`separatorRow()` 分隔行、`R` Apple 圆角阶梯（按钮 10/卡片 13/浮层 18/面板 28）、`ink(1-4)` iOS label 四级墨色、`text.*` SF 排版（标题负字距）、`accent()/sem.*` 语义色（全部消费 OKLCH 主题变量，勿手写 oklch 魔法值）。
  - `components.tsx`：共享组件 Button（含 tinted 变体）/IconButton/Card/Chip/Badge/Input/Segmented（iOS 滑动 thumb）/SectionHeader/EmptyState/Switch（iOS 白钮）/Slider/Group（inset grouped 列表）。
  - `motion.ts`：framer-motion 预设（fadeScaleIn 卡片入场 / overlayPop 浮层 / stagger 列表 / pressable iOS 透明度下沉）。
  - `icons.ts`：lucide 语义图标表 `Ico`（全岛 emoji 图标已清除；**用户数据里的 emoji 字段保持渲染**）。
  - 参考样板：`components/AgentsTab.tsx`。

- **协议契约**：`src/shared/protocol.ts`（三端共用；`IslandBridgeApi` 是 preload 暴露的全部能力面）。
- **Codex 接入**：全生命周期 hooks（SessionStart/UserPromptSubmit/PreToolUse/Stop/Notification/SessionEnd）。PreToolUse 对非只读工具**阻塞审批**（stdout 返回 permissionDecision）；deny 理由回传实现接力 steer；ExitPlanMode→计划审阅；Stop→"等待回复"+ transcript 尾部提取最后回复 + turnEnd 触发 git 小结。
- **Codex 接入**：rollout 日志跟随为主（`~/.codex/sessions/**/rollout-*.jsonl`，只监控无审批，15min 空闲自动归档）；hooks 桌面端实测会触发（审批可用），CLI 不触发。**CLI/桌面端无法区分**（originator 恒为 codex-tui），统一标 "Codex"。

## 关键工程约束（踩过的坑，勿重蹈）

1. **raw-node 测试约束**：被 `scripts/test-*.ts` 直接加载的主进程文件，顶层不得有无扩展名运行时 import（electron 也不行）——用依赖注入（`fetchCaldav(cfg, parseIcs)`、bridge-server 的 Summarizer）或函数内 `await import('electron')`（rss.ts）。strip 模式下 TS 参数属性/enum 不可用。
2. **测试桥隔离**：测试实例化 BridgeServer 必须传临时 discoveryFile 并设 `AIISLAND_BRIDGE_FILE` 环境变量。**曾因测试覆盖真实 bridge.json 导致整条通信链路瘫痪**；主进程有 15s 自愈但别依赖它。
3. **Electron 渲染层没有 `prompt()/alert()/confirm()`**（静默失效）——一律做行内编辑器/自定义弹层。
4. **`resizable:false` 窗口 setBounds 改宽被 Windows 忽略**——positionWindow 先 `setResizable(true)` 再改再收回；跨 DPI 屏 setBounds 有 DIP 换算竞态，须 60ms 后校验重试一次。显示器热插拔/分辨率/DPI 变化靠 `screen.on('display-added/removed/metrics-changed')` 重定位（勿只信 follow 轮询）；全屏模式=窗口切 `display.bounds`（含任务栏），退出回 `workArea`；挂件/钉屏便签锚定 `targetDisplay()`（岛所在屏）而非主屏。
5. **LLM 批量中文 JSON 生成必须按输出 token 预算分块**（fast 模式 900 tokens 一撞就截断、解析全败）；异步水合的 apiKey 要进 effect 依赖（`llmReady`）。
6. **PowerShell 子进程输出必须显式 UTF-8**（`[Console]::OutputEncoding`），否则中文 GBK 乱码。
7. **SVG 属性不解析 CSS var()**——渐变 stop 用 `style={{ stopColor }}`。
8. **卡片入场动画禁用带 translate 的 keyframes**（ai-toast 是给居中 toast 的，会把卡片甩出面板）——用 `ui/motion.ts` 的 fadeScaleIn；**同样禁用 filter: blur 入场动画**（透明窗口+大树重绘会掉帧，Tab 切换卡顿的根因），AnimatePresence 不加 `mode="wait"`（新分区要等旧分区退出才挂载，感知卡顿）。
9. **hooks 转发脚本必须 fail-open**（岛没开时绝不能卡住用户 CLI）；诊断走 `~/.agentic-island/events.log`（cc 与 codex 都写）。
10. **视觉体系**：OKLCH 色相令牌（`--th/--th2/--ths` + `--cs/--css` 饱和倍率、`--pl` 面板明度倍率），主题在 `logic/themes.ts`；语义色（琥珀警示 75 / 红危险 / 紫专注）跨主题固定。组件样式一律走 `ui/tokens.ts` + `ui/components.tsx`（见上方"设计系统"），动效用 `ui/motion.ts`（framer-motion）+ `src/renderer/index.html` 的全局 keyframes/class（.hv/.ai-card/.ai-scroll/.row-acts 仍保留使用）。
11. **原生依赖只用 N-API 预编译包**（@lydell/node-pty）——避免依赖用户机 node-gyp、Python 与 Visual Studio 构建链。
12. **外网请求走 electron `net.fetch`**（继承系统代理）；Node 全局 fetch 不认代理（GitHub API 等会连不上）。

## 数据与持久化

- 渲染层状态经 `save-state` IPC 持久化到 `userData/config.json`（DPAPI 加密，含 API Key/CalDAV 密码）。**水合只执行一次且覆盖式**（StrictMode 双调用曾致待办翻倍）。
- 运行时发现文件/缓存：`~/.agentic-island/`（bridge.json、events.log、sound.log、tc-*.json 终端句柄缓存）。
- AI 能力统一走 `llm-proxy`（OpenAI 兼容 /chat/completions，多轮 history，deep 模式 3000 tokens，reasoning_content 捕获，多模态 parts 带图）。

## 工作约定

- 回复用简体中文；每轮改动跑 `typecheck + build` + 相关 test 脚本；安全分类器不可用导致无法编译时，人工核对并**如实告知未编译**。
- 用户显式要求才做 git 操作。改动追求最小 diff，匹配现有内联样式/OKLCH 写法。
- 长期记忆（进度流水、根因复盘）在 auto-memory 的 `m1-status.md`，比本文件更细。
