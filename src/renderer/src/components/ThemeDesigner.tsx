// 主题设计器：实时拖动 OKLCH 令牌（色相/饱和/明度），整岛即时预览，保存/二次编辑自定义主题。
// 增强：灵感种子一键载入 · 随机 · AI 按氛围描述生成 · 令牌 JSON 导出/导入。
// 视觉层：设计系统重做（ui/tokens 表面层级 + ui/components 基础件 + lucide 语义图标 + overlayPop 浮层动效），功能逻辑不变。

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ClipboardPaste, Copy, Dices, Palette, Sparkles } from 'lucide-react'
import { applyThemeTokens } from '../logic/themes'
import { Button, Chip, Input, Slider } from '../ui/components'
import { overlayPop } from '../ui/motion'
import { accent, accent2, FS, hairline, ink, R, SP, surface, text } from '../ui/tokens'

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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.15 } }}
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 215, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }}
    >
      <motion.div
        variants={overlayPop}
        initial="initial"
        animate="animate"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 88vw)', maxHeight: '86vh', overflowY: 'auto', ...surface.overlay() }}
        className="ai-scroll"
      >
        {/* 头部：图标 + 标题 + 状态消息 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `${SP.md + 1}px ${SP.lg}px`, borderBottom: `0.5px solid ${hairline(0.1)}` }}>
          <div style={{ width: 24, height: 24, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: `color-mix(in oklch, ${accent()} 14%, transparent)`, color: accent() }}>
            <Palette size={13} strokeWidth={1.75} />
          </div>
          <span style={text.subtitle()}>{editKey ? `编辑主题 · ${seedName || ''}` : '主题设计器'}</span>
          <span style={{ flex: 1 }} />
          {msg
            ? <span style={{ ...text.faint(), color: accent(0.85, 0.95) }}>{msg}</span>
            : <span style={text.faint()}>拖动即整岛预览</span>}
        </div>

        <div style={{ padding: `${SP.md + 2}px ${SP.lg}px`, display: 'flex', flexDirection: 'column', gap: SP.md }}>
          {/* 预览条：主→副色相渐变 + 面板表面样例 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, height: 30, borderRadius: R.sm, background: `linear-gradient(90deg, ${accent(0.78)}, ${accent2(0.62)})`, boxShadow: `0 4px 14px -6px ${accent(0.7, 0.4)}` }} />
            <div style={{ width: 60, height: 30, borderRadius: R.sm, ...surface.panel(), border: `0.5px solid ${accent(0.7, 0.35)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...text.faint(), color: ink(2) }}>面板</div>
          </div>

          {/* 灵感种子 + 工具（种子 label 为数据串，原样渲染） */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {SEEDS.map((s) => (
              <Chip key={s.label} onClick={() => setT(s.t)}>{s.label}</Chip>
            ))}
            <Chip icon={Dices} onClick={randomize} title="随机一组配色">随机</Chip>
            <Chip icon={Copy} onClick={copyTokens} title="复制令牌 JSON（备份/分享）">导出</Chip>
            <Chip icon={ClipboardPaste} onClick={() => void importTokens()} title="从剪贴板导入令牌 JSON">导入</Chip>
          </div>

          {/* AI 生成：氛围描述 → 令牌 */}
          <div style={{ display: 'flex', gap: 6 }}>
            <Input
              value={aiDesc}
              onChange={setAiDesc}
              onKeyDown={(e) => { if (e.key === 'Enter') void aiGenerate() }}
              icon={Sparkles}
              placeholder="描述氛围让 AI 配色：如「雨后的京都青苔」"
              style={{ flex: 1 }}
            />
            <Button variant="primary" icon={Sparkles} onClick={() => void aiGenerate()}>{aiBusy ? '生成中…' : '生成'}</Button>
          </div>

          {/* 令牌滑杆 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SLIDERS.map(([k, label, min, max, step]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 78, flex: 'none', ...text.dim(), fontSize: FS.small }}>{label}</span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <Slider min={min} max={max} step={step} value={t[k]} onChange={(v) => setT((s) => ({ ...s, [k]: v }))} />
                </div>
                <span style={{ width: 38, flex: 'none', textAlign: 'right', ...text.num(FS.tiny), color: ink(2) }}>{k === 'th' || k === 'th2' || k === 'ths' ? t[k] : t[k].toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* 底部：主题名 + 取消/保存 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
            <Input value={name} onChange={setName} placeholder="主题名" style={{ flex: 1 }} />
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button variant="primary" icon={editKey ? Check : undefined} onClick={() => onSave(name.trim() || '自定义', t, editKey)}>{editKey ? '更新主题' : '保存主题'}</Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
