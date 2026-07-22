# Agentic-Island 开发指南

本文档对应 `0.6.5`。产品功能以源码、`README.md`、`docs/ARCHITECTURE.md` 和自动化测试为准。

## 1. 环境

- Windows 10/11 x64
- Node.js 22 或更高版本
- npm（使用仓库中的 `package-lock.json`，不要混用 pnpm/yarn）
- PowerShell 5.1 或 PowerShell 7

首次安装：

```powershell
npm ci
```

开发运行会在应用 ready 后安装 Agent hooks。隔离开发和文档截图应禁用：

```powershell
$env:AIISLAND_SKIP_HOOKS='1'
npm run dev
```

## 2. 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | electron-vite 开发运行 |
| `npm run typecheck` | 检查 main/preload/shared 与 renderer/shared |
| `npm test` | 顺序执行 35 个离线测试脚本 |
| `npm run build` | 构建 main、preload 和 renderer |
| `npm run audit:terminal` | 隔离 Electron 审计真实终端输入、退出码、危险确认与恢复 |
| `npm run docs:capture` | 使用隔离演示数据重建真实 Electron 截图 |
| `npm run package` | 构建 NSIS 安装包到 `dist/` |
| `npm run verify:package` | 隔离启动 unpacked、静默安装/启动/卸载 NSIS |

## 3. 目录与职责

| 路径 | 职责 |
|---|---|
| `src/main/` | Electron 权限、窗口、网络、终端、文件、录屏存储与导出 |
| `src/preload/` | 最小化 contextBridge 实现 |
| `src/shared/protocol.ts` | 三端 IPC 类型契约 |
| `src/renderer/src/components/` | React 业务工作台与浮层 |
| `src/renderer/src/logic/` | 可由 raw Node 测试加载的纯逻辑 |
| `src/renderer/src/ui/` | 令牌、共享组件、图标和动效 |
| `src/hooks-bin/` | Claude Code/Codex 事件转发脚本 |
| `scripts/` | 测试、诊断、演示和文档截图 |
| `resources/models/` | 随安装包分发的本地录屏人物模型 |

## 4. 工程约束

- 渲染层不直接访问 Node；新增能力先扩展 `IslandBridgeApi`，再实现 preload 和主进程 handler。
- 所有外部网页、路径、会议和文件对话框必须经过 External Yield 包装，避免置顶窗口遮挡目标应用。
- raw Node 测试直接加载的模块不得顶层导入 Electron，不使用 strip-types 不支持的 enum 或参数属性。
- 新 UI 使用 `ui/tokens.ts` 和 `ui/components.tsx`；不在业务组件手写新的主题色体系。
- 不使用浏览器原生 `prompt/alert/confirm`，Electron 渲染层必须提供行内或自定义弹层。
- 网络请求优先使用 Electron `net.fetch`，以继承 Windows 系统代理。
- xterm 输出处理不得在每个字符回显时创建 React 状态；目录、尺寸等派生状态必须先比较值并保持无变化时的引用稳定。`ResizeObserver` 触发的 fit 必须逐帧合并，ConPTY resize 必须去重。
- 终端目录选择必须使用 `IslandBridgeApi.pickDirectory` 的原生 `openDirectory` 对话框，并继续经过 External Yield；不要用 `shell.openPath` 代替可确认的目录选择。
- 终端持久化只能通过 `terminal-workspace-store.ts`；输出默认不保存，开启快照后必须执行字符上限、保留期和脱敏。导出不得包含输出或环境变量值。
- 不在仓库、日志、截图或测试数据中写入 API Key、密码、Token 和个人路径内容。
- Electron 审计、截图和安装验证实例必须设置隔离的 `AIISLAND_BRIDGE_FILE`；生产入口会把它传给 `BridgeServer`，不得覆盖真实 `~/.agentic-island/bridge.json`。

## 5. 问答与模型开发约束

- 问答活动分支的消息保存在 `threads.ask`，归档分支保存在 `askSessions`，活动分支元数据保存在 `activeAskBranch`；切换前必须整体归档当前分支。
- Fork 必须只复制选中节点以前的消息，并继承分支长期记忆与持续指令；分支合并只写入当前记忆，不覆盖现有消息。
- 所有模型请求统一使用 `historyFromThread` 处理钉选、排除、附件和记忆；新增入口不得自行拼接另一套上下文。
- 每条回答下的继续追问必须保存在该消息的 `followups` 中并继续显示在原气泡内，不得平铺成主会话消息；追问上下文由主线程截止点和本气泡支线共同组成。
- 回答分析保存在目标消息的 `analyses` 中，同类分析覆盖旧结果；分析结果不得进入 `historyFromThread`，也不得静默改写主回答。
- 多模型讨论只使用已保存的供应商配置，候选回答保存在目标消息的 `variants` 中，共识或分歧结果保存在该消息的 `analyses` 中；用户明确采用候选后才替换主 `blocks`。
- 主回答、追问、回答分析、多模型讨论、记忆压缩和分支合并的异步回调必须携带发起时的稳定分支 ID；分支切换后写回原分支，禁止按当前消息序号串写到新分支。
- 同一分支存在 `typing/live`（包括嵌套 `followups`）时不得再次发送主问题或追问；其他分支可继续使用，结果仍回到各自分支。
- 本机 Claude/Codex 必须通过 `buildAgentContextPrompt` 显式携带岛内历史、记忆和会话规则，不得用 CLI 全局 `-c` 代替分支上下文管理。
- 保存 `askThread/askSessions` 前必须调用 `compactChatMessages`：递归清除临时占位，在 60 条限额内优先保留重要消息，再补最近消息；附件进入历史时遵守单文件与总字符预算。
- 删除归档父分支时必须把直接子分支重挂到其父级；历史删除必须先展示不可恢复及执行中结果丢失提示。
- 对话知识沉淀通过 `kbAddText` 进入主进程知识库，来源类型固定为 `conversation`，不得在渲染层伪造临时搜索结果。
- 供应商切换必须经过 `logic/providers.ts`，保证 model/Base URL/API Key 同步切换；配置相等判断必须包含供应商、模型、归一化 Base URL 和 API Key，同模型不同账号不得覆盖或误去重；上游错误进入 UI 前必须脱敏。
- Kimi Code 会员服务与 Kimi 开放平台必须保持独立供应商配置；不得把 `api.kimi.com/coding/v1` 的会员密钥发送到 `api.moonshot.cn/v1`，反向同理。
- DeepSeek V4 快速/深度模式必须显式映射 thinking；Kimi K3 必须保持 thinking 并映射 effort；GPT-5.6 使用 `max_completion_tokens` 和 reasoning effort，不发送旧 `max_tokens`/`temperature`；Anthropic 官方端点必须使用原生 Messages 协议和 `x-api-key`，Claude 5/4.8 的思考控制必须按型号能力映射。
- Embedding 的 Base URL、模型和 API Key 独立于聊天配置；知识库搜索、索引、重建和会话写入只读取 `embeddingConfig`，不得重新复用当前 `llm` 连接。
- 模型测试和目录同步的异步结果必须校验发起时的 provider/Base URL/API Key/model，编辑配置后不得让旧响应覆盖新状态。
- 问答逻辑变更至少运行 `test-quote.ts`；供应商目录、迁移或密钥隔离变更至少运行 `test-providers.ts`，请求参数兼容变更还需运行 `test-llm-request.ts`。
- 终端输入、尺寸、Shell 启动或目录切换变更至少运行 `test-terminal.ts`；现场存储和项目扫描分别运行 `test-terminal-workspace.ts`、`test-terminal-project.ts`；新增文件/目录对话框还必须运行 `test-external-yield.ts`。终端 UI 变更完成后运行 `npm run audit:terminal`，确认第一、第二 PowerShell 会话逐字符输入均稳定且可回传退出码。

## 6. 录屏开发约束

- 来源枚举必须保留显示器 ID、DIP 边界、DPI 和物理帧尺寸；窗口来源在媒体轨 ready 后使用实际视频尺寸。
- 自定义区域、`contain/cover`、动态运镜、定位框和光标效果必须共享 `logic/recording.ts` 的合成几何。
- 录制控制条收起只能隐藏工作台，不能卸载 Canvas 或终止 draw loop。
- MediaRecorder 分片必须按 index 顺序写入；写盘失败要停止录制并保留可诊断错误。
- 剪辑工程保存参数和素材引用，不修改原始录制会话。
- 导出参数变更必须覆盖 `test-recording.ts` 和 `test-recording-export-e2e.ts`。

## 7. 测试分层

1. 纯逻辑：`scripts/test-*.ts`。
2. 真实本地组件：FFmpeg、临时 Git 仓库、Bridge 生命周期。
3. Electron 运行时：隔离 `userData`、bridge discovery 和调试端口，检查页面、控制台和媒体来源。
4. 安装包：检查 `win-unpacked` 启动、NSIS 静默安装、安装后启动、卸载和残留进程。

任何测试实例不得复用真实 `~/.agentic-island/bridge.json` 或用户 `userData`。

## 8. 提交前门禁

```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

涉及安装包、依赖、原生模块、资源或版本发布时，再执行 `npm run package` 和 `docs/RELEASE.md` 中的安装验证。
