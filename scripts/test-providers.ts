import {
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

const kimi = switchProviderSettings(migrated, 'kimi')
ok(kimi.provider === 'kimi' && kimi.model === 'kimi-k2.6', '切换 Kimi 应恢复其模型')
ok(kimi.apiKey === 'kimi-key', '切换 Kimi 不得沿用 DeepSeek 密钥')
const editedKimi = patchProviderDraft(kimi, { apiKey: 'kimi-key-new', model: 'kimi-k2.5' })
const deepseek = switchProviderSettings(editedKimi, 'deepseek')
ok(deepseek.apiKey === 'deep-key', '切回 DeepSeek 应恢复 DeepSeek 密钥')
ok(deepseek.profiles.kimi.apiKey === 'kimi-key-new' && deepseek.profiles.kimi.model === 'kimi-k2.5', 'Kimi 未手动保存的草稿也应跨切换保留')

const currentCatalog = migrateProviderSettings({
  providerCatalogVersion: PROVIDER_CATALOG_VERSION,
  provider: 'deepseek',
  model: 'my-only-model',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  modelLists: { deepseek: ['my-only-model'] }
})
ok(currentCatalog.modelLists.deepseek.join(',') === 'my-only-model', '当前目录版本应尊重用户删除官方型号的结果')

console.log('provider settings migration tests passed')
