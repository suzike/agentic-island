import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createExternalYieldController } from '../src/main/external-yield.ts'

const calls: string[] = []
const controller = createExternalYieldController({
  collapse: () => calls.push('collapse'),
  blur: () => calls.push('blur'),
  setClickThrough: (ignore) => calls.push(`click:${ignore}`),
  setTopmost: (topmost) => calls.push(`top:${topmost}`)
}, 20)

controller.yieldWindow()
assert.deepEqual(calls, ['collapse', 'click:true', 'blur', 'top:false'])

await new Promise((resolve) => setTimeout(resolve, 35))
assert.equal(calls.at(-1), 'top:true')

calls.length = 0
controller.yieldWindow()
controller.yieldWindow()
await new Promise((resolve) => setTimeout(resolve, 35))
assert.equal(calls.filter((x) => x === 'top:true').length, 1, '连续外部操作只能保留一个恢复计时器')

calls.length = 0
const release = controller.suspendTopmost()
assert.equal(controller.isLowered(), true)
assert.deepEqual(calls, ['top:false'], '原生对话框只降低层级，不得收起面板或改变点击穿透')
controller.restore()
assert.equal(calls.includes('top:true'), false, '对话框仍打开时不得被其他恢复逻辑重新置顶')
release()
release()
assert.equal(calls.filter((x) => x === 'top:true').length, 1, '释放函数必须幂等')
assert.equal(controller.isLowered(), false)

calls.length = 0
const releaseFirst = controller.suspendTopmost()
const releaseSecond = controller.suspendTopmost()
releaseFirst()
assert.equal(calls.includes('top:true'), false, '嵌套对话框未全部关闭时不得恢复置顶')
releaseSecond()
assert.equal(calls.at(-1), 'top:true')

calls.length = 0
controller.yieldWindow()
controller.dispose()
await new Promise((resolve) => setTimeout(resolve, 35))
assert.equal(calls.includes('top:true'), false, '销毁后不得再操作窗口')

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
assert.equal((mainSource.match(/dialog\.show(?:Open|Save)Dialog/g) || []).length, 4, '原生文件对话框只能在两个统一包装器中调用')
assert.equal((mainSource.match(/showOwnedOpenDialog\(/g) || []).length, 5, 'Markdown、知识库与截图工坊的打开入口必须接入统一包装器')
assert.equal((mainSource.match(/showOwnedSaveDialog\(/g) || []).length, 6, 'Markdown、PDF、文本、录屏和图片保存入口必须接入统一包装器')
assert.equal((mainSource.match(/shell\.(?:openExternal|openPath)\(/g) || []).length, 2, '外部网页和路径只能在统一让位包装器中调用')
assert.match(mainSource, /function openScreenshot\([^)]*\): void \{[\s\S]*?yieldToExternalApp\(\)/, '系统截图界面打开前必须让位')
assert.match(mainSource, /const nextRelease = externalYield\?\.suspendTopmost\(\)/, '系统框选期间必须持续降低灵动岛层级')
assert.match(mainSource, /screenshotPoller\.stop\(\)[\s\S]*?screenshotPoller\.start\(baseline\)/, '重复截图必须替换旧轮询，不能静默返回')

console.log('external yield tests passed')
