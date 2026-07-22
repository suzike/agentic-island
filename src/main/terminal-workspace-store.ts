import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import type { TerminalShellProfile, TerminalWorkspaceSettings, TerminalWorkspaceState } from '../shared/protocol'

const DEFAULT_SETTINGS: TerminalWorkspaceSettings = {
  restoreMode: 'prompt',
  captureOutput: false,
  redactOutput: true,
  retentionDays: 7,
  maxSnapshotChars: 30_000
}

export function defaultTerminalWorkspace(now = Date.now()): TerminalWorkspaceState {
  return { version: 2, sessions: [], history: [], favorites: [], startupTasks: [], groups: [], envProfiles: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: now }
}

export function redactTerminalText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*)[^\s;"']+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, '[REDACTED]')
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

export function normalizeTerminalWorkspace(input: unknown, now = Date.now()): TerminalWorkspaceState {
  const base = defaultTerminalWorkspace(now)
  if (!input || typeof input !== 'object') return base
  const raw = input as Partial<TerminalWorkspaceState>
  const settingsRaw = raw.settings || base.settings
  const settings: TerminalWorkspaceSettings = {
    restoreMode: settingsRaw.restoreMode === 'auto' || settingsRaw.restoreMode === 'fresh' ? settingsRaw.restoreMode : 'prompt',
    captureOutput: settingsRaw.captureOutput === true,
    redactOutput: settingsRaw.redactOutput !== false,
    retentionDays: finite(settingsRaw.retentionDays, 7, 1, 90),
    maxSnapshotChars: finite(settingsRaw.maxSnapshotChars, 30_000, 2_000, 200_000)
  }
  const cutoff = now - settings.retentionDays * 86_400_000
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string').slice(0, 24).map((item) => {
    const profile: TerminalShellProfile = item.profile === 'pwsh' || item.profile === 'cmd' || item.profile === 'wsl' ? item.profile : 'powershell'
    const outputSavedAt = finite(item.outputSavedAt, 0, 0, Number.MAX_SAFE_INTEGER)
    const keepOutput = settings.captureOutput && outputSavedAt >= cutoff && typeof item.outputSnapshot === 'string'
    const snapshot = keepOutput ? item.outputSnapshot!.slice(-settings.maxSnapshotChars) : undefined
    return {
      id: item.id,
      name: item.name.slice(0, 80),
      cwd: typeof item.cwd === 'string' ? item.cwd.slice(0, 1024) : undefined,
      profile,
      projectId: typeof item.projectId === 'string' ? item.projectId.slice(0, 160) : undefined,
      pinned: item.pinned === true,
      createdAt: finite(item.createdAt, now, 0, Number.MAX_SAFE_INTEGER),
      lastActiveAt: finite(item.lastActiveAt, now, 0, Number.MAX_SAFE_INTEGER),
      commandCount: finite(item.commandCount, 0, 0, 1_000_000),
      lastCommand: typeof item.lastCommand === 'string' ? item.lastCommand.slice(0, 4000) : undefined,
      lastExitCode: typeof item.lastExitCode === 'number' ? finite(item.lastExitCode, 0, -65535, 65535) : undefined,
      lastDurationMs: typeof item.lastDurationMs === 'number' ? finite(item.lastDurationMs, 0, 0, 604_800_000) : undefined,
      outputSnapshot: snapshot,
      outputSavedAt: snapshot ? outputSavedAt : undefined,
      handoff: typeof item.handoff === 'string' ? item.handoff.slice(0, 12_000) : undefined,
      envProfileId: typeof item.envProfileId === 'string' ? item.envProfileId.slice(0, 160) : undefined
    }
  }) : []
  const sessionIds = new Set(sessions.map((item) => item.id))
  return {
    version: 2,
    sessions,
    activeSessionId: typeof raw.activeSessionId === 'string' && sessionIds.has(raw.activeSessionId) ? raw.activeSessionId : sessions[0]?.id,
    history: Array.isArray(raw.history) ? raw.history.filter((item) => item && typeof item.command === 'string').slice(0, 500).map((item, index) => ({
      id: finite(item.id, now * 100 + index, 0, Number.MAX_SAFE_INTEGER),
      sessionId: typeof item.sessionId === 'string' ? item.sessionId : '',
      sessionName: typeof item.sessionName === 'string' ? item.sessionName.slice(0, 80) : 'PowerShell',
      command: item.command.slice(0, 4000),
      cwd: typeof item.cwd === 'string' ? item.cwd.slice(0, 1024) : undefined,
      ts: finite(item.ts, now, 0, Number.MAX_SAFE_INTEGER),
      exitCode: typeof item.exitCode === 'number' ? finite(item.exitCode, 0, -65535, 65535) : undefined,
      durationMs: typeof item.durationMs === 'number' ? finite(item.durationMs, 0, 0, 604_800_000) : undefined
    })) : [],
    favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((item): item is string => typeof item === 'string').slice(0, 100) : [],
    startupTasks: Array.isArray(raw.startupTasks) ? raw.startupTasks.filter((item) => item && typeof item.command === 'string').slice(0, 80).map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `startup-${now}-${index}`,
      label: typeof item.label === 'string' ? item.label.slice(0, 100) : item.command.slice(0, 60),
      command: item.command.slice(0, 4000),
      cwd: typeof item.cwd === 'string' ? item.cwd.slice(0, 1024) : undefined,
      enabled: item.enabled !== false,
      createdAt: finite(item.createdAt, now, 0, Number.MAX_SAFE_INTEGER)
    })) : [],
    groups: Array.isArray(raw.groups) ? raw.groups.filter((item) => item && typeof item.cwd === 'string').slice(0, 80).map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `group-${now}-${index}`,
      name: typeof item.name === 'string' ? item.name.slice(0, 100) : item.cwd,
      cwd: item.cwd.slice(0, 1024),
      pinned: item.pinned === true,
      lastOpenedAt: finite(item.lastOpenedAt, now, 0, Number.MAX_SAFE_INTEGER)
    })) : [],
    envProfiles: Array.isArray(raw.envProfiles) ? raw.envProfiles.filter((item) => item && typeof item.name === 'string').slice(0, 30).map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `env-${now}-${index}`,
      name: item.name.slice(0, 80),
      variables: Array.isArray(item.variables) ? item.variables.filter((variable) => variable && typeof variable.key === 'string' && typeof variable.value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key)).slice(0, 40).map((variable) => ({ key: variable.key, value: variable.value.slice(0, 8000) })) : [],
      createdAt: finite(item.createdAt, now, 0, Number.MAX_SAFE_INTEGER)
    })) : [],
    settings,
    updatedAt: finite(raw.updatedAt, now, 0, Number.MAX_SAFE_INTEGER)
  }
}

export function terminalWorkspaceExportState(input: TerminalWorkspaceState): TerminalWorkspaceState {
  return normalizeTerminalWorkspace({
    ...input,
    sessions: input.sessions.map((session) => ({ ...session, outputSnapshot: undefined, outputSavedAt: undefined })),
    envProfiles: input.envProfiles.map((profile) => ({ ...profile, variables: profile.variables.map((variable) => ({ key: variable.key, value: '' })) }))
  })
}

interface TerminalWorkspaceStoreOptions {
  filePath: () => string
  encrypt?: (plain: string) => string
  decrypt?: (cipher: string) => string
}

export function createTerminalWorkspaceStore(options: TerminalWorkspaceStoreOptions): {
  load: () => TerminalWorkspaceState
  save: (state: TerminalWorkspaceState) => TerminalWorkspaceState
  clearSnapshots: () => TerminalWorkspaceState
} {
  const atomicWrite = (data: string): void => {
    const path = options.filePath()
    const temp = path + '.tmp'
    writeFileSync(temp, data, { mode: 0o600 })
    try { renameSync(temp, path) } catch { writeFileSync(path, data, { mode: 0o600 }) }
  }
  const load = (): TerminalWorkspaceState => {
    const path = options.filePath()
    if (!existsSync(path)) return defaultTerminalWorkspace()
    try {
      const text = readFileSync(path, 'utf8')
      const json = text.startsWith('enc:') && options.decrypt ? options.decrypt(text.slice(4)) : text
      return normalizeTerminalWorkspace(JSON.parse(json))
    } catch {
      try { copyFileSync(path, path.replace(/\.json$/, '.bad.json')) } catch { /* preserve best effort evidence */ }
      return defaultTerminalWorkspace()
    }
  }
  const save = (input: TerminalWorkspaceState): TerminalWorkspaceState => {
    const state = normalizeTerminalWorkspace({ ...input, updatedAt: Date.now() })
    if (state.settings.captureOutput && state.settings.redactOutput) {
      state.sessions = state.sessions.map((session) => session.outputSnapshot ? { ...session, outputSnapshot: redactTerminalText(session.outputSnapshot) } : session)
    }
    const plain = JSON.stringify(state)
    atomicWrite(options.encrypt ? `enc:${options.encrypt(plain)}` : plain)
    return state
  }
  const clearSnapshots = (): TerminalWorkspaceState => {
    const current = load()
    return save({ ...current, sessions: current.sessions.map((session) => ({ ...session, outputSnapshot: undefined, outputSavedAt: undefined })) })
  }
  return { load, save, clearSnapshots }
}
