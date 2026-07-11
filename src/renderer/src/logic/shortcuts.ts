// 快捷指令引擎：数据模型 + 变量插值 + 危险命令检测 + 多步执行 + 开发者高频预置。
// 纯逻辑、不 import electron/react —— 可被 raw-node 测试直跑；所有副作用经 RunCtx 注入。
// 设计聚焦：把灵动岛独有的资产（本地 Claude Code/Codex、你的仓库、剪贴板、终端）一键化，而不是搬通用小工具。

export type StepKind = 'shell' | 'open' | 'clipboard' | 'ai' | 'agent' | 'island' | 'input' | 'confirm'

export type ShortcutStep =
  | { kind: 'shell'; cmd: string; cwd?: string }
  | { kind: 'open'; target: string }
  | { kind: 'clipboard'; op: 'read' | 'write'; text?: string }
  | { kind: 'ai'; system: string; prompt: string }
  /** 本地 Agent：派 Claude Code / Codex 干活；useRepo=在选定仓库(%repo%)里执行 */
  | { kind: 'agent'; engine: 'claude' | 'codex'; prompt: string; useRepo?: boolean }
  | { kind: 'island'; action: 'todo' | 'note' | 'ask'; args: string }
  | { kind: 'input'; label: string }
  | { kind: 'confirm'; message: string }

export interface ShortcutDef {
  id: string
  icon: string
  name: string
  group: string
  desc?: string
  steps: ShortcutStep[]
  /** 目标仓库（%repo%）：空=运行时从「仓库」分区下拉选 */
  repoPath?: string
  /** 信任：shell 步骤免确认（危险命令仍强制确认） */
  trusted?: boolean
  builtin?: boolean
  runCount: number
  lastRun?: number
}

/** 危险命令模式：即使指令被标记"信任"也强制二次确认。
 *  第一支=系统破坏性命令词表；第二支=git 后续出现的危险子命令（push/clean/reset --hard/checkout -- 会丢改动或改远端）。 */
export const DANGEROUS_RE = /\b(rm|del|erase|rd|rmdir|format|diskpart|reg|shutdown|taskkill|remove-item|stop-process|set-executionpolicy|bcdedit|cipher|takeown|icacls)\b|\bgit\b[\s\S]*?\b(?:push|clean|reset\s+--hard|checkout\s+--)\b/i

/** 变量插值：%clip% 剪贴板 · %prev% 上一步输出 · %input% 运行时输入 · %repo% 选定仓库 · %date%/%time%
 *  （%home% 不在此展开——由主进程 shortcut-open 处理，渲染层拿不到用户目录） */
export interface RunVars { clip: string; prev: string; input: string; repo: string; date: string; time: string }
export function interpolate(tpl: string, v: RunVars): string {
  return tpl
    .replace(/%clip%/g, v.clip)
    .replace(/%prev%/g, v.prev)
    .replace(/%input%/g, v.input)
    .replace(/%repo%/g, v.repo)
    .replace(/%date%/g, v.date)
    .replace(/%time%/g, v.time)
}
/** 模板是否引用了剪贴板（决定要不要先读一次剪贴板） */
export const usesClip = (def: ShortcutDef): boolean =>
  def.steps.some((s) => JSON.stringify(s).includes('%clip%') || (s.kind === 'clipboard' && s.op === 'read'))
/** 指令是否需要目标仓库（agent useRepo 或任意模板引用了 %repo%） */
export const needsRepo = (def: ShortcutDef): boolean =>
  def.steps.some((s) => (s.kind === 'agent' && s.useRepo) || JSON.stringify(s).includes('%repo%'))

export interface RunLog {
  step: number
  kind: StepKind
  label: string
  output?: string
  ok: boolean
  error?: string
}

/** Agent 流式事件（简化内联，避免依赖 protocol） */
export interface AgentEvt { kind: string; text?: string; name?: string; detail?: string }

/** 执行环境：全部副作用由调用方（App/ShortcutsTab）注入 */
export interface RunCtx {
  ai: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  shell: (cmd: string, cwd?: string) => Promise<{ ok: boolean; output?: string; error?: string }>
  open: (target: string) => Promise<{ ok: boolean; error?: string }>
  /** 派本地 Agent；onEvent 实时回传思考/工具/正文供运行浮层显示 */
  agent: (engine: 'claude' | 'codex', prompt: string, cwd: string | undefined, onEvent?: (ev: AgentEvt) => void) => Promise<{ ok: boolean; text?: string; error?: string }>
  clipRead: () => Promise<string>
  clipWrite: (t: string) => void
  islandAction: (action: 'todo' | 'note' | 'ask', args: string) => string
  /** 运行时向用户要输入；null=取消 → 中止 */
  askInput: (label: string) => Promise<string | null>
  /** 让用户从仓库列表选一个；null=取消 → 中止 */
  askRepo: () => Promise<string | null>
  /** 危险/未信任 shell、或 confirm 步骤的确认闸；false=中止 */
  askConfirm: (message: string) => Promise<boolean>
  onLog: (l: RunLog) => void
  /** agent 步骤流式回调（运行浮层实时显示；null=当前无 agent 步骤） */
  onAgentLive?: (live: { text: string; tools: { label: string; detail?: string }[] } | null) => void
}

const stepLabel = (s: ShortcutStep): string => {
  if (s.kind === 'shell') return '🖥 脚本'
  if (s.kind === 'open') return '🔗 打开'
  if (s.kind === 'clipboard') return s.op === 'read' ? '📋 读剪贴板' : '📋 写剪贴板'
  if (s.kind === 'ai') return '✨ AI'
  if (s.kind === 'agent') return `◆ ${s.engine === 'claude' ? 'Claude Code' : 'Codex'}`
  if (s.kind === 'island') return s.action === 'todo' ? '✅ 建待办' : s.action === 'note' ? '🗂 存便签' : '💬 发问答'
  if (s.kind === 'confirm') return '⚠️ 确认'
  return '⌨ 输入'
}

/** 跑一条指令：步骤按序执行，%prev% 串联；任一步失败/取消即中止。返回是否全部成功。 */
export async function runShortcut(def: ShortcutDef, ctx: RunCtx): Promise<boolean> {
  const now = new Date()
  const v: RunVars = {
    clip: '', prev: '', input: '', repo: '',
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
  if (usesClip(def)) { try { v.clip = await ctx.clipRead() } catch { /* 留空 */ } }
  if (needsRepo(def)) {
    v.repo = (def.repoPath || '').trim()
    if (!v.repo) { const got = await ctx.askRepo(); if (!got) return false; v.repo = got }
  }

  for (let i = 0; i < def.steps.length; i++) {
    const s = def.steps[i]
    const label = stepLabel(s)
    const log = (ok: boolean, output?: string, error?: string): void => ctx.onLog({ step: i, kind: s.kind, label, output, ok, error })
    if (s.kind === 'input') {
      const got = await ctx.askInput(interpolate(s.label, v))
      if (got === null) { log(false, undefined, '已取消'); return false }
      v.input = got; v.prev = got; log(true, got)
    } else if (s.kind === 'confirm') {
      const okGo = await ctx.askConfirm(interpolate(s.message, v))
      if (!okGo) { log(false, undefined, '已取消'); return false }
      log(true, '已确认')
    } else if (s.kind === 'shell') {
      const cmd = interpolate(s.cmd, v)
      if (!def.trusted || DANGEROUS_RE.test(cmd)) {
        const okGo = await ctx.askConfirm(cmd)
        if (!okGo) { log(false, undefined, '已取消'); return false }
      }
      const r = await ctx.shell(cmd, s.cwd ? interpolate(s.cwd, v) : undefined)
      if (!r.ok) { log(false, r.output, r.error || '脚本失败'); return false }
      v.prev = (r.output || '').trim(); log(true, v.prev.slice(0, 6000))
    } else if (s.kind === 'open') {
      const target = interpolate(s.target, v)
      const r = await ctx.open(target)
      if (!r.ok) { log(false, undefined, r.error || '打开失败'); return false }
      log(true, target)
    } else if (s.kind === 'clipboard') {
      if (s.op === 'read') {
        try { v.clip = await ctx.clipRead() } catch { /* */ }
        v.prev = v.clip
        if (!v.clip.trim()) { log(false, undefined, '剪贴板是空的'); return false }
        log(true, v.clip.slice(0, 400))
      } else {
        const text = interpolate(s.text || '%prev%', v)
        ctx.clipWrite(text); v.prev = text; log(true, '已写入 ' + text.length + ' 字')
      }
    } else if (s.kind === 'ai') {
      const r = await ctx.ai(interpolate(s.system, v), interpolate(s.prompt, v))
      if (!r.ok || !r.text) { log(false, undefined, r.error || 'AI 调用失败'); return false }
      v.prev = r.text.trim(); log(true, v.prev)
    } else if (s.kind === 'agent') {
      const live = { text: '', tools: [] as { label: string; detail?: string }[] }
      ctx.onAgentLive?.(live)
      const r = await ctx.agent(s.engine, interpolate(s.prompt, v), s.useRepo ? v.repo : undefined, (ev) => {
        if (ev.kind === 'text') live.text += ev.text || ''
        else if (ev.kind === 'tool') live.tools.push({ label: ev.name || '工具', detail: ev.detail })
        ctx.onAgentLive?.({ text: live.text, tools: [...live.tools] })
      })
      ctx.onAgentLive?.(null)
      if (!r.ok || !r.text) { log(false, live.text || undefined, r.error || 'Agent 执行失败'); return false }
      v.prev = r.text.trim(); log(true, v.prev)
    } else if (s.kind === 'island') {
      const msg = ctx.islandAction(s.action, interpolate(s.args, v))
      v.prev = msg; log(true, msg)
    }
  }
  return true
}

// ── 预置：全部围绕开发者真实高频动作。删除后可用「恢复预置」找回。──
// git 命令用 `git -C "%repo%"` 显式指定仓库；只读的 git 步骤配合 trusted 免确认，写操作（commit）插 confirm 步骤显式确认。
const g = (sub: string): string => `git -C "%repo%" --no-pager ${sub}`

const LEGACY_PRESET_SHORTCUTS: ShortcutDef[] = [
  // ===== 剪贴板代码流（选中/复制即用）=====
  {
    id: 'p-diagnose', icon: '🩺', name: '报错诊断', group: '代码', builtin: true, runCount: 0,
    desc: '复制报错栈 → 一句话根因 + 可执行修复步骤',
    steps: [{ kind: 'clipboard', op: 'read' }, { kind: 'ai', system: '你是资深工程师。分析下面的报错：先用一句话说根因，再给 2-3 步具体可执行的修复方案（带命令/代码）。Markdown。', prompt: '%prev%' }]
  },
  {
    id: 'p-testgen', icon: '🧪', name: '写单元测试', group: '代码', builtin: true, runCount: 0,
    desc: '复制一段函数/模块 → 生成单元测试',
    steps: [{ kind: 'clipboard', op: 'read' }, { kind: 'ai', system: '为下面的代码写完整的单元测试：覆盖正常路径、边界、异常。自动识别语言并选用对应主流测试框架。只输出测试代码。', prompt: '%prev%' }]
  },
  {
    id: 'p-comment', icon: '📝', name: '加注释', group: '代码', builtin: true, runCount: 0,
    desc: '复制代码 → 补 JSDoc/关键注释 → 结果回写剪贴板',
    steps: [{ kind: 'clipboard', op: 'read' }, { kind: 'ai', system: '给下面的代码补上恰到好处的注释：函数级 JSDoc/docstring + 关键逻辑行内注释，不改代码本身，不过度注释。只输出加注释后的完整代码。', prompt: '%prev%' }, { kind: 'clipboard', op: 'write', text: '%prev%' }]
  },
  {
    id: 'p-review', icon: '🔍', name: 'Code Review', group: '代码', builtin: true, runCount: 0,
    desc: '复制代码/diff → 找 bug、风险与改进点',
    steps: [{ kind: 'clipboard', op: 'read' }, { kind: 'ai', system: '你是严格的 code reviewer。审查下面的代码：列出潜在 bug、边界问题、安全/性能风险、可读性改进。按「🔴严重/🟡建议/🟢可选」分级，每条指出位置与改法。Markdown。', prompt: '%prev%' }]
  },
  {
    id: 'p-explain', icon: '📖', name: '解释代码', group: '代码', builtin: true, runCount: 0,
    desc: '复制看不懂的代码 → 逐段讲解 → 存便签',
    steps: [{ kind: 'clipboard', op: 'read' }, { kind: 'ai', system: '逐段讲解下面的代码在做什么：整体作用一句话，再按逻辑块解释，指出关键技巧与坑。Markdown，简体中文。', prompt: '%prev%' }, { kind: 'island', action: 'note', args: '代码解读 %date%\n%prev%' }]
  },
  {
    id: 'p-json2ts', icon: '🔤', name: 'JSON 转类型', group: '代码', builtin: true, runCount: 0,
    desc: '复制一段 JSON → 生成 TypeScript 类型 → 回写剪贴板',
    steps: [{ kind: 'clipboard', op: 'read' }, { kind: 'ai', system: '把下面的 JSON 转成精确的 TypeScript interface/type（合理命名、可选字段用 ?、联合类型识别）。只输出类型定义。', prompt: '%prev%' }, { kind: 'clipboard', op: 'write', text: '%prev%' }]
  },
  // ===== 说需求 → 生成（命令/正则/SQL）=====
  {
    id: 'p-nl2cmd', icon: '🖥', name: '说需求跑命令', group: '代码', builtin: true, runCount: 0,
    desc: '用大白话说要干啥 → AI 生成 PowerShell → 确认后执行',
    steps: [{ kind: 'input', label: '想让命令行做什么？（如：找出当前目录下最大的 5 个文件）' }, { kind: 'ai', system: '把用户需求转成一条可直接运行的 Windows PowerShell 命令。只输出命令本身，单行优先，不要解释、不要 ``` 包裹。', prompt: '%input%' }, { kind: 'shell', cmd: '%prev%' }]
  },
  {
    id: 'p-nl2regex', icon: '#️⃣', name: '说需求写正则', group: '代码', builtin: true, runCount: 0,
    desc: '描述要匹配什么 → 生成正则 → 回写剪贴板',
    steps: [{ kind: 'input', label: '要匹配/提取什么？' }, { kind: 'ai', system: '根据需求生成一个正则表达式，只输出正则本身（不带斜杠分隔符、不带解释）。', prompt: '%input%' }, { kind: 'clipboard', op: 'write', text: '%prev%' }]
  },
  {
    id: 'p-nl2sql', icon: '🗄', name: '说需求写 SQL', group: '代码', builtin: true, runCount: 0,
    desc: '描述查询 → 生成 SQL → 回写剪贴板',
    steps: [{ kind: 'input', label: '要查什么？（可先粘表结构再描述）' }, { kind: 'ai', system: '根据需求生成标准 SQL 查询，字段/表名合理推断。只输出 SQL 本身。', prompt: '%input%' }, { kind: 'clipboard', op: 'write', text: '%prev%' }]
  },
  // ===== Git 工作流（选仓库）=====
  {
    id: 'p-commit', icon: '✅', name: 'AI 提交', group: 'Git', builtin: true, runCount: 0, trusted: true,
    desc: '暂存全部 → AI 按 Conventional Commits 写信息 → 确认后提交',
    steps: [
      { kind: 'shell', cmd: `git -C "%repo%" add -A; ${g('diff --cached --stat')}; echo '=== diff ==='; ${g('diff --cached')}` },
      { kind: 'ai', system: '你是 git 提交助手。根据下面的暂存改动，写一条 Conventional Commits 规范的提交信息：首行 `<type>: <简明中文描述>`（type ∈ feat/fix/refactor/docs/test/chore/perf/ci，≤50字，不带引号），如有必要空一行再写要点。只输出提交信息本身。', prompt: '%prev%' },
      { kind: 'confirm', message: '即将提交：\n\n%prev%' },
      // PowerShell 单引号字符串可跨行；规范 commit 首行极少含单引号，且上一步已 confirm 全文
      { kind: 'shell', cmd: `git -C "%repo%" commit -m '%prev%'` }
    ]
  },
  {
    id: 'p-pr', icon: '📋', name: 'PR 描述', group: 'Git', builtin: true, runCount: 0, trusted: true,
    desc: '当前分支 vs main 的改动 → 生成 PR 标题+描述 → 存便签',
    steps: [
      { kind: 'shell', cmd: `${g('log --oneline main..HEAD')}; echo '=== diffstat ==='; ${g('diff --stat main..HEAD')}` },
      { kind: 'ai', system: '根据下面的提交历史与改动统计，写一份 PR：# 标题（一行）、## 变更摘要、## 主要改动（要点）、## 测试要点（- [ ] 清单）。Markdown，简体中文。', prompt: '%prev%' },
      { kind: 'island', action: 'note', args: 'PR 描述 %date%\n%prev%' }
    ]
  },
  {
    id: 'p-diffread', icon: '🔬', name: 'diff 解读', group: 'Git', builtin: true, runCount: 0, trusted: true,
    desc: '未提交改动 → AI 讲清这次改了啥、有无风险',
    steps: [{ kind: 'shell', cmd: g('diff') }, { kind: 'ai', system: '解读下面这段 git diff：一句话总述这次改动的意图，再按文件/主题说明改了什么，最后指出可能的风险或遗漏。Markdown，简体中文。', prompt: '%prev%' }]
  },
  {
    id: 'p-repostat', icon: '📊', name: '仓库速览', group: 'Git', builtin: true, runCount: 0, trusted: true,
    desc: '选定仓库的当前状态 + 最近 5 条提交',
    steps: [{ kind: 'shell', cmd: `${g('status -sb')}; echo '=== 最近提交 ==='; ${g('log -5 --pretty=format:"%h %ad %s" --date=short')}` }]
  },
  // ===== 本地 Agent 派活（选仓库 + 引擎可切）=====
  {
    id: 'p-fixerror', icon: '🔧', name: '报错交给 Agent 修', group: 'Agent', builtin: true, runCount: 0,
    desc: '复制报错栈 → 派本地 Agent 在选定仓库里定位并修复',
    steps: [{ kind: 'clipboard', op: 'read' }, { kind: 'agent', engine: 'claude', useRepo: true, prompt: '这是我遇到的报错，请在当前仓库里定位根因并直接修复它，改完简述你改了什么、为什么。报错如下：\n\n%prev%' }]
  },
  {
    id: 'p-testfix', icon: '🧯', name: '跑测试并修复', group: 'Agent', builtin: true, runCount: 0,
    desc: '派本地 Agent 在选定仓库跑测试，失败就改到绿',
    steps: [{ kind: 'agent', engine: 'claude', useRepo: true, prompt: '请在当前仓库里运行测试（自行判断测试命令，如 npm test / pytest 等）。如果有失败项，逐一定位并修复，直到测试全部通过。最后汇报：跑了什么命令、修了哪些、当前是否全绿。' }]
  },
  {
    id: 'p-implement', icon: '✍️', name: '一句话改代码', group: 'Agent', builtin: true, runCount: 0,
    desc: '说一句需求 → 派本地 Agent 在选定仓库里实现',
    steps: [{ kind: 'input', label: '要 Agent 做什么改动？（越具体越好）' }, { kind: 'agent', engine: 'claude', useRepo: true, prompt: '请在当前仓库里完成这个改动：%input%。遵循仓库现有风格，改完简述涉及的文件与要点。' }]
  },
  {
    id: 'p-summarize', icon: '🧭', name: '总结最近改动', group: 'Agent', builtin: true, runCount: 0,
    desc: '派本地 Agent 看最近提交，总结改了啥、审查风险',
    steps: [{ kind: 'agent', engine: 'claude', useRepo: true, prompt: '请查看当前仓库最近的提交与改动（git log/diff），总结最近做了哪些事、当前进展，并指出你注意到的潜在风险或待办。简体中文。' }]
  }
]

/** 旧版内置指令，仅用于一次性迁移；用户自定义指令不受影响。 */
export const LEGACY_PRESET_IDS = new Set(LEGACY_PRESET_SHORTCUTS.map((x) => x.id))

/**
 * v2 默认工作流：围绕用户真实工程链路，而不是通用文本小工具。
 * 只读审查与报告默认不修改仓库；修复/实现类明确交给本地 Agent，并在运行浮层持续展示步骤。
 */
export const PRESET_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'wf-project-audit', icon: '◫', name: '项目全量体检', group: '开发验收', builtin: true, runCount: 0,
    desc: '识别技术栈，检查构建、测试、依赖、安全与未完成项，输出分级报告',
    steps: [{ kind: 'agent', engine: 'codex', useRepo: true, prompt: '请对当前仓库做一次只读全量体检，不要修改文件。先识别技术栈和项目目标，再检查：启动/构建/测试是否可运行、明显 bug、未完成 TODO、依赖与安全风险、架构债务、缺失测试和产品体验问题。按 P0/P1/P2 分级，必须给文件位置和可执行建议。最后列出最值得先做的 5 项。简体中文。' }]
  },
  {
    id: 'wf-quality-gate', icon: '✓', name: '质量门禁并修复', group: '开发验收', builtin: true, runCount: 0,
    desc: '自动识别 typecheck/test/build 命令，失败则定位修复并复验',
    steps: [{ kind: 'agent', engine: 'codex', useRepo: true, prompt: '请作为发布前质量门禁执行者：读取仓库说明并自动识别正确命令，依次运行静态检查、相关测试和生产构建。遇到失败先复现和定位，再做最小修复；不要改无关代码。修复后重跑全部相关检查，最终汇报每条命令和结果。' }]
  },
  {
    id: 'wf-regression-design', icon: '⌁', name: '补回归测试', group: '开发验收', builtin: true, runCount: 0,
    desc: '针对一个问题补最小复现、回归测试与边界覆盖',
    steps: [
      { kind: 'input', label: '要防止哪个问题再次出现？请描述现象或粘贴报错。' },
      { kind: 'agent', engine: 'codex', useRepo: true, prompt: '请针对以下问题建立可靠的回归测试：%input%。先找到稳定复现方式和根因，再按仓库现有测试体系补测试；只在必要时修复实现。覆盖关键边界，运行相关测试并汇报结果。' }
    ]
  },
  {
    id: 'wf-change-review', icon: 'Δ', name: '提交前变更审查', group: 'Git交付', builtin: true, runCount: 0,
    desc: '审查未提交改动的缺陷、回归、遗漏测试和越界修改',
    steps: [{ kind: 'agent', engine: 'codex', useRepo: true, prompt: '请只读审查当前未提交改动。重点找真实 bug、行为回归、安全风险、缺失测试和超出需求的修改；不要泛泛评价代码风格。 findings 按严重度排序，引用文件和行号；最后给出是否适合提交的明确结论。不要修改文件。' }]
  },
  {
    id: 'wf-delivery-note', icon: '↗', name: '生成交付说明', group: 'Git交付', builtin: true, runCount: 0, trusted: true,
    desc: '基于状态、变更统计和提交记录生成可直接使用的交付说明',
    steps: [
      { kind: 'shell', cmd: `${g('status -sb')}; echo '=== DIFF STAT ==='; ${g('diff --stat')}; echo '=== RECENT ==='; ${g('log -8 --oneline')}` },
      { kind: 'ai', system: '你是工程交付负责人。根据仓库状态生成简洁中文交付说明：结论、主要改动、验证结果待填写项、已知风险、部署/使用注意事项。不得编造未提供的测试结果。Markdown。', prompt: '%prev%' },
      { kind: 'island', action: 'note', args: '项目交付说明 %date%\n%prev%' }
    ]
  },
  {
    id: 'wf-branch-summary', icon: '⑂', name: '分支影响分析', group: 'Git交付', builtin: true, runCount: 0,
    desc: '分析当前分支相对主分支的接口、数据、测试和发布影响',
    steps: [{ kind: 'agent', engine: 'codex', useRepo: true, prompt: '请分析当前分支相对默认主分支的全部影响，不修改文件。先确定比较基线，再检查接口/协议、持久化数据、配置、构建产物、用户行为和测试影响。输出：变更地图、兼容性风险、需要补的验证、回滚关注点。引用具体文件。' }]
  },
  {
    id: 'wf-implement', icon: '◆', name: '实现工程需求', group: 'Agent协作', builtin: true, runCount: 0,
    desc: '带仓库上下文完成需求、验证并汇报，不停在方案阶段',
    steps: [
      { kind: 'input', label: '要完成什么需求？请写清目标、范围和验收标准。' },
      { kind: 'agent', engine: 'codex', useRepo: true, prompt: '请在当前仓库完整实现以下需求：%input%。先读取项目约束与相关实现，明确可验证的完成标准，然后实施最小范围改动，补必要测试并运行验证。不要只给方案；最终汇报改动、验证和剩余风险。' }
    ]
  },
  {
    id: 'wf-debug', icon: '⌖', name: '定位并修复故障', group: 'Agent协作', builtin: true, runCount: 0,
    desc: '读取剪贴板中的错误或现象，复现、定位、修复并回归',
    steps: [
      { kind: 'clipboard', op: 'read' },
      { kind: 'agent', engine: 'codex', useRepo: true, prompt: '以下是故障现象或错误日志：\n\n%prev%\n\n请在当前仓库先稳定复现，再缩小范围并证明根因，做最小正确修复，补回归测试并运行相关验证。不要用吞异常或关闭检查掩盖问题。' }
    ]
  },
  {
    id: 'wf-simulink-audit', icon: '▦', name: '模型工程审查', group: 'MATLAB/Simulink', builtin: true, runCount: 0,
    desc: '审查 .slx/.m/.prj 的结构、接口、布局、可测试性与规范风险',
    steps: [{ kind: 'agent', engine: 'codex', useRepo: true, prompt: '请只读审查当前 MATLAB/Simulink 工程，不要修改模型。盘点 .prj/.slx/.m、模型依赖、接口、数据字典、测试与生成物；重点检查显式 Inport/Outport、Goto/From 滥用、布局可读性、Stateflow 适用性、MAB/JMAAB 风险、MIL 可测性和缺失需求追踪。给出按优先级排序的整改清单与具体模型/文件位置。' }]
  },
  {
    id: 'wf-swrs-model-plan', icon: '≡', name: 'SWRS 到模型计划', group: 'MATLAB/Simulink', builtin: true, runCount: 0,
    desc: '结合仓库需求和现有模型，生成可执行的建模、接口与测试计划',
    steps: [
      { kind: 'input', label: '目标需求/子系统是什么？可填写需求编号或文件名。' },
      { kind: 'agent', engine: 'codex', useRepo: true, prompt: '请基于当前仓库中的 SWRS、现有 Simulink 模型与项目库，为“%input%”制定可执行建模计划。必须包含：需求到模型映射、父层接口与子系统显式 Inport/Outport、核心算法/状态逻辑、信号与标定、布局原则、MIL 测试用例、验收标准和风险。不要修改文件。' }
    ]
  },
  {
    id: 'wf-requirement-trace', icon: '⇄', name: '需求一致性审查', group: '需求文档', builtin: true, runCount: 0,
    desc: '核对 SWRS、SWDD、接口、代码/模型与测试之间的缺口',
    steps: [{ kind: 'agent', engine: 'codex', useRepo: true, prompt: '请对当前项目做需求一致性审查，不修改文件。建立 SWRS/SWDD/接口定义/代码或模型/测试之间的追踪关系，找出缺失、冲突、歧义、不可测试条目和实现漂移。输出追踪摘要、问题清单、受影响文件、建议动作与验收方法；无法确认的内容明确标注未知。' }]
  },
  {
    id: 'wf-review-actions', icon: '☑', name: '审查记录转行动项', group: '需求文档', builtin: true, runCount: 0,
    desc: '把剪贴板里的评审/会议记录整理成责任清晰的行动项',
    steps: [
      { kind: 'clipboard', op: 'read' },
      { kind: 'ai', system: '你是工程项目经理。从评审或会议记录中只提取可执行行动项，保留责任人、对象、截止时间、依赖和验收标准；信息缺失标记“待确认”。按项目/主题分组，输出 Markdown 复选清单，不要编造。', prompt: '%prev%' },
      { kind: 'island', action: 'note', args: '评审行动项 %date%\n%prev%' }
    ]
  }
]

/** AI 大白话造指令：把用户的自然语言需求变成一条 ShortcutDef（steps JSON）。 */
export const GEN_SYSTEM =
  '你是"快捷指令"生成器。用户用大白话描述一个想一键完成的重复操作，你输出一条指令的 JSON（只输出 JSON，不要解释、不要 ``` 包裹）。\n' +
  '结构：{"icon":"emoji","name":"简短名","group":"开发验收|Git交付|Agent协作|MATLAB/Simulink|需求文档|自定义","desc":"一句话","steps":[...]}。\n' +
  'step 类型与字段：\n' +
  '- {"kind":"input","label":"问用户什么"}\n' +
  '- {"kind":"clipboard","op":"read"} 读剪贴板 / {"kind":"clipboard","op":"write","text":"%prev%"} 写剪贴板\n' +
  '- {"kind":"ai","system":"给AI的指示(只输出结果)","prompt":"%prev%"} AI 文本变换\n' +
  '- {"kind":"shell","cmd":"PowerShell命令"} 跑脚本\n' +
  '- {"kind":"open","target":"https://… 或 路径"} 打开\n' +
  '- {"kind":"agent","engine":"claude","useRepo":true,"prompt":"派本地Agent干的活"} 让 Claude Code/Codex 在选定仓库执行\n' +
  '- {"kind":"island","action":"todo|note|ask","args":"内容(便签首行=标题)"} 建待办/存便签/发问答\n' +
  '- {"kind":"confirm","message":"确认提示"} 危险操作前确认\n' +
  '变量：%clip% 剪贴板 · %prev% 上一步输出 · %input% 询问的输入 · %repo% 选定仓库 · %date%/%time%。\n' +
  '尽量少步骤、直达目的。涉及仓库/代码执行用 agent 或 git（git 用 `git -C "%repo%"`）。'

/** 解析 AI 返回的指令 JSON → ShortcutDef（校验字段，容错剥离 ``` 包裹） */
export function parseGenerated(raw: string): ShortcutDef | null {
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = t.indexOf('{'); const b = t.lastIndexOf('}')
  if (a !== -1 && b !== -1) t = t.slice(a, b + 1)
  try {
    const o = JSON.parse(t) as Partial<ShortcutDef>
    if (!Array.isArray(o.steps) || !o.steps.length) return null
    const ok = new Set<StepKind>(['shell', 'open', 'clipboard', 'ai', 'agent', 'island', 'input', 'confirm'])
    const steps = o.steps.filter((s) => s && ok.has((s as ShortcutStep).kind)) as ShortcutStep[]
    if (!steps.length) return null
    return {
      id: 'g' + (o.name || 'gen'),
      icon: (o.icon || '⚡').slice(0, 4),
      name: (o.name || 'AI 生成指令').slice(0, 24),
      group: ['开发验收', 'Git交付', 'Agent协作', 'MATLAB/Simulink', '需求文档', '自定义'].includes(o.group || '') ? o.group! : '自定义',
      desc: (o.desc || '').slice(0, 60),
      steps,
      runCount: 0
    }
  } catch { return null }
}
