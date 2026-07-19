# Agentic-Island v0.3 架构说明

本文档描述当前 `0.3.x` 实现。历史设计交付包只用于视觉参考，不代表运行时架构。

## 1. 设计目标

- AI Agent 在任意终端运行时，状态、审批、计划和结果可以在桌面顶部统一呈现。
- 桌面常驻不能牺牲外部应用可操作性；任何外部打开动作都必须先释放最高层级。
- 系统权限集中在 Electron 主进程，渲染进程只能通过类型化 preload 契约调用。
- 项目、任务、资讯、快捷执行和成果之间建立稳定引用，同时兼容旧数据和独立使用方式。
- 凭据和个人数据默认保存在本机，网络能力遵循系统代理与最小暴露原则。

![总体架构](architecture.svg)

## 2. 进程与信任边界

### Electron 主进程

入口为 `src/main/index.ts`。主进程负责：

- 创建透明、无边框、铺满工作区的最高层窗口，以及桌面挂件和便签窗口。
- 启动本地 Bridge Server，维护 Agent 状态机并把快照通过 IPC 推送给渲染层。
- 安装/卸载 Claude Code 与 Codex hooks，跟随 Codex rollout JSONL。
- 运行 ConPTY、多媒体、截图、日历、RSS、Git/GitHub、LLM、embedding 和知识库能力。
- 处理所有原生对话框、系统浏览器、Explorer 和外部文件打开。
- 用 `safeStorage`、原子写和坏文件备份持久化配置。

### Preload

`src/preload/index.ts` 通过 `contextBridge` 暴露 `IslandBridgeApi`。协议定义集中在 `src/shared/protocol.ts`，它是三端共享的唯一能力契约。

原则：

- 不向渲染层暴露 `ipcRenderer`、`fs`、`child_process` 或任意通道调用。
- IPC 参数和返回值在协议层显式定义。
- 事件订阅必须返回取消函数，避免热更新或组件卸载后重复监听。

### React 渲染进程

`src/renderer/src/App.tsx` 负责编排 11 个主分区和全局浮层。模块内纯计算放在 `logic/*`，可由 raw Node 测试直接加载；涉及 Electron 的能力一律通过 `bridge.ts` 调用 preload。

视觉层统一收敛在 `src/renderer/src/ui/` 设计系统（v0.3 起，Apple 设计语言）：

- `tokens.ts`：填充制层级——`fill(1-4)` 填充阶梯（代替 1px 描边）、`hairline()` 0.5px 发型线分隔、`R` 圆角阶梯（按钮 10/卡片 13/浮层 18/面板 28）、`ink(1-4)` iOS label 四级墨色、`text.*` SF 排版；颜色全部消费 OKLCH 主题变量（`--th/--th2/--ths/--cs/--css/--pl`），主题切换无需改组件。
- `components.tsx`：共享组件（Button/Card/Chip/Input/Segmented 滑动 thumb/Switch 白钮/Group inset grouped 等）。
- `motion.ts`：framer-motion 预设。面板内动画只做 opacity（禁 translate/blur），浮层用 overlayPop。
- `icons.ts`：lucide 语义图标表（用户数据中的 emoji 字段除外）。

## 3. Agent 接入

![Agent 通信通道](agent-channel.svg)

### Claude Code

生命周期 hooks 覆盖 SessionStart、UserPromptSubmit、PreToolUse、Stop、Notification 和 SessionEnd。非只读工具在 PreToolUse 阶段进入阻塞审批，用户裁决通过 HTTP 响应返回。拒绝理由会进入 Agent 上下文，允许其调整方案后继续。

`cc-forward.mjs` 的底线是 fail-open：发现文件不存在、桥不可达、超时或返回异常时，不能锁住 CLI。

### Codex

稳定监控路径是跟随 `~/.codex/sessions/**/rollout-*.jsonl`。跟随器增量读取、去重和映射事件，15 分钟无活动后归档。Codex hooks 在支持的桌面场景可提供审批，但日志跟随本身只用于监控。

### Bridge Server

- 监听地址固定为 `127.0.0.1`。
- 端口和 token 写入 `~/.agentic-island/bridge.json`。
- discovery 文件每 15 秒检查并自愈，但测试必须使用隔离路径。
- permission 请求保持连接，直到用户裁决或上游超时。

## 4. 窗口层级、多显示器与外部让位

![外部应用让位](external-yield.svg)

透明主窗口覆盖整个工作区，以便顶部交互和多显示器定位。它在收起时开启点击穿透，展开时只让实际面板热区接收输入。

多显示器与全屏（v0.3 修复）：

- 目标显示器由 `targetDisplay()` 决定：跟随鼠标模式取光标所在屏，固定模式取设置中的显示器索引（设置页展示真实显示器列表，含分辨率与 DPI）。
- `screen.on('display-added/removed/metrics-changed')` 触发全部岛系窗口（主窗 + 桌面挂件）强制重定位；跨 DPI 屏 `setBounds` 后 60ms 校验重试一次，规避 DIP 换算竞态。
- 全屏模式把窗口从工作区切到 `display.bounds`（screen-saver 层级，可覆盖任务栏），退出回到 `workArea`；渲染层 100vw/100vh 布局无需感知。
- 启动时渲染层水合完成后权威同步一次多屏偏好，避免主进程默认值与 UI 不一致。

`ExternalYieldController` 统一处理外部动作：

1. 向渲染进程发送 collapse，确保完整面板不会继续覆盖屏幕。
2. 开启点击穿透、释放焦点并取消 `alwaysOnTop`。
3. 调用 `shell.openExternal`、`shell.openPath` 或原生对话框。
4. 普通打开在延迟后恢复顶部入口；模态文件对话框使用引用计数，关闭后恢复。

所有新增外部入口必须复用主进程包装函数，不得在 IPC handler 中直接调用 Electron shell/dialog。

## 5. 项目工作台数据模型

![项目工作闭环](workbench-loop.svg)

核心实体位于 `src/renderer/src/types.ts`：

| 实体 | 作用 |
|---|---|
| `WorkbenchProject` | 稳定项目 ID、名称、仓库路径、目标、状态和主题色 |
| `TodoItem.projectId` | 待办的稳定项目归属；旧 `project` 文本字段继续兼容展示和迁移 |
| `FeedItem.projectIds` | 一条资讯可服务多个项目 |
| `WorkflowRun` | 快捷工作流每次执行的项目、仓库、步骤进度、状态和摘要 |
| `WorkArtifact` | 情报简报、信号、计划、决策、报告和运行日志的轻量成果引用 |

迁移逻辑在 `logic/workbench.ts`。水合过程只运行一次，持久化数据是唯一真源，避免 React StrictMode 双调用导致数组重复。

## 6. AI 与知识库

### 云模型代理

`llm-proxy.ts` 调用 OpenAI 兼容 `/chat/completions`，支持多轮 history、快速/深度 token 预算、`reasoning_content` 和多模态 parts。外网请求经 Electron `net.fetch`，继承 Windows 系统代理。

### 本地 Agent

`agent-cli.ts` 以无头模式调用本机 Claude Code 或 Codex，保留本地登录、技能、MCP 和项目上下文。渲染层按事件流展示思考、工具步骤和正文，支持取消与继续会话。

### 本地知识库

`kb.ts` 支持文件夹、文件和网页；读取源码/文本、PDF 与 DOCX，分块后调用 embedding 模型并持久化向量。检索结果带来源、路径、片段和相似度，问答层强制组合引用。

第二大脑先构建便签、问答、复盘、资讯和剪贴板语料，可使用关键词预筛或 embedding 余弦排序。

## 7. 终端与快捷执行

终端基于 `@lydell/node-pty` N-API 预编译包和 Windows ConPTY。主进程持有 PTY 生命周期，渲染进程使用 xterm 展示和输入，多标签切换不会终止后台进程。

快捷编排支持以下步骤：

- `input`：向用户收集一次性参数。
- `clipboard`：读取或写入剪贴板。
- `ai`：调用云模型做文本变换。
- `shell`：在 PowerShell 中执行命令。
- `open`：打开网页、路径或文件。
- `agent`：把任务交给本地 Claude/Codex，并可绑定仓库。
- `island`：创建待办、便签或发送问答。
- `confirm`：显式确认关口。

危险分类器对删除、格式化、关机、进程终止、策略修改和破坏性 Git 命令强制确认；即使工作流被标记为 trusted，也不能绕过危险确认。

## 8. 持久化与隐私

`settings-store.ts` 提供：

- Windows DPAPI 可用时整体加密 `config.json`。
- 临时文件 + rename 原子写，失败时退回直写。
- 解析或解密失败时备份为 `config.bad.json`。
- 自定义主题单独写入不含凭据的 `themes.json`，作为主配置损坏时的兜底。

Bridge 发现、诊断和终端窗口句柄缓存位于 `~/.agentic-island/`。知识库索引位于 Electron `userData`，不进入仓库。

## 9. 测试策略

`npm test` 顺序执行全部离线 `scripts/test-*.ts`，排除必须依赖真实 Claude 登录的 `test-real-claude.ts`。直接被 raw Node 加载的主进程模块不得在顶层运行时导入 Electron，也不得使用 strip-types 不支持的 TypeScript enum 或参数属性。

发布门禁：

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run package`
5. 隔离配置启动并检查核心页面
6. 核对安装包 SHA-256 后创建 GitHub Release

`.github/workflows/release.yml` 在 Windows runner 上重复执行上述门禁，并负责上传安装包、校验文件和发布已有草稿，避免依赖开发机的长连接上传稳定性。
