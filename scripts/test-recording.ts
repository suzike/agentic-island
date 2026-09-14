import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildRecordingFfmpegArgs, recordingExportDurationMs, recordingExportSubtitleSegments, recordingHasEdits } from '../src/main/recording-export.ts'
import { clampRecordingBarPosition, formatRecordingTime, normalizeRecordingSegments, parseRecordingAiEditPlan, recordingElapsed, recordingFitComposition, recordingFocusCrop, recordingFrameBudget, recordingHealth, recordingLerp, recordingOutputSize, recordingPreviewSize, recordingRegionCrop, recordingSegmentsDuration, recordingSourcePointToOutput, recordingStartError, recordingTranscriptToSrt, recordingTranscriptToVtt, recordingVideoBitrate, recordingZoomForMotion, selectRecorderMime, selectRecordingSourceId, snapRecordingTime, splitRecordingSegment, stylizeRecordingAnimeFrame, writePreviewPosition,
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

console.log('recording tests passed')
