import assert from 'node:assert/strict'
import { buildRecordingFfmpegArgs, recordingExportDurationMs, recordingExportSubtitleSegments, recordingHasEdits } from '../src/main/recording-export.ts'
import { formatRecordingTime, normalizeRecordingSegments, parseRecordingAiEditPlan, recordingElapsed, recordingFitComposition, recordingFocusCrop, recordingFrameBudget, recordingHealth, recordingLerp, recordingOutputSize, recordingPreviewSize, recordingRegionCrop, recordingSegmentsDuration, recordingSourcePointToOutput, recordingStartError, recordingTranscriptToSrt, recordingTranscriptToVtt, recordingVideoBitrate, recordingZoomForMotion, selectRecorderMime, selectRecordingSourceId, snapRecordingTime, splitRecordingSegment, stylizeRecordingAnimeFrame } from '../src/renderer/src/logic/recording.ts'
import { recordingSourceLabel, recordingWindowHandle, sameRecordingWindowSource } from '../src/shared/recording-source.ts'
import type { RecordingExportRequest } from '../src/shared/protocol.ts'

assert.deepEqual(recordingOutputSize(2560, 1440, '1080p'), { width: 1920, height: 1080 }, '横屏 1080P')
assert.deepEqual(recordingOutputSize(1080, 1920, '4k'), { width: 2160, height: 3840 }, '竖屏 4K 保持方向')
assert.deepEqual(recordingOutputSize(1919, 1079, 'source'), { width: 1918, height: 1078 }, '原生尺寸对齐偶数编码尺寸')
assert.deepEqual(recordingOutputSize(2560, 1440, '1080p', '9:16'), { width: 1080, height: 1920 }, '横屏来源可输出竖屏短视频')
assert.deepEqual(recordingOutputSize(2560, 1440, '1080p', '1:1'), { width: 1080, height: 1080 }, '支持方形输出')
assert.deepEqual(recordingPreviewSize({ width: 3840, height: 2160 }), { width: 1280, height: 720 }, '4K 试播限制在 720P 负载')
assert.deepEqual(recordingPreviewSize({ width: 2160, height: 3840 }), { width: 404, height: 720 }, '竖屏试播保持比例并限制高度')
assert.deepEqual(recordingPreviewSize({ width: 640, height: 360 }), { width: 640, height: 360 }, '低分辨率试播不放大')
assert.equal(recordingElapsed(true, 15_000, 1_000, 11_000, 0), 10_000, '暂停时长固定在暂停瞬间')
assert.equal(recordingElapsed(false, 16_000, 1_000, 11_000, 5_000), 10_000, '恢复后只扣除一次暂停时长')
assert.deepEqual(recordingFrameBudget(34, 1000 / 30), { totalFrames: 1, droppedFrames: 0 }, '正常绘制抖动不会误报丢帧')
assert.deepEqual(recordingFrameBudget(105, 1000 / 30), { totalFrames: 3, droppedFrames: 2 }, '长任务阻塞按缺失帧数计入丢帧')
assert.equal(recordingWindowHandle('window:4784928:0'), '4784928', '解析 Electron 窗口来源句柄')
assert.equal(sameRecordingWindowSource('window:4784928:0', 'window:4784928:1'), true, '同一窗口不同来源后缀仍能识别')
assert.equal(recordingSourceLabel({ id: 'window:1:0', kind: 'window', name: '编辑器', displayLabel: '主显示器' }), '编辑器', '窗口来源不会被显示器标签覆盖')
assert.deepEqual(recordingRegionCrop(2000, 1000, { left: 0.1, top: 0.2, right: 0.15, bottom: 0.1 }), { x: 200, y: 200, width: 1500, height: 700 }, '自定义区域按四边裁剪')
assert.deepEqual(recordingRegionCrop(1919, 1079, { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 }), { x: 192, y: 108, width: 1535, height: 863 }, '奇数源尺寸按两端坐标计算，定位框与裁剪边界一致')
const contained = recordingFitComposition({ x: 200, y: 100, width: 1600, height: 800 }, 1920, 1080, 'contain')
assert.deepEqual(contained.destination, { x: 0, y: 60, width: 1920, height: 960 }, '完整显示的定位坐标包含上下留黑')
assert.deepEqual(recordingSourcePointToOutput(contained, 1000, 500), { x: 960, y: 540, visible: true }, '源中心映射到最终画布中心')
const covered = recordingFitComposition({ x: 200, y: 100, width: 1600, height: 800 }, 1080, 1080, 'cover')
assert.deepEqual(covered.source, { x: 600, y: 100, width: 800, height: 800 }, '铺满方形画面使用与定位框相同的居中源裁剪')
assert.equal(recordingSourcePointToOutput(covered, 300, 500).visible, false, '被铺满模式裁掉的源坐标不会显示动效')

const crop = recordingFocusCrop(3840, 2160, 1920, 1080, 1, 1, 1.5)
assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 3840.001 && crop.y + crop.height <= 2160.001, '运镜裁剪不越界')
assert.ok(Math.abs(crop.width / crop.height - 16 / 9) < 0.001, '运镜裁剪保持输出比例')
assert.equal(recordingZoomForMotion('off', 0), 1, '关闭运镜不缩放')
assert.ok(recordingZoomForMotion('dynamic', 0) > recordingZoomForMotion('gentle', 0), '动态运镜聚焦更强')
assert.ok(recordingZoomForMotion('dynamic', 1000) < recordingZoomForMotion('dynamic', 0), '快速移动自动减弱缩放')
assert.equal(recordingLerp(0, 1, 0.25), 0.25, '平滑插值')
assert.equal(selectRecorderMime((mime) => mime.includes('vp8,opus')), 'video/webm;codecs=vp8,opus', '编码能力自动降级')
assert.equal(selectRecorderMime(() => true, false), 'video/webm;codecs=vp9', '无音轨时不声明 Opus 编码')
assert.ok(recordingVideoBitrate(3840, 2160, 60, 'ultra') > recordingVideoBitrate(1920, 1080, 30, 'high'), '4K60 码率高于 1080P30')
assert.equal(recordingHealth({ active: true, elapsedMs: 5000, bytes: 0, chunkGapMs: 1000, writeLatencyMs: 0, droppedFrames: 0, totalFrames: 150 }).level, 'critical', '编码器无输出判定为严重异常')
assert.equal(recordingHealth({ active: true, elapsedMs: 5000, bytes: 1_000_000, chunkGapMs: 4000, writeLatencyMs: 20, droppedFrames: 0, totalFrames: 150 }).message, '编码分片延迟', '分片中断产生健康告警')
assert.equal(recordingHealth({ active: true, elapsedMs: 5000, bytes: 1_000_000, chunkGapMs: 1000, writeLatencyMs: 2300, droppedFrames: 0, totalFrames: 150 }).message, '磁盘写入积压', '写盘积压产生健康告警')
assert.equal(recordingHealth({ active: true, elapsedMs: 5000, bytes: 1_000_000, chunkGapMs: 1000, writeLatencyMs: 20, droppedFrames: 10, totalFrames: 150 }).level, 'warning', '高丢帧率产生健康告警')
assert.equal(recordingHealth({ active: true, elapsedMs: 5000, bytes: 1_000_000, chunkGapMs: 1000, writeLatencyMs: 20, droppedFrames: 1, totalFrames: 150 }).level, 'healthy', '正常录制健康状态')
assert.equal(formatRecordingTime(3_725_000), '01:02:05', '长录制时长格式')
assert.match(recordingStartError(new DOMException('Permission denied', 'NotAllowedError')), /权限被拒绝/, '权限错误转为可执行提示')
assert.match(recordingStartError(new Error('desktop picture timed out')), /连接屏幕画面超时/, '采集超时转为可执行提示')
const recordingSources = [
  { id: 'screen:1', kind: 'screen' as const, available: true },
  { id: 'window:minimized', kind: 'window' as const, available: false },
  { id: 'window:editor', kind: 'window' as const, available: true }
]
assert.equal(selectRecordingSourceId(recordingSources, 'window', 'screen:1'), 'window:editor', '切换窗口页签不能继续保留显示器来源')
assert.equal(selectRecordingSourceId(recordingSources, 'screen', 'screen:1'), 'screen:1', '同类有效来源保持选中')

assert.equal(selectRecordingSourceId([{ id: 'window:new', name: 'Visual Studio Code', kind: 'window', available: true }], 'window', 'window:old', 'Visual Studio Code'), 'window:new', '窗口句柄变化后按标题恢复选择')
const normalized = normalizeRecordingSegments([{ id: 'late', startMs: 8_000, endMs: 12_000 }, { id: 'early', startMs: -50, endMs: 3_000 }], 10_000)
assert.deepEqual(normalized.map(({ id, startMs, endMs }) => ({ id, startMs, endMs })), [{ id: 'early', startMs: 0, endMs: 3_000 }, { id: 'late', startMs: 8_000, endMs: 10_000 }], '片段规范化会限幅并按时间排序')
const split = splitRecordingSegment([{ id: 'full', startMs: 0, endMs: 10_000, label: '片段 1' }], 'full', 4_000)
assert.equal(split.length, 2, '播放头可无损拆分片段')
assert.equal(recordingSegmentsDuration(split, 10_000, 2), 5_000, '成片时长汇总片段并考虑倍速')
assert.equal(snapRecordingTime(4_940, 10_000, [5_000], 100, 30), 5_000, '时间点在阈值内磁吸到标记')
assert.equal(Math.round(snapRecordingTime(4_810, 10_000, [5_000], 100, 25)), 4_800, '未靠近标记时吸附到视频帧')
assert.equal(snapRecordingTime(-20, 10_000, [], 100, 30), 0, '磁吸时间限制在素材范围')
const aiPlan = parseRecordingAiEditPlan('```json\n{"title":"粗剪","segments":[{"startMs":-20,"endMs":3000,"label":"开场"},{"startMs":2500,"endMs":6000,"label":"演示"}],"markers":[{"at":2800,"label":"步骤"}],"speed":3,"adjustments":{"contrast":9,"brightness":-2}}\n```', 5000)
assert.ok(aiPlan && aiPlan.segments.length === 1, 'AI 粗剪方案解析并合并重叠区间')
assert.deepEqual(aiPlan?.segments[0] && [aiPlan.segments[0].startMs, aiPlan.segments[0].endMs], [0, 5000], 'AI 片段限制在素材时长')
assert.equal(aiPlan?.speed, 2, 'AI 粗剪速度限幅')
assert.equal(aiPlan?.adjustments.contrast, 2, 'AI 画面参数限幅')
assert.equal(parseRecordingAiEditPlan('not json', 5000), null, '无效 AI 粗剪方案不修改工程')
const transcript = [{ startMs: 1234, endMs: 5678, text: '第一句' }, { startMs: 3_661_001, endMs: 3_662_500, text: '第二句' }]
assert.match(recordingTranscriptToSrt(transcript), /00:00:01,234 --> 00:00:05,678/, 'SRT 使用毫秒逗号时间戳')
assert.match(recordingTranscriptToSrt(transcript), /2\n01:01:01,001/, 'SRT 支持小时并连续编号')
assert.match(recordingTranscriptToVtt(transcript), /^WEBVTT\n\n00:00:01\.234/m, 'VTT 使用点号时间戳和文件头')

const animePixels = new Uint8ClampedArray([
  20, 30, 40, 255, 220, 210, 200, 180, 30, 40, 50, 255,
  24, 34, 44, 255, 215, 205, 195, 180, 34, 44, 54, 255,
  28, 38, 48, 255, 210, 200, 190, 180, 38, 48, 58, 255
])
const animeOriginal = new Uint8ClampedArray(animePixels)
stylizeRecordingAnimeFrame(animePixels, 3, 3, 0.8, 'warm')
assert.notDeepEqual(animePixels, animeOriginal, '动漫化会改变颜色与边缘')
assert.equal(animePixels[7], 180, '动漫化保留透明度')
assert.ok(animePixels[4] > animePixels[6], '暖色调保持红色优势')
const cartoonPixels = new Uint8ClampedArray(animeOriginal)
stylizeRecordingAnimeFrame(cartoonPixels, 3, 3, 0.8, 'natural', 'cartoon')
assert.notDeepEqual(cartoonPixels, animePixels, '动漫与卡通使用不同的色阶和轮廓策略')

const base: RecordingExportRequest = { jobId: 'test', name: 'demo', format: 'mp4', quality: 'balanced', durationMs: 10_000, width: 1920, height: 1080, fps: 30 }
const mp4 = buildRecordingFfmpegArgs('in.webm', 'out.mp4', base)
assert.ok(mp4.includes('libx264') && mp4.includes('+faststart') && mp4.includes('yuv420p'), 'MP4 使用兼容 H.264 快启编码')
assert.ok(mp4.includes('-progress') && mp4.includes('pipe:1'), 'FFmpeg 通过标准进度协议回传真实转码进度')
const webm = buildRecordingFfmpegArgs('in.webm', 'out.webm', { ...base, format: 'webm', quality: 'lossless' })
assert.ok(webm.includes('libvpx-vp9') && webm.includes('-lossless') && webm.includes('1'), 'WebM 无损归档使用 VP9 lossless')
const gif = buildRecordingFfmpegArgs('in.webm', 'out.gif', { ...base, format: 'gif', quality: 'balanced', fps: 60 })
const filter = gif[gif.indexOf('-filter_complex') + 1]
assert.ok(filter.includes('palettegen') && filter.includes('paletteuse') && filter.includes('fps=24'), 'GIF 使用调色板并限制合理帧率')
const trimmed = buildRecordingFfmpegArgs('in.webm', 'out.mp4', { ...base, trimStartMs: 1_500, trimEndMs: 8_000 })
assert.ok(trimmed.includes('-ss') && trimmed.includes('1.500') && trimmed.includes('-t') && trimmed.includes('6.500'), '导出裁剪区间进入 FFmpeg 参数')

const editedRequest: RecordingExportRequest = {
  ...base,
  hasAudio: true,
  edit: {
    segments: [
      { id: 'a', startMs: 500, endMs: 2_500 },
      { id: 'b', startMs: 5_000, endMs: 8_000 }
    ],
    speed: 1.25,
    crop: { left: 0.05, top: 0.1, right: 0.05, bottom: 0 },
    rotation: 90,
    brightness: 0.1,
    contrast: 1.1,
    saturation: 1.2,
    sharpen: 0.6,
    denoise: 2,
    audioVolume: 0.8,
    fadeInMs: 250,
    fadeOutMs: 400
  }
}
const edited = buildRecordingFfmpegArgs('in.webm', 'out.mp4', editedRequest)
const editedFilter = edited[edited.indexOf('-filter_complex') + 1]
assert.match(editedFilter, /select=.*between/, '多片段视频使用时间选择滤镜')
assert.match(editedFilter, /aselect=.*between/, '多片段音轨与视频保持同一选择范围')
assert.ok(editedFilter.includes('atempo=1.250') && editedFilter.includes('crop=') && editedFilter.includes('transpose=1'), '导出应用调速、裁切和旋转')
assert.ok(editedFilter.includes('eq=') && editedFilter.includes('hqdn3d=') && editedFilter.includes('unsharp='), '导出应用调色、降噪和锐化')
assert.ok(editedFilter.includes('afade=') && editedFilter.includes('volume=0.800'), '导出应用音量和音频淡入淡出')
assert.equal(recordingExportDurationMs(editedRequest), 4_000, '多片段成片时长考虑导出速度')
assert.equal(recordingExportDurationMs({ ...editedRequest, edit: { ...editedRequest.edit, speed: 1, segments: [{ id: 'a', startMs: 0, endMs: 5_000 }, { id: 'b', startMs: 4_000, endMs: 8_000 }] } }), 8_000, '重叠片段按时间并集计算成片时长')
assert.equal(recordingHasEdits(editedRequest), true, '编辑后的录制不能走原始文件直写旁路')
assert.equal(recordingHasEdits({ ...base, edit: { segments: [{ id: 'full', startMs: 0, endMs: 10_000 }], speed: 1, contrast: 1, saturation: 1, gamma: 1, audioVolume: 1 } }), false, '完整单片段和默认参数仍可原始直写')
const muted = buildRecordingFfmpegArgs('in.webm', 'out.webm', { ...editedRequest, format: 'webm', edit: { ...editedRequest.edit, muteAudio: true } })
assert.ok(muted.includes('-an') && !muted.includes('[aout]'), '静音导出移除音轨')

const delivery = buildRecordingFfmpegArgs('in.webm', 'out.mp4', { ...base, hasAudio: true, outputWidth: 1280, outputHeight: 720, outputFps: 24, subtitleFilePath: 'subtitle.srt', subtitle: { mode: 'embedded', language: 'zh', segments: [{ startMs: 500, endMs: 2_000, text: '字幕' }] } })
const deliveryFilter = delivery[delivery.indexOf('-vf') + 1]
assert.match(deliveryFilter, /scale=w=1280:h=720/, '交付导出按指定边界缩放画面')
assert.match(deliveryFilter, /fps=24/, '交付导出可独立设置帧率')
assert.ok(delivery.includes('subtitle.srt') && delivery.includes('mov_text') && delivery.includes('language=zho'), 'MP4 内嵌可开关中文字幕轨')
assert.equal(recordingHasEdits({ ...base, format: 'webm', subtitleFilePath: 'subtitle.srt' }), true, '内嵌字幕不能误走原始 WebM 直写旁路')
assert.equal(recordingHasEdits({ ...base, format: 'webm', outputWidth: 1280, outputHeight: 720 }), true, '改变输出分辨率不能误走原始直写旁路')

const audio = buildRecordingFfmpegArgs('in.webm', 'out.mp3', { ...editedRequest, format: 'mp3', quality: 'near-lossless' })
assert.ok(audio.includes('-vn') && audio.includes('libmp3lame') && audio.includes('320k'), 'MP3 单独导出使用高质量音频编码')
assert.ok(audio.some((item) => item.includes('aselect=')) && audio.some((item) => item.includes('atempo=1.250')), 'MP3 沿用片段选择和速度设置')

const subtitleSegments = recordingExportSubtitleSegments({
  ...editedRequest,
  subtitle: { mode: 'embedded', language: 'zh', segments: [
    { startMs: 1_000, endMs: 2_000, text: '第一段' },
    { startMs: 5_500, endMs: 7_000, text: '第二段' }
  ] }
})
assert.deepEqual(subtitleSegments.map((item) => [item.startMs, item.endMs, item.text]), [[400, 1_200, '第一段'], [2_000, 3_200, '第二段']], '字幕时间码按保留片段拼接并随速度重排')

console.log('recording tests passed')
