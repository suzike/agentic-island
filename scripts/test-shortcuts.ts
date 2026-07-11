// 快捷指令引擎测试：变量插值 / 危险命令检测 / 多步管道（%prev% 串联）/ 确认闸与取消中止。
// 运行：node --experimental-strip-types scripts/test-shortcuts.ts

import { interpolate, DANGEROUS_RE, runShortcut, PRESET_SHORTCUTS, usesClip, needsRepo } from '../src/renderer/src/logic/shortcuts.ts'
import type { RunCtx, RunLog, ShortcutDef } from '../src/renderer/src/logic/shortcuts.ts'

let fails = 0
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails++
}

// ── 插值 ──
const v = { clip: 'CLIP', prev: 'PREV', input: 'IN', repo: 'E:\\proj', date: '2026-07-08', time: '10:00' }
ok(interpolate('a %clip% b %prev% c %input%', v) === 'a CLIP b PREV c IN', '插值：clip/prev/input')
ok(interpolate('git -C "%repo%" status', v) === 'git -C "E:\\proj" status', '插值：repo')
ok(interpolate('%date% %time%', v) === '2026-07-08 10:00', '插值：date/time')
ok(interpolate('%prev%%prev%', v) === 'PREVPREV', '插值：同一变量多次出现')
ok(interpolate('无变量', v) === '无变量', '插值：无变量原样返回')

// ── 危险检测 ──
ok(DANGEROUS_RE.test('shutdown /s /t 60'), '危险：shutdown 命中')
ok(DANGEROUS_RE.test('Remove-Item -Recurse x'), '危险：Remove-Item 命中')
ok(DANGEROUS_RE.test('taskkill /pid 1 /f'), '危险：taskkill 命中')
ok(DANGEROUS_RE.test('git -C "x" push origin main'), '危险：git push 命中')
ok(DANGEROUS_RE.test('git reset --hard HEAD~1'), '危险：git reset --hard 命中')
ok(!DANGEROUS_RE.test('git -C "x" commit -m ok'), '安全：git commit 不误报')
ok(!DANGEROUS_RE.test('git -C "x" add -A'), '安全：git add 不误报')
ok(!DANGEROUS_RE.test('Get-Process | Select-Object -First 3'), '安全：Get-Process 不误报')
ok(!DANGEROUS_RE.test('echo delta'), '安全：单词内含 del 不误报（词边界）')

// ── usesClip ──
ok(usesClip({ steps: [{ kind: 'ai', system: 's', prompt: '%clip%' }] } as ShortcutDef), 'usesClip：模板引用 %clip%')
ok(usesClip({ steps: [{ kind: 'clipboard', op: 'read' }] } as ShortcutDef), 'usesClip：读剪贴板步骤')
ok(!usesClip({ steps: [{ kind: 'open', target: 'https://x' }] } as ShortcutDef), 'usesClip：无剪贴板不误报')

// ── 执行引擎（mock ctx）──
function makeCtx(over: Partial<RunCtx> = {}): { ctx: RunCtx; logs: RunLog[]; calls: string[] } {
  const logs: RunLog[] = []
  const calls: string[] = []
  const ctx: RunCtx = {
    ai: async (_s, u) => { calls.push('ai:' + u); return { ok: true, text: 'AI(' + u + ')' } },
    shell: async (cmd) => { calls.push('shell:' + cmd); return { ok: true, output: 'OUT(' + cmd + ')' } },
    open: async (t) => { calls.push('open:' + t); return { ok: true } },
    agent: async (eng, prompt, cwd) => { calls.push('agent:' + eng + ':' + cwd + ':' + prompt); return { ok: true, text: 'AGENT(' + prompt + ')' } },
    clipRead: async () => 'CLIPTEXT',
    clipWrite: (t) => { calls.push('clipw:' + t) },
    islandAction: (a, args) => { calls.push('island:' + a + ':' + args); return '✓ ' + a },
    askInput: async () => '3000',
    askRepo: async () => 'E:\\myrepo',
    askConfirm: async () => true,
    onLog: (l) => logs.push(l),
    ...over
  }
  return { ctx, logs, calls }
}

const pipeline: ShortcutDef = {
  id: 't1', icon: '⚡', name: '管道', group: '测试', runCount: 0, trusted: true,
  steps: [
    { kind: 'clipboard', op: 'read' },
    { kind: 'ai', system: '翻译', prompt: '%prev%' },
    { kind: 'clipboard', op: 'write', text: '%prev%' }
  ]
}
const t1 = makeCtx()
await runShortcut(pipeline, t1.ctx)
ok(t1.calls.includes('ai:CLIPTEXT'), '管道：剪贴板内容流入 AI')
ok(t1.calls.includes('clipw:AI(CLIPTEXT)'), '管道：AI 结果写回剪贴板（%prev% 串联）')
ok(t1.logs.every((l) => l.ok), '管道：全部步骤成功')

const withInput: ShortcutDef = {
  id: 't2', icon: '⚡', name: '输入', group: '测试', runCount: 0, trusted: true,
  steps: [
    { kind: 'input', label: '端口' },
    { kind: 'shell', cmd: 'netstat %input%' }
  ]
}
const t2 = makeCtx()
await runShortcut(withInput, t2.ctx)
ok(t2.calls.includes('shell:netstat 3000'), '输入：%input% 注入 shell 命令')

// 取消输入 → 中止后续步骤
const t3 = makeCtx({ askInput: async () => null })
const done3 = await runShortcut(withInput, t3.ctx)
ok(!done3 && !t3.calls.some((c) => c.startsWith('shell:')), '取消输入：中止且不执行 shell')

// 未信任 → 确认闸被调用；拒绝 → 中止
let confirmed = 0
const t4 = makeCtx({ askConfirm: async () => { confirmed++; return false } })
const untrusted: ShortcutDef = { ...pipeline, id: 't4', trusted: false, steps: [{ kind: 'shell', cmd: 'echo hi' }] }
const done4 = await runShortcut(untrusted, t4.ctx)
ok(confirmed === 1 && !done4, '确认闸：未信任 shell 询问，拒绝即中止')

// 信任 + 危险命令 → 仍要确认
let confirmed5 = 0
const t5 = makeCtx({ askConfirm: async () => { confirmed5++; return true } })
const danger: ShortcutDef = { ...pipeline, id: 't5', trusted: true, steps: [{ kind: 'shell', cmd: 'shutdown /s' }] }
await runShortcut(danger, t5.ctx)
ok(confirmed5 === 1, '确认闸：信任指令的危险命令仍强制确认')

// shell 失败 → 中止后续
const t6 = makeCtx({ shell: async () => ({ ok: false, error: 'boom' }) })
const failPipe: ShortcutDef = { ...pipeline, id: 't6', trusted: true, steps: [{ kind: 'shell', cmd: 'x' }, { kind: 'clipboard', op: 'write', text: 'nope' }] }
const done6 = await runShortcut(failPipe, t6.ctx)
ok(!done6 && !t6.calls.some((c) => c.startsWith('clipw:')), '失败中止：shell 报错后不再执行后续步骤')

// island 动作
const islandSc: ShortcutDef = { id: 't7', icon: '⚡', name: '岛', group: '测试', runCount: 0, steps: [{ kind: 'island', action: 'note', args: '日报 %date%' }] }
const t7 = makeCtx()
await runShortcut(islandSc, t7.ctx)
ok(t7.calls.some((c) => c.startsWith('island:note:日报 2')), 'island：动作参数完成日期插值')

// agent 步骤 + %repo% 注入 cwd
const agentSc: ShortcutDef = { id: 't8', icon: '◆', name: '派活', group: 'Agent', runCount: 0, steps: [{ kind: 'agent', engine: 'codex', useRepo: true, prompt: '修一下 %clip%' }] }
const t8 = makeCtx({ clipRead: async () => 'BUG' })
await runShortcut(agentSc, t8.ctx)
ok(t8.calls.some((c) => c === 'agent:codex:E:\\myrepo:修一下 BUG'), 'agent：useRepo 用 askRepo 的仓库当 cwd + 变量插值')

// %repo% 触发 askRepo；取消则中止
let repoAsked = 0
const t9 = makeCtx({ askRepo: async () => { repoAsked++; return null } })
const gitSc: ShortcutDef = { id: 't9', icon: '📊', name: 'git', group: 'Git', runCount: 0, trusted: true, steps: [{ kind: 'shell', cmd: 'git -C "%repo%" status' }] }
const done9 = await runShortcut(gitSc, t9.ctx)
ok(repoAsked === 1 && !done9 && !t9.calls.some((c) => c.startsWith('shell:')), 'repo：用了 %repo% 会 askRepo，取消即中止')

// repoPath 预设 → 不 askRepo
let repoAsked2 = 0
const t10 = makeCtx({ askRepo: async () => { repoAsked2++; return 'X' } })
await runShortcut({ ...gitSc, id: 't10', repoPath: 'E:\\fixed' }, t10.ctx)
ok(repoAsked2 === 0 && t10.calls.some((c) => c === 'shell:git -C "E:\\fixed" status'), 'repo：预设 repoPath 免选、直接注入')

// confirm 步骤：拒绝即中止
let confirmed7 = 0
const t11 = makeCtx({ askConfirm: async () => { confirmed7++; return false } })
const confSc: ShortcutDef = { id: 't11', icon: '⚡', name: 'c', group: '测试', runCount: 0, trusted: true, steps: [{ kind: 'confirm', message: '确认?' }, { kind: 'shell', cmd: 'echo hi' }] }
const done11 = await runShortcut(confSc, t11.ctx)
ok(confirmed7 === 1 && !done11 && !t11.calls.some((c) => c.startsWith('shell:')), 'confirm 步骤：拒绝即中止后续')

// ── 预置完整性 ──
ok(PRESET_SHORTCUTS.length === 12, `预置：共 12 条核心工作流（实际 ${PRESET_SHORTCUTS.length}）`)
ok(new Set(PRESET_SHORTCUTS.map((s) => s.id)).size === PRESET_SHORTCUTS.length, '预置：id 无重复')
ok(PRESET_SHORTCUTS.every((s) => s.steps.length > 0 && s.name && s.icon), '预置：每条都有名称/图标/步骤')
for (const group of ['开发验收', 'Git交付', 'Agent协作', 'MATLAB/Simulink', '需求文档']) {
  ok(PRESET_SHORTCUTS.filter((s) => s.group === group).length >= 2, `预置：${group} 至少 2 条核心工作流`)
}
ok(PRESET_SHORTCUTS.filter((s) => s.steps.some((x) => x.kind === 'agent')).length >= 8, '预置：以本地 Agent 工程工作流为主')
ok(PRESET_SHORTCUTS.filter(needsRepo).length >= 10, '预置：绝大多数工作流绑定真实仓库上下文')
ok(PRESET_SHORTCUTS.every((s) => s.steps.every((x) => x.kind !== 'shell' || !DANGEROUS_RE.test(x.cmd))), '预置：默认不包含危险 shell 操作')
ok(!PRESET_SHORTCUTS.some((s) => s.steps.some((x) => x.kind === 'shell' && /\bgit\s+.*\b(?:commit|push)\b/i.test(x.cmd))), '预置：不再默认自动 commit/push')

console.log(fails === 0 ? '\n✅ shortcuts 引擎全部通过' : `\n❌ ${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
