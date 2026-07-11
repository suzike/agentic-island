// LRC 歌词解析（纯逻辑，可 raw-node 直测）。SMTC 不提供播放位置，故按"检测到歌曲的时刻"
// 近似计时，取当前应显示的行。会有漂移（中途接入/暂停/拖动），仅作氛围展示。

export interface LrcLine {
  t: number // 秒
  text: string
}

/** 解析 LRC 文本为按时间升序的行（过滤空行与纯元数据） */
export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    if (!tags.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    for (const m of tags) {
      const min = Number(m[1])
      const sec = Number(m[2])
      const frac = m[3] ? Number(`0.${m[3]}`) : 0
      out.push({ t: min * 60 + sec + frac, text })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/** 给定已播放秒数，返回当前应显示的行文本（无则空串） */
export function currentLine(lines: LrcLine[], elapsedSec: number): string {
  if (!lines.length) return ''
  let cur = ''
  for (const l of lines) {
    if (l.t <= elapsedSec) cur = l.text
    else break
  }
  return cur
}
