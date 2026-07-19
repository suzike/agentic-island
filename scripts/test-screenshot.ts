import { clampRect, dataUrlBytes, dragRect, exportDimensions, formatBytes, formatExtension, sanitizeScreenshotName } from '../src/renderer/src/logic/screenshot.ts'

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

if (failed) process.exitCode = 1
console.log(failed ? `\n${failed} screenshot checks failed` : '\nscreenshot checks passed')
