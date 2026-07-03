// 终端跳转（Windows）：从 CLI 进程 PID 出发，沿父进程链找到终端窗口并带到前台。
// 在"跳转"时按需执行一次 PowerShell（不在每个事件里跑，避免拖慢推送）。
// 找不到则回退按标题匹配；都失败返回 false，由上层给出诚实反馈。

import { execFile } from 'child_process'

const TERMINAL_NAMES = "@('WindowsTerminal','pwsh','powershell','cmd','conhost','wt','ConEmu64','ConEmu','alacritty','Hyper','wezterm-gui','wezterm','Code')"

const WIN32 = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WJ {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
}
"@`

const focus = (hwndExpr: string): string => `
if ($h -ne 0) {
  $ptr = [IntPtr]$h
  if ([WJ]::IsIconic($ptr)) { [WJ]::ShowWindowAsync($ptr, 9) | Out-Null } else { [WJ]::ShowWindowAsync($ptr, 5) | Out-Null }
  [WJ]::SetForegroundWindow($ptr) | Out-Null
  Write-Output 'ok'
} else { Write-Output 'none' }`

const run = (ps: string): Promise<boolean> =>
  new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 6000 }, (err, stdout) => {
      resolve(!err && stdout.toString().includes('ok'))
    })
  })

/** 首选：直接聚焦已捕获的终端窗口句柄（窗口存续期间一直有效，与进程无关） */
export function focusByHwnd(hwnd?: string): Promise<boolean> {
  if (!hwnd || !/^\d+$/.test(hwnd)) return Promise.resolve(false)
  const ps = `
$ErrorActionPreference='SilentlyContinue'
${WIN32}
$h = 0
$ptr = [IntPtr]${hwnd}
if ([WJ]::IsWindow($ptr)) { $h = ${hwnd} }
${focus('$h')}`
  return run(ps)
}

/** 次选：从 CLI 进程 PID 沿父链找到终端窗口句柄并聚焦 */
export function focusByPid(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(false)
  const ps = `
$ErrorActionPreference='SilentlyContinue'
${WIN32}
$terminals = ${TERMINAL_NAMES}
$cur = ${pid}
$h = 0
for ($i=0; $i -lt 12; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur"
  if (-not $p) { break }
  $name = $p.Name -replace '\\.exe$',''
  if ($terminals -contains $name) {
    $proc = Get-Process -Id $cur
    if ($proc -and $proc.MainWindowHandle -ne 0) { $h = [int64]$proc.MainWindowHandle; break }
  }
  if (-not $p.ParentProcessId) { break }
  $cur = [int]$p.ParentProcessId
}
${focus('$h')}`
  return run(ps)
}

/** 回退：按项目名匹配终端窗口标题 */
export function focusByTitle(proj: string): Promise<boolean> {
  if (!proj) return Promise.resolve(false)
  const ps = `
$ErrorActionPreference='SilentlyContinue'
${WIN32}
$terminals = ${TERMINAL_NAMES}
$proj='${proj.replace(/'/g, "''")}'
$m = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $terminals -contains $_.ProcessName -and $_.MainWindowTitle -like "*$proj*" } | Select-Object -First 1
$h = if ($m) { [int64]$m.MainWindowHandle } else { 0 }
${focus('$h')}`
  return run(ps)
}

/** 桌面端应用：按窗口标题匹配任意进程（Claude / Codex / ChatGPT 桌面端不在终端名单里），最小化则还原 */
export function focusAnyByTitle(title: string): Promise<boolean> {
  if (!title) return Promise.resolve(false)
  const ps = `
$ErrorActionPreference='SilentlyContinue'
${WIN32}
$t='${title.replace(/'/g, "''")}'
$m = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -like "*$t*" -or $_.ProcessName -like "*$t*") } | Select-Object -First 1
$h = if ($m) { [int64]$m.MainWindowHandle } else { 0 }
${focus('$h')}`
  return run(ps)
}

/** Windows Terminal 多标签精确切换：聚焦窗口后，用 UIAutomation 找标题匹配 hint 的 TabItem 并选中。
 *  非 WT 窗口 / 找不到匹配标签时静默失败（窗口已聚焦，算部分成功）。 */
export function selectWtTab(hwnd: string, hints: string[]): Promise<boolean> {
  if (!hwnd || !/^\d+$/.test(hwnd) || hints.length === 0) return Promise.resolve(false)
  const hintArr = hints
    .filter(Boolean)
    .map((h) => `'${h.replace(/'/g, "''")}'`)
    .join(',')
  const ps = `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${hwnd})
if ($root) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
  $tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if ($tabs.Count -gt 1) {
    foreach ($hint in @(${hintArr})) {
      foreach ($t in $tabs) {
        if ($t.Current.Name -like "*$hint*") {
          $p = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
          if ($p) { $p.Select(); Write-Output 'ok'; exit }
        }
      }
    }
  }
}
Write-Output 'none'`
  return run(ps)
}
