// 提示音：定义表用于设置界面展示；实际播放交给主进程用 Windows 原生 SoundPlayer 播放，
// 绕开渲染进程音频（透明置顶无焦点窗口里不可靠）。

import { island } from '../bridge'

export interface SoundDef {
  key: string
  label: string
  desc: string
}

export const SOUNDS: SoundDef[] = [
  { key: 'chime', label: '清脆铃声', desc: '柔和的上行三音' },
  { key: 'blip', label: '8-bit 提示', desc: '复古像素音' },
  { key: 'ping', label: '单声 Ping', desc: '一声干净的提示' },
  { key: 'marimba', label: '木琴', desc: '温暖的双音' },
  { key: 'alert', label: '警示音', desc: '锯齿三连，最醒目' },
  { key: 'crystal', label: '玻璃风铃', desc: '晶莹的高音三连' },
  { key: 'harp', label: '竖琴下行', desc: '优雅的四音琶音' },
  { key: 'pulse', label: '低音脉冲', desc: '沉稳的双低音' },
  { key: 'knock', label: '叩击', desc: '低调的敲门声' },
  { key: 'rising', label: '急促上行', desc: '四音爬升，紧迫感' },
  { key: 'soft', label: '轻柔单音', desc: '最不打扰的一声' }
]

/** 通知类型 → 声效（每类可独立设置） */
export interface SoundMap {
  /** 等待你回复（Claude 提问/本轮完成） */
  waiting: string
  /** 一般改动的审批确认 */
  approval: string
  /** 危险改动的审批确认 */
  danger: string
  /** 待办到时 / 会议提醒 */
  todo: string
}

export const DEFAULT_SOUND_MAP: SoundMap = { waiting: 'chime', approval: 'ping', danger: 'rising', todo: 'marimba' }

export const SOUND_TYPES: { key: keyof SoundMap; label: string; desc: string }[] = [
  { key: 'waiting', label: '等待回复', desc: 'Claude 提问 / 本轮完成等待你' },
  { key: 'approval', label: '一般审批', desc: '普通改动的确认请求' },
  { key: 'danger', label: '危险审批', desc: 'rm -rf / force push 等破坏性操作' },
  { key: 'todo', label: '待办与会议', desc: '待办到时 / 会前提醒' }
]

export function playSound(key: string): void {
  island.playSound(key)
}
