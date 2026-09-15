// 滚动截图拼接引擎的离线测试：用"合成一张长图再切片"的方式造出已知答案，验证拼接真的还原了原图。
// 跑法：node --experimental-strip-types scripts/test-scroll-capture.ts
import { findScrollAdvance, stitchScrollFrames, type ScrollFrame } from '../src/renderer/src/logic/scroll-capture.ts'

let failed = 0
function check(ok: boolean, label: string): void {
  if (ok) console.log(`OK ${label}`)
  else { failed++; console.error(`FAIL ${label}`) }
}

const WIDTH = 240

/**
 * 造一张"高图"当已知答案。
 *
 * 每行必须带**行号相关的高频细节**：只画平滑渐变的话，相邻两行降采样成 8 位灰度后完全相同，
 * 位移就无从分辨（第一版测试图就是这样，导致 260px 的位移被测成 259）。真实网页到处是文字和分隔线，
 * 这里用"行号哈希 + 每 37 行一条重复亮带"来同时提供唯一性与干扰项。
 */
function tallImage(height: number): ScrollFrame {
  const data = new Uint8ClampedArray(WIDTH * height * 4)
  for (let y = 0; y < height; y += 1) {
    const base = (y * 255 / height) | 0
    const stripe = y % 37 === 0 ? 120 : 0
    for (let x = 0; x < WIDTH; x += 1) {
      // 行号相关的伪随机纹理：相邻行差异明显，且同一行内也有细节
      const hash = ((y * 2654435761) ^ (x * 40503)) >>> 0
      const noise = (hash % 64) - 32
      const at = (y * WIDTH + x) * 4
      data[at] = Math.max(0, Math.min(255, base + stripe + noise + (x % 7) * 3))
      data[at + 1] = Math.max(0, Math.min(255, base + stripe + noise))
      data[at + 2] = Math.max(0, Math.min(255, base + stripe + noise + (x % 5) * 4))
      data[at + 3] = 255
    }
  }
  return { data, width: WIDTH, height }
}

/** 从长图里按"视口 + 滚动位置"切一帧出来。 */
function viewportAt(source: ScrollFrame, top: number, viewHeight: number): ScrollFrame {
  const data = source.data.slice(top * WIDTH * 4, (top + viewHeight) * WIDTH * 4)
  return { data, width: WIDTH, height: viewHeight }
}

const compare = (a: ScrollFrame, b: ScrollFrame, from: number, rows: number): number => {
  let worst = 0
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const ia = ((from + y) * WIDTH + x) * 4
      const ib = (y * WIDTH + x) * 4
      worst = Math.max(worst, Math.abs(a.data[ia] - b.data[ib]), Math.abs(a.data[ia + 1] - b.data[ib + 1]), Math.abs(a.data[ia + 2] - b.data[ib + 2]))
    }
  }
  return worst
}

const source = tallImage(3000)
const viewHeight = 600

// ── 位移检测：已知滚动了多少像素，必须原样测出来 ──
for (const scroll of [40, 137, 260, 480]) {
  const prev = viewportAt(source, 0, viewHeight)
  const next = viewportAt(source, scroll, viewHeight)
  const { advance, confidence } = findScrollAdvance(prev, next)
  check(advance === scroll, `滚动 ${scroll}px 被准确测出（实测 ${advance}，置信度 ${confidence.toFixed(2)}）`)
}
// 没动过：新增 0 行
check(findScrollAdvance(viewportAt(source, 200, viewHeight), viewportAt(source, 200, viewHeight)).advance === 0, '画面没动时新增 0 行')
// 向上滚（负位移）当作没有新内容
check(findScrollAdvance(viewportAt(source, 400, viewHeight), viewportAt(source, 300, viewHeight)).advance === 0, '向上滚不产生新增行')
// 完全不同的内容：不给出错误位移
const noise: ScrollFrame = { data: new Uint8ClampedArray(WIDTH * viewHeight * 4).fill(255), width: WIDTH, height: viewHeight }
check(findScrollAdvance(viewportAt(source, 0, viewHeight), noise).advance === 0, '内容完全不同时宁可报 0 也不乱拼')

// ── 整体拼接：按 260px 的步长滚到底，拼出来的长图必须与原图逐像素一致 ──
const frames: ScrollFrame[] = []
for (let top = 0; top + viewHeight <= source.height; top += 260) frames.push(viewportAt(source, top, viewHeight))
const stitched = stitchScrollFrames(frames)
check(Boolean(stitched), '拼接应产出结果')
if (stitched) {
  const expectedHeight = viewHeight + (frames.length - 1) * 260
  check(stitched!.height === expectedHeight, `长图高度 = 视口 + 步长 × 段数（实测 ${stitched!.height}，期望 ${expectedHeight}）`)
  check(stitched!.width === WIDTH, '宽度不变')
  const diff = compare(source, { data: stitched!.data, width: stitched!.width, height: stitched!.height }, 0, stitched!.height)
  check(diff === 0, `拼接结果与原图逐像素一致（最大通道差 ${diff}）`)
  check(stitched!.skipped === 0, '没有跳过任何一段')
  check(stitched!.advances.every((value) => value === 260), '每段的新增行数都等于步长')
}

// ── 重复滚动（用户停下来又滚回去一点）：不该把重复内容拼进去 ──
const jittery = [viewportAt(source, 0, viewHeight), viewportAt(source, 0, viewHeight), viewportAt(source, 300, viewHeight), viewportAt(source, 260, viewHeight), viewportAt(source, 560, viewHeight)]
const jittered = stitchScrollFrames(jittery)
check(jittered?.height === viewHeight + 300 + 300, `重复/回滚的帧不会重复拼接（实测高度 ${jittered?.height}）`)

// ── 跨屏大跳跃：如实计 skipped，而不是硬拼出一张错位长图 ──
const jumped = stitchScrollFrames([viewportAt(source, 0, viewHeight), viewportAt(source, 1500, viewHeight)])
check(Boolean(jumped) && jumped!.skipped === 1 && jumped!.height === viewHeight, `无重叠的大跳跃被如实跳过（skipped=${jumped?.skipped}，高度 ${jumped?.height}）`)

// ── 上限与退化输入 ──
check(stitchScrollFrames([]) === null, '没有帧时返回 null')
check(stitchScrollFrames([{ data: new Uint8ClampedArray(8), width: 2, height: 2 }]) === null, '数据长度不足的帧被丢弃')
const capped = stitchScrollFrames(frames, { maxHeight: 900 })
check(capped !== null && capped!.height <= 900, `长度上限生效（实测 ${capped?.height}）`)
const single = stitchScrollFrames([viewportAt(source, 0, viewHeight)])
check(single?.height === viewHeight && single?.advances.length === 0, '只有一帧时原样返回')

if (failed) process.exitCode = 1
console.log(failed ? `\n${failed} scroll capture checks failed` : '\nscroll capture checks passed')
