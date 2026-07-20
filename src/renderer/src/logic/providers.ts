// 问答助手的 OpenAI 兼容供应商目录与持久化迁移。

export interface Provider {
  key: string
  label: string
  baseUrl: string
  models: string[]
}

export interface ProviderDraft {
  model: string
  baseUrl: string
  apiKey: string
}

export interface SavedProviderConfig extends ProviderDraft {
  id: number
  provider: string
  name: string
}

export interface ProviderSettingsSnapshot extends ProviderDraft {
  provider: string
  saved: SavedProviderConfig[]
  modelLists: Record<string, string[]>
  profiles: Record<string, ProviderDraft>
  providerCatalogVersion: number
}

// 目录升级时递增：旧持久化数据只在版本变化时补入新官方型号，之后仍允许用户删除。
export const PROVIDER_CATALOG_VERSION = 2

export const PROVIDERS: Provider[] = [
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] },
  { key: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'moonshot-v1-8k', 'moonshot-v1-32k'] },
  { key: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { key: 'openai', label: 'GPT (OpenAI)', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o4-mini'] },
  { key: 'claude', label: 'Claude', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4'] },
  { key: 'custom', label: '自定义', baseUrl: '', models: [] }
]

const providerOf = (key: string): Provider => PROVIDERS.find((item) => item.key === key) || PROVIDERS[0]
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const unique = (values: unknown[]): string[] => [...new Set(values.map(text).filter(Boolean))]

export function defaultProviderDraft(key: string): ProviderDraft {
  const provider = providerOf(key)
  return { model: provider.models[0] || '', baseUrl: provider.baseUrl, apiKey: '' }
}

export function defaultProviderModelLists(): Record<string, string[]> {
  return Object.fromEntries(PROVIDERS.map((provider): [string, string[]] => [provider.key, [...provider.models]]))
}

export function defaultProviderProfiles(): Record<string, ProviderDraft> {
  return Object.fromEntries(PROVIDERS.map((provider): [string, ProviderDraft] => [provider.key, defaultProviderDraft(provider.key)]))
}

function savedConfigs(value: unknown): SavedProviderConfig[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Partial<SavedProviderConfig>
    const provider = text(raw.provider)
    if (!PROVIDERS.some((entry) => entry.key === provider)) return []
    const model = text(raw.model)
    const baseUrl = text(raw.baseUrl) || defaultProviderDraft(provider).baseUrl
    return [{
      id: Number.isFinite(raw.id) ? Number(raw.id) : Date.now() + index,
      provider,
      model,
      baseUrl,
      apiKey: text(raw.apiKey),
      name: text(raw.name) || `${providerOf(provider).label} · ${model || '未命名'}`
    }]
  })
}

/**
 * 兼容旧版单一 model/baseUrl/apiKey 状态：
 * - 官方目录升级时补入新型号，但保留用户自定义型号；
 * - 已保存配置迁移为各供应商独立草稿；
 * - 旧版当前配置只归入当时选中的供应商，避免切换后继续串用密钥。
 */
export function migrateProviderSettings(rawValue: unknown): ProviderSettingsSnapshot {
  const raw = rawValue && typeof rawValue === 'object' ? rawValue as Partial<ProviderSettingsSnapshot> : {}
  const provider = PROVIDERS.some((item) => item.key === raw.provider) ? String(raw.provider) : PROVIDERS[0].key
  const saved = savedConfigs(raw.saved)
  const currentCatalog = raw.providerCatalogVersion === PROVIDER_CATALOG_VERSION
  const rawLists = raw.modelLists && typeof raw.modelLists === 'object' ? raw.modelLists : {}
  const modelLists: Record<string, string[]> = {}

  for (const item of PROVIDERS) {
    const stored = Array.isArray(rawLists[item.key]) ? rawLists[item.key] : undefined
    modelLists[item.key] = stored
      ? unique(currentCatalog ? stored : [...item.models, ...stored])
      : [...item.models]
  }

  const profiles = defaultProviderProfiles()
  for (const config of [...saved].reverse()) {
    profiles[config.provider] = { model: config.model, baseUrl: config.baseUrl, apiKey: config.apiKey }
  }
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const item of PROVIDERS) {
      const stored = raw.profiles[item.key]
      if (!stored || typeof stored !== 'object') continue
      profiles[item.key] = {
        model: text(stored.model) || profiles[item.key].model,
        baseUrl: text(stored.baseUrl) || profiles[item.key].baseUrl,
        apiKey: text(stored.apiKey)
      }
    }
  }

  // 旧版顶层字段代表当前供应商，必须优先保留。
  const current = profiles[provider] || defaultProviderDraft(provider)
  profiles[provider] = {
    model: text(raw.model) || current.model,
    baseUrl: text(raw.baseUrl) || current.baseUrl,
    apiKey: text(raw.apiKey) || current.apiKey
  }

  for (const item of PROVIDERS) {
    const profile = profiles[item.key]
    if (!profile.model && modelLists[item.key].length) profile.model = modelLists[item.key][0]
    if (profile.model && !modelLists[item.key].includes(profile.model)) modelLists[item.key].push(profile.model)
  }

  return {
    provider,
    ...profiles[provider],
    saved,
    modelLists,
    profiles,
    providerCatalogVersion: PROVIDER_CATALOG_VERSION
  }
}

export function patchProviderDraft(state: ProviderSettingsSnapshot, patch: Partial<ProviderDraft>): ProviderSettingsSnapshot {
  const draft = { ...state.profiles[state.provider], model: state.model, baseUrl: state.baseUrl, apiKey: state.apiKey, ...patch }
  return { ...state, ...draft, profiles: { ...state.profiles, [state.provider]: draft } }
}

export function switchProviderSettings(state: ProviderSettingsSnapshot, providerKey: string): ProviderSettingsSnapshot {
  const provider = providerOf(providerKey)
  const profiles = {
    ...state.profiles,
    [state.provider]: { model: state.model, baseUrl: state.baseUrl, apiKey: state.apiKey }
  }
  const saved = state.saved.find((item) => item.provider === provider.key)
  const target = profiles[provider.key] || (saved
    ? { model: saved.model, baseUrl: saved.baseUrl, apiKey: saved.apiKey }
    : defaultProviderDraft(provider.key))
  const models = state.modelLists[provider.key] || provider.models
  const model = target.model || models[0] || ''
  const draft = { model, baseUrl: target.baseUrl || provider.baseUrl, apiKey: target.apiKey || '' }
  return { ...state, provider: provider.key, ...draft, profiles: { ...profiles, [provider.key]: draft } }
}
