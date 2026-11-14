import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { obsAuthString } from '../src/main/obs-virtual-camera.ts'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('base64')
const password = 'secret'
const salt = 'salt-123'
const challenge = 'challenge-456'
const expected = sha256(sha256(password + salt) + challenge)
assert.equal(obsAuthString(password, salt, challenge), expected, 'OBS v5 认证串与官方公式一致')
assert.notEqual(obsAuthString(password, salt, 'other'), expected, 'challenge 变化会改变认证串')
assert.notEqual(obsAuthString('wrong', salt, challenge), expected, '密码变化会改变认证串')
assert.match(expected, /^[A-Za-z0-9+/]{43}=$/, '认证串是 base64 SHA-256')
console.log('obs auth tests passed')
