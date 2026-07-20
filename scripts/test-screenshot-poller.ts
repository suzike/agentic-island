import assert from 'node:assert/strict'
import { createScreenshotPoller } from '../src/main/screenshot-poller.ts'

let clipboard = 'old'
const captures: string[] = []
let timeouts = 0
const poller = createScreenshotPoller({
  readImage: () => clipboard,
  onCapture: (url) => captures.push(url),
  onTimeout: () => { timeouts++ }
}, 5, 4)

poller.start('old')
poller.start('new-baseline')
clipboard = 'new-capture'
await new Promise((resolve) => setTimeout(resolve, 15))
assert.deepEqual(captures, ['new-capture'], '重复触发应替换旧轮询并接收新截图')
assert.equal(poller.isActive(), false, '捕获完成后必须释放轮询')

clipboard = 'same'
poller.start('same')
await new Promise((resolve) => setTimeout(resolve, 60))
assert.equal(timeouts, 1, '无新截图时应按上限结束')
assert.equal(poller.isActive(), false, '超时后必须释放轮询')

poller.start('same')
poller.stop()
clipboard = 'late'
await new Promise((resolve) => setTimeout(resolve, 10))
assert.deepEqual(captures, ['new-capture'], '手动停止后不得回调旧截图')

console.log('screenshot poller tests passed')
