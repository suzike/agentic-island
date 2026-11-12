// 会议检测：轮询 Windows「能力访问」注册表，判断麦克风/摄像头是否正被占用（≈正在通话/会议）。
// LastUsedTimeStop == 0 表示当前仍在使用。
//
// 语音输入法也会占用麦克风，不能等同于开会。这里只忽略明确属于输入法/语音转写的进程；
// 微信输入法、豆包输入法、Windows 语音输入以及岛自己的录屏都不应触发"会议结束"提醒。

import { spawn } from 'child_process'

const POLL_MS = 15000

// 遍历 microphone / webcam 的 ConsentStore（含 NonPackaged），输出 "类型|应用键" 一行一个
const PS_SCRIPT =
  "foreach($c in 'microphone','webcam'){ $b=\"HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$c\"; " +
  "foreach($p in @($b, \"$b\\NonPackaged\")){ if(Test-Path $p){ Get-ChildItem $p -EA SilentlyContinue | ForEach-Object { " +
  "$v=(Get-ItemProperty $_.PsPath -EA SilentlyContinue).LastUsedTimeStop; if($v -ne $null -and $v -eq 0){ \"$c|$($_.PSChildName)\" } } } } }"

const DICTATION_MIC = /wetype|doubaoime|ime_service|imeservice|textinputhost|inputapp|voiceaccess|speechruntime|sogou.*(?:ime|cloud)|qqpinyin|baidu.*ime/i
const OWN_APP = /agentic-island/i

/** 某个 Windows 能力占用是否真的像会议（麦克风输入法不算、岛自己的录音/录屏不算）。 */
export function isMeetingCapabilityUse(kind: 'microphone' | 'webcam', key: string): boolean {
  if (OWN_APP.test(key)) return false
  if (kind === 'webcam') return true
  return !DICTATION_MIC.test(key)
}

/** 需要连续占用一段时间才进入会议态，过滤语音输入/短暂占用。 */
const MEETING_CONFIRM_MS = 20_000

/** 开始监听会议态；active 变化时回调。返回停止函数。 */
export function startDndWatch(onChange: (active: boolean) => void): () => void {
  let last = false
  let dead = false
  let timer: NodeJS.Timeout | undefined
  let activeSince = 0

  const setActive = (active: boolean): void => {
    if (active === last) return
    last = active
    onChange(active)
  }

  const poll = (): void => {
    if (dead) return
    let out = ''
    // 一次 spawn 挂起即永久停摆 + 僵尸 powershell 进程：超时强杀并按降频续链
    let killer: NodeJS.Timeout | undefined
    let settled = false
    const proceed = (delay: number): void => {
      if (settled || dead) return
      settled = true
      if (killer) clearTimeout(killer)
      timer = setTimeout(poll, delay)
    }
    try {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { windowsHide: true })
      killer = setTimeout(() => {
        try { ps.kill() } catch { /* */ }
        proceed(POLL_MS * 2)
      }, 10000)
      ps.stdout.on('data', (d) => { out += String(d) })
      ps.on('close', () => {
        const now = Date.now()
        const rawActive = out.split(/\r?\n/).some((line) => {
          const value = line.trim()
          if (!value.includes('|')) return false
          const [kind, ...rest] = value.split('|')
          if (kind !== 'microphone' && kind !== 'webcam') return false
          return isMeetingCapabilityUse(kind, rest.join('|'))
        })
        if (!rawActive) {
          activeSince = 0
          setActive(false)
        } else {
          if (!activeSince) activeSince = now
          if (!last && now - activeSince >= MEETING_CONFIRM_MS) setActive(true)
        }
        proceed(POLL_MS)
      })
      ps.on('error', () => proceed(POLL_MS * 2))
    } catch {
      proceed(POLL_MS * 2)
    }
  }
  poll()
  return () => { dead = true; if (timer) clearTimeout(timer) }
}
