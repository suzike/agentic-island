import { useState } from 'react'
import type { WorkbenchProject } from '../types'

interface Props {
  projects: WorkbenchProject[]
  activeProjectId: string | null
  onSelect: (id: string | null) => void
  onCreate: (name: string, repoPath?: string) => void
  label?: string
  detail?: string
}

export function ProjectContextBar(p: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const active = p.projects.find((x) => x.id === p.activeProjectId)
  const save = (): void => {
    if (!name.trim()) return
    p.onCreate(name, repoPath)
    setName('')
    setRepoPath('')
    setCreating(false)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '9px 10px', borderRadius: 8, background: 'rgba(0,0,0,.2)', border: '1px solid rgba(255,255,255,.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ flex: 'none', color: 'oklch(0.66 0.02 var(--th) / .72)', fontSize: 9.5, fontWeight: 700 }}>{p.label || '项目上下文'}</span>
        <select
          value={p.activeProjectId || ''}
          onChange={(e) => p.onSelect(e.target.value || null)}
          title="选择后，资讯、待办和快捷执行共享此项目上下文"
          style={{ minWidth: 120, maxWidth: 220, height: 27, borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'oklch(0.2 0.025 var(--ths))', color: 'oklch(0.9 0.02 var(--th))', outline: 'none', fontFamily: 'var(--font)', fontSize: 10.5, padding: '0 7px' }}
        >
          <option value="">全部 / 未归属</option>
          {p.projects.filter((x) => x.status !== 'done').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {active?.repoPath && <span title={active.repoPath} style={{ flex: 1, minWidth: 0, color: 'oklch(0.62 0.02 var(--th) / .62)', fontSize: 9.5, fontFamily: 'ui-monospace,monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.repoPath}</span>}
        {!active?.repoPath && p.detail && <span style={{ flex: 1, minWidth: 0, color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.detail}</span>}
        <button type="button" className="hv" title="新建项目上下文" onClick={() => setCreating((v) => !v)} style={{ width: 27, height: 27, flex: 'none', borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: creating ? 'oklch(0.33 0.06 var(--th) / .45)' : 'rgba(255,255,255,.05)', color: 'oklch(0.82 0.06 var(--th))', cursor: 'pointer', fontSize: 15 }}>+</button>
      </div>
      {creating && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(100px,.7fr) minmax(160px,1.3fr) auto', gap: 6 }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} placeholder="项目名称" style={inputStyle} />
          <input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} placeholder="仓库路径（可选）" style={{ ...inputStyle, fontFamily: 'ui-monospace,monospace' }} />
          <button type="button" onClick={save} disabled={!name.trim()} style={{ height: 28, padding: '0 10px', borderRadius: 7, border: 0, background: name.trim() ? 'oklch(0.72 0.14 var(--th))' : 'rgba(255,255,255,.07)', color: name.trim() ? 'oklch(0.16 0.02 var(--th))' : 'oklch(0.55 0.02 var(--th))', cursor: name.trim() ? 'pointer' : 'default', fontFamily: 'var(--font)', fontSize: 10.5, fontWeight: 700 }}>创建</button>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box', width: '100%', minWidth: 0, height: 28, borderRadius: 7,
  border: '1px solid rgba(255,255,255,.09)', background: 'rgba(0,0,0,.24)',
  color: 'oklch(0.9 0.02 var(--th))', outline: 'none', padding: '0 8px', fontFamily: 'var(--font)', fontSize: 10.5
}
