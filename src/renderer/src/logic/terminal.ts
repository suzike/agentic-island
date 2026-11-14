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

/** 历史按会话分组：同一标签页（会话）的记录聚在一起，便于整组查看与批量删除。 */
export interface TerminalHistoryGroup {
  key: string
  sessionId?: string
  sessionName: string
  latestTs: number
  entries: TerminalHistoryEntry[]
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

/** 按会话分组（最近使用在前），组内保持最新在前；未知会话名兜底为「已关闭会话」。 */
export function groupTerminalHistory(entries: TerminalHistoryEntry[]): TerminalHistoryGroup[] {
  const groups = new Map<string, TerminalHistoryGroup>()
  for (const entry of entries) {
    const key = entry.sessionId || entry.sessionName || 'unknown'
    const group = groups.get(key)
    if (group) {
      group.entries.push(entry)
      group.latestTs = Math.max(group.latestTs, entry.ts)
    } else {
      groups.set(key, { key, sessionId: entry.sessionId, sessionName: entry.sessionName || '已关闭会话', latestTs: entry.ts, entries: [entry] })
    }
  }
  return [...groups.values()].sort((a, b) => b.latestTs - a.latestTs)
}

/** 按 id 删除历史项；未命中的 id（已被删/会话已回收）直接忽略，不产生空档报错。 */
export function dropTerminalHistory(entries: TerminalHistoryEntry[], ids: Iterable<number>): TerminalHistoryEntry[] {
  const remove = new Set(ids)
  return remove.size ? entries.filter((entry) => !remove.has(entry.id)) : entries
}

/**
 * 从 index 处的 ESC 起跳过一整条转义序列，返回最后被消耗的字符下标。
 * 鼠标上报（ESC [ < … M）、焦点上报（ESC [ I / O）、括号粘贴（ESC [ 200~ … 201~）、
 * OSC 标题（ESC ] … BEL/ST）都属于「终端协议」而不是用户输入；只丢 ESC 会把剩余字节
 * 当成命令记进历史（历史里出现 `[<35;8;30M你好` 这类脏数据的根因）。
 */
function readTerminalEscape(data: string, index: number): { end: number; resets: boolean } {
  const next = data[index + 1]
  if (next === undefined) return { end: index, resets: true } // 单独 ESC 在 PSReadLine 里就是清空当前行
  if (next === '[') {
    let start = index + 2
    if (data[start] === '[') start += 1 // ESC[[A（F1-F4）：第二个 [ 不是终止符
    for (let i = start; i < data.length; i++) {
      const code = data.charCodeAt(i)
      if (code < 0x40 || code > 0x7e) continue
      const body = data.slice(start, i)
      const final = data[i]
      // X10 鼠标上报（ESC [ M + 3 字节）后面跟的是坐标原始字节，不能当输入
      if (final === 'M' && !body) return { end: Math.min(i + 3, data.length - 1), resets: false }
      // 只把光标/编辑键（方向、Home/End、Delete、翻页…）视为「改了输入」；
      // 鼠标、焦点、粘贴标记、光标可见性与 DSR 都只是协议噪声，不能清掉正在键入的命令。
      const editKey = /^[ABCHDFZ]$/.test(final) || (final === '~' && !/^20[01]$/.test(body.split(';')[0]))
      return { end: i, resets: editKey }
    }
    return { end: data.length - 1, resets: true } // 序列跨 chunk 被截断：宁可漏记，不可写脏数据
  }
  if (next === ']') {
    for (let i = index + 2; i < data.length; i++) {
      if (data[i] === '\x07') return { end: i, resets: false }
      if (data[i] === '\x1b' && data[i + 1] === '\\') return { end: i + 1, resets: false }
    }
    return { end: data.length - 1, resets: true }
  }
  // SS3（ESC O + 一个字符，F1-F4/应用模式方向键）与双字节字符集指定：都要吃掉后续字符
  if (next === 'O' || (next >= ' ' && next <= '/')) return { end: Math.min(index + 2, data.length - 1), resets: true }
  return { end: index + 1, resets: true } // Alt+键组合
}

/** 只采集普通可见输入；控制键、方向键与鼠标/焦点上报等终端协议序列不会污染历史。 */
export function consumeTerminalInput(current: string, data: string): { buffer: string; submitted?: string } {
  let buffer = current
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]
    if (ch === '\x1b') {
      const escape = readTerminalEscape(data, i)
      if (escape.resets) buffer = ''
      i = escape.end
      continue
    }
    if (ch === '\r' || ch === '\n') {
      const submitted = buffer.trim()
      return { buffer: '', submitted: submitted || undefined }
    }
    if (ch === '\x7f' || ch === '\b') { buffer = buffer.slice(0, -1); continue }
    if (ch === '\x03') { buffer = ''; continue }
    if (ch >= ' ' && ch !== '\x7f') buffer += ch
  }
  return { buffer }
}
