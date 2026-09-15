/**
 * 滚动截图（长截图）的拼接引擎 —— 纯逻辑，不碰 DOM，可离线验证。
 *
 * 做法：用户在选区里自己滚动，我们按固定节奏抓帧，靠**行指纹**在上一帧里找到当前帧顶部那条带子的位置，
 * 从而算出"这一帧新增了多少行"，只把新增的行追加到长图上。
 *
 * 为什么用行指纹而不是逐像素比对：逐像素比对是 O(高度² × 宽度)，一帧就上千万次比较，跟不上抓帧节奏；
 * 每行降采样成几十个灰度值后，一帧只要十万量级比较，且对压缩噪点天然不敏感（截图是无损的，但缩放/亚像素滚动会带来微小差异）。
 *
 * 为什么要多条探测带：页面里常有重复纹理（表格行、代码行），单条带子可能匹配到错误的位置；
 * 要求多条带子给出**一致的位移**才采纳，这是把"看起来能拼"变成"敢拼"的关键。
 */

export interface ScrollFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface ScrollAdvanceResult {
  /** 相对上一帧**新增的像素行数**（0 表示这一帧没有新内容） */
  advance: number
  /** 多探针一致的比例（0..1）；低于阈值说明匹配不可信 */
  confidence: number
}

/** 把每行降采样成 `samples` 个灰度值，得到该帧的行指纹（长度 = 高度 × samples）。 */
export function scrollRowFingerprint(frame: ScrollFrame, samples = 24): Uint8Array {
  const count = Math.max(4, Math.min(64, Math.round(samples)))
  const width = Math.max(1, Math.floor(frame.width))
  const height = Math.max(1, Math.floor(frame.height))
  const fingerprints = new Uint8Array(height * count)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4
    for (let s = 0; s < count; s += 1) {
      const x = Math.min(width - 1, Math.floor((s + 0.5) * width / count))
      const at = rowStart + x * 4
      // 亮度近似（人眼权重），只取整数位就够——比对的目的是找位置，不是还原颜色
      fingerprints[y * count + s] = (frame.data[at] * 77 + frame.data[at + 1] * 150 + frame.data[at + 2] * 29) >> 8
    }
  }
  return fingerprints
}

/** 两条等长指纹的平均绝对差（0..255，越小越像）。 */
function fingerprintDistance(a: Uint8Array, aOffset: number, b: Uint8Array, bOffset: number, count: number): number {
  let sum = 0
  for (let i = 0; i < count; i += 1) sum += Math.abs(a[aOffset + i] - b[bOffset + i])
  return sum / count
}

/**
 * 求当前帧相对上一帧的位移（新增行数）。
 *
 * 原理：整体下滚 d 像素时 `next[y] === prev[y + d]`。取当前帧顶部的探测带，在上一帧里找它出现的位置，
 * 那个位置就是 d。多条探测带各自求 d，取众数并要求足够多的带子同意。
 */
export function findScrollAdvance(
  previous: ScrollFrame,
  next: ScrollFrame,
  options: { bandRows?: number; samples?: number; tolerance?: number; minConfidence?: number } = {}
): ScrollAdvanceResult {
  const samples = Math.max(4, Math.min(64, Math.round(options.samples ?? 24)))
  const bandRows = Math.max(3, Math.min(40, Math.round(options.bandRows ?? 10)))
  const tolerance = Math.max(1, options.tolerance ?? 6)
  const minConfidence = Math.max(0.1, Math.min(1, options.minConfidence ?? 0.6))
  const height = Math.max(1, Math.floor(Math.min(previous.height, next.height)))
  const guess = { advance: 0, confidence: 0 }
  if (height <= bandRows + 1 || previous.width !== next.width) return guess
  const prevPrint = scrollRowFingerprint({ ...previous, height }, samples)
  const nextPrint = scrollRowFingerprint({ ...next, height }, samples)
  const maxAdvance = height - bandRows
  // 探测带取上半部：位移大时只有靠上的带子仍落在两帧的重叠区里，
  // 把带子摊到下半部会让"滚了半屏以上"直接失去投票资格（实测大位移就是这样被判成 0 的）。
  const probes = [0, Math.floor(height / 8), Math.floor(height / 4)].filter((y) => y + bandRows < height)
  const votes: number[] = []
  for (const probeY of probes) {
    let bestY = -1
    let bestCost = Number.POSITIVE_INFINITY
    for (let y = 0; y <= maxAdvance; y += 1) {
      let cost = 0
      for (let row = 0; row < bandRows; row += 1) {
        cost += fingerprintDistance(nextPrint, (probeY + row) * samples, prevPrint, (y + row) * samples, samples)
        if (cost > bestCost) break
      }
      if (cost < bestCost) { bestCost = cost; bestY = y }
    }
    // 位移 d = 探测带在上一帧里的位置 − 探测带在当前帧里的位置……这里直接换算：
    // 当前帧的 probeY 行对应上一帧的 bestY 行 ⇒ 内容整体下滚了 bestY − probeY 行
    if (bestY >= 0 && bestCost <= tolerance) votes.push(bestY - probeY)
  }
  if (!votes.length) return guess
  // 取众数（允许 ±1 行抖动）
  let best = votes[0]
  let bestAgree = 0
  for (const candidate of votes) {
    const agree = votes.filter((vote) => Math.abs(vote - candidate) <= 1).length
    if (agree > bestAgree) { bestAgree = agree; best = candidate }
  }
  // 置信度按**参与投票的带子**算，而不是按全部探针：位移大到只剩一条带子在重叠区里时，
  // 那条带子的一致就是 100% 一致，不该因为"别的带子够不着"而把结果判成不可信。
  const confidence = bestAgree / votes.length
  if (confidence < minConfidence) return { advance: 0, confidence }
  // 负数（向上滚）当作"没有新内容"：长截图只往下拼
  return { advance: Math.max(0, Math.min(maxAdvance, best)), confidence }
}

export interface ScrollStitchResult {
  data: Uint8ClampedArray
  width: number
  height: number
  /** 每帧新增的行数，供 UI 显示进度 */
  advances: number[]
  /** 因为"滚太多，两帧之间没有重叠"而跳过的帧数（如实告知，不假装拼上了） */
  skipped: number
}

/**
 * 把多帧拼成一张长图。首帧整体作为底图，之后每帧只追加新增的底部若干行。
 * 单帧高度上限 `maxHeight`：超过就停止拼接（超长图在多数查看器里已经无意义，且内存要吃满）。
 */
export function stitchScrollFrames(frames: ScrollFrame[], options: { samples?: number; bandRows?: number; tolerance?: number; maxHeight?: number } = {}): ScrollStitchResult | null {
  const usable = frames.filter((frame) => frame && frame.width > 0 && frame.height > 0 && frame.data.length >= frame.width * frame.height * 4)
  if (!usable.length) return null
  const width = usable[0].width
  const frameHeight = usable[0].height
  const maxHeight = Math.max(frameHeight, Math.min(200_000, Math.round(options.maxHeight ?? 40_000)))
  const rowBytes = width * 4
  const advances: number[] = []
  let skipped = 0
  let totalHeight = Math.min(frameHeight, maxHeight)
  const chunks: Uint8ClampedArray[] = [usable[0].data.slice(0, totalHeight * rowBytes)]
  let previous = usable[0]
  for (let index = 1; index < usable.length; index += 1) {
    const frame = usable[index]
    if (frame.width !== width || frame.height !== frameHeight) continue
    const { advance, confidence } = findScrollAdvance(previous, frame, options)
    previous = frame
    advances.push(advance)
    if (advance <= 0) {
      // 位移 0 且置信度低 = 两帧之间**没有重叠**（滚太多或内容整体换了），如实计数：
      // 它和"匹配上了但没动"（置信度高）是两回事，后者才是"用户停下了"。
      if (confidence < 0.5) skipped += 1
      continue
    }
    if (totalHeight >= maxHeight) break
    const take = Math.min(advance, maxHeight - totalHeight)
    chunks.push(frame.data.slice((frameHeight - take) * rowBytes, frameHeight * rowBytes))
    totalHeight += take
  }
  const stitched = new Uint8ClampedArray(totalHeight * rowBytes)
  let offset = 0
  for (const chunk of chunks) { stitched.set(chunk, offset); offset += chunk.length }
  return { data: stitched, width, height: totalHeight, advances, skipped }
}
