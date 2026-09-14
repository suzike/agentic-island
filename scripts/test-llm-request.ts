import { buildAnthropicRequestBody, buildChatRequestBody, isAnthropicRequest, isBudgetExhausted, normalizeLlmBaseUrl, normalizeLlmConfig, outputBudgetOf, retryBudget, sanitizeLlmErrorDetail, withOutputBudget } from '../src/main/llm-request.ts'

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const codeBody = buildChatRequestBody({
  baseUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'code-key',
  model: 'kimi-for-coding'
}, 'system', 'ping', false, [])
ok(codeBody.max_completion_tokens === 900, 'Kimi Code 应使用 max_completion_tokens')
ok(!('max_tokens' in codeBody), 'Kimi Code 不应发送已弃用的 max_tokens')
ok(!('temperature' in codeBody), 'Kimi Code 不应发送可能与思考模式冲突的 temperature')
ok(JSON.stringify(codeBody.thinking) === JSON.stringify({ type: 'enabled' }), 'Kimi Code 应显式保持 thinking 开启')

const k3FastBody = buildChatRequestBody({
  baseUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'code-key',
  model: 'k3'
}, 'system', 'ping', false, [])
const k3DeepBody = buildChatRequestBody({
  baseUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'code-key',
  model: 'k3'
}, 'system', 'ping', true, [])
ok(k3FastBody.reasoning_effort === 'low' && k3DeepBody.reasoning_effort === 'max', 'Kimi K3 快速/深度模式应映射 low/max 思考强度')

const moonshotBody = buildChatRequestBody({
  baseUrl: 'https://api.moonshot.cn/v1',
  apiKey: 'moonshot-key',
  model: 'kimi-k2.6'
}, 'system', 'ping', true, [])
ok(moonshotBody.max_completion_tokens === 3000, 'Kimi 开放平台深度模式应使用新的完成长度参数')
ok(!('temperature' in moonshotBody), 'Kimi 开放平台新模型应由服务端选择匹配思考模式的温度')

const genericBody = buildChatRequestBody({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'deep-key',
  model: 'deepseek-chat'
}, 'system', 'ping', false, [])
ok(genericBody.max_tokens === 900 && genericBody.temperature === 0.4, '其他 OpenAI 兼容供应商应保留原请求参数')
ok(!('max_completion_tokens' in genericBody), '其他供应商不应被 Kimi 兼容逻辑污染')

const gptFast = buildChatRequestBody({
  baseUrl: 'https://api.openai.com/v1', apiKey: 'openai-key', model: 'gpt-5.6'
}, 'system', 'ping', false, [])
const gptDeep = buildChatRequestBody({
  baseUrl: 'https://api.openai.com/v1', apiKey: 'openai-key', model: 'gpt-5.6-terra'
}, 'system', 'ping', true, [])
ok(gptFast.max_completion_tokens === 900 && gptFast.reasoning_effort === 'low', 'GPT-5.6 快速模式应使用低推理强度')
ok(gptDeep.max_completion_tokens === 3000 && gptDeep.reasoning_effort === 'max', 'GPT-5.6 深度模式应使用最大推理强度')
ok(!('temperature' in gptFast) && !('max_tokens' in gptFast), 'GPT-5.6 不应收到旧完成参数或 temperature')

const deepSeekFast = buildChatRequestBody({
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'deep-key', model: 'deepseek-v4-flash'
}, 'system', 'ping', false, [])
const deepSeekDeep = buildChatRequestBody({
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'deep-key', model: 'deepseek-v4-pro'
}, 'system', 'ping', true, [])
ok(JSON.stringify(deepSeekFast.thinking) === JSON.stringify({ type: 'disabled' }), 'DeepSeek 快速模式应真正关闭 thinking')
ok(JSON.stringify(deepSeekDeep.thinking) === JSON.stringify({ type: 'enabled' }), 'DeepSeek 深度模式应开启 thinking')
// 实测 reasoning_effort=max 会让模型写到 18000+ 字仍不产出正文（8000 预算也被推理占满），
// 故深度模式不再发送该字段，并把预算抬到 8000 让思考与正文都装得下。
ok(!('reasoning_effort' in deepSeekDeep), 'DeepSeek 深度模式不应发送实测有害的 reasoning_effort')
ok(deepSeekDeep.max_tokens === 8000, 'DeepSeek 深度模式预算应能容纳推理过程')
ok(!('temperature' in deepSeekDeep), 'DeepSeek thinking 模式不应发送无效 temperature')

// 官方同时提供不带版本段的 `deepseek-flash`/`deepseek-pro`：必须同样走 thinking 方言，
// 否则思考关不掉、推理吃满预算、正文返回空串（线上表现为"模型未返回内容"）。
const deepSeekUnversioned = buildChatRequestBody({
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'deep-key', model: 'deepseek-flash'
}, 'system', 'ping', false, [])
ok(JSON.stringify(deepSeekUnversioned.thinking) === JSON.stringify({ type: 'disabled' }), 'deepseek-flash 应识别为 thinking 方言并关闭思考')
ok(!('temperature' in deepSeekUnversioned) === false, 'deepseek-flash 关闭思考时可发送 temperature')

// 老型号 `deepseek-chat` 未必接受 thinking 字段，不能被误判进该方言
const deepSeekChat = buildChatRequestBody({
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'deep-key', model: 'deepseek-chat'
}, 'system', 'ping', false, [])
ok(!('thinking' in deepSeekChat), 'deepseek-chat 不应收到 thinking 字段')

// 预算耗尽 → 放宽预算重试（推理型模型的思考长度不可预知，固定预算必然偶发空正文）
ok(isBudgetExhausted({ text: '', reasoning: 'think...', finishReason: 'length' }), '推理吃满预算、正文为空应判为需要重试')
ok(isBudgetExhausted({ text: '', finishReason: 'length' }), '正文为空且被长度截断即应重试（非推理模型同样适用）')
ok(!isBudgetExhausted({ text: '部分回答', finishReason: 'length' }), '正文非空的截断不重试（避免回答跳变）')
ok(!isBudgetExhausted({ text: '', reasoning: 'think', finishReason: 'stop' }), '正常结束但正文为空不属于预算问题')
ok(retryBudget(900) === 12000 && retryBudget(8000) === 16000, '重试预算应至少翻倍且不低于 12000')

const rewritten = withOutputBudget({ model: 'm', max_tokens: 900 }, 12000)
ok(rewritten.max_tokens === 12000 && outputBudgetOf(rewritten) === 12000, '应改写 max_tokens 方言的预算')
const rewrittenCompletion = withOutputBudget({ model: 'm', max_completion_tokens: 900 }, 12000)
ok(rewrittenCompletion.max_completion_tokens === 12000 && !('max_tokens' in rewrittenCompletion), '应改写 max_completion_tokens 方言且不混入另一种字段')
ok(outputBudgetOf({ model: 'm' }) === 0, '未设置预算时按 0 计')

const secret = 'sk-secret-value-123456'
const sanitized = sanitizeLlmErrorDetail(`invalid api_key=${secret}; Authorization: Bearer ${secret}`, secret)
ok(!sanitized.includes(secret) && sanitized.includes('[API_KEY]'), '上游错误详情不得向渲染层回显 API Key')

ok(normalizeLlmBaseUrl(' https://api.kimi.com/coding/v1/chat/completions/ ') === 'https://api.kimi.com/coding/v1', '误填完整 Chat Completions 地址时应恢复为 Base URL')
const normalized = normalizeLlmConfig({ baseUrl: ' https://api.deepseek.com/v1/ ', apiKey: ' key-with-spaces ', model: ' deepseek-v4-pro ' })
ok(normalized.baseUrl === 'https://api.deepseek.com/v1' && normalized.apiKey === 'key-with-spaces' && normalized.model === 'deepseek-v4-pro', '请求前应清理复制配置带入的首尾空白')

const claudeCfg = { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'claude-key', model: 'claude-sonnet-4' }
const claudeBody = buildAnthropicRequestBody(claudeCfg, 'system', [
  { type: 'text', text: '分析图片' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
], true, [{ role: 'user', content: '上文' }])
const claudeMessages = claudeBody.messages as Array<{ role: string; content: unknown }>
const claudeParts = claudeMessages.at(-1)?.content as Array<{ type: string; source?: { type: string; media_type?: string; data?: string } }>
ok(isAnthropicRequest(claudeCfg) && claudeBody.system === 'system' && claudeBody.max_tokens === 3000, 'Anthropic 官方端点应使用原生 Messages 请求体')
ok(claudeParts[1]?.type === 'image' && claudeParts[1]?.source?.media_type === 'image/png' && claudeParts[1]?.source?.data === 'AAAA', 'OpenAI 图片 part 应转换为 Anthropic base64 图片源')

const currentClaudeFast = buildAnthropicRequestBody({ ...claudeCfg, model: 'claude-sonnet-5' }, 'system', 'ping', false, [])
const currentClaudeDeep = buildAnthropicRequestBody({ ...claudeCfg, model: 'claude-sonnet-5' }, 'system', 'ping', true, [])
ok(JSON.stringify(currentClaudeFast.thinking) === JSON.stringify({ type: 'disabled' }), 'Claude Sonnet 5 快速模式应关闭默认 adaptive thinking')
ok(JSON.stringify(currentClaudeDeep.thinking) === JSON.stringify({ type: 'adaptive', display: 'summarized' }), 'Claude Sonnet 5 深度模式应启用 adaptive thinking 摘要')
ok(JSON.stringify(currentClaudeDeep.output_config) === JSON.stringify({ effort: 'max' }), 'Claude Sonnet 5 深度模式应映射 max effort')

const fableFast = buildAnthropicRequestBody({ ...claudeCfg, model: 'claude-fable-5' }, 'system', 'ping', false, [])
const fableDeep = buildAnthropicRequestBody({ ...claudeCfg, model: 'claude-fable-5' }, 'system', 'ping', true, [])
ok(!('thinking' in fableFast) && JSON.stringify(fableFast.output_config) === JSON.stringify({ effort: 'low' }), 'Claude Fable 5 快速模式应保留服务端常开思考并降低 effort')
ok(JSON.stringify(fableDeep.thinking) === JSON.stringify({ type: 'adaptive', display: 'summarized' }), 'Claude Fable 5 深度模式应使用 adaptive thinking')

const haikuDeep = buildAnthropicRequestBody({ ...claudeCfg, model: 'claude-haiku-4-5' }, 'system', 'ping', true, [])
ok(JSON.stringify(haikuDeep.thinking) === JSON.stringify({ type: 'enabled', budget_tokens: 1024 }), 'Claude Haiku 4.5 深度模式应使用手动 extended thinking')

const pinnedHistory = Array.from({ length: 20 }, (_, index) => ({ role: (index % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `pinned-${index}` }))
const historyBody = buildChatRequestBody({
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'deep-key',
  model: 'deepseek-chat'
}, 'system', 'ping', false, pinnedHistory)
const sentMessages = historyBody.messages as Array<{ content: string }>
ok(sentMessages.some((message) => message.content === 'pinned-0') && sentMessages.some((message) => message.content === 'pinned-19'), '代理层不得二次截断渲染层已选定的置顶上下文')

console.log('llm request compatibility tests passed')
