// 循环分区（Super-Agent）：后台自主循环（agent-autoloop）的监控 + 拍板台。
// 与 Agents 分区的关系：Agents 管"人守着终端"的前台会话（hooks 阻塞审批），
// 这里管"替你在后台跑"的循环——ask 卡片与 PreToolUse 审批同构，交互复用同一套语言。
// 安全边界：卡片/事件文本来自外部系统（不可信输入）——只按纯文本渲染、绝不进 Markdown/执行；
// 链接只做显式点击打开（openExternal 仅 http/https）；停止/立即运行是两步确认（Electron 无 confirm）。

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Clock, Copy, ExternalLink, History, Hourglass, Link2, Pause, Play, RefreshCw, Settings2, Square, Zap } from 'lucide-react'
import type { SuperAgentSettings, SuperAgentSnapshot, SuperDecision, SuperHistoryItem, SuperRule, SuperSpendWindow, SuperTimer, SuperWhyLine, SuperWork } from '../../../shared/protocol'
import { island } from '../bridge'
import { Button, EmptyState, Input, Segmented, Switch } from '../ui/components'
import { Ico } from '../ui/icons'
import { fadeScaleIn } from '../ui/motion'
import { accentText, accent, fill, FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'
import { SuperPipeline } from './SuperPipeline'

type SuperSeg = 'decide' | 'work' | 'rules' | 'recent'

interface SuperTabProps {
  snap: SuperAgentSnapshot | null
  cfg: SuperAgentSettings
  onCfgChange: (cfg: SuperAgentSettings) => void
  /** 打开可视化编排工作台（读写 rules.json） */
  onOpenStudio: () => void
  /** 岛面板当前是否可见：不可见时停掉流水线的全部无限动画（透明置顶窗口持续重绘会拖慢指针） */
  active: boolean
}

const fmtAge = (createdAt: number, now: number): string => {
  if (!createdAt) return ''
  const s = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (s < 60) return '刚来'
  const m = Math.floor(s / 60)
  if (m < 60) return `等了 ${m} 分钟`
  const h = Math.floor(m / 60)
  if (h < 24) return `等了 ${h} 小时 ${m % 60} 分`
  return `等了 ${Math.floor(h / 24)} 天`
}

const fmtTime = (ts: number | null): string => {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

const fmtTokens = (n: number | null): string =>
  n === null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

/** 复查倒计时：<1h "N 分钟后"；<24h "H 小时后"；更远给绝对时间 */
const fmtDue = (at: number, now: number): string => {
  const s = Math.floor((at - now) / 1000)
  if (s <= 0) return '即将到期'
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} 分钟后`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时后`
  return fmtTime(at)
}

const WORK_STATE_LABEL: Record<SuperWork['state'], string> = { queued: '排队', claimed: '执行中', unknown: '不确定' }
const OUTCOME_LABEL: Record<SuperHistoryItem['outcome'], string> = { done: '完成', nothing: '没事做', cancelled: '已取消' }
const OUTCOME_TONE: Record<SuperHistoryItem['outcome'], string> = { done: 'ok', nothing: 'mid', cancelled: 'bad' }

export function SuperTab({ snap, cfg, onCfgChange, onOpenStudio, active }: SuperTabProps): React.JSX.Element {
  const [seg, setSeg] = useState<SuperSeg>('decide')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [armed, setArmed] = useState<Record<string, boolean>>({})
  const [freeText, setFreeText] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<{ ok: boolean; text: string; at: number } | null>(null)
  const [whyOpen, setWhyOpen] = useState<Record<string, boolean>>({})
  const [whyCache, setWhyCache] = useState<Record<string, SuperWhyLine[] | undefined>>({})
  const [cfgOpen, setCfgOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  // 规模适配：规则/轮次/卡片多了默认折叠（保留"最需要你"的在前），按段独立展开
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // 历史分页：本地追加的更早轮次（快照推送不带这些页；按 id 去重）
  const [extraHistory, setExtraHistory] = useState<SuperHistoryItem[]>([])
  const [historyMoreBusy, setHistoryMoreBusy] = useState(false)
  const [historyMoreDone, setHistoryMoreDone] = useState(false)
  const PAGE = 8

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  // 数字键 1-9 快捷拍板第一张 ask 卡的对应选项（对标 Agents 的 Y/N）。
  // 输入框聚焦时不抢键；岛收起时不响应；busy/只读时不触发。
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key < '1' || e.key > '9' || e.metaKey || e.ctrlKey || e.altKey) return
      const snapCur = snapRef.current
      if (!snapCur?.providers.some((p) => p.keyConfigured)) return
      const first = snapCur.decisions.find((d) => d.kind === 'ask' && d.options.length > 0)
      if (!first || busyRef.current[first.id]) return
      const idx = Number(e.key) - 1
      if (idx >= first.options.length) return
      e.preventDefault()
      void runActionRef.current(first.id, () => island.superAnswer(first.provider, first.cardId, idx))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const provider = snap?.providers[0] || null
  // 多提供方：任一中台可拍板即视为可动作；任一在线流即"实时"
  const anyCanAct = !!snap?.providers.some((p) => p.keyConfigured)
  const anyLive = !!snap?.providers.some((p) => p.live)
  const anyConnected = !!snap?.providers.some((p) => p.connected)
  const askCount = snap?.decisions.filter((d) => d.kind === 'ask').length || 0

  const runAction = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      const r = await fn()
      setToast(r.ok ? { ok: true, text: '已执行', at: Date.now() } : { ok: false, text: r.error || '执行失败', at: Date.now() })
    } catch (e) {
      setToast({ ok: false, text: String((e as Error)?.message || e).slice(0, 160), at: Date.now() })
    } finally {
      setBusy((b) => ({ ...b, [key]: false }))
      setArmed((a) => { const n = { ...a }; delete n[key]; return n })
    }
  }

  const toggleWhy = (h: SuperHistoryItem): void => {
    const open = !whyOpen[h.id]
    setWhyOpen((w) => ({ ...w, [h.id]: open }))
    if (open && whyCache[h.id] === undefined && provider) {
      setWhyCache((c) => ({ ...c, [h.id]: null as unknown as SuperWhyLine[] })) // 占位：加载中
      island.superWhy(provider.id, h.runId).then((r) => {
        setWhyCache((c) => ({ ...c, [h.id]: r.ok ? (r.lines || []) : [] }))
      }).catch(() => setWhyCache((c) => ({ ...c, [h.id]: [] })))
    }
  }

  // 快捷键用的稳定引用（避免 effect 依赖整包状态反复重挂）
  const snapRef = useRef(snap)
  snapRef.current = snap
  const busyRef = useRef(busy)
  busyRef.current = busy
  const runActionRef = useRef(runAction)
  runActionRef.current = runAction

  const notSetUp = !provider?.connected && !cfg.enabled

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {/* 顶部：连接状态（多提供方时每个一枚）+ 视图切换 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {(snap?.providers.length ? snap.providers : [null]).map((p) => (
          <ConnectionChip key={p?.id || 'none'} provider={p} enabled={cfg.enabled} onConfigure={() => setCfgOpen((v) => !v)} />
        ))}
        <span style={{ flex: 1 }} />
        <Button sm icon={Settings2} variant="primary" onClick={onOpenStudio} title="可视化编辑事件来源 / 规则回路 / Agent / 通道（写 rules.json，官方 check 校验）">可视化编排</Button>
        <Button sm icon={RefreshCw} disabled={busy.refresh} onClick={() => { setBusy((b) => ({ ...b, refresh: true })); island.superSnapshot().catch(() => {}).finally(() => setBusy((b) => ({ ...b, refresh: false }))) }}>刷新</Button>
      </div>

      {/* 系统问题：规则文件写错 / 接单程序或通道离线 / 卡片投递失败（没问题时不占空间） */}
      <ProblemsBar problems={problemsOf(snap)} />

      {/* 流水线可视化：真实实体的流动画面（常驻，不随分段切换） */}
      <SuperPipeline
        pipeline={snap?.pipeline || { sources: 0, rules: 0, pausedRules: 0, queued: 0, retrying: 0, running: 0, unknown: 0, doneToday: 0, nothingToday: 0, attention: 0, timers: 0 }}
        work={snap?.work || []}
        decisions={snap?.decisions || []}
        timers={snap?.timers || []}
        rules={snap?.rules || []}
        facts={snap?.facts || []}
        live={anyLive}
        demo={snap?.providers.some((p) => p.url === "demo://agent-autoloop")}
        animate={active}
        onJump={setSeg}
      />

      {toast && (
        <div style={{ padding: '7px 11px', borderRadius: R.md, background: toast.ok ? semBg(accent(), 0.14) : semBg(sem.danger, 0.14), color: toast.ok ? accentText(0.9) : sem.danger, fontSize: FS.small, lineHeight: 1.45, wordBreak: 'break-all' }}>
          {toast.text}
        </div>
      )}

      {/* 连接配置（未连上或点"配置"时展开；密钥随 save-state 落 DPAPI 加密的 config.json） */}
      {(cfgOpen || notSetUp) && (
        <ConfigCard cfg={cfg} onChange={onCfgChange} detected={provider?.hubDetected} discoveredUrl={!cfg.url.trim() ? provider?.url : null} onDone={() => setCfgOpen(false)} onOpenStudio={onOpenStudio} />
      )}

      {notSetUp && !provider?.hubDetected ? (
        <EmptyState
          icon={Zap}
          title="还没有接入后台循环"
          desc="循环分区监控的是「后台自己接活、拿不准才发卡片找你」的 Agent 中台（Agent Autoloop，本机常驻、不开端口）。装好后配一次本人密钥即可接入——任何命令行 Agent（Claude Code、Codex、DeepSeek Harness、任意 command）都能被它调度，在这里统一看到。"
          action={(
            <Button
              sm icon={Copy}
              onClick={() => {
                island.clipWriteText('irm https://raw.githubusercontent.com/KKKKhazix/agent-autoloop/main/install.ps1 | iex')
                setToast({ ok: true, text: '安装命令已复制：在 PowerShell 中粘贴执行（Node 24+）', at: Date.now() })
              }}
            >复制安装命令</Button>
          )}
        />
      ) : (
        <>
          {/* 视图切换（计数已在流水线节点上，这里只导航——避免重复信息与多余重绘） */}
          <Segmented<SuperSeg>
            options={[
              { key: 'decide', label: '待拍板' },
              { key: 'work', label: '进行中' },
              { key: 'rules', label: '规则' },
              { key: 'recent', label: '近况' }
            ]}
            value={seg}
            onChange={setSeg}
            style={{ alignSelf: 'flex-start' }}
          />

          {seg === 'decide' && (snap?.decisions.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm }}>
              {(expanded.decide ? snap.decisions : snap.decisions.slice(0, PAGE)).map((d) => (
                <DecisionCard key={d.id} d={d} now={now} busy={!!busy[d.id]} freeText={freeText[d.id] || ''} onFreeText={(v) => setFreeText((f) => ({ ...f, [d.id]: v }))}
                  onAnswer={(choice, textValue) => runAction(d.id, () => island.superAnswer(d.provider, d.cardId, choice, textValue))}
                  onResolve={() => runAction(d.id, () => island.superResolve(d.provider, d.cardId, '已在岛上处理'))}
                  canAct={anyCanAct}
                  showHotkeys={d.id === (snap.decisions.find((x) => x.kind === 'ask' && x.options.length > 0)?.id)} />
              ))}
              <MoreRow total={snap.decisions.length} shown={PAGE} open={!!expanded.decide} label="张卡片" onToggle={() => setExpanded((e) => ({ ...e, decide: !e.decide }))} />
            </div>
          ) : (
            <EmptyState icon={Check} title="没有等你拍板的事" desc={provider?.connected ? '后台循环安静运行中——需要你决定时会推卡片到这里。' : (provider?.detail || '未连接')} />
          ))}

          {seg === 'work' && (snap?.work.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm - 2 }}>
              {(expanded.work ? snap.work : snap.work.slice(0, PAGE)).map((w) => (
                <WorkRow key={w.id} w={w} armed={!!armed[w.id]} busy={!!busy[w.id]} canAct={anyCanAct}
                  onToggleArm={() => setArmed((a) => ({ ...a, [w.id]: !a[w.id] }))}
                  onStop={() => runAction(w.id, () => island.superStopRun(w.provider, w.runId))} />
              ))}
              <MoreRow total={snap.work.length} shown={PAGE} open={!!expanded.work} label="轮在跑" onToggle={() => setExpanded((e) => ({ ...e, work: !e.work }))} />
            </div>
          ) : (
            <EmptyState icon={Hourglass} title="没有进行中的轮次" desc="事件到达或定时到点后，规则会领活开跑。" />
          ))}

          {seg === 'rules' && (snap?.rules.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP.sm - 2 }}>
              {(expanded.rules ? snap.rules : snap.rules.slice(0, PAGE)).map((r) => (
                <RuleRow key={`${r.provider}:${r.name}`} r={r} armed={!!armed[`${r.provider}:${r.name}`]} busy={!!busy[`${r.provider}:${r.name}`]} canAct={anyCanAct}
                  onToggleArm={() => setArmed((a) => ({ ...a, [`${r.provider}:${r.name}`]: !a[`${r.provider}:${r.name}`] }))}
                  onAction={(action) => runAction(`${r.provider}:${r.name}`, () => island.superRuleAction(r.provider, r.name, action))}
                  replayArmed={!!armed[`replay:${r.provider}:${r.name}`]}
                  onToggleReplayArm={() => setArmed((a) => ({ ...a, [`replay:${r.provider}:${r.name}`]: !a[`replay:${r.provider}:${r.name}`] }))}
                  onReplay={() => runAction(`replay:${r.provider}:${r.name}`, () => {
                    // since = 那次暂停的起点（ISO 带时区；中台要求）
                    const since = r.pausedSince ? new Date(r.pausedSince).toISOString() : ''
                    return island.superRuleReplay(r.provider, r.name, since)
                  })} />
              ))}
              <MoreRow total={snap.rules.length} shown={PAGE} open={!!expanded.rules} label="条规则" onToggle={() => setExpanded((e) => ({ ...e, rules: !e.rules }))} />
              {/* elsewhere：托管在别处的定时任务（中台不启动它们，只列出；有 cwd 的也能回问） */}
              {(snap.elsewhere?.length || 0) > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...text.overline(), color: ink(3) }}>别处定时任务</span>
                    <span style={{ flex: 1, height: 0.5, background: hairline(0.07) }} />
                  </div>
                  {snap.elsewhere!.map((e) => (
                    <div key={e.name} title={`${e.where || ''}`} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 2px', opacity: 0.8 }}>
                      <Ico.clock size={10} strokeWidth={2} style={{ color: ink(4), flex: 'none' }} />
                      <span style={{ fontSize: 9.5, fontWeight: 600, color: ink(2) }}>{e.name}</span>
                      <span style={{ ...text.mono(8.5), color: ink(4) }}>{e.every || e.cron}</span>
                      <span style={{ marginLeft: 'auto', ...text.faint(), fontSize: 8.5 }}>{e.next ? `下次 ${fmtTime(e.next)}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <EmptyState icon={Zap} title="还没有规则" desc="点上方「编排」可视化新建，或直接编辑 ~/.agent-autoloop/rules.json。" />
          ))}

          {seg === 'recent' && (
            <RecentSection
            snap={snap}
            now={now}
            whyOpen={whyOpen}
            whyCache={whyCache}
            onToggleWhy={toggleWhy}
            extraHistory={extraHistory}
            historyMoreBusy={historyMoreBusy}
            historyMoreDone={historyMoreDone}
            onHistoryMore={() => {
              // 多中台时各库 seq 独立：翻"当前最老一条"所属的中台；无历史则退回第一个
              const oldest = [...(snap?.history || []), ...extraHistory].sort((x, y) => (x.finishedAt ?? 0) - (y.finishedAt ?? 0))[0]
              const p = snap?.providers.find((x) => x.id === oldest?.provider) || snap?.providers[0]
              if (!p) return
              setHistoryMoreBusy(true)
              island.superHistoryMore(p.id).then((r) => {
                if (r.ok && r.items) {
                  setExtraHistory((prev) => {
                    const seen = new Set(prev.map((x) => x.id))
                    return [...prev, ...r.items!.filter((x) => !seen.has(x.id))]
                  })
                  // nextBefore 为 null：没有更早的了
                  if (r.nextBefore === null) setHistoryMoreDone(true)
                } else if (!r.ok) {
                  setToast({ ok: false, text: r.error || '加载历史失败', at: Date.now() })
                }
              }).catch(() => setToast({ ok: false, text: '加载历史失败', at: Date.now() }))
                .finally(() => setHistoryMoreBusy(false))
            }}
          />
          )}
        </>
      )}
    </div>
  )
}

/* ---------------- 会话深链：http(s) 直接开；claude:// 等自定义协议只复制（不让卡片数据触发协议处理器） ---------------- */

function LinkChip({ link, session }: { link: string | null; session?: string | null }): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  if (!link) return null
  if (/^https?:\/\//i.test(link)) {
    return <Button sm variant="ghost" icon={ExternalLink} title={session ? `会话 ${session}` : link} onClick={() => island.openExternal(link)}>会话</Button>
  }
  const scheme = `${link.split(':')[0]}://`
  return (
    <button
      type="button"
      title={`${link}\n（自定义协议不自动打开，点击复制后自行运行）`}
      onClick={() => {
        island.clipWriteText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: R.sm,
        border: 0, fontFamily: 'inherit', cursor: 'pointer', flex: 'none',
        background: fill(1), color: copied ? accentText(0.9) : ink(3), fontSize: 9.5, fontWeight: 600
      }}
    >
      <Copy size={9} strokeWidth={2} />{copied ? '已复制' : scheme}
    </button>
  )
}

/* ---------------- 连接状态胶囊 ---------------- */

/** 系统问题聚合（对标 dsh 面板"面板先答系统健康吗"）：只有真实问题才占空间 */
interface SystemProblem { tone: 'danger' | 'warn'; title: string; detail: string }

function problemsOf(snap: SuperAgentSnapshot | null): SystemProblem[] {
  if (!snap) return []
  const out: SystemProblem[] = []
  for (const p of snap.providers) {
    if (p.hubDetected && !p.connected && p.detail) out.push({ tone: 'warn', title: `${p.label} 未连接`, detail: p.detail })
  }
  for (const c of snap.components) {
    if (c.online === false) out.push({ tone: 'warn', title: `${c.kind === 'agent' ? '接单程序' : c.kind === 'channel' ? '通道' : '来源'}「${c.name}」离线`, detail: c.detail || '心跳已超过 2 分钟' })
  }
  const failed = snap.decisions.filter((d) => d.deliveryFailed)
  if (failed.length > 0) {
    out.push({
      tone: 'danger',
      title: `${failed.length} 张卡片投递失败${failed.some((d) => d.deliveryFailed?.givenUp) ? '（含已放弃）' : ''}`,
      detail: failed.map((d) => `「${d.title}」${d.deliveryFailed?.error || ''}`).join('\n')
    })
  }
  const rulesErr = snap.decisions.filter((d) => /rules\.json/i.test(d.title) || /rules\.json/i.test(d.text || ''))
  if (rulesErr.length > 0) {
    out.push({ tone: 'danger', title: '规则文件写错了（中台仍在用旧规则）', detail: rulesErr.map((d) => d.text).join('\n').slice(0, 400) })
  }
  return out
}

function ProblemsBar({ problems }: { problems: SystemProblem[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (problems.length === 0) return null
  const danger = problems.some((p) => p.tone === 'danger')
  return (
    <div style={{
      borderRadius: R.md, border: `0.5px solid ${semBg(danger ? sem.danger : sem.warn, 0.3)}`,
      background: semBg(danger ? sem.danger : sem.warn, 0.1), overflow: 'hidden'
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px',
          border: 0, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left'
        }}
      >
        <Ico.approval size={11} strokeWidth={2.2} style={{ color: danger ? sem.danger : sem.warn, flex: 'none' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: ink(1) }}>系统问题 · {problems.length}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 9.5, color: ink(3), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {problems[0].title}
        </span>
        {open ? <Ico.collapse size={11} strokeWidth={2} /> : <Ico.expand size={11} strokeWidth={2} />}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 10px 8px' }}>
          {problems.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <span style={{ width: 4, height: 4, borderRadius: 999, marginTop: 5, flex: 'none', background: p.tone === 'danger' ? sem.danger : sem.warn }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 9.5, color: ink(1), fontWeight: 650 }}>{p.title}</div>
                {p.detail && <div style={{ fontSize: 9, color: ink(3), lineHeight: 1.45, wordBreak: 'break-word' }}>{p.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 规模适配：列表超过一页时的"还有 N 条 / 收起"行（超过一页才渲染） */
/** 规模适配：列表超过一页时的"还有 N 条 / 收起"行（超过一页才渲染） */
function MoreRow({ total, shown, open, label, onToggle }: { total: number; shown: number; open: boolean; label: string; onToggle: () => void }): React.JSX.Element | null {
  if (total <= shown) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        border: 0, background: 'transparent', color: ink(3), fontSize: 9.5, fontWeight: 600,
        textAlign: 'left', cursor: 'pointer', padding: '4px 2px', fontFamily: 'inherit'
      }}
    >
      {open ? `收起（已显示全部 ${total} ${label}）` : `还有 ${total - shown} ${label} · 展开全部`}
    </button>
  )
}

function ConnectionChip({ provider, enabled, onConfigure }: { provider: SuperAgentSnapshot['providers'][number] | null; enabled: boolean; onConfigure: () => void }): React.JSX.Element {
  const connected = provider?.connected
  const tone = connected ? accent() : provider?.hubDetected || enabled ? sem.warn : ink(4)
  const label = connected ? '循环在线' : provider?.hubDetected || enabled ? '循环未连上' : '未接入'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: R.pill, background: connected ? semBg(accent(), 0.14) : fill(2), flex: 'none' }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: tone, boxShadow: connected ? `0 0 5px ${tone}` : undefined }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, color: connected ? accentText(0.9) : ink(2) }}>{label}</span>
        {connected && provider?.live && (
          <span title="SSE 增量流在线：卡片与轮次变更秒级到达" style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: R.sm, background: semBg(accent(), 0.18), color: accentText(0.9) }}>实时</span>
        )}
      </div>
      {provider?.detail && <span title={provider.detail} style={{ ...text.faint(), fontSize: 9.5, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider.detail}</span>}
      {provider?.updatedAt && !connected && <span style={{ ...text.faint(), fontSize: 9.5 }}>数据截至 {fmtTime(provider.updatedAt)}</span>}
      <Button sm variant="ghost" onClick={onConfigure} title="只配置中台连接（地址与本人密钥）">连接</Button>
    </div>
  )
}

/* ---------------- 连接配置卡 ---------------- */

function ConfigCard({ cfg, onChange, detected, discoveredUrl, onDone, onOpenStudio }: { cfg: SuperAgentSettings; onChange: (c: SuperAgentSettings) => void; detected?: boolean; discoveredUrl?: string | null; onDone: () => void; onOpenStudio: () => void }): React.JSX.Element {
  return (
    <div style={{ ...surface.card(), padding: SP.md, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...text.subtitle(), fontSize: FS.body }}>连接中台</span>
        {detected && <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: R.sm, background: semBg(accent(), 0.14), color: accentText(0.9), fontWeight: 600 }}>已检测到本机中台</span>}
        <span style={{ flex: 1 }} />
        <Switch on={cfg.enabled} onChange={(on) => onChange({ ...cfg, enabled: on })} label={cfg.enabled ? '监控中' : '已停用'} />
      </div>
      <div style={{ ...text.faint(), fontSize: 10, lineHeight: 1.5 }}>
        地址留空 = 自动发现本机中台（~/.agent-autoloop/config.json）。本人密钥在本机执行 <code style={text.mono(9.5)}>agent-autoloop key new owner island</code> 生成后粘贴到下面（<code style={text.mono(9.5)}>key list</code> 可查已有密钥）；中台在别的机器上时填它的局域网地址。配好后建议关掉 autoloop 自己的桌面通知通道，由岛统一提醒，避免双响。
      </div>
      {discoveredUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9.5, color: accentText(0.85) }}>
          <span style={{ width: 4, height: 4, borderRadius: 999, background: accent(), flex: 'none' }} />
          自动发现：<span style={text.mono(9.5)}>{discoveredUrl}</span>
        </div>
      )}
      <Input value={cfg.url} onChange={(v) => onChange({ ...cfg, url: v })} placeholder="中台地址（留空自动发现，如 http://127.0.0.1:37890）" icon={Link2} />
      <Input value={cfg.ownerKey} onChange={(v) => onChange({ ...cfg, ownerKey: v })} placeholder="本人密钥（owner key，留空则只读、无法拍板）" type="password" />
      {/* 轮询间隔：SSE 流在线时自动退为兜底节奏，这里调的是兜底频率 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...text.overline(), color: ink(3), flex: 'none' }}>轮询间隔</span>
        <div style={{ display: 'inline-flex', padding: 2, gap: 2, borderRadius: R.md, ...surface.inset() }}>
          {[5, 15, 30, 60].map((sec) => {
            const on = (cfg.pollMs || 15) === sec
            return (
              <button
                key={sec}
                type="button"
                onClick={() => onChange({ ...cfg, pollMs: sec })}
                style={{
                  border: 0, borderRadius: R.sm - 1, padding: '3px 10px', fontFamily: 'inherit', cursor: 'pointer',
                  background: on ? fill(4) : 'transparent', color: on ? ink(1) : ink(3),
                  fontSize: 10, fontWeight: on ? 700 : 500, fontVariantNumeric: 'tabular-nums'
                }}
              >{sec}s</button>
            )
          })}
        </div>
        <span style={{ ...text.faint(), fontSize: 9 }}>实时流在线时自动降频为兜底</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button sm icon={Settings2} variant="tinted" onClick={onOpenStudio}>打开可视化编排</Button>
        <span style={{ ...text.faint(), fontSize: 9, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>规则 / Agent / 事件来源 / 通道</span>
        <span style={{ flex: 1 }} />
        <Button sm variant="primary" onClick={onDone}>收起</Button>
      </div>
    </div>
  )
}

/* ---------------- 待拍板卡片 ---------------- */

function DecisionCard({ d, now, busy, freeText, onFreeText, onAnswer, onResolve, canAct, showHotkeys }: {
  d: SuperDecision
  now: number
  busy: boolean
  freeText: string
  onFreeText: (v: string) => void
  onAnswer: (choice?: number, text?: string) => void
  onResolve: () => void
  canAct: boolean
  /** 第一张 ask 卡：显示数字键快捷提示（对标 Agents 的 Y/N 提示） */
  showHotkeys?: boolean
}): React.JSX.Element {
  const isAsk = d.kind === 'ask' && d.options.length > 0
  const age = fmtAge(d.createdAt, now)
  // 老龄升级：挂起超过 30 分钟的 ask 卡片提升边框与标题警示（该占的注意力要占到）
  const stale = isAsk && d.createdAt > 0 && now - d.createdAt > 30 * 60 * 1000
  return (
    <motion.div
      variants={fadeScaleIn}
      initial={false}
      animate="animate"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: `${SP.md}px ${SP.md + 1}px`,
        ...surface.card(),
        ...(isAsk || d.kind === 'ask'
          ? {
              background: `linear-gradient(90deg, ${semBg(sem.warn, 0.62)} 0 3px, ${fill(2)} 3px)`,
              border: `0.5px solid ${semBg(sem.warn, stale ? 0.45 : 0.26)}`,
              ...(stale ? { boxShadow: `0 10px 28px -16px ${semBg(sem.warn, 0.35)}` } : {})
            }
          : {})
      }}
    >
      {/* 头部：标题 + 来源规则 + 年龄。老龄警示靠边框与年龄胶囊底色传达，
          文字一律 ink 系——琥珀字在浅色主题（control-center）下对比度会崩（对比度审计实测 1.08:1）。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ ...text.subtitle(), fontSize: FS.body, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
        {d.rule && <span style={{ ...text.mono(9.5), background: fill(1), padding: '1px 7px', borderRadius: R.sm, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 'none' }}>{d.rule}</span>}
        {age && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none',
            padding: '1.5px 7px', borderRadius: R.sm,
            background: stale ? semBg(sem.warn, 0.22) : fill(1),
            color: ink(stale ? 1 : 3),
            fontSize: 9.5, fontWeight: stale ? 700 : 500, fontVariantNumeric: 'tabular-nums'
          }}>
            <Clock size={10} strokeWidth={2} />{age}
          </span>
        )}
      </div>
      {/* 正文：不可信输入，按纯文本渲染 */}
      {d.text && (
        <div style={{ color: ink(1), fontSize: FS.small, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 150, overflowY: 'auto' }}>{d.text}</div>
      )}
      {d.about && <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.5 }}>接着做：{d.about}</div>}
      {/* 投递失败：卡片可能根本没送到你的通道（不是"岛上没有"，是"哪都没收到"） */}
      {d.deliveryFailed && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: R.md,
          background: semBg(sem.danger, 0.12), border: `0.5px solid ${semBg(sem.danger, 0.3)}`
        }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: sem.danger, flex: 'none' }}>
            {d.deliveryFailed.givenUp ? '通道已放弃投递' : `投递失败 ${d.deliveryFailed.tries} 次`}
          </span>
          <span style={{ fontSize: 9, color: ink(2), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.deliveryFailed.error}>{d.deliveryFailed.error}</span>
        </div>
      )}
      {/* 选项按钮：推荐项高亮；notice 只有"已处理" */}
      {isAsk ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {d.options.map((opt, i) => (
              <Button key={i} sm variant={d.recommend === i ? 'primary' : 'ghost'} disabled={busy || !canAct} onClick={() => onAnswer(i)} title={opt}>
                {opt}{d.recommend === i ? ' ✓' : ''}
              </Button>
            ))}
            {d.link && <Button sm variant="ghost" icon={ExternalLink} onClick={() => island.openExternal(d.link!)}>打开</Button>}
          </div>
          {/* 自由回答：文本经 HTTP JSON 体回传，不拼命令行 */}
          <div style={{ display: 'flex', gap: 7 }}>
            <Input value={freeText} onChange={onFreeText} placeholder="或写一句自由回答…" onKeyDown={(e) => { if (e.key === 'Enter' && freeText.trim()) onAnswer(undefined, freeText.trim()) }} style={{ flex: 1 }} />
            <Button sm variant="ghost" icon={Ico.send} disabled={busy || !canAct || !freeText.trim()} onClick={() => onAnswer(undefined, freeText.trim())}>发送</Button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          <Button sm variant="ghost" icon={Check} disabled={busy || !canAct} onClick={onResolve}>已处理</Button>
          {d.link && <Button sm variant="ghost" icon={ExternalLink} onClick={() => island.openExternal(d.link!)}>打开</Button>}
          <span style={{ marginLeft: 'auto', ...text.faint(), fontSize: 9.5 }}>通知 · 无需决定</span>
        </div>
      )}
      {!canAct && <div style={{ ...text.faint(), fontSize: 9.5 }}>未配置本人密钥，只读模式——在上方「配置」里填写后即可拍板。</div>}
      {canAct && showHotkeys && d.options.length > 0 && (
        <div style={{ ...text.faint(), fontSize: 9.5 }}>
          快捷键：<b style={{ color: ink(2) }}>1-{Math.min(9, d.options.length)}</b> 选择选项
        </div>
      )}
    </motion.div>
  )
}

/* ---------------- 进行中的轮次 ---------------- */

function WorkRow({ w, armed, busy, canAct, onToggleArm, onStop }: {
  w: SuperWork
  armed: boolean
  busy: boolean
  canAct: boolean
  onToggleArm: () => void
  onStop: () => void
}): React.JSX.Element {
  const claimed = w.state === 'claimed'
  return (
    <div style={{ ...surface.card(), padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, flex: 'none', background: claimed ? accent() : w.state === 'unknown' ? sem.warn : ink(4), boxShadow: claimed ? `0 0 5px ${accent()}` : undefined, animation: claimed ? 'ai-dotpulse 2.4s ease-in-out infinite' : undefined }} />
        <span style={{ fontSize: FS.small, fontWeight: 650, color: ink(1), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.rule}{w.lane ? ` · ${w.lane}` : ''}</span>
        {w.agent && <span style={{ ...text.mono(9.5), background: semBg(sem.focus, 0.12), color: sem.focus, padding: '1px 7px', borderRadius: R.sm, flex: 'none' }}>{w.agent}</span>}
        <LinkChip link={w.link} session={w.session} />
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 650, color: claimed ? accentText(0.9) : w.state === 'unknown' ? sem.warn : ink(3), flex: 'none' }}>
          {WORK_STATE_LABEL[w.state]}{w.stopping ? ' · 停止中' : ''}{w.attempts > 0 ? ` · 重试 ${w.attempts}` : ''}{w.manual ? ' · 手动' : ''}
        </span>
        {canAct && (
          <Button sm variant={armed ? 'danger' : 'ghost'} disabled={busy} onClick={armed ? onStop : onToggleArm} title={armed ? '再点一次确认停止' : '停止这一轮'}>
            {armed ? '确认停止' : <><Square size={10} strokeWidth={2.5} />停止</>}
          </Button>
        )}
      </div>
      {(w.error || w.summary || w.notBefore) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ color: w.error ? sem.danger : ink(3), fontSize: 10, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={w.error || w.summary || ''}>
            {w.error || w.summary || ''}
          </span>
          {/* 等重试：告诉用户"为什么不动"以及什么时候会再试 */}
          {w.attempts > 0 && w.notBefore && (
            <span style={{ ...text.mono(9), color: sem.warn, flex: 'none' }} title="下次重试的最早时刻">
              重试等待 {fmtTime(w.notBefore)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------- 规则行 ---------------- */

function RuleRow({ r, armed, busy, canAct, onToggleArm, onAction, onReplay, replayArmed, onToggleReplayArm }: {
  r: SuperRule
  armed: boolean
  busy: boolean
  canAct: boolean
  onToggleArm: () => void
  onAction: (action: 'pause' | 'resume' | 'run') => void
  /** 补跑暂停期间跳过的事件（普通规则；暂停中的规则要恢复后才能补跑） */
  onReplay: () => void
  replayArmed: boolean
  onToggleReplayArm: () => void
}): React.JSX.Element {
  return (
    <div style={{ ...surface.card(), padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 6, ...(r.paused ? { opacity: 0.85 } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ fontSize: FS.small, fontWeight: 650, color: ink(1), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        {r.agent && <span style={{ ...text.mono(9.5), background: semBg(sem.focus, 0.12), color: sem.focus, padding: '1px 7px', borderRadius: R.sm, flex: 'none' }}>{r.agent}</span>}
        {(r.every || r.sourceType) && (
          <span title={r.next ? `下次 ${fmtTime(r.next)}` : undefined} style={{ ...text.mono(9), color: ink(3), flex: 'none' }}>
            {r.every || `@${r.sourceType}`}{r.next ? ` · ${fmtDue(r.next, Date.now())}` : ''}
          </span>
        )}
        {r.paused && <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 7px', borderRadius: R.sm, background: semBg(sem.warn, 0.16), color: sem.warn, flex: 'none' }}>已暂停{r.skippedCount > 0 ? ` · 跳过 ${r.skippedCount}` : ''}</span>}
        {/* 今日战况：完成 / 没事做 / 重试（真实 tally，缺失时不显示） */}
        {r.today && (r.today.done > 0 || r.today.nothing > 0 || r.today.retrying > 0 || r.today.running > 0 || r.today.queued > 0) && (
          <span title={`今日：完成 ${r.today.done} · 没事做 ${r.today.nothing} · 运行 ${r.today.running} · 排队 ${r.today.queued} · 重试 ${r.today.retrying}`} style={{ ...text.mono(9), color: ink(4), flex: 'none' }}>
            今日 {r.today.done}{r.today.retrying > 0 ? ` · 重试 ${r.today.retrying}` : ''}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {canAct && (
          <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
            {r.paused
              ? <Button sm variant="ghost" icon={Play} disabled={busy} onClick={() => onAction('resume')}>恢复</Button>
              : <Button sm variant="ghost" icon={Pause} disabled={busy} onClick={() => onAction('pause')}>暂停</Button>}
            {/* 补跑：暂停期间被跳过的事件原样交回规则（协议明确"恢复时打印的就是这条命令"）。
                暂停中的规则上游不允许补跑（409），所以只在恢复后出现。 */}
            {!r.paused && r.skippedCount > 0 && (
              <Button
                sm
                variant={replayArmed ? 'warn' : 'ghost'}
                icon={History}
                disabled={busy}
                title={replayArmed ? '再点一次确认补跑' : `补跑暂停期间跳过的 ${r.skippedCount} 条事件`}
                onClick={replayArmed ? onReplay : onToggleReplayArm}
              >
                {replayArmed ? '确认补跑' : `补跑 ${r.skippedCount}`}
              </Button>
            )}
            {/* 立即运行会触发真实 Agent 执行（花钱/外发），两步确认 */}
            <Button sm variant={armed ? 'warn' : 'ghost'} disabled={busy} onClick={armed ? () => onAction('run') : onToggleArm} title={armed ? '再点一次确认运行' : '立即跑一轮（会真实执行）'}>
              {armed ? '确认运行' : '运行'}
            </Button>
          </div>
        )}
      </div>
      {r.paused && r.pauseReason && <div style={{ ...text.faint(), fontSize: 9.5 }}>暂停原因：{r.pauseReason}{r.pausedSince ? `（${fmtTime(r.pausedSince)} 起）` : ''}</div>}
    </div>
  )
}

/* ---------------- 近况：用量 + 复查 + 历史 ---------------- */

function RecentSection({ snap, now, whyOpen, whyCache, onToggleWhy, extraHistory, historyMoreBusy, historyMoreDone, onHistoryMore }: {
  snap: SuperAgentSnapshot | null
  now: number
  whyOpen: Record<string, boolean>
  whyCache: Record<string, SuperWhyLine[] | undefined>
  onToggleWhy: (h: SuperHistoryItem) => void
  extraHistory: SuperHistoryItem[]
  historyMoreBusy: boolean
  historyMoreDone: boolean
  onHistoryMore: () => void
}): React.JSX.Element {
  const spend = snap?.spend || null
  const timers: SuperTimer[] = snap?.timers || []
  // 首页 + 本地加载的更早页：按 id 去重后统一按结束时间倒序
  const merged = new Map<string, SuperHistoryItem>()
  for (const h of [...(snap?.history || []), ...extraHistory]) merged.set(h.id, h)
  const history = [...merged.values()].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  const components = snap?.components || []
  const KIND_ICON = { agent: Ico.agent, channel: Ico.bell, source: Ico.rss } as const
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {/* 用量：未上报的轮数如实单列（不当 0） */}
      {spend && (
        <div style={{ ...surface.card(), padding: SP.md, display: 'flex', gap: 14 }}>
          <SpendBlock title="今天" w={spend.today} />
          <div style={{ width: 0.5, background: hairline(0.08) }} />
          <SpendBlock title="近 7 天" w={spend.week} />
        </div>
      )}
      {/* 部件在线：Agent 接单程序 / 通道 / 事件源（图标区分种类，title 看异常详情） */}
      {components.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {components.map((c, i) => {
            const KindIcon = KIND_ICON[c.kind]
            // online===null（事件源无心跳概念）：中性点；false（掉线）：琥珀提示，不升级成危险红
            const dotColor = c.online === true ? accent() : c.online === false ? sem.warn : ink(4)
            return (
              <span key={`${c.kind}-${c.name}-${i}`} title={c.detail || `${c.kind} · ${c.name}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: R.pill, background: fill(1), fontSize: 9.5, color: c.online === false ? ink(4) : ink(2) }}>
                {KindIcon && <KindIcon size={9} strokeWidth={2} style={{ opacity: 0.6, flex: 'none' }} />}
                <span style={{ width: 4, height: 4, borderRadius: 999, background: dotColor, flex: 'none' }} />
                {c.name}
              </span>
            )
          })}
        </div>
      )}
      {/* 未来复查 */}
      {timers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} strokeWidth={2} style={{ color: accentText(), flex: 'none' }} />
            <span style={{ ...text.overline(), color: ink(3) }}>约定的复查</span>
            <span style={{ flex: 1, height: 0.5, background: hairline(0.07) }} />
          </div>
          {timers.slice(0, 6).map((t) => (
            <div key={`${t.rule}-${t.key}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '0 2px' }}>
              <span title={fmtTime(t.at)} style={{ ...text.mono(9.5), color: accentText(0.85), flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{fmtDue(t.at, now)}</span>
              <span style={{ fontSize: 10, color: ink(2), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.rule}{t.lane ? ` · ${t.lane}` : ''}</span>
              <span style={{ fontSize: 9.5, color: ink(4), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.about}</span>
            </div>
          ))}
        </div>
      )}
      {/* 暂停期间被跳过的事件：只显示数量的话，用户无法判断该不该补跑 */}
      {(snap?.skipped?.length || 0) > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ico.approval size={11} strokeWidth={2} style={{ color: sem.warn, flex: 'none' }} />
            <span style={{ ...text.overline(), color: sem.warn }}>暂停期间跳过 · {snap!.skipped.length}</span>
            <span style={{ flex: 1, height: 0.5, background: hairline(0.07) }} />
            <span style={{ ...text.faint(), fontSize: 8.5 }}>恢复后在「规则」里补跑</span>
          </div>
          {snap!.skipped.slice(0, 5).map((s) => (
            <div key={s.id} title={`${s.type}${s.subject ? ` · ${s.subject}` : ''}\n${s.summary || ''}`} style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '1px 2px', minWidth: 0 }}>
              <span style={{ ...text.mono(8.5), color: ink(4), flex: 'none' }}>{s.at ? fmtTime(s.at) : '—'}</span>
              <span style={{ ...text.mono(8.5), color: sem.focus, flex: 'none' }}>{s.type}</span>
              <span style={{ fontSize: 9, color: ink(2), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {s.subject || s.summary || s.source}
              </span>
              <span style={{ ...text.faint(), fontSize: 8.5, flex: 'none', maxWidth: '28%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.rules.join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* 历史轮次 + why 时间线 */}
      {history.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <History size={12} strokeWidth={2} style={{ color: accentText(), flex: 'none' }} />
            <span style={{ ...text.overline(), color: ink(3) }}>最近的轮次</span>
            <span style={{ flex: 1, height: 0.5, background: hairline(0.07) }} />
          </div>
          {history.map((h) => (
            <div key={h.id} style={{ ...surface.inset(), borderRadius: R.md, padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, cursor: 'pointer' }} onClick={() => onToggleWhy(h)}>
                <OutcomeChip outcome={h.outcome} />
                <span style={{ fontSize: 10, fontWeight: 600, color: ink(1), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.rule}</span>
                {h.agent && <span style={{ ...text.mono(9), color: ink(3), flex: 'none' }}>{h.agent}</span>}
                <LinkChip link={h.link} session={h.session} />
                <span style={{ marginLeft: 'auto', ...text.mono(9), color: ink(4), flex: 'none' }}>{fmtTime(h.finishedAt)}</span>
                {(h.tokens !== null || h.costUsd !== null) && (
                  <span style={{ ...text.mono(9), color: ink(3), flex: 'none' }}>{fmtTokens(h.tokens)}{h.costUsd !== null ? ` · $${h.costUsd.toFixed(2)}` : ''}</span>
                )}
              </div>
              {h.summary && <div style={{ fontSize: 9.5, color: ink(3), lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.summary}>{h.summary}</div>}
              {whyOpen[h.id] && (
                <WhyTimeline lines={whyCache[h.id]} />
              )}
            </div>
          ))}
          {/* 中台一次给 60 轮；这里可继续往前翻（按 nextBefore） */}
          {!historyMoreDone && (
            <Button sm variant="ghost" icon={History} disabled={historyMoreBusy} onClick={onHistoryMore} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
              {historyMoreBusy ? '加载中…' : '加载更早的轮次'}
            </Button>
          )}
        </div>
      ) : (
        <EmptyState icon={History} title="还没有完成的轮次" desc="跑完的轮次会带着结果与用量出现在这里。" />
      )}
    </div>
  )
}

function SpendBlock({ title, w }: { title: string; w: SuperSpendWindow }): React.JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ ...text.overline(), color: ink(3) }}>{title} · {w.rounds} 轮</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: ink(1), fontVariantNumeric: 'tabular-nums' }}>
        {fmtTokens(w.tokens)} tokens{w.costUsd !== null ? ` · $${w.costUsd.toFixed(2)}` : ''}
      </span>
      {/* 缓存命中的部分单价更低，单独给出（协议字段 cached） */}
      {w.cached !== null && w.cached > 0 && (
        <span style={{ fontSize: 9, color: ink(4) }}>其中缓存 {fmtTokens(w.cached)}</span>
      )}
      {/* 未上报的轮数如实标注——0 轮未上报时省略（安静原则） */}
      {(w.missingTokens > 0 || w.missingCost > 0) && (
        <span style={{ fontSize: 9, color: sem.warn }}>{w.missingTokens > 0 ? `${w.missingTokens} 轮未报 tokens` : ''}{w.missingTokens > 0 && w.missingCost > 0 ? ' · ' : ''}{w.missingCost > 0 ? `${w.missingCost} 轮未报费用` : ''}</span>
      )}
    </div>
  )
}

function OutcomeChip({ outcome }: { outcome: SuperHistoryItem['outcome'] }): React.JSX.Element {
  const tone = OUTCOME_TONE[outcome]
  const bg = tone === 'ok' ? semBg(accent(), 0.16) : tone === 'bad' ? semBg(sem.danger, 0.14) : fill(3)
  const fg = tone === 'ok' ? accentText(0.88, 0.95) : tone === 'bad' ? sem.danger : ink(2)
  return (
    <span style={{ flex: 'none', fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: R.sm, background: bg, color: fg }}>{OUTCOME_LABEL[outcome]}</span>
  )
}

function WhyTimeline({ lines }: { lines: SuperWhyLine[] | undefined | null }): React.JSX.Element {
  if (lines === undefined) return <div style={{ ...text.faint(), fontSize: 9.5, padding: '2px 0' }}>加载中…</div>
  if (lines === null || lines.length === 0) return <div style={{ ...text.faint(), fontSize: 9.5, padding: '2px 0' }}>（这一轮没有可展示的来龙去脉）</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingTop: 4, borderTop: `0.5px solid ${hairline(0.08)}` }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
          <span style={{ flex: 'none', ...text.mono(8.5), color: ink(4), fontVariantNumeric: 'tabular-nums' }}>{l.at ? fmtTime(l.at) : '—'}</span>
          <span style={{ fontSize: 9.5, color: i === lines.length - 1 ? ink(1) : ink(3), lineHeight: 1.45, paddingBottom: 4, wordBreak: 'break-word' }}>{l.text}</span>
        </div>
      ))}
    </div>
  )
}
