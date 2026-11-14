import assert from 'node:assert/strict'
import { createTemplate, downscaleFrame, grayscaleFrame, trackTemplate } from '../src/renderer/src/logic/object-tracker.ts'

const makeFrame = (width: number, height: number, box: { x: number; y: number; size: number }): { width: number; height: number; data: Uint8ClampedArray } => {
  const data = new Uint8ClampedArray(width * height)
  for (let y = box.y; y < box.y + box.size; y += 1) {
    for (let x = box.x; x < box.x + box.size; x += 1) data[y * width + x] = 255
  }
  return { width, height, data }
}

// 1. RGBA → 灰度
const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
const gray = grayscaleFrame(rgba, 2, 2)
assert.equal(gray.data.length, 4, '灰度帧尺寸正确')
assert.ok(gray.data[0] > gray.data[2], '红色比蓝色灰度更高')
assert.equal(gray.data[3], 255, '白色为 255')

// 2. 缩放下采样
const big = makeFrame(320, 200, { x: 40, y: 40, size: 80 })
const small = downscaleFrame(big, 160)
assert.equal(small.width, 160, '缩放到目标宽度')
assert.equal(small.height, 100, '保持比例')

// 3. 模板跟踪：方块从 (40,40) 移到 (60,55)
const first = makeFrame(200, 120, { x: 40, y: 40, size: 40 })
const second = makeFrame(200, 120, { x: 60, y: 55, size: 40 })
const template = createTemplate(first, { x: 40, y: 40, w: 40, h: 40 })
assert.ok(template, '能创建模板')
const tracked = trackTemplate(second, template!, { x: 40, y: 40, w: 40, h: 40 }, { radius: 30, step: 2 })
assert.ok(Math.abs(tracked.rect.x - 60) <= 2 && Math.abs(tracked.rect.y - 55) <= 2, `跟踪到新位置（实际 ${tracked.rect.x},${tracked.rect.y}）`)
assert.ok(tracked.confidence > 0.5, `匹配置信度足够（实际 ${tracked.confidence.toFixed(2)}）`)

// 4. 目标消失：低置信度时冻结在最后位置
const empty = { width: 200, height: 120, data: new Uint8ClampedArray(200 * 120) }
const lost = trackTemplate(empty, template!, { x: 60, y: 55, w: 40, h: 40 }, { radius: 30, step: 2 })
assert.deepEqual(lost.rect, { x: 60, y: 55, w: 40, h: 40 }, '跟丢时冻结，不乱跳')
assert.ok(lost.confidence < 0.35, '跟丢时置信度低')

console.log('object tracker tests passed')
