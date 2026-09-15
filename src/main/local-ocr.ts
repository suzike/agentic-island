/**
 * 本地离线 OCR：调用 **Windows 自带的 OCR 引擎**（`Windows.Media.Ocr`，WinRT）。
 *
 * 为什么走这条路而不是引入 tesseract.js 之类：① 不新增依赖、不下载模型；② 系统引擎已经带中文
 * （本机实测引擎语言 `zh-Hans-CN`）且离线可用；③ 截图内容本来就在这台机器上，不往外发。
 *
 * 实现上唯一麻烦的是 WinRT 的异步 API 在 PowerShell 里没有 await，得靠 `AsTask` 桥接再 `Wait`。
 * 这段样板必须一字不差（少一个 `.GetAwaiter()`/泛型参数就报找不到方法），所以整段写成常量。
 * 失败一律返回错误字符串，由渲染层决定是否退回云端视觉模型——静默失败是最糟的选项。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  // 注意：PowerShell 双引号里的反引号是转义符，"IAsyncOperation`1" 会被吃成 IAsyncOperation1，
  // 于是筛不到任何方法（报"无法对 Null 数组进行索引"）。这个类型名必须用单引号包。
  "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
  "$engineType = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]",
  'function AwaitW($op, $type) { $m = $asTaskGeneric.MakeGenericMethod($type); $t = $m.Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }',
  '[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null',
  '[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null',
  '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
  'if (-not $engine) { Write-Output "AGENTIC_OCR_NO_ENGINE"; exit 0 }',
  '$file = AwaitW ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:AGENTIC_OCR_IMAGE)) ([Windows.Storage.StorageFile])',
  '$stream = AwaitW ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
  '$decoder = AwaitW ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
  '$bitmap = AwaitW ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
  '$result = AwaitW ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
  '$lines = @($result.Lines | ForEach-Object { $_.Text })',
  'Write-Output ("AGENTIC_OCR_LANG=" + $engine.RecognizerLanguage.LanguageTag)',
  'Write-Output "AGENTIC_OCR_TEXT_BEGIN"',
  '$lines | ForEach-Object { Write-Output $_ }'
].join(String.fromCharCode(10))

export interface LocalOcrResult {
  ok: boolean
  text?: string
  language?: string
  error?: string
}

/**
 * 识别一张图片里的文字（仅 Windows）。`dataUrl` 会先落到临时文件——WinRT 只接受文件路径。
 */
export async function recognizeTextLocal(dataUrl: string): Promise<LocalOcrResult> {
  if (process.platform !== 'win32') return { ok: false, error: '本地 OCR 目前只在 Windows 上可用' }
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:image/') || comma < 0) return { ok: false, error: '图片数据无效' }
  const directory = await mkdtemp(join(tmpdir(), 'agentic-island-ocr-'))
  const imagePath = join(directory, 'shot.png')
  try {
    await writeFile(imagePath, Buffer.from(dataUrl.slice(comma + 1), 'base64'))
    const output = await runPowerShell(SCRIPT, imagePath)
    if (/AGENTIC_OCR_NO_ENGINE/.test(output)) return { ok: false, error: '系统没有可用的 OCR 语言包（可在「设置 → 时间和语言 → 语言」里安装）' }
    const language = /AGENTIC_OCR_LANG=(.+)/.exec(output)?.[1]?.trim()
    const marker = output.indexOf('AGENTIC_OCR_TEXT_BEGIN')
    if (marker < 0) {
      // 把脚本自己的输出带回来：不然"没返回结果"没法查（WinRT 的报错信息只会出现在 stderr 里）
      const detail = output.replace(/\s+/g, ' ').trim().slice(0, 300)
      return { ok: false, error: detail ? `系统 OCR 没有返回结果：${detail}` : '系统 OCR 没有返回结果（脚本无任何输出）' }
    }
    const text = output.slice(marker + 'AGENTIC_OCR_TEXT_BEGIN'.length).replace(/^[\r\n]+/, '').trim()
    if (!text) return { ok: false, error: '这张图里没有识别到文字' }
    return { ok: true, text, language }
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

/** 跑一段 PowerShell 并把 stdout 收回来（stderr 一并收，便于把失败原因带给用户）。 */
function runPowerShell(script: string, imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      env: { ...process.env, AGENTIC_OCR_IMAGE: imagePath }
    })
    let output = ''
    let settled = false
    // 30 秒足够：实测 900×200 的小图不到 1 秒，超大图也不至于卡死界面
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* 已退出 */ }
      reject(new Error('本地 OCR 超时'))
    }, 30_000)
    const collect = (chunk: Buffer): void => { output = (output + String(chunk)).slice(-200_000) }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error) } })
    child.once('close', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(output) } })
  })
}
