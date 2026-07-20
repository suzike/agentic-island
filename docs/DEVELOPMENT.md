# Agentic-Island 开发指南

本文档对应 `0.6.0`。产品功能以源码、`README.md`、`docs/ARCHITECTURE.md` 和自动化测试为准。

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
| `npm test` | 顺序执行 32 个离线测试脚本 |
| `npm run build` | 构建 main、preload 和 renderer |
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
- 不在仓库、日志、截图或测试数据中写入 API Key、密码、Token 和个人路径内容。
- Electron 审计、截图和安装验证实例必须设置隔离的 `AIISLAND_BRIDGE_FILE`；生产入口会把它传给 `BridgeServer`，不得覆盖真实 `~/.agentic-island/bridge.json`。

## 5. 问答与模型开发约束

- 问答活动分支的消息保存在 `threads.ask`，归档分支保存在 `askSessions`，活动分支元数据保存在 `activeAskBranch`；切换前必须整体归档当前分支。
- Fork 必须只复制选中节点以前的消息，并继承分支长期记忆与持续指令；分支合并只写入当前记忆，不覆盖现有消息。
- 所有模型请求统一使用 `historyFromThread` 处理钉选、排除、附件和记忆；新增入口不得自行拼接另一套上下文。
- 多模型会诊只使用已保存的供应商配置，候选回答保存在单条消息的 `variants` 中；采用候选后才替换该消息的主 `blocks`。
- 对话知识沉淀通过 `kbAddText` 进入主进程知识库，来源类型固定为 `conversation`，不得在渲染层伪造临时搜索结果。
- 供应商切换必须经过 `logic/providers.ts`，保证 model/Base URL/API Key 同步切换；上游错误进入 UI 前必须脱敏。
- 问答逻辑变更至少运行 `test-quote.ts`；供应商目录、迁移或密钥隔离变更至少运行 `test-providers.ts`。

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
