// 真实 Q&A 后端代理：把请求转发到用户在设置里配置的 OpenAI 兼容端点（Chat Completions）。
// 密钥仅存于本机（safeStorage 加密），此处直接使用。替代原型里的本地假回复。

import type { LlmRequestConfig } from '../shared/protocol'
import { netFetch } from './http-client'

const chatUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '') + '/chat/completions'

export async function complete(
  cfg: LlmRequestConfig,
  system: string,
  // string=纯文本；数组=多模态 parts（带图提问，需模型支持视觉，否则端点会报错并如实透传）
  user: string | Array<Record<string, unknown>>,
  deep = false,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<{ ok: boolean; text?: string; reasoning?: string; error?: string }> {
  if (!cfg.baseUrl || !/^https?:\/\//.test(cfg.baseUrl)) return { ok: false, error: 'Base URL 无效' }
  if (!cfg.apiKey) return { ok: false, error: 'API Key 未配置' }
  if (!cfg.model) return { ok: false, error: '未选择型号' }
  try {
    const res = await netFetch(chatUrl(cfg.baseUrl), {
      method: 'POST',
      timeoutMs: deep ? 120000 : 60000,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        // 多轮上下文：system + 最近历史 + 本轮提问
        messages: [{ role: 'system', content: system }, ...history.slice(-16), { role: 'user', content: user }],
        max_tokens: deep ? 3000 : 900,
        temperature: deep ? 0.6 : 0.4
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // 本轮带图但端点拒绝 image_url（模型不支持视觉）——给出可操作提示，而非生肉 400
      const hasImage = Array.isArray(user) && user.some((p) => p && (p as { type?: string }).type === 'image_url')
      if (hasImage && (res.status === 400 || /image_url|vision|multimodal|deserialize/i.test(body))) {
        return { ok: false, error: `当前模型「${cfg.model}」不支持图片输入。请到「设置 › 问答助手模型」切换/新增一个支持视觉的模型（如 glm-4v、qwen-vl-max、gpt-4o、gemini 等）后再试。` }
      }
      return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 160)}` }
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string } }[] }
    const msg = data.choices?.[0]?.message
    const text = msg?.content
    // 推理型模型（如 deepseek-reasoner）会单独返回思维链
    const reasoning = msg?.reasoning_content || msg?.reasoning
    return typeof text === 'string' ? { ok: true, text, reasoning } : { ok: false, error: '响应为空' }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** 文本向量化：OpenAI 兼容 /embeddings（第二大脑本地 RAG 用）。cfg.model = 向量模型名。 */
export async function embed(cfg: LlmRequestConfig, texts: string[]): Promise<{ ok: boolean; vectors?: number[][]; error?: string }> {
  if (!cfg.baseUrl || !/^https?:\/\//.test(cfg.baseUrl)) return { ok: false, error: 'Base URL 无效' }
  if (!cfg.apiKey) return { ok: false, error: 'API Key 未配置' }
  if (!cfg.model) return { ok: false, error: '未设置向量模型' }
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
      return { ok: false, error: `embeddings HTTP ${res.status} · ${cfg.model} · ${body.slice(0, 160)}` }
    }
    const data = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] }
    // 按 index 归位（部分端点乱序返回），再取 embedding
    const rows = (data.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const vectors = rows.map((d) => d.embedding || [])
    if (!vectors.length || vectors.some((v) => !v.length)) return { ok: false, error: '端点未返回有效向量（检查该模型是否为 embedding 模型、端点是否支持 /embeddings）' }
    return { ok: true, vectors }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** 连通性测试：发一条极短请求验证端点/密钥/型号可用 */
export async function test(cfg: LlmRequestConfig): Promise<{ ok: boolean; msg: string }> {
  const t0 = Date.now()
  const r = await complete(cfg, '你是连通性测试助手，只回复"ok"。', 'ping')
  if (r.ok) return { ok: true, msg: `连接成功 · ${cfg.model} 响应正常（约 ${Date.now() - t0}ms）` }
  return { ok: false, msg: r.error || '连接失败' }
}
