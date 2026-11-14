// 可视化编排工作台（Super-Agent 的"完全态设置"）：把 rules.json 的四层自定义
// ——事件来源 / 规则（回路）/ Agent / 通知通道——做成表单，草稿用官方 `agent-autoloop check`
// 校验通过才允许保存；保存时自动备份原文件、tmp+rename 原子替换，中台几秒内热载生效。
//
// 三条边界（对应 AGENTS.md 约束 28 的同族要求）：
// 1. 编辑器是**合并式**的：改已知字段时保留对象上用户手写的其它键（只在显式删除时才删键）。
// 2. rules.json 是严格 JSON（上游 JSON.parse）——这里不自作主张写注释，JSON 视图可复制可校对。
// 3. 远程中台（地址不是本机）没有本地文件可编辑——入口由上层禁用并说明。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, FolderGit2, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import type { AutoloopAgentDef, AutoloopChannelDef, AutoloopRuleDef, AutoloopRules, AutoloopSourceDef } from '../../../shared/protocol'
import { island } from '../bridge'
import { Button, EmptyState, Input } from '../ui/components'
import { Ico } from '../ui/icons'
import { accentText, accent, fill, FS, gradient, hairline, ink, R, sem, semBg, surface, text } from '../ui/tokens'

type StudioNav = 'general' | 'sources' | 'agents' | 'channels' | 'rules' | 'json'

interface SuperConfigStudioProps {
  onClose: () => void
  /** 保存成功后通知外层刷新快照（中台几秒内热载） */
  onSaved?: () => void
}

const NAV: { key: StudioNav; label: string; icon: typeof Ico.plan; desc: string }[] = [
  { key: 'general', label: '全局', icon: Ico.settings, desc: '时区、先问哪些事、默认通道' },
  { key: 'sources', label: '事件来源', icon: Ico.rss, desc: '世界怎么变成事件' },
  { key: 'agents', label: 'Agent', icon: Ico.agent, desc: '谁来干活（任意 CLI）' },
  { key: 'channels', label: '通道', icon: Ico.bell, desc: '卡片送到哪' },
  { key: 'rules', label: '规则 / 回路', icon: Ico.plan, desc: '什么事件 → 交给谁 → 哪个目录' },
  { key: 'json', label: 'JSON 校对', icon: Ico.history, desc: '完整原文与复制' }
]

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** 小控件：字段行 */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ ...text.overline(), color: ink(3) }}>{label}{hint ? <span style={{ color: ink(4), fontWeight: 400 }}> · {hint}</span> : null}</span>
      {children}
    </label>
  )
}

/** 样式化的原生 select（项目无通用 Select；原生下拉在 Electron 里行为最稳） */
function Sel({ value, onChange, children, style }: { value: string; onChange: (v: string) => void; children: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...surface.inset(), color: ink(1), fontSize: FS.small, fontFamily: 'inherit',
        padding: '0 8px', height: 30, outline: 'none', border: 0, minWidth: 0, ...style
      }}
    >
      {children}
    </select>
  )
}

function Area({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }): React.JSX.Element {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...surface.inset(), width: '100%', boxSizing: 'border-box', resize: 'vertical',
        color: ink(1), fontSize: FS.small, lineHeight: 1.5, fontFamily: 'inherit',
        padding: '7px 9px', outline: 'none', border: 0, minHeight: 54
      }}
    />
  )
}

/** 标签输入（askFirst 这类字符串列表） */
function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const add = (): void => {
    const t = text.trim()
    if (!t) return
    if (!values.includes(t)) onChange([...values, t])
    setText('')
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {values.map((v) => (
          <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 9px', borderRadius: R.pill, background: semBg(sem.warn, 0.14), color: ink(1), fontSize: 10 }}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} style={{ border: 0, background: 'transparent', color: ink(3), cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 2 }}>
              <X size={9} strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>
      <Input value={text} onChange={setText} placeholder={placeholder || '输入后回车添加'} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
    </div>
  )
}

export function SuperConfigStudio({ onClose, onSaved }: SuperConfigStudioProps): React.JSX.Element {
  const [nav, setNav] = useState<StudioNav>('rules')
  const [draft, setDraft] = useState<AutoloopRules | null>(null)
  const [path, setPath] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'load' | 'check' | 'save' | null>(null)
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [reloadArmed, setReloadArmed] = useState(false)
  const [closeArmed, setCloseArmed] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setBusy('load'); setLoadError(null); setCheck(null)
    try {
      const r = await island.superRulesRead()
      setPath(r.path)
      if (r.ok && r.rules) {
        setDraft(clone(r.rules)); setDirty(false)
      } else {
        setDraft(null); setLoadError(r.error || '读取失败')
      }
    } catch (e) {
      setDraft(null); setLoadError(String((e as Error)?.message || e).slice(0, 240))
    } finally { setBusy(null) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  /** 合并式更新：保留用户手写的未知键 */
  const patch = useCallback((fn: (d: AutoloopRules) => AutoloopRules): void => {
    setDraft((d) => {
      if (!d) return d
      setDirty(true); setCheck(null)
      return fn(clone(d))
    })
  }, [])

  const json = useMemo(() => (draft ? JSON.stringify(draft, null, 2) : ''), [draft])

  /**
   * 安全重命名条目编号（sources/agents/channels）：改名同时**同步所有引用**，
   * 否则一条规则会突然指向不存在的来源/Agent。冲突时不动并提示。
   */
  const renameKey = useCallback((kind: 'sources' | 'agents' | 'channels', from: string, to: string): void => {
    const next = to.trim()
    if (!draft || !next || next === from) return
    const table = (kind === 'sources' ? draft.sources : kind === 'agents' ? draft.agents : (draft.channels || {})) as Record<string, unknown>
    if (Object.hasOwn(table, next)) {
      setToast({ ok: false, text: `编号「${next}」已被占用` })
      return
    }
    patch((d) => {
      const out: AutoloopRules = { ...d }
      const moved: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(table)) moved[k === from ? next : k] = v
      if (kind === 'sources') out.sources = moved as AutoloopRules['sources']
      else if (kind === 'agents') out.agents = moved as AutoloopRules['agents']
      else out.channels = moved as NonNullable<AutoloopRules['channels']>
      // 引用同步
      if (kind === 'sources') {
        out.rules = d.rules.map((r) => ({
          ...r,
          when: r.when?.source === from ? { ...r.when, source: next } : r.when,
          emits: r.emits?.source === from ? { ...r.emits, source: next } : r.emits
        }))
        if (d.elsewhere) out.elsewhere = d.elsewhere.map((e) => (e.source === from ? { ...e, source: next } : e))
      } else if (kind === 'agents') {
        out.rules = d.rules.map((r) => (r.to === from ? { ...r, to: next } : r))
        if (d.elsewhere) out.elsewhere = d.elsewhere.map((e) => (e.to === from ? { ...e, to: next } : e))
      } else {
        if (d.defaultChannels) out.defaultChannels = d.defaultChannels.map((c) => (c === from ? next : c))
        out.rules = d.rules.map((r) => (r.channels ? { ...r, channels: r.channels.map((c) => (c === from ? next : c)) } : r))
      }
      return out
    })
    setToast({ ok: true, text: `已改名 ${from} → ${next}，并同步了引用` })
  }, [draft, patch])

  const doCheck = async (): Promise<void> => {
    if (!draft) return
    setBusy('check')
    try {
      const r = await island.superRulesValidate(json)
      setCheck(r)
    } finally { setBusy(null) }
  }
  const doSave = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    try {
      const r = await island.superRulesSave(json)
      if (r.ok) {
        setDraft(r.rules ? clone(r.rules) : draft)
        setDirty(false); setCheck({ ok: true })
        setToast({ ok: true, text: `已保存${r.backupPath ? `（原文件备份：${r.backupPath.split(/[\\/]/).pop()}）` : ''} · 中台几秒内自动生效` })
        onSaved?.()
      } else {
        setCheck({ ok: false, error: r.error })
        setToast({ ok: false, text: '保存被拒绝——先修正校验问题（原文件未改动）' })
      }
    } catch (e) {
      setToast({ ok: false, text: String((e as Error)?.message || e).slice(0, 240) })
    } finally { setBusy(null) }
  }
  const copyJson = (): void => {
    island.clipWriteText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const agentIds = draft ? Object.keys(draft.agents || {}) : []
  const sourceIds = draft ? Object.keys(draft.sources || {}) : []
  const channelIds = draft ? Object.keys(draft.channels || {}) : []

  return (
    <div
      data-config-studio
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column',
        background: 'oklch(var(--panel-l, 0.15) var(--surface-c, 0.02) var(--ths) / 1)', backdropFilter: 'none', color: ink(1),
        ['--sp-entry-hover' as string]: fill(3)
      } as React.CSSProperties}
    >
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', borderBottom: `0.5px solid ${hairline(0.1)}`, flex: 'none' }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: gradient.primary(), display: 'grid', placeItems: 'center', flex: 'none', color: gradient.onPrimary() }}>
          <Ico.magic size={12} strokeWidth={2} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ ...text.subtitle(), fontSize: FS.body }}>可视化编排 · Agent Autoloop</span>
          <span title={path} style={{ ...text.faint(), fontSize: 9, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            事件来源 · 规则回路 · Agent · 通道 —— 保存走官方 check 校验，几秒热载
          </span>
        </div>
        <span style={{ flex: 1 }} />
        {path && (
          <Button sm variant="ghost" icon={FolderGit2} title={`rules.json 所在目录：${path}`} onClick={() => {
            // 不用正则切目录（反斜杠转义在多层模板里易错）：按两种分隔符取最后一段之前
            const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)))
            island.openFolder(i > 0 ? path.slice(0, i) : path)
          }}>目录</Button>
        )}
        {/* Electron 渲染层没有 confirm——重载在脏状态时走两步确认 */}
        <Button
          sm
          icon={RefreshCw}
          variant={reloadArmed ? 'warn' : 'ghost'}
          disabled={busy !== null}
          onClick={() => {
            if (dirty && !reloadArmed) { setReloadArmed(true); setTimeout(() => setReloadArmed(false), 3200); return }
            setReloadArmed(false)
            void load()
          }}
        >{reloadArmed ? '确认丢弃改动' : '重载'}</Button>
        <Button
          sm
          variant={closeArmed ? 'warn' : 'ghost'}
          icon={X}
          onClick={() => {
            // 有未保存改动时先确认（Electron 渲染层没有 confirm）
            if (dirty && !closeArmed) { setCloseArmed(true); setTimeout(() => setCloseArmed(false), 3200); return }
            setCloseArmed(false)
            onClose()
          }}
        >{closeArmed ? '放弃改动' : '关闭'}</Button>
      </div>
      <div style={{ height: 1, flex: 'none', background: `linear-gradient(90deg, transparent 2%, ${semBg(accent(), 0.35)} 30%, ${semBg(accent(), 0.22)} 68%, transparent 98%)` }} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 局部样式：卡片 hover 与字段聚焦（都是低成本的一过性效果） */}
        <style>{`
          .sp-entry { transition: background-color .16s ease, border-color .16s ease }
          .sp-entry:hover { background-color: var(--sp-entry-hover) }
        `}</style>
        {/* 侧栏 */}
        <div style={{ width: 138, flex: 'none', borderRight: `0.5px solid ${hairline(0.08)}`, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 3, background: fill(2) }}>
          {NAV.map((n) => {
            const Icon = n.icon
            const active = nav === n.key
            return (
              <button
                key={n.key}
                type="button"
                onClick={() => setNav(n.key)}
                title={n.desc}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 10px',
                  border: 0, borderRadius: R.md,
                  background: active ? semBg(accent(), 0.16) : 'transparent',
                  color: active ? accentText(0.9) : ink(2), fontSize: 10.5, fontWeight: active ? 700 : 500,
                  fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left'
                }}
              >
                {active && <span style={{ position: 'absolute', left: 2, top: 7, bottom: 7, width: 2, borderRadius: 999, background: accent() }} />}
                <Icon size={11} strokeWidth={2} style={{ flex: 'none' }} />
                {n.label}
              </button>
            )
          })}
          <span style={{ flex: 1 }} />
          <span style={{ ...text.faint(), fontSize: 8.5, lineHeight: 1.5, padding: '0 4px' }}>
            rules.json 是严格 JSON — 不支持注释
          </span>
        </div>

        {/* 内容区 */}
        <div className="ai-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px 16px 80px' }}>
          {loadError && (
            <EmptyState
              icon={FolderGit2}
              title="读不到 rules.json"
              desc={loadError}
              action={(
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <Button sm icon={RefreshCw} onClick={() => void load()}>重试</Button>
                  <Button
                    sm
                    variant="primary"
                    icon={Plus}
                    onClick={() => {
                      void (async () => {
                        const r = await island.superRulesCreate()
                        if (r.ok) {
                          setToast({ ok: true, text: '已创建最小规则模板，可继续编辑并保存' })
                          await load()
                        } else {
                          setToast({ ok: false, text: r.error || '创建失败' })
                        }
                      })()
                    }}
                  >创建模板</Button>
                </div>
              )}
            />
          )}
          {!loadError && !draft && busy === 'load' && <div style={{ ...text.faint(), fontSize: 11 }}>载入中…</div>}
          {draft && nav === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
              <Field label="时区" hint="定时与「今天」的口径">
                <Input value={draft.timezone || ''} onChange={(v) => patch((d) => ({ ...d, timezone: v || undefined }))} placeholder="Asia/Shanghai（留空跟随系统）" />
              </Field>
              <Field label="先问哪些事" hint="askFirst：遇到这类事 Agent 必须先问你">
                <TagInput values={draft.askFirst || []} onChange={(v) => patch((d) => ({ ...d, askFirst: v }))} placeholder="如：删数据 / 花钱 / 对外发消息" />
              </Field>
              <Field label="默认通道" hint="没写 channels 的卡片发到哪；留空=所有通道">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {channelIds.length === 0 && <span style={{ ...text.faint(), fontSize: 10 }}>还没有通道</span>}
                  {channelIds.map((id) => {
                    const on = (draft.defaultChannels || []).includes(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => patch((d) => {
                          const cur = new Set(d.defaultChannels || [])
                          if (cur.has(id)) cur.delete(id); else cur.add(id)
                          return { ...d, defaultChannels: [...cur] }
                        })}
                        style={{
                          padding: '3px 10px', borderRadius: R.pill, border: `0.5px solid ${on ? semBg(accent(), 0.4) : hairline(0.1)}`,
                          background: on ? semBg(accent(), 0.16) : fill(1), color: on ? accentText(0.9) : ink(2),
                          fontSize: 10, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer'
                        }}
                      >{draft.channels?.[id]?.name || id}</button>
                    )
                  })}
                </div>
              </Field>
            </div>
          )}

          {draft && nav === 'sources' && (
            <SectionList
              title="事件来源"
              desc="世界怎么变成事件：cron 由规则自带；Webhook / HTTP / 轮询脚本登记在这里。"
              items={Object.entries(draft.sources || {})}
              onAdd={() => patch((d) => {
                let i = 1
                while (d.sources[`source${i}`]) i++
                return { ...d, sources: { ...d.sources, [`source${i}`]: { name: `来源 ${i}` } } }
              })}
              render={(id, def) => (
                <SourceCard id={id} def={def} onPatch={(next) => patch((d) => ({ ...d, sources: { ...d.sources, [id]: next } }))} onRemove={() => patch((d) => { const s = { ...d.sources }; delete s[id]; return { ...d, sources: s } })} onRename={(to) => renameKey('sources', id, to)} />
              )}
              onAddLabel="新增来源"
            />
          )}

          {draft && nav === 'agents' && (
            <SectionList
              title="Agent 定义"
              desc="谁来干活：内置 claude / codex / acp / command / dsh；任意能收提示词、打印最后一条回复的命令行工具都能接。"
              items={Object.entries(draft.agents || {})}
              onAdd={() => patch((d) => {
                let i = 1
                while (d.agents[`agent${i}`]) i++
                return { ...d, agents: { ...d.agents, [`agent${i}`]: { name: `Agent ${i}`, use: 'claude' } } }
              })}
              render={(id, def) => (
                <AgentCard id={id} def={def} onPatch={(next) => patch((d) => ({ ...d, agents: { ...d.agents, [id]: next } }))} onRemove={() => patch((d) => { const a = { ...d.agents }; delete a[id]; return { ...d, agents: a } })} onRename={(to) => renameKey('agents', id, to)} />
              )}
              onAddLabel="新增 Agent"
            />
          )}

          {draft && nav === 'channels' && (
            <SectionList
              title="通知通道"
              desc="卡片送到哪：桌面通知 / 飞书 / 钉钉 / 企微 / Slack / Discord（通道程序需在规则里登记后自行连入）。"
              items={Object.entries(draft.channels || {})}
              onAdd={() => patch((d) => {
                let i = 1
                while ((d.channels || {})[`channel${i}`]) i++
                return { ...d, channels: { ...(d.channels || {}), [`channel${i}`]: { name: `通道 ${i}` } } }
              })}
              render={(id, def) => (
                <ChannelCard id={id} def={def} onPatch={(next) => patch((d) => ({ ...d, channels: { ...(d.channels || {}), [id]: next } }))} onRemove={() => patch((d) => { const c = { ...(d.channels || {}) }; delete c[id]; return { ...d, channels: c } })} onRename={(to) => renameKey('channels', id, to)} />
              )}
              onAddLabel="新增通道"
            />
          )}

          {draft && nav === 'rules' && (
            <SectionList
              title="规则 / 回路"
              desc="一条规则就是一次回路：什么事件（或定时）→ 交给哪个 Agent → 在哪个目录 → 用什么 skill/提示词 → 怎么并行与续会话。"
              items={draft.rules.map((r, i) => [String(i), r] as [string, AutoloopRuleDef])}
              onAdd={() => patch((d) => ({
                ...d,
                rules: [...d.rules, {
                  name: `新规则 ${d.rules.length + 1}`,
                  when: { cron: '0 9 * * *' },
                  to: agentIds[0] || 'claude',
                  cwd: '~',
                  prompt: ''
                }]
              }))}
              render={(iStr, r) => {
                const i = Number(iStr)
                return (
                  <RuleCard
                    key={i}
                    rule={r}
                    agentIds={agentIds}
                    sourceIds={sourceIds}
                    channelIds={channelIds}
                    onChange={(next) => patch((d) => ({ ...d, rules: d.rules.map((x, j) => (j === i ? next : x)) }))}
                    onRemove={() => patch((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))}
                    onClone={() => patch((d) => {
                      // 同名自动加序号后缀，克隆体插在原规则后面
                      const base = r.name.replace(/\s*\(\d+\)$/, '')
                      let n = 2
                      const names = new Set(d.rules.map((x) => x.name))
                      while (names.has(`${base} (${n})`)) n += 1
                      const copy: AutoloopRuleDef = JSON.parse(JSON.stringify(r)) as AutoloopRuleDef
                      copy.name = `${base} (${n})`
                      copy.group = copy.name
                      return { ...d, rules: [...d.rules.slice(0, i + 1), copy, ...d.rules.slice(i + 1)] }
                    })}
                  />
                )
              }}
              onAddLabel="新增规则"
            />
          )}

          {draft && nav === 'json' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...text.subtitle(), fontSize: FS.body }}>完整 JSON（当前草稿）</span>
                <Button sm icon={copied ? Check : Copy} variant={copied ? 'tinted' : 'ghost'} onClick={copyJson}>{copied ? '已复制' : '复制'}</Button>
                <span style={{ flex: 1 }} />
                <span style={{ ...text.faint(), fontSize: 9.5 }}>{dirty ? '有未保存改动' : '与已保存一致'}</span>
              </div>
              <pre style={{
                margin: 0, padding: 12, borderRadius: R.md, background: fill(1), border: `0.5px solid ${hairline(0.08)}`,
                color: ink(1), fontSize: 10, lineHeight: 1.55, fontFamily: "ui-monospace,'Cascadia Code',monospace",
                overflow: 'auto', maxHeight: 'calc(100vh - 220px)', whiteSpace: 'pre'
              }}>{json}</pre>
            </div>
          )}
        </div>
      </div>

      {/* 底部保存栏 */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', borderTop: `0.5px solid ${hairline(0.1)}`, background: fill(2) }}>
        {check && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: R.sm,
            background: check.ok ? semBg(accent(), 0.16) : semBg(sem.danger, 0.16),
            color: check.ok ? accentText(0.9) : 'oklch(0.85 0.1 25)', fontSize: 10, fontWeight: 650, maxWidth: '62%'
          }} title={check.error}>
            {check.ok ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{check.ok ? '校验通过' : (check.error || '校验未通过').split('\n')[0]}</span>
          </span>
        )}
        {toast && <span style={{ fontSize: 9.5, color: toast.ok ? accentText(0.85) : sem.danger, maxWidth: '38%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={toast.text}>{toast.text}</span>}
        <span style={{ flex: 1 }} />
        <Button sm icon={Check} disabled={!dirty || busy !== null} onClick={() => void doCheck()}>{busy === 'check' ? '校验中…' : '校验草稿'}</Button>
        <Button sm variant={dirty ? 'primary' : 'ghost'} icon={Save} disabled={!dirty || busy !== null} onClick={() => void doSave()}>{busy === 'save' ? '保存中…' : '保存并生效'}</Button>
      </div>
    </div>
  )
}

/* ---------------- 区块列表外壳 ---------------- */

function SectionList<T>({ title, desc, items, render, onAdd, onAddLabel }: {
  title: string
  desc: string
  items: [string, T][]
  render: (id: string, def: T) => React.ReactNode
  onAdd: () => void
  onAddLabel: string
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...text.subtitle(), fontSize: FS.body }}>{title}</span>
        <span style={{ ...text.faint(), fontSize: 9.5, flex: 1, minWidth: 0 }}>{desc}</span>
        <Button sm icon={Plus} onClick={onAdd}>{onAddLabel}</Button>
      </div>
      {items.length === 0 && <div style={{ ...text.faint(), fontSize: 10, padding: '10px 2px' }}>还没有条目——点右上「{onAddLabel}」开始。</div>}
      {items.map(([id, def]) => render(id, def))}
    </div>
  )
}

/* ---------------- 卡片通用外壳（可折叠 + 删除二次确认） ---------------- */

function EntryShell({ badge, title, summary, open, onToggle, onRemove, onClone, children }: {
  badge: React.ReactNode
  title: React.ReactNode
  summary: string
  open: boolean
  onToggle: () => void
  onRemove: () => void
  /** 可选的"复制一份"（规则常用：复制一条改改） */
  onClone?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3200); return () => clearTimeout(t) }, [armed])
  return (
    <div className="sp-entry" style={{ ...surface.card(), padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <button type="button" onClick={onToggle} style={{ border: 0, background: 'transparent', color: ink(2), display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 2, flex: 'none' }}>
          {open ? <ChevronDown size={12} strokeWidth={2.2} /> : <ChevronRight size={12} strokeWidth={2.2} />}
        </button>
        {badge}
        <span style={{ fontSize: FS.small, fontWeight: 650, color: ink(1), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ ...text.faint(), fontSize: 9, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        {onClone && (
          <button
            type="button"
            onClick={onClone}
            title="复制一份（同名自动加后缀）"
            style={{
              border: 0, borderRadius: R.sm, padding: '3px 6px', display: 'inline-flex', alignItems: 'center', gap: 3,
              background: 'transparent', color: ink(3), fontSize: 9, fontWeight: 600,
              fontFamily: 'inherit', cursor: 'pointer', flex: 'none'
            }}
          >
            <Copy size={9} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={armed ? onRemove : () => setArmed(true)}
          title={armed ? '再点一次确认删除' : '删除'}
          style={{
            border: 0, borderRadius: R.sm, padding: '3px 7px', display: 'inline-flex', alignItems: 'center', gap: 4,
            background: armed ? semBg(sem.danger, 0.2) : 'transparent', color: armed ? sem.danger : ink(3),
            fontSize: 9, fontWeight: 650, fontFamily: 'inherit', cursor: 'pointer', flex: 'none'
          }}
        >
          <Trash2 size={10} strokeWidth={2} />{armed ? '确认删除' : ''}
        </button>
      </div>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>{children}</div>}
    </div>
  )
}

const badgeOf = (label: string, tone: 'accent' | 'warn' | 'mid' = 'mid'): React.ReactNode => (
  <span style={{
    flex: 'none', fontSize: 8.5, fontWeight: 700, padding: '1px 6px', borderRadius: R.sm,
    background: tone === 'accent' ? semBg(accent(), 0.18) : tone === 'warn' ? semBg(sem.warn, 0.16) : fill(2),
    color: tone === 'accent' ? accentText(0.9) : tone === 'warn' ? sem.warn : ink(3)
  }}>{label}</span>
)

/* ---------------- 来源 ---------------- */

function SourceCard({ id, def, onPatch, onRemove, onRename }: { id: string; def: AutoloopSourceDef; onPatch: (v: AutoloopSourceDef) => void; onRemove: () => void; onRename: (to: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [idDraft, setIdDraft] = useState(id)
  useEffect(() => setIdDraft(id), [id])
  return (
    <EntryShell badge={badgeOf(id, 'accent')} title={def.name || id} summary={def.adapter ? `Webhook 适配器 · ${def.adapter}` : 'HTTP / 轮询 / 定时由规则提供'} open={open} onToggle={() => setOpen((v) => !v)} onRemove={onRemove}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="编号" hint="回车改名并同步引用">
          <Input
            value={idDraft}
            onChange={setIdDraft}
            onKeyDown={(e) => { if (e.key === 'Enter') onRename(idDraft) }}
            placeholder="如 github / shop"
          />
        </Field>
        <Field label="显示名"><Input value={def.name || ''} onChange={(v) => onPatch({ ...def, name: v })} /></Field>
      </div>
      <Field label="Webhook 适配器" hint="plugins/<adapter>/source.ts；可选">
        <Input value={def.adapter || ''} onChange={(v) => onPatch({ ...def, adapter: v || undefined })} placeholder="github / gitlab …（留空则只用 HTTP 与轮询）" />
      </Field>
      <div style={{ ...text.faint(), fontSize: 9 }}>改名会同步更新规则里的 when.source 与 emits.source；失焦不提交，回车生效。</div>
    </EntryShell>
  )
}

/* ---------------- Agent ---------------- */

const AGENT_USES = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'acp', label: 'ACP' },
  { key: 'command', label: '任意命令' },
  { key: 'dsh', label: 'DeepSeek Harness' }
]
const ACCESSES = [{ key: 'read', label: '只读' }, { key: 'edit', label: '可改目录' }, { key: 'full', label: '完整权限' }]

function AgentCard({ id, def, onPatch, onRemove, onRename }: { id: string; def: AutoloopAgentDef; onPatch: (v: AutoloopAgentDef) => void; onRemove: () => void; onRename: (to: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [idDraft, setIdDraft] = useState(id)
  useEffect(() => setIdDraft(id), [id])
  const use = def.use || 'claude'
  return (
    <EntryShell badge={badgeOf(id, 'accent')} title={def.name || id} summary={`${AGENT_USES.find((u) => u.key === use)?.label || use}${def.model ? ` · ${def.model}` : ''}${def.access ? ` · ${def.access}` : ''}`} open={open} onToggle={() => setOpen((v) => !v)} onRemove={onRemove}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Field label="编号" hint="回车改名并同步引用">
          <Input value={idDraft} onChange={setIdDraft} onKeyDown={(e) => { if (e.key === 'Enter') onRename(idDraft) }} placeholder="如 claude / codex" />
        </Field>
        <Field label="显示名"><Input value={def.name || ''} onChange={(v) => onPatch({ ...def, name: v })} /></Field>
        <Field label="接法" hint="use">
          <Sel value={use} onChange={(v) => onPatch({ ...def, use: v })}>{AGENT_USES.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}</Sel>
        </Field>
      </div>
      {use === 'command' && (
        <Field label="命令" hint="{prompt} 作为独立参数传入；一行一个参数">
          <Area
            rows={3}
            value={(def.command || []).join('\n')}
            onChange={(v) => onPatch({ ...def, command: v.split('\n').map((x) => x.trim()).filter(Boolean) })}
            placeholder={'node\nC:/work/agent.mjs\n{prompt}'}
          />
        </Field>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Field label="模型" hint="可选"><Input value={def.model || ''} onChange={(v) => onPatch({ ...def, model: v || undefined })} placeholder="跟随 CLI 配置" /></Field>
        <Field label="推理强度" hint="可选"><Input value={def.effort || ''} onChange={(v) => onPatch({ ...def, effort: v || undefined })} placeholder="low / high …" /></Field>
        <Field label="权限" hint="access">
          <Sel value={def.access || 'edit'} onChange={(v) => onPatch({ ...def, access: v })}>{ACCESSES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</Sel>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="接单程序" hint="worker，多机时限定；可选"><Input value={def.worker || ''} onChange={(v) => onPatch({ ...def, worker: v || undefined })} placeholder="跟随本机" /></Field>
        <Field label="并发上限" hint="maxActive，跨规则；可选">
          <Input value={def.maxActive != null ? String(def.maxActive) : ''} onChange={(v) => {
            const n = Number(v)
            onPatch({ ...def, maxActive: v.trim() && Number.isFinite(n) && n > 0 ? n : undefined })
          }} placeholder="不限" />
        </Field>
      </div>
      <Field label="启动程序" hint="program：设好环境变量再 exec 的脚本路径；可选">
        <Input value={def.program || ''} onChange={(v) => onPatch({ ...def, program: v || undefined })} placeholder="如 ~/bin/claude-with-proxy.sh" />
      </Field>
    </EntryShell>
  )
}

/* ---------------- 通道 ---------------- */

function ChannelCard({ id, def, onPatch, onRemove, onRename }: { id: string; def: AutoloopChannelDef; onPatch: (v: AutoloopChannelDef) => void; onRemove: () => void; onRename: (to: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [idDraft, setIdDraft] = useState(id)
  useEffect(() => setIdDraft(id), [id])
  return (
    <EntryShell badge={badgeOf(id, 'accent')} title={def.name || id} summary={(def.answerers || []).length ? `允许 ${(def.answerers || []).length} 人拍板` : '默认允许名单'} open={open} onToggle={() => setOpen((v) => !v)} onRemove={onRemove}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="编号" hint="回车改名并同步引用">
          <Input value={idDraft} onChange={setIdDraft} onKeyDown={(e) => { if (e.key === 'Enter') onRename(idDraft) }} placeholder="如 desktop / feishu" />
        </Field>
        <Field label="显示名"><Input value={def.name || ''} onChange={(v) => onPatch({ ...def, name: v })} /></Field>
      </div>
      <Field label="允许拍板的人" hint="answerers：留空 = 该通道默认">
        <TagInput values={def.answerers || []} onChange={(v) => onPatch({ ...def, answerers: v })} placeholder="如飞书 open_id，回车添加" />
      </Field>
    </EntryShell>
  )
}

/* ---------------- 规则（回路） ---------------- */

const TELLS = [{ key: 'needed', label: '有事才说' }, { key: 'always', label: '每轮都说' }, { key: 'never', label: '只发提问' }]

function RuleCard({ rule, agentIds, sourceIds, channelIds, onChange, onRemove, onClone }: {
  rule: AutoloopRuleDef
  agentIds: string[]
  sourceIds: string[]
  channelIds: string[]
  onChange: (v: AutoloopRuleDef) => void
  onRemove: () => void
  onClone: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const isCron = !!rule.when?.cron
  const summary = isCron
    ? `定时 ${rule.when.cron} → ${rule.to}${rule.cwd ? ` · ${rule.cwd}` : ''}`
    : `事件 ${rule.when?.source || '?'}${rule.when?.types?.length ? `(${rule.when.types.join(',')})` : ''} → ${rule.to}${rule.parallel ? ` · 并行 ${rule.parallel}` : ''}`
  return (
    <EntryShell badge={badgeOf(isCron ? '定时' : '事件', isCron ? 'mid' : 'accent')} title={rule.name} summary={summary} open={open} onToggle={() => setOpen((v) => !v)} onRemove={onRemove} onClone={onClone}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="规则名" hint="也会是卡片上的「来源」"><Input value={rule.name} onChange={(v) => onChange({ ...rule, name: v })} /></Field>
        <Field label="交给" hint="to = agents 里的编号">
          <Sel value={rule.to} onChange={(v) => onChange({ ...rule, to: v })}>
            {agentIds.length === 0 && <option value={rule.to}>{rule.to}（未定义）</option>}
            {agentIds.map((a) => <option key={a} value={a}>{a}</option>)}
          </Sel>
        </Field>
      </div>
      {/* when：定时 / 事件 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ ...text.overline(), color: ink(3), flex: 'none' }}>触发</span>
        <div style={{ display: 'inline-flex', padding: 2, gap: 2, borderRadius: R.md, ...surface.inset() }}>
          {[{ k: 'cron', label: '定时' }, { k: 'event', label: '事件' }].map((m) => {
            const on = (m.k === 'cron') === isCron
            return (
              <button
                key={m.k}
                type="button"
                onClick={() => onChange({ ...rule, when: m.k === 'cron' ? { cron: rule.when?.cron || '0 9 * * *' } : { source: rule.when?.source || sourceIds[0] || 'local', types: rule.when?.types || [] } })}
                style={{
                  border: 0, borderRadius: R.sm - 1, padding: '3px 10px', fontFamily: 'inherit', cursor: 'pointer',
                  background: on ? fill(4) : 'transparent', color: on ? ink(1) : ink(3), fontSize: 10, fontWeight: on ? 700 : 500
                }}
              >{m.label}</button>
            )
          })}
        </div>
        {isCron ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input value={rule.when?.cron || ''} onChange={(v) => onChange({ ...rule, when: { cron: v } })} placeholder="0 9 * * *（5 段 cron，分钟粒度）" />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
            <Sel value={rule.when?.source || ''} onChange={(v) => onChange({ ...rule, when: { ...rule.when, source: v } })} style={{ flex: '0 0 40%' }}>
              {sourceIds.length === 0 && <option value="">未登记来源</option>}
              {sourceIds.map((s) => <option key={s} value={s}>{s}</option>)}
            </Sel>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Input value={(rule.when?.types || []).join(',')} onChange={(v) => onChange({ ...rule, when: { ...rule.when, types: v.split(',').map((x) => x.trim()).filter(Boolean) } })} placeholder="types：issues.opened, order.*（逗号分隔）" />
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="工作目录" hint="cwd；接单电脑上解释，支持 ~"><Input value={rule.cwd || ''} onChange={(v) => onChange({ ...rule, cwd: v || undefined })} placeholder="~/code/app" /></Field>
        <Field label="Skill" hint="可选：放进 Agent skills 目录的文件夹名"><Input value={rule.skill || ''} onChange={(v) => onChange({ ...rule, skill: v || undefined })} placeholder="handle-issue" /></Field>
      </div>
      <Field label="提示词" hint="prompt：给这一轮的指令（skill 与它二选一或并用）">
        <Area rows={3} value={rule.prompt || ''} onChange={(v) => onChange({ ...rule, prompt: v || undefined })} placeholder="按其中「…」一节处理。" />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Field label="并行" hint="parallel：按对象分事项，留空串行">
          <Input value={rule.parallel != null ? String(rule.parallel) : ''} onChange={(v) => {
            const n = Number(v)
            onChange({ ...rule, parallel: v.trim() && Number.isFinite(n) && n > 0 ? n : undefined })
          }} placeholder="1" />
        </Field>
        <Field label="续会话" hint="resume：同一事项接着上轮">
          <Sel value={rule.resume ? 'yes' : 'no'} onChange={(v) => onChange({ ...rule, resume: v === 'yes' })}>
            <option value="no">每次新会话</option>
            <option value="yes">接着上一轮</option>
          </Sel>
        </Field>
        <Field label="回执口径" hint="tell">
          <Sel value={rule.tell || 'needed'} onChange={(v) => onChange({ ...rule, tell: v })}>
            {TELLS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Sel>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="同组串行" hint="group；默认=规则名"><Input value={rule.group || ''} onChange={(v) => onChange({ ...rule, group: v || undefined })} placeholder={rule.name} /></Field>
        <Field label="同时领取上限" hint="maxActive；可选">
          <Input value={rule.maxActive != null ? String(rule.maxActive) : ''} onChange={(v) => {
            const n = Number(v)
            onChange({ ...rule, maxActive: v.trim() && Number.isFinite(n) && n > 0 ? n : undefined })
          }} placeholder="不限" />
        </Field>
      </div>
      <Field label="卡片通道" hint="channels：只发到这些；留空=默认通道">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {channelIds.length === 0 && <span style={{ ...text.faint(), fontSize: 9.5 }}>还没有通道</span>}
          {channelIds.map((c) => {
            const on = (rule.channels || []).includes(c)
            return (
              <button
                key={c}
                type="button"
                onClick={() => {
                  const cur = new Set(rule.channels || [])
                  if (cur.has(c)) cur.delete(c); else cur.add(c)
                  onChange({ ...rule, channels: [...cur].length ? [...cur] : undefined })
                }}
                style={{
                  padding: '2px 9px', borderRadius: R.pill, border: `0.5px solid ${on ? semBg(accent(), 0.4) : hairline(0.1)}`,
                  background: on ? semBg(accent(), 0.16) : fill(1), color: on ? accentText(0.9) : ink(3),
                  fontSize: 9.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer'
                }}
              >{c}</button>
            )
          })}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Field label="会话标题" hint="title；{id} {subject} 占位"><Input value={rule.title || ''} onChange={(v) => onChange({ ...rule, title: v || undefined })} placeholder="alert-{id}" /></Field>
        <Field label="允许发事件" hint="emits.source；可选"><Sel value={rule.emits?.source || ''} onChange={(v) => onChange({ ...rule, emits: v ? { source: v, types: rule.emits?.types || [] } : undefined })}>
          <option value="">不允许</option>
          {sourceIds.map((s) => <option key={s} value={s}>{s}</option>)}
        </Sel></Field>
        <Field label="可发类型" hint="emits.types；逗号分隔"><Input value={(rule.emits?.types || []).join(',')} onChange={(v) => onChange({ ...rule, emits: rule.emits ? { ...rule.emits, types: v.split(',').map((x) => x.trim()).filter(Boolean) } : undefined })} placeholder="pr.*, alert.*" /></Field>
      </div>
    </EntryShell>
  )
}

