// Super-Agent（循环分区）离线验证：归一化纯函数 + 假中台端到端。
// 覆盖：
// 1. normalizeAutoloopState：文档形状的 /v1/state → 归一化模型（卡片排序/轮次映射/规则暂停/
//    用量诚实显示/部件在线），外加"未知字段忽略 + 畸形输入不抛错"（协议承诺新增字段不算破坏）。
// 2. AutoloopProvider + SuperAgentStore 端到端：真实 node:http 假中台（校验 Bearer、记录动作）→
//    http 直连拉取 → 拍板/停止/规则动作/why 全链路；离线不崩；CLI 只读兜底。
// 测试不碰真实 ~/.agent-autoloop（homeDir 指向临时目录）。

import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeAutoloopState, normalizeAutoloopWhy, AutoloopProvider } from '../src/main/autoloop-provider.ts'
import { AutoloopRulesStore, parseRulesText } from '../src/main/autoloop-config.ts'
import { SuperAgentStore } from '../src/main/super-agent.ts'

let failed = 0
const ok = (cond: boolean, label: string): void => {
  if (cond) console.log(`  ✓ ${label}`)
  else { console.error(`  ❌ ${label}`); failed++ }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---- 文档形状的 /v1/state 夹具（含未知字段 junk，验证"忽略未知"） ----
const fixture = (): Record<string, unknown> => ({
  seq: 1207,
  now: '2026-11-14T12:00:00.000+08:00',
  timezone: 'Asia/Shanghai',
  // 实现里的 tally 结构：doneToday 派生不出来（历史只保留 14 条），必须来自 totals
  totals: { running: 1, queued: 1, retrying: 1, unknown: 1, done: 6, doneToday: 3, nothing: 2, attention: 2, usage: { input: 64000, output: 12000, cost: 0.18 } },
  junkTopLevel: { ignore: 'me' },
  cards: [
    { id: 9, version: 1, ref: null, kind: 'ask', state: 'open', title: '怎么发货？', text: '两种方式今天都能发出。', options: ['快递', '自提'], recommend: 0, choice: null, answer: null, by: null, result: null, link: null, rule: '订单', lane: '#9', about: '发货后核对物流单', createdAt: '2026-11-14T11:30:00.000+08:00', decidedAt: null, closedAt: null, junkCard: 1 },
    { id: 8, version: 1, ref: null, kind: 'notice', state: 'open', title: '早报已生成', text: 'briefs/2026-11-14.md 已写入。', options: ['已处理'], recommend: null, rule: '早报', lane: '', about: null, createdAt: '2026-11-14T08:05:00.000+08:00', decidedAt: null, closedAt: null },
    { id: 55, version: 2, ref: null, kind: 'ask', state: 'open', title: '巡检：要重启网关吗？', text: '错误率 2.3%', options: ['重启', '观察'], recommend: 1, rule: '网站巡检', lane: 'prod', about: null, createdAt: '2026-11-14T11:20:00.000+08:00' },
    { id: 7, version: 3, ref: 'om_1', kind: 'ask', state: 'decided', title: '已答过的不应出现', text: '', options: ['a'], rule: '订单', createdAt: '2026-11-13T10:00:00.000+08:00' }
  ],
  recentCards: [],
  agents: [
    { id: 'claude', name: 'Claude Code', use: 'claude', worker: 'w1', seenAt: '2026-11-14T11:59:30.000+08:00', online: true },
    { id: 'hermes', name: 'Hermes', use: 'command', worker: 'w2', seenAt: null, online: false }
  ],
  channels: [
    { id: 'desktop', name: '桌面通知', seenAt: '2026-11-14T11:59:50.000+08:00', online: true },
    { id: 'feishu', name: '飞书', seenAt: '2026-11-14T11:59:40.000+08:00', online: true, lastFailure: { card: 55, tries: 3, error: 'send timeout', givenUp: false } }
  ],
  sources: [{ id: 'github', name: 'GitHub', events: 128 }],
  lines: [
    { id: '早报', name: '早报', group: '早报', agent: 'claude', source: 'schedule', types: [], every: '每天 08:00', next: '2026-11-15T08:00:00.000+08:00', paused: null, skippedAt: null },
    { id: '订单', name: '订单', group: '订单', agent: 'hermes', source: 'shop', types: ['order.*'], every: null, next: null, paused: null, skippedAt: null },
    { id: '处理意见', name: '处理意见', group: '处理意见', agent: 'claude', source: 'github', types: ['issues.opened'], every: null, next: null, paused: { by: 'owner', reason: '下游在修', since: '2026-11-13T09:00:00.000+08:00', until: null, skipped: { count: 3, events: [] } }, skippedAt: null }
  ],
  pauses: [{ name: '处理意见', by: 'owner', reason: '下游在修', since: '2026-11-13T09:00:00.000+08:00', until: null, skipped: { count: 3, events: [] } }],
  skipped: [
    { id: 412, source: 'github', type: 'issues.opened', subject: '#231', summary: '登录页白屏', paused: '["处理意见"]', receivedAt: '2026-11-14T09:00:00.000+08:00' },
    { id: 411, source: 'github', type: 'issues.opened', subject: '#230', summary: '导出缺 BOM', paused: '["处理意见"]', receivedAt: '2026-11-14T08:30:00.000+08:00' }
  ],
  elsewhere: [{ id: '周报', name: '周报', source: 'shop', agent: 'claude', cron: '0 18 * * 0', every: '每周日 18:00', next: '2026-11-16T18:00:00.000+08:00', where: 'Claude 应用的定时任务' }],
  runs: [
    { id: 41, rule: '订单', agent: 'hermes', state: 'claimed', attempts: 0, createdAt: '2026-11-14T11:55:00.000+08:00', claimedAt: '2026-11-14T11:56:00.000+08:00', finishedAt: null, notBefore: null, summary: '正在核对库存', error: '', link: 'claude://session/cc-41', session: 'cc-41', usage: null, stopping: false, manual: false },
    { id: 40, rule: '订单', agent: 'hermes', state: 'queued', attempts: 2, createdAt: '2026-11-14T11:40:00.000+08:00', claimedAt: null, finishedAt: null, notBefore: '2026-11-14T12:05:00.000+08:00', summary: '', error: '连接超时', link: '', session: null, usage: null, stopping: false, manual: false },
    { id: 213, rule: '网站巡检', agent: 'codex', state: 'unknown', attempts: 2, createdAt: '2026-11-14T11:00:00.000+08:00', claimedAt: '2026-11-14T11:01:00.000+08:00', finishedAt: null, notBefore: '2026-11-14T12:10:00.000+08:00', summary: '', error: '接单程序 5 分钟未报', link: '', session: 'codex-77', usage: null, stopping: true, manual: false },
    { id: 39, rule: '早报', agent: 'claude', state: 'done', attempts: 0, createdAt: '2026-11-14T08:00:00.000+08:00', claimedAt: '2026-11-14T08:00:01.000+08:00', finishedAt: '2026-11-14T08:05:10.000+08:00', notBefore: null, summary: '早报已写入 briefs/', error: '', link: 'https://claude.ai/chat/demo', session: 'cc-39', usage: { input: 9000, output: 3000, cached: 1000, cost: 0.03 }, stopping: false, manual: false },
    { id: 38, rule: '处理意见', agent: 'claude', state: 'cancelled', attempts: 0, createdAt: '2026-11-13T09:30:00.000+08:00', claimedAt: '2026-11-13T09:31:00.000+08:00', finishedAt: '2026-11-13T10:00:00.000+08:00', notBefore: null, summary: '本人停止', error: '', link: '', session: null, usage: null, stopping: false, manual: false },
    { id: 37, rule: '早报', agent: 'claude', state: 'nothing', attempts: 0, createdAt: '2026-11-13T08:00:00.000+08:00', claimedAt: null, finishedAt: '2026-11-13T08:02:00.000+08:00', notBefore: null, summary: '没事可做：无新笔记', error: '', link: '', session: null, usage: null, stopping: false, manual: false }
  ],
  nextBefore: 37,
  hasMore: true,
  unrouted: [],
  spending: {
    today: { rounds: 2, tokens: 20000, cached: 8000, cost: 0.05, missingTokens: 1, missingCost: 0 },
    week: { rounds: 12, tokens: 150000, cached: 40000, cost: 0.4, missingTokens: 3, missingCost: 2 }
  },
  timers: [{ rule: '网站巡检', lane: '', key: 'health', about: '查首页恢复', at: '2026-11-14T12:30:00.000+08:00' }]
})

async function run(): Promise<void> {
  // ===== 1. 归一化：文档形状 =====
  console.log('[1] normalizeAutoloopState（文档形状）')
  {
    const data = normalizeAutoloopState(fixture(), Date.parse('2026-11-14T12:00:00.000+08:00'))
    ok(data.decisions.length === 3, 'open 卡片恰好 3 张（decided 的被排除）')
    ok(data.decisions[0].kind === 'ask' && data.decisions[0].cardId === 55, 'ask 按年龄从老到新（11:20 的最先）')
    ok(data.decisions[1].kind === 'ask' && data.decisions[1].cardId === 9, '第二张 ask')
    ok(data.decisions[2].kind === 'notice' && data.decisions[2].cardId === 8, 'notice 排最后（可结案）')
    const card9 = data.decisions.find((d) => d.cardId === 9)!
    ok(card9.options.length === 2 && card9.recommend === 0, '选项与推荐下标透传')
    ok(card9.about === '发货后核对物流单', 'about（留给下一轮的说明）透传')
    ok(card9.createdAt === Date.parse('2026-11-14T11:30:00.000+08:00'), '卡片时间读实现键 createdAt（驼峰）')

    ok(data.work.length === 3, '进行中轮次 3 条')
    ok(data.work[0].runId === 213 && data.work[0].state === 'unknown', 'runId 降序（编号键是 id 不是 run）')
    const run41 = data.work.find((w) => w.runId === 41)!
    ok(run41.state === 'claimed' && run41.agent === 'Hermes', 'runs.agent 是 id，用 agents[] 映射成显示名')
    const run40 = data.work.find((w) => w.runId === 40)!
    ok(run40.attempts === 2 && run40.error === '连接超时', '重试次数与失败原因透传')
    ok(run41.link === 'claude://session/cc-41' && run41.session === 'cc-41', '进行中轮次的会话链接/编号透传')

    ok(data.history.length === 3 && data.history[0].runId === 39 && data.history[0].outcome === 'done', '历史 3 条、最新在前')
    ok(data.history[0].tokens === 12000 && data.history[0].costUsd === 0.03, 'tokens 来自 usage.input+output、cost 来自 usage.cost')
    ok(data.history[1].tokens === null, 'usage 为 null 的轮次 tokens 如实为 null（未上报）')
    ok(data.history[0].link === 'https://claude.ai/chat/demo', '历史轮次的会话链接透传')

    const rulePaused = data.rules.find((r) => r.name === '处理意见')
    ok(!!rulePaused && rulePaused.paused && rulePaused.skippedCount === 3 && rulePaused.pauseReason === '下游在修', '规则暂停状态 + 跳过计数（lines 内嵌 paused）')
    const ruleCron = data.rules.find((r) => r.name === '早报')
    ok(!!ruleCron && ruleCron.every === '每天 08:00' && ruleCron.next === Date.parse('2026-11-15T08:00:00.000+08:00'), '定时规则读 every/next（实现的键，非 when.cron）')
    ok(ruleCron?.agent === 'Claude Code', '规则的 agent id 映射成显示名')
    ok(data.rules.length === 3, '规则 3 条')
    ok(data.timers.length === 1 && data.timers[0].rule === '网站巡检', '未来复查 1 条')

    ok(data.spend !== null && data.spend.today.missingTokens === 1 && data.spend.week.missingCost === 2, '用量"未上报轮数"如实单列')
    ok(data.components.length === 5, '部件 5 个（2 agent + 2 channel + 1 source）')
    const feishu = data.components.find((c) => c.name === '飞书')
    ok(!!feishu && !!feishu.detail && feishu.detail.includes('投递失败'), '通道投递失败提示进入 detail')
    const github = data.components.find((c) => c.name === 'GitHub')
    ok(!!github && github.online === null && !!github.detail && github.detail.includes('128'), '事件源无心跳：online=null + 事件计数')

    // 场景：卡片投递失败（lastFailure 按 card id 落到具体卡片）
    const failing = data.decisions.find((d) => d.cardId === 55)
    ok(!!failing && failing.deliveryFailed?.tries === 3 && failing.deliveryFailed?.givenUp === false, '卡片投递失败按 id 匹配到具体卡片')
    ok(data.decisions.find((d) => d.cardId === 8)?.deliveryFailed === null, '其它卡片不带投递告警')
    // 场景：重试等待（notBefore）
    const retrying = data.work.find((w) => w.runId === 213)
    ok(!!retrying && retrying.notBefore !== null && retrying.attempts === 2, '排队/不确定轮次带下次重试时刻')
    // 场景：暂停期间被跳过的事件、别处定时任务
    ok(data.skipped.length === 2 && data.skipped[0].rules[0] === '处理意见', '被跳过事件按时间倒序、带规则归属')
    ok(data.elsewhere.length === 1 && data.elsewhere[0].name === '周报' && data.elsewhere[0].every === '每周日 18:00', 'elsewhere 定时任务透传（含人话频率与下次时刻）')
  }

  // ===== 2. 归一化：畸形输入不抛错（协议允许新增字段，岛端永不崩） =====
  console.log('[2] normalizeAutoloopState（畸形输入）')
  {
    const d1 = normalizeAutoloopState(null, Date.now())
    ok(d1.decisions.length === 0 && d1.work.length === 0, 'null 输入 → 空数据')
    const d2 = normalizeAutoloopState('junk', Date.now())
    ok(d2.rules.length === 0, '字符串输入 → 空数据')
    const d3 = normalizeAutoloopState({
      cards: [null, 42, { id: 'x' }, { id: 3, state: 'open', kind: 'ask' }],
      runs: [{ run: 'NaN' }, { run: 5 }],
      lines: [null, {}],
      spending: 'bad'
    }, Date.now())
    ok(d3.decisions.length === 1 && d3.decisions[0].cardId === 3 && d3.decisions[0].options.length === 0, '坏卡片被跳过、缺省字段取空值')
    ok(d3.spend === null, 'spending 畸形 → null（UI 显示为无数据而非 0）')
  }

  // ===== 3. why 归一化 =====
  console.log('[3] normalizeAutoloopWhy')
  {
    const lines = normalizeAutoloopWhy({
      facts: [
        { kind: 'received', at: '2026-11-14T11:00:00.000+08:00', summary: '来源 shop 发来 feedback.new' },
        { type: 'decided', note: '交给规则「处理意见」' },
        'junk-item'
      ]
    })
    ok(lines.length === 2 && lines[0].text.includes('received'), '事实行提取 kind+可读字段，垃圾行丢弃')
    ok(lines[1].at === null, '缺时间的行为 null（UI 显示 —）')
  }

  // ===== 4. 假中台端到端（http 直连 + 动作回传） =====
  console.log('[4] AutoloopProvider ↔ 假中台（HTTP 直连）')
  const hubAnswers: Array<{ path: string; body: Record<string, unknown> }> = []
  // SSE 联动观测：/v1/state 命中数、/v1/stream 连接数与 URL（验 after=seq 续读）、活跃流
  const sse = { stateHits: 0, streamHits: 0, streamUrls: [] as string[], sockets: [] as { write: (s: string) => void; destroy: () => void }[] }
  const hub = await new Promise<{ server: Server; port: number }>((resolve) => {
    const server = createServer((req, res) => {
      const send = (code: number, body: unknown): void => {
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      const auth = req.headers.authorization || ''
      if (!req.url) return send(404, { error: 'no url' })
      if (req.method === 'GET' && req.url === '/v1/state') {
        if (auth !== 'Bearer k-test-owner') return send(401, { error: 'bad key' })
        sse.stateHits++
        return send(200, fixture())
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/state?before=')) {
        if (auth !== 'Bearer k-test-owner') return send(401, { error: 'bad key' })
        return send(200, {
          cards: [], lines: [], sources: [], agents: [], channels: [], timers: [], skipped: [], elsewhere: [],
          runs: [
            { id: 12, rule: '早报', agent: 'claude', state: 'done', attempts: 0, finishedAt: '2026-11-12T08:03:00.000+08:00', summary: '更早的早报', error: '', session: null, usage: { input: 1000, output: 500, cost: 0.01 } },
            { id: 11, rule: '早报', agent: 'claude', state: 'done', attempts: 0, finishedAt: '2026-11-11T08:03:00.000+08:00', summary: '更早的早报 2', error: '', session: null, usage: null }
          ],
          nextBefore: null
        })
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/stream')) {
        if (auth !== 'Bearer k-test-owner') return send(401, { error: 'bad key' })
        sse.streamHits++
        sse.streamUrls.push(req.url)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.write('id: 1\nevent: fact\ndata: {}\n\n')
        const sock = { write: (s: string) => res.write(s), destroy: () => res.destroy() }
        sse.sockets.push(sock)
        res.on('close', () => { const i = sse.sockets.indexOf(sock); if (i >= 0) sse.sockets.splice(i, 1) })
        return
      }
      if (req.method === 'GET' && req.url === '/v1/runs/41/why') {
        if (auth !== 'Bearer k-test-owner') return send(401, { error: 'bad key' })
        return send(200, { facts: [{ kind: 'claimed', at: '2026-11-14T11:59:00.000+08:00', summary: 'worker 领取' }] })
      }
      if (req.method === 'POST') {
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          let body: Record<string, unknown> = {}
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { /* */ }
          hubAnswers.push({ path: req.url as string, body })
          send(200, { ok: true })
        })
        return
      }
      send(404, { error: 'not found' })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }))
  })

  const tmpHome = mkdtempSync(join(tmpdir(), 'aiisland-super-'))
  const deadSpawn = async (): Promise<{ code: number; stdout: string; stderr: string }> => ({ code: 127, stdout: '', stderr: 'not installed' })
  const provider = new AutoloopProvider({
    fetchImpl: (url, init) => globalThis.fetch(url, init),
    spawnImpl: deadSpawn,
    homeDir: tmpHome
  })
  const store = new SuperAgentStore()
  let changes = 0
  store.on('change', () => { changes++ })
  store.register(provider)

  provider.configure({ enabled: true, url: `http://127.0.0.1:${hub.port}`, ownerKey: 'k-test-owner', pollMs: 60 })
  await provider.pollOnce()
  {
    const status = provider.status()
    ok(status.connected && status.mode === 'http', 'http 直连成功、mode=http')
    ok(status.keyConfigured, '已配置密钥（可拍板）')
    const snap = store.snapshot()
    ok(snap.providers.length === 1 && snap.providers[0].id === 'autoloop', 'store 聚合 provider 状态')
    ok(snap.decisions.length === 3 && snap.work.length === 3, '归一化数据进入快照')
    ok(changes >= 1, 'change 事件已广播（渲染层推送链路）')
  }
  // 错误密钥路径
  {
    const bad = new AutoloopProvider({ fetchImpl: (url, init) => globalThis.fetch(url, init), spawnImpl: deadSpawn, homeDir: tmpHome })
    bad.configure({ enabled: true, url: `http://127.0.0.1:${hub.port}`, ownerKey: 'wrong', pollMs: 60 })
    await bad.pollOnce()
    const badStatus = bad.status()
    ok(badStatus.connected === false && (badStatus.detail || '').includes('密钥被拒绝'), '错误密钥 → 离线并说明密钥被拒')
    bad.stop()
  }
  // 动作链路：拍板 / 停止 / 规则运行 / why
  {
    const ans = await provider.answer(9, 1)
    ok(ans.ok, '回答卡片成功')
    const answerReq = hubAnswers.find((a) => a.path === '/v1/cards/9/answer')
    ok(!!answerReq && answerReq.body.choice === 1, '中台收到 POST /v1/cards/9/answer {choice:1}')
    const free = await provider.answer(8, undefined, '用顺丰发货')
    ok(free.ok, '自由文本回答成功')
    const freeReq = hubAnswers.find((a) => a.path === '/v1/cards/8/answer')
    ok(!!freeReq && freeReq.body.text === '用顺丰发货', '自由文本经 JSON 体回传（不拼命令行）')
    const stop = await provider.stopRun(41)
    ok(stop.ok && hubAnswers.some((a) => a.path === '/v1/runs/41/cancel'), '停止轮次 → POST /v1/runs/41/cancel')
    const runAct = await provider.ruleAction('订单', 'run', { reason: '手动跑一轮' })
    ok(runAct.ok && hubAnswers.some((a) => a.path === `/v1/rules/${encodeURIComponent('订单')}/run`), '立即运行 → 规则名 URL 编码进路径')
    const pauseAct = await provider.ruleAction('处理意见', 'pause', { reason: '再缓缓' })
    ok(pauseAct.ok, '暂停规则成功')
    // 补跑：since 是那次暂停的起点（ISO 字符串原样进 JSON 体）
    const replay = await provider.ruleReplay('处理意见', '2026-11-14T09:00:00.000+08:00')
    const replayReq = hubAnswers.find((a) => a.path === `/v1/rules/${encodeURIComponent('处理意见')}/replay`)
    ok(replay.ok && !!replayReq && replayReq.body.since === '2026-11-14T09:00:00.000+08:00', '补跑 → POST /v1/rules/<名>/replay {since}')
    const replayEmpty = await provider.ruleReplay('处理意见', '')
    ok(!replayEmpty.ok && !!replayEmpty.error, '缺 since 时本地拒绝（不发请求）')
    // 历史分页：首页 nextBefore 来自 state → 加载更早一页 → 游标归 null（没有更早的了）
    const more = await provider.historyMore()
    ok(more.ok && (more.items?.length || 0) === 2 && more.nextBefore === null, '历史分页：更早一页 + nextBefore=null')
    const moreAgain = await provider.historyMore()
    ok(moreAgain.ok && (moreAgain.items?.length || 0) === 0, '没有更早的轮次时返回空、不再请求')
    const why = await provider.why(41)
    ok(why.ok && (why.lines?.length || 0) === 1 && why.lines![0].text.includes('claimed'), 'why 时间线返回归一化行')
  }
  provider.stop()

  // ===== 5. 离线中台：连不上不崩、状态如实 =====
  console.log('[5] 离线中台')
  {
    const off = new AutoloopProvider({ fetchImpl: (url, init) => globalThis.fetch(url, init), spawnImpl: deadSpawn, homeDir: tmpHome })
    off.configure({ enabled: true, url: 'http://127.0.0.1:9', ownerKey: 'k', pollMs: 60 })
    await off.pollOnce()
    ok(off.status().connected === false && !!off.status().detail, '连不上 → connected=false + 原因')
    off.stop()
  }

  // ===== 6. CLI 只读兜底（无密钥、本机装有 agent-autoloop） =====
  console.log('[6] CLI 只读兜底')
  {
    // 伪造本机安装痕迹：临时 home 写 config.json（同时验证自动发现）
    mkdirSync(tmpHome, { recursive: true })
    writeFileSync(join(tmpHome, 'config.json'), JSON.stringify({ url: `http://127.0.0.1:${hub.port}`, hub: { listen: `127.0.0.1:${hub.port}` }, owner: 'me' }))
    const canned = JSON.stringify(fixture())
    const cliProvider = new AutoloopProvider({
      fetchImpl: (url, init) => globalThis.fetch(url, init),
      spawnImpl: async (args) => {
        if (args[0] === '--version') return { code: 0, stdout: 'agent-autoloop v1.9.0\n', stderr: '' }
        if (args[0] === 'status' && args[1] === '--json') return { code: 0, stdout: `一些前缀输出\n${canned}\n`, stderr: '' }
        return { code: 1, stdout: '', stderr: 'unexpected args' }
      },
      homeDir: tmpHome
    })
    cliProvider.configure({ enabled: true, pollMs: 60 }) // 无 ownerKey → CLI 兜底
    await cliProvider.pollOnce()
    const st = cliProvider.status()
    ok(st.hubDetected, '本机安装痕迹被检测到（hubDetected）')
    ok(st.connected && st.mode === 'cli', 'CLI 兜底拉取成功、mode=cli')
    ok(st.keyConfigured === false, '未配密钥（只读）')
    ok(cliProvider.collect().decisions.length === 3, 'CLI 输出（含前缀噪音）解析出同样的数据')
    const act = await cliProvider.answer(9, 1)
    ok(!act.ok && !!act.error, '无密钥时动作被拒绝并说明原因')
    cliProvider.stop()
  }

  // ===== 7. SSE 增量流：实时推送 → 断线退避重连 → after=seq 续读 =====
  console.log('[7] SSE 增量流')
  {
    const p = new AutoloopProvider({ fetchImpl: (url, init) => globalThis.fetch(url, init), spawnImpl: deadSpawn, homeDir: tmpHome })
    p.configure({ enabled: true, url: `http://127.0.0.1:${hub.port}`, ownerKey: 'k-test-owner', pollMs: 60 })
    await sleep(500)
    ok(p.status().live === true, 'SSE 流连上 → live=true')
    const hits0 = sse.stateHits
    // 追赶窗口（2s）内 after=0 的历史重放只推进水位、不触发刷新：等窗口过掉再推"实时"帧
    await sleep(1800)
    const sock = sse.sockets[sse.sockets.length - 1]
    // 真实事实形状：{version,seq,at,type,changes}——type 驱动流水线动画
    sock?.write(`id: 2\nevent: fact\ndata: ${JSON.stringify({ version: 1, seq: 2, at: Date.now(), type: 'started', changes: [] })}\n\n`)
    await sleep(700)
    ok(sse.stateHits > hits0, '实时 fact 到达 → 去抖后触发全量刷新')
    ok((p.status().detail || '').includes('实时流'), 'detail 标注实时流')
    const gotFacts = p.collect().facts
    ok(gotFacts.some((f) => f.type === 'started' && f.seq === 2), 'SSE fact 的 type/seq 被采集（驱动动画的真实事实）')
    // 非 JSON / 无 type 的事实只当变更信号，不产生动画脉冲
    sock?.write('id: 3\nevent: fact\ndata: not-json\n\n')
    await sleep(500)
    ok(!p.collect().facts.some((f) => f.seq === 3), '畸形事实不进入动画队列（只推进水位）')
    // 服务端掐断 → 1s 退避重连 → 带最新 seq 续读（不整段重放）
    const hits1 = sse.streamHits
    sock?.destroy()
    await sleep(2000)
    ok(sse.streamHits === hits1 + 1, '断流后按退避重连成功')
    // 最新水位是 3（id:3 的畸形事实也推进水位）——重连必须从 3 续读、不重放历史
    ok((sse.streamUrls[sse.streamUrls.length - 1] || '').includes('after=3'), '重连带 after=<最新 seq> 续读')
    ok(p.status().live === true, '重连后 live 恢复')
    p.stop()
    ok(p.status().live === false, 'stop() 拆流')
  }

  // ===== 8. 流水线计数：totals 优先、缺失时派生 =====
  console.log('[8] 流水线计数')
  {
    const withTotals = normalizeAutoloopState(fixture(), Date.now())
    ok(withTotals.pipeline.running === 1 && withTotals.pipeline.queued === 1 && withTotals.pipeline.retrying === 1, 'totals → running/queued/retrying')
    ok(withTotals.pipeline.doneToday === 3 && withTotals.pipeline.attention === 2, 'totals → doneToday/attention（优先于派生）')
    ok(withTotals.pipeline.sources === 1 && withTotals.pipeline.rules === 3 && withTotals.pipeline.pausedRules === 1, '来源/规则/暂停数派生正确')
    ok(withTotals.pipeline.timers === 1, '复查数 = timers 长度')
    // 无 totals 的旧/精简响应：从本快照派生
    const noTotals = normalizeAutoloopState({ cards: [], runs: [{ id: 1, rule: 'r', state: 'claimed' }, { id: 2, rule: 'r', state: 'queued', attempts: 2 }], lines: [], sources: { a: {} } }, Date.now())
    ok(noTotals.pipeline.running === 1 && noTotals.pipeline.queued === 1 && noTotals.pipeline.retrying === 1, '无 totals 时从 runs 派生（含重试）')
  }

  // ===== 9. 可视化编排：rules.json 读/校验/备份式保存 =====
  console.log('[9] 可视化编排（rules.json）')
  {
    const home9 = mkdtempSync(join(tmpdir(), 'aiisland-rules-'))
    const rp = join(home9, 'rules.json')
    const base = {
      timezone: 'Asia/Shanghai',
      askFirst: ['删数据'],
      sources: { local: { name: '本机' } },
      agents: { claude: { name: 'Claude Code', use: 'claude', access: 'edit' } },
      channels: { desktop: { name: '桌面通知' } },
      rules: [{ name: '早报', when: { cron: '0 8 * * *' }, to: 'claude', cwd: '~/notes', prompt: '写早报' }],
      // 手写未知字段：合并式编辑必须保住它
      customTopLevel: { keep: true }
    }
    writeFileSync(rp, JSON.stringify(base, null, 2))

    // check 的模拟：合法 JSON 通过；含 "bad" 的草稿失败（模拟上游报错原文）
    const spawnCheck = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
      const text = readFileSync(args[1], 'utf8')
      if (text.includes('"bad"')) return { code: 1, stdout: '', stderr: 'rules.json 的第 1 条规则：when 要写 cron 或 source\n(Use `node --trace-warnings ...`)' }
      JSON.parse(text)
      return { code: 0, stdout: '', stderr: '' }
    }
    const store9 = new AutoloopRulesStore({ homeDir: home9, spawnImpl: spawnCheck })

    const read = store9.read()
    ok(read.ok && read.rules?.rules.length === 1, '读取规则文件成功')
    ok((read.rules as unknown as Record<string, unknown>).customTopLevel !== undefined, '未知顶层字段原样保留（不被裁剪）')

    // 严格 JSON：注释必须被明确拒绝并给出提示
    const commented = parseRulesText('{\n  // 注释\n  "rules": []\n}')
    ok(!commented.ok && commented.error.includes('不支持'), '注释被拒绝且提示「严格 JSON 不支持注释」')

    // 校验：草稿不合法 → 官方 check 报错（压成整句、过滤 node 警告噪音）
    const bad = await store9.validate(JSON.stringify({ ...base, rules: [{ name: 'bad', when: {}, to: 'claude' }] }))
    ok(!bad.ok && !!bad.error && bad.error.includes('when 要写'), '不合法草稿被 check 拒绝并转述原文')
    ok(bad.error!.includes('ExperimentalWarning') === false, 'check 输出里的 node 警告噪音被过滤')
    const good = await store9.validate(JSON.stringify(base))
    ok(good.ok, '合法草稿通过官方 check')

    // 保存：备份 + 原子写 + 草稿内容落盘
    const next = { ...base, rules: [...base.rules, { name: '巡检', when: { cron: '*/5 * * * *' }, to: 'claude' }] }
    const saved = await store9.save(JSON.stringify(next))
    ok(saved.ok && !!saved.backupPath && existsSync(saved.backupPath), '保存成功并生成备份')
    ok(JSON.parse(readFileSync(rp, 'utf8')).rules.length === 2, '新内容已原子写入')
    ok(readdirSync(home9).some((f) => f.startsWith('rules.') && f.endsWith('.bak')), '备份文件在同目录')
    const reloaded = JSON.parse(readFileSync(rp, 'utf8')) as Record<string, unknown>
    ok(reloaded.customTopLevel !== undefined, '保存后未知字段仍在（合并式编辑）')

    // 校验失败的保存：原文件不得改动
    const before = readFileSync(rp, 'utf8')
    const rejected = await store9.save(JSON.stringify({ ...base, rules: [{ name: 'bad', when: {}, to: 'claude' }] }))
    ok(!rejected.ok && readFileSync(rp, 'utf8') === before, 'check 不通过时保存被拒、原文件字节不变')

    // 文件缺失：给出人话
    const missing = new AutoloopRulesStore({ homeDir: join(home9, 'nope'), spawnImpl: spawnCheck }).read()
    ok(!missing.ok && missing.error!.includes('还没装'), '文件缺失时说清「还没装 / 路径指错了」')

    // 模板创建：空目录可建；已有文件时拒绝覆盖（防止误抹线上规则）
    const fresh = join(home9, 'fresh')
    const freshStore = new AutoloopRulesStore({ homeDir: fresh, spawnImpl: spawnCheck, skipCheck: true })
    const made = freshStore.createTemplate()
    ok(made.ok && existsSync(join(fresh, 'rules.json')), '空目录可创建最小规则模板')
    const madeRules = JSON.parse(readFileSync(join(fresh, 'rules.json'), 'utf8')) as { rules: unknown[]; agents: Record<string, unknown> }
    ok(madeRules.rules.length === 1 && !!madeRules.agents.claude, '模板含可跑的规则与默认 Agent')
    const again = freshStore.createTemplate()
    ok(!again.ok && again.error!.includes('已存在'), '已有文件时拒绝创建（绝不覆盖）')
  }

  hub.server.close()
  hub.server.closeAllConnections?.()
  if (failed > 0) {
    console.error(`\n❌ test-super-agent：${failed} 项断言失败`)
    process.exit(1)
  }
  console.log('\n✓ test-super-agent 全部通过')
}

run().catch((e) => {
  console.error('❌ test-super-agent 异常：', e)
  process.exit(1)
})
