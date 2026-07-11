// 剪贴板文本类型识别 + AI 转换动作。纯启发式，零成本。

export function tagOf(text: string): string {
  const t = text.trim()
  if (/^https?:\/\/\S+$/i.test(t)) return '链接'
  if (/(\berror\b|exception|traceback|panic|\bfailed\b|错误|异常|失败|at\s+\w+\.\w+\()/i.test(t)) return '报错'
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { JSON.parse(t); return 'JSON' } catch { /* 不是合法 JSON，继续判断 */ }
  }
  if (/^#[0-9a-f]{3,8}$/i.test(t) || /^(rgb|rgba|hsl|oklch)\s*\(/i.test(t)) return '颜色'
  // 表格：多行且含制表符或多个竖线
  if (/\n/.test(t) && (/\t/.test(t) || /\|.*\|/.test(t))) return '表格'
  // 代码：含典型符号且多行 / 或明显语法
  if (/[{};]\s*$/m.test(t) || /\b(function|const|let|import|def|class|return|public|void|=>)\b/.test(t)) return '代码'
  return '文本'
}

/** 类型 → 展示色相（OKLCH 主题色系内取偏移） */
export const tagHue: Record<string, number> = {
  链接: 230, 报错: 25, JSON: 280, 颜色: 320, 表格: 90, 代码: 150, 文本: 200, 图片: 260
}

/** AI 一键转换（按类型给不同默认动作） */
export const CLIP_ACTIONS = [
  { key: 'explain', label: '释', title: '解释', prefix: '解释下面的内容（代码给关键逻辑，报错给原因与修复）：\n\n' },
  { key: 'trans', label: '译', title: '翻译', prefix: '翻译下面的内容（中英互译，保留术语）：\n\n' },
  { key: 'clean', label: '洗', title: '清洗格式', prefix: '把下面的内容清洗成干净的纯文本/Markdown（去乱码、修正换行、保留结构）：\n\n' },
  { key: 'json', label: 'JSON', title: '转 JSON', prefix: '把下面的内容整理成规范的 JSON（推断字段名与结构）：\n\n' },
  { key: 'table', label: '表', title: '提取为表格', prefix: '把下面的内容提取成 Markdown 表格：\n\n' }
]
