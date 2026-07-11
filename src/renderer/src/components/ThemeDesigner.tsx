// 主题设计器：实时拖动 OKLCH 令牌（色相/饱和/明度），整岛即时预览，保存/二次编辑自定义主题。
// 增强：灵感种子一键载入 · 🎲 随机 · ✨ AI 按氛围描述生成 · 令牌 JSON 导出/导入。

import { useEffect, useState } from 'react'
import { applyThemeTokens } from '../logic/themes'

export interface Tokens { th: number; th2: number; ths: number; cs: number; css: number; pl: number }

const asStr = (t: Tokens): Record<'th' | 'th2' | 'ths' | 'cs' | 'css' | 'pl', string> => ({
  th: String(t.th), th2: String(t.th2), ths: String(t.ths), cs: String(t.cs), css: String(t.css), pl: String(t.pl)
})

const SLIDERS: [keyof Tokens, string, number, number, number][] = [
  ['th', '主色相', 0, 360, 1],
  ['th2', '副色相（渐变）', 0, 360, 1],
  ['ths', '面板色相', 0, 360, 1],
  ['cs', '强调饱和', 0.1, 1.4, 0.02],
  ['css', '玻璃染色', 0.1, 2, 0.05],
  ['pl', '面板明度', 0.4, 1.3, 0.02]
]

// 灵感种子：一键载入再微调
const SEEDS: { label: string; t: Tokens }[] = [
  { label: '🌅 暮光', t: { th: 25, th2: 320, ths: 280, cs: 1.0, css: 1.1, pl: 0.95 } },
  { label: '🌲 森林', t: { th: 150, th2: 110, ths: 160, cs: 0.85, css: 1.0, pl: 0.9 } },
  { label: '🌊 深海', t: { th: 220, th2: 190, ths: 230, cs: 0.9, css: 1.2, pl: 0.8 } },
  { label: '🌋 熔岩', t: { th: 35, th2: 5, ths: 20, cs: 1.2, css: 1.3, pl: 0.85 } },
  { label: '💜 薰衣草', t: { th: 300, th2: 260, ths: 290, cs: 0.7, css: 0.9, pl: 1.05 } },
  { label: '⬛ 石墨', t: { th: 250, th2: 250, ths: 250, cs: 0.25, css: 0.4, pl: 0.7 } }
]

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))
const sanitize = (o: Partial<Record<keyof Tokens, unknown>>): Tokens | null => {
  const n = (k: keyof Tokens, min: number, max: number, dflt: number): number => {
    const v = Number(o[k])
    return Number.isFinite(v) ? clamp(v, min, max) : dflt
  }
  if (o.th === undefined && o.th2 === undefined) return null
  return { th: n('th', 0, 360, 200), th2: n('th2', 0, 360, 280), ths: n('ths', 0, 360, 240), cs: n('cs', 0.1, 1.4, 1), css: n('css', 0.1, 2, 1), pl: n('pl', 0.4, 1.3, 1) }
}

export function ThemeDesigner({ open, seed, seedName, editKey, onSave, onClose, onAI, llmReady }: {
  open: boolean
  seed: Tokens
  /** 编辑已有自定义主题时：原名 + 目标 key（保存=原地更新而非新建） */
  seedName?: string
  editKey?: string
  onSave: (name: string, t: Tokens, editKey?: string) => void
  onClose: () => void
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  llmReady: boolean
}): React.JSX.Element | null {
  const [t, setT] = useState<Tokens>(seed)
  const [name, setName] = useState('我的主题')
  const [aiDesc, setAiDesc] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setT(seed); setName(seedName || '我的主题'); setAiDesc(''); setMsg('') } }, [open])
  useEffect(() => { if (open) applyThemeTokens(asStr(t)) }, [t, open])

  if (!open) return null

  const flash = (m: string): void => { setMsg(m); setTimeout(() => setMsg(''), 2400) }
  const randomize = (): void => {
    const th = Math.floor(Math.random() * 360)
    setT({
      th,
      th2: (th + 40 + Math.floor(Math.random() * 100)) % 360,
      ths: (th + Math.floor(Math.random() * 60) - 30 + 360) % 360,
      cs: Number((0.5 + Math.random() * 0.8).toFixed(2)),
      css: Number((0.6 + Math.random() * 1.0).toFixed(2)),
      pl: Number((0.7 + Math.random() * 0.5).toFixed(2))
    })
  }
  const aiGenerate = async (): Promise<void> => {
    const d = aiDesc.trim()
    if (!d || aiBusy) return
    if (!llmReady) { flash('请先在设置里配置问答模型'); return }
    setAiBusy(true)
    const r = await onAI(
      '你是配色设计师。根据用户描述的氛围，输出一组 OKLCH 主题令牌 JSON（只输出 JSON，不要其它文字）：' +
      '{"th":主色相0-360,"th2":副色相0-360,"ths":面板背景色相0-360,"cs":强调饱和0.1-1.4,"css":玻璃染色饱和0.1-2,"pl":面板明度0.4-1.3(深色主题取0.7-1.0)}。' +
      '色相参考：红0 橙35 黄85 绿150 青200 蓝250 紫300 粉330。主副色相拉开 40-120 度做渐变。',
      d
    )
    setAiBusy(false)
    if (!r.ok || !r.text) { flash(r.error || 'AI 生成失败'); return }
    try {
      const m = r.text.match(/\{[\s\S]*\}/)
      const parsed = sanitize(JSON.parse(m ? m[0] : r.text) as Partial<Record<keyof Tokens, unknown>>)
      if (!parsed) { flash('AI 返回的令牌不完整'); return }
      setT(parsed)
      if (name === '我的主题') setName(d.slice(0, 10))
      flash('✓ 已生成，可继续微调')
    } catch { flash('AI 返回的不是有效 JSON') }
  }
  const copyTokens = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(t)).catch(() => {})
    flash('✓ 令牌已复制（可分享/备份）')
  }
  const importTokens = async (): Promise<void> => {
    try {
      const txt = (await navigator.clipboard.readText()).trim()
      const parsed = sanitize(JSON.parse(txt) as Partial<Record<keyof Tokens, unknown>>)
      if (!parsed) { flash('剪贴板里不是主题令牌 JSON'); return }
      setT(parsed)
      flash('✓ 已导入剪贴板令牌')
    } catch { flash('剪贴板里不是主题令牌 JSON') }
  }

  const toolChip: React.CSSProperties = { padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: 'oklch(0.82 0.02 var(--th) / .85)', whiteSpace: 'nowrap' }

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'oklch(0.08 0.02 var(--ths) / .55)', backdropFilter: 'blur(4px)', animation: 'ai-fadein .15s ease' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(460px, 88vw)', maxHeight: '86vh', overflowY: 'auto', borderRadius: 18, background: 'oklch(calc(0.17 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths) / .99)', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .35)', boxShadow: 'none', animation: 'ai-riseblur .3s cubic-bezier(.22,.61,.36,1)' }} className="ai-scroll">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
          <span style={{ fontSize: 15 }}>🎨</span>
          <span style={{ color: 'oklch(0.96 0.01 var(--th))', fontSize: 13.5, fontWeight: 700 }}>{editKey ? `编辑主题 · ${seedName || ''}` : '主题设计器'}</span>
          <span style={{ flex: 1 }} />
          {msg ? <span style={{ color: 'oklch(0.82 calc(0.12 * var(--cs, 1)) var(--th))', fontSize: 10 }}>{msg}</span> : <span style={{ color: 'oklch(0.6 0.02 var(--th) / .55)', fontSize: 10 }}>拖动即整岛预览</span>}
        </div>

        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 预览条 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, height: 30, borderRadius: 9, background: 'linear-gradient(90deg, oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.62 calc(0.15 * var(--cs, 1)) var(--th2)))' }} />
            <div style={{ width: 60, height: 30, borderRadius: 9, background: 'oklch(calc(0.2 * var(--pl, 1)) calc(0.03 * var(--css, 1)) var(--ths))', border: '1px solid oklch(0.7 calc(0.14 * var(--cs, 1)) var(--th) / .4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'oklch(0.9 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10 }}>面板</div>
          </div>

          {/* 灵感种子 + 工具 */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {SEEDS.map((s) => (
              <span key={s.label} className="hv" onClick={() => setT(s.t)} style={toolChip}>{s.label}</span>
            ))}
            <span className="hv" onClick={randomize} title="随机一组配色" style={toolChip}>🎲 随机</span>
            <span className="hv" onClick={copyTokens} title="复制令牌 JSON（备份/分享）" style={toolChip}>⧉ 导出</span>
            <span className="hv" onClick={() => void importTokens()} title="从剪贴板导入令牌 JSON" style={toolChip}>📥 导入</span>
          </div>

          {/* ✨ AI 生成 */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={aiDesc} onChange={(e) => setAiDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void aiGenerate() }} placeholder="✨ 描述氛围让 AI 配色：如「雨后的京都青苔」" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, outline: 'none', color: 'oklch(0.95 0.01 var(--th))', fontSize: 11, padding: '6px 10px' }} />
            <div className="hv" onClick={() => void aiGenerate()} style={{ padding: '0 12px', borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.7 0.14 var(--th) / .5), oklch(0.55 0.13 var(--th2) / .4))', color: 'oklch(0.95 0.02 var(--th))', fontSize: 11, fontWeight: 700 }}>{aiBusy ? '生成中…' : '✨ 生成'}</div>
          </div>

          {SLIDERS.map(([k, label, min, max, step]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 78, flex: 'none', color: 'oklch(0.85 0.02 var(--th) / .85)', fontSize: 11 }}>{label}</span>
              <input type="range" min={min} max={max} step={step} value={t[k]} onChange={(e) => setT((v) => ({ ...v, [k]: Number(e.target.value) }))} style={{ flex: 1, accentColor: 'oklch(0.75 calc(0.14 * var(--cs, 1)) var(--th))' }} />
              <span style={{ width: 38, flex: 'none', textAlign: 'right', color: 'oklch(0.72 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>{k === 'th' || k === 'th2' || k === 'ths' ? t[k] : t[k].toFixed(2)}</span>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="主题名" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, outline: 'none', color: 'oklch(0.95 0.01 var(--th))', fontSize: 12, padding: '7px 10px' }} />
            <div className="hv" onClick={onClose} style={{ padding: '7px 13px', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.78 0.02 var(--th) / .75)', fontSize: 11.5 }}>取消</div>
            <div className="hv" onClick={() => onSave(name.trim() || '自定义', t, editKey)} style={{ padding: '7px 15px', borderRadius: 8, cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>{editKey ? '✓ 更新主题' : '保存主题'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
