export type TerminalCommandGroup = '项目' | 'Git' | 'Node' | '系统'

export interface TerminalCommandPreset {
  id: string
  group: TerminalCommandGroup
  label: string
  command: string
  description: string
}

export interface TerminalHistoryEntry {
  id: number
  sessionId: string
  sessionName: string
  command: string
  cwd?: string
  ts: number
}

export const TERMINAL_COMMANDS: TerminalCommandPreset[] = [
  { id: 'location', group: '项目', label: '当前位置', command: 'Get-Location', description: '显示当前工作目录' },
  { id: 'files', group: '项目', label: '目录详情', command: 'Get-ChildItem -Force', description: '列出包含隐藏项的目录内容' },
  { id: 'tree', group: '项目', label: '两层文件', command: 'Get-ChildItem -Depth 2 | Select-Object FullName', description: '快速了解项目文件结构' },
  { id: 'commands', group: '项目', label: '工具版本', command: 'Get-Command git,node,npm,python -ErrorAction SilentlyContinue | Select-Object Name,Version,Source', description: '检查开发工具路径与版本' },
  { id: 'git-status', group: 'Git', label: '仓库状态', command: 'git status --short --branch', description: '查看分支与未提交变更' },
  { id: 'git-diff', group: 'Git', label: '变更统计', command: 'git diff --stat', description: '查看当前改动规模' },
  { id: 'git-log', group: 'Git', label: '最近提交', command: 'git log --oneline --decorate -8', description: '查看最近八条提交' },
  { id: 'git-branches', group: 'Git', label: '分支概览', command: 'git branch --all --verbose --no-abbrev', description: '查看本地与远端分支' },
  { id: 'npm-scripts', group: 'Node', label: '可用脚本', command: 'npm run', description: '列出 package.json scripts' },
  { id: 'npm-test', group: 'Node', label: '运行测试', command: 'npm test', description: '运行项目测试脚本' },
  { id: 'npm-build', group: 'Node', label: '生产构建', command: 'npm run build', description: '运行项目构建脚本' },
  { id: 'node-version', group: 'Node', label: 'Node 环境', command: 'node --version; npm --version', description: '显示 Node 与 npm 版本' },
  { id: 'ps-version', group: '系统', label: 'PowerShell', command: '$PSVersionTable', description: '显示 PowerShell 运行环境' },
  { id: 'processes', group: '系统', label: '高负载进程', command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 Name,Id,CPU,WorkingSet', description: '查看 CPU 累计占用最高的进程' },
  { id: 'ports', group: '系统', label: '监听端口', command: 'Get-NetTCPConnection -State Listen | Sort-Object LocalPort | Select-Object LocalAddress,LocalPort,OwningProcess', description: '查看本机监听端口' },
  { id: 'env', group: '系统', label: '环境变量', command: 'Get-ChildItem Env: | Sort-Object Name', description: '列出当前会话环境变量' }
]

export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function setLocationCommand(path: string): string {
  return `Set-Location -LiteralPath ${quotePowerShellLiteral(path.trim())}`
}

export function extractPowerShellCwd(output: string): string | null {
  const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')
  const matches = [...clean.matchAll(/(?:^|\n)PS\s+([^\n>]+)>/g)]
  return matches.length ? matches[matches.length - 1][1].trim() : null
}

/** 只采集普通可见输入；控制键和方向键不会污染历史。 */
export function consumeTerminalInput(current: string, data: string): { buffer: string; submitted?: string } {
  let buffer = current
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      const submitted = buffer.trim()
      return { buffer: '', submitted: submitted || undefined }
    }
    if (ch === '\x7f' || ch === '\b') { buffer = buffer.slice(0, -1); continue }
    if (ch === '\x03' || ch === '\x1b') { buffer = ''; continue }
    if (ch >= ' ' && ch !== '\x7f') buffer += ch
  }
  return { buffer }
}
