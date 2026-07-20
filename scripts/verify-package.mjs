import { spawn } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const installer = join(root, 'dist', `Agentic-Island-Setup-${version}.exe`)
const unpackedExe = join(root, 'dist', 'win-unpacked', 'Agentic-Island.exe')
const tempRoot = await mkdtemp(join(tmpdir(), 'agentic-island-release-'))
const installDir = join(tempRoot, 'installed')

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

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
  child.kill()
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

  for (const result of results) {
    process.stdout.write(`${result.target}: renderer=${result.renderer}, bridge=${result.bridgePort}, isolated=${result.isolated}\n`)
  }
  process.stdout.write('package verification passed\n')
} finally {
  await sleep(500)
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
}
