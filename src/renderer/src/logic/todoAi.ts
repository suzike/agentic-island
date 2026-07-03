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
  let t = String(raw).trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try {
    const arr = JSON.parse(t.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    const out: AiTodo[] = []
    for (const it of arr) {
      if (!it || typeof it.text !== 'string' || !it.text.trim()) continue
      const todo: AiTodo = { text: it.text.trim().slice(0, 200) }
      if (typeof it.due === 'string') {
        const ms = new Date(it.due.replace(' ', 'T')).getTime()
        if (!Number.isNaN(ms)) todo.due = ms
      }
      if (it.priority === 1 || it.priority === 2 || it.priority === 3) todo.priority = it.priority
      if (it.repeat === 'daily' || it.repeat === 'weekly') todo.repeat = it.repeat
      out.push(todo)
    }
    return out.slice(0, 10)
  } catch {
    return []
  }
}
