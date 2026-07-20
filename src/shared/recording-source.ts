interface RecordingSourceLabelLike {
  id: string
  name: string
  kind: 'screen' | 'window'
  displayLabel?: string
}

export function recordingWindowHandle(sourceId: string): string | null {
  const match = /^window:(\d+):\d+$/.exec(sourceId)
  return match?.[1] || null
}

export function sameRecordingWindowSource(first: string, second: string): boolean {
  const firstHandle = recordingWindowHandle(first)
  return Boolean(firstHandle && firstHandle === recordingWindowHandle(second))
}

export function recordingSourceLabel(source?: RecordingSourceLabelLike | null): string {
  if (!source) return ''
  return source.kind === 'screen' ? source.displayLabel || source.name : source.name
}
