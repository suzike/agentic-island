import { contextBridge, ipcRenderer } from 'electron'
import type { DecisionMessage, IslandSnapshot, IslandBridgeApi, LlmRequestConfig } from '../shared/protocol'

const api: IslandBridgeApi = {
  onSnapshot: (cb: (snap: IslandSnapshot) => void): (() => void) => {
    const handler = (_e: unknown, snap: IslandSnapshot): void => cb(snap)
    ipcRenderer.on('snapshot', handler)
    return () => ipcRenderer.removeListener('snapshot', handler)
  },
  getSnapshot: (): Promise<IslandSnapshot> => ipcRenderer.invoke('get-snapshot'),
  decide: (msg: DecisionMessage): void => ipcRenderer.send('decide', msg),
  jumpToTerminal: (agentId: string): Promise<boolean> => ipcRenderer.invoke('jump-to-terminal', agentId),
  setIgnoreMouse: (ignore: boolean): void => ipcRenderer.send('set-ignore-mouse', ignore),
  playSound: (key: string): void => ipcRenderer.send('play-sound', key),
  setAutostart: (on: boolean): void => ipcRenderer.send('set-autostart', on),
  reposition: (opts: { follow: boolean; monitorIndex: number }): void => ipcRenderer.send('reposition', opts),
  setSizeMode: (large: boolean): void => ipcRenderer.send('set-size-mode', large),
  setIslandWidth: (w: number): void => ipcRenderer.send('set-island-width', w),
  setZoom: (z: number): void => ipcRenderer.send('set-zoom', z),
  githubTrending: () => ipcRenderer.invoke('github-trending'),
  rssFetch: (url: string) => ipcRenderer.invoke('rss-fetch', url),
  installHooks: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('install-hooks'),
  uninstallHooks: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('uninstall-hooks'),
  llmComplete: (cfg: LlmRequestConfig, system: string, user: string | Array<Record<string, unknown>>, deep?: boolean, history?: { role: 'user' | 'assistant'; content: string }[]) =>
    ipcRenderer.invoke('llm-complete', cfg, system, user, deep, history),
  openExternal: (url: string): void => ipcRenderer.send('open-external', url),
  llmTest: (cfg: LlmRequestConfig) => ipcRenderer.invoke('llm-test', cfg),
  fetchCalendar: (url: string) => ipcRenderer.invoke('calendar-fetch', url),
  fetchUrlText: (url: string) => ipcRenderer.invoke('fetch-url-text', url),
  fetchCaldav: (cfg: { server: string; username: string; password: string }) => ipcRenderer.invoke('caldav-fetch', cfg),
  mediaInfo: () => ipcRenderer.invoke('media-info'),
  mediaKey: (cmd: string): void => ipcRenderer.send('media-key', cmd),
  ptyEnsure: (id: string, cols: number, rows: number) => ipcRenderer.invoke('pty-ensure', id, cols, rows),
  ptyInput: (id: string, data: string): void => ipcRenderer.send('pty-input', id, data),
  ptyResize: (id: string, cols: number, rows: number): void => ipcRenderer.send('pty-resize', id, cols, rows),
  ptyKill: (id: string): void => ipcRenderer.send('pty-kill', id),
  onPtyData: (cb: (id: string, data: string) => void): (() => void) => {
    const handler = (_e: unknown, p: { id: string; data: string }): void => cb(p.id, p.data)
    ipcRenderer.on('pty-data', handler)
    return () => ipcRenderer.removeListener('pty-data', handler)
  },
  onClipboard: (cb: (text: string) => void): (() => void) => {
    const handler = (_e: unknown, text: string): void => cb(text)
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
