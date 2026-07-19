export type AmbientStatusKind = 'approval' | 'waiting' | 'due' | 'focus' | 'quiet' | 'running' | 'idle'

export interface AmbientStatus {
  kind: AmbientStatusKind
  label: string
  detail: string
  count: number
  urgent: boolean
  target: 'agents' | 'todos' | null
}

export interface AmbientStatusInput {
  pending: number
  waiting: number
  dueTodos: number
  runningAgents: number
  project?: string
  focusLabel?: string
  dnd?: boolean
}

/** 将多个实时信号压成迷你条唯一的主状态，优先级与主面板提醒策略保持一致。 */
export function deriveAmbientStatus(input: AmbientStatusInput): AmbientStatus {
  const attention = input.pending + input.waiting + input.dueTodos

  if (input.focusLabel) {
    return {
      kind: 'focus',
      label: '专注中',
      detail: attention ? `${input.focusLabel} · ${attention} 项暂存` : input.focusLabel,
      count: attention,
      urgent: false,
      target: null
    }
  }
  if (input.dnd) {
    return {
      kind: 'quiet',
      label: '会议勿扰',
      detail: attention ? `${attention} 项通知已静默` : '通知已静默',
      count: attention,
      urgent: false,
      target: null
    }
  }
  if (input.pending > 0) {
    return {
      kind: 'approval',
      label: '等待审批',
      detail: input.project || `${input.pending} 个请求待处理`,
      count: input.pending,
      urgent: true,
      target: 'agents'
    }
  }
  if (input.waiting > 0) {
    return {
      kind: 'waiting',
      label: '等待回复',
      detail: input.project || `${input.waiting} 个会话需要你`,
      count: input.waiting,
      urgent: true,
      target: 'agents'
    }
  }
  if (input.dueTodos > 0) {
    return {
      kind: 'due',
      label: '待办到时',
      detail: `${input.dueTodos} 项需要处理`,
      count: input.dueTodos,
      urgent: true,
      target: 'todos'
    }
  }
  if (input.runningAgents > 0) {
    return {
      kind: 'running',
      label: 'Agent 工作中',
      detail: input.project || `${input.runningAgents} 个会话运行中`,
      count: input.runningAgents,
      urgent: false,
      target: 'agents'
    }
  }
  return { kind: 'idle', label: '工作台就绪', detail: '暂无待处理事项', count: 0, urgent: false, target: null }
}

export const clampBarRotation = (seconds?: number): number => Math.max(6, Math.min(30, seconds || 12))

const TEXT_MODES = ['quotes', 'exp', 'agent', 'thermal', 'github', 'custom', 'brief']
const VISUAL_MODES = ['flow', 'eq', 'neon']

/** 小尺寸下宠物使用独立槽位，避免与文字和状态控件争抢同一行。 */
export function buildAmbientSlots(modes: string[], compact: boolean): string[] {
  const enabled = modes.length ? modes : ['quotes']
  const slots = [
    ...enabled.filter((mode) => TEXT_MODES.includes(mode)),
    ...(enabled.includes('clock') ? ['clock'] : []),
    ...(enabled.includes('music') ? ['music'] : []),
    ...enabled.filter((mode) => VISUAL_MODES.includes(mode)),
    ...(compact && enabled.includes('pet') ? ['pet'] : [])
  ]
  return slots.length ? slots : ['pet']
}
