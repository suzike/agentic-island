import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeRecordingOutput, recordingExportVerdict, startRecordingFfmpeg } from '../src/main/recording-export.ts'
import { recordingMotionFramesFromKeyframes } from '../src/renderer/src/logic/recording.ts'
import type { RecordingExportRequest } from '../src/shared/protocol.ts'

const ffmpeg = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const root = await mkdtemp(join(tmpdir(), 'recording-export-e2e-'))
try {
  const source = join(root, 'source.mp4')
  const generated = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source], { windowsHide: true, encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr || '生成测试视频失败')

  const subtitle = join(root, 'subtitle.srt')
  await writeFile(subtitle, '1\n00:00:00,250 --> 00:00:01,500\n真实字幕验证\n', 'utf8')
  const base: RecordingExportRequest = { jobId: 'e2e-video', name: 'e2e', format: 'mp4', quality: 'compact', durationMs: 3_000, width: 640, height: 360, fps: 30, hasAudio: true, outputWidth: 320, outputHeight: 180, outputFps: 24, subtitleFilePath: subtitle, subtitle: { mode: 'embedded', language: 'zh', segments: [{ startMs: 250, endMs: 1_500, text: '真实字幕验证' }] } }
  const videoOutput = join(root, 'delivery.mp4')
  let videoProgress = 0
  const video = startRecordingFfmpeg(ffmpeg, source, videoOutput, base, (value) => { videoProgress = value })
  await video.done
  assert.equal(videoProgress, 1, '视频导出进度完成')
  assert.ok((await stat(videoOutput)).size > 10_000, '生成有效 MP4 文件')

  const extracted = join(root, 'extracted.srt')
  const subtitleResult = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoOutput, '-map', '0:s:0', extracted], { windowsHide: true, encoding: 'utf8' })
  assert.equal(subtitleResult.status, 0, subtitleResult.stderr || '提取内嵌字幕失败')
  assert.match(await readFile(extracted, 'utf8'), /真实字幕验证/, 'MP4 包含可开关字幕轨')

  const audioOutput = join(root, 'delivery.mp3')
  const audio = startRecordingFfmpeg(ffmpeg, source, audioOutput, { ...base, jobId: 'e2e-audio', format: 'mp3', quality: 'near-lossless', subtitleFilePath: undefined }, () => {})
  await audio.done
  assert.ok((await stat(audioOutput)).size > 20_000, '生成有效 MP3 文件')
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', audioOutput, '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' })
  assert.equal(decoded.status, 0, decoded.stderr || 'MP3 解码验证失败')

  /** 读取成品时长与视频声明帧率（都从 ffmpeg 的流信息里取，不依赖 ffprobe）。 */
  const probe = (file: string): { duration: number; videoFps: number | null } => {
    const info = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true, encoding: 'utf8' })
    const text = `${info.stderr}${info.stdout}`
    const durationMatch = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text)
    const fpsMatch = /Video:.*?(\d+(?:\.\d+)?) fps/.exec(text)
    return {
      duration: durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : 0,
      videoFps: fpsMatch ? Number(fpsMatch[1]) : null
    }
  }

  // 无剪辑 · MP4：导出必须显式归一化帧率并保持真实时间轴。
  // 录制源是 VFR WebM（容器标称帧率不可信，实测 tbr 1000），不归一化时封装器按标称值铺帧，
  // 会把 60 秒输入写成 60002 帧（1000fps、41 倍重复帧）——播放器表现完全不可预期。
  const plainOutput = join(root, 'plain.mp4')
  const plain = startRecordingFfmpeg(ffmpeg, source, plainOutput, { ...base, jobId: 'e2e-plain', outputWidth: 640, outputHeight: 360, outputFps: 30, subtitleFilePath: undefined, subtitle: undefined }, () => {})
  await plain.done
  const plainInfo = probe(plainOutput)
  assert.equal(plainInfo.videoFps, 30, `无剪辑导出应把视频帧率归一化为请求值（实测 ${plainInfo.videoFps}）`)
  assert.ok(Math.abs(plainInfo.duration - 3) < 0.35, `无剪辑导出时长应保持源时长（实测 ${plainInfo.duration}）`)

  // 多片段 · MP4：按时间 trim 再 concat。成片时长必须等于各片段之和（3 秒源取 0–1s 与 2–3s → 2 秒），
  // 且音轨与画面同时被裁剪——不允许只压画面不压声音。
  const editedOutput = join(root, 'edited.mp4')
  const edited = startRecordingFfmpeg(ffmpeg, source, editedOutput, {
    ...base,
    jobId: 'e2e-edited',
    outputWidth: 640,
    outputHeight: 360,
    outputFps: 30,
    subtitleFilePath: undefined,
    subtitle: undefined,
    edit: { segments: [{ id: 'a', startMs: 0, endMs: 1_000, enabled: true }, { id: 'b', startMs: 2_000, endMs: 3_000, enabled: true }] }
  }, () => {})
  await edited.done
  const editedInfo = probe(editedOutput)
  assert.ok(Math.abs(editedInfo.duration - 2) < 0.35, `多片段成片时长应为片段之和 2 秒（实测 ${editedInfo.duration}）`)
  assert.equal(editedInfo.videoFps, 30, '多片段导出同样归一化帧率')
  const editedAudio = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', editedOutput, '-map', '0:a:0?', '-vn', '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' })
  const audioTime = /time=(\d+):(\d+):(\d+\.\d+)/.exec(`${editedAudio.stderr}`)
  const audioSeconds = audioTime ? Number(audioTime[1]) * 3600 + Number(audioTime[2]) * 60 + Number(audioTime[3]) : 0
  assert.ok(Math.abs(audioSeconds - 2) < 0.35, `多片段音轨应与画面等长（实测 ${audioSeconds}）`)

  // 导出期运镜：必须真的让"取景窗口"随帧移动，而不是接了个名字却什么都不做。
  // 用**横向亮度渐变**当素材：取景窗口越靠右，整帧平均亮度越高 —— 于是"逐帧平均亮度"这条
  // 曲线就是取景位置的直接读数（scale=1:1 把每帧压成一个像素，直接 dump 原始字节）。
  const rampSource = join(root, 'ramp.mp4')
  const ramp = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=3', '-vf', 'geq=lum=255*X/W:cb=128:cr=128', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', rampSource], { windowsHide: true, encoding: 'utf8' })
  assert.equal(ramp.status, 0, ramp.stderr || '生成渐变素材失败')
  const frameLuma = (file: string): number[] => {
    const dump = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { windowsHide: true, maxBuffer: 1 << 24 })
    return [...(dump.stdout as Buffer)]
  }
  const motionBase: RecordingExportRequest = {
    ...base,
    jobId: 'e2e-motion',
    width: 640,
    height: 360,
    outputWidth: 640,
    outputHeight: 360,
    outputFps: 30,
    subtitleFilePath: undefined,
    subtitle: undefined,
    hasAudio: false
  }
  const controlFile = join(root, 'motion-control.mp4')
  await startRecordingFfmpeg(ffmpeg, rampSource, controlFile, motionBase, () => {}).done
  // zoom 必须 > 1 才**有**东西可平移：zoom=1 时取景窗口等于整幅画面，x 被钳死在 0（这是对的，
  // 否则就会露出黑边）。所以下面的轨迹是"1.5 倍推近 + 横向扫过"。
  const motionFile = join(root, 'motion.mp4')
  const frames = Array.from({ length: 90 }, (_, index) => ({ x: 0.2 + (0.6 * index) / 89, y: 0.5, zoom: 1.5 }))
  const motionStart = Date.now()
  await startRecordingFfmpeg(ffmpeg, rampSource, motionFile, { ...motionBase, motion: { fps: 30, frames } }, () => {}).done
  const motionInfo = probe(motionFile)
  assert.equal(motionInfo.videoFps, 30, '导出期运镜同样要归一化帧率')
  assert.ok(Math.abs(motionInfo.duration - 3) < 0.35, `导出期运镜不得改变时长（实测 ${motionInfo.duration}）`)
  const controlLuma = frameLuma(controlFile)
  const motionLuma = frameLuma(motionFile)
  assert.ok(controlLuma.length > 60 && motionLuma.length > 60, `应解出足够多的帧（对照 ${controlLuma.length} / 运镜 ${motionLuma.length}）`)
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
  assert.ok(spread(controlLuma) < 6, `无运镜时逐帧平均亮度应基本不变（实测波动 ${spread(controlLuma)}）`)
  assert.ok(spread(motionLuma) > 50, `有运镜时取景窗口应明显扫过画面（实测平均亮度跨幅 ${spread(motionLuma)}）`)
  assert.ok(motionLuma.at(-1)! > motionLuma[0] + 30, `向右扫过时平均亮度应整体上升（${motionLuma[0]} → ${motionLuma.at(-1)}）`)
  // 单调性：允许夹紧在画面边界造成的平台，但不允许回退
  const regressions = motionLuma.filter((value, index) => index > 0 && value < motionLuma[index - 1] - 3).length
  assert.equal(regressions, 0, `取景扫过不应出现回退（实测 ${regressions} 帧回退）`)
  console.log(`  导出期运镜: 平均亮度 ${motionLuma[0]} → ${motionLuma.at(-1)}（跨幅 ${spread(motionLuma)}），耗时 ${Date.now() - motionStart}ms`)
  // 成品自检：用真实 FFmpeg 读回写出的文件，确认"元数据与请求一致"这件事本身可用。
  // 这一条补的是"导出成功"的可信度——本项目两次事故都是文件写成功但内容不对。
  const motionProbe = await probeRecordingOutput(ffmpeg, motionFile)
  console.log(`  成品自检读取: ${motionProbe.durationMs}ms / ${motionProbe.fps}fps / ${motionProbe.videoCodec}`)
  assert.ok(Math.abs(motionProbe.durationMs - 3_000) < 120, `探测应读到真实时长（实测 ${motionProbe.durationMs}ms）`)
  assert.equal(motionProbe.fps, 30, '探测应读到 30fps（运镜导出后仍是恒定帧率）')
  assert.equal(motionProbe.videoCodec, 'h264', '探测应读到 H.264')
  assert.equal(motionProbe.hasAudio, false, '这条请求没有音轨，探测不得凭空报有声音')
  const motionVerdict = recordingExportVerdict(motionBase, motionProbe)
  assert.equal(motionVerdict.ok, true, `真实成品的自检应通过（实测 ${motionVerdict.warnings.join('；')}）`)
  // 反向：把同一份成品拿一个"请求 60fps"的请求去自检，必须被判为不一致（否则自检等于没接）
  assert.equal(recordingExportVerdict({ ...motionBase, outputFps: 60 }, motionProbe).ok, false, '帧率不符时自检必须报出来')
  const controlProbe = await probeRecordingOutput(ffmpeg, controlFile)
  assert.match(recordingExportVerdict({ ...motionBase, hasAudio: true }, controlProbe).warnings.join(''), /音轨|没有声音/, '请求带音轨而成品无声音时要报出来')
  // 画幅重组：原始采集录的是屏幕原始画幅（这里用 640x400 的 16:10 素材代表），
  // 导出到 16:9 必须真的变成 640x360，而不是"缩成小一圈"。
  const wideSource = join(root, 'wide.mp4')
  const wideGenerated = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x400:r=30:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', wideSource], { windowsHide: true, encoding: 'utf8' })
  assert.equal(wideGenerated.status, 0, wideGenerated.stderr || '生成 16:10 素材失败')
  const aspectBase: RecordingExportRequest = {
    ...motionBase,
    jobId: 'e2e-aspect',
    width: 640,
    height: 400,
    hasAudio: false,
    subtitle: undefined,
    subtitleFilePath: undefined
  }
  const containedFile = join(root, 'aspect-contain.mp4')
  await startRecordingFfmpeg(ffmpeg, wideSource, containedFile, { ...aspectBase, outputWidth: 640, outputHeight: 360, fit: 'contain' }, () => {}).done
  const containedInfo = probe(containedFile)
  const containedSize = /Video:.*?, (\d+)x(\d+)/.exec(`${spawnSync(ffmpeg, ['-hide_banner', '-i', containedFile], { windowsHide: true, encoding: 'utf8' }).stderr}`)
  assert.equal(`${containedSize?.[1]}x${containedSize?.[2]}`, '640x360', `补边模式成片尺寸应等于请求的 16:9（实测 ${containedSize?.[1]}x${containedSize?.[2]}）`)
  assert.ok(Math.abs(containedInfo.duration - 2) < 0.3, `画幅重组不得改变时长（实测 ${containedInfo.duration}）`)
  // 16:10 素材放进 16:9 是**左右**补黑边（素材更窄，按高装得下），所以取左侧一列来验证补边真的存在。
  // 注意别取上下：那是 letterbox 的方向，这里补的是 pillarbox。
  const leftStrip = (file: string, height: number) => spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `crop=4:${height}:0:0,scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { windowsHide: true, maxBuffer: 1 << 20 })
  const containedLuma = Number((leftStrip(containedFile, 360).stdout as Buffer)[0])
  assert.ok(containedLuma < 20, `contain 模式左缘应是补出来的黑边（实测亮度 ${containedLuma}）`)
  const containedTop = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', containedFile, '-frames:v', '1', '-vf', 'crop=640:4:0:0,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { windowsHide: true, maxBuffer: 1 << 20 })
  assert.ok(Number((containedTop.stdout as Buffer)[0]) > 20, `contain 模式顶部应是画面内容（实测亮度 ${(containedTop.stdout as Buffer)[0]}）`)
  const coveredFile = join(root, 'aspect-cover.mp4')
  await startRecordingFfmpeg(ffmpeg, wideSource, coveredFile, { ...aspectBase, outputWidth: 360, outputHeight: 640, fit: 'cover' }, () => {}).done
  const coveredText = `${spawnSync(ffmpeg, ['-hide_banner', '-i', coveredFile], { windowsHide: true, encoding: 'utf8' }).stderr}`
  const coveredSize = /Video:.*?, (\d+)x(\d+)/.exec(coveredText)
  assert.equal(`${coveredSize?.[1]}x${coveredSize?.[2]}`, '360x640', `铺满模式成片尺寸应等于请求的 9:16（实测 ${coveredSize?.[1]}x${coveredSize?.[2]}）`)
  // 铺满不补边：整幅仍是素材内容（红色），不该出现黑边
  const coveredLuma = Number((leftStrip(coveredFile, 640).stdout as Buffer)[0])
  assert.ok(coveredLuma > 20, `cover 模式左缘应是画面内容而不是黑边（实测亮度 ${coveredLuma}）`)
  console.log(`  画幅重组: contain ${containedSize?.[1]}x${containedSize?.[2]} / cover ${coveredSize?.[1]}x${coveredSize?.[2]}`)
  // 跨画幅 + 运镜：先按目标画幅裁齐、再把路径重映射进去。这里用横向渐变素材验证两件事——
  // ① 成片尺寸真的变成目标画幅 ② 取景窗口仍然随帧移动（运镜没被画幅重组吃掉）。
  const crossFile = join(root, 'motion-cross.mp4')
  const crossFrames = Array.from({ length: 90 }, (_, index) => ({ x: 0.5, y: 0.5, zoom: 1.5, ...(index === 0 ? {} : {}) }))
  const crossCrop = { x: (1 - 0.5625 / (640 / 360)) / 2, y: 0, width: 0.5625 / (640 / 360), height: 1 }
  const crossPath = Array.from({ length: 90 }, (_, index) => {
    const raw = 0.2 + (0.6 * index) / 89
    return { x: Math.max(0, Math.min(1, (raw - crossCrop.x) / crossCrop.width)), y: 0.5, zoom: 1.5 }
  })
  await startRecordingFfmpeg(ffmpeg, rampSource, crossFile, {
    ...motionBase,
    jobId: 'e2e-motion-cross',
    outputWidth: 360,
    outputHeight: 640,
    motion: { fps: 30, frames: crossPath, crop: crossCrop }
  }, () => {}).done
  const crossText = `${spawnSync(ffmpeg, ['-hide_banner', '-i', crossFile], { windowsHide: true, encoding: 'utf8' }).stderr}`
  const crossSize = /Video:.*?, (\d+)x(\d+)/.exec(crossText)
  assert.equal(`${crossSize?.[1]}x${crossSize?.[2]}`, '360x640', `跨画幅运镜成片应是目标画幅（实测 ${crossSize?.[1]}x${crossSize?.[2]}）`)
  const crossLuma = frameLuma(crossFile)
  assert.ok(crossLuma.length > 60, `跨画幅运镜应解出足够帧（实测 ${crossLuma.length}）`)
  // 跨幅门槛比同画幅低是应该的：裁齐后只剩约 36% 的宽度可供平移，渐变上可取的平均亮度范围
  // 也按同比例缩小（同画幅实测 115，这里约 37）。断言仍然证明"取景窗口在动"，只是范围更小。
  assert.ok(spread(crossLuma) > 25, `跨画幅时取景窗口仍应扫过画面（实测跨幅 ${spread(crossLuma)}，裁齐后可用宽度约 36%）`)
  const crossVerdict = recordingExportVerdict({ ...motionBase, outputWidth: 360, outputHeight: 640 }, await probeRecordingOutput(ffmpeg, crossFile))
  assert.equal(crossVerdict.warnings.some((w) => /未生效/.test(w)), false, '跨画幅运镜不应被判为未生效')
  console.log(`  跨画幅运镜: ${crossSize?.[1]}x${crossSize?.[2]}，平均亮度跨幅 ${spread(crossLuma)}`)
  // 人工编辑的运镜点必须真的改变成片取景。用横向渐变素材 + 两个极端运镜点：
  // 开头看左边（x=0.15）、结尾看右边（x=0.85），成片的平均亮度应当明显变亮（右边更白）。
  const editedFile = join(root, 'motion-edited.mp4')
  const editedKeyframes = [
    { t: 0, x: 0.15, y: 0.5, zoom: 1.5 },
    { t: 1_500, x: 0.5, y: 0.5, zoom: 1.5 },
    { t: 2_900, x: 0.85, y: 0.5, zoom: 1.5 }
  ]
  const editedPath = recordingMotionFramesFromKeyframes(editedKeyframes, [{ startMs: 0, endMs: 3_000 }], { fps: 30, strength: 0.5, maxZoom: 1.6 })
  assert.equal(editedPath.length, 90, `3 秒 30fps 应重建 90 帧（实测 ${editedPath.length}）`)
  await startRecordingFfmpeg(ffmpeg, rampSource, editedFile, { ...motionBase, jobId: 'e2e-motion-edited', motion: { fps: 30, frames: editedPath } }, () => {}).done
  const editedLuma = frameLuma(editedFile)
  assert.ok(editedLuma.length > 60, `应解出足够帧（实测 ${editedLuma.length}）`)
  assert.ok(editedLuma.at(-1)! > editedLuma[0] + 40, `人工运镜应从左侧扫到右侧（${editedLuma[0]} → ${editedLuma.at(-1)}）`)
  // 反向对照：同样两个极端点但顺序反过来，成片必须更暗 —— 证明取景真的跟着编辑走，而不是碰巧变亮
  const reversedPath = recordingMotionFramesFromKeyframes([
    { t: 0, x: 0.85, y: 0.5, zoom: 1.5 },
    { t: 2_900, x: 0.15, y: 0.5, zoom: 1.5 }
  ], [{ startMs: 0, endMs: 3_000 }], { fps: 30, strength: 0.5, maxZoom: 1.6 })
  const reversedFile = join(root, 'motion-reversed.mp4')
  await startRecordingFfmpeg(ffmpeg, rampSource, reversedFile, { ...motionBase, jobId: 'e2e-motion-reversed', motion: { fps: 30, frames: reversedPath } }, () => {}).done
  const reversedLuma = frameLuma(reversedFile)
  assert.ok(reversedLuma.at(-1)! < reversedLuma[0] - 40, `反向运镜应从右侧扫到左侧（${reversedLuma[0]} → ${reversedLuma.at(-1)}）`)
  console.log(`  人工运镜点: 正向 ${editedLuma[0]} → ${editedLuma.at(-1)}；反向 ${reversedLuma[0]} → ${reversedLuma.at(-1)}`)
  console.log('recording export e2e tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
