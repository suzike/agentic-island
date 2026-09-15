import { clampRect, dataUrlBytes, dragRect, exportDimensions, formatBytes, formatExtension, sanitizeScreenshotName, rulerTicks, screenshotLoupeRect, screenshotPixelHex, snipRegionToPixels, textCardLayout } from '../src/renderer/src/logic/screenshot.ts'

let failed = 0
function check(ok: boolean, label: string): void {
  if (ok) console.log(`OK ${label}`)
  else { failed++; console.error(`FAIL ${label}`) }
}

check(JSON.stringify(dragRect({ x: 80, y: 90 }, { x: 20, y: 30 })) === JSON.stringify({ x: 20, y: 30, w: 60, h: 60 }), '反向拖动生成稳定矩形')
check(JSON.stringify(clampRect({ x: -10, y: 20, w: 120, h: 100 }, 80, 70)) === JSON.stringify({ x: 0, y: 20, w: 80, h: 50 }), '裁剪矩形限制在图像内')
check(dataUrlBytes('data:image/png;base64,SGVsbG8=') === 5, 'data URL 字节数计算')
check(formatBytes(1536) === '1.5 KB' && formatBytes(2 * 1024 * 1024) === '2.0 MB', '文件体积格式化')
check(JSON.stringify(exportDimensions(1920, 1080, 2)) === JSON.stringify({ width: 3840, height: 2160, pixels: 8294400 }), '导出尺寸计算')
check(formatExtension('jpeg') === 'jpg' && formatExtension('webp') === 'webp', '格式扩展名映射')
check(sanitizeScreenshotName(' 错误:日志?.png ') === '错误-日志-.png', '文件名清理')

// 取色器：十六进制格式化与钳制
check(screenshotPixelHex(0, 0, 0) === '#000000', '黑色十六进制')
check(screenshotPixelHex(255, 255, 255) === '#FFFFFF', '白色十六进制（大写）')
check(screenshotPixelHex(18, 52, 86) === '#123456', '中段补零')
check(screenshotPixelHex(-5, 300, 12.6) === '#00FF0D', '越界通道钳到 0-255 并四舍五入')

// 放大镜取景框：居中标出光标所在格子
const center = screenshotLoupeRect(500, 400, 1920, 1080, 15)
check(center.size === 15 && center.x === 493 && center.y === 393, '放大镜居中取景')
check(center.markerX === 7 && center.markerY === 7, '光标落在正中间那一格')
// 边角：窗口整体内移而不是裁掉内容，且标记仍在窗口内
const topLeft = screenshotLoupeRect(0, 0, 1920, 1080, 15)
check(topLeft.x === 0 && topLeft.y === 0 && topLeft.markerX === 0 && topLeft.markerY === 0, '左上角：窗口贴边、标记在第一格')
const bottomRight = screenshotLoupeRect(1919, 1079, 1920, 1080, 15)
check(bottomRight.x === 1920 - 15 && bottomRight.y === 1080 - 15, '右下角：窗口内移贴边')
check(bottomRight.markerX === 14 && bottomRight.markerY === 14, '右下角标记在最后一格')
// 奇数网格 & 退化输入
check(screenshotLoupeRect(10, 10, 1920, 1080, 16).size === 17, '偶数网格取最近的奇数（保证有正中格）')
check(screenshotLoupeRect(10, 10, 8, 8, 15).x === 0 && screenshotLoupeRect(10, 10, 8, 8, 15).size === 15, '网格大于图时不产生负坐标')

// 框选区域 DIP → 物理像素（本机 150% 缩放：DIP 1707x1067 → 物理 2560x1600）
check(JSON.stringify(snipRegionToPixels({ x: 100, y: 100, width: 200, height: 100 }, 1.5, 2560, 1600)) === JSON.stringify({ x: 150, y: 150, width: 300, height: 150 }), '150% 缩放下按比例换算')
check(JSON.stringify(snipRegionToPixels({ x: 10, y: 20, width: 30, height: 40 }, 1, 800, 600)) === JSON.stringify({ x: 10, y: 20, width: 30, height: 40 }), '100% 缩放原样输出')
// 越界钳制：拖到屏幕外时按画面范围裁，不产生负数或超出尺寸
check(JSON.stringify(snipRegionToPixels({ x: -50, y: -50, width: 100, height: 100 }, 1, 800, 600)) === JSON.stringify({ x: 0, y: 0, width: 50, height: 50 }), '越界负坐标钳到 0')
check(JSON.stringify(snipRegionToPixels({ x: 780, y: 580, width: 100, height: 100 }, 1, 800, 600)) === JSON.stringify({ x: 780, y: 580, width: 20, height: 20 }), '越界右下钳到画面边缘')
// 抖动/误触：太小或完全在画面外返回 null，交给调用方忽略
check(snipRegionToPixels({ x: 100, y: 100, width: 3, height: 3 }, 1, 800, 600) === null, '选区过小返回 null')
check(snipRegionToPixels({ x: 900, y: 700, width: 50, height: 50 }, 1, 800, 600) === null, '完全在画面外返回 null')
check(snipRegionToPixels({ x: 0, y: 0, width: 800, height: 600 }, 1.5, 2560, 1600) !== null, '整屏框选有效')
check(snipRegionToPixels({ x: 10, y: 10, width: 50, height: 50 }, Number.NaN, 800, 600) !== null, '非法缩放回落到 1 而不是产生 NaN')

// 文字卡片排版：用"每字符 10px"的假测量函数穷举边界（真实测量在浏览器里做）
const measure10 = (line: string) => line.length * 10
const card = textCardLayout(['第一行', '第二行'].join(String.fromCharCode(10)), { fontSize: 20, lineHeight: 1.5, padding: 20, maxLines: 10, maxWidth: 500 }, measure10)
check(card.lines.length === 2 && card.lines[0] === '第一行' && card.lines[1] === '第二行', '按显式换行分行')
check(card.width === Math.max(30, 30) + 40 && card.height === 2 * 30 + 40, `画布 = 最宽行 + 两侧内边距 / 行数 × 行高 + 上下内边距（实测 ${card.width}×${card.height}）`)
// 自动折行：宽度 100px（10 字符）时按空格折
const wrapped = textCardLayout('alpha beta gamma', { fontSize: 10, lineHeight: 1, padding: 0, maxLines: 10, maxWidth: 110 }, measure10)
check(wrapped.lines.join('|') === 'alpha beta|gamma', `按空格折行（实测 ${wrapped.lines.join('|')}）`)
// 超长单词：按字符硬切，绝不溢出
const longWord = textCardLayout('x'.repeat(45), { fontSize: 10, lineHeight: 1, padding: 0, maxLines: 10, maxWidth: 100 }, measure10)
check(longWord.lines.every((line) => line.length <= 10), `超长单词按字符切且不溢出（各行长度 ${longWord.lines.map((l) => l.length).join(',')}）`)
check(longWord.lines.join('') === 'x'.repeat(45), '硬切不丢字符')
// 空行保留（用户用空行分段）
check(textCardLayout(['a', '', 'b'].join(String.fromCharCode(10)), { fontSize: 10, lineHeight: 1, padding: 0, maxLines: 10, maxWidth: 100 }, measure10).lines.length === 3, '空行保留')
// 行数上限：超出要如实标记 truncated，而不是悄悄吞掉
const capped = textCardLayout(Array.from({ length: 40 }, () => 'line').join(String.fromCharCode(10)), { fontSize: 10, lineHeight: 1, padding: 0, maxLines: 5, maxWidth: 100 }, measure10)
check(capped.lines.length === 5 && capped.truncated, `超出上限时截断并标记（实测 ${capped.lines.length} 行，truncated=${capped.truncated}）`)
// 参数钳制：极小/极大字号与内边距都要落到合法区间
const clamped = textCardLayout('x', { fontSize: 0, lineHeight: 0, padding: -50, maxLines: 0, maxWidth: 0 }, measure10)
check(clamped.width >= 2 && clamped.height >= 2 && clamped.lines.length >= 1, '退化参数不产生非法尺寸')

// 标尺刻度：步长吸附到 1/2/5/10 这类可读值
check(rulerTicks(500, 10).map((t) => t.at).join(',') === '0,10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210,220,230,240,250,260,270,280,290,300,310,320,330,340,350,360,370,380,390,400,410,420,430,440,450,460,470,480,490,500', '步长 10 逐格标注')
check(rulerTicks(1000, 130).length < rulerTicks(1000, 100).length, '步长更大时刻度更少')
check(rulerTicks(1000, 130).every((t) => t.at % 200 === 0), `130 吸附到 200（实测 ${rulerTicks(1000, 130).slice(0, 3).map((t) => t.at).join(',')}）`)
check(JSON.stringify(rulerTicks(0, 10)) === '[]', '长度 0 时没有刻度')
check(rulerTicks(10_000, 1).length <= 400, '刻度数量有上限（超长图不会画出上万条刻度线）')

if (failed) process.exitCode = 1
console.log(failed ? `\n${failed} screenshot checks failed` : '\nscreenshot checks passed')
