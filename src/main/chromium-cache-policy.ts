/**
 * 跨版本可安全清理的 Chromium 目录。
 *
 * 只放纯缓存。`Local State` 保存 safeStorage/OSCrypt 的 DPAPI 密钥，
 * `Preferences` 保存 Chromium 自身设置；两者一旦删除，此前加密的
 * config.json 将永久无法解密（0.7.0/0.7.1 的升级清理曾因此丢失用户数据）。
 */
export const CHROMIUM_CACHE_DIRS = [
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Code Cache',
  'Cache',
  'Dictionaries',
  'Shared Dictionary'
] as const

/** 必须随版本保留的 profile 文件（加密密钥与 Chromium 设置）。 */
export const CHROMIUM_PROFILE_KEEP = ['Local State', 'Preferences'] as const
