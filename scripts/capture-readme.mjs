import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outputDir = join(root, 'screenshots')
const profile = await mkdtemp(join(tmpdir(), 'agentic-island-docs-'))
const port = 9337

const now = Date.now()
const day = 86_400_000
const demoState = {
  theme: 'aurora',
  islandWidth: 760,
  settings: {
    autostart: false, multiMonitor: false, sound: false, silentBg: true,
    autoConnect: false, largeSize: true, claudeCli: true, claudeApp: true,
    codexCli: true, codexApp: true, clipWatch: false, ambientBar: false,
    meetingDnd: true, ruleMorning: true, ruleEvening: true, rulePomoCapsule: true,
    ruleMeetingNote: true, desktopWidget: false
  },
  workbenchProjects: [{
    id: 'docs-project', name: 'Agentic-Island v0.2', repoPath: 'C:\\Work\\Agentic-Island',
    objective: '完成桌面 Agent 工作台的产品化发布', status: 'active', colorHue: 155,
    createdAt: now - 12 * day, updatedAt: now
  }],
  activeProjectId: 'docs-project',
  todos: [
    { id: 1, text: '完成 Release 候选版本回归', done: false, status: 'doing', priority: 1, projectId: 'docs-project', project: 'Agentic-Island v0.2', tags: ['发布', '回归'], energy: 'deep', acceptance: '类型检查、测试、构建与安装包全部通过', estimate: 90, spent: 35, due: now + 3_600_000, createdAt: now - day },
    { id: 2, text: '核对 Agent 审批与外部窗口让位', done: false, status: 'todo', priority: 2, projectId: 'docs-project', project: 'Agentic-Island v0.2', tags: ['Agent', '交互'], energy: 'normal', acceptance: '审批闭环和外部打开流程可重复验证', estimate: 45, createdAt: now - day },
    { id: 3, text: '更新架构图与功能矩阵', done: true, status: 'done', priority: 2, projectId: 'docs-project', project: 'Agentic-Island v0.2', tags: ['文档'], estimate: 60, spent: 52, doneAt: now - 2_000_000, createdAt: now - 2 * day },
    { id: 4, text: '整理下个迭代的性能指标', done: false, status: 'todo', priority: 3, projectId: 'docs-project', project: 'Agentic-Island v0.2', tags: ['规划'], energy: 'light', estimate: 25, createdAt: now }
  ],
  notes: [
    { id: 11, emoji: '🧭', title: '产品原则', md: '## 不打断，但始终可控\n\n- Agent 状态必须实时可见\n- 外部操作时主动让出桌面焦点\n- 数据默认留在本机', color: 'sky', tags: ['产品', '原则'], pinned: true, createdAt: now - 4 * day, updatedAt: now },
    { id: 12, emoji: '🧠', title: '知识工作闭环', md: '资讯信号 → 待办行动 → 快捷执行 → 复盘沉淀。\n\n[[产品原则]]', color: 'violet', tags: ['工作流', '知识库'], starred: true, createdAt: now - 3 * day, updatedAt: now },
    { id: 13, emoji: '⚙️', title: '发布检查清单', md: '- [x] typecheck\n- [x] unit tests\n- [ ] NSIS installer\n- [ ] GitHub Release', color: 'mint', tags: ['发布'], later: true, createdAt: now - day, updatedAt: now }
  ],
  askThread: [
    { id: 21, role: 'user', text: '请基于当前项目状态给出发布前风险清单。', ts: now - 120_000 },
    { id: 22, role: 'agent', blocks: [{ t: 'think', text: ['用户想了解发布前风险。先梳理项目状态：这是一个 Electron 桌面应用，包含主进程、预加载、渲染层三端。', '第一步，检查审批闭环：hooks 转发脚本必须 fail-open，否则岛未启动时会卡住用户 CLI。需要验证 PreToolUse 阻塞审批的 stdout 协议。', '第二步，检查窗口让位：外部打开文件/网页时，透明置顶窗口必须主动降层，否则会遮挡目标应用。ExternalYieldController 需要覆盖全部入口。', '第三步，确认配置与密钥：API Key、CalDAV 密码必须 DPAPI 加密存储在本机 userData，不能落明文，不能外传。', '第四步，安装包验证：NSIS 打包后需要在干净环境安装一次，确认 hooks 安装器幂等、bridge.json 自愈正常。', '最后，综合以上四点给出风险清单，按严重度排序，并给出每项的具体验证方法。'].join('\n\n') }, { t: 'h', text: '发布前检查重点' }, { t: 'ul', items: ['验证 Agent 审批闭环与 fail-open', '检查外部打开时窗口让位', '确认所有配置和密钥仅保存在本机', '生成安装包并执行干净安装验证'] }], ts: now - 110_000 }
  ],
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
    await evaluate(`(() => {
      const tab = [...document.querySelectorAll('.noscrollbar > div')].find((el) => el.textContent?.trim().startsWith(${JSON.stringify(tab)}))
      tab?.click()
      const scroller = [...document.querySelectorAll('.ai-scroll')].find((el) => el.closest('[data-solid]'))
      if (scroller) scroller.scrollTop = 0
      return Boolean(tab)
    })()`)
    await sleep(tab === '终端' ? 1_000 : 450)
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

  await capture('问答', 'ask-v030.png')
  await capture('快捷', 'shortcuts-v030.png')
  await capture('待办', 'todos-v030.png')
  await capture('灵感便签', 'notes-v030.png')
  await capture('资讯', 'news-v030.png')
  await capture('复盘', 'review-v030.png')
  await capture('设置', 'settings-v030.png')
} finally {
  cdp?.close()
  child.kill()
  await sleep(300)
  await rm(profile, { recursive: true, force: true })
}
