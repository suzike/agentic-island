// 自动更新（electron-updater + GitHub Releases）：发布流水线已产出 latest.yml/blockmap，
// 这里补上消费端——启动后延迟静默检查 + 每 6h 轮询，发现新版本后台下载，
// 下载完成提示用户，确认后退出并安装；autoInstallOnAppQuit 兜底（用户直接关应用也会在退出时装上）。
// 未打包（dev）不启用；安装包未签名，签名校验由 build.win.verifyUpdateCodeSignature=false 关闭。

import { app, ipcMain } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import type { UpdateState } from '../shared/protocol'

let inited = false

export function initUpdater(send: (s: UpdateState) => void): void {
  if (inited || !app.isPackaged) return
  inited = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  let lastPercent = -1
  const push = (s: UpdateState): void => send(s)

  autoUpdater.on('checking-for-update', () => push({ status: 'checking' }))
  autoUpdater.on('update-available', (info: UpdateInfo) => push({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => push({ status: 'not-available' }))
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const percent = Math.floor(p.percent)
    if (percent === lastPercent) return
    lastPercent = percent
    push({ status: 'downloading', percent })
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => push({ status: 'downloaded', version: info.version }))
  autoUpdater.on('error', (e: Error) => {
    // 静默后台检查失败（断网/GitHub 不可达）很常见：只保留一句原因，不弹窗不打断
    push({ status: 'error', error: String(e.message || e).slice(0, 160) })
  })

  ipcMain.on('update-check', () => { void autoUpdater.checkForUpdates().catch(() => {}) })
  ipcMain.on('update-install', () => {
    if (autoUpdater.isUpdaterActive()) autoUpdater.quitAndInstall()
  })

  // 启动 30s 后首查（错开启动 IO 高峰），之后每 6h 轮询
  setTimeout(() => { void autoUpdater.checkForUpdates().catch(() => {}) }, 30_000).unref?.()
  const poll = setInterval(() => { void autoUpdater.checkForUpdates().catch(() => {}) }, 6 * 60 * 60_000)
  poll.unref?.()
}
