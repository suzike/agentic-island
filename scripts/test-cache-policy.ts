import assert from 'node:assert/strict'
import { CHROMIUM_CACHE_DIRS, CHROMIUM_PROFILE_KEEP } from '../src/main/chromium-cache-policy.ts'

// 纯缓存可以清
for (const dir of ['GPUCache', 'Code Cache', 'Cache']) {
  assert.ok((CHROMIUM_CACHE_DIRS as readonly string[]).includes(dir), `${dir} 应可清理`)
}

// 密钥与 Chromium 设置绝不能进清理列表
for (const name of ['Local State', 'Preferences', 'Network', 'Session Storage', 'attachments']) {
  assert.ok(!(CHROMIUM_CACHE_DIRS as readonly string[]).includes(name), `${name} 不允许被清理`)
}
for (const name of ['Local State', 'Preferences']) {
  assert.ok((CHROMIUM_PROFILE_KEEP as readonly string[]).includes(name), `${name} 必须显式保留`)
}

console.log('chromium cache policy tests passed')
