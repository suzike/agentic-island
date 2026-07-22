import { existsSync, readFileSync, readdirSync } from 'fs'
import { basename, join } from 'path'
import type { TerminalProjectInspection, TerminalProjectTask } from '../shared/protocol'

function readJson(path: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> } catch { return null }
}

function addTask(tasks: TerminalProjectTask[], task: TerminalProjectTask): void {
  if (!tasks.some((item) => item.command === task.command)) tasks.push(task)
}

export function inspectTerminalProject(cwd: string): TerminalProjectInspection {
  const root = String(cwd || '').trim()
  if (!root || !existsSync(root)) return { ok: false, cwd: root, name: basename(root) || root, kind: [], tasks: [], checks: [], error: '工作目录不存在' }
  const tasks: TerminalProjectTask[] = []
  const kind: string[] = []
  const checks: TerminalProjectInspection['checks'] = []
  let packageManager: string | undefined
  const has = (name: string): boolean => existsSync(join(root, name))
  const packageJson = readJson(join(root, 'package.json'))
  if (packageJson) {
    kind.push('Node.js')
    packageManager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm'
    const scripts = packageJson.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts as Record<string, unknown> : {}
    for (const name of Object.keys(scripts).slice(0, 40)) addTask(tasks, { id: `package-${name}`, label: name, command: `${packageManager} run ${name}`, source: 'package' })
    checks.push({ label: 'Node 依赖', status: has('node_modules') ? 'ok' : 'warn', detail: has('node_modules') ? 'node_modules 已就绪' : `尚未安装依赖，可运行 ${packageManager} install` })
  }
  const vscode = readJson(join(root, '.vscode', 'tasks.json'))
  if (vscode && Array.isArray(vscode.tasks)) {
    for (const raw of vscode.tasks.slice(0, 30)) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const command = typeof item.command === 'string' ? item.command : ''
      if (command) addTask(tasks, { id: `vscode-${tasks.length}`, label: typeof item.label === 'string' ? item.label : command, command, source: 'vscode' })
    }
  }
  if (has('Makefile')) {
    kind.push('Make')
    try {
      const content = readFileSync(join(root, 'Makefile'), 'utf8')
      for (const match of content.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?![=])/gm)) {
        if (!match[1].startsWith('.')) addTask(tasks, { id: `make-${match[1]}`, label: match[1], command: `make ${match[1]}`, source: 'make' })
      }
    } catch { /* unreadable Makefile */ }
  }
  if (has('pyproject.toml') || has('requirements.txt')) {
    kind.push('Python')
    addTask(tasks, { id: 'python-test', label: 'Python 测试', command: 'python -m pytest', source: 'python' })
    checks.push({ label: 'Python 环境', status: has('.venv') || has('venv') ? 'ok' : 'info', detail: has('.venv') || has('venv') ? '发现本地虚拟环境' : '未发现项目内虚拟环境' })
  }
  if (has('Cargo.toml')) {
    kind.push('Rust')
    for (const [id, label, command] of [['check', 'Cargo Check', 'cargo check'], ['test', 'Cargo Test', 'cargo test'], ['build', 'Cargo Build', 'cargo build']] as const) addTask(tasks, { id: `rust-${id}`, label, command, source: 'rust' })
  }
  const sln = (() => { try { return readdirSync(root).find((name) => name.endsWith('.sln')) } catch { return undefined } })()
  if (sln) {
    kind.push('.NET')
    addTask(tasks, { id: 'dotnet-build', label: '.NET 构建', command: `dotnet build .\\${sln}`, source: 'dotnet' })
    addTask(tasks, { id: 'dotnet-test', label: '.NET 测试', command: 'dotnet test', source: 'dotnet' })
  }
  checks.push({ label: 'Git 仓库', status: has('.git') ? 'ok' : 'info', detail: has('.git') ? '已识别 Git 工作树' : '当前目录不是 Git 仓库根目录' })
  checks.push({ label: '任务入口', status: tasks.length ? 'ok' : 'warn', detail: tasks.length ? `发现 ${tasks.length} 个可运行任务` : '未发现 package、VS Code、Make、Python、Rust 或 .NET 任务' })
  return { ok: true, cwd: root, name: basename(root), kind: kind.length ? kind : ['通用项目'], packageManager, tasks, checks }
}
