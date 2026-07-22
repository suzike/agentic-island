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
  exitCode?: number
  durationMs?: number
}

export interface TerminalCwdEntry {
  id: string
  cwd?: string
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

/** 目录未变化时保留原数组引用，避免 PTY 每次字符回显都触发 React 重渲染。 */
export function updateTerminalCwd<T extends TerminalCwdEntry>(entries: T[], id: string, cwd: string): T[] {
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0 || entries[index].cwd === cwd) return entries
  const next = entries.slice()
  next[index] = { ...entries[index], cwd }
  return next
}

export function extractPowerShellCwd(output: string): string | null {
  // 提示符前会带 OSC 633 退出码标记；必须在完整尾部再次清理，兼容控制序列跨 PTY chunk 拆分。
  const clean = stripTerminalAnsi(output)
  const matches = [...clean.matchAll(/(?:^|\n)PS\s+([^\n>]+)>/g)]
  return matches.length ? matches[matches.length - 1][1].trim() : null
}

export function extractTerminalExitCode(output: string): number | null {
  const matches = [...output.matchAll(/\x1b\]633;D;(-?\d+)\x07/g)]
  return matches.length ? Number(matches[matches.length - 1][1]) : null
}

export function stripTerminalAnsi(output: string): string {
  return output
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

export function terminalOutputTail(previous: string, chunk: string, maxChars: number): string {
  const clean = stripTerminalAnsi(chunk)
  if (!clean) return previous
  return (previous + clean).slice(-Math.max(2_000, maxChars))
}

export function terminalProjectId(cwd?: string): string | undefined {
  const value = cwd?.trim().replace(/[\\/]+$/, '')
  return value ? value.toLowerCase() : undefined
}

export function isDangerousTerminalCommand(command: string): boolean {
  const clean = command.trim().toLowerCase()
  return [
    /\bremove-item\b[^\n]*(?:-recurse|-force)/,
    /\b(?:del|erase|rd|rmdir)\b[^\n]*(?:\/s|\/q)/,
    /\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f|push\s+[^\n]*--force)/,
    /\bformat(?:-volume)?\b/,
    /\bclear-disk\b/,
    /\bstop-computer\b|\brestart-computer\b/,
    /\b(?:npm|pnpm|yarn)\s+publish\b/
  ].some((pattern) => pattern.test(clean))
}

export function summarizeTerminalOutput(output: string): { text: string; originalLines: number; visibleLines: number } {
  const lines = stripTerminalAnsi(output).split('\n')
  const compact: string[] = []
  let previous = ''
  let repeats = 0
  const flush = (): void => {
    if (repeats > 0) compact.push(`  … 相同行重复 ${repeats} 次`)
    repeats = 0
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line && compact.at(-1) === '') continue
    if (line && line === previous) { repeats++; continue }
    flush()
    compact.push(line)
    previous = line
  }
  flush()
  return { text: compact.join('\n').trim(), originalLines: lines.length, visibleLines: compact.length }
}

export function buildTerminalDiagnosisPrompt(input: { cwd?: string; command?: string; output: string; project?: string }): string {
  return [
    '请作为资深 Windows/PowerShell 开发环境诊断助手分析以下终端现场。',
    '要求：先给出最可能根因，再给出可验证步骤；建议命令必须解释风险，不得自动执行；不确定的信息明确标注。',
    input.project ? `项目类型：${input.project}` : '',
    input.cwd ? `工作目录：${input.cwd}` : '',
    input.command ? `最近命令：${input.command}` : '',
    '最近输出：',
    input.output.slice(-12_000)
  ].filter(Boolean).join('\n')
}

export function buildTerminalHandoffPrompt(input: { cwd?: string; history: TerminalHistoryEntry[]; output: string }): string {
  const commands = input.history.slice(0, 12).reverse().map((item) => `- ${item.command}`).join('\n') || '- 无'
  return [
    '请把以下开发终端现场整理成下一次可直接继续工作的交接摘要。',
    '固定结构：当前目标、已完成、当前状态、阻塞/风险、下一步、关键命令。不要编造未出现的事实。',
    input.cwd ? `工作目录：${input.cwd}` : '',
    `最近命令：\n${commands}`,
    `最近输出：\n${input.output.slice(-12_000)}`
  ].filter(Boolean).join('\n\n')
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
