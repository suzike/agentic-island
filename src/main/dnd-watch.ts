// 会议检测：轮询 Windows「能力访问」注册表，判断麦克风/摄像头是否正被占用（≈正在通话/会议）。
// LastUsedTimeStop == 0 表示当前仍在使用。命中即认为处于会议中，供"智能勿扰"自动静默。

import { spawn } from 'child_process'

const POLL_MS = 15000

// 遍历 microphone / webcam 的 ConsentStore（含 NonPackaged），任一 app 的 LastUsedTimeStop==0 即在用
const PS_SCRIPT =
  "$r=$false; foreach($c in 'microphone','webcam'){ $b=\"HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$c\"; " +
  "foreach($p in @($b, \"$b\\NonPackaged\")){ if(Test-Path $p){ Get-ChildItem $p -EA SilentlyContinue | ForEach-Object { " +
  "$v=(Get-ItemProperty $_.PsPath -EA SilentlyContinue).LastUsedTimeStop; if($v -ne $null -and $v -eq 0){ $r=$true } } } } }; " +
  "if($r){'1'}else{'0'}"

/** 开始监听会议态；active 变化时回调。返回停止函数。 */
export function startDndWatch(onChange: (active: boolean) => void): () => void {
  let last = false
  let dead = false
  let timer: NodeJS.Timeout | undefined

  const poll = (): void => {
    if (dead) return
    let out = ''
    try {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { windowsHide: true })
      ps.stdout.on('data', (d) => { out += String(d) })
      ps.on('close', () => {
        const active = out.trim().startsWith('1')
        if (active !== last) { last = active; onChange(active) }
        if (!dead) timer = setTimeout(poll, POLL_MS)
      })
      ps.on('error', () => { if (!dead) timer = setTimeout(poll, POLL_MS * 2) })
    } catch {
      if (!dead) timer = setTimeout(poll, POLL_MS * 2)
    }
  }
  poll()
  return () => { dead = true; if (timer) clearTimeout(timer) }
}
