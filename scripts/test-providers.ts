import {
  PROVIDERS,
  PROVIDER_CATALOG_VERSION,
  migrateProviderSettings,
  patchProviderDraft,
  switchProviderSettings
} from '../src/renderer/src/logic/providers.ts'

function ok(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const migrated = migrateProviderSettings({
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'deep-key',
  modelLists: {
    deepseek: ['deepseek-v4-pro', 'my-deepseek-model'],
    kimi: ['legacy-kimi-model']
  },
  saved: [
    { id: 1, provider: 'deepseek', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'saved-deep-key', name: 'DeepSeek' },
    { id: 2, provider: 'kimi', model: 'kimi-k2.6', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'kimi-key', name: 'Kimi' }
  ]
})

ok(migrated.providerCatalogVersion === PROVIDER_CATALOG_VERSION, '旧配置应迁移到当前目录版本')
ok(migrated.modelLists.deepseek.slice(0, 2).join(',') === 'deepseek-v4-pro,deepseek-v4-flash', 'DeepSeek 应补入当前官方型号')
ok(migrated.modelLists.deepseek.includes('my-deepseek-model'), '应保留用户自定义 DeepSeek 型号')
ok(migrated.modelLists.kimi.includes('kimi-k2.6') && migrated.modelLists.kimi.includes('legacy-kimi-model'), 'Kimi 应合并官方与旧型号')
ok(migrated.profiles.deepseek.apiKey === 'deep-key', '旧版当前密钥应归入当前 DeepSeek 供应商')
ok(migrated.profiles.kimi.apiKey === 'kimi-key', 'Kimi 已保存密钥应迁移到 Kimi 独立配置')
ok(migrated.profiles['kimi-code'].apiKey === 'kimi-key', 'v2 Kimi 密钥应一次性预填到 Kimi Code，便于修正旧版入口混用')

const kimiCodeProvider = PROVIDERS.find((item) => item.key === 'kimi-code')
ok(kimiCodeProvider?.baseUrl === 'https://api.kimi.com/coding/v1', 'Kimi Code 应使用官方 Coding API 地址')
ok(kimiCodeProvider?.models.join(',') === 'kimi-for-coding,kimi-for-coding-highspeed,k3', 'Kimi Code 应内置当前官方模型 ID')
ok(PROVIDERS.find((item) => item.key === 'kimi')?.baseUrl === 'https://api.moonshot.cn/v1', 'Kimi 开放平台应继续使用 Moonshot API 地址')

const kimi = switchProviderSettings(migrated, 'kimi')
ok(kimi.provider === 'kimi' && kimi.model === 'kimi-k2.6', '切换 Kimi 应恢复其模型')
ok(kimi.apiKey === 'kimi-key', '切换 Kimi 不得沿用 DeepSeek 密钥')
const editedKimi = patchProviderDraft(kimi, { apiKey: 'kimi-key-new', model: 'kimi-k2.5' })
const deepseek = switchProviderSettings(editedKimi, 'deepseek')
ok(deepseek.apiKey === 'deep-key', '切回 DeepSeek 应恢复 DeepSeek 密钥')
ok(deepseek.profiles.kimi.apiKey === 'kimi-key-new' && deepseek.profiles.kimi.model === 'kimi-k2.5', 'Kimi 未手动保存的草稿也应跨切换保留')

const kimiCode = switchProviderSettings(migrated, 'kimi-code')
ok(kimiCode.model === 'kimi-for-coding' && kimiCode.baseUrl === 'https://api.kimi.com/coding/v1', '切换 Kimi Code 应使用 Coding API 默认配置')
ok(kimiCode.apiKey === 'kimi-key', '升级后切换 Kimi Code 应复用一次性迁移的旧密钥')

const migratedManualCode = migrateProviderSettings({
  providerCatalogVersion: 2,
  provider: 'kimi',
  model: 'kimi-for-coding-highspeed',
  baseUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'code-key'
})
ok(migratedManualCode.provider === 'kimi-code', '旧版手动配置 Kimi Code 时应迁移到独立供应商')
ok(migratedManualCode.model === 'kimi-for-coding-highspeed' && migratedManualCode.apiKey === 'code-key', '手动 Kimi Code 配置迁移时不得丢失模型和密钥')
ok(migratedManualCode.profiles.kimi.baseUrl === 'https://api.moonshot.cn/v1', '迁移 Kimi Code 后开放平台应恢复独立默认配置')

const currentCatalog = migrateProviderSettings({
  providerCatalogVersion: PROVIDER_CATALOG_VERSION,
  provider: 'deepseek',
  model: 'my-only-model',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  modelLists: { deepseek: ['my-only-model'] }
})
ok(currentCatalog.modelLists.deepseek.join(',') === 'my-only-model', '当前目录版本应尊重用户删除官方型号的结果')

const repairedFixedCatalog = migrateProviderSettings({
  providerCatalogVersion: 3,
  provider: 'kimi-code',
  model: 'Kimi K3',
  baseUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'code-key',
  modelLists: { 'kimi-code': ['Kimi K3'] },
  saved: [{ id: 9, provider: 'kimi-code', model: 'K2.7 Code', baseUrl: 'https://api.kimi.com/coding/v1', apiKey: 'code-key', name: '旧错误配置' }]
})
ok(repairedFixedCatalog.model === 'kimi-for-coding', 'Kimi Code 非法展示名应回退到官方默认 Model ID')
ok(repairedFixedCatalog.modelLists['kimi-code'].join(',') === 'kimi-for-coding,kimi-for-coding-highspeed,k3', 'Kimi Code 固定目录不得被旧自定义列表覆盖')
ok(repairedFixedCatalog.saved[0].model === 'kimi-for-coding', '已保存的无效 Kimi Code 型号也应修复，避免再次加载失败')

const migratedClaude = migrateProviderSettings({
  providerCatalogVersion: 3,
  provider: 'claude',
  model: 'claude-sonnet-4',
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'claude-key',
  saved: [{ id: 10, provider: 'claude', model: 'claude-opus-4', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'claude-key', name: 'Claude 旧配置' }]
})
ok(migratedClaude.model === 'claude-sonnet-4-6', 'Claude 旧默认模型应迁移到当前官方 ID')
ok(migratedClaude.saved[0].model === 'claude-opus-4-8', '已保存的 Claude 旧模型也应迁移')
ok(migratedClaude.modelLists.claude.slice(0, 3).join(',') === 'claude-sonnet-4-6,claude-opus-4-8,claude-haiku-4-5', 'Claude 目录应优先当前官方模型')

console.log('provider settings migration tests passed')
