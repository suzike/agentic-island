import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { WorkbenchProject } from '../types'
import { accent, fill, FS, gradient, hairline, ink, R, surface, text } from '../ui/tokens'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '9px 10px', ...surface.section(), border: `0.5px solid ${hairline(.07)}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ flex: 'none', ...text.overline(), fontSize: 9.5 }}>{p.label || '项目上下文'}</span>
        <select
          value={p.activeProjectId || ''}
          onChange={(e) => p.onSelect(e.target.value || null)}
          title="选择后，资讯、待办和快捷执行共享此项目上下文"
          style={{ minWidth: 120, maxWidth: 220, height: 27, ...surface.inset(), borderRadius: R.sm, color: ink(1), outline: 'none', fontFamily: 'var(--font)', fontSize: FS.small, padding: '0 7px' }}
        >
          <option value="">全部 / 未归属</option>
          {p.projects.filter((x) => x.status !== 'done').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {active?.repoPath && <span title={active.repoPath} style={{ flex: 1, minWidth: 0, ...text.mono(9.5), color: ink(3), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.repoPath}</span>}
        {!active?.repoPath && p.detail && <span style={{ flex: 1, minWidth: 0, ...text.faint(), fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.detail}</span>}
        <button type="button" className="hv" title="新建项目上下文" onClick={() => setCreating((v) => !v)} style={{ width: 27, height: 27, flex: 'none', borderRadius: R.sm, border: `0.5px solid ${creating ? accent(.7, .35) : hairline(.08)}`, background: creating ? fill(4) : fill(2), color: creating ? accent() : ink(2), cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Plus size={13} /></button>
      </div>
      {creating && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(100px,.7fr) minmax(160px,1.3fr) auto', gap: 6 }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} placeholder="项目名称" style={inputStyle} />
          <input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} placeholder="仓库路径（可选）" style={{ ...inputStyle, fontFamily: 'ui-monospace,monospace' }} />
          <button type="button" onClick={save} disabled={!name.trim()} style={{ height: 28, padding: '0 10px', borderRadius: R.sm, border: 0, background: name.trim() ? gradient.primary() : fill(2), color: name.trim() ? gradient.onPrimary() : ink(4), cursor: name.trim() ? 'pointer' : 'default', fontFamily: 'var(--font)', fontSize: FS.small, fontWeight: 700 }}>创建</button>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box', width: '100%', minWidth: 0, height: 28, ...surface.inset(), borderRadius: R.sm,
  color: ink(1), outline: 'none', padding: '0 8px', fontFamily: 'var(--font)', fontSize: FS.small
}
