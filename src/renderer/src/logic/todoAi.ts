// AI 智能待办解析：把口语描述交给 LLM，解析为结构化待办（事项/时间/优先级/重复）。
// 关键：把"当前时间+星期"注入提示词，相对时间（明天/周五/今晚）才能解析正确。

export interface AiTodo {
  text: string
  due?: number
  priority?: 1 | 2 | 3
  repeat?: 'none' | 'daily' | 'weekly'
}

export function todoSystemPrompt(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  const cur = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}（星期${week}）`
  return (
    `你是待办事项解析器。当前时间：${cur}。\n` +
    '把用户的口语整理成待办，只输出一个 JSON 数组，不要任何数组以外的文字。每个元素：\n' +
    '{"text": "简洁的事项描述（不要包含时间词）", "due": "YYYY-MM-DD HH:mm"（提醒/开始时间，未提及则省略）, ' +
    '"priority": 1|2|3（紧急/重要→1或2，默认3，未提及则省略）, "repeat": "daily"|"weekly"（每天/每周才填，否则省略）}\n' +
    '时间解析规则：早上≈09:00、中午≈12:00、下午≈15:00、傍晚/下班前≈18:00、晚上≈20:00；' +
    '"明天/后天/周X"基于当前时间推算；只说了日期没说时刻默认 09:00；' +
    '一句话包含多件事就拆成多条。事项描述保留关键宾语（给谁、什么事）。'
  )
}

export function parseAiTodos(raw?: string): AiTodo[] {
  if (!raw) return []
  const arr = parseJsonArray(raw)
  if (!arr) return []
  try {
    const out: AiTodo[] = []
    for (const it of arr) {
      const obj = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
      if (typeof obj.text !== 'string' || !obj.text.trim()) continue
      const todo: AiTodo = { text: obj.text.trim().slice(0, 200) }
      const due = parseDue(obj.due, Date.now())
      if (due) todo.due = due
      todo.priority = normPrio(obj.priority)
      if (obj.repeat === 'daily' || obj.repeat === 'weekly') todo.repeat = obj.repeat
      out.push(todo)
    }
    return out.slice(0, 10)
  } catch {
    return []
  }
}

/* ==================== 通用解析器（健壮兜底：去 ``` 包裹、正则截取 JSON、失败不抛） ==================== */

/** 剥离 markdown 代码围栏，返回内层文本 */
export const stripFence = (s: string): string => {
  const m = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  return (m ? m[1] : s).trim()
}

/** 从模型输出尽力解析出 JSON 数组 */
export function parseJsonArray(raw: string): unknown[] | null {
  const body = stripFence(raw)
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(body.slice(start, end + 1))
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

/** 从模型输出解析出对象（映射类返回） */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const body = stripFence(raw)
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(body.slice(start, end + 1))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 优先级归一化到 1|2|3 */
export const normPrio = (v: unknown): 1 | 2 | 3 => {
  const n = Number(v)
  return n === 1 || n === 2 || n === 3 ? (n as 1 | 2 | 3) : 3
}

/** AI 给的相对/绝对时间 → 毫秒戳（宽松，无法解析返回 undefined） */
export function parseDue(v: unknown, now: number): number | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'number' && v > 1e11) return v
  const s = String(v).trim()
  const d0 = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime()
  const cnHour: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const toHour = (raw: string): number | null => {
    if (/^\d+$/.test(raw)) return Number(raw)
    if (raw === '十') return 10
    if (raw.startsWith('十')) return 10 + (cnHour[raw.slice(1)] || 0)
    if (raw.endsWith('十')) return (cnHour[raw[0]] || 0) * 10
    if (raw.includes('十')) {
      const [a, b] = raw.split('十')
      return (cnHour[a] || 1) * 10 + (cnHour[b] || 0)
    }
    return cnHour[raw] ?? null
  }
  const defaultHour = (text: string): number => {
    if (/早上|上午/.test(text)) return 9
    if (/中午/.test(text)) return 12
    if (/下午/.test(text)) return 15
    if (/傍晚|下班前/.test(text)) return 18
    if (/晚上|今晚|晚间/.test(text)) return 20
    return 9
  }
  const timeOfDay = (text: string): number => {
    const hm = text.match(/(\d{1,2})[:：](\d{2})/)
    if (hm) return (Number(hm[1]) * 60 + Number(hm[2])) * 60000
    const h = text.match(/([零一二两三四五六七八九十\d]{1,3})\s*(?:点|时)(半|[零一二两三四五六七八九十\d]{1,3}分?)?/)
    if (h) {
      let hour = toHour(h[1])
      if (hour == null) hour = defaultHour(text)
      if (hour > 0 && hour < 12 && /下午|晚上|今晚|晚间|傍晚/.test(text)) hour += 12
      const minute = h[2] === '半' ? 30 : h[2] ? (toHour(h[2].replace(/分$/, '')) || 0) : 0
      return (hour * 60 + minute) * 60000
    }
    return defaultHour(text) * 3600000
  }
  const setHM = (base: number, text: string): number => {
    return base + timeOfDay(text)
  }
  if (/今[天日]|今晚/.test(s)) return setHM(d0, s)
  if (/明[天日]/.test(s)) return setHM(d0 + 86400000, s)
  if (/后天/.test(s)) return setHM(d0 + 2 * 86400000, s)
  const week = s.match(/(?:周|星期)([日天一二三四五六])/)
  if (week) {
    const map: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
    const target = map[week[1]]
    const cur = new Date(now).getDay()
    const delta = (target - cur + 7) % 7
    return setHM(d0 + delta * 86400000, s)
  }
  const t = Date.parse(s)
  if (!Number.isNaN(t)) return t
  const rel = s.match(/(\d+)\s*(分钟|小时|天|周)后/)
  if (rel) {
    const n = Number(rel[1])
    const unit = rel[2]
    const ms = unit === '分钟' ? 60000 : unit === '小时' ? 3600000 : unit === '天' ? 86400000 : 604800000
    return now + n * ms
  }
  return undefined
}

/* ==================== AI Prompt 构造（system 文案，component 经 onAI(system, user) 调用） ==================== */

/** 一段话规划 → 多条任务 JSON */
export const planPrompt =
  '你是项目规划助手。把用户这段话拆成多条可执行任务。只回 JSON 数组，每项形如 {"text":"任务","due":"明天9点或空","priority":1|2|3,"tags":["标签"]}。priority: 1紧急 2重要 3普通。due 用自然语言（今天/明天/后天 + 时间）或留空。'

/** 智能排期：给无期限任务安排时段 */
export const schedulePrompt =
  '你是日程规划师。为下列无期限任务安排到今天/明天/后天的合理时段（工作时间 9-18 点，高优先在前）。只回 JSON 数组 [{"i":序号从0开始,"due":"明天14:00"}]。'

/** 逾期诊断 */
export const diagnosePrompt =
  '你是拖延症教练。分析这些逾期任务为什么被拖延，给出针对性的破局建议（如拆小、换时段、降低门槛）。简洁中文 Markdown。'

/** 合并去重建议 */
export const mergePrompt =
  '你是任务整理助手。找出下列任务里语义重复或可合并的组，给出合并建议（哪些合成一条、新描述）。若无重复就说明。简洁中文 Markdown。'

/** 目标澄清 */
export const clarifyPrompt =
  '用户给了一个模糊目标。先用 2-3 个澄清问题帮他想清楚，再给出初步的任务拆解建议。简洁中文 Markdown。'

/** 单任务估时（只回整数分钟） */
export const estimatePrompt = '你是时间管理专家。为下面这条任务估算完成所需分钟数，只回一个整数分钟数，不要任何其它文字。'

/** SMART 改写 */
export const smartPrompt =
  '你是执行力教练。把任务改写得更清晰可执行（SMART：具体、可衡量、有动作动词），保持简洁一行。只回改写后的一句话，不要引号和解释。'

/** 单任务打标签 */
export const autoTagPrompt = (existing: string[]): string =>
  `你是任务归类助手。为任务生成 1-3 个简短中文标签（每个 2-6 字，如"工作/学习/健康/家庭/紧急"）。只回 JSON 数组，如 ["工作","会议"]。${existing.length ? '优先复用已有标签：' + existing.join('、') : ''}`

/** 拆解子任务 */
export const breakdownPrompt =
  '你是任务分解专家。把下面这个任务拆成 3-6 个可执行子步骤。只回 JSON 字符串数组，如 ["步骤一","步骤二"]，不要序号和其它文字。'

/** 统一「AI 报告」：站会/复盘/周计划/聚焦四合一 */
export type ReportKind = 'focus' | 'standup' | 'review' | 'week'
export function reportPrompt(kind: ReportKind): string {
  if (kind === 'focus') return '你是效率教练。从我的待办里选出现在最该做的 3 件事，每件一句话说明为什么。用简洁中文 Markdown 有序列表。'
  if (kind === 'standup') return '你是敏捷教练。基于今天已完成和待办，生成一段中文站会小结：昨日/今日进展、今天计划、可能的阻塞。简洁 Markdown。'
  if (kind === 'review') return '你是复盘教练。基于今天完成情况做一段温和有洞见的每日复盘：完成亮点、可改进点、给明天的一条建议。简洁中文 Markdown。'
  return '你是周计划顾问。基于我的待办，给出一份本周（周一到周日）的合理安排建议，按天分配重点任务。简洁中文 Markdown。'
}

/** 新增：四象限自动分类（艾森豪威尔） */
export const quadrantPrompt =
  '你是时间管理教练。用艾森豪威尔矩阵为下列任务判定象限并回填优先级：重要且紧急/重要不紧急→priority 1或2；不重要→priority 3。只回 JSON 数组 [{"i":序号从0开始,"priority":1|2|3}]。'

/** 新增：粘贴整理（会议记录/聊天 → 抽任务） */
export const pastePrompt =
  '你是会议纪要助手。从下面这段文本（会议记录/聊天/邮件）中抽取出所有"行动项/待办"，忽略闲聊与信息性内容。只回 JSON 数组，每项 {"text":"谁做什么","due":"自然语言时间或空","priority":1|2|3}。若无明确待办则回 []。'

/** 新增：精力匹配（按当前时段 + 历史工时推荐现在做哪件） */
export function energyPrompt(nowDesc: string): string {
  return `你是精力管理教练。现在是${nowDesc}。结合当前时段的精力状态（清晨/上午精力高适合硬骨头，午后偏低适合轻任务，晚上适合收尾），从我的待办里推荐"现在最适合做"的 1-2 件，并各用一句话说明为什么契合此刻精力。简洁中文 Markdown。`
}
