import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EncoderRunner } from '../src/main/recording-export.ts'
import { buildRecordingFfmpegArgs, buildRecordingMotionFilter, MOTION_MAX_CENTER_TOLERANCE, buildRecordingRemuxArgs, crfFor, detectHardwareEncoders, hardwareQuantizerForCrf, MAX_MOTION_WAYPOINTS, parseHardwareEncoders, pickFastestEncoder, pickVideoEncoder, recordingExportDurationMs, recordingExportStrategy, recordingExportSubtitleSegments, recordingHasEdits, simplifyRecordingMotion, videoEncoderArgs } from '../src/main/recording-export.ts'
import { recordingContainerOf, recordingFileExtension, sniffRecordingContainer } from '../src/shared/recording-format.ts'
import { clampRecordingBarPosition, formatRecordingTime, recordingIdleRanges, recordingKeptSegmentsFromIdle, recordingLerpTimed, recordingMotionFrames, recordingSmoothingAlpha, normalizeRecordingSegments, parseRecordingAiEditPlan, recordingElapsed, recordingFitComposition, recordingFocusCrop, recordingFrameBudget, recordingHealth, recordingLerp, recordingOutputSize, recordingPreviewSize, recordingRawCaptureSize, recordingRawModeBlockers, recordingRegionCrop, recordingSegmentsDuration, recordingSourcePointToOutput, recordingStartError, recordingTranscriptToSrt, recordingTranscriptToVtt, recordingVideoBitrate, recordingZoomForMotion, selectRecorderMime, selectRecordingSourceId, snapRecordingTime, splitRecordingSegment, stylizeRecordingAnimeFrame, writePreviewPosition,
} from '../src/renderer/src/logic/recording.ts'
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
assert.equal(selectRecorderMime((mime) => mime.includes('vp8')), 'video/webm;codecs=vp8,opus', '只有 VP8 可用时降级到 VP8+Opus')
assert.equal(selectRecorderMime((mime) => !mime.includes('mp4'), false), 'video/webm;codecs=vp9', 'WebM 回退且无音轨时不声明 Opus 编码')
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
// 分段裁剪用 trim+concat（段内原始时间轴保留），不再用 select + setpts=N/帧率 重排：
// 后者按"第 N 帧 = N/帧率"铺时间轴，一旦标称帧率与实际帧密度不符，整段视频会加速/缩短。
assert.match(editedFilter, /\[0:v\]trim=start=.*?end=.*?setpts=PTS-STARTPTS\[v0\]/, '多片段视频按时间 trim 并归零时间轴')
assert.match(editedFilter, /\[0:a\]atrim=start=.*?end=.*?asetpts=PTS-STARTPTS\[a0\]/, '多片段音轨与视频使用同一时间范围')
assert.match(editedFilter, /concat=n=2:v=1:a=0\[vcut\]/, '多片段视频拼接成连续时间轴')
assert.match(editedFilter, /concat=n=2:v=0:a=1\[acut\]/, '多片段音轨拼接成连续时间轴')
assert.ok(!/setpts=N\//.test(editedFilter), '不得再按帧序号重排时间轴（VFR 源会被压缩）')
assert.ok(editedFilter.includes('atempo=1.250') && editedFilter.includes('crop=') && editedFilter.includes('transpose=1'), '导出应用调速、裁切和旋转')
assert.ok(editedFilter.includes('eq=') && editedFilter.includes('hqdn3d=') && editedFilter.includes('unsharp='), '导出应用调色、降噪和锐化')
assert.ok(editedFilter.includes('afade=') && editedFilter.includes('volume=0.800'), '导出应用音量和音频淡入淡出')
assert.equal(recordingExportDurationMs(editedRequest), 4_000, '多片段成片时长考虑导出速度')
assert.equal(recordingExportDurationMs({ ...editedRequest, edit: { ...editedRequest.edit, speed: 1, segments: [{ id: 'a', startMs: 0, endMs: 5_000 }, { id: 'b', startMs: 4_000, endMs: 8_000 }] } }), 8_000, '重叠片段按时间并集计算成片时长')
assert.equal(recordingHasEdits(editedRequest), true, '编辑后的录制不能走原始文件直写旁路')
assert.equal(recordingHasEdits({ ...base, edit: { segments: [{ id: 'full', startMs: 0, endMs: 10_000 }], speed: 1, contrast: 1, saturation: 1, gamma: 1, audioVolume: 1 } }), false, '完整单片段和默认参数仍可原始直写')
// 全长单片段等于"没剪"：不得走分段裁剪，且 MP4 必须显式归一化帧率 ——
// 录制源是 MediaRecorder 的 VFR WebM（实测容器标称 1000fps），不归一化时封装器会按
// 该标称值铺帧，60 秒输入被写成 60002 帧（1000fps、41 倍重复帧、文件暴涨、播放异常）。
const fullClip = buildRecordingFfmpegArgs('in.webm', 'out.mp4', { ...base, durationMs: 10_000, edit: { segments: [{ id: 'full', startMs: 0, endMs: 10_000, enabled: true, label: '片段 1' }] } }).join(' ')
assert.ok(!/trim=/.test(fullClip), '全长单片段不应触发分段裁剪')
assert.match(fullClip, /fps=30/, 'MP4 输出显式归一化帧率（否则 VFR 源会被按容器标称帧率铺帧）')
const webmFull = buildRecordingFfmpegArgs('in.webm', 'out.webm', { ...base, format: 'webm', durationMs: 10_000, fps: 30, outputFps: 30, edit: { segments: [{ id: 'full', startMs: 0, endMs: 10_000, enabled: true }] } }).join(' ')
assert.ok(!/fps=30/.test(webmFull), 'WebM 原生支持 VFR，帧率与源一致时不加帧率滤镜')
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
assert.ok(audio.some((item) => item.includes('atrim=')) && audio.some((item) => item.includes('atempo=1.250')), 'MP3 沿用片段裁剪和速度设置')
assert.ok(!audio.some((item) => item.includes('[0:v]')), 'MP3 不应为音轨之外的画面建滤镜图')

const subtitleSegments = recordingExportSubtitleSegments({
  ...editedRequest,
  subtitle: { mode: 'embedded', language: 'zh', segments: [
    { startMs: 1_000, endMs: 2_000, text: '第一段' },
    { startMs: 5_500, endMs: 7_000, text: '第二段' }
  ] }
})
assert.deepEqual(subtitleSegments.map((item) => [item.startMs, item.endMs, item.text]), [[400, 1_200, '第一段'], [2_000, 3_200, '第二段']], '字幕时间码按保留片段拼接并随速度重排')


// ── 播放头直写：高频 timeupdate 不经过 React 状态（录屏工作台 2000+ 行整树重渲染的根因）──
{
  const el = () => ({ style: { left: '' } })
  const main = el(); const segment = el(); const label = { textContent: '' }
  const pct = writePreviewPosition({ main, segment, label }, 2500, 10000)
  assert.ok(pct === 25, '播放头：百分比按总时长换算')
  assert.ok(main.style.left === '25%' && segment.style.left === '25%', '播放头：两条时间轴同步跟随')
  assert.ok(label.textContent === formatRecordingTime(2500), '播放头：时间标签同步更新')

  // 时长为 0（未载入）时不产生除零/NaN —— 否则 style.left 会写成 "NaN%"
  writePreviewPosition({ main, segment, label }, 100, 0)
  assert.ok(main.style.left === '0%' && !main.style.left.includes('NaN'), '播放头：总时长为 0 时安全回退为 0%（不写 NaN）')

  // 元素缺失（面板切走/未挂载）不得抛错
  assert.ok(writePreviewPosition({ main: null, segment: null, label: null }, 500, 1000) === 50, '播放头：元素缺失时静默跳过并返回百分比')

  // 源码不变量：timeupdate 处理器与 seek 路径不得调用 setState（高频重渲染回归防线）
  const src = readFileSync(join(process.cwd(), 'src/renderer/src/components/ScreenRecorderStudio.tsx'), 'utf8')
  assert.ok(!/setPreviewCurrentMs/.test(src), '播放头：不再存在 preview 时间的 React setState 写入')
  const timeUpdate = src.slice(src.indexOf('onTimeUpdate={'), src.indexOf('onTimeUpdate={') + 500)
  assert.ok(/applyPreviewMs\(current\)/.test(timeUpdate) && !/set[A-Z]/.test(timeUpdate), '播放头：timeupdate 走 DOM 直写而非 setState')
  assert.ok((src.match(/previewEls\.current/g) || []).length >= 4, '播放头：三条消费点（主/片段/标签）均挂 ref')
}

// 悬浮控制条的夹取：录制时控制条悬在被录屏幕上方，拖到边界外会抓不回来
const bar = { width: 560, height: 64 }
const viewport = { width: 2560, height: 1440 }
assert.deepEqual(clampRecordingBarPosition(-500, -300, bar, viewport), { x: 8, y: 8 }, '拖出左上角时夹回可视区')
assert.deepEqual(clampRecordingBarPosition(9999, 9999, bar, viewport), { x: 2560 - 560 - 8, y: 1440 - 64 - 8 }, '拖出右下角时夹回可视区')
assert.deepEqual(clampRecordingBarPosition(600, 400, bar, viewport), { x: 600, y: 400 }, '可视区内的位置原样保留')
assert.deepEqual(clampRecordingBarPosition(Number.NaN, 0, bar, viewport), { x: 8, y: 8 }, '非法坐标退回边距内')
assert.deepEqual(clampRecordingBarPosition(0, 0, { width: 3000, height: 2000 }, viewport), { x: 8, y: 8 }, '控制条比视口还大时仍保持在左上角边距')

/* ---------------- 录制容器与导出路径（P0：MP4/H.264 优先 + 无剪辑直通封装） ---------------- */

// 编码器优先链：MP4/H.264 必须排在 WebM 之前（容器元数据可信 + 导出可直通 + 不用软件 VP9）。
const chainSupported = selectRecorderMime(() => true)
assert.match(chainSupported, /^video\/mp4;codecs=avc1\.640033$/, '首选 H.264 High@5.1（覆盖到 4K）')
assert.equal(selectRecorderMime((mime) => !mime.includes('mp4')), 'video/webm;codecs=vp9,opus', 'MP4 不可用时回退到 WebM/VP9+Opus')
assert.equal(selectRecorderMime(() => false), 'video/webm', '全不支持时给出兜底容器')
assert.equal(selectRecorderMime(() => true).includes(',opus'), false, 'MP4 分支不带音频 codecs（Chromium 会自行补 opus）')
// 裸 video/mp4 实测会被 Chromium 塞成 VP9-in-MP4：既没有 H.264 的兼容性，也不是原生 WebM
const mp4Candidates = selectRecorderMime(() => true).split('|')
const allMimes = [selectRecorderMime(() => true), selectRecorderMime(() => true, false)].join(' ')
assert.ok(!/video\/mp4(?![;a-z0-9])/i.test(allMimes), '不得使用裸 video/mp4（会被塞成 VP9-in-MP4）')

// 容器判定与文件头嗅探
assert.equal(recordingContainerOf('video/mp4;codecs=avc1.640033'), 'mp4', 'mp4 mime 判定为 mp4 容器')
assert.equal(recordingContainerOf('video/webm;codecs=vp9,opus'), 'webm', 'webm mime 判定为 webm 容器')
assert.equal(recordingFileExtension('video/mp4;codecs=avc1.640033'), 'mp4', '扩展名跟随实际容器（不能把 MP4 存成 .webm）')
const mp4Head = Buffer.from([0x00, 0x00, 0x00, 0x24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00])
const webmHead = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81])
assert.equal(sniffRecordingContainer(mp4Head), 'mp4', '按文件头识别 MP4（ftyp）')
assert.equal(sniffRecordingContainer(webmHead), 'webm', '按文件头识别 WebM/Matroska（EBML 魔数）')
assert.equal(sniffRecordingContainer(Buffer.from([1, 2, 3])), 'unknown', '过短的头部返回 unknown 而不是猜')
assert.equal(sniffRecordingContainer(null), 'unknown', '空头部返回 unknown')

// 导出路径决策矩阵
const strategyBase = { jobId: 'j', name: 'n', format: 'mp4' as const, quality: 'balanced' as const, durationMs: 10_000, width: 1920, height: 1080, fps: 30, hasAudio: true }
assert.equal(recordingExportStrategy(strategyBase, 'mp4'), 'remux', 'MP4 源 + MP4 目标 + 无剪辑 → 直通封装')
assert.equal(recordingExportStrategy({ ...strategyBase, format: 'webm' }, 'webm'), 'copy', 'WebM 源 + WebM 目标 + 无剪辑 → 原样保存')
assert.equal(recordingExportStrategy(strategyBase, 'webm'), 'encode', '跨容器必须重编码（VP9 → H.264）')
assert.equal(recordingExportStrategy({ ...strategyBase, format: 'webm' }, 'mp4'), 'encode', '跨容器必须重编码（H.264 → VP9）')
assert.equal(recordingExportStrategy(strategyBase, 'unknown'), 'encode', '容器无法识别时走安全的重编码路径')
assert.equal(recordingExportStrategy({ ...strategyBase, format: 'gif' }, 'mp4'), 'encode', 'GIF 始终重编码')
assert.equal(recordingExportStrategy({ ...strategyBase, format: 'mp3' }, 'mp4'), 'encode', 'MP3 始终重编码')
assert.equal(recordingExportStrategy({ ...strategyBase, trimEndMs: 5_000 }, 'mp4'), 'encode', '有裁剪范围 → 重编码')
assert.equal(recordingExportStrategy({ ...strategyBase, outputWidth: 1280, outputHeight: 720 }, 'mp4'), 'encode', '改变输出分辨率 → 重编码')
assert.equal(recordingExportStrategy({ ...strategyBase, edit: { speed: 1.5 } }, 'mp4'), 'encode', '变速 → 重编码')

// 直通封装参数：视频流 copy、音频转 AAC（Opus-in-MP4 兼容性差）
const remuxArgs = buildRecordingRemuxArgs('in.mp4', 'out.mp4', strategyBase)
assert.ok(remuxArgs.includes('-c:v') && remuxArgs[remuxArgs.indexOf('-c:v') + 1] === 'copy', '直通封装不得重编码视频流')
assert.ok(remuxArgs.includes('-c:a') && remuxArgs[remuxArgs.indexOf('-c:a') + 1] === 'aac', '直通封装把音频转成 AAC')
assert.ok(remuxArgs.includes('-movflags') && remuxArgs.includes('+faststart'), '直通封装带 faststart')
const remuxMuted = buildRecordingRemuxArgs('in.mp4', 'out.mp4', { ...strategyBase, edit: { muteAudio: true } })
assert.ok(remuxMuted.includes('-an') && !remuxMuted.includes('-c:a'), '静音的直通封装不引入音轨')

/* ---------------- 编码器选择（P0：探测 + 实测 + 回退，绝不盲用硬件） ---------------- */

// 量化档映射：硬件编码器没有逐帧码率控制，保守 +1 档补偿感知质量损失
assert.equal(hardwareQuantizerForCrf(22), 23, 'crf 22 → cq 23')
assert.equal(hardwareQuantizerForCrf(0), 0, 'crf 0（无损档）映射为 0')
assert.equal(hardwareQuantizerForCrf(51), 51, '上限收敛到 51')
assert.equal(hardwareQuantizerForCrf(Number.NaN), 23, '非法输入回落到均衡档，不产生 NaN，也不会意外变成超大无损')
assert.equal(crfFor('balanced'), 22, '质量档到 CRF 的映射与导出侧共用同一张表')
assert.deepEqual(videoEncoderArgs('libx264', 22), ['-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p'], '软件编码参数保持不变')
const nvenc = videoEncoderArgs('h264_nvenc', 22)
assert.ok(nvenc.includes('h264_nvenc') && nvenc.includes('-cq') && nvenc.includes('-b:v') && nvenc.includes('0'), 'NVENC 用 CQ 且必须显式 -b:v 0（否则 CQ 被码率上限覆盖）')
assert.ok(videoEncoderArgs('h264_qsv', 22).includes('h264_qsv') && videoEncoderArgs('h264_qsv', 22).includes('nv12'), 'QSV 需要 nv12 像素格式')
assert.ok(videoEncoderArgs('h264_amf', 22).includes('-rc') && videoEncoderArgs('h264_amf', 22).includes('cqp'), 'AMF 用 CQP')

// 列表解析只做筛选；能不能用必须靠试编码（本机实测：amf 在列表里但 DLL 缺失）
const listing = [' V....D h264_nvenc            NVIDIA NVENC H.264 encoder', ' V..... h264_qsv              H.264 (Intel QSV)', ' V....D h264_amf              AMD AMF H.264 Encoder', ' V....D libx264              libx264 H.264'].join(String.fromCharCode(10))
assert.deepEqual(parseHardwareEncoders(listing), ['h264_nvenc', 'h264_amf', 'h264_qsv'], '按 nvenc → amf → qsv 顺序筛出硬件编码器')
assert.deepEqual(parseHardwareEncoders(' V..... libx264  libx264 H.264'), [], '没有硬件编码器时返回空数组（调用方保持软件编码）')

// 决策：只有明确更快才切硬件
const trials = (entries: Array<[string, number, boolean]>) => entries.map(([encoder, ms, ok]) => ({ encoder: encoder as never, ms, ok }))
assert.equal(pickFastestEncoder(trials([['libx264', 20_000, true], ['h264_nvenc', 8_000, true]])), 'h264_nvenc', '实测快 2.5× 的硬件编码应被采用')
assert.equal(pickFastestEncoder(trials([['libx264', 20_000, true], ['h264_qsv', 20_300, true]])), 'libx264', '与软件持平（本机实测）不切换')
assert.equal(pickFastestEncoder(trials([['libx264', 20_000, true], ['h264_amf', 600, false]])), 'libx264', '试编码失败（DLL 缺失）不得被采用')
assert.equal(pickFastestEncoder(trials([['libx264', 20_000, true], ['h264_nvenc', 18_000, true]])), 'libx264', '只快 11% 不到 15% 门槛时不切换')
assert.equal(pickFastestEncoder(trials([['libx264', 20_000, true], ['h264_nvenc', 8_000, true], ['h264_qsv', 6_000, true]])), 'h264_qsv', '多个可用时取最快')
assert.equal(pickFastestEncoder(trials([['h264_nvenc', 8_000, true]])), 'libx264', '没有软件基线时不冒险切硬件')

// 试编码选择：注入假 runner 直接验证"探测 → 实测 → 回退"的完整流程
const encoderListing = [' V....D h264_nvenc            NVIDIA NVENC H.264 encoder', ' V..... h264_qsv              H.264 (Intel QSV)', ' V....D h264_amf              AMD AMF H.264 Encoder'].join(String.fromCharCode(10))
const fakeRunner = (listing: string, times: Record<string, number>, failures: string[] = []): EncoderRunner =>
  (args) => {
    if (args.includes('-encoders')) return Promise.resolve({ code: 0, output: listing, ms: 5 })
    const line = args.join(' ')
    for (const encoder of failures) if (line.includes(encoder)) return Promise.resolve({ code: 1, output: 'DLL failed to open', ms: 600 })
    const encoder = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'].find((name) => line.includes(name)) || 'libx264'
    return Promise.resolve({ code: 0, output: '', ms: times[encoder] ?? 1_000 })
  }

const merged = await detectHardwareEncoders('ffmpeg.exe', fakeRunner(encoderListing, {}))
assert.deepEqual(merged, ['h264_nvenc', 'h264_amf', 'h264_qsv'], '探测结果按偏好顺序返回')

// 本机实测形态：nvenc 快 2.76×、qsv 与软件持平、amf 列表里有但运行期失败
const picked = await pickVideoEncoder('ffmpeg.exe', 'in.webm', 22, {}, fakeRunner(encoderListing, { libx264: 21_890, h264_nvenc: 7_930, h264_qsv: 20_328 }, ['h264_amf']))
assert.equal(picked.encoder, 'h264_nvenc', '本机实测形态下应选中 NVENC（2.76×）')
assert.equal(picked.trials.find((t) => t.encoder === 'h264_amf')?.ok, false, '试编码失败的编码器被标记为不可用')
assert.equal(picked.trials.find((t) => t.encoder === 'h264_qsv')?.ok, true, '试编码成功但不够快，仅记录不采用')

// 只有 Intel 核显的机器：qsv 不比软件快 → 保持软件编码
const intelOnly = [' V..... h264_qsv              H.264 (Intel QSV)'].join(String.fromCharCode(10))
const intelPick = await pickVideoEncoder('ffmpeg.exe', 'in.webm', 22, {}, fakeRunner(intelOnly, { libx264: 6_000, h264_qsv: 7_000 }))
assert.equal(intelPick.encoder, 'libx264', '核显机器上 QSV 更慢时保持软件编码')

// 软件基线自身失败 → 不冒险切硬件
const noBaseline = await pickVideoEncoder('ffmpeg.exe', 'in.webm', 22, {}, fakeRunner(encoderListing, { h264_nvenc: 1_000 }, ['libx264']))
assert.equal(noBaseline.encoder, 'libx264', '软件基线试编码失败时不切硬件')

/* ---------------- P1：帧率无关的相机平滑 + 空闲区间识别 ---------------- */

// 平滑：同一段真实时间跨过多少，收敛程度应当一致，与帧率无关
const alphaAt30 = recordingSmoothingAlpha(1000 / 30, 0.11)
const alphaAt24 = recordingSmoothingAlpha(1000 / 24, 0.11)
assert.ok(Math.abs(alphaAt30 - 0.11) < 0.002, '30fps 下换算回的系数应等于原调参值（保持既有手感）')
assert.ok(alphaAt24 > alphaAt30, '帧间隔更长时单帧系数应变大（这样每秒收敛程度才一致）')
// 跨 100ms：30fps 走 3 帧、24fps 走 2.4 帧，剩余误差应接近
const remain = (alpha: number, steps: number) => (1 - alpha) ** steps
assert.ok(Math.abs(remain(alphaAt30, 3) - remain(alphaAt24, 2.4)) < 0.03, `跨同样时长后残余误差应接近（30fps ${remain(alphaAt30, 3).toFixed(3)} vs 24fps ${remain(alphaAt24, 2.4).toFixed(3)}）`)
assert.equal(recordingSmoothingAlpha(33, 1), 1, '系数 1 表示瞬时贴合')
assert.ok(recordingSmoothingAlpha(Number.NaN, 0.1) > 0, '非法帧间隔回落到参考帧长而不是产生 NaN')
assert.equal(recordingLerpTimed(0, 100, 1000 / 30, 1), 100, '按时间平滑在系数为 1 时直接到目标')
// 录制目标 60fps 时以 60fps 为参考：掉到 24fps 后系数变大、按秒计的收敛程度不变
const half = 1000 / 60
assert.ok(Math.abs(recordingSmoothingAlpha(half, 0.11, half) - 0.11) < 0.002, '参考帧长等于真实帧长时系数就是调参值')
assert.ok(
  recordingSmoothingAlpha(1000 / 24, 0.11, half) > recordingSmoothingAlpha(half, 0.11, half),
  '以 60fps 为目标时，掉帧到 24fps 的单帧系数应变大以补偿时间跨度'
)
const perSecond = (alpha: number, steps: number) => 1 - (1 - alpha) ** steps
assert.ok(
  Math.abs(perSecond(recordingSmoothingAlpha(half, 0.11, half), 60) - perSecond(recordingSmoothingAlpha(1000 / 24, 0.11, half), 24)) < 0.05,
  '每秒收敛程度在 60fps 与 24fps 下应基本一致（掉帧只影响运镜粗糙度，不影响跟随速度）'
)

// 空闲识别：光标静止超过阈值即空闲；头尾各留 1 秒避免剪掉开场与收尾
const still = (from: number, to: number, x = 100, y = 100) => {
  const out = []
  for (let t = from; t <= to; t += 16) out.push({ t, x, y })
  return out
}
const moving = (from: number, to: number) => {
  const out = []
  let x = 0
  for (let t = from; t <= to; t += 16) out.push({ t, x: (x += 40), y: 0 })
  return out
}
const idleSamples = [...moving(0, 10_000), ...still(10_000, 20_000), ...moving(20_000, 30_000)]
const idle = recordingIdleRanges(idleSamples, 30_000)
assert.equal(idle.length, 1, `应识别出一段空闲（实测 ${JSON.stringify(idle)}）`)
assert.ok(idle[0].startMs >= 10_000 && idle[0].startMs < 11_100, '空闲起点应贴近光标停止移动的时刻（允许一个采样间隔）')
assert.ok(idle[0].endMs <= 20_100, '空闲终点应贴近光标恢复移动的时刻')
assert.deepEqual(recordingIdleRanges([...moving(0, 30_000)], 30_000), [], '全程有移动时不产生空闲段')
assert.deepEqual(recordingIdleRanges([], 30_000), [], '没有轨迹数据时不做任何猜测')
// 开场长时间静止：要识别出来（"录了才发现还在发呆"是最常见的待剪内容），但前 edgeKeepMs 保留
const headIdle = recordingIdleRanges([...still(0, 8_000), ...moving(8_000, 30_000)], 30_000)
assert.equal(headIdle.length, 1, '开场长时间静止应被识别')
assert.equal(headIdle[0].startMs, 1_000, '开头保留 edgeKeepMs，避免把开场画面整段抹掉')
assert.ok(headIdle[0].endMs <= 8_100, '开场空闲的终点应贴近光标开始移动的时刻')

// 保留段：空闲之外的部分就是要保留的片段，且不产出碎片
const kept = recordingKeptSegmentsFromIdle([{ startMs: 10_000, endMs: 20_000 }], 30_000)
assert.deepEqual(kept, [{ startMs: 0, endMs: 10_000 }, { startMs: 20_000, endMs: 30_000 }], '空闲区间之外应保留为两段')
assert.deepEqual(recordingKeptSegmentsFromIdle([], 30_000), [], '没有空闲段时不改动时间轴')
assert.deepEqual(recordingKeptSegmentsFromIdle([{ startMs: 0, endMs: 30_000 }], 30_000), [], '整段空闲时没有可保留的片段')
// 两段空闲之间只隔 200ms：合并成一段，不产出夹在中间的几百毫秒碎片保留段
const tiny = recordingKeptSegmentsFromIdle([{ startMs: 1_000, endMs: 10_000 }, { startMs: 10_200, endMs: 20_000 }], 30_000)
assert.deepEqual(
  tiny,
  [{ startMs: 0, endMs: 1_000 }, { startMs: 20_000, endMs: 30_000 }],
  '相隔很近的两段空闲应合并，不产生碎片段'
)
assert.equal(
  tiny.some((range) => range.startMs >= 9_000 && range.endMs <= 12_000),
  false,
  '不得出现夹在两段空闲之间的碎片保留段'
)

/* ---------------- P1-d：导出期运镜（轨迹 → 逐帧路径 → FFmpeg 表达式） ---------------- */

// 逐帧路径：与录制期实时运镜同语义（缩放 ≥1、中心钳在画面内、剪掉的区间不占帧位）
const pathSamples = [...still(0, 2_000), ...moving(2_000, 10_000)]
const pathFrames = recordingMotionFrames(pathSamples, [{ startMs: 0, endMs: 10_000 }], { fps: 30, motion: 'gentle', strength: 0.6, maxZoom: 1.6 })
assert.equal(pathFrames.length, 300, `30fps × 10 秒应产出 300 帧路径（实测 ${pathFrames.length}）`)
assert.ok(pathFrames.every((frame) => frame.zoom >= 1 && frame.zoom <= 1.6), '缩放必须落在 [1, maxZoom]')
assert.ok(pathFrames.every((frame) => frame.x >= 0 && frame.x <= 1 && frame.y >= 0 && frame.y <= 1), '画面中心必须钳在 [0,1]')
assert.ok(pathFrames.at(-1)!.zoom > 1.01, '光标一直在动时成片应推近（而不是恒定 1 倍）')
assert.deepEqual(recordingMotionFrames([], [{ startMs: 0, endMs: 1_000 }], { fps: 30, motion: 'gentle', strength: 0.6, maxZoom: 1.6 }), [], '没有轨迹时不给运镜路径')
// 剪辑后：只按保留区间的帧数出路径，被剪掉的时间不占帧位（主进程才能把下标直接当 zoompan 的 in）
const clipped = recordingMotionFrames(pathSamples, [{ startMs: 0, endMs: 2_000 }, { startMs: 8_000, endMs: 10_000 }], { fps: 30, motion: 'gentle', strength: 0.6, maxZoom: 1.6 })
assert.equal(clipped.length, 120, `两段各 2 秒 → 120 帧（实测 ${clipped.length}）`)

// 表达式编译：直线运动应压成两个航点，且 x/y 必须钳在画面内（否则放大后露黑边）
const linear = { fps: 30, frames: Array.from({ length: 90 }, (_, index) => ({ x: 0.2 + (0.6 * index) / 89, y: 0.5, zoom: 1.5 })) }
assert.equal(simplifyRecordingMotion(linear).length, 2, '严格的直线运动只需首尾两个航点')
const motionFilter = buildRecordingMotionFilter(linear, 640, 360, 30)
assert.ok(motionFilter, '应生成 zoompan 滤镜')
assert.match(motionFilter!, /^zoompan=/, '运镜滤镜是 zoompan')
assert.match(motionFilter!, /d=1/, 'd=1：输出帧数等于输入帧数（默认 d=90 会把每帧复制 90 份）')
assert.match(motionFilter!, /s=640x360/, '输出尺寸由 s= 决定')
assert.match(motionFilter!, /max\(0,min\(iw-iw\/zoom/, 'x 必须钳在 [0, iw-iw/zoom]，放大后不能露黑边')
assert.match(motionFilter!, /max\(0,min\(ih-ih\/zoom/, 'y 同理')
assert.doesNotMatch(motionFilter!, /[^a-z]t[^a-z]/, 'zoompan 表达式里没有 t（实测报 Undefined constant），时间轴必须用帧序 in')
assert.equal(buildRecordingMotionFilter({ fps: 30, frames: [{ x: 0.5, y: 0.5, zoom: 1 }] }, 640, 360, 30), null, '单帧构不成运动，不生成滤镜')
// 真实路径（录制期平滑过的光标轨迹 → 逐帧相机路径）应能在基准容差内压进上限，并逐帧逼近
const realPath = { fps: 30, frames: recordingMotionFrames(pathSamples, [{ startMs: 0, endMs: 10_000 }], { fps: 30, motion: 'dynamic', strength: 0.6, maxZoom: 1.6 }) }
const realWaypoints = simplifyRecordingMotion(realPath)
assert.ok(realWaypoints.length > 2, `真实运镜路径不能只剩两个航点（实测 ${realWaypoints.length}）`)
assert.ok(realWaypoints.length <= MAX_MOTION_WAYPOINTS, `真实路径的航点数应在上限内（实测 ${realWaypoints.length}）`)
/** 折线逼近误差：任何被丢弃的帧与相邻两航点插值的最大偏差（归一化画面）。 */
const polylineError = (track: { frames: Array<{ x: number; y: number }> }, waypoints: number[]): number => {
  let worst = 0
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const start = waypoints[index]
    const end = waypoints[index + 1]
    for (let probe = start; probe <= end; probe += 1) {
      const ratio = (probe - start) / Math.max(1, end - start)
      worst = Math.max(
        worst,
        Math.abs(track.frames[probe].x - (track.frames[start].x + (track.frames[end].x - track.frames[start].x) * ratio)),
        Math.abs(track.frames[probe].y - (track.frames[start].y + (track.frames[end].y - track.frames[start].y) * ratio))
      )
    }
  }
  return worst
}
const realError = polylineError(realPath, realWaypoints)
assert.ok(realError <= MOTION_MAX_CENTER_TOLERANCE, `真实路径的折线逼近误差应不超过 2% 画面（实测 ${realError.toFixed(4)}）`)
assert.equal(realWaypoints[0], 0, '首帧必留')
assert.equal(realWaypoints.at(-1), realPath.frames.length - 1, '末帧必留')

// 退化情形：逐帧来回抖动（周期约 19 帧）在 48 段内根本没法逐帧逼近。这时只保证
// "不塌成直线、首尾不丢、表达式不撑爆命令行"——真实轨迹经录制期平滑不会长这样。
const jittery = { fps: 30, frames: Array.from({ length: 600 }, (_, index) => ({ x: 0.5 + Math.sin(index / 3) * 0.3, y: 0.5 + Math.cos(index / 5) * 0.3, zoom: 1 + Math.abs(Math.sin(index / 7)) * 0.5 })) }
const jitterWaypoints = simplifyRecordingMotion(jittery)
assert.ok(jitterWaypoints.length > 2, `来回运动的路径不能只剩两个航点（实测 ${jitterWaypoints.length}）`)
assert.ok(jitterWaypoints.length <= MAX_MOTION_WAYPOINTS, `航点数必须受上限约束（实测 ${jitterWaypoints.length}）`)
assert.equal(jitterWaypoints[0], 0, '首帧必留')
assert.equal(jitterWaypoints.at(-1), 599, '末帧必留')
const longFilter = buildRecordingMotionFilter(jittery, 1920, 1080, 30)!
assert.ok(longFilter.length < 12_000, `运镜表达式不能撑爆命令行（实测 ${longFilter.length} 字符）`)

// 导出策略：有运镜时必须重编码（拷流等于运镜不生效）
assert.equal(recordingExportStrategy({ jobId: 'm', name: 'm', format: 'mp4', quality: 'high', durationMs: 1_000, width: 1920, height: 1080, fps: 30, motion: { fps: 30, frames: linear.frames } }, 'mp4'), 'encode', '导出期运镜必须走重编码')
assert.equal(recordingExportStrategy({ jobId: 'm', name: 'm', format: 'mp4', quality: 'high', durationMs: 1_000, width: 1920, height: 1080, fps: 30 }, 'mp4'), 'remux', '没有运镜时仍走最快的直接封装')

console.log('recording tests passed')
