// 真实 Q&A 后端代理：把请求转发到用户在设置里配置的 OpenAI 兼容端点（Chat Completions）。
// 密钥仅存于本机（safeStorage 加密），此处直接使用。替代原型里的本地假回复。

import type { LlmRequestConfig } from '../shared/protocol'
import { netFetch } from './http-client'
import { buildAnthropicRequestBody, buildChatRequestBody, isAnthropicRequest, normalizeLlmBaseUrl, normalizeLlmConfig, sanitizeLlmErrorDetail } from './llm-request'

const chatUrl = (baseUrl: string): string => normalizeLlmBaseUrl(baseUrl) + '/chat/completions'
const anthropicHeaders = (apiKey: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01'
})

function requestError(status: number, body: string, model = '', baseUrl = '', apiKey = ''): string {
  if (status === 401 || status === 403) {
    if (/api\.kimi\.com/i.test(baseUrl)) {
      return 'Kimi Code 认证或套餐权限失败：请确认使用会员 API Key；K3 需 Moderato 及以上，HighSpeed 需 Allegretto 及以上'
    }
    if (/api\.(?:moonshot\.cn|moonshot\.ai)/i.test(baseUrl)) {
      return 'Kimi 开放平台认证失败：开放平台密钥与 Kimi Code 会员密钥不通用，请检查密钥和 Base URL'
    }
    if (/api\.anthropic\.com/i.test(baseUrl)) return 'Claude 认证失败：请检查 Anthropic Console API Key 与账号权限'
    return '认证失败：当前 API Key 无效，或不属于所选供应商'
  }
  if (status === 404 && /model|not found|不存在/i.test(body)) {
    if (/api\.kimi\.com/i.test(baseUrl)) return `模型不可用：${model || '当前型号'}，请选择 Kimi Code 官方模型后重试`
    return `模型不可用：${model || '当前型号'}，请同步可用模型后重试`
  }
  if (status === 429) return '请求受限：账号余额、并发或速率限制不足'
  return `HTTP ${status} ${sanitizeLlmErrorDetail(body, apiKey).slice(0, 160)}`
}

export async function complete(
  cfg: LlmRequestConfig,
  system: string,
  // string=纯文本；数组=多模态 parts（带图提问，需模型支持视觉，否则端点会报错并如实透传）
  user: string | Array<Record<string, unknown>>,
  deep = false,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<{ ok: boolean; text?: string; reasoning?: string; error?: string }> {
  cfg = normalizeLlmConfig(cfg)
  if (!cfg.baseUrl || !/^https?:\/\//.test(cfg.baseUrl)) return { ok: false, error: 'Base URL 无效' }
  if (!cfg.apiKey) return { ok: false, error: 'API Key 未配置' }
  if (!cfg.model) return { ok: false, error: '未选择型号' }
  try {
    const anthropic = isAnthropicRequest(cfg)
    const body = anthropic
      ? buildAnthropicRequestBody(cfg, system, user, deep, history)
      : buildChatRequestBody(cfg, system, user, deep, history)
    const res = await netFetch(anthropic ? cfg.baseUrl + '/messages' : chatUrl(cfg.baseUrl), {
      method: 'POST',
      timeoutMs: deep ? 120000 : 60000,
      headers: anthropic ? anthropicHeaders(cfg.apiKey) : { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // 本轮带图但端点拒绝 image_url（模型不支持视觉）——给出可操作提示，而非生肉 400
      const hasImage = Array.isArray(user) && user.some((p) => p && (p as { type?: string }).type === 'image_url')
      if (hasImage && (res.status === 400 || /image_url|vision|multimodal|deserialize/i.test(body))) {
        return { ok: false, error: `当前模型「${cfg.model}」不支持图片输入。请到「设置 › 问答助手模型」切换或新增当前账号可用的视觉多模态模型后再试。` }
      }
      return { ok: false, error: requestError(res.status, body, cfg.model, cfg.baseUrl, cfg.apiKey) }
    }
    if (anthropic) {
      const data = await res.json() as { content?: Array<{ type?: string; text?: string; thinking?: string }> }
      const text = (data.content || []).filter((item) => item.type === 'text' && item.text).map((item) => item.text).join('\n\n')
      const reasoning = (data.content || []).filter((item) => item.type === 'thinking' && item.thinking).map((item) => item.thinking).join('\n\n')
      return text ? { ok: true, text, reasoning: reasoning || undefined } : { ok: false, error: '响应为空' }
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string } }[] }
    const msg = data.choices?.[0]?.message
    const text = msg?.content
    // 推理型模型（如 deepseek-reasoner）会单独返回思维链
    const reasoning = msg?.reasoning_content || msg?.reasoning
    return typeof text === 'string' ? { ok: true, text, reasoning } : { ok: false, error: '响应为空' }
  } catch (e) {
    return { ok: false, error: sanitizeLlmErrorDetail(String(e), cfg.apiKey) }
  }
}

/** 读取当前端点与账号实际可用的模型目录（OpenAI 兼容 GET /models）。 */
export async function listModels(cfg: LlmRequestConfig): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  cfg = normalizeLlmConfig(cfg)
  if (!cfg.baseUrl || !/^https?:\/\//.test(cfg.baseUrl)) return { ok: false, error: 'Base URL 无效' }
  if (!cfg.apiKey) return { ok: false, error: 'API Key 未配置' }
  try {
    const anthropic = isAnthropicRequest(cfg)
    const res = await netFetch(cfg.baseUrl + '/models', {
      method: 'GET',
      timeoutMs: 30000,
      headers: anthropic ? anthropicHeaders(cfg.apiKey) : { authorization: `Bearer ${cfg.apiKey}` }
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: requestError(res.status, body, '', cfg.baseUrl, cfg.apiKey) }
    }
    const data = await res.json() as { data?: Array<{ id?: unknown }> }
    const models = [...new Set((data.data || []).map((item) => typeof item.id === 'string' ? item.id.trim() : '').filter(Boolean))]
    return models.length ? { ok: true, models } : { ok: false, error: '端点未返回可用模型' }
  } catch (e) {
    return { ok: false, error: sanitizeLlmErrorDetail(String(e), cfg.apiKey) }
  }
}

/** 文本向量化：OpenAI 兼容 /embeddings（第二大脑本地 RAG 用）。cfg.model = 向量模型名。 */
export async function embed(cfg: LlmRequestConfig, texts: string[]): Promise<{ ok: boolean; vectors?: number[][]; error?: string }> {
  cfg = normalizeLlmConfig(cfg)
  if (!cfg.baseUrl || !/^https?:\/\//.test(cfg.baseUrl)) return { ok: false, error: 'Base URL 无效' }
  if (!cfg.apiKey) return { ok: false, error: 'API Key 未配置' }
  if (!cfg.model) return { ok: false, error: '未设置向量模型' }
  if (isAnthropicRequest(cfg)) return { ok: false, error: 'Anthropic 官方 API 不提供 Embeddings，请为知识库配置支持 /embeddings 的供应商' }
  try {
    const url = cfg.baseUrl.replace(/\/+$/, '') + '/embeddings'
    const res = await netFetch(url, {
      method: 'POST',
      timeoutMs: 60000,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, input: texts })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: requestError(res.status, body, cfg.model, cfg.baseUrl, cfg.apiKey) }
    }
    const data = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] }
    // 按 index 归位（部分端点乱序返回），再取 embedding
    const rows = (data.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const vectors = rows.map((d) => d.embedding || [])
    if (!vectors.length || vectors.some((v) => !v.length)) return { ok: false, error: '端点未返回有效向量（检查该模型是否为 embedding 模型、端点是否支持 /embeddings）' }
    return { ok: true, vectors }
  } catch (e) {
    return { ok: false, error: sanitizeLlmErrorDetail(String(e), cfg.apiKey) }
  }
}

/** 连通性测试：发一条极短请求验证端点/密钥/型号可用 */
export async function test(cfg: LlmRequestConfig): Promise<{ ok: boolean; msg: string }> {
  const t0 = Date.now()
  const r = await complete(cfg, '你是连通性测试助手，只回复"ok"。', 'ping')
  if (r.ok) return { ok: true, msg: `连接成功 · ${cfg.model} 响应正常（约 ${Date.now() - t0}ms）` }
  return { ok: false, msg: r.error || '连接失败' }
}
