// 问答助手可选的 OpenAI 兼容供应商 —— 逐字移植自原型 Agentic-Island.dc.html:448-455。

export interface Provider {
  key: string
  label: string
  baseUrl: string
  models: string[]
}

export const PROVIDERS: Provider[] = [
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { key: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2'] },
  { key: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { key: 'openai', label: 'GPT (OpenAI)', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o4-mini'] },
  { key: 'claude', label: 'Claude', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4'] },
  { key: 'custom', label: '自定义', baseUrl: '', models: [] }
]
