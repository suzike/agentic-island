import { Clock3, FileClock, Folder, History, Play, RotateCcw, ShieldCheck, Terminal as TerminalIcon } from 'lucide-react'
import type { TerminalWorkspaceState } from '../../../shared/protocol'
import { Badge, Button, Chip, Switch } from '../ui/components'
import { accent, fill, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'

const age = (ts: number): string => {
  const delta = Math.max(0, Date.now() - ts)
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}

export function TerminalRecoveryCenter(props: {
  state: TerminalWorkspaceState
  selectedSessions: string[]
  selectedTasks: string[]
  onToggleSession: (id: string) => void
  onToggleTask: (id: string) => void
  onAutoRestore: (on: boolean) => void
  onRestore: () => void
  onFresh: () => void
}): React.JSX.Element {
  const { state } = props
  return (
    <div data-terminal-recovery style={{ ...surface.panel(), minHeight: 390, padding: SP.lg, display: 'flex', flexDirection: 'column', gap: SP.md, borderRadius: R.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: R.md, color: accent(), background: semBg(accent(), 0.16) }}><RotateCcw size={19} strokeWidth={1.8} /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...text.title(), fontSize: 16 }}>恢复上次开发现场</div>
          <div style={text.faint()}>保存于 {new Date(state.updatedAt).toLocaleString('zh-CN')} · 恢复只会创建新终端，不会自动重跑旧命令</div>
        </div>
        <span style={{ flex: 1 }} />
        <Badge color={sem.calm}>{state.sessions.length} 个会话</Badge>
      </div>

      <div className="ai-scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7, maxHeight: 230, overflowY: 'auto' }}>
        {state.sessions.map((session) => {
          const selected = props.selectedSessions.includes(session.id)
          return (
            <button key={session.id} type="button" onClick={() => props.onToggleSession(session.id)} style={{ appearance: 'none', textAlign: 'left', padding: 11, borderRadius: R.md, border: `0.5px solid ${selected ? accent(0.7, 0.4) : hairline(0.07)}`, background: selected ? semBg(accent(), 0.14) : fill(1), color: ink(1), cursor: 'pointer', fontFamily: 'inherit', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 19, height: 19, display: 'grid', placeItems: 'center', borderRadius: 6, background: selected ? accent() : fill(3), color: selected ? 'oklch(.18 0 0)' : ink(3), fontSize: 11 }}>{selected ? '✓' : ''}</span>
                <TerminalIcon size={13} color={selected ? accent() : ink(3)} />
                <span style={{ ...text.subtitle(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.name}</span>
                {session.pinned && <Badge color={sem.warn}>固定</Badge>}
              </div>
              <div title={session.cwd} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, ...text.mono(9.5), overflow: 'hidden' }}><Folder size={10} style={{ flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.cwd || '用户主目录'}</span></div>
              {session.lastCommand && <div title={session.lastCommand} style={{ marginTop: 5, ...text.mono(9), color: ink(2), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>&gt; {session.lastCommand}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 7, ...text.faint(), fontSize: 9 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock3 size={9} />{age(session.lastActiveAt)}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><History size={9} />{session.commandCount} 条命令</span>
                {session.outputSnapshot && <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: sem.calm }}><FileClock size={9} />有快照</span>}
                {session.handoff && <span style={{ color: accent() }}>有交接摘要</span>}
              </div>
            </button>
          )
        })}
      </div>

      {state.startupTasks.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ ...text.faint(), display: 'flex', alignItems: 'center', gap: 4 }}><Play size={11} />恢复后运行：</span>
          {state.startupTasks.filter((task) => task.enabled).map((task) => <Chip key={task.id} active={props.selectedTasks.includes(task.id)} onClick={() => props.onToggleTask(task.id)} title={task.command}>{task.label}</Chip>)}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingTop: 9, borderTop: `0.5px solid ${hairline(0.07)}` }}>
        <ShieldCheck size={13} color={sem.calm} />
        <span style={{ ...text.dim(), color: ink(2) }}>以后自动恢复标签和目录</span>
        <Switch on={state.settings.restoreMode === 'auto'} onChange={props.onAutoRestore} />
        <span style={{ flex: 1 }} />
        <Button onClick={props.onFresh}>新建空白现场</Button>
        <Button variant="primary" icon={RotateCcw} onClick={props.onRestore} disabled={props.selectedSessions.length === 0}>恢复所选</Button>
      </div>
    </div>
  )
}
