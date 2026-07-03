// 系统正在播放的媒体（网易云音乐/Spotify/浏览器等均可）：
// - 信息：Windows SMTC（系统媒体传输控制），PowerShell WinRT 查询 标题/歌手/播放态/封面缩略图。
// - 控制：合成系统媒体键（上一曲/播放暂停/下一曲/音量±），对任何注册了媒体会话的播放器生效。
// 如实局限：歌词拿不到（SMTC 不提供；网易云歌词需其非官方 API+登录，不做）。

import { execFile } from 'child_process'

export interface MediaInfo {
  title: string
  artist: string
  playing: boolean
  /** 封面 JPEG base64（可能为空） */
  thumb: string
}

const INFO_PS = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function Await($t, $rt) { $at = $asTaskGeneric.MakeGenericMethod($rt); $nt = $at.Invoke($null, @($t)); $nt.Wait(-1) | Out-Null; $nt.Result }
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  # 枚举全部会话，优先正在播放的（GetCurrentSession 可能指向别的应用）
  $s = $null
  foreach ($cand in $mgr.GetSessions()) {
    if ($cand.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $s = $cand; break }
  }
  if (-not $s) { $s = $mgr.GetCurrentSession() }
  if (-not $s) {
    # 网易云 PC 版不注册 SMTC（实测会话数=0）——退化为进程检测，曲目信息该版本拿不到（如实）
    $ncm = Get-Process cloudmusic -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ncm) { @{ title = '网易云音乐'; artist = '播放中（该客户端不提供曲目信息，控制键可用）'; playing = $true; thumb = '' } | ConvertTo-Json -Compress; exit }
    Write-Output '{}'; exit
  }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $playing = ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing')
  $thumb = ''
  try {
    if ($p.Thumbnail) {
      $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
      if ($stream.Size -gt 0 -and $stream.Size -lt 500000) {
        $reader = New-Object Windows.Storage.Streams.DataReader($stream)
        Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
        $bytes = New-Object byte[] $stream.Size
        $reader.ReadBytes($bytes)
        $thumb = [Convert]::ToBase64String($bytes)
      }
    }
  } catch {}
  @{ title = "$($p.Title)"; artist = "$($p.Artist)"; playing = $playing; thumb = $thumb } | ConvertTo-Json -Compress
} catch { Write-Output '{}' }
`

export function getMediaInfo(): Promise<MediaInfo | null> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', INFO_PS], { windowsHide: true, timeout: 8000, maxBuffer: 2_000_000 }, (_err, stdout) => {
      try {
        const j = JSON.parse((stdout || '{}').toString().trim() || '{}') as Partial<MediaInfo>
        if (!j.title) { resolve(null); return }
        resolve({ title: String(j.title), artist: String(j.artist || ''), playing: !!j.playing, thumb: String(j.thumb || '') })
      } catch {
        resolve(null)
      }
    })
  })
}

const KEYS: Record<string, number> = {
  playpause: 0xb3,
  next: 0xb0,
  prev: 0xb1,
  volup: 0xaf,
  voldown: 0xae
}

/** 合成媒体键（对系统当前媒体会话生效） */
export function mediaKey(cmd: string): void {
  const vk = KEYS[cmd]
  if (!vk) return
  const ps = `
Add-Type @"
using System;using System.Runtime.InteropServices;
public class MK { [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); }
"@
[MK]::keybd_event(${vk},0,0,[UIntPtr]::Zero); [MK]::keybd_event(${vk},0,2,[UIntPtr]::Zero)`
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 5000 }, () => {})
}
