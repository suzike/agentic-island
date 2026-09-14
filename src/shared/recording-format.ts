// 录制容器与封装格式的共用判定：主进程（会话落盘、导出）与渲染层（选编码器、UI 提示）都要用。
// 无 Electron / Node 专属依赖，可被 scripts/test-*.ts 直接加载。

export type RecordingContainer = 'mp4' | 'webm'

/** 从 MediaRecorder 的 mimeType 判定容器。 */
export function recordingContainerOf(mimeType: string): RecordingContainer {
  return /mp4/i.test(String(mimeType || '')) ? 'mp4' : 'webm'
}

/** 录制分片与成品的文件扩展名（与容器一致，避免出现 .webm 里装 MP4 这类错配）。 */
export function recordingFileExtension(mimeType: string): string {
  return recordingContainerOf(mimeType)
}

/**
 * 从文件头嗅探真实容器。比扩展名和 mimeType 都可信：升级前录的 WebM、
 * 被改名过的素材、以及"分段落盘后拼接"的产物都能正确识别。
 * MP4 在偏移 4 处是 `ftyp`；WebM/Matroska 的魔数是 1A 45 DF A3。
 */
export function sniffRecordingContainer(head: Uint8Array | ArrayBuffer | undefined | null): RecordingContainer | 'unknown' {
  const bytes = head instanceof ArrayBuffer ? new Uint8Array(head) : head
  if (!bytes || bytes.length < 12) return 'unknown'
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'mp4'
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm'
  return 'unknown'
}
