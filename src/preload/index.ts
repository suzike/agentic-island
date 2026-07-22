import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DecisionMessage, IslandSnapshot, IslandBridgeApi, LlmRequestConfig, RecordingExportProgress, RecordingExportRequest, RecordingProjectSaveInput, RecordingSessionCreateInput, ScreenshotCapture, ScreenshotTarget, TerminalShellProfile, TerminalWorkspaceState } from '../shared/protocol'

const api: IslandBridgeApi = {
  getRuntimeInfo: () => ipcRenderer.invoke('runtime-info'),
  onSnapshot: (cb: (snap: IslandSnapshot) => void): (() => void) => {
    const handler = (_e: unknown, snap: IslandSnapshot): void => cb(snap)
    ipcRenderer.on('snapshot', handler)
    return () => ipcRenderer.removeListener('snapshot', handler)
  },
  getSnapshot: (): Promise<IslandSnapshot> => ipcRenderer.invoke('get-snapshot'),
  decide: (msg: DecisionMessage): void => ipcRenderer.send('decide', msg),
  jumpToTerminal: (agentId: string): Promise<boolean> => ipcRenderer.invoke('jump-to-terminal', agentId),
  onExternalYield: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('external-yield', handler)
    return () => ipcRenderer.removeListener('external-yield', handler)
  },
  setNativeDialogOpen: (active: boolean): void => ipcRenderer.send('set-native-dialog-open', active),
  setIgnoreMouse: (ignore: boolean): void => ipcRenderer.send('set-ignore-mouse', ignore),
  playSound: (key: string): void => ipcRenderer.send('play-sound', key),
  setAutostart: (on: boolean): void => ipcRenderer.send('set-autostart', on),
  reposition: (opts: { follow: boolean; monitorIndex: number }): void => ipcRenderer.send('reposition', opts),
  setSizeMode: (large: boolean): void => ipcRenderer.send('set-size-mode', large),
  setFullMode: (full: boolean): void => ipcRenderer.send('set-full-mode', full),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setIslandWidth: (w: number): void => ipcRenderer.send('set-island-width', w),
  setZoom: (z: number): void => ipcRenderer.send('set-zoom', z),
  githubTrending: () => ipcRenderer.invoke('github-trending'),
  githubTrendingRepos: (range: string, token?: string) => ipcRenderer.invoke('github-trending-repos', range, token),
  githubMyRepos: (token: string) => ipcRenderer.invoke('github-my-repos', token),
  githubSearch: (q: string, token?: string) => ipcRenderer.invoke('github-search', q, token),
  githubReadme: (owner: string, repo: string, token?: string) => ipcRenderer.invoke('github-readme', owner, repo, token),
  rssFetch: (url: string) => ipcRenderer.invoke('rss-fetch', url),
  onCapsuleToggle: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('capsule-toggle', handler)
    return () => ipcRenderer.removeListener('capsule-toggle', handler)
  },
  capsuleClosed: (): void => ipcRenderer.send('capsule-closed'),
  onPaletteToggle: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('palette-toggle', handler)
    return () => ipcRenderer.removeListener('palette-toggle', handler)
  },
  onBrainToggle: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('brain-toggle', handler)
    return () => ipcRenderer.removeListener('brain-toggle', handler)
  },
  onDnd: (cb: (active: boolean) => void): (() => void) => {
    const handler = (_e: unknown, active: boolean): void => cb(active)
    ipcRenderer.on('dnd-state', handler)
    return () => ipcRenderer.removeListener('dnd-state', handler)
  },
  setDnd: (active: boolean): void => ipcRenderer.send('set-dnd', active),
  toggleWidget: (active: boolean): void => ipcRenderer.send('toggle-widget', active),
  widgetPush: (data: Record<string, unknown>): void => ipcRenderer.send('widget-push', data),
  widgetReveal: (): void => ipcRenderer.send('widget-reveal'),
  onWidgetData: (cb: (data: Record<string, unknown>) => void): (() => void) => {
    const handler = (_e: unknown, data: Record<string, unknown>): void => cb(data)
    ipcRenderer.on('widget-data', handler)
    return () => ipcRenderer.removeListener('widget-data', handler)
  },
  toggleSticky: (note: Record<string, unknown>): void => ipcRenderer.send('toggle-sticky', note),
  stickyPush: (note: Record<string, unknown>): void => ipcRenderer.send('sticky-push', note),
  closeSticky: (id: number): void => ipcRenderer.send('close-sticky', id),
  onStickyData: (cb: (note: Record<string, unknown>) => void): (() => void) => {
    const handler = (_e: unknown, note: Record<string, unknown>): void => cb(note)
    ipcRenderer.on('sticky-data', handler)
    return () => ipcRenderer.removeListener('sticky-data', handler)
  },
  onScreenshot: (cb: (capture: ScreenshotCapture) => void): (() => void) => {
    const handler = (_e: unknown, capture: ScreenshotCapture): void => cb(capture)
    ipcRenderer.on('screenshot-captured', handler)
    return () => ipcRenderer.removeListener('screenshot-captured', handler)
  },
  installHooks: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('install-hooks'),
  uninstallHooks: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('uninstall-hooks'),
  llmComplete: (cfg: LlmRequestConfig, system: string, user: string | Array<Record<string, unknown>>, deep?: boolean, history?: { role: 'user' | 'assistant'; content: string }[]) =>
    ipcRenderer.invoke('llm-complete', cfg, system, user, deep, history),
  openExternal: (url: string): void => ipcRenderer.send('open-external', url),
  llmTest: (cfg: LlmRequestConfig) => ipcRenderer.invoke('llm-test', cfg),
  llmListModels: (cfg: LlmRequestConfig) => ipcRenderer.invoke('llm-list-models', cfg),
  llmEmbed: (cfg: LlmRequestConfig, texts: string[]) => ipcRenderer.invoke('llm-embed', cfg, texts),
  kbList: () => ipcRenderer.invoke('kb-list'),
  kbAddFolder: (cfg: LlmRequestConfig) => ipcRenderer.invoke('kb-add-folder', cfg),
  kbAddFiles: (cfg: LlmRequestConfig) => ipcRenderer.invoke('kb-add-files', cfg),
  kbAddUrl: (cfg: LlmRequestConfig, url: string) => ipcRenderer.invoke('kb-add-url', cfg, url),
  kbAddText: (cfg: LlmRequestConfig, title: string, text: string, sourceKey: string) => ipcRenderer.invoke('kb-add-text', cfg, title, text, sourceKey),
  kbRemove: (id: string) => ipcRenderer.invoke('kb-remove', id),
  kbReindex: (cfg: LlmRequestConfig) => ipcRenderer.invoke('kb-reindex', cfg),
  kbSearch: (cfg: LlmRequestConfig, query: string, k?: number) => ipcRenderer.invoke('kb-search', cfg, query, k),
  kbSampleChunks: (max?: number, sourceId?: string) => ipcRenderer.invoke('kb-sample-chunks', max, sourceId),
  kbGetWiki: () => ipcRenderer.invoke('kb-get-wiki'),
  kbSaveWiki: (key: string, md: string) => ipcRenderer.invoke('kb-save-wiki', key, md),
  agentCliCheck: (engine: 'claude' | 'codex') => ipcRenderer.invoke('agent-cli-check', engine),
  agentCliStream: (engine: 'claude' | 'codex', prompt: string, cwd?: string, cont?: boolean) => ipcRenderer.invoke('agent-cli-stream', engine, prompt, cwd, cont),
  agentCliCancel: (engine: 'claude' | 'codex'): void => ipcRenderer.send('agent-cli-cancel', engine),
  onAgentCliEvent: (cb: (p: { runId: string; ev: import('../shared/protocol').AgentCliEvent }) => void): (() => void) => {
    const handler = (_e: unknown, p: { runId: string; ev: import('../shared/protocol').AgentCliEvent }): void => cb(p)
    ipcRenderer.on('agent-cli-event', handler)
    return () => ipcRenderer.removeListener('agent-cli-event', handler)
  },
  shortcutShell: (cmd: string, cwd?: string) => ipcRenderer.invoke('shortcut-shell', cmd, cwd),
  shortcutOpen: (target: string) => ipcRenderer.invoke('shortcut-open', target),
  clipReadText: () => ipcRenderer.invoke('clip-read-text'),
  clipWriteText: (t: string): void => ipcRenderer.send('clip-write-text', t),
  triggerScreenshot: (target: ScreenshotTarget = 'ask'): void => ipcRenderer.send('trigger-screenshot', target),
  recordingSources: () => ipcRenderer.invoke('recording-sources'),
  recordingCursor: () => ipcRenderer.invoke('recording-cursor'),
  setRecordingProtection: (active: boolean): void => ipcRenderer.send('recording-protection', active),
  recordingAnimeModel: (model) => ipcRenderer.invoke('recording-anime-model', model),
  prepareRecordingPreview: (data: ArrayBuffer) => ipcRenderer.invoke('recording-preview', data),
  releaseRecordingPreview: (id: string): void => ipcRenderer.send('recording-preview-release', id),
  createRecordingSession: (input: RecordingSessionCreateInput) => ipcRenderer.invoke('recording-session-create', input),
  appendRecordingChunk: (id: string, index: number, data: ArrayBuffer) => ipcRenderer.invoke('recording-session-append', id, index, data),
  finalizeRecordingSession: (id: string, durationMs: number) => ipcRenderer.invoke('recording-session-finalize', id, durationMs),
  listRecordingSessions: () => ipcRenderer.invoke('recording-session-list'),
  recoverRecordingSession: (id: string) => ipcRenderer.invoke('recording-session-recover', id),
  discardRecordingSession: (id: string) => ipcRenderer.invoke('recording-session-discard', id),
  exportRecording: (data: ArrayBuffer, request: RecordingExportRequest) => ipcRenderer.invoke('recording-export', data, request),
  exportRecordingSession: (id: string, request: RecordingExportRequest) => ipcRenderer.invoke('recording-export-session', id, request),
  transcribeRecordingSession: (id, cfg, model, language) => ipcRenderer.invoke('recording-transcribe-session', id, cfg, model, language),
  saveRecordingProject: (input: RecordingProjectSaveInput) => ipcRenderer.invoke('recording-project-save', input),
  listRecordingProjects: () => ipcRenderer.invoke('recording-project-list'),
  loadRecordingProject: (id: string) => ipcRenderer.invoke('recording-project-load', id),
  duplicateRecordingProject: (id: string) => ipcRenderer.invoke('recording-project-duplicate', id),
  deleteRecordingProject: (id: string) => ipcRenderer.invoke('recording-project-delete', id),
  cancelRecordingExport: (jobId: string): void => ipcRenderer.send('recording-export-cancel', jobId),
  onRecordingExportProgress: (cb: (progress: RecordingExportProgress) => void): (() => void) => {
    const handler = (_e: unknown, progress: RecordingExportProgress): void => cb(progress)
    ipcRenderer.on('recording-export-progress', handler)
    return () => ipcRenderer.removeListener('recording-export-progress', handler)
  },
  copyImage: (dataUrl: string) => ipcRenderer.invoke('copy-image', dataUrl),
  saveImage: (dataUrl: string, name: string) => ipcRenderer.invoke('save-image', dataUrl, name),
  openImageFile: () => ipcRenderer.invoke('open-image-file'),
  readClipboardImage: () => ipcRenderer.invoke('read-clipboard-image'),
  fetchCalendar: (url: string) => ipcRenderer.invoke('calendar-fetch', url),
  fetchUrlText: (url: string) => ipcRenderer.invoke('fetch-url-text', url),
  fetchCaldav: (cfg: { server: string; username: string; password: string }) => ipcRenderer.invoke('caldav-fetch', cfg),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  openMdFile: () => ipcRenderer.invoke('open-md-file'),
  saveMdFile: (content: string, suggestName: string, existingPath?: string) => ipcRenderer.invoke('save-md-file', content, suggestName, existingPath),
  exportPdf: (html: string, name: string) => ipcRenderer.invoke('export-pdf', html, name),
  saveText: (content: string, name: string, ext: string) => ipcRenderer.invoke('save-text', content, name, ext),
  gitStatus: (dir: string) => ipcRenderer.invoke('git-status', dir),
  openFolder: (dir: string): void => ipcRenderer.send('open-folder', dir),
  pickDirectory: (initialPath?: string) => ipcRenderer.invoke('pick-directory', initialPath),
  mediaInfo: () => ipcRenderer.invoke('media-info'),
  lyricsFetch: (title: string, artist: string) => ipcRenderer.invoke('lyrics-fetch', title, artist),
  mediaKey: (cmd: string): void => ipcRenderer.send('media-key', cmd),
  ptyEnsure: (id: string, cols: number, rows: number, cwd?: string, profile?: TerminalShellProfile, env?: Record<string, string>) => ipcRenderer.invoke('pty-ensure', id, cols, rows, cwd, profile, env),
  ptyInput: (id: string, data: string): void => ipcRenderer.send('pty-input', id, data),
  ptyResize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty-resize', id, cols, rows),
  ptyKill: (id: string): void => ipcRenderer.send('pty-kill', id),
  onPtyData: (cb: (id: string, data: string) => void): (() => void) => {
    const handler = (_e: unknown, p: { id: string; data: string }): void => cb(p.id, p.data)
    ipcRenderer.on('pty-data', handler)
    return () => ipcRenderer.removeListener('pty-data', handler)
  },
  loadTerminalWorkspace: (): Promise<TerminalWorkspaceState> => ipcRenderer.invoke('terminal-workspace-load'),
  saveTerminalWorkspace: (state: TerminalWorkspaceState): void => ipcRenderer.send('terminal-workspace-save', state),
  clearTerminalSnapshots: (): Promise<TerminalWorkspaceState> => ipcRenderer.invoke('terminal-workspace-clear-snapshots'),
  inspectTerminalProject: (cwd: string) => ipcRenderer.invoke('terminal-project-inspect', cwd),
  exportTerminalWorkspace: (state: TerminalWorkspaceState) => ipcRenderer.invoke('terminal-workspace-export', state),
  importTerminalWorkspace: () => ipcRenderer.invoke('terminal-workspace-import'),
  pathForFile: (file: unknown): string => webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0]),
  onClipboard: (cb: (item: { kind: 'text' | 'image'; text?: string; dataUrl?: string }) => void): (() => void) => {
    const handler = (_e: unknown, item: { kind: 'text' | 'image'; text?: string; dataUrl?: string }): void => cb(item)
    ipcRenderer.on('clipboard-new', handler)
    return () => ipcRenderer.removeListener('clipboard-new', handler)
  },
  onReveal: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('reveal', handler)
    return () => ipcRenderer.removeListener('reveal', handler)
  },
  quitApp: (): void => ipcRenderer.send('app-quit'),
  loadState: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('load-state'),
  saveState: (state: Record<string, unknown>): void => ipcRenderer.send('save-state', state)
}

contextBridge.exposeInMainWorld('island', api)
