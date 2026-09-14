import type { LlmRequestConfig } from '../shared/protocol'

type ChatContent = string | Array<Record<string, unknown>>
type ChatHistory = { role: 'user' | 'assistant'; content: string }[]

export function normalizeLlmBaseUrl(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|messages)$/i, '')
}

export function normalizeLlmConfig(cfg: LlmRequestConfig): LlmRequestConfig {
  return {
    baseUrl: normalizeLlmBaseUrl(cfg.baseUrl),
    apiKey: String(cfg.apiKey || '').trim(),
    model: String(cfg.model || '').trim()
  }
}

function requestHost(cfg: LlmRequestConfig): string {
  try {
    return new URL(normalizeLlmBaseUrl(cfg.baseUrl)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isAnthropicRequest(cfg: LlmRequestConfig): boolean {
  return requestHost(cfg) === 'api.anthropic.com'
}

function anthropicContent(user: ChatContent): ChatContent {
  if (typeof user === 'string') return user
  return user.flatMap((part): Array<Record<string, unknown>> => {
    if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }]
    if (part.type !== 'image_url') return []
    const raw = (part.image_url as { url?: unknown } | undefined)?.url
    if (typeof raw !== 'string' || !raw) return []
    const data = raw.match(/^data:([^;,]+);base64,(.+)$/i)
    return data
      ? [{ type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } }]
      : [{ type: 'image', source: { type: 'url', url: raw } }]
  })
}

export function buildAnthropicRequestBody(
  cfg: LlmRequestConfig,
  system: string,
  user: ChatContent,
  deep: boolean,
  history: ChatHistory
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: deep ? 3000 : 900,
    system,
    messages: [...history, { role: 'user', content: anthropicContent(user) }]
  }
  const model = cfg.model.toLowerCase()
  if (/^claude-(?:fable-5|sonnet-5|sonnet-4-6|opus-4-(?:6|7|8))$/.test(model)) {
    body.output_config = { effort: deep ? 'max' : 'low' }
    if (deep) body.thinking = { type: 'adaptive', display: 'summarized' }
    else if (model === 'claude-sonnet-5') body.thinking = { type: 'disabled' }
  } else if (model === 'claude-haiku-4-5' && deep) {
    body.thinking = { type: 'enabled', budget_tokens: 1024 }
  }
  return body
}

function isKimiRequest(cfg: LlmRequestConfig): boolean {
  const model = cfg.model.toLowerCase()
  if (/^(?:k3|kimi-|moonshot-)/.test(model)) return true
  const host = requestHost(cfg)
  return host === 'api.kimi.com' || host === 'api.moonshot.cn' || host === 'api.moonshot.ai'
}

function isKimiCodeRequest(cfg: LlmRequestConfig): boolean {
  return requestHost(cfg) === 'api.kimi.com' || /\/coding(?:\/v1)?\/?$/i.test(cfg.baseUrl)
}

/** DeepSeek 的 pro/flash 型号（含带版本段的 deepseek-v4-*）走 thinking 方言。
    版本段必须可选：官方同时提供 `deepseek-flash`/`deepseek-pro` 与 `deepseek-v4-flash`，
    只匹配后者会让前者落到通用分支——那样思考无法关闭，推理会把输出预算吃光、
    正文返回空串（实测 `deepseek-flash` + max_tokens 900：reasoning_tokens 900、content 长度 0）。
    刻意不匹配 `deepseek-chat`：老型号未必接受 thinking 字段。 */
function isDeepSeekThinkingRequest(cfg: LlmRequestConfig): boolean {
  return /^deepseek-(?:v\d+(?:\.\d+)?-)?(?:pro|flash)$/i.test(cfg.model)
}

function isOpenAiReasoningRequest(cfg: LlmRequestConfig): boolean {
  return /^gpt-5(?:\.|$)/i.test(cfg.model) && requestHost(cfg) === 'api.openai.com'
}

/** 把已构建请求体的输出预算改成 value。
    字段名随端点方言而异（`max_tokens` / `max_completion_tokens`），这里改写**已存在**的那个键，
    不重新推导分支逻辑，避免重试时把请求体改造成另一个方言。 */
export function withOutputBudget(body: Record<string, unknown>, value: number): Record<string, unknown> {
  if (typeof body['max_completion_tokens'] === 'number') return { ...body, max_completion_tokens: value }
  return { ...body, max_tokens: value }
}

/** 取请求体当前的输出预算（未设置时按 0 计）。 */
export function outputBudgetOf(body: Record<string, unknown>): number {
  const value = body['max_completion_tokens'] ?? body['max_tokens']
  return typeof value === 'number' ? value : 0
}

/**
 * 是否属于"输出预算被推理过程占满"——需要放宽预算重试一次。
 * 典型形态：HTTP 200、finish_reason=length、content 为空串、reasoning_content 有内容
 *（推理型模型把 max_tokens 全花在思考上，正文一个字都没写）。
 * 只认"被长度截断且正文为空"，不要求必须有 reasoning：非推理模型在预算刚好卡在首个
 * token 上时同样是这个形态，放宽预算重试对两者都安全。
 * 内容被截断但非空的不重试——用户已看到部分回答，重试会让回答跳变。
 */
export function isBudgetExhausted(result: { text?: string; reasoning?: string; finishReason?: string }): boolean {
  if (typeof result.text === 'string' && result.text.trim()) return false
  return result.finishReason === 'length'
}

/** 放宽后的重试预算：至少翻倍并抬到 12000，避免再次被推理吃满。 */
export function retryBudget(current: number): number {
  return Math.max(current * 2, 12000)
}

/** 上游报错可能回显密钥或 Authorization；返回渲染层前统一脱敏。 */
export function sanitizeLlmErrorDetail(raw: string, apiKey = ''): string {
  let value = String(raw || '')
  if (apiKey) value = value.split(apiKey).join('[API_KEY]')
  return value
    .replace(/(authorization\s*[=:]\s*['"]?bearer\s+)[^\s'",}]+/gi, '$1[API_KEY]')
    .replace(/((?:api[_ -]?key|token|secret)\s*[=:]\s*['"]?)[^\s'",}]+/gi, '$1[API_KEY]')
    .replace(/\b(?:sk|dk|msk|kimi)-[A-Za-z0-9_-]{8,}\b/g, '[API_KEY]')
}

export function buildChatRequestBody(
  cfg: LlmRequestConfig,
  system: string,
  user: ChatContent,
  deep: boolean,
  history: ChatHistory
): Record<string, unknown> {
  // 渲染层已经按“置顶 + 最近消息”完成上下文选择；这里不能再次从尾部截断，
  // 否则较早的 pinned 约束会在请求发出前被静默丢弃。
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: user }]
  const body: Record<string, unknown> = { model: cfg.model, messages }
  if (isKimiRequest(cfg)) {
    // Kimi 新模型对 temperature 有固定约束；省略后由服务端选择与思考模式匹配的值。
    body.max_completion_tokens = deep ? 3000 : 900
    if (isKimiCodeRequest(cfg)) {
      // Kimi Code 的 K3/K2.7 需要保持 thinking 开启；K3 再用 effort 映射岛内快/深模式。
      body.thinking = { type: 'enabled' }
      if (cfg.model.toLowerCase() === 'k3') body.reasoning_effort = deep ? 'max' : 'low'
    }
  } else if (isDeepSeekThinkingRequest(cfg)) {
    // 深度模式实测：`reasoning_effort: 'max'` 是负优化——模型把推理写到 18000+ 字仍不产出正文，
    // 即便给到 8000 预算也被推理占满（finish_reason=length、content 空串）。
    // 不开 effort（服务端默认强度）在 12000 预算下 25 秒给出完整回答，比 max 更快也更可靠。
    body.max_tokens = deep ? 8000 : 900
    body.thinking = { type: deep ? 'enabled' : 'disabled' }
    // 关闭 thinking 时 900 预算足够（实测 4.5 秒 / 完整回答）；开启时不接受自定义采样参数
    if (!deep) body.temperature = 0.4
  } else if (isOpenAiReasoningRequest(cfg)) {
    body.max_completion_tokens = deep ? 3000 : 900
    body.reasoning_effort = deep && /^gpt-5\.6(?:-|$)/i.test(cfg.model) ? 'max' : deep ? 'high' : 'low'
  } else {
    body.max_tokens = deep ? 3000 : 900
    body.temperature = deep ? 0.6 : 0.4
  }
  return body
}
