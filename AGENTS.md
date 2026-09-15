# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 仓库现状（先读这一段）

这**已经不是设计交付包**，而是一个功能完整、可打包安装的 Windows 桌面应用 **Agentic-Island（灵动岛）**：常驻屏幕顶部的 AI 编码 Agent 监控/审批/协作面板 + 个人工作台。技术栈 **Electron 39 + React 19 + TypeScript**（electron-vite 构建，Vite 锁在 5.x）。已产出 NSIS 安装包（`dist/Agentic-Island-Setup-*.exe`）。

历史设计交付包不属于当前运行时源码；当前行为以 `src/`、`scripts/`、`docs/` 和自动化测试为准。

## 常用命令

```bash
npm run dev          # 开发运行（app ready 会自动安装全局 hooks；AIISLAND_SKIP_HOOKS=1 可跳过）
npm run typecheck    # 两套 tsconfig（node=main/preload+shared, web=renderer+shared）
npm test             # 顺序执行 42 个离线 test-*.ts（排除真实 Claude 登录探针）
npm run build        # electron-vite 三端构建
npm run package      # NSIS 安装包（原生模块经 asarUnpack **/*.node）
npm run verify:package # 隔离启动 unpacked、静默安装/启动/卸载 NSIS
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
node --experimental-strip-types scripts/test-quote.ts       # 问答上下文、分支与知识沉淀
node --experimental-strip-types scripts/test-methodologies.ts # 回答方法与气泡分析方法目录
node --experimental-strip-types scripts/test-providers.ts   # 模型目录迁移与供应商配置隔离
node --experimental-strip-types scripts/test-external-yield.ts # 外部应用让位
node --experimental-strip-types scripts/test-shortcuts.ts   # 快捷编排与安全闸
node --experimental-strip-types scripts/test-todo.ts        # 待办规划/统计/导入导出
node --experimental-strip-types scripts/test-recording.ts   # 录屏几何、时钟、字幕与 FFmpeg 参数
node --experimental-strip-types scripts/test-recording-session.ts # 分片落盘与异常恢复
node --experimental-strip-types scripts/test-recording-project.ts # v2 工程保存、复制与迁移
node --experimental-strip-types scripts/test-recording-export-e2e.ts # 真实 FFmpeg 导出
node --experimental-strip-types scripts/test-terminal-workspace.ts # 终端现场迁移、加密与脱敏
node --experimental-strip-types scripts/test-terminal-project.ts # 项目任务发现与健康检查
npm run audit:terminal # 隔离 Electron 验证输入、退出码、危险确认与恢复
npm run audit:ask      # 隔离 Electron 验证回答方法、气泡分析与窄宽布局
npm run audit:contrast # 全岛像素级对比度审计（2 主题 × 11 分区，硬失败线 3.0）
npm run audit:recording # 隔离实例真录一段：容器/扩展名/时长/应用内播放断言
npm run audit:screenshot # 隔离实例跑通截图工坊批量美化（含成品像素比对）
npm run bench:recording # 导出基准：直通封装 vs 软件编码 vs 各硬件编码器
```

## 架构总览

```
Claude Code (CLI/桌面端) ──hooks──► src/hooks-bin/cc-forward.mjs ──HTTP 127.0.0.1──►┐
Codex (CLI/桌面端) ────rollout 日志──► src/main/codex-tail.ts（轮询跟随）──────────────►│
                                                                                    ▼
              ┌────────────────────── Electron 主进程 (src/main) ──────────────────────┐
              │ bridge-server  本地桥(随机端口+token→~/.agentic-island/bridge.json,    │
              │                15s 自愈防覆盖)；permission 事件阻塞至用户裁决           │
              │ agents-store   Agent 状态机(会话键=backend:sessionId；SessionEnd 即移除)│
              │ hook-installer 合并式安装/卸载 ~/.claude/settings.json + ~/.codex hooks │
              │ term-pty       真 PTY 终端(@lydell/node-pty N-API, ConPTY, 多会话)      │
              │ calendar-ics / calendar-caldav  飞书日历(CalDAV multiget 两段式)        │
              │ rss / media(SMTC) / clipboard-watch / sound / llm-proxy / git-summary  │
              │ recording-session / project / export  分片落盘、工程与 FFmpeg 导出    │
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
- **Claude Code 接入**：全生命周期 hooks（SessionStart/UserPromptSubmit/PreToolUse/Stop/Notification/SessionEnd）。PreToolUse 对非只读工具**阻塞审批**（stdout 返回 permissionDecision）；deny 理由回传实现接力 steer；ExitPlanMode→计划审阅；Stop→"等待回复"+ transcript 尾部提取最后回复 + turnEnd 触发 git 小结。
- **Codex 接入**：rollout 日志跟随为主（`~/.codex/sessions/**/rollout-*.jsonl`，只监控无审批，15min 空闲自动归档）；hooks 桌面端实测会触发（审批可用），CLI 不触发。**CLI/桌面端无法区分**（originator 恒为 codex-tui），统一标 "Codex"。
- **专业录屏**：`ScreenRecorderStudio.tsx` 负责采集、Canvas 合成与工作台；`logic/recording.ts` 是坐标/时钟/字幕纯逻辑；主进程 `recording-session-store.ts`、`recording-project-store.ts`、`recording-export.ts` 负责磁盘会话、工程和 FFmpeg。

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
11. **录制容器与导出路径**：录制优先 `video/mp4;codecs=avc1.640033`（H.264），WebM/VP9 逐级回退——MP4 容器的时长与帧率**可信**，而 MediaRecorder 的 WebM 没有 Duration、且 `tbr` 是时基（实测 `1k`），导出时只能猜帧率（"导出画面飞快跑完"的根因）。导出按需分流：无剪辑且容器相同 → `-c:v copy` + 音频转 AAC（秒级）；单段裁剪 → `-ss/-t` 输入定位；多段/跨容器/GIF/MP3 → 重编码。硬件编码必须先**试编码计时**（`h264_amf` 会出现在 `-encoders` 里但运行期 DLL 缺失；`h264_qsv` 在核显机器上比软件还慢），只有明确快 15% 才采用——入口 `npm run bench:recording`。**导出完成必须以"读回成品元数据"为准**（`probeRecordingOutput` + `recordingExportVerdict`，提示里直接给 `自检通过（8.8s · 30fps · H264）`）：这个项目被"文件写成功但内容不对"坑过两次，所以别信 FFmpeg 正常退出，也别让导出异常静默（`exportRecording` 的 IPC 调用必须有 try/catch，否则按钮就是"点了没反应"）。
12. **原生依赖只用 N-API 预编译包**（@lydell/node-pty）——避免依赖用户机 node-gyp、Python 与 Visual Studio 构建链。
13. **外网请求走 electron `net.fetch`**（继承系统代理）；Node 全局 fetch 不认代理（GitHub API 等会连不上）。
14. **录屏定位框与成片必须共用源裁剪参数**：显示器/窗口先以实际媒体轨尺寸为准，区域、`contain/cover` 和运镜统一走 `recordingFitComposition` / `recordingFocusCrop`；控制条收起只能隐藏工作台，不能卸载 Canvas。
15. **拍摄与后期分离（光标事件日志）**：录制期只以 12.5Hz 采样光标（`startCursorLog`，80ms 一次）落进工程的 `cursorTrack`，运镜与光标美化属于导出期的事——轨迹事后无法补录，**不要按 `displayId` 过滤采样**：光标停在另一块屏时整条轨迹会变空（隔离审计里表现为"时有时无"），坐标钳到录制画面边缘才是正确语义（被录画面确实没动，就该算空白）。相机平滑一律用 `recordingLerpTimed`（按真实帧间隔 + 目标帧长换算 α）；固定每帧系数在掉帧时会让跟随变慢。破坏性剪辑（"剪除空白"）必须**两段式**：先算方案给人看数字、再确认落地——审计里合成光标 8.2s 曾因一次点击被剪到 2s。工程落盘前按 60k 点上限等间隔抽稀。
16. **导出期运镜（zoompan 表达式）**：`request.motion` 是**按成片帧序**给逐帧相机路径（`{x,y,zoom}`），渲染层用 `recordingMotionFrames` 从轨迹+剪辑段重建，主进程 `buildRecordingMotionFilter` 压成折线航点再编译成 FFmpeg 表达式。四条实测结论：① `sendcmd` 驱动不了 `crop` 的 x/y（命令解析成功、裁剪位置不动），所以只能走表达式；② `zoompan` 的表达式里**没有 `t`**（报 Undefined constant），时间轴只能用帧序 `in`；③ 文件输入时 zoompan 的输出时间戳停在 15360 时基，后面再挂 `fps` 滤镜会被读成 15360fps 并复制帧凑数（3 秒素材导出成 25 分 36 秒），**帧率归一化必须放在 zoompan 之前**；④ 代价 +24%（1600p→1080p 十秒 1.93s vs 1.56s）。能力边界：只有录制时运镜**关闭**（`exportMotionReady`，画面稳定）的素材才能在导出期重建运镜，否则与烤进画面的运镜叠加成双重运镜；导出侧档位必须独立（`exportMotionMode`），借用采集页档位会永远得到 zoom=1 的平路。**跨画幅时**（目标画幅 ≠ 素材画幅）先按铺满裁齐再取景：`recordingMotionCoverCrop` 算归一化窗口、`remapRecordingMotionFrames` 把路径映射进去、主进程 `buildRecordingMotionCropFilter` 插在 fps 之后 zoompan 之前——顺序不能反（zoompan 的取景窗口永远保持输入宽高比，不裁齐会拉伸）。这类"预期行为"要写进自检**摘要**而不是 warnings，否则会把自检误报成"有疑问"。**导出期光晕同理但时间轴相反**：`overlay` 的表达式里**只有 `t`、没有 `in`**（与 zoompan 正好互补），同一套折线航点编译器要按目标滤镜编译两种时间轴；且带光晕的导出**不能走 `-c:v copy`**（要重新叠图）。光斑只支持"大而软"的圆——细光环需要逐帧精确跟踪，表达式做不到；角标的位置同理**直接用像素常数**，别写 `max/min` 表达式（实测 `Failed to parse expression`）。
17. **原始画面采集（`captureMode: 'raw'`）**：桌面轨道直接进编码器，不建画布、不跑渲染循环，`size` 用屏幕原生尺寸（`recordingRawCaptureSize`）。**实测（同一活动画面）：合成 22.4fps@1920×1080 → 原始 29.8fps@2560×1600**——多 33% 像素还多 33% 帧。代价是画布类能力全部要在导出期补：`recordingRawModeBlockers` 逐项列出区域/画中画/水印/隐私条为什么必须画布（**画幅不在其中**：`buildRecordingAspectFilters` 已能在导出期按 `fit` 补黑边或裁切，成片尺寸按导出页自己的「画布」档算，默认跟随素材）（鼠标光晕与轨迹**不**算阻塞项：切过去就不画，顺手关掉即可）。**桌面采集是变化驱动的**：画面不动就不出帧（静止屏幕实测只有 1.11fps，那不是丢帧而是"屏幕没变"），所以导出时必须按目标帧率补齐，评估帧率也必须在**会变的画面**上测。
18. **测采集帧率时活动源必须来自另一个进程**：录制期间应用对**自己所有窗口**开 `setContentProtection`，岛自己窗口里跑的动画对采集器是隐形的——第一版审计把动画注入岛窗口，测出"原始 1.11fps"这种假阴性。现在审计另起一个独立 Electron 实例铺满主显示器做活动源（见 `audit-recording-container.mjs` 的 `activity-main.js`）。
19. **运镜点可编辑（导出期运镜的人工控制）**：`motionKeyframes`（素材时间轴 + 归一化坐标 + zoom）为空＝按光标轨迹自动运镜，非空＝按人工点重建。抽点按"人想改什么"设计（一段持续推近只给一个峰值点），并有三条硬规则：**长录制按 4 秒切段**（否则光标一直在动时整段录制只出一个点，等于不可编辑）、**相差 <400ms 视为同一时刻合并**（否则开场锚点与首个推近起点并排显示两行 00:00）、**开场锚点不可删**（路径需要明确的起始状态）。重建时关键帧之间不是直线插值而是同一套时间常数平滑，人工点稀疏时才不会在关键帧处折角。e2e 用"正向扫过 73→188、反向 188→74"作对照，证明取景真的跟着编辑走。
20. **清晰度：默认不得低于屏幕原生**。采集默认 `resolution: 'source'` + `aspect: 'source'`（曾默认 1080p+16:9，2560×1600 的屏被压成 1920×1080 画布、内容仅 1728×1080，全屏回放再放大 1.48 倍 → 小字必糊）；场景预设也不得偷偷降级。**截图不要用 `desktopCapturer` 缩略图出图**：它只能"按请求尺寸缩放"，而 `round(DIP × scaleFactor)` 在半像素缩放（1707×1.5 = 2560.5）下会取整成 2561，必然多一次重采样（实测锐度 84.9 → 64.1）。正确做法是主进程只藏岛+挑源（`prepareScreenCapture`，**匹配不上必须报错，绝不退到 `sources[0]`**——那会静默拍到另一块屏），取像素在渲染层走媒体流（`captureScreenNative`，与录制同链路，实测与 DPI-aware 的系统级抓图逐像素一致）。截图工坊的主入口走 Windows `ms-screenclip:` + 剪贴板，应用侧读取实测无损（2560×1600 进 2560×1600 出）。
21. **本机打包必须走镜像**：`electron-builder` 会同 GitHub 下载 electron zip（`connect ETIMEDOUT 20.205.243.166:443`），本机网络到 GitHub 不通、而 npm 走的是 npmmirror。本机打包前先设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 与 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`（2026-09-14 实测设上就成）。**不要把它硬编码进 package.json**：CI 跑在 GitHub runner 上，那边直连 GitHub 是通的，写死镜像反而给 CI 引入外部依赖。
22. **本地离线 OCR 走 Windows 自带引擎**（`src/main/local-ocr.ts`，`Windows.Media.Ocr` WinRT）：不出网、零新依赖。**PowerShell 双引号里的反引号是转义符**——`"IAsyncOperation`1"` 会被吃成 `IAsyncOperation1` 而筛不到方法（报"无法对 Null 数组进行索引"），这个类型名必须用单引号包。另外失败信息要带上脚本原始输出，否则只剩"没有返回结果"没法查。对比度审计：**9–10px 小字号不计入硬门禁**（笔画只有 1–2 像素宽，取到的极值像素多是抗锯齿混色，实测值随亚像素定位抖动，同一构建能跑出 0/3/4 条硬失败），但要单独列出供复核。
23. **滚动长截图（拼接引擎）**：`logic/scroll-capture.ts` 是纯逻辑（行指纹 + 多条探测带求众数），被 `scripts/test-scroll-capture.ts` 直接用 node 加载，所以**它不能有运行时 import**；需要 DOM/媒体流的抓帧会话拆在 `logic/scroll-capture-session.ts`（只被组件引用）。三条实测结论：① 探测带必须取**上半部**（滚过半屏时只有靠上的带子仍在重叠区，摊到下半部会把"滚了半屏以上"判成 0）；② 置信度按**能投票的带子**算（否则大位移只剩一条带子可匹配时被误判不可信）；③ `skipped` 只在"位移 0 且置信度低"时计数——"匹配上但没动"是用户停手，两回事。测试图必须带**行号相关的高频细节**：纯渐变在 8 位降采样后相邻行完全相同，位移会被测成差一行。
24. **截图入口是应用内框选叠层（`#snip`）**：点"截图工坊"或 `Ctrl+Alt+S` 弹自己的叠层（拖动选区、显示 DIP + 实际物理像素、回车确认、Esc/右键取消、点一下不拖即取消），确认后**主进程先隐藏叠层再请渲染层抓原生帧并按选区裁剪**——顺序不能反，否则暗底与选框会被拍进画面。选区是 DIP、抓到的帧是物理像素，换算必须用叠层自己那份 `scaleFactor`（不要用 `devicePixelRatio` 猜，多屏不同缩放时会错）。Windows 的 `ms-screenclip:` 只在叠层创建失败时兜底。新增浮窗类能力照 `openSticky` 范式，但记得补两件便利贴漏掉的事：纳入 `setAgenticWindowsTopmost` 托管、在 `onDisplayChange` 里重定位（钉屏截图已做）。
25. **指针/按键采集只在录制期间**（`src/main/mouse-hook.ts`，uiohook-napi 的 N-API 预编译包）：录屏时那块屏本来就在被逐像素记录，所以鼠标点击不引入新的隐私面；停止录制即卸载钩子。键盘**只取 `NAVIGATION_KEYS`（方向键/Enter/Tab/Esc…）与修饰键组合的标签**（`Ctrl+S` 这类，给导出期角标用），**可打印字符一个都不采**——所以角标永远不可能包含用户打出的文字，这条边界是硬约束，改动这个文件时必须保住。原生模块加载失败要静默降级（fail-open）。打包必须 `npmRebuild: false`——electron-builder 默认会用 node-gyp 从源码重编原生模块，本机没有构建链会直接打包失败（本项目只用 N-API 预编译包，跳过 rebuild 是正确选择）。
26. **审计实例可以免弹窗导出**：原生对话框没法用 CDP 关掉，否则那些链路在自动化里永远测不到。统一门槛是 `isAuditInstance()`（`AIISLAND_ALLOW_AUDIT_INSTANCE=1` + `AIISLAND_AUDIT_USER_DATA`，正常运行时两边都不成立），在这之上按用途分别开口：`AIISLAND_AUDIT_EXPORT_DIR` 让**保存框**（`showOwnedSaveDialog`）与**快存/批量落盘**（`save-image-quick`，否则每跑一次审计就往用户真实的"图片"文件夹里丢文件）直接落到指定目录；`AIISLAND_AUDIT_OPEN_PATHS`（`;` 分隔）充当**打开框**的选择结果，批量美化那条链路才谈得上端到端可验证。审计要用导出目录记得先 `mkdir`——目录不存在时导出会失败，而失败信息曾经被静默吞掉（见约束 11）。另有 `AIISLAND_AUDIT_PLACEHOLDER_SOURCES=1`：让 `recording-sources` 交一张**现画的示意画面**、窗口标题换成中性名——README 截图会进公开仓库，而"录制来源"那格预览拍的正是运行机器的桌面。
27. **审计断言失败先怀疑审计侧**：这个项目已经栽过两次"脚本自己瞎了、看起来像产品坏了"——① 审计在主屏铺的活动窗口让 Chromium 在 150% 缩放下把采集帧报成 DIP 尺寸（1706×1066 的假回退）；② `audit-recording-container.mjs` 探测视频轨时假定视频是 `#0:0`，改成带 `.*$` 的通配写法又漏了 `m` 标志（JS 里不带 `m` 的 `$` **只匹配整个输入的末尾**，中间那行永远匹配不到）。所以：能按行找就别用跨行正则，别假设流/字段顺序，**动手改产品之前先用隔离脚本复现一遍真实数据**——两次都是隔离复现才证明产品是好的。

## 数据与持久化

- 渲染层状态经 `save-state` IPC 持久化到 `userData/config.json`（DPAPI 加密，含 API Key/CalDAV 密码）。**水合只执行一次且覆盖式**（StrictMode 双调用曾致待办翻倍）。
- 运行时发现文件/缓存：`~/.agentic-island/`（bridge.json、events.log、sound.log、tc-*.json 终端句柄缓存）。终端开发现场单独保存在 Electron `userData/terminal-workspace.json`，Windows DPAPI 可用时整体加密；输出快照默认关闭。
- 录屏素材与工程：Electron `userData/recordings`、`userData/recording-projects`（分片 manifest + 非破坏编辑参数）。
- AI 能力统一走 `llm-proxy`（OpenAI 兼容 /chat/completions，多轮 history，deep 模式 3000 tokens，reasoning_content 捕获，多模态 parts 带图）。

## 工作约定

- 回复用简体中文；每轮改动跑 `typecheck + build` + 相关 test 脚本；安全分类器不可用导致无法编译时，人工核对并**如实告知未编译**。
- 用户显式要求才做 git 操作。改动追求最小 diff，匹配现有内联样式/OKLCH 写法。
- **`npm run verify:package` 与真实安装**：安装器走的是 NSIS「先卸载既有版本」的升级流程，且会沿用上次记录的安装目录，因此**隔离验证会把本机真实安装一起删掉**（2026-09-14 实测踩过）。脚本现在检测到真实安装时**跳过 NSIS 安装/卸载**，只验证 unpacked 构建（安装/卸载由 CI 干净 runner 覆盖）；另外验证实例必须用 `taskkill /T /F` 结束整棵进程树，残留的 Electron 子进程会让后续 NSIS 安装静默中止。
- **每次发版必须同步更新 README 与 CHANGELOG**：版本徽章、更新概览节、功能矩阵、离线测试数量、安装包文件名，并用 `npm run docs:capture` 重建真实截图（输出名随版本演进，如 `*-v067.png`，README 引用同步切换）。发布前跑一遍 capture 确认截图非空、版本号正确。
- 长期记忆（进度流水、根因复盘）在 auto-memory 的 `m1-status.md`，比本文件更细。
