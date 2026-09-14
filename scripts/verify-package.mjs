import { spawn, spawnSync } from 'node:child_process'
import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const installer = join(root, 'dist', `Agentic-Island-Setup-${version}.exe`)
const unpackedExe = join(root, 'dist', 'win-unpacked', 'Agentic-Island.exe')
const tempRoot = await mkdtemp(join(tmpdir(), 'agentic-island-release-'))
const installDir = join(tempRoot, 'installed')

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

/* ---------------- 真实安装的保护 ----------------
 * 隔离安装（/D=<临时目录>）用的仍是同一个 appId，因此会**覆盖真实安装的卸载注册项与快捷方式**；
 * 之后若再跑 NSIS 卸载器，它按注册项里的目录删除，会把用户真实的安装目录整个删掉——
 * 表现为"跑一次发版门禁，用户的应用就没了"。所以：
 *   1) 门禁前备份真实注册项 + 快捷方式，结束后原样恢复；
 *   2) 存在真实安装时不再执行卸载器（改用手动删目录），卸载流程只在干净机器上验证。
 */
const powershell = (script) => (spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).stdout || '').trim()

/** 真实安装的卸载注册项路径（含 DisplayName 匹配），取不到则返回空字符串。 */
const realUninstallKey = () => {
  const out = powershell([
    "$k = Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue |",
    "  Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -like '*Agentic-Island*' } |",
    '  Select-Object -First 1',
    'if ($k) { "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + $k.PSChildName }'
  ].join('\n'))
  return out.split('\n').map((line) => line.trim()).filter((line) => line.includes('\\Uninstall\\')).pop() || ''
}
const shortcutPaths = () => [
  join(process.env.USERPROFILE || '', 'Desktop', 'Agentic-Island.lnk'),
  join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Agentic-Island.lnk')
].filter((path) => path && existsSync(path))

const listRunningIslands = () => {
  const out = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq Agentic-Island.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout || ''
  return out.split('\n').map((line) => line.trim()).filter((line) => /^"Agentic-Island\.exe"/i.test(line))
}

const uninstallKey = realUninstallKey()
const realInstall = Boolean(uninstallKey)
const keyBackup = join(tempRoot, 'uninstall-key.reg')
const shortcutBackups = []
const runningBefore = listRunningIslands()

if (realInstall) {
  const exported = spawnSync('reg.exe', ['export', uninstallKey, keyBackup, '/y'], { encoding: 'utf8', windowsHide: true })
  if (exported.status !== 0) throw new Error('备份真实安装的卸载注册项失败，出于安全中止（不该在无法恢复的情况下动注册表）')
  let index = 0
  for (const path of shortcutPaths()) {
    const backup = join(tempRoot, `shortcut-${index++}.lnk`)
    await copyFile(path, backup)
    shortcutBackups.push({ path, backup })
  }
  process.stdout.write(`检测到真实安装：已备份注册项与 ${shortcutBackups.length} 个快捷方式，验证结束后恢复。\n`)
}
const willRunNsis = !realInstall
if (runningBefore.length && willRunNsis) {
  process.stdout.write(`注意：有 ${runningBefore.length} 个正在运行的 Agentic-Island 进程，NSIS 会按进程名关掉它们；\n`)
  process.stdout.write('      验证结束后会自动重新拉起。\n')
}
const restoreAppPath = realInstall ? powershell([
  '$item = Get-ItemProperty "' + uninstallKey.replace('HKCU\\', 'HKCU:\\') + '" -ErrorAction SilentlyContinue',
  'if ($item) {',
  '  if ($item.DisplayIcon) { ($item.DisplayIcon -split ",")[0].Trim([char]34) }',
  '  elseif ($item.InstallLocation) { Join-Path $item.InstallLocation "Agentic-Island.exe" }',
  '}'
].join('\n')).split('\n').pop()?.trim() || '' : ''

async function waitForExit(child, label, timeoutMs = 120_000) {
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code) => code === 0 ? resolveExit() : rejectExit(new Error(`${label} exited with code ${code}`)))
  })
  const timeout = new Promise((_, rejectTimeout) => {
    const timer = setTimeout(() => rejectTimeout(new Error(`${label} timed out`)), timeoutMs)
    timer.unref()
  })
  return Promise.race([exit, timeout])
}

async function stopChild(child) {
  if (child.exitCode !== null || child.killed) return
  // 必须结束整棵进程树：Electron 会派生 GPU/渲染/工具子进程，只 kill 直接子进程会留下
  // 仍在运行的残留实例——它们会挡住后续的 NSIS 安装并让它静默中止（实测踩过）。
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill()
  }
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    sleep(2_000)
  ])
}

async function verifyApp(exe, name, port) {
  const profile = join(tempRoot, `${name}-profile`)
  const bridgeFile = join(tempRoot, `${name}-bridge.json`)
  await mkdir(profile, { recursive: true })
  const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], {
    cwd: root,
    env: { ...process.env, AIISLAND_SKIP_HOOKS: '1', AIISLAND_BRIDGE_FILE: bridgeFile },
    stdio: 'ignore',
    windowsHide: true
  })

  try {
    let rendererReady = false
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`${name} exited before renderer ready with code ${child.exitCode}`)
      try {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
        rendererReady = targets.some((target) => target.type === 'page' && target.title === 'Agentic-Island')
        if (rendererReady) break
      } catch { /* Electron is still starting. */ }
      await sleep(250)
    }
    if (!rendererReady) throw new Error(`${name} renderer did not become ready`)

    let discovery
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        discovery = JSON.parse(await readFile(bridgeFile, 'utf8'))
        if (discovery.port && discovery.token) break
      } catch { /* Bridge discovery is not ready yet. */ }
      await sleep(250)
    }
    if (!discovery?.port || !discovery?.token) throw new Error(`${name} bridge discovery is incomplete`)
    return { target: name, renderer: 'Agentic-Island', bridgePort: discovery.port, isolated: true }
  } finally {
    await stopChild(child)
  }
}

await access(installer)
await access(unpackedExe)

try {
  const results = [await verifyApp(unpackedExe, 'win-unpacked', 9341)]

  if (realInstall) {
    // 本机已有真实安装：**完全不碰 NSIS**。安装器走的是"先卸载既有版本"的升级流程，
    // 而且会沿用上次记录的安装目录，无法保证只影响隔离目录——实测它会把真实安装一起删掉，
    // 而且残留实例还会让它静默中止。安装/卸载流程改由 CI（干净 runner）与干净机器验证。
    process.stdout.write('本机存在真实安装：跳过 NSIS 安装/卸载验证，只验证 unpacked 构建（不触碰现有安装）。\n')
  } else {
    const install = spawn(installer, ['/S', `/D=${installDir}`], { stdio: 'ignore', windowsHide: true })
    await waitForExit(install, 'NSIS installer')
    const installedExe = join(installDir, 'Agentic-Island.exe')
    await access(installedExe)
    results.push(await verifyApp(installedExe, 'installed', 9342))

    const files = await readdir(installDir)
    const uninstaller = files.find((file) => /^Uninstall.*\.exe$/i.test(file))
    if (!uninstaller) throw new Error('NSIS uninstaller is missing')
    const uninstall = spawn(join(installDir, uninstaller), ['/S'], { stdio: 'ignore', windowsHide: true })
    await waitForExit(uninstall, 'NSIS uninstaller')
  }

  for (const result of results) {
    process.stdout.write(`${result.target}: renderer=${result.renderer}, bridge=${result.bridgePort}, isolated=${result.isolated}\n`)
  }
  process.stdout.write('package verification passed\n')
} finally {
  await sleep(500)
  // 有真实安装时全程没碰 NSIS，安装与运行状态都不需要恢复；此处只在"安装了但没装成"时兜底。
  // 注册项备份是兜底：若上面的重装失败，至少把注册信息恢复回去（不至于连卸载入口都没有）
  if (uninstallKey && !existsSync(join(process.env.LOCALAPPDATA || '', 'Programs', 'Agentic-Island', 'Agentic-Island.exe'))) {
    const imported = spawnSync('reg.exe', ['import', keyBackup], { encoding: 'utf8', windowsHide: true })
    process.stdout.write(imported.status === 0 ? '已从备份恢复卸载注册项。\n' : '注册项恢复失败，请手动重装应用。\n')
  }
  for (const { path, backup } of shortcutBackups) {
    if (!existsSync(path)) { try { await copyFile(backup, path) } catch { process.stdout.write(`快捷方式恢复失败：${path}\n`) } }
  }
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
  if (runningBefore.length && willRunNsis) {
    const target = join(process.env.LOCALAPPDATA || '', 'Programs', 'Agentic-Island', 'Agentic-Island.exe')
    if (existsSync(target)) {
      try {
        spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
        process.stdout.write(`已重新拉起 Agentic-Island：${target}\n`)
      } catch (error) {
        process.stdout.write(`自动重新拉起失败（请手动启动）：${error}\n`)
      }
    } else if (restoreAppPath) {
      process.stdout.write(`未找到已安装的可执行文件，未自动启动（原路径 ${restoreAppPath}）。\n`)
    }
  }
}
