// 闪念胶囊：把一句话闪念交给 AI 判断意图并结构化，路由到 待办 / 便签 / 问答。
// 目标是零摩擦捕获——你随口丢一句，AI 决定它是什么、往哪归。

export interface CapsuleResult {
  /** 意图：todo 待办 / note 便签 / ask 提问 */
  kind: 'todo' | 'note' | 'ask'
  /** 归一化后的正文（todo 去掉时间词、note 标题、ask 原问题） */
  text: string
  /** todo 专用：截止时间 YYYY-MM-DD HH:mm（可空）、优先级 */
  due?: string
  priority?: 1 | 2 | 3
  /** note 专用：emoji + 标签 */
  emoji?: string
  tags?: string[]
}

export function capsuleSystemPrompt(nowText: string): string {
  return (
    `你是一个闪念分拣助手。当前时间：${nowText}。用户会随口说一句话，你判断它属于哪一类并结构化。` +
    '\n只输出一个 JSON 对象：' +
    '\n{"kind":"todo|note|ask","text":"归一化正文",...}' +
    '\n判断规则：' +
    '\n- 有"要做/记得/提醒/明天/几点/截止"等 → todo，附 due（"YYYY-MM-DD HH:mm"，无则省略）与 priority(1紧急/2重要/3普通)，text 去掉时间词' +
    '\n- 是一条知识/想法/摘录/值得留存的信息 → note，附 emoji 与 2-3 个 tags，text 作为标题' +
    '\n- 是一个问题/求助/想问 AI → ask，text 为完整问题' +
    '\n拿不准时：像任务就 todo，像知识就 note，其余 ask。除非用户用英文，否则中文。'
  )
}

export function parseCapsule(raw?: string): CapsuleResult | null {
  if (!raw) return null
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s === -1 || e === -1) return null
  try {
    const o = JSON.parse(t.slice(s, e + 1)) as Record<string, unknown>
    const kind = o.kind === 'note' ? 'note' : o.kind === 'ask' ? 'ask' : 'todo'
    const text = String(o.text || '').trim()
    if (!text) return null
    const pr = Number(o.priority)
    return {
      kind,
      text,
      due: typeof o.due === 'string' && o.due.trim() ? o.due.trim() : undefined,
      priority: pr === 1 || pr === 2 || pr === 3 ? (pr as 1 | 2 | 3) : undefined,
      emoji: typeof o.emoji === 'string' && o.emoji ? Array.from(o.emoji)[0] : undefined,
      tags: Array.isArray(o.tags) ? o.tags.map((x) => String(x).slice(0, 12)).filter(Boolean).slice(0, 3) : undefined
    }
  } catch {
    return null
  }
}
