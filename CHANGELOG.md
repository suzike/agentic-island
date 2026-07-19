# Changelog

本项目遵循语义化版本。日期使用 Asia/Shanghai。

## [0.3.0] - 2026-07-19

### Added

- 设置页显示器选择使用真实显示器列表（新增 `getDisplays` IPC，展示分辨率/DPI 缩放/主屏标记，替代硬编码双屏假图）。

### Changed

- **视觉体系 Apple（macOS/iOS）化**：层级从"1px 描边制"改为 Apple 填充制——新增 `fill(1-4)` 填充阶梯与 `hairline()` 发型线分隔（0.5px），卡片/容器全面去描边；圆角对齐 Apple 连续圆角阶梯（按钮 10/卡片 13/浮层 18/面板 28）；排版对齐 SF（标题负字距、iOS label 四级墨色、SF 字体栈优先）；分段控件改 iOS 滑动 thumb（layoutId 弹簧）、开关改 iOS 白钮、按钮改圆角矩形（新增 tinted 变体）；按压反馈改 iOS 式透明度下沉；设置/待办/观察清单等列表改 inset grouped 分组（行间 hairline 左缩进分隔，新增 `Group` 组件）。
- **前端视觉全面重设计**（功能零改动）：新建 `src/renderer/src/ui/` 设计系统——`tokens.ts`（层级表面/排版阶梯/间距圆角/语义色令牌，消费 OKLCH 主题变量）、`components.tsx`（Button/IconButton/Card/Chip/Badge/Input/Segmented/SectionHeader/EmptyState/Switch/Slider 共享组件库）、`motion.ts`（framer-motion 动效预设）、`icons.ts`（lucide 语义图标表）。
- 全部 11 个分区 + 12 个浮层/工作室 + 应用外壳（头部/Tab 栏/toast）重做到设计系统：emoji 图标全面替换为 lucide，Tab 栏改 layoutId 滑动胶囊指示器 + 分区图标，浮层统一 `surface.overlay()` + overlayPop 弹出，卡片入场统一 fadeScaleIn（仅 opacity/scale/filter，保留"禁 translate"约束）。
- 材质进阶：面板顶部极光氛围光 + 玻璃颗粒噪点层 + 底部渐变收边高光 + 主题色环境投影；Tab 栏下签名渐变分割线；主按钮 hover 流光；空态图标光晕；审批卡琥珀注意力脉冲；待处理 Tab 声呐环；滚动条悬停才浮现。
- 全屏模式恢复真全屏：窗口从工作区切到整个物理显示器（`display.bounds`，screen-saver 层级盖任务栏），退出回到工作区。
- 新增依赖 framer-motion（动效）；AmbientBar 迷你条材质与设计令牌对齐（动效体系不变）。
- 新增全局样式：文本选区主题色、输入焦点环（.ui-input）、滑块手柄（.ui-slider）、:focus-visible 焦点环、prefers-reduced-motion 降级。

### Fixed

- 问答思考过程重写为显式可折叠区块：头部可点击（字数提示 + 展开/收起 chevron），不再依赖不起眼的文字链；展开后 320px 内滚动，流式"思考中"视图保持最近几行自动跟随。
- 修复分区切换卡顿：全岛入场动画移除 filter: blur（透明窗口大树重绘掉帧根因），Tab 内容转场改 opacity-only 快速交叉淡化并去掉 AnimatePresence mode="wait"（新分区不再干等旧分区退出），列表 stagger 降频。
- **多显示器定位全面修复**：新增 display-added/removed/metrics-changed 监听，热插拔/改分辨率/改 DPI 后岛与挂件自动重定位；跨 DPI 屏 setBounds 增加 60ms 校验重试（修复 DIP 换算竞态导致的偏移）；启动时渲染层水合后权威同步一次多屏偏好（修复主进程默认 follow=true 与 UI 默认固定主屏不一致导致的跳屏）；桌面挂件/钉屏便签从锚主屏改为跟随岛所在显示器。

## [0.2.0] - 2026-07-11

### Added

- 新增快捷、复盘、仓库三个主分区，主工作台扩展到 11 个分区。
- 新增项目工作台数据模型，连接资讯、待办、快捷执行、运行记录和成果物。
- 新增本地 Claude Code/Codex CLI 问答引擎、实时步骤和继续会话。
- 新增本地知识库 RAG，支持文件夹、源码/文本、PDF、DOCX 和网页。
- 新增第二大脑、命令面板、闪念胶囊、截图工坊、屏幕分析、工程计算和学习中心。
- 新增每日复盘、周报、工作洞察、番茄钟、成长记录和自动化规则。
- 新增 GitHub 仓库浏览、搜索、README 摘要、收藏和本地 Git 仪表盘。
- 新增主题设计器、自定义主题、全屏工作台、桌面挂件、会议勿扰和歌词能力。

### Changed

- 快捷模块重构为工程工作流编排器，内置 12 条开发验收、Git、Agent、MATLAB/Simulink 和需求工作流。
- 待办升级为任务执行系统，增加看板、项目、依赖、验收、精力、工时、归档、批量处理、Markdown 导入导出和完整 AI 工具集。
- 灵感便签增加双链、关系图、模板、快照、放映、回收站、批量管理、桌面便签和 27 项管理工具。
- Markdown 工作台增加本地打开/保存、分栏/阅读、目录、查找替换、快照、Zen、PDF/HTML/文本导出和 AI 写作工具。
- 资讯升级为情报工作台，增加观察清单、信号、雷达、多源综合、关联推荐、项目归属、转待办和成果沉淀。
- 终端增加多会话管理、命令中心、历史/收藏、目录跟踪、输出搜索和大屏模式。
- 问答增加知识库模式、剪贴板图片/聚类、引用追问、气泡内追问和多模型切换。
- Electron 升级到 39，React 保持 19，Vite 保持 5.x。

### Fixed

- 统一网页、文件、文件夹、会议、本地 Markdown 和原生对话框的外部让位流程，避免透明置顶窗口覆盖目标应用。
- 修复 Agent 交互提醒链路、桥发现文件被测试覆盖、窗口宽度调整、中文 PowerShell 输出、SVG 主题色和卡片入场动画等问题。
- 强化设置原子写、坏配置备份、主题兜底和 StrictMode 单次水合。

### Security

- 快捷工作流新增危险命令分类和不可绕过的确认关口。
- 知识库、GitHub、LLM 与外部网络请求统一收口到主进程/preload 契约。
- 外部打开、原生对话框和最高层窗口控制统一进入 `ExternalYieldController`。

## [0.1.0] - 2026-07-03

- 首个公开版本：Agent 监控与审批、计划审阅、问答、待办、灵感便签、资讯、终端、设置和顶部迷你条。
