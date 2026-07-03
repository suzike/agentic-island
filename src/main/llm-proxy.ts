// 真实 Q&A 后端代理：把请求转发到用户在设置里配置的 OpenAI 兼容端点（Chat Completions）。
// 密钥仅存于本机（safeStorage 加密），此处直接使用。替代原型里的本地假回复。

import type { LlmRequestConfig } from '../shared/protocol'

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
    const res = await fetch(chatUrl(cfg.baseUrl), {
      method: 'POST',
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

/** 连通性测试：发一条极短请求验证端点/密钥/型号可用 */
export async function test(cfg: LlmRequestConfig): Promise<{ ok: boolean; msg: string }> {
  const t0 = Date.now()
  const r = await complete(cfg, '你是连通性测试助手，只回复"ok"。', 'ping')
  if (r.ok) return { ok: true, msg: `连接成功 · ${cfg.model} 响应正常（约 ${Date.now() - t0}ms）` }
  return { ok: false, msg: r.error || '连接失败' }
}
