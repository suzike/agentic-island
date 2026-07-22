import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outputDir = process.env.AIISLAND_CAPTURE_DIR || join(root, 'screenshots')
const captureOnly = process.env.AIISLAND_CAPTURE_ONLY || ''
const profile = await mkdtemp(join(tmpdir(), 'agentic-island-docs-'))
const port = 9337

const now = Date.now()
const day = 86_400_000
const demoState = {
  theme: 'custom-1783443856012',
  // 用户自定义主题「林南橘」（夜幕紫玻璃 × 蜜橘暖光），截图统一以此主题采集
  customThemes: [{ key: 'custom-1783443856012', label: '林南橘', desc: '自定义主题', dot: 'oklch(0.78 0.14 75)', th: '75', th2: '265', ths: '262', cs: '1.06', css: '1.5', pl: '0.68' }],
  islandWidth: 760,
  settings: {
    autostart: false, multiMonitor: false, sound: false, silentBg: true,
    autoConnect: false, largeSize: true, claudeCli: true, claudeApp: true,
    codexCli: true, codexApp: true, clipWatch: false, ambientBar: false,
    meetingDnd: true, ruleMorning: true, ruleEvening: true, rulePomoCapsule: true,
    ruleMeetingNote: true, desktopWidget: false
  },
  workbenchProjects: [{
    id: 'docs-project', name: 'Agentic-Island v0.6.3', repoPath: 'C:\\Work\\Agentic-Island',
    objective: '完成桌面 Agent 工作台的产品化发布', status: 'active', colorHue: 155,
    createdAt: now - 12 * day, updatedAt: now
  }],
  activeProjectId: 'docs-project',
  todos: [
    { id: 1, text: '完成终端输入与目录选择发布回归', done: false, status: 'doing', priority: 1, projectId: 'docs-project', project: 'Agentic-Island v0.6.3', tags: ['发布', '终端'], energy: 'deep', acceptance: '连续输入无卡顿、无尺寸抖动，目录选择可确认并切换', estimate: 90, spent: 58, due: now + 3_600_000, createdAt: now - day },
    { id: 2, text: '复核模型与问答既有能力', done: false, status: 'todo', priority: 2, projectId: 'docs-project', project: 'Agentic-Island v0.6.3', tags: ['模型', '回归'], energy: 'normal', acceptance: '分支、气泡追问、模型切换和独立 RAG 保持通过', estimate: 45, createdAt: now - day },
    { id: 3, text: '更新架构图、截图与功能矩阵', done: true, status: 'done', priority: 2, projectId: 'docs-project', project: 'Agentic-Island v0.6.3', tags: ['文档'], estimate: 60, spent: 52, doneAt: now - 2_000_000, createdAt: now - 2 * day },
    { id: 4, text: '验证 NSIS 安装包与 SHA-256', done: false, status: 'todo', priority: 2, projectId: 'docs-project', project: 'Agentic-Island v0.6.3', tags: ['发布'], energy: 'light', estimate: 25, createdAt: now }
  ],
  notes: [
    { id: 11, emoji: '🧭', title: '产品原则', md: '## 不打断，但始终可控\n\n- Agent 状态必须实时可见\n- 外部操作时主动让出桌面焦点\n- 数据默认留在本机', color: 'sky', tags: ['产品', '原则'], pinned: true, createdAt: now - 4 * day, updatedAt: now },
    { id: 12, emoji: '🧠', title: '知识工作闭环', md: '资讯信号 → 待办行动 → 快捷执行 → 复盘沉淀。\n\n[[产品原则]]', color: 'violet', tags: ['工作流', '知识库'], starred: true, createdAt: now - 3 * day, updatedAt: now },
    { id: 13, emoji: '⚙️', title: '发布检查清单', md: '- [x] typecheck\n- [x] unit tests\n- [ ] NSIS installer\n- [ ] GitHub Release', color: 'mint', tags: ['发布'], later: true, createdAt: now - day, updatedAt: now }
  ],
  activeAskBranch: {
    id: 602, title: 'v0.6.3 发布决策', parentId: 601, forkAt: 1,
    memory: '当前目标是完成 v0.6.3 发布；必须保留气泡内追问和既有模块能力，并以真实测试和安装包为准。',
    instruction: '结论优先，风险按严重度排序；所有建议必须给出可执行验证方式。',
    createdAt: now - 180_000, updatedAt: now
  },
  askSessions: [{
    id: 601, title: '问答增强方案基线', createdAt: now - day, updatedAt: now - 200_000,
    memory: '围绕会话本身增强，不引入转待办、转便签、编辑重发或导出等偏离能力。',
    msgs: [
      { role: 'user', text: '问答模块应该围绕哪些核心能力增强？', ts: now - 260_000 },
      { role: 'agent', blocks: [{ t: 'p', text: '优先补齐分支探索、长期记忆、上下文控制、多模型协作和知识沉淀。' }], ts: now - 250_000 }
    ]
  }],
  askThread: [
    { role: 'user', text: '请基于当前代码和发布门禁，判断 v0.6.3 是否可以发布。', contextMode: 'pinned', ts: now - 120_000 },
    {
      role: 'agent',
      blocks: [{ t: 'think', text: '先核对会话分支、上下文注入、多模型讨论和知识库写入，再检查供应商协议、配置迁移与发布门禁。' }, { t: 'h', text: '发布判断' }, { t: 'p', text: '功能面已形成完整会话闭环，当前进入发布验证阶段。必须以类型检查、33 项离线测试、三端构建、真实 Electron 可视检查和 NSIS 安装验证全部通过作为放行条件。' }, { t: 'ul', items: ['分支 Fork、切换、合并和重要上下文持久化', '气泡内追问、分析附着和异步分支隔离', 'DeepSeek/Kimi/Claude 请求协议与配置迁移', '安装包、自动更新清单和 SHA-256 一致'] }],
      variants: [
        { id: 'deepseek-demo', label: 'DeepSeek · deepseek-v4-pro', blocks: [{ t: 'p', text: '建议按发布门禁逐项签收，任何一项失败都不创建标签。' }] },
        { id: 'kimi-demo', label: 'Kimi · kimi-k2.6', blocks: [{ t: 'p', text: '重点复核旧配置迁移与分支持久化，避免升级后丢失上下文。' }] }
      ],
      analyses: [{ id: 'critique-demo', action: 'critique', label: '检查漏洞', createdAt: now - 70_000, blocks: [{ t: 'p', text: '当前判断仍缺少真实账号的 Kimi Code 连通验证，因此只能放行本地构建，不能据此确认线上认证链路。' }] }],
      followups: [
        { role: 'user', text: '那本地阶段还缺哪一项？', ts: now - 60_000 },
        { role: 'agent', blocks: [{ t: 'p', text: '还需检查安装后首次启动、旧配置迁移和卸载清理。' }], ts: now - 50_000 }
      ],
      suggestions: ['检查本轮变更是否完整覆盖测试', '生成 v0.6.3 发布风险矩阵'],
      modelLabel: 'DeepSeek · deepseek-v4-pro',
      ts: now - 110_000
    }
  ],
  llm: {
    provider: 'deepseek', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-a-real-key',
    saved: [
      { id: 701, provider: 'deepseek', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-a-real-key', name: 'DeepSeek · deepseek-v4-pro' },
      { id: 702, provider: 'kimi-code', model: 'k3', baseUrl: 'https://api.kimi.com/coding/v1', apiKey: 'not-a-real-key', name: 'Kimi Code · k3' },
      { id: 703, provider: 'claude', model: 'claude-sonnet-5', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'not-a-real-key', name: 'Claude · claude-sonnet-5' }
    ],
    modelLists: { deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'], 'kimi-code': ['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3'], kimi: ['kimi-k2.6', 'kimi-k2.5'], qwen: ['qwen-plus'], openai: ['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-luna'], claude: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-fable-5', 'claude-haiku-4-5'], custom: [] },
    profiles: {
      deepseek: { model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-a-real-key' },
      'kimi-code': { model: 'k3', baseUrl: 'https://api.kimi.com/coding/v1', apiKey: 'not-a-real-key' },
      kimi: { model: 'kimi-k2.6', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'not-a-real-key' },
      openai: { model: 'gpt-5.6', baseUrl: 'https://api.openai.com/v1', apiKey: 'not-a-real-key' },
      claude: { model: 'claude-sonnet-5', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'not-a-real-key' }
    },
    providerCatalogVersion: 6
  },
  embeddingConfig: { model: 'text-embedding-3-small', baseUrl: 'https://api.openai.com/v1', apiKey: 'not-a-real-key' },
  feedSources: [
    { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml', enabled: true },
    { id: 'hn', name: 'Hacker News', url: 'https://hnrss.org/frontpage', enabled: true },
    { id: 'github', name: 'GitHub Blog', url: 'https://github.blog/feed/', enabled: true }
  ],
  feedItems: [
    { id: 'n1', title: 'Agent 工具调用进入可观测与可审计阶段', link: 'https://example.com/agent-observability', sourceName: 'OpenAI', pubDate: now - 2_000_000, brief: '从单次回答扩展到长任务执行后，权限、过程与结果追踪成为桌面 Agent 产品的基础能力。', summary: '文章讨论 Agent 在长任务、工具调用和人工审批中的可观测性设计，并给出权限边界与恢复策略。', score: 92, tag: '行业', processed: true, read: false, signalStatus: 'tracking', impact: 'high', horizon: 'now', projectIds: ['docs-project'] },
    { id: 'n2', title: '本地优先 RAG 正在成为个人知识工具的默认架构', link: 'https://example.com/local-rag', sourceName: 'Hacker News', pubDate: now - 5_000_000, brief: '本地索引、可追溯引用与端侧隐私让个人知识库从搜索工具升级为工作上下文。', summary: '对比云端知识库和本地向量索引在隐私、延迟、成本及可维护性上的差异。', score: 86, tag: '开发', processed: true, read: true, signalStatus: 'tracking', impact: 'medium', horizon: 'soon', projectIds: ['docs-project'] },
    { id: 'n3', title: 'Electron 桌面应用的多进程安全边界实践', link: 'https://example.com/electron-security', sourceName: 'GitHub Blog', pubDate: now - day, brief: 'contextIsolation、最小 preload API 与本地回环鉴权是桌面工具的关键安全基线。', summary: '从主进程、预加载和渲染进程三个边界说明 IPC 契约、权限收口和敏感数据存储。', score: 81, tag: '技巧', processed: true, read: false, impact: 'high', horizon: 'soon' },
    { id: 'n4', title: '开发工作台开始融合任务、终端与复盘数据', link: 'https://example.com/workbench', sourceName: 'Hacker News', pubDate: now - 2 * day, brief: '项目上下文让信息消费、任务执行和知识沉淀形成连续的数据链路。', score: 76, tag: '产品', processed: true, read: true }
  ],
  newsWatches: [{ id: 'watch-agent', name: 'Agent 工程化', keywords: ['Agent', '工具调用', '可观测'], excludes: ['营销'], projectId: 'docs-project', minScore: 75, enabled: true, createdAt: now - 5 * day }],
  workArtifacts: [{ id: 'artifact-1', projectId: 'docs-project', source: 'news', sourceId: 'n1,n2', kind: 'brief', title: 'Agent 工程化周度情报简报', content: '权限可控、运行可观测、本地知识增强是本周的三个高频信号。', createdAt: now - 800_000 }],
  workflowRuns: [
    { id: 'run-1', shortcutId: 'dev-check', shortcutName: '项目全量体检', projectId: 'docs-project', repoPath: 'C:\\Work\\Agentic-Island', status: 'succeeded', startedAt: now - 4_000_000, finishedAt: now - 3_700_000, stepCount: 4, completedSteps: 4, summary: '类型检查、测试和构建通过' },
    { id: 'run-2', shortcutId: 'release', shortcutName: 'Release 候选验证', projectId: 'docs-project', repoPath: 'C:\\Work\\Agentic-Island', status: 'running', startedAt: now - 200_000, stepCount: 5, completedSteps: 3 }
  ],
  activityLog: [
    { id: 'claude:demo-1', ts: now - 3_600_000, updatedAt: now - 3_200_000, tool: 'Claude Code CLI', proj: 'Agentic-Island', detail: '完成资讯工作台联动调整', files: 4, added: 186, removed: 42 },
    { id: 'codex:demo-2', ts: now - 1_800_000, updatedAt: now - 1_200_000, tool: 'Codex', proj: 'Agentic-Island', detail: '执行测试与构建验证', files: 3, added: 74, removed: 11 }
  ],
  reviews: { [`d:${new Date(now).toISOString().slice(0, 10)}`]: '## 今日进展\n\n完成资讯、待办和快捷执行的项目上下文联动，并通过核心回归。\n\n## 明日重点\n\n完成安装包和 Release 发布。' },
  pomoDone: { [new Date(now).toISOString().slice(0, 10)]: 4 },
  repos: [],
  reviewsEnabled: true
}

class Cdp {
  constructor(url) {
    this.seq = 0
    this.pending = new Map()
    this.ws = new WebSocket(url)
  }

  async open() {
    await new Promise((resolveOpen, reject) => {
      this.ws.addEventListener('open', resolveOpen, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      if (!msg.id) return
      const waiter = this.pending.get(msg.id)
      if (!waiter) return
      this.pending.delete(msg.id)
      if (msg.error) waiter.reject(new Error(msg.error.message))
      else waiter.resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      const target = targets.find((item) => item.type === 'page' && item.title === 'Agentic-Island')
      if (target) return target
    } catch { /* app is still starting */ }
    await sleep(250)
  }
  throw new Error('Timed out waiting for the Electron renderer target')
}

const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
  cwd: root,
  env: { ...process.env, AIISLAND_SKIP_HOOKS: '1' },
  stdio: 'ignore',
  windowsHide: false
})

let cdp
try {
  await mkdir(outputDir, { recursive: true })
  const target = await waitForTarget()
  cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  const evaluate = async (expression, awaitPromise = true) => {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }

  await evaluate(`window.island.saveState(${JSON.stringify(demoState)}); true`)
  await sleep(300)
  await cdp.send('Page.reload', { ignoreCache: true })
  await sleep(1_200)
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: '`', ctrlKey: true, bubbles: true })); true")
  await sleep(700)
  await evaluate(`[...document.querySelectorAll('[title="贴住 / 取消贴住"]')][0]?.click(); true`)
  await sleep(300)

  const capture = async (tab, filename) => {
    const switched = await evaluate(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"][data-main-tab]')].find((el) => el.textContent?.trim().startsWith(${JSON.stringify(tab)}))
      if (!tab) return false
      tab.click()
      const scroller = [...document.querySelectorAll('.ai-scroll')].find((el) => el.closest('[data-solid]'))
      if (scroller) scroller.scrollTop = 0
      return true
    })()`)
    if (!switched) throw new Error(`No main tab found for ${tab}`)
    await sleep(tab === '终端' ? 1_000 : 450)
    const active = await evaluate(`(() => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]')
      return Boolean(tab?.textContent?.trim().startsWith(${JSON.stringify(tab)}))
    })()`)
    if (!active) throw new Error(`Main tab did not switch to ${tab}`)
    if (tab === '终端') {
      await evaluate(`window.island.ptyInput('t1', "Write-Host 'Agentic-Island v0.6.3 · ConPTY ready' -ForegroundColor Cyan; Get-Location; Get-Command git,node,npm | Select-Object Name,Version,Source\\r"); true`)
      await sleep(700)
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('[title]')].find((item) => item.title?.includes('命令工具、历史与收藏'))
        button?.click()
        return Boolean(button)
      })()`)
      await sleep(300)
    }
    if (tab === '设置') {
      await evaluate(`(() => {
        const title = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent?.trim() === '问答助手模型')
        const section = title?.closest('section')
        section?.firstElementChild?.click()
        return Boolean(section)
      })()`)
      await sleep(300)
      await evaluate(`(() => {
        const title = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent?.trim() === '问答助手模型')
        title?.closest('section')?.scrollIntoView({ block: 'start' })
        return true
      })()`)
      await sleep(250)
    }
    const rect = await evaluate(`(() => {
      const candidates = [...document.querySelectorAll('[data-solid]')].map((el) => ({ el, r: el.getBoundingClientRect() }))
      const hit = candidates.filter((x) => x.r.width > 500 && x.r.height > 200).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]
      if (!hit) return null
      return { x: hit.r.x, y: hit.r.y, width: hit.r.width, height: Math.min(hit.r.height, 970) }
    })()`)
    if (!rect) throw new Error(`No panel rect found for ${tab}`)
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
      clip: { ...rect, scale: 1 }
    })
    await writeFile(join(outputDir, filename), Buffer.from(shot.data, 'base64'))
    process.stdout.write(`captured ${filename}\n`)
  }

  if (captureOnly === 'terminal') {
    await capture('终端', 'terminal-v063.png')
  } else {
    await capture('问答', 'ask-v063.png')
  }
  if (!captureOnly) {
    await capture('快捷', 'shortcuts-v063.png')
    await capture('待办', 'todos-v063.png')
    await capture('灵感便签', 'notes-v063.png')
    await capture('资讯', 'news-v063.png')
    await capture('复盘', 'review-v063.png')
    await capture('设置', 'settings-v063.png')
    await capture('终端', 'terminal-v063.png')

    await evaluate(`(() => {
      const button = [...document.querySelectorAll('[title]')].find((item) => item.title?.includes('录屏工坊'))
      button?.click()
      return Boolean(button)
    })()`)
    await sleep(1_800)
    const recordingRect = await evaluate(`(() => {
      const panel = document.querySelector('[data-recording-studio] > div')
      if (!panel) return null
      const r = panel.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
    if (!recordingRect) throw new Error('No recording studio found')
    const recordingShot = await cdp.send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
      clip: { ...recordingRect, scale: 1 }
    })
    await writeFile(join(outputDir, 'recording-v063.png'), Buffer.from(recordingShot.data, 'base64'))
    process.stdout.write('captured recording-v063.png\n')
  }
} finally {
  try {
    await Promise.race([
      cdp?.send('Runtime.evaluate', { expression: 'window.island.quitApp(); true', returnByValue: true }),
      sleep(1_000)
    ])
  } catch { /* renderer may already be gone */ }
  cdp?.close()
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      sleep(3_000)
    ])
  }
  if (child.exitCode === null) child.kill()
  let cleanupError
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 })
      cleanupError = undefined
      break
    } catch (error) {
      cleanupError = error
      await sleep(350)
    }
  }
  if (cleanupError) throw cleanupError
}
