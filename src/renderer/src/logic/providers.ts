// 问答助手的 OpenAI 兼容 / Anthropic 原生供应商目录与持久化迁移。

export interface Provider {
  key: string
  label: string
  baseUrl: string
  models: string[]
  hint?: string
  modelDiscovery?: boolean
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
export const PROVIDER_CATALOG_VERSION = 5

export const PROVIDERS: Provider[] = [
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] },
  {
    key: 'kimi-code',
    label: 'Kimi Code',
    baseUrl: 'https://api.kimi.com/coding/v1',
    models: ['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3'],
    hint: '使用 Kimi For Coding 会员密钥；与开放平台密钥不通用',
    modelDiscovery: false
  },
  {
    key: 'kimi',
    label: 'Kimi 开放平台',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'moonshot-v1-8k', 'moonshot-v1-32k'],
    hint: '使用 Moonshot AI 开放平台密钥；与 Kimi Code 会员密钥不通用'
  },
  { key: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { key: 'openai', label: 'GPT (OpenAI)', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o4-mini'] },
  { key: 'claude', label: 'Claude', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'], hint: '直连 Anthropic Messages API；使用 Anthropic Console API Key' },
  { key: 'custom', label: '自定义', baseUrl: '', models: [] }
]

const providerOf = (key: string): Provider => PROVIDERS.find((item) => item.key === key) || PROVIDERS[0]
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const unique = (values: unknown[]): string[] => [...new Set(values.map(text).filter(Boolean))]
const KIMI_CODE_MODELS = new Set(['k3', 'kimi-for-coding', 'kimi-for-coding-highspeed'])
const LEGACY_CLAUDE_MODELS: Record<string, string> = {
  'claude-sonnet-4': 'claude-sonnet-4-6',
  'claude-opus-4': 'claude-opus-4-8',
  'claude-haiku-4': 'claude-haiku-4-5'
}

function validProviderModel(provider: string, model: string): string {
  if (provider === 'claude' && LEGACY_CLAUDE_MODELS[model]) return LEGACY_CLAUDE_MODELS[model]
  const item = providerOf(provider)
  if (item.modelDiscovery !== false || !item.models.length) return model
  return item.models.includes(model) ? model : item.models[0]
}

function isKimiCodeDraft(value: Partial<ProviderDraft>): boolean {
  return /api\.kimi\.com\/coding(?:\/v1)?\/?$/i.test(text(value.baseUrl)) || KIMI_CODE_MODELS.has(text(value.model))
}

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
    const model = validProviderModel(provider, text(raw.model))
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
  let provider = PROVIDERS.some((item) => item.key === raw.provider) ? String(raw.provider) : PROVIDERS[0].key
  const previousCatalogVersion = Number.isFinite(raw.providerCatalogVersion) ? Number(raw.providerCatalogVersion) : 0
  let saved = savedConfigs(raw.saved)
  if (previousCatalogVersion < 3) {
    saved = saved.map((config) => config.provider === 'kimi' && isKimiCodeDraft(config)
      ? { ...config, provider: 'kimi-code', name: `Kimi Code · ${config.model || '未命名'}` }
      : config)
  }
  const currentCatalog = raw.providerCatalogVersion === PROVIDER_CATALOG_VERSION
  const rawLists = raw.modelLists && typeof raw.modelLists === 'object' ? raw.modelLists : {}
  const modelLists: Record<string, string[]> = {}

  for (const item of PROVIDERS) {
    const stored = Array.isArray(rawLists[item.key]) ? rawLists[item.key] : undefined
    modelLists[item.key] = item.modelDiscovery === false
      ? [...item.models]
      : stored
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

  if (previousCatalogVersion < 3) {
    const legacyKimi = profiles.kimi
    if (isKimiCodeDraft(legacyKimi)) {
      profiles['kimi-code'] = {
        model: KIMI_CODE_MODELS.has(legacyKimi.model) ? legacyKimi.model : defaultProviderDraft('kimi-code').model,
        baseUrl: defaultProviderDraft('kimi-code').baseUrl,
        apiKey: legacyKimi.apiKey
      }
      profiles.kimi = defaultProviderDraft('kimi')
      if (provider === 'kimi') provider = 'kimi-code'
    } else if (legacyKimi.apiKey && !profiles['kimi-code'].apiKey) {
      // v2 只有一个 Kimi 入口。复制一次旧密钥，方便误把会员密钥填入旧入口的用户直接切换验证。
      profiles['kimi-code'] = { ...profiles['kimi-code'], apiKey: legacyKimi.apiKey }
    }
  }

  for (const item of PROVIDERS) {
    const profile = profiles[item.key]
    profile.model = validProviderModel(item.key, profile.model)
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
