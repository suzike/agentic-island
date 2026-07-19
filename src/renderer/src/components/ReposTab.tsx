// 仓库中心：① 本地仓库 git 状态 ② GitHub 我的账号+仓库 ③ 日/周/月高星 trending。
// 语言色可视化 · 星标/fork 统计 · Top 语言条 · AI 解读单个项目 · AI 按你的口味推荐。
// 设计系统重做：ui/tokens 层级表面 + lucide 语义图标 + framer-motion 入场（功能零改动）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown, ArrowUp, Copy, ExternalLink, FolderGit2, FolderOpen, GitBranch, GitFork, Github,
  Lock, Plus, RefreshCw, Search, Sparkles, Star, TrendingUp, X
} from 'lucide-react'
import type { GitHubRepo } from '../../../shared/protocol'
import { island } from '../bridge'
import { Markdown } from './Markdown'
import { Button, Chip, EmptyState, IconButton, Input, Segmented } from '../ui/components'
import { fadeScaleIn } from '../ui/motion'
import { accent, fill, FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'

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

/** 原生输入框（密码/等宽路径用，样式对齐 inset 井） */
const rawInput = (mono = false): React.CSSProperties => ({
  flex: 1, minWidth: 0, height: 32, ...surface.inset(), outline: 'none',
  color: ink(1), fontSize: FS.small, padding: '0 11px',
  ...(mono ? { fontFamily: "'Cascadia Code', Consolas, ui-monospace, monospace" } : {})
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

  const repoCard = (repo: GitHubRepo): React.JSX.Element => {
    const saved = bookmarks.some((b) => b.fullName === repo.fullName)
    return (
      <motion.div key={repo.fullName} variants={fadeScaleIn} initial="initial" animate="animate" className="ai-card"
        style={{ padding: `${SP.md}px ${SP.md + 1}px`, ...surface.card(), display: 'flex', flexDirection: 'column', gap: SP.sm - 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {repo.avatar && <img src={repo.avatar} alt="" style={{ width: 20, height: 20, borderRadius: R.sm - 1, flex: 'none', border: `0.5px solid ${hairline(0.12)}` }} />}
          <span className="hv" onClick={() => island.openExternal(repo.url)} style={{ flex: 1, minWidth: 0, ...text.subtitle(), fontSize: FS.body, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="在浏览器打开">{repo.fullName}</span>
          <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 3.5, color: sem.warn, fontSize: FS.tiny, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            <Star size={11} strokeWidth={2} fill="currentColor" />{fmtK(repo.stars)}
          </span>
          {repo.forks > 0 && (
            <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 3, color: ink(3), fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
              <GitFork size={10} strokeWidth={1.75} />{fmtK(repo.forks)}
            </span>
          )}
        </div>
        {repo.desc && <div style={{ ...text.dim(), fontSize: FS.tiny, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{repo.desc}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {repo.language && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: ink(2), fontSize: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: R.pill, background: langColor(repo.language) }} />{repo.language}
            </span>
          )}
          {repo.topics.slice(0, 3).map((t) => (
            <span key={t} style={{ padding: '1px 7px', borderRadius: R.pill, background: semBg(accent(), 0.12), color: accent(0.82, 0.85), fontSize: 8.5, fontWeight: 600 }}>{t}</span>
          ))}
          <span style={{ flex: 1 }} />
          <span className="hv" title={saved ? '取消收藏' : '收藏'} onClick={() => onToggleBookmark(repo)}
            style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: R.sm, cursor: 'pointer', color: saved ? sem.warn : ink(4) }}>
            <Star size={13} strokeWidth={1.75} fill={saved ? 'currentColor' : 'none'} />
          </span>
          <IconButton icon={Copy} size={22} title="复制 git clone 命令" style={{ borderRadius: R.sm, background: 'transparent' }}
            onClick={() => navigator.clipboard?.writeText(`git clone ${repo.url}.git`).catch(() => {})} />
          <Button sm variant="tinted" icon={Sparkles} onClick={() => void explain(repo)}
            style={{ flex: 'none', padding: '2px 10px', fontSize: 10 }}>
            {aiBusy === repo.fullName ? '解读中…' : 'AI 解读'}
          </Button>
        </div>
        {aiSummary[repo.fullName] && (
          <div style={{ ...surface.inset(), padding: '7px 10px', fontSize: FS.tiny, lineHeight: 1.55 }}>
            <Markdown text={aiSummary[repo.fullName]} />
          </div>
        )}
      </motion.div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP.md - 2 }}>
      {/* 视图切换 */}
      <Segmented
        options={[
          { key: 'trending', label: '热门', icon: TrendingUp },
          { key: 'github', label: 'GitHub', icon: Github },
          { key: 'saved', label: `收藏${bookmarks.length ? ' ' + bookmarks.length : ''}`, icon: Star },
          { key: 'local', label: `本地${repos.length ? ' ' + repos.length : ''}`, icon: FolderGit2 }
        ]}
        value={view}
        onChange={setView}
        style={{ alignSelf: 'flex-start' }}
      />
      {err && <div style={{ color: sem.danger, fontSize: FS.small }}>{err}</div>}

      {/* Top 语言条 */}
      {(view === 'trending' || view === 'github') && langDist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', height: 8, borderRadius: R.pill, overflow: 'hidden', background: fill(2) }}>
            {langDist.map((l) => <div key={l.lang} title={`${l.lang} ${Math.round(l.pct)}%`} style={{ width: `${l.pct}%`, background: langColor(l.lang) }} />)}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {langDist.map((l) => (
              <span key={l.lang} className="hv" onClick={() => view === 'trending' && setLangFilter(langFilter === l.lang ? '' : l.lang)}
                style={{ display: 'flex', alignItems: 'center', gap: 3.5, color: langFilter === l.lang ? accent(0.88) : ink(3), fontSize: 9.5, cursor: view === 'trending' ? 'pointer' : 'default', fontWeight: langFilter === l.lang ? 700 : 400 }}>
                <span style={{ width: 7, height: 7, borderRadius: R.pill, background: langColor(l.lang) }} />{l.lang}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 热门 */}
      {view === 'trending' && (
        <>
          {/* 搜索 GitHub */}
          <div style={{ display: 'flex', gap: 6 }}>
            <Input value={searchQ} onChange={setSearchQ} onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }} placeholder="搜索 GitHub 仓库…（回车）" icon={Search} style={{ flex: 1 }} />
            {searchResults && <Button variant="ghost" onClick={() => { setSearchResults(null); setSearchQ('') }}>清除</Button>}
            <Button variant="primary" icon={Search} onClick={doSearch}>搜</Button>
          </div>
          {!searchResults && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Segmented
                options={[{ key: 'daily', label: '今日' }, { key: 'weekly', label: '本周' }, { key: 'monthly', label: '本月' }]}
                value={range}
                onChange={setRange}
              />
              {langFilter && (
                <Chip active onClick={() => setLangFilter('')} title="清除语言筛选">
                  <span style={{ width: 7, height: 7, borderRadius: R.pill, background: langColor(langFilter) }} />
                  {langFilter}
                  <X size={10} strokeWidth={2} />
                </Chip>
              )}
              <span style={{ flex: 1 }} />
              <IconButton icon={RefreshCw} onClick={refreshTrending} title="刷新" />
              <Button sm variant="primary" icon={Sparkles} onClick={() => void doRecommend()}>
                {recBusy ? '推荐中…' : 'AI 推荐'}
              </Button>
            </div>
          )}
          {recommend && !searchResults && (
            <div style={{ padding: SP.md - 1, ...surface.card(), fontSize: FS.small, lineHeight: 1.6 }}>
              <Markdown text={recommend} />
            </div>
          )}
          {loading
            ? <div style={{ ...text.faint(), padding: '20px 0', textAlign: 'center' }}>加载中…</div>
            : (searchResults ?? trending.filter((r) => !langFilter || r.language === langFilter)).map(repoCard)}
        </>
      )}

      {/* GitHub 我的 */}
      {view === 'github' && (
        <>
          {!myUser ? (
            <motion.div variants={fadeScaleIn} initial="initial" animate="animate" className="ai-card"
              style={{ display: 'flex', flexDirection: 'column', gap: SP.sm + 1, padding: SP.lg - 2, ...surface.card() }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Github size={14} strokeWidth={1.75} style={{ color: accent(), flex: 'none' }} />
                <span style={text.subtitle()}>连接你的 GitHub（3 步）</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  '① 点下方蓝色按钮 → 浏览器打开 GitHub 的建 Token 页（已帮你勾好权限）',
                  '② 页面最下方点绿色「Generate token」,复制生成的 ghp_… 串',
                  '③ 粘回下面输入框,点「连接」即可'
                ].map((s, i) => <div key={i} style={{ ...text.dim(), fontSize: FS.tiny, lineHeight: 1.55 }}>{s}</div>)}
              </div>
              <Button variant="primary" icon={ExternalLink} onClick={() => island.openExternal('https://github.com/settings/tokens/new?description=Agentic-Island&scopes=repo,read:user')} style={{ alignSelf: 'flex-start' }}>
                打开 GitHub 建 Token 页
              </Button>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') connect() }} type="password" placeholder="把 ghp_… 或 github_pat_… 粘到这里" style={rawInput(true)} />
                <Button variant="primary" onClick={connect}>{loading ? '…' : '连接'}</Button>
              </div>
              <div style={{ ...text.faint(), display: 'flex', alignItems: 'center', gap: 4 }}>
                <Lock size={10} strokeWidth={1.75} style={{ flex: 'none' }} />
                Token 仅本机 DPAPI 加密存储,永不上传。只读你的仓库与账号。
              </div>
            </motion.div>
          ) : (
            <>
              <motion.div variants={fadeScaleIn} initial="initial" animate="animate" className="ai-card"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `${SP.md - 1}px ${SP.md + 1}px`, ...surface.card(true) }}>
                {myUser.avatar && <img src={myUser.avatar} alt="" style={{ width: 40, height: 40, borderRadius: R.md, border: `0.5px solid ${hairline(0.12)}` }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...text.subtitle(), fontSize: FS.subtitle, fontWeight: 800 }}>{myUser.login}</div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 3 }}>
                    {[['仓库', myUser.repos], ['关注者', myUser.followers], ['关注', myUser.following]].map(([l, v]) => (
                      <span key={l as string} style={{ ...text.faint(), fontSize: 10 }}>
                        <b style={{ color: ink(1), fontVariantNumeric: 'tabular-nums' }}>{v ?? 0}</b> {l}
                      </span>
                    ))}
                  </div>
                </div>
                <Button sm variant="ghost" onClick={() => { setMyUser(null); onSetToken('') }}>断开</Button>
              </motion.div>
              {myRepos.map(repoCard)}
            </>
          )}
        </>
      )}

      {/* 收藏 */}
      {view === 'saved' && (
        bookmarks.length === 0
          ? <EmptyState icon={Star} title="还没有收藏" desc="热门里点星标收藏感兴趣的项目,这里汇总" />
          : bookmarks.map(repoCard)
      )}

      {/* 本地 */}
      {view === 'local' && (
        <>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onAdd(draft.trim()); setDraft('') } }} placeholder="粘贴本地仓库路径,如 E:\proj\thermal-ctrl" style={rawInput(true)} />
            <Button variant="primary" icon={Plus} onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft('') } }}>添加</Button>
            <IconButton icon={RefreshCw} onClick={() => void refreshLocal()} title="刷新" />
          </div>
          {repos.length === 0 && <EmptyState icon={FolderGit2} title="还没有本地仓库" desc="钉几个常用仓库,一览 git 状态" />}
          {repos.map((r) => {
            const s = status[r.path]
            const dot = s?.ok ? (s.dirty ? sem.warn : sem.calm) : ink(3)
            return (
              <motion.div key={r.path} variants={fadeScaleIn} initial="initial" animate="animate" className="ai-card"
                style={{ padding: `${SP.md - 1}px ${SP.md}px`, ...surface.card(), display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 'none', width: 8, height: 8, borderRadius: R.pill, background: dot }} />
                  <span style={{ flex: 1, minWidth: 0, ...text.subtitle(), fontSize: FS.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baseName(r.path)}</span>
                  {s?.ok && (
                    <span style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5, fontSize: FS.tiny, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 8px', borderRadius: R.pill, background: semBg(accent(), 0.14), color: accent(0.85) }}>
                        <GitBranch size={10} strokeWidth={1.75} />{s.branch}
                      </span>
                      {!!s.dirty && <span style={{ display: 'inline-flex', alignItems: 'center', color: sem.warn }}>±{s.dirty}</span>}
                      {!!s.ahead && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: sem.calm }}><ArrowUp size={9} strokeWidth={2.5} />{s.ahead}</span>}
                      {!!s.behind && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: sem.danger }}><ArrowDown size={9} strokeWidth={2.5} />{s.behind}</span>}
                    </span>
                  )}
                  <IconButton icon={FolderOpen} size={22} title="在资源管理器打开" style={{ borderRadius: R.sm, background: 'transparent' }}
                    onClick={() => island.openFolder(r.path)} />
                  <IconButton icon={X} size={22} title="移除" color={sem.danger} style={{ borderRadius: R.sm, background: 'transparent' }}
                    onClick={() => onRemove(r.path)} />
                </div>
                <div style={{ ...text.mono(10), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s?.ok ? <>· <b style={{ color: accent(0.8) }}>{s.commit}</b> {s.subject} <span style={{ opacity: 0.7 }}>· {s.when}</span></> : (s?.error || '读取中…')}
                </div>
              </motion.div>
            )
          })}
        </>
      )}
    </div>
  )
}
