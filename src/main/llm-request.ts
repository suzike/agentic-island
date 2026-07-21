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

function isDeepSeekV4Request(cfg: LlmRequestConfig): boolean {
  return /^deepseek-v4-(?:pro|flash)$/i.test(cfg.model) || requestHost(cfg) === 'api.deepseek.com' && /^deepseek-v4-/i.test(cfg.model)
}

function isOpenAiReasoningRequest(cfg: LlmRequestConfig): boolean {
  return /^gpt-5(?:\.|$)/i.test(cfg.model) && requestHost(cfg) === 'api.openai.com'
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
  } else if (isDeepSeekV4Request(cfg)) {
    body.max_tokens = deep ? 3000 : 900
    body.thinking = { type: deep ? 'enabled' : 'disabled' }
    if (deep) body.reasoning_effort = 'max'
    else body.temperature = 0.4
  } else if (isOpenAiReasoningRequest(cfg)) {
    body.max_completion_tokens = deep ? 3000 : 900
    body.reasoning_effort = deep && /^gpt-5\.6(?:-|$)/i.test(cfg.model) ? 'max' : deep ? 'high' : 'low'
  } else {
    body.max_tokens = deep ? 3000 : 900
    body.temperature = deep ? 0.6 : 0.4
  }
  return body
}
