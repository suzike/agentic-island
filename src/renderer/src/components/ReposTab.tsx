// 仓库中心：① 本地仓库 git 状态 ② GitHub 我的账号+仓库 ③ 日/周/月高星 trending。
// 语言色可视化 · 星标/fork 统计 · Top 语言条 · AI 解读单个项目 · AI 按你的口味推荐。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubRepo } from '../../../shared/protocol'
import { island } from '../bridge'
import { Markdown } from './Markdown'

interface Repo { path: string }
interface GitInfo { ok: boolean; branch?: string; dirty?: number; commit?: string; subject?: string; when?: string; ahead?: number; behind?: number; error?: string }

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || p
const fmtK = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n))
const LANG: Record<string, string> = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Go: '#00ADD8', Rust: '#dea584', Java: '#b07219',
  C: '#8b98a5', 'C++': '#f34b7d', 'C#': '#178600', Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF',
  Dart: '#00B4AB', Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', 'Jupyter Notebook': '#DA5B0B', MATLAB: '#e16737'
}
const langColor = (l: string): string => LANG[l] || '#8b98a5'

const chip = (active: boolean): React.CSSProperties => ({
  padding: '5px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
  background: active ? 'oklch(0.78 calc(0.16 * var(--cs, 1)) var(--th) / .22)' : 'rgba(255,255,255,.05)',
  color: active ? 'oklch(0.88 calc(0.12 * var(--cs, 1)) var(--th))' : 'oklch(0.72 0.02 var(--th) / .7)', whiteSpace: 'nowrap'
})

export function ReposTab({ repos, onAdd, onRemove, githubToken, onSetToken, onAI, interests, llmReady, bookmarks, onToggleBookmark }: {
  repos: Repo[]; onAdd: (path: string) => void; onRemove: (path: string) => void
  githubToken: string; onSetToken: (t: string) => void
  onAI: (system: string, user: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  interests: string; llmReady: boolean
  bookmarks: GitHubRepo[]; onToggleBookmark: (r: GitHubRepo) => void
}): React.JSX.Element {
  const [view, setView] = useState<'trending' | 'github' | 'local' | 'saved'>('trending')
  const [range, setRange] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [trendingCache, setTrendingCache] = useState<Record<string, GitHubRepo[]>>({})
  const [langFilter, setLangFilter] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<GitHubRepo[] | null>(null)
  const trending = trendingCache[range] || []
  const [myUser, setMyUser] = useState<{ login: string; avatar?: string; repos?: number; followers?: number; following?: number } | null>(null)
  const [myRepos, setMyRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [tokenInput, setTokenInput] = useState(githubToken)
  const [aiSummary, setAiSummary] = useState<Record<string, string>>({})
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [recommend, setRecommend] = useState('')
  const [recBusy, setRecBusy] = useState(false)
  // 本地 git 状态
  const [status, setStatus] = useState<Record<string, GitInfo>>({})
  const [draft, setDraft] = useState('')
  const reposRef = useRef(repos); reposRef.current = repos

  const refreshLocal = useCallback(async (): Promise<void> => {
    const results = await Promise.all(reposRef.current.map((r) => island.gitStatus(r.path).then((s) => [r.path, s] as const).catch(() => [r.path, { ok: false }] as const)))
    setStatus(Object.fromEntries(results))
  }, [])
  useEffect(() => { if (view === 'local') { void refreshLocal(); const t = setInterval(() => void refreshLocal(), 30000); return () => clearInterval(t) } }, [view, refreshLocal, repos.length])

  // 缓存每个 range 的结果 → 切回不重新加载、不闪
  useEffect(() => {
    if (view !== 'trending' || trendingCache[range]) return
    setLoading(true); setErr('')
    island.githubTrendingRepos(range, githubToken).then((r) => { setLoading(false); if (r.ok) setTrendingCache((c) => ({ ...c, [range]: r.repos || [] })); else setErr(r.error || '加载失败') })
  }, [view, range, githubToken, trendingCache])
  const refreshTrending = (): void => { setTrendingCache((c) => { const n = { ...c }; delete n[range]; return n }) }
  const doSearch = (): void => {
    const q = searchQ.trim(); if (!q) { setSearchResults(null); return }
    setLoading(true); setErr('')
    island.githubSearch(q, githubToken).then((r) => { setLoading(false); if (r.ok) setSearchResults(r.repos || []); else setErr(r.error || '搜索失败') })
  }

  const connect = (): void => {
    const t = tokenInput.trim(); if (!t) return
    setLoading(true); setErr('')
    island.githubMyRepos(t).then((r) => { setLoading(false); if (r.ok) { setMyUser(r.user || null); setMyRepos(r.repos || []); onSetToken(t) } else setErr(r.error || '连接失败') })
  }
  const explain = async (repo: GitHubRepo): Promise<void> => {
    if (!llmReady) { setErr('请先配置问答模型'); return }
    setAiBusy(repo.fullName)
    const rd = await island.githubReadme(repo.owner, repo.name, githubToken)
    const body = rd.ok && rd.text ? rd.text : repo.desc
    const r = await onAI(
      '你是资深工程师+技术选型顾问。基于 README 详细解读这个开源项目,用 Markdown 分小节输出(简体中文),要具体、有信息量:\n' +
      '## 它是什么（2-3 句定位）\n## 核心功能与亮点（要点列表,尽量具体）\n## 技术栈/架构（用了什么、怎么实现）\n## 典型使用场景\n## 上手难度与注意点\n## 一句话评价（值不值得关注、适合谁）\n' +
      '不要空话套话,抓 README 里的真实信息。',
      `项目 ${repo.fullName}（⭐${repo.stars} · fork ${repo.forks} · ${repo.language || '未知'}${repo.topics.length ? ' · ' + repo.topics.join('/') : ''}）\n\nREADME:\n${body.slice(0, 7000)}`
    )
    setAiBusy(null)
    if (r.ok && r.text) setAiSummary((s) => ({ ...s, [repo.fullName]: r.text!.trim() }))
  }
  const doRecommend = async (): Promise<void> => {
    if (!llmReady || !trending.length) { setErr('请先配置模型'); return }
    setRecBusy(true)
    const list = trending.slice(0, 15).map((r) => `- ${r.fullName}（⭐${r.stars} · ${r.language}）：${r.desc}`).join('\n')
    const r = await onAI(`你是技术雷达助手。用户关注：${interests || '软件工程与 AI'}。从下面热门项目里挑最相关的 3-5 个,每个一句话说为何值得关注,用 Markdown 列表。`, list)
    setRecBusy(false)
    if (r.ok && r.text) setRecommend(r.text.trim())
  }

  // Top 语言分布（trending 或我的仓库）
  const langDist = useMemo(() => {
    const src = view === 'github' ? myRepos : trending
    const m = new Map<string, number>()
    src.forEach((r) => { if (r.language) m.set(r.language, (m.get(r.language) || 0) + 1) })
    const total = [...m.values()].reduce((a, b) => a + b, 0) || 1
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([lang, n]) => ({ lang, pct: (n / total) * 100 }))
  }, [view, trending, myRepos])

  const repoCard = (repo: GitHubRepo): React.JSX.Element => (
    <div key={repo.fullName} className="ai-card" style={{ padding: '11px 13px', borderRadius: 13, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {repo.avatar && <img src={repo.avatar} alt="" style={{ width: 20, height: 20, borderRadius: 6, flex: 'none' }} />}
        <span className="hv" onClick={() => island.openExternal(repo.url)} style={{ flex: 1, minWidth: 0, color: 'oklch(0.94 0.02 var(--th))', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="在浏览器打开">{repo.fullName}</span>
        <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 3, color: 'oklch(0.82 0.13 85)', fontSize: 10.5, fontWeight: 700 }}>⭐ {fmtK(repo.stars)}</span>
        {repo.forks > 0 && <span style={{ flex: 'none', color: 'oklch(0.62 0.02 var(--th) / .6)', fontSize: 9.5 }}>⑂ {fmtK(repo.forks)}</span>}
      </div>
      {repo.desc && <div style={{ color: 'oklch(0.78 0.02 var(--th) / .8)', fontSize: 10.5, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{repo.desc}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {repo.language && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'oklch(0.7 0.02 var(--th) / .75)', fontSize: 9.5 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: langColor(repo.language) }} />{repo.language}</span>}
        {repo.topics.slice(0, 3).map((t) => <span key={t} style={{ padding: '1px 7px', borderRadius: 999, background: 'oklch(0.35 0.06 var(--th) / .4)', color: 'oklch(0.8 0.08 var(--th))', fontSize: 8.5 }}>{t}</span>)}
        <span style={{ flex: 1 }} />
        <span className="hv" title={bookmarks.some((b) => b.fullName === repo.fullName) ? '取消收藏' : '收藏'} onClick={() => onToggleBookmark(repo)} style={{ flex: 'none', cursor: 'pointer', fontSize: 12, color: bookmarks.some((b) => b.fullName === repo.fullName) ? 'oklch(0.82 0.14 85)' : 'oklch(0.55 0.02 var(--th) / .45)' }}>{bookmarks.some((b) => b.fullName === repo.fullName) ? '★' : '☆'}</span>
        <span className="hv" title="复制 git clone 命令" onClick={() => navigator.clipboard?.writeText(`git clone ${repo.url}.git`).catch(() => {})} style={{ flex: 'none', cursor: 'pointer', color: 'oklch(0.65 0.02 var(--th) / .6)', fontSize: 11 }}>📋</span>
        <span className="hv" onClick={() => void explain(repo)} style={{ flex: 'none', padding: '2px 9px', borderRadius: 999, background: 'oklch(0.5 0.12 var(--th) / .4)', color: 'oklch(0.9 0.1 var(--th))', fontSize: 9.5, fontWeight: 700, cursor: 'pointer' }}>{aiBusy === repo.fullName ? '解读中…' : '✨ AI 解读'}</span>
      </div>
      {aiSummary[repo.fullName] && <div style={{ padding: '7px 9px', borderRadius: 9, background: 'oklch(0.3 0.05 var(--th) / .3)', fontSize: 10.5, lineHeight: 1.55 }}><Markdown text={aiSummary[repo.fullName]} /></div>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 视图切换 */}
      <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,.22)', borderRadius: 9, padding: 2, alignSelf: 'flex-start' }}>
        <span className="hv" onClick={() => setView('trending')} style={chip(view === 'trending')}>🔥 热门</span>
        <span className="hv" onClick={() => setView('github')} style={chip(view === 'github')}>🐙 GitHub</span>
        <span className="hv" onClick={() => setView('saved')} style={chip(view === 'saved')}>⭐ 收藏 {bookmarks.length || ''}</span>
        <span className="hv" onClick={() => setView('local')} style={chip(view === 'local')}>📁 本地 {repos.length || ''}</span>
      </div>
      {err && <div style={{ color: 'oklch(0.75 0.1 30)', fontSize: 11 }}>{err}</div>}

      {/* Top 语言条 */}
      {(view === 'trending' || view === 'github') && langDist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden' }}>
            {langDist.map((l) => <div key={l.lang} title={`${l.lang} ${Math.round(l.pct)}%`} style={{ width: `${l.pct}%`, background: langColor(l.lang) }} />)}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {langDist.map((l) => <span key={l.lang} className="hv" onClick={() => view === 'trending' && setLangFilter(langFilter === l.lang ? '' : l.lang)} style={{ display: 'flex', alignItems: 'center', gap: 3, color: langFilter === l.lang ? 'oklch(0.9 0.1 var(--th))' : 'oklch(0.68 0.02 var(--th) / .7)', fontSize: 9, cursor: view === 'trending' ? 'pointer' : 'default', fontWeight: langFilter === l.lang ? 700 : 400 }}><span style={{ width: 7, height: 7, borderRadius: 999, background: langColor(l.lang) }} />{l.lang}</span>)}
          </div>
        </div>
      )}

      {/* 热门 */}
      {view === 'trending' && (
        <>
          {/* 搜索 GitHub */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }} placeholder="🔍 搜索 GitHub 仓库…（回车）" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 9, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11.5, padding: '7px 11px' }} />
            {searchResults && <div className="hv" onClick={() => { setSearchResults(null); setSearchQ('') }} style={{ padding: '0 12px', borderRadius: 9, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.8 0.02 var(--th))', fontSize: 11 }}>清除</div>}
            <div className="hv" onClick={doSearch} style={{ padding: '0 14px', borderRadius: 9, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 12, fontWeight: 700 }}>搜</div>
          </div>
          {!searchResults && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,.22)', borderRadius: 8, padding: 2 }}>
                {([['daily', '今日'], ['weekly', '本周'], ['monthly', '本月']] as const).map(([k, l]) => <span key={k} className="hv" onClick={() => setRange(k)} style={{ ...chip(range === k), padding: '4px 11px' }}>{l}</span>)}
              </div>
              {langFilter && <span className="hv" onClick={() => setLangFilter('')} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 999, background: 'oklch(0.4 0.08 var(--th) / .4)', color: 'oklch(0.88 0.1 var(--th))', fontSize: 9.5, cursor: 'pointer' }}><span style={{ width: 7, height: 7, borderRadius: 999, background: langColor(langFilter) }} />{langFilter} ✕</span>}
              <span style={{ flex: 1 }} />
              <span className="hv" onClick={refreshTrending} title="刷新" style={{ cursor: 'pointer', color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 13 }}>↻</span>
              <span className="hv" onClick={() => void doRecommend()} style={{ padding: '5px 11px', borderRadius: 8, cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.7 0.14 var(--th) / .5), oklch(0.55 0.13 var(--th2) / .4))', color: 'oklch(0.95 0.02 var(--th))', fontSize: 10.5, fontWeight: 700 }}>{recBusy ? '推荐中…' : '🎯 AI 推荐'}</span>
            </div>
          )}
          {recommend && !searchResults && <div style={{ padding: 11, borderRadius: 12, background: 'oklch(0.3 0.05 var(--th) / .3)', border: '1px solid oklch(0.6 0.1 var(--th) / .3)', fontSize: 11, lineHeight: 1.6 }}><Markdown text={recommend} /></div>}
          {loading ? <div style={{ color: 'oklch(0.6 0.02 var(--th) / .6)', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>加载中…</div> : (searchResults ?? trending.filter((r) => !langFilter || r.language === langFilter)).map(repoCard)}
        </>
      )}

      {/* GitHub 我的 */}
      {view === 'github' && (
        <>
          {!myUser ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 14, borderRadius: 13, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)' }}>
              <div style={{ color: 'oklch(0.9 0.02 var(--th))', fontSize: 13, fontWeight: 700 }}>🐙 连接你的 GitHub（3 步）</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  '① 点下方蓝色按钮 → 浏览器打开 GitHub 的建 Token 页（已帮你勾好权限）',
                  '② 页面最下方点绿色「Generate token」,复制生成的 ghp_… 串',
                  '③ 粘回下面输入框,点「连接」即可'
                ].map((s, i) => <div key={i} style={{ color: 'oklch(0.75 0.02 var(--th) / .8)', fontSize: 10.5, lineHeight: 1.55 }}>{s}</div>)}
              </div>
              <div className="hv" onClick={() => island.openExternal('https://github.com/settings/tokens/new?description=Agentic-Island&scopes=repo,read:user')} style={{ alignSelf: 'flex-start', padding: '7px 14px', borderRadius: 9, cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.6 0.13 250), oklch(0.5 0.14 260))', color: '#fff', fontSize: 11.5, fontWeight: 700 }}>🔗 打开 GitHub 建 Token 页</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') connect() }} type="password" placeholder="把 ghp_… 或 github_pat_… 粘到这里" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11, padding: '7px 10px', fontFamily: 'ui-monospace,monospace' }} />
                <div className="hv" onClick={connect} style={{ padding: '0 14px', borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 11.5, fontWeight: 700 }}>{loading ? '…' : '连接'}</div>
              </div>
              <div style={{ color: 'oklch(0.58 0.02 var(--th) / .55)', fontSize: 9.5 }}>🔒 Token 仅本机 DPAPI 加密存储,永不上传。只读你的仓库与账号。</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderRadius: 13, background: 'linear-gradient(160deg, oklch(0.32 0.06 var(--th) / .35), oklch(0.2 0.03 var(--th) / .4))', border: '1px solid oklch(0.6 0.1 var(--th) / .3)' }}>
                {myUser.avatar && <img src={myUser.avatar} alt="" style={{ width: 40, height: 40, borderRadius: 12 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'oklch(0.95 0.02 var(--th))', fontSize: 13.5, fontWeight: 800 }}>{myUser.login}</div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 3 }}>
                    {[['仓库', myUser.repos], ['关注者', myUser.followers], ['关注', myUser.following]].map(([l, v]) => <span key={l as string} style={{ color: 'oklch(0.7 0.02 var(--th) / .7)', fontSize: 10 }}><b style={{ color: 'oklch(0.9 0.06 var(--th))' }}>{v ?? 0}</b> {l}</span>)}
                  </div>
                </div>
                <span className="hv" onClick={() => { setMyUser(null); onSetToken('') }} style={{ cursor: 'pointer', color: 'oklch(0.6 0.02 var(--th) / .5)', fontSize: 10 }}>断开</span>
              </div>
              {myRepos.map(repoCard)}
            </>
          )}
        </>
      )}

      {/* 收藏 */}
      {view === 'saved' && (
        bookmarks.length === 0
          ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '26px 14px', borderRadius: 14, background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.09)' }}><div style={{ fontSize: 22, opacity: 0.6 }}>⭐</div><div style={{ color: 'oklch(0.75 0.02 var(--th) / .8)', fontSize: 12 }}>热门里点 ☆ 收藏感兴趣的项目,这里汇总</div></div>
          : bookmarks.map(repoCard)
      )}

      {/* 本地 */}
      {view === 'local' && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onAdd(draft.trim()); setDraft('') } }} placeholder="粘贴本地仓库路径,如 E:\\proj\\thermal-ctrl" style={{ flex: 1, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 9, outline: 'none', color: 'oklch(0.93 0.01 var(--th))', fontSize: 11.5, padding: '8px 11px', fontFamily: 'ui-monospace,monospace' }} />
            <div className="hv" onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft('') } }} style={{ padding: '0 14px', borderRadius: 9, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'linear-gradient(180deg, oklch(0.82 calc(0.16 * var(--cs, 1)) var(--th)), oklch(0.7 calc(0.16 * var(--cs, 1)) var(--th)))', color: 'oklch(0.14 0.02 var(--th))', fontSize: 13, fontWeight: 700 }}>＋</div>
            <div className="hv" onClick={() => void refreshLocal()} title="刷新" style={{ padding: '0 12px', borderRadius: 9, display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'oklch(0.8 0.02 var(--th))', fontSize: 13 }}>↻</div>
          </div>
          {repos.length === 0 && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '26px 14px', borderRadius: 14, background: 'rgba(255,255,255,.03)', border: '1px dashed rgba(255,255,255,.09)' }}><div style={{ fontSize: 22, opacity: 0.6 }}>📁</div><div style={{ color: 'oklch(0.75 0.02 var(--th) / .8)', fontSize: 12 }}>钉几个常用仓库,一览 git 状态</div></div>}
          {repos.map((r) => {
            const s = status[r.path]
            return (
              <div key={r.path} className="ai-card" style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13 }}>{s?.ok ? (s.dirty ? '🟡' : '🟢') : '⚪'}</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'oklch(0.94 0.02 var(--th))', fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseName(r.path)}</span>
                  {s?.ok && <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4, color: 'oklch(0.82 calc(0.1 * var(--cs, 1)) var(--th))', fontSize: 10.5, fontWeight: 600 }}><span style={{ padding: '1px 7px', borderRadius: 999, background: 'oklch(0.35 0.07 var(--th) / .5)' }}>⑂ {s.branch}</span>{!!s.dirty && <span style={{ color: 'oklch(0.82 0.13 75)' }}>±{s.dirty}</span>}{!!s.ahead && <span style={{ color: 'oklch(0.8 0.13 145)' }}>↑{s.ahead}</span>}{!!s.behind && <span style={{ color: 'oklch(0.78 0.12 30)' }}>↓{s.behind}</span>}</span>}
                  <span className="hv" onClick={() => island.openFolder(r.path)} title="在资源管理器打开" style={{ flex: 'none', cursor: 'pointer', color: 'oklch(0.72 0.02 var(--th) / .7)', fontSize: 12 }}>📂</span>
                  <span className="hv" onClick={() => onRemove(r.path)} title="移除" style={{ flex: 'none', cursor: 'pointer', color: 'oklch(0.6 0.05 25 / .8)', fontSize: 11 }}>✕</span>
                </div>
                <div style={{ color: 'oklch(0.66 0.02 var(--th) / .62)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s?.ok ? <>· <b style={{ color: 'oklch(0.78 calc(0.08 * var(--cs, 1)) var(--th))' }}>{s.commit}</b> {s.subject} <span style={{ opacity: 0.7 }}>· {s.when}</span></> : (s?.error || '读取中…')}</div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
