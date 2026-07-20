import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Aperture, AppWindow, Bot, Camera, Check, CircleStop, Clock3, Copy, Crop, Download, Eye, EyeOff, FileText, Film, FlipHorizontal2, FlipVertical2, FolderKanban, Gauge, Image as ImageIcon, Layers, LayoutGrid, List, ListChecks, Lock, Magnet, Maximize2, Mic, MicOff, Minimize2, Monitor, MousePointer2, Network, Pause, Play, Plus, Redo2, RefreshCw, RotateCw, Save, Scissors, Search, Shield, SlidersHorizontal, Sparkles, Split, Square, Star, Tag, Timer, Trash2, Type, Undo2, Unlock, Upload, UserRound, Video, Volume2, VolumeX, WandSparkles, X, Zap, ZoomIn, ZoomOut } from 'lucide-react'
import type { LlmRequestConfig, RecordingAnimeModel, RecordingEditSegment, RecordingEditSettings, RecordingExportFormat, RecordingExportProgress, RecordingExportQuality, RecordingProjectDocument, RecordingProjectSaveInput, RecordingProjectSummary, RecordingSessionManifest, RecordingSource, RecordingTranscriptSegment } from '../../../shared/protocol'
import { recordingSourceLabel } from '../../../shared/recording-source'
import { island } from '../bridge'
import { selectLocalFiles } from '../logic/files'
import { RecordingNeuralStyle } from '../logic/recording-neural-style'
import type { NeuralStyleStatus } from '../logic/recording-neural-style'
import { deleteRecordingAvatar, loadRecordingAvatar, saveRecordingAvatar } from '../logic/recording-avatar'
import { formatBytes } from '../logic/screenshot'
import { formatRecordingTime, parseRecordingAiEditPlan, recordingElapsed, recordingFitComposition, recordingFocusCrop, recordingFrameBudget, recordingHealth, recordingLerp, recordingOutputSize, recordingPreviewSize, recordingRegionCrop, recordingSegmentsDuration, recordingSourcePointToOutput, recordingStartError, recordingTranscriptToSrt, recordingTranscriptToVtt, recordingVideoBitrate, recordingZoomForMotion, selectRecorderMime, selectRecordingSourceId, snapRecordingTime, splitRecordingSegment, stylizeRecordingAnimeFrame } from '../logic/recording'
import type { RecordingAnimePalette, RecordingAspect, RecordingMotion, RecordingResolution } from '../logic/recording'
import { Button, Chip, IconButton, Input, Segmented, Slider, Switch } from '../ui/components'
import { fadeScaleIn, overlayPop } from '../ui/motion'
import { accent, FS, hairline, ink, R, sem, semBg, SP, surface, text } from '../ui/tokens'

interface Props {
  contextDataUrl: string
  llmReady: boolean
  llmConfig: LlmRequestConfig
  onBack: () => void
  onClose: () => void
  onAIVision: (system: string, dataUrl: string, prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>
  onCreateTodo: (text: string) => void
  onCreateNote: (title: string, text: string) => void
}

type RecorderStatus = 'idle' | 'countdown' | 'starting' | 'recording' | 'paused' | 'ready' | 'error'
type PanelTab = 'capture' | 'motion' | 'edit' | 'ai' | 'project' | 'export'
type CaptureQuality = 'standard' | 'high' | 'ultra'
type CameraPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type CameraEffect = 'original' | 'anime' | 'cartoon' | 'avatar'
type CameraFrame = 'rounded' | 'circle'
type AvatarMotion = 'still' | 'breathe' | 'lively'
type RecordingFit = 'contain' | 'cover'
type RecordingPreset = 'tutorial' | 'meeting' | 'demo' | 'custom'
type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type CameraBorder = 'light' | 'accent' | 'none'
type SourceView = 'topology' | 'grid' | 'list'
type RecordingExportResolution = 'source' | '1080p' | '720p'
interface TimelineEvent { at: number; type: 'start' | 'pause' | 'resume' | 'marker' | 'keyframe' | 'end'; label: string }
interface Keyframe { at: number; dataUrl: string }
interface AiResult { id: number; label: string; text: string; error?: boolean }
interface EditSnapshot { segments: RecordingEditSegment[]; settings: RecordingEditSettings; rate: number; timeline: TimelineEvent[] }

const AI_SYSTEM = '你是专业的屏幕录制导演、技术内容编辑和隐私审查员。结合关键帧拼图、录制参数与时间线，输出可直接使用的中文结果，不虚构画面中不存在的内容。'
const AI_ACTIONS = [
  { key: 'outline', phase: 'plan', label: '录制提纲', prompt: '生成一份 5-8 步的录制提纲，明确开场、核心演示、验证和结尾。' },
  { key: 'script', phase: 'plan', label: '讲解稿', prompt: '生成自然、专业、可口播的讲解稿，按镜头步骤分段。' },
  { key: 'check', phase: 'plan', label: '演示检查单', prompt: '给出录制前检查单，重点检查窗口、隐私、通知、字体和演示数据。' },
  { key: 'audience', phase: 'plan', label: '受众与目标', prompt: '识别这次录制最适合的目标受众、前置知识、成功标准和建议时长。' },
  { key: 'shots', phase: 'plan', label: '镜头设计', prompt: '设计逐镜头演示方案，说明每段应展示的窗口、操作焦点、旁白与转场。' },
  { key: 'demo-data', phase: 'plan', label: '演示数据', prompt: '给出安全、清晰、可复现的演示数据准备建议，避免真实隐私和不可控环境。' },
  { key: 'privacy-prep', phase: 'plan', label: '隐私预检', prompt: '根据当前画面列出录制前必须隐藏或替换的账号、路径、通知、密钥和个人信息。' },
  { key: 'tone', phase: 'plan', label: '讲解风格', prompt: '给出适合当前主题的语速、术语密度、停顿、强调和画面节奏建议。' },
  { key: 'title', phase: 'post', label: '智能标题', prompt: '生成 8 个准确但不夸张的视频标题，覆盖教程型、问题解决型和内部分享型。' },
  { key: 'chapters', phase: 'post', label: '章节目录', prompt: '根据时间线和关键帧生成带时间戳的章节目录；无法确定的时间点标记为建议。' },
  { key: 'summary', phase: 'post', label: '视频摘要', prompt: '生成一段摘要、5 条核心要点和适合放在视频说明区的内容清单。' },
  { key: 'caption', phase: 'post', label: '字幕草稿', prompt: '根据画面流程生成旁白字幕草稿，按短句换行；注明这是基于画面的草稿，不冒充真实语音转写。' },
  { key: 'edit', phase: 'post', label: '剪辑建议', prompt: '指出建议加速、停顿、放大、切除或补充解释的位置，并说明原因。' },
  { key: 'privacy', phase: 'post', label: '隐私审查', prompt: '检查关键帧中的账号、路径、Token、手机号、聊天内容和其他敏感信息，按风险等级列出。' },
  { key: 'quality', phase: 'post', label: '画面质检', prompt: '从清晰度、构图、字号、鼠标焦点、节奏和视觉干扰方面做质量审查并给出可执行修改。' },
  { key: 'social', phase: 'post', label: '发布文案', prompt: '生成视频简介、短版发布文案、3 个关键词和一个封面标题。' },
  { key: 'review', phase: 'post', label: '流程复盘', prompt: '把录制内容整理为操作流程、关键决策、结果与后续行动项。' },
  { key: 'sop', phase: 'post', label: '生成 SOP', prompt: '把画面流程整理为可执行 SOP，包含前置条件、编号步骤、验证标准、异常处理和回滚。' },
  { key: 'tutorial', phase: 'post', label: '教程文章', prompt: '把录制内容改写为结构化教程文章，包含标题、背景、步骤、注意事项和结果验证。' },
  { key: 'bug-report', phase: 'post', label: '问题单', prompt: '如果画面涉及问题复现，生成规范问题单：环境、前置条件、步骤、实际结果、预期结果和证据；没有问题则明确说明。' },
  { key: 'test-evidence', phase: 'post', label: '测试证据', prompt: '把录制整理为测试证据记录，列出测试目标、操作、观察结果、结论和仍缺失的证据。' },
  { key: 'faq', phase: 'post', label: 'FAQ', prompt: '围绕录制内容生成 8-12 组准确的常见问题与回答。' },
  { key: 'actions', phase: 'post', label: '行动项', prompt: '提取明确行动项，按负责人占位、优先级、验收标准和依赖组织。' },
  { key: 'decisions', phase: 'post', label: '决策记录', prompt: '提取画面中可确认的关键决策、依据、影响和待验证项，不确定内容必须标注。' },
  { key: 'release-note', phase: 'post', label: '发布说明', prompt: '将录制内容整理为面向用户的发布说明，区分新增、改进、修复、使用方法和限制。' },
  { key: 'cover', phase: 'post', label: '封面方案', prompt: '基于关键帧推荐最适合的封面画面，并给出 6 个简洁封面标题和构图建议。' },
  { key: 'localize', phase: 'post', label: '双语资产', prompt: '生成中英双语标题、摘要、章节名和关键词，术语保持一致。' },
  { key: 'knowledge', phase: 'post', label: '知识卡片', prompt: '把录制沉淀为知识卡片：问题、结论、步骤、注意事项、相关概念和可检索关键词。' },
  { key: 'risk', phase: 'post', label: '风险审计', prompt: '审查流程中的误操作、数据丢失、权限、安全和不可逆风险，给出分级与规避措施。' }
] as const

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => Promise.race([
  promise,
  new Promise<T>((_resolve, reject) => window.setTimeout(() => reject(new Error(message)), ms))
])
const waitVideo = (video: HTMLVideoElement): Promise<void> => new Promise((resolve, reject) => {
  if (video.readyState >= 1 && video.videoWidth > 0) { resolve(); return }
  const timer = window.setTimeout(() => reject(new Error('桌面画面加载超时')), 8000)
  video.onloadedmetadata = () => { window.clearTimeout(timer); resolve() }
  video.onerror = () => { window.clearTimeout(timer); reject(new Error('无法读取桌面画面')) }
})

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  mirror = false
): void {
  const scale = Math.max(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight))
  const cropWidth = width / scale
  const cropHeight = height / scale
  const sx = Math.max(0, (sourceWidth - cropWidth) / 2)
  const sy = Math.max(0, (sourceHeight - cropHeight) / 2)
  ctx.save()
  if (mirror) {
    ctx.translate(x + width, y)
    ctx.scale(-1, 1)
    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, width, height)
  } else {
    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, x, y, width, height)
  }
  ctx.restore()
}

async function makeContactSheet(frames: Keyframe[], fallback: string): Promise<string> {
  const urls = frames.slice(-6).map((frame) => frame.dataUrl)
  if (!urls.length) return fallback
  const images = await Promise.all(urls.map((url) => new Promise<HTMLImageElement>((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(image)
    image.src = url
  })))
  const width = 1200
  const cols = images.length <= 2 ? images.length : 3
  const rows = Math.ceil(images.length / cols)
  const cellW = width / Math.max(1, cols)
  const cellH = Math.round(cellW * 9 / 16)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.max(cellH, rows * cellH)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => {
    if (!image.naturalWidth) return
    const x = (index % cols) * cellW
    const y = Math.floor(index / cols) * cellH
    const scale = Math.max(cellW / image.naturalWidth, cellH / image.naturalHeight)
    const dw = image.naturalWidth * scale
    const dh = image.naturalHeight * scale
    ctx.drawImage(image, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh)
    ctx.fillStyle = 'rgba(0,0,0,.64)'; ctx.fillRect(x + 10, y + 10, 54, 24)
    ctx.fillStyle = '#fff'; ctx.font = '600 14px Segoe UI, sans-serif'; ctx.fillText(formatRecordingTime(frames[index]?.at || 0), x + 17, y + 27)
  })
  return canvas.toDataURL('image/jpeg', 0.82)
}

export function ScreenRecorderStudio({ contextDataUrl, llmReady, llmConfig, onBack, onClose, onAIVision, onCreateTodo, onCreateNote }: Props): React.JSX.Element {
  const [sources, setSources] = useState<RecordingSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [sourceKind, setSourceKind] = useState<'screen' | 'window'>('screen')
  const [sourceQuery, setSourceQuery] = useState('')
  const [sourceView, setSourceView] = useState<SourceView>('topology')
  const [sourceAvailableOnly, setSourceAvailableOnly] = useState(true)
  const [sourceFavorites, setSourceFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('recording-source-favorites') || '[]') as string[] } catch { return [] }
  })
  const [sourcePreviewing, setSourcePreviewing] = useState(false)
  const [previewSourceId, setPreviewSourceId] = useState('')
  const [sourcePreviewError, setSourcePreviewError] = useState('')
  const [sourceMediaSize, setSourceMediaSize] = useState<{ sourceId: string; width: number; height: number } | null>(null)
  const [loadingSources, setLoadingSources] = useState(false)
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [compact, setCompact] = useState(false)
  const [startupMessage, setStartupMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [panel, setPanel] = useState<PanelTab>('capture')
  const [resolution, setResolution] = useState<RecordingResolution>('1080p')
  const [aspect, setAspect] = useState<RecordingAspect>('16:9')
  const [fitMode, setFitMode] = useState<RecordingFit>('contain')
  const [recordingPreset, setRecordingPreset] = useState<RecordingPreset>('custom')
  const [fps, setFps] = useState(30)
  const [captureQuality, setCaptureQuality] = useState<CaptureQuality>('high')
  const [motionMode, setMotionMode] = useState<RecordingMotion>('gentle')
  const [motionStrength, setMotionStrength] = useState(0.68)
  const [maxZoom, setMaxZoom] = useState(1.45)
  const [cursorHalo, setCursorHalo] = useState(true)
  const [cursorHaloSize, setCursorHaloSize] = useState(0.13)
  const [cursorHaloColor, setCursorHaloColor] = useState<'gold' | 'blue' | 'white'>('gold')
  const [cursorTrail, setCursorTrail] = useState(false)
  const [regionEnabled, setRegionEnabled] = useState(false)
  const [region, setRegion] = useState({ left: 0, top: 0, right: 0, bottom: 0 })
  const [systemAudio, setSystemAudio] = useState(true)
  const [microphone, setMicrophone] = useState(false)
  const [systemGain, setSystemGain] = useState(1)
  const [micGain, setMicGain] = useState(1.05)
  const [noiseSuppression, setNoiseSuppression] = useState(true)
  const [echoCancellation, setEchoCancellation] = useState(true)
  const [autoGainControl, setAutoGainControl] = useState(true)
  const [systemMuted, setSystemMuted] = useState(false)
  const [micMuted, setMicMuted] = useState(false)
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([])
  const [micDeviceId, setMicDeviceId] = useState('')
  const [webcam, setWebcam] = useState(false)
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [cameraDeviceId, setCameraDeviceId] = useState('')
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('bottom-right')
  const [cameraSize, setCameraSize] = useState(0.2)
  const [cameraEffect, setCameraEffect] = useState<CameraEffect>('original')
  const [cameraFrame, setCameraFrame] = useState<CameraFrame>('rounded')
  const [cameraMirror, setCameraMirror] = useState(true)
  const [cameraOpacity, setCameraOpacity] = useState(1)
  const [cameraBorder, setCameraBorder] = useState<CameraBorder>('light')
  const [cameraShadow, setCameraShadow] = useState(true)
  const [cameraMargin, setCameraMargin] = useState(0.018)
  const [animeStrength, setAnimeStrength] = useState(0.72)
  const [animePalette, setAnimePalette] = useState<RecordingAnimePalette>('natural')
  const [neuralState, setNeuralState] = useState<{ status: NeuralStyleStatus; provider: string; error: string }>({ status: 'idle', provider: '', error: '' })
  const [neuralModel, setNeuralModel] = useState<RecordingAnimeModel>('handdrawn')
  const [neuralModelName, setNeuralModelName] = useState('日系手绘动画')
  const [avatarDataUrl, setAvatarDataUrl] = useState('')
  const [avatarName, setAvatarName] = useState('')
  const [avatarMotion, setAvatarMotion] = useState<AvatarMotion>('breathe')
  const [personaPreviewing, setPersonaPreviewing] = useState(false)
  const [personaPreviewError, setPersonaPreviewError] = useState('')
  const [countdownSeconds, setCountdownSeconds] = useState(3)
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(0)
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(0)
  const [autoMarkerSeconds, setAutoMarkerSeconds] = useState(0)
  const [keyframeIntervalSeconds, setKeyframeIntervalSeconds] = useState(15)
  const [watermarkEnabled, setWatermarkEnabled] = useState(false)
  const [watermarkText, setWatermarkText] = useState('Agentic-Island')
  const [watermarkPosition, setWatermarkPosition] = useState<OverlayPosition>('bottom-right')
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.68)
  const [showTimestamp, setShowTimestamp] = useState(false)
  const [showSourceLabel, setShowSourceLabel] = useState(false)
  const [privacyTop, setPrivacyTop] = useState(0)
  const [privacyBottom, setPrivacyBottom] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [recordedBytes, setRecordedBytes] = useState(0)
  const [health, setHealth] = useState(() => recordingHealth({ active: false, elapsedMs: 0, bytes: 0, chunkGapMs: 0, writeLatencyMs: 0, droppedFrames: 0, totalFrames: 0 }))
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [keyframes, setKeyframes] = useState<Keyframe[]>([])
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingSessionId, setRecordingSessionId] = useState('')
  const [recoverableSessions, setRecoverableSessions] = useState<RecordingSessionManifest[]>([])
  const [recordingUrl, setRecordingUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [previewCurrentMs, setPreviewCurrentMs] = useState(0)
  const [recordingHasAudio, setRecordingHasAudio] = useState(false)
  const [editSegments, setEditSegments] = useState<RecordingEditSegment[]>([])
  const [activeSegmentId, setActiveSegmentId] = useState('')
  const [editSettings, setEditSettings] = useState<RecordingEditSettings>({
    speed: 1,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    rotation: 0,
    contrast: 1,
    saturation: 1,
    gamma: 1,
    audioVolume: 1
  })
  const [editHistory, setEditHistory] = useState<EditSnapshot[]>([])
  const [editFuture, setEditFuture] = useState<EditSnapshot[]>([])
  const [timelineZoom, setTimelineZoom] = useState(1)
  const [timelineSnap, setTimelineSnap] = useState(true)
  const [videoTrackLocked, setVideoTrackLocked] = useState(false)
  const [markerTrackLocked, setMarkerTrackLocked] = useState(false)
  const [recordingSize, setRecordingSize] = useState({ width: 1920, height: 1080 })
  const [recordingName, setRecordingName] = useState(() => `录屏_${new Date().toLocaleDateString('sv-SE')}`)
  const [format, setFormat] = useState<RecordingExportFormat>('mp4')
  const [exportQuality, setExportQuality] = useState<RecordingExportQuality>('balanced')
  const [exportResolution, setExportResolution] = useState<RecordingExportResolution>('source')
  const [exportFps, setExportFps] = useState<'source' | '60' | '30' | '24' | '15'>('source')
  const [exportSubtitleMode, setExportSubtitleMode] = useState<'none' | 'embedded'>('none')
  const [exportProgress, setExportProgress] = useState<RecordingExportProgress | null>(null)
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState('')
  const [aiBusy, setAiBusy] = useState('')
  const [aiResults, setAiResults] = useState<AiResult[]>([])
  const [aiEditMode, setAiEditMode] = useState<'conservative' | 'tutorial' | 'dynamic'>('conservative')
  const [transcriptModel, setTranscriptModel] = useState(() => localStorage.getItem('recording-transcript-model') || 'whisper-1')
  const [transcriptLanguage, setTranscriptLanguage] = useState<'auto' | 'zh' | 'en'>('auto')
  const [transcriptSegments, setTranscriptSegments] = useState<RecordingTranscriptSegment[]>([])
  const [projectId, setProjectId] = useState('')
  const [recordingProjects, setRecordingProjects] = useState<RecordingProjectSummary[]>([])
  const [projectSaveState, setProjectSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const previewIdRef = useRef('')
  const sourceStreamRef = useRef<MediaStream | null>(null)
  const sourcePreviewStreamRef = useRef<MediaStream | null>(null)
  const sourcePreviewVideoRef = useRef<HTMLVideoElement | null>(null)
  const sourcePreviewRequestRef = useRef(0)
  const sourcePreviewWantedRef = useRef(false)
  const micStreamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraEffectCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraEffectPaintAtRef = useRef(0)
  const neuralStyleRef = useRef(new RecordingNeuralStyle())
  const avatarImageRef = useRef<HTMLImageElement | null>(null)
  const personaPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const personaPreviewRafRef = useRef(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const systemGainRef = useRef<GainNode | null>(null)
  const micGainRef = useRef<GainNode | null>(null)
  const rafRef = useRef(0)
  const drawGenerationRef = useRef(0)
  const cursorPollPendingRef = useRef(false)
  const renderStatsRef = useRef({ droppedFrames: 0, totalFrames: 0, lastPaintAt: 0 })
  const chunksRef = useRef<Blob[]>([])
  const recordingSessionIdRef = useRef('')
  const recordingChunkIndexRef = useRef(0)
  const recordingWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const recordingWriteErrorRef = useRef('')
  const recordingLastChunkAtRef = useRef(0)
  const recordingWriteLatencyRef = useRef(0)
  const recordingHealthSampleAtRef = useRef(0)
  const projectIdRef = useRef('')
  const projectSaveTokenRef = useRef(0)
  const editHistoryAtRef = useRef(0)
  const recordedBytesRef = useRef(0)
  const statusRef = useRef<RecorderStatus>('idle')
  const startAtRef = useRef(0)
  const pausedAtRef = useRef(0)
  const pausedTotalRef = useRef(0)
  const elapsedRef = useRef(0)
  const frameCaptureAtRef = useRef(0)
  const lastAutoMarkerAtRef = useRef(0)
  const stopReasonRef = useRef('')
  const countdownTokenRef = useRef(0)
  const focusRef = useRef({ x: 0.5, y: 0.5, zoom: 1, cursorX: 0.5, cursorY: 0.5, speed: 0, pollAt: 0, lastX: 0.5, lastY: 0.5 })
  const cursorTrailRef = useRef<Array<{ x: number; y: number }>>([])
  const regionLocatorRectRef = useRef<SVGRectElement | null>(null)
  const regionLocatorPaintAtRef = useRef(0)
  const personaOptionsRef = useRef({ cameraEffect, cameraFrame, animeStrength, animePalette, avatarMotion, cameraMirror })
  personaOptionsRef.current = { cameraEffect, cameraFrame, animeStrength, animePalette, avatarMotion, cameraMirror }

  const selectedSource = useMemo(() => sources.find((source) => source.id === sourceId), [sources, sourceId])
  const visibleSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase()
    return sources
      .filter((source) => source.kind === sourceKind && (!sourceAvailableOnly || source.available !== false) && (!query || `${source.name} ${source.displayLabel || ''}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => Number(sourceFavorites.includes(b.name)) - Number(sourceFavorites.includes(a.name)) || (a.sourceOrder || 0) - (b.sourceOrder || 0))
  }, [sources, sourceKind, sourceQuery, sourceAvailableOnly, sourceFavorites])
  const displayTopology = useMemo(() => {
    const items = visibleSources.filter((source) => source.kind === 'screen' && source.bounds)
    if (!items.length) return null
    const minX = Math.min(...items.map((source) => source.bounds!.x))
    const minY = Math.min(...items.map((source) => source.bounds!.y))
    const maxX = Math.max(...items.map((source) => source.bounds!.x + source.bounds!.width))
    const maxY = Math.max(...items.map((source) => source.bounds!.y + source.bounds!.height))
    return { items, minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  }, [visibleSources])
  const regionLocator = useMemo(() => {
    if (!selectedSource || (!regionEnabled && (selectedSource.kind !== 'screen' || motionMode === 'off'))) return null
    const measured = sourceMediaSize?.sourceId === selectedSource.id ? sourceMediaSize : null
    const width = measured?.width || selectedSource.nativeSize?.width || Math.round((selectedSource.aspectRatio || 16 / 9) * 1000)
    const height = measured?.height || selectedSource.nativeSize?.height || 1000
    const regionCrop = regionEnabled ? recordingRegionCrop(width, height, region) : { x: 0, y: 0, width, height }
    const output = recordingOutputSize(width, height, resolution, aspect)
    const composition = recordingFitComposition(regionCrop, output.width, output.height, fitMode)
    return { width, height, crop: composition.source }
  }, [selectedSource, sourceMediaSize, regionEnabled, region.left, region.top, region.right, region.bottom, resolution, aspect, fitMode, motionMode])
  const activeSegment = useMemo(() => editSegments.find((segment) => segment.id === activeSegmentId) || editSegments[0], [editSegments, activeSegmentId])
  const locked = status === 'countdown' || status === 'starting' || status === 'recording' || status === 'paused'
  const flash = (message: string): void => { setToast(message); window.setTimeout(() => setToast(''), 2600) }
  const updateStatus = (value: RecorderStatus): void => { statusRef.current = value; setStatus(value) }
  const currentElapsed = (): number => recordingElapsed(statusRef.current === 'paused', performance.now(), startAtRef.current, pausedAtRef.current, pausedTotalRef.current)

  const importAvatarDataUrl = (dataUrl: string, name: string): void => {
    if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl)) { flash('替换形象仅支持 PNG、JPEG 或 WebP'); return }
    const payload = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
    const bytes = Math.max(0, Math.floor(payload.length * 3 / 4) - padding)
    if (bytes > 12 * 1024 * 1024) { flash('替换形象不能超过 12 MB'); return }
    const image = new Image()
    image.onload = () => {
      avatarImageRef.current = image
      setAvatarDataUrl(dataUrl); setAvatarName(name); setCameraEffect('avatar'); setWebcam(true); setPersonaPreviewError('')
      void saveRecordingAvatar({ name, dataUrl, updatedAt: Date.now() })
        .then(() => flash('替换形象已载入并保存'))
        .catch(() => flash('形象已载入，但本地持久化失败'))
    }
    image.onerror = () => flash('无法解析这张替换形象')
    image.src = dataUrl
  }

  const chooseAvatar = async (): Promise<void> => {
    const result: Awaited<ReturnType<typeof island.openImageFile>> = await island.openImageFile().catch((error) => ({ ok: false, error: recordingStartError(error) }))
    if (!result.ok || !result.dataUrl) {
      if (result.error) flash(result.error)
      return
    }
    importAvatarDataUrl(result.dataUrl, result.name || '人物形象')
  }

  const ensureNeuralStyle = async (): Promise<void> => {
    const neural = neuralStyleRef.current
    const current = neural.snapshot()
    if (current.status === 'ready' || current.status === 'loading') return
    const result = await island.recordingAnimeModel(neuralModel)
    if (!result.ok || !result.data) throw new Error(result.error || '内置人物动漫化模型不可用')
    setNeuralModelName(result.name || '内置日系手绘人物 v2')
    await neural.initialize(result.data)
  }

  const selectNeuralModel = (model: RecordingAnimeModel): void => {
    stopPersonaPreview()
    neuralStyleRef.current.dispose()
    setNeuralModel(model)
    setNeuralModelName(model === 'handdrawn' ? '日系手绘动画' : model === 'portrait' ? '柔和动画人像' : '漫画人物')
  }

  const importNeuralModel = async (file?: File): Promise<void> => {
    if (!file) return
    if (!/\.onnx$/i.test(file.name)) { flash('人物模型必须是 ONNX 文件'); return }
    if (file.size > 100 * 1024 * 1024) { flash('人物模型不能超过 100 MB'); return }
    stopPersonaPreview()
    const neural = neuralStyleRef.current
    neural.dispose()
    setNeuralModelName(file.name)
    try {
      await neural.initialize(await file.arrayBuffer())
      flash('自定义人物模型已加载')
    } catch (error) {
      flash(recordingStartError(error))
    }
  }

  const releaseSourcePreviewMedia = (): void => {
    window.cancelAnimationFrame(rafRef.current)
    drawGenerationRef.current++
    sourcePreviewStreamRef.current?.getTracks().forEach((track) => track.stop())
    sourcePreviewStreamRef.current = null
    if (sourcePreviewVideoRef.current) sourcePreviewVideoRef.current.srcObject = null
  }

  const stopSourcePreview = (preserveIntent = false): void => {
    sourcePreviewRequestRef.current++
    if (!preserveIntent) sourcePreviewWantedRef.current = false
    releaseSourcePreviewMedia()
    setPreviewSourceId('')
    setSourcePreviewing(false)
  }

  const startSourcePreview = async (): Promise<void> => {
    const source = selectedSource
    if (!source || source.available === false || locked) return
    sourcePreviewWantedRef.current = true
    const request = ++sourcePreviewRequestRef.current
    releaseSourcePreviewMedia()
    setPreviewSourceId(''); setSourcePreviewing(false); setSourcePreviewError('')
    let stream: MediaStream | null = null
    try {
      const constraints = {
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxFrameRate: 30 } }
      } as unknown as MediaStreamConstraints
      stream = await withTimeout(navigator.mediaDevices.getUserMedia(constraints), 10_000, '连接来源实时预览超时')
      if (request !== sourcePreviewRequestRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      sourcePreviewStreamRef.current = stream
      const video = sourcePreviewVideoRef.current
      if (!video) throw new Error('实时预览容器尚未就绪')
      video.srcObject = stream; video.muted = true; video.playsInline = true
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (request !== sourcePreviewRequestRef.current) return
        stopSourcePreview(); setSourcePreviewError('来源已关闭，请刷新后重新选择'); void loadSources()
      }, { once: true })
      await video.play(); await withTimeout(waitVideo(video), 8_000, '来源实时画面加载超时')
      if (request !== sourcePreviewRequestRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      setSourceMediaSize({ sourceId: source.id, width: video.videoWidth, height: video.videoHeight })
      setPreviewSourceId(source.id)
      setSourcePreviewing(true)
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (request !== sourcePreviewRequestRef.current) return
      stopSourcePreview(); setSourcePreviewError(recordingStartError(error))
    }
  }

  const selectSource = (id: string): void => {
    if (locked) return
    sourcePreviewWantedRef.current = true
    if (id === sourceId) void startSourcePreview()
    else setSourceId(id)
  }

  const toggleSourceFavorite = (name: string): void => {
    setSourceFavorites((current) => {
      const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
      localStorage.setItem('recording-source-favorites', JSON.stringify(next))
      return next
    })
  }

  const loadSources = async (): Promise<void> => {
    setLoadingSources(true)
    let result = await island.recordingSources()
    for (let attempt = 0; attempt < 2 && (!result.ok || !result.sources?.length); attempt++) {
      await sleep(220 * (attempt + 1))
      result = await island.recordingSources()
    }
    setLoadingSources(false)
    if (!result.ok || !result.sources?.length) {
      if (!sources.length) { setErrorMessage(result.error || '暂未枚举到录制来源，请点击刷新重试。'); updateStatus('error') }
      flash(result.error || '暂未枚举到来源，已保留当前选择')
      return
    }
    const nextSources = result.sources
    const previousName = sources.find((source) => source.id === sourceId)?.name || selectedSource?.name || ''
    setSources(nextSources)
    setSourceId((current) => selectRecordingSourceId(nextSources, sourceKind, current, previousName))
    if (statusRef.current === 'error' && /枚举|录制来源|屏幕或窗口/.test(errorMessage)) {
      setErrorMessage(''); updateStatus('idle')
    }
  }

  const changeSourceKind = (kind: 'screen' | 'window'): void => {
    stopSourcePreview(); setSourceKind(kind); setSourceQuery(''); setSourceView(kind === 'screen' ? 'topology' : 'grid')
    setSourceId(selectRecordingSourceId(sources, kind))
  }

  const applyPreset = (preset: RecordingPreset): void => {
    setRecordingPreset(preset)
    if (preset === 'custom') return
    if (preset === 'tutorial') {
      setResolution('1080p'); setAspect('16:9'); setFps(30); setCaptureQuality('high'); setMotionMode('gentle'); setSystemAudio(true); setMicrophone(true); setKeyframeIntervalSeconds(10)
    } else if (preset === 'meeting') {
      setResolution('1080p'); setAspect('16:9'); setFps(24); setCaptureQuality('standard'); setMotionMode('off'); setSystemAudio(true); setMicrophone(true); setKeyframeIntervalSeconds(30)
    } else {
      setResolution('1440p'); setAspect('16:9'); setFps(60); setCaptureQuality('ultra'); setMotionMode('dynamic'); setSystemAudio(true); setMicrophone(false); setKeyframeIntervalSeconds(8)
    }
  }

  useEffect(() => {
    const neural = neuralStyleRef.current
    const unsubscribeNeural = neural.subscribe(() => setNeuralState(neural.snapshot()))
    void loadRecordingAvatar().then((asset) => {
      if (!asset?.dataUrl || avatarImageRef.current) return
      const image = new Image()
      image.onload = () => {
        avatarImageRef.current = image
        setAvatarDataUrl(asset.dataUrl); setAvatarName(asset.name); setCameraEffect('avatar'); setWebcam(true)
      }
      image.src = asset.dataUrl
    }).catch(() => {})
    void loadSources()
    void island.listRecordingSessions().then((result) => {
      if (result.ok) setRecoverableSessions((result.sessions || []).filter((session) => session.bytes >= 1024))
    }).catch(() => {})
    void island.listRecordingProjects().then((result) => {
      if (result.ok) setRecordingProjects(result.projects || [])
    }).catch(() => {})
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      setMicDevices(devices.filter((device) => device.kind === 'audioinput'))
      setCameraDevices(devices.filter((device) => device.kind === 'videoinput'))
    }).catch(() => {})
    return () => {
      sourcePreviewRequestRef.current++
      drawGenerationRef.current++
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop()
      sourceStreamRef.current?.getTracks().forEach((track) => track.stop())
      sourcePreviewStreamRef.current?.getTracks().forEach((track) => track.stop())
      micStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      audioContextRef.current?.close().catch(() => {})
      window.cancelAnimationFrame(rafRef.current)
      window.cancelAnimationFrame(personaPreviewRafRef.current)
      if (previewIdRef.current) island.releaseRecordingPreview(previewIdRef.current)
      island.setRecordingProtection(false)
      unsubscribeNeural()
      neural.dispose()
    }
  }, [])

  useEffect(() => {
    const restart = sourcePreviewWantedRef.current
    stopSourcePreview(true)
    setSourcePreviewError('')
    if (!restart) return
    const timer = window.setTimeout(() => void startSourcePreview(), 0)
    return () => window.clearTimeout(timer)
  }, [sourceId])

  useEffect(() => { statusRef.current = status }, [status])

  useEffect(() => {
    document.body.classList.toggle('recording-compact-active', compact)
    if (!compact) return
    island.setIgnoreMouse(true)
    return () => {
      document.body.classList.remove('recording-compact-active')
      island.setIgnoreMouse(false)
    }
  }, [compact])

  useEffect(() => island.onRecordingExportProgress((progress) => {
    setExportProgress(progress)
    if (progress.phase === 'done' || progress.phase === 'error' || progress.phase === 'canceled') setExporting(false)
  }), [])

  useEffect(() => {
    if (systemGainRef.current) systemGainRef.current.gain.value = systemMuted ? 0 : systemGain
  }, [systemGain, systemMuted])

  useEffect(() => {
    if (micGainRef.current) micGainRef.current.gain.value = micMuted ? 0 : micGain
  }, [micGain, micMuted])

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => {
      const value = currentElapsed()
      elapsedRef.current = value
      setElapsed(value)
      const now = performance.now()
      if (now - recordingHealthSampleAtRef.current >= 1000) {
        recordingHealthSampleAtRef.current = now
        const renderStats = renderStatsRef.current
        setHealth(recordingHealth({
          active: true,
          elapsedMs: value,
          bytes: recordedBytesRef.current,
          chunkGapMs: recordingLastChunkAtRef.current ? now - recordingLastChunkAtRef.current : 0,
          writeLatencyMs: recordingWriteLatencyRef.current,
          droppedFrames: renderStats.droppedFrames,
          totalFrames: renderStats.totalFrames,
          writeError: recordingWriteErrorRef.current
        }))
      }
      if (maxDurationMinutes > 0 && value >= maxDurationMinutes * 60_000) {
        stopReasonRef.current = `已达到 ${maxDurationMinutes} 分钟时限`
        stopRecording()
      } else if (maxFileSizeMb > 0 && recordedBytesRef.current >= maxFileSizeMb * 1024 * 1024) {
        stopReasonRef.current = `已达到 ${maxFileSizeMb} MB 文件上限`
        stopRecording()
      } else if (autoMarkerSeconds > 0 && value - lastAutoMarkerAtRef.current >= autoMarkerSeconds * 1000) {
        lastAutoMarkerAtRef.current = value
        const markerIndex = Math.floor(value / (autoMarkerSeconds * 1000))
        setTimeline((items) => [...items, { at: value, type: 'marker', label: `自动章节 ${markerIndex}` }])
        captureKeyframe(value, false)
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [status, maxDurationMinutes, maxFileSizeMb, autoMarkerSeconds])

  const cleanupMedia = (): void => {
    window.cancelAnimationFrame(rafRef.current)
    drawGenerationRef.current++
    cursorPollPendingRef.current = false
    sourceStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    sourceStreamRef.current = null
    micStreamRef.current = null
    cameraStreamRef.current = null
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    window.cancelAnimationFrame(personaPreviewRafRef.current)
    setPersonaPreviewing(false)
    void audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    systemGainRef.current = null
    micGainRef.current = null
    island.setRecordingProtection(false)
  }

  const captureKeyframe = (at: number, markTimeline = true): void => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.width) return
    const preview = document.createElement('canvas')
    const width = Math.min(960, canvas.width)
    preview.width = width
    preview.height = Math.max(2, Math.round(width * canvas.height / canvas.width))
    preview.getContext('2d')!.drawImage(canvas, 0, 0, preview.width, preview.height)
    const frame = { at, dataUrl: preview.toDataURL('image/jpeg', 0.76) }
    setKeyframes((items) => [...items.slice(-11), frame])
    if (markTimeline) setTimeline((items) => [...items, { at, type: 'keyframe', label: '关键帧' }])
  }

  const paintPersonaContent = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, now: number): boolean => {
    const camera = cameraVideoRef.current
    const avatar = avatarImageRef.current
    const options = personaOptionsRef.current
    if (options.cameraEffect === 'avatar' && avatar?.naturalWidth) {
      const phase = now / 1000
      const scale = options.avatarMotion === 'still' ? 1 : options.avatarMotion === 'breathe' ? 1.025 + Math.sin(phase * 2.2) * 0.012 : 1.055 + Math.sin(phase * 3.1) * 0.02
      const driftX = options.avatarMotion === 'lively' ? (focusRef.current.cursorX - 0.5) * width * 0.08 + Math.sin(phase * 1.7) * width * 0.012 : 0
      const driftY = options.avatarMotion === 'still' ? 0 : Math.sin(phase * (options.avatarMotion === 'lively' ? 2.4 : 1.8)) * height * 0.018
      const drawWidth = width * scale
      const drawHeight = height * scale
      drawCover(ctx, avatar, avatar.naturalWidth, avatar.naturalHeight, x - (drawWidth - width) / 2 + driftX, y - (drawHeight - height) / 2 + driftY, drawWidth, drawHeight)
      return true
    }
    if (!camera?.readyState || !camera.videoWidth) return false
    if (options.cameraEffect === 'anime' || options.cameraEffect === 'cartoon') {
      const effectCanvas = cameraEffectCanvasRef.current || document.createElement('canvas')
      cameraEffectCanvasRef.current = effectCanvas
      const effectWidth = 256
      const effectHeight = 256
      if (effectCanvas.width !== effectWidth || effectCanvas.height !== effectHeight) {
        effectCanvas.width = effectWidth; effectCanvas.height = effectHeight; cameraEffectPaintAtRef.current = 0
      }
      if (now - cameraEffectPaintAtRef.current >= 1000 / 10) {
        cameraEffectPaintAtRef.current = now
        const effectCtx = effectCanvas.getContext('2d', { willReadFrequently: true })!
        effectCtx.clearRect(0, 0, effectWidth, effectHeight)
        drawCover(effectCtx, camera, camera.videoWidth, camera.videoHeight, 0, 0, effectWidth, effectHeight, options.cameraMirror)
        const frame = effectCtx.getImageData(0, 0, effectWidth, effectHeight)
        neuralStyleRef.current.request(frame)
        stylizeRecordingAnimeFrame(frame.data, effectWidth, effectHeight, Math.max(0.35, options.animeStrength * 0.72), options.animePalette, options.cameraEffect)
        effectCtx.putImageData(frame, 0, 0)
      }
      ctx.imageSmoothingEnabled = true
      drawCover(ctx, camera, camera.videoWidth, camera.videoHeight, x, y, width, height, options.cameraMirror)
      ctx.save()
      ctx.filter = options.animePalette === 'warm' ? 'sepia(.08) saturate(1.05)' : options.animePalette === 'cool' ? 'hue-rotate(7deg) saturate(1.03)' : 'none'
      const neuralPainted = neuralStyleRef.current.paint(ctx, x, y, width, height, options.animeStrength)
      ctx.restore()
      if (!neuralPainted || options.cameraEffect === 'cartoon') {
        ctx.save()
        ctx.globalAlpha = neuralPainted ? 0.28 : 1
        ctx.drawImage(effectCanvas, x, y, width, height)
        ctx.restore()
      }
      return true
    }
    drawCover(ctx, camera, camera.videoWidth, camera.videoHeight, x, y, width, height, options.cameraMirror)
    return true
  }

  const stopPersonaPreview = (): void => {
    window.cancelAnimationFrame(personaPreviewRafRef.current)
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    setPersonaPreviewing(false)
  }

  const startPersonaPreview = async (): Promise<void> => {
    setPersonaPreviewError('')
    try {
      if (cameraEffect === 'avatar' && !avatarImageRef.current) throw new Error('请先导入替换形象')
      if (cameraEffect === 'anime' || cameraEffect === 'cartoon') await ensureNeuralStyle()
      if (cameraEffect !== 'avatar' && !cameraStreamRef.current?.active) {
        const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }), 8_000, '连接摄像头超时')
        cameraStreamRef.current = stream
        const video = cameraVideoRef.current || document.createElement('video')
        cameraVideoRef.current = video; video.srcObject = stream; video.muted = true; video.playsInline = true
        await video.play(); await withTimeout(waitVideo(video), 8_000, '摄像头画面加载超时')
      }
      setPersonaPreviewing(true)
      let lastPaintAt = 0
      const draw = (now: number): void => {
        const canvas = personaPreviewCanvasRef.current
        if (!canvas) { personaPreviewRafRef.current = window.requestAnimationFrame(draw); return }
        if (now - lastPaintAt < 1000 / 30) { personaPreviewRafRef.current = window.requestAnimationFrame(draw); return }
        lastPaintAt = now
        const options = personaOptionsRef.current
        const previewHeight = options.cameraEffect === 'avatar' || options.cameraFrame === 'circle' ? 300 : 188
        if (canvas.width !== 300 || canvas.height !== previewHeight) { canvas.width = 300; canvas.height = previewHeight }
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#10141a'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        paintPersonaContent(ctx, 0, 0, canvas.width, canvas.height, now)
        personaPreviewRafRef.current = window.requestAnimationFrame(draw)
      }
      window.cancelAnimationFrame(personaPreviewRafRef.current)
      personaPreviewRafRef.current = window.requestAnimationFrame(draw)
    } catch (error) {
      stopPersonaPreview()
      setPersonaPreviewError(recordingStartError(error))
    }
  }

  const drawLoop = (video: HTMLVideoElement, canvas: HTMLCanvasElement, source: RecordingSource, preview = false): void => {
    window.cancelAnimationFrame(rafRef.current)
    const generation = ++drawGenerationRef.current
    cursorPollPendingRef.current = false
    const ctx = canvas.getContext('2d', { alpha: false })!
    const frameInterval = 1000 / Math.max(1, preview ? Math.min(24, fps) : fps)
    if (!preview) renderStatsRef.current = { droppedFrames: 0, totalFrames: 0, lastPaintAt: 0 }
    let lastPaintAt = 0
    const draw = (now: number): void => {
      if (generation !== drawGenerationRef.current) return
      if (video.readyState >= 2 && now - lastPaintAt >= frameInterval) {
        if (!preview) {
          const stats = renderStatsRef.current
          const gap = stats.lastPaintAt ? now - stats.lastPaintAt : frameInterval
          const budget = recordingFrameBudget(gap, frameInterval)
          stats.totalFrames += budget.totalFrames
          stats.droppedFrames += budget.droppedFrames
          stats.lastPaintAt = now
        }
        lastPaintAt = now
        const focus = focusRef.current
        if (source.kind === 'screen' && motionMode !== 'off' && now - focus.pollAt > 80 && source.bounds && !cursorPollPendingRef.current) {
          focus.pollAt = now
          cursorPollPendingRef.current = true
          void island.recordingCursor().then((cursor) => {
            if (generation !== drawGenerationRef.current) return
            if (!source.bounds || (source.displayId && cursor.displayId !== source.displayId)) return
            const nx = Math.max(0, Math.min(1, (cursor.x - source.bounds.x) / source.bounds.width))
            const ny = Math.max(0, Math.min(1, (cursor.y - source.bounds.y) / source.bounds.height))
            const distance = Math.hypot(nx - focus.lastX, ny - focus.lastY)
            focus.speed = distance * 10000
            focus.lastX = nx; focus.lastY = ny
            focus.cursorX = nx; focus.cursorY = ny
          }).catch(() => {}).finally(() => { cursorPollPendingRef.current = false })
        }
        const smoothing = 0.035 + motionStrength * 0.075
        focus.x = recordingLerp(focus.x, focus.cursorX, smoothing)
        focus.y = recordingLerp(focus.y, focus.cursorY, smoothing)
        const sourceRegion = regionEnabled
          ? recordingRegionCrop(video.videoWidth, video.videoHeight, region)
          : { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }
        const cursorSourceX = focus.cursorX * video.videoWidth
        const cursorSourceY = focus.cursorY * video.videoHeight
        const cursorInsideRegion = cursorSourceX >= sourceRegion.x && cursorSourceX <= sourceRegion.x + sourceRegion.width
          && cursorSourceY >= sourceRegion.y && cursorSourceY <= sourceRegion.y + sourceRegion.height
        const targetZoom = source.kind === 'screen' && cursorInsideRegion ? Math.min(maxZoom, recordingZoomForMotion(motionMode, focus.speed)) : 1
        focus.zoom = recordingLerp(focus.zoom, targetZoom, 0.035 + motionStrength * 0.04)
        focus.speed *= 0.92

        ctx.fillStyle = '#090b0e'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        let cursorOutput = { x: canvas.width / 2, y: canvas.height / 2, visible: cursorInsideRegion }
        let visibleSourceCrop = sourceRegion
        if (focus.zoom <= 1.02) {
          const composition = recordingFitComposition(sourceRegion, canvas.width, canvas.height, fitMode)
          const sourceCrop = composition.source
          const destination = composition.destination
          visibleSourceCrop = sourceCrop
          ctx.drawImage(video, sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height, destination.x, destination.y, destination.width, destination.height)
          cursorOutput = recordingSourcePointToOutput(composition, cursorSourceX, cursorSourceY)
        } else {
          const regionFocusX = Math.max(0, Math.min(1, (focus.x * video.videoWidth - sourceRegion.x) / sourceRegion.width))
          const regionFocusY = Math.max(0, Math.min(1, (focus.y * video.videoHeight - sourceRegion.y) / sourceRegion.height))
          const crop = recordingFocusCrop(sourceRegion.width, sourceRegion.height, canvas.width, canvas.height, regionFocusX, regionFocusY, focus.zoom)
          visibleSourceCrop = { x: sourceRegion.x + crop.x, y: sourceRegion.y + crop.y, width: crop.width, height: crop.height }
          ctx.drawImage(video, sourceRegion.x + crop.x, sourceRegion.y + crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
        }
        if (regionLocatorRectRef.current && now - regionLocatorPaintAtRef.current >= 50) {
          regionLocatorPaintAtRef.current = now
          const locator = regionLocatorRectRef.current
          locator.setAttribute('x', String(visibleSourceCrop.x))
          locator.setAttribute('y', String(visibleSourceCrop.y))
          locator.setAttribute('width', String(visibleSourceCrop.width))
          locator.setAttribute('height', String(visibleSourceCrop.height))
          locator.ownerSVGElement?.setAttribute('data-source-crop', `${visibleSourceCrop.x},${visibleSourceCrop.y},${visibleSourceCrop.width},${visibleSourceCrop.height}`)
        }
        if (source.kind === 'screen' && cursorHalo && motionMode !== 'off' && cursorOutput.visible) {
          const x = cursorOutput.x
          const y = cursorOutput.y
          const radius = Math.max(54, Math.min(canvas.width, canvas.height) * cursorHaloSize)
          const haloRgb = cursorHaloColor === 'blue' ? '87,176,255' : cursorHaloColor === 'white' ? '255,255,255' : '255,210,80'
          const halo = ctx.createRadialGradient(x, y, 0, x, y, radius)
          halo.addColorStop(0, `rgba(${haloRgb},.2)`); halo.addColorStop(0.36, `rgba(${haloRgb},.08)`); halo.addColorStop(1, `rgba(${haloRgb},0)`)
          ctx.fillStyle = halo; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
          if (cursorTrail) {
            const trail = cursorTrailRef.current
            trail.push({ x, y }); if (trail.length > 12) trail.shift()
            trail.forEach((point, index) => {
              ctx.beginPath(); ctx.arc(point.x, point.y, 2 + index * 0.22, 0, Math.PI * 2)
              ctx.fillStyle = `rgba(${haloRgb},${(index + 1) / trail.length * 0.22})`; ctx.fill()
            })
          }
        }
        const camera = cameraVideoRef.current
        const avatar = avatarImageRef.current
        const cameraReady = Boolean(camera?.readyState && camera.videoWidth > 0)
        const avatarReady = cameraEffect === 'avatar' && Boolean(avatar?.naturalWidth)
        if (webcam && (cameraReady || avatarReady)) {
          const pipWidth = Math.round(canvas.width * cameraSize)
          const squareFrame = cameraFrame === 'circle' || cameraEffect === 'avatar'
          const pipHeight = squareFrame ? pipWidth : Math.round(pipWidth * camera!.videoHeight / camera!.videoWidth)
          const margin = Math.max(10, Math.round(canvas.width * cameraMargin))
          const x = cameraPosition.endsWith('right') ? canvas.width - pipWidth - margin : margin
          const y = cameraPosition.startsWith('bottom') ? canvas.height - pipHeight - margin : margin
          const radius = cameraFrame === 'circle' ? pipWidth / 2 : Math.max(12, Math.round(pipWidth * 0.06))
          ctx.save()
          ctx.globalAlpha = cameraOpacity
          ctx.shadowColor = cameraShadow ? 'rgba(0,0,0,.52)' : 'transparent'; ctx.shadowBlur = cameraShadow ? Math.max(12, pipWidth * 0.05) : 0; ctx.shadowOffsetY = cameraShadow ? Math.max(5, pipWidth * 0.018) : 0
          ctx.beginPath(); ctx.roundRect(x, y, pipWidth, pipHeight, radius); ctx.fillStyle = '#111'; ctx.fill()
          ctx.clip(); ctx.shadowColor = 'transparent'
          paintPersonaContent(ctx, x, y, pipWidth, pipHeight, now)
          ctx.restore()
          if (cameraBorder !== 'none') {
            ctx.save(); ctx.globalAlpha = cameraOpacity; ctx.beginPath(); ctx.roundRect(x, y, pipWidth, pipHeight, radius); ctx.strokeStyle = cameraBorder === 'accent' ? accent() : 'rgba(255,255,255,.76)'; ctx.lineWidth = Math.max(2, canvas.width / 960); ctx.stroke(); ctx.restore()
          }
        }
        const overlayFont = Math.max(16, Math.round(canvas.width / 92))
        const overlayPadding = Math.max(9, Math.round(overlayFont * 0.62))
        const drawOverlay = (label: string, position: OverlayPosition, opacity = 0.76): void => {
          ctx.save(); ctx.font = `600 ${overlayFont}px Segoe UI, sans-serif`
          const metrics = ctx.measureText(label); const boxWidth = metrics.width + overlayPadding * 2; const boxHeight = overlayFont + overlayPadding * 1.45
          const ox = position.endsWith('right') ? canvas.width - boxWidth - overlayPadding * 1.5 : overlayPadding * 1.5
          const oy = position.startsWith('bottom') ? canvas.height - boxHeight - overlayPadding * 1.5 : overlayPadding * 1.5
          ctx.globalAlpha = opacity; ctx.fillStyle = 'rgba(4,6,9,.74)'; ctx.beginPath(); ctx.roundRect(ox, oy, boxWidth, boxHeight, overlayPadding); ctx.fill()
          ctx.globalAlpha = Math.min(1, opacity + 0.2); ctx.fillStyle = '#fff'; ctx.fillText(label, ox + overlayPadding, oy + boxHeight - overlayPadding * 0.72); ctx.restore()
        }
        if (watermarkEnabled && watermarkText.trim()) drawOverlay(watermarkText.trim().slice(0, 80), watermarkPosition, watermarkOpacity)
        if (showTimestamp) drawOverlay(formatRecordingTime(preview ? 0 : currentElapsed()), 'top-left', 0.72)
        if (showSourceLabel) drawOverlay(recordingSourceLabel(source), 'top-right', 0.68)
        if (privacyTop > 0) { ctx.fillStyle = '#080a0d'; ctx.fillRect(0, 0, canvas.width, canvas.height * privacyTop) }
        if (privacyBottom > 0) { ctx.fillStyle = '#080a0d'; ctx.fillRect(0, canvas.height * (1 - privacyBottom), canvas.width, canvas.height * privacyBottom) }
        const at = currentElapsed()
        if (statusRef.current === 'recording' && keyframeIntervalSeconds > 0 && at - frameCaptureAtRef.current >= keyframeIntervalSeconds * 1000) {
          frameCaptureAtRef.current = at
          captureKeyframe(at, false)
        }
      }
      rafRef.current = window.requestAnimationFrame(draw)
    }
    rafRef.current = window.requestAnimationFrame(draw)
  }

  useEffect(() => {
    const video = sourcePreviewVideoRef.current
    const canvas = canvasRef.current
    if (!sourcePreviewing || !video?.videoWidth || !canvas || !selectedSource) return
    const size = recordingOutputSize(video.videoWidth, video.videoHeight, resolution, aspect)
    const previewSize = recordingPreviewSize(size)
    canvas.width = previewSize.width; canvas.height = previewSize.height
    setRecordingSize((current) => current.width === size.width && current.height === size.height ? current : size)
    focusRef.current = { x: 0.5, y: 0.5, zoom: 1, cursorX: 0.5, cursorY: 0.5, speed: 0, pollAt: 0, lastX: 0.5, lastY: 0.5 }
    drawLoop(video, canvas, selectedSource, true)
    return () => window.cancelAnimationFrame(rafRef.current)
  }, [sourcePreviewing, sourceId, resolution, aspect, fitMode, regionEnabled, region.left, region.top, region.right, region.bottom, motionMode, motionStrength, maxZoom, cursorHalo, cursorHaloSize, cursorHaloColor, cursorTrail, webcam, cameraPosition, cameraSize, cameraEffect, cameraFrame, cameraOpacity, cameraBorder, cameraShadow, cameraMargin, avatarDataUrl, avatarMotion, watermarkEnabled, watermarkText, watermarkPosition, watermarkOpacity, showTimestamp, showSourceLabel, privacyTop, privacyBottom])

  const startRecording = async (): Promise<void> => {
    const source = selectedSource
    if (!source || locked) return
    if (source.available === false) {
      setErrorMessage(source.unavailableReason || '当前窗口暂不可录制，请恢复窗口后刷新来源。')
      updateStatus('error'); setPanel('capture'); return
    }
    if (webcam && cameraEffect === 'avatar' && !avatarImageRef.current) {
      setErrorMessage('请先导入 PNG、JPEG 或 WebP 人物形象，再开始录制。')
      updateStatus('error'); setPanel('capture'); return
    }
    window.cancelAnimationFrame(personaPreviewRafRef.current)
    stopSourcePreview()
    setPersonaPreviewing(false); setPersonaPreviewError('')
    try {
      if (webcam && (cameraEffect === 'anime' || cameraEffect === 'cartoon')) {
        setStartupMessage('正在加载本地神经人物模型…')
        await ensureNeuralStyle()
      }
      if (previewIdRef.current) { island.releaseRecordingPreview(previewIdRef.current); previewIdRef.current = '' }
      setErrorMessage(''); setPreviewError(''); setStartupMessage('正在准备录制'); setCompact(false)
      const countdownToken = ++countdownTokenRef.current
      updateStatus('countdown'); setRecordingBlob(null); setRecordingUrl(''); setTimeline([]); setKeyframes([]); setTranscriptSegments([]); setElapsed(0)
      projectSaveTokenRef.current++
      projectIdRef.current = ''; setProjectId(''); setProjectSaveState('idle')
      for (let value = countdownSeconds; value > 0; value--) {
        setCountdown(value); await sleep(1000)
        if (countdownToken !== countdownTokenRef.current) return
      }
      setCountdown(0)
      updateStatus('starting'); setStartupMessage('正在连接屏幕画面…')
      island.setRecordingProtection(true)
      const desktopConstraints = {
        audio: systemAudio ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id } } : false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxFrameRate: fps } }
      } as unknown as MediaStreamConstraints
      let desktopStream: MediaStream
      try {
        desktopStream = await withTimeout(navigator.mediaDevices.getUserMedia(desktopConstraints), 12_000, '连接屏幕画面超时')
      } catch (firstError) {
        if (!systemAudio) throw firstError
        setStartupMessage('系统声音不可用，正在仅连接画面…')
        desktopStream = await withTimeout(navigator.mediaDevices.getUserMedia({ ...desktopConstraints, audio: false }), 12_000, '连接屏幕画面超时')
        flash('系统声音不可用，已继续录制画面')
      }
      sourceStreamRef.current = desktopStream
      desktopStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        const recorder = recorderRef.current
        if (!recorder || recorder.state === 'inactive') return
        stopReasonRef.current = '录制来源已关闭或停止共享'
        stopRecording()
      }, { once: true })
      setStartupMessage('正在初始化画面处理…')
      const video = sourceVideoRef.current || document.createElement('video')
      sourceVideoRef.current = video
      video.srcObject = desktopStream; video.muted = true; video.playsInline = true
      await video.play(); await withTimeout(waitVideo(video), 9_000, '桌面画面加载超时')
      setSourceMediaSize({ sourceId: source.id, width: video.videoWidth, height: video.videoHeight })
      const size = recordingOutputSize(video.videoWidth, video.videoHeight, resolution, aspect)
      setRecordingSize(size)
      const canvas = canvasRef.current!
      canvas.width = size.width; canvas.height = size.height
      focusRef.current = { x: 0.5, y: 0.5, zoom: 1, cursorX: 0.5, cursorY: 0.5, speed: 0, pollAt: 0, lastX: 0.5, lastY: 0.5 }
      drawLoop(video, canvas, source)

      const output = canvas.captureStream(fps)
      const audioTracks: MediaStreamTrack[] = [...desktopStream.getAudioTracks()]
      if (microphone) {
        setStartupMessage('正在连接麦克风…')
        try {
          const micOptions: MediaTrackConstraints = { echoCancellation, noiseSuppression, autoGainControl, ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}) }
          const mic = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: micOptions }), 8_000, '连接麦克风超时')
          micStreamRef.current = mic
          audioTracks.push(...mic.getAudioTracks())
          const devices = await navigator.mediaDevices.enumerateDevices()
          setMicDevices(devices.filter((device) => device.kind === 'audioinput'))
        } catch {
          flash('麦克风不可用，已继续录制画面')
        }
      }
      if (webcam && cameraEffect !== 'avatar') {
        setStartupMessage(cameraEffect === 'anime' ? '正在连接摄像头并初始化动漫渲染…' : cameraEffect === 'cartoon' ? '正在连接摄像头并初始化卡通渲染…' : '正在连接摄像头画中画…')
        try {
          if (!cameraStreamRef.current?.active || !cameraVideoRef.current?.videoWidth) {
            const cameraStream = await withTimeout(navigator.mediaDevices.getUserMedia({ video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }), 8_000, '连接摄像头超时')
            cameraStreamRef.current = cameraStream
            const cameraVideo = cameraVideoRef.current || document.createElement('video')
            cameraVideoRef.current = cameraVideo
            cameraVideo.srcObject = cameraStream; cameraVideo.muted = true; cameraVideo.playsInline = true
            await cameraVideo.play(); await withTimeout(waitVideo(cameraVideo), 8_000, '摄像头画面加载超时')
          }
          const devices = await navigator.mediaDevices.enumerateDevices()
          setCameraDevices(devices.filter((device) => device.kind === 'videoinput'))
        } catch {
          cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
          cameraStreamRef.current = null
          flash('摄像头不可用，已继续录制屏幕')
        }
      } else if (webcam && cameraEffect === 'avatar') {
        setStartupMessage('正在装载虚拟形象与动态效果…')
      }
      if (audioTracks.length) {
        setStartupMessage('正在混合录制音频…')
        const audioContext = new AudioContext()
        audioContextRef.current = audioContext
        if (audioContext.state === 'suspended') await audioContext.resume()
        const destination = audioContext.createMediaStreamDestination()
        if (desktopStream.getAudioTracks().length) {
          const sourceNode = audioContext.createMediaStreamSource(new MediaStream(desktopStream.getAudioTracks()))
          const gain = audioContext.createGain(); gain.gain.value = systemMuted ? 0 : systemGain
          systemGainRef.current = gain
          sourceNode.connect(gain).connect(destination)
        }
        if (micStreamRef.current?.getAudioTracks().length) {
          const sourceNode = audioContext.createMediaStreamSource(micStreamRef.current)
          const gain = audioContext.createGain(); gain.gain.value = micMuted ? 0 : micGain
          micGainRef.current = gain
          sourceNode.connect(gain).connect(destination)
        }
        destination.stream.getAudioTracks().forEach((track) => output.addTrack(track))
      }

      setStartupMessage('正在启动高清编码器…')
      const mimeType = selectRecorderMime((mime) => MediaRecorder.isTypeSupported(mime), output.getAudioTracks().length > 0)
      setRecordingHasAudio(output.getAudioTracks().length > 0)
      const recorder = new MediaRecorder(output, {
        mimeType,
        videoBitsPerSecond: recordingVideoBitrate(size.width, size.height, fps, captureQuality),
        audioBitsPerSecond: 192_000
      })
      const sessionResult = await island.createRecordingSession({
        name: recordingName,
        mimeType,
        sourceName: recordingSourceLabel(source),
        sourceKind: source.kind,
        width: size.width,
        height: size.height,
        fps,
        hasAudio: output.getAudioTracks().length > 0
      })
      recordingSessionIdRef.current = sessionResult.ok && sessionResult.session ? sessionResult.session.id : ''
      recordingChunkIndexRef.current = 0
      recordingWriteQueueRef.current = Promise.resolve()
      recordingWriteErrorRef.current = ''
      recordingLastChunkAtRef.current = performance.now()
      recordingWriteLatencyRef.current = 0
      recordingHealthSampleAtRef.current = 0
      setHealth(recordingHealth({ active: true, elapsedMs: 0, bytes: 0, chunkGapMs: 0, writeLatencyMs: 0, droppedFrames: 0, totalFrames: 0 }))
      setRecordingSessionId('')
      if (!recordingSessionIdRef.current) flash(`分块落盘不可用，已切换内存录制：${sessionResult.error || '未知原因'}`)
      recorderRef.current = recorder; chunksRef.current = []; recordedBytesRef.current = 0; setRecordedBytes(0)
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return
        recordingLastChunkAtRef.current = performance.now()
        recordedBytesRef.current += event.data.size
        setRecordedBytes(recordedBytesRef.current)
        const sessionId = recordingSessionIdRef.current
        if (!sessionId) { chunksRef.current.push(event.data); return }
        if (recordingWriteErrorRef.current) return
        const chunk = event.data
        const chunkIndex = recordingChunkIndexRef.current++
        const queuedAt = performance.now()
        recordingWriteQueueRef.current = recordingWriteQueueRef.current
          .then(async () => {
            const result = await island.appendRecordingChunk(sessionId, chunkIndex, await chunk.arrayBuffer())
            if (!result.ok) throw new Error(result.error || '录制分片写盘失败')
            recordingWriteLatencyRef.current = performance.now() - queuedAt
          })
          .catch((error) => {
            if (recordingWriteErrorRef.current) return
            recordingWriteErrorRef.current = recordingStartError(error)
            stopReasonRef.current = '录制分片写盘失败，已自动停止'
            if (recorder.state !== 'inactive') recorder.stop()
          })
      }
      recorder.onerror = () => {
        setCompact(false); setErrorMessage('录制器发生错误，录制已停止。请降低分辨率或帧率后重试。')
        updateStatus('error'); cleanupMedia()
      }
      recorder.onstop = async () => {
        setCompact(false); island.setIgnoreMouse(false)
        const finalElapsed = elapsedRef.current || currentElapsed()
        const stopReason = stopReasonRef.current
        setElapsed(finalElapsed); cleanupMedia()
        await recordingWriteQueueRef.current
        const sessionId = recordingSessionIdRef.current
        const writeError = recordingWriteErrorRef.current
        if (writeError) {
          setErrorMessage(`录制写盘失败：${writeError}。已保留中断会话，可重新打开录屏工坊恢复已有内容。`)
          updateStatus('error')
          const sessions = await island.listRecordingSessions()
          if (sessions.ok) setRecoverableSessions((sessions.sessions || []).filter((session) => session.bytes >= 1024))
          return
        }
        const blob = sessionId ? null : new Blob(chunksRef.current, { type: recorder.mimeType || mimeType })
        if ((!sessionId && (!blob || blob.size < 1024)) || (sessionId && recordedBytesRef.current < 1024)) {
          setErrorMessage('录制文件为空，未获得有效视频帧。请刷新录制来源，关闭受保护内容后重试。')
          updateStatus('error')
          return
        }
        updateStatus('starting'); setStartupMessage('正在生成可播放预览…')
        const fullSegment: RecordingEditSegment = { id: `segment-${Date.now()}`, startMs: 0, endMs: finalElapsed, enabled: true, label: '片段 1' }
        setTrimStart(0); setTrimEnd(finalElapsed); setPlaybackRate(1); setPreviewCurrentMs(0)
        setEditSegments([fullSegment]); setActiveSegmentId(fullSegment.id)
        setEditSettings({ speed: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 }, rotation: 0, contrast: 1, saturation: 1, gamma: 1, audioVolume: 1 })
        setEditHistory([]); setEditFuture([])
        setRecordingBlob(blob)
        if (sessionId) {
          const finalized = await island.finalizeRecordingSession(sessionId, finalElapsed)
          if (finalized.ok && finalized.url && finalized.session) {
            setRecordingSessionId(finalized.session.id)
            setRecordedBytes(finalized.session.bytes); recordedBytesRef.current = finalized.session.bytes
            setRecordingUrl(finalized.url)
            setRecoverableSessions((items) => [finalized.session!, ...items.filter((item) => item.id !== finalized.session!.id)])
          } else {
            setPreviewError(finalized.error || '录制已落盘，但无法完成会话。重开录屏工坊后可恢复。')
          }
        } else {
          const prepared = await island.prepareRecordingPreview(await blob!.arrayBuffer())
          if (prepared.ok && prepared.id && prepared.url) {
            previewIdRef.current = prepared.id
            setRecordingUrl(prepared.url)
          } else {
            setPreviewError(prepared.error || '录制完成，但无法创建本地预览。仍可尝试导出视频。')
          }
        }
        setStartupMessage(''); updateStatus('ready'); setPanel('edit')
        setTimeline((items) => [...items, { at: finalElapsed, type: 'end', label: stopReason || '录制完成' }])
        if (stopReason) flash(stopReason)
      }
      startAtRef.current = performance.now(); pausedAtRef.current = 0; pausedTotalRef.current = 0; elapsedRef.current = 0; frameCaptureAtRef.current = 0; lastAutoMarkerAtRef.current = 0; stopReasonRef.current = ''
      recorder.start(1000)
      setTimeline([{ at: 0, type: 'start', label: '开始录制' }]); updateStatus('recording')
      setStartupMessage(''); setCompact(true)
      window.setTimeout(() => captureKeyframe(0, false), 600)
    } catch (error) {
      const message = recordingStartError(error)
      const failedSessionId = recordingSessionIdRef.current
      if (failedSessionId) void island.discardRecordingSession(failedSessionId).catch(() => {})
      recordingSessionIdRef.current = ''; setRecordingSessionId('')
      setCompact(false); cleanupMedia(); setCountdown(0); setStartupMessage(''); setErrorMessage(message); updateStatus('error')
    }
  }

  const pauseRecording = (): void => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause(); pausedAtRef.current = performance.now(); const at = currentElapsed(); elapsedRef.current = at; setElapsed(at); setTimeline((items) => [...items, { at, type: 'pause', label: '暂停' }]); updateStatus('paused')
    } else if (recorder.state === 'paused') {
      pausedTotalRef.current += performance.now() - pausedAtRef.current; recorder.resume(); updateStatus('recording'); const at = currentElapsed(); elapsedRef.current = at; setElapsed(at); setTimeline((items) => [...items, { at, type: 'resume', label: '继续' }])
    }
  }
  const cancelCountdown = (): void => {
    countdownTokenRef.current++
    setCountdown(0); setStartupMessage(''); updateStatus('idle')
  }
  const stopRecording = (): void => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      elapsedRef.current = currentElapsed()
      captureKeyframe(elapsedRef.current, false)
      setCompact(false); island.setIgnoreMouse(false)
      try { recorder.requestData() } catch { /* stop still flushes the final chunk */ }
      window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop()
      }, 120)
    }
  }
  const addMarker = (): void => {
    const at = currentElapsed(); setTimeline((items) => [...items, { at, type: 'marker', label: `章节 ${items.filter((item) => item.type === 'marker').length + 1}` }]); captureKeyframe(at, false); flash('已添加章节标记')
  }
  const applyRecordingProject = (project: RecordingProjectDocument): void => {
    const segments = project.edit.segments.length ? project.edit.segments.map((segment) => ({ ...segment })) : [{ id: `segment-${Date.now()}`, startMs: 0, endMs: project.durationMs, enabled: true, label: '片段 1' }]
    const first = segments[0]
    projectSaveTokenRef.current++
    projectIdRef.current = project.id; setProjectId(project.id); setProjectSaveState('saved')
    setRecordingName(project.name); setRecordingSize({ ...project.size }); setFps(project.fps); setRecordingHasAudio(project.hasAudio)
    setElapsed(project.durationMs); elapsedRef.current = project.durationMs
    setEditSegments(segments); setActiveSegmentId(first.id); setTrimStart(first.startMs); setTrimEnd(first.endMs); setPlaybackRate(project.edit.speed || 1)
    setEditSettings({ ...project.edit, crop: project.edit.crop ? { ...project.edit.crop } : undefined, segments: undefined })
    setTimeline(project.timeline.map((item) => ({ ...item }))); setTranscriptSegments(project.transcript.segments.map((item) => ({ ...item })))
    setTranscriptModel(project.transcript.model); setTranscriptLanguage(project.transcript.language)
    setTimelineZoom(project.workspace.timelineZoom); setTimelineSnap(project.workspace.timelineSnap)
    setVideoTrackLocked(project.workspace.videoTrackLocked); setMarkerTrackLocked(project.workspace.markerTrackLocked); setAiEditMode(project.workspace.aiEditMode)
    setAiResults(project.aiResults.map((item) => ({ ...item }))); setEditHistory([]); setEditFuture([])
  }
  const restoreRecordingSession = async (session: RecordingSessionManifest, preferredProjectId = ''): Promise<void> => {
    const result = await island.recoverRecordingSession(session.id)
    if (!result.ok || !result.session || !result.url) { flash(result.error || '恢复录制失败'); return }
    if (previewIdRef.current) { island.releaseRecordingPreview(previewIdRef.current); previewIdRef.current = '' }
    const restored = result.session
    const duration = Math.max(1, restored.durationMs)
    const segment: RecordingEditSegment = { id: `segment-${Date.now()}`, startMs: 0, endMs: duration, enabled: true, label: '恢复片段' }
    recordingSessionIdRef.current = restored.id
    setRecordingSessionId(restored.id); setRecordingBlob(null); setRecordingUrl(result.url); setPreviewError('')
    setRecordingName(restored.name); setRecordingSize({ width: restored.width, height: restored.height }); setFps(restored.fps); setRecordingHasAudio(restored.hasAudio)
    setRecordedBytes(restored.bytes); recordedBytesRef.current = restored.bytes; setElapsed(duration); elapsedRef.current = duration
    setTrimStart(0); setTrimEnd(duration); setPlaybackRate(1); setPreviewCurrentMs(0)
    setEditSegments([segment]); setActiveSegmentId(segment.id)
    setEditSettings({ speed: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 }, rotation: 0, contrast: 1, saturation: 1, gamma: 1, audioVolume: 1 })
    setEditHistory([]); setEditFuture([]); setTranscriptSegments([])
    setTimeline([{ at: 0, type: 'start', label: '恢复录制' }, { at: duration, type: 'end', label: session.status === 'interrupted' ? '异常中断' : '录制完成' }])
    setRecoverableSessions((items) => [restored, ...items.filter((item) => item.id !== restored.id)])
    const listed: Awaited<ReturnType<typeof island.listRecordingProjects>> = await island.listRecordingProjects().catch(() => ({ ok: false }))
    if (listed.ok) setRecordingProjects(listed.projects || [])
    const summary = listed.ok ? (listed.projects || []).find((item) => item.sessionId === restored.id && (!preferredProjectId || item.id === preferredProjectId)) : undefined
    const loaded: Awaited<ReturnType<typeof island.loadRecordingProject>> | null = summary ? await island.loadRecordingProject(summary.id).catch(() => ({ ok: false })) : null
    if (loaded?.ok && loaded.project) applyRecordingProject(loaded.project)
    else { projectIdRef.current = ''; setProjectId(''); setProjectSaveState('idle') }
    updateStatus('ready'); setPanel('edit'); flash(loaded?.ok ? '录屏工程与编辑进度已恢复' : '录制内容已恢复')
  }
  const discardRecordingSession = async (id: string): Promise<void> => {
    const result = await island.discardRecordingSession(id)
    if (!result.ok) { flash(result.error || '删除恢复记录失败'); return }
    setRecoverableSessions((items) => items.filter((item) => item.id !== id))
    setRecordingProjects((items) => items.filter((item) => item.sessionId !== id))
    flash('恢复记录已删除')
  }
  const resetRecording = (): void => {
    setCompact(false); setErrorMessage(''); setStartupMessage('')
    if (previewIdRef.current) { island.releaseRecordingPreview(previewIdRef.current); previewIdRef.current = '' }
    projectSaveTokenRef.current++
    recordingSessionIdRef.current = ''; setRecordingSessionId(''); projectIdRef.current = ''; setProjectId(''); setProjectSaveState('idle')
    setRecordingBlob(null); setRecordingUrl(''); updateStatus('idle'); setElapsed(0); setRecordedBytes(0); recordedBytesRef.current = 0; stopReasonRef.current = ''; setTimeline([]); setKeyframes([]); setTranscriptSegments([]); setEditSegments([]); setActiveSegmentId(''); setEditHistory([]); setEditFuture([]); setRecordingHasAudio(false); setExportProgress(null); setPanel('capture')
  }

  const seekPreview = (ms: number): void => {
    const video = previewVideoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(elapsed, ms)) / 1000
    setPreviewCurrentMs(Math.max(0, Math.min(elapsed, ms)))
  }

  const playTrimmedPreview = (): void => {
    const video = previewVideoRef.current
    if (!video) return
    video.playbackRate = playbackRate
    seekPreview(trimStart)
    void video.play().catch(() => setPreviewError('预览播放失败，请重新录制或直接尝试导出原始 WebM。'))
  }

  const selectSegment = (segment: RecordingEditSegment): void => {
    setActiveSegmentId(segment.id); setTrimStart(segment.startMs); setTrimEnd(segment.endMs); seekPreview(segment.startMs)
  }

  const currentEditSnapshot = (): EditSnapshot => ({
    segments: editSegments.map((segment) => ({ ...segment })),
    settings: { ...editSettings, crop: editSettings.crop ? { ...editSettings.crop } : undefined, segments: undefined },
    rate: playbackRate,
    timeline: timeline.map((item) => ({ ...item }))
  })

  const applyEditSnapshot = (snapshot: EditSnapshot): void => {
    const segments = snapshot.segments.map((segment) => ({ ...segment }))
    setEditSegments(segments); setEditSettings({ ...snapshot.settings, crop: snapshot.settings.crop ? { ...snapshot.settings.crop } : undefined }); setPlaybackRate(snapshot.rate); setTimeline(snapshot.timeline.map((item) => ({ ...item })))
    const selected = segments.find((segment) => segment.id === activeSegmentId) || segments[0]
    if (selected) { setActiveSegmentId(selected.id); setTrimStart(selected.startMs); setTrimEnd(selected.endMs) }
    if (previewVideoRef.current) previewVideoRef.current.playbackRate = snapshot.rate
  }

  const rememberEdit = (coalesce = false): void => {
    const now = performance.now()
    const snapshot = currentEditSnapshot()
    setEditHistory((items) => {
      if (coalesce && now - editHistoryAtRef.current < 400) return items
      editHistoryAtRef.current = coalesce ? now : 0
      return [...items.slice(-39), snapshot]
    })
    setEditFuture([])
  }

  const undoEdit = (): void => {
    const target = editHistory.at(-1)
    if (!target) return
    setEditFuture((items) => [currentEditSnapshot(), ...items].slice(0, 40))
    setEditHistory((items) => items.slice(0, -1))
    applyEditSnapshot(target)
  }

  const redoEdit = (): void => {
    const target = editFuture[0]
    if (!target) return
    setEditHistory((items) => [...items.slice(-39), currentEditSnapshot()])
    setEditFuture((items) => items.slice(1))
    applyEditSnapshot(target)
  }

  const snapEditPoint = (value: number, segmentId = ''): number => {
    if (!timelineSnap) return Math.max(0, Math.min(elapsed, value))
    const points = [previewCurrentMs, ...timeline.map((item) => item.at), ...editSegments.flatMap((segment) => segment.id === segmentId ? [] : [segment.startMs, segment.endMs])]
    return snapRecordingTime(value, elapsed, points, Math.max(35, 140 / timelineZoom), fps)
  }

  const beginTimelineTrim = (event: React.PointerEvent<HTMLElement>, segment: RecordingEditSegment, edge: 'start' | 'end'): void => {
    event.preventDefault(); event.stopPropagation()
    if (videoTrackLocked) { flash('视频轨已锁定'); return }
    const lane = event.currentTarget.closest('[data-timeline-video-lane]') as HTMLElement | null
    if (!lane) return
    const rect = lane.getBoundingClientRect()
    rememberEdit()
    const move = (pointer: PointerEvent): void => {
      const raw = (pointer.clientX - rect.left) / Math.max(1, rect.width) * elapsed
      const at = snapEditPoint(raw, segment.id)
      setEditSegments((items) => items.map((item) => item.id !== segment.id ? item : edge === 'start'
        ? { ...item, startMs: Math.max(0, Math.min(at, item.endMs - 100)) }
        : { ...item, endMs: Math.min(elapsed, Math.max(item.startMs + 100, at)) }))
      if (edge === 'start') setTrimStart(Math.max(0, Math.min(at, segment.endMs - 100)))
      else setTrimEnd(Math.min(elapsed, Math.max(segment.startMs + 100, at)))
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  const updateActiveSegment = (patch: Partial<RecordingEditSegment>): void => {
    if (!activeSegment) return
    if (videoTrackLocked) { flash('视频轨已锁定'); return }
    rememberEdit(true)
    setEditSegments((items) => items.map((segment) => segment.id === activeSegment.id ? { ...segment, ...patch } : segment))
    if (patch.startMs !== undefined) setTrimStart(patch.startMs)
    if (patch.endMs !== undefined) setTrimEnd(patch.endMs)
    if (exportQuality === 'original') setExportQuality('balanced')
  }

  const splitActiveSegment = (): void => {
    if (!activeSegment) return
    if (videoTrackLocked) { flash('视频轨已锁定'); return }
    const splitAt = snapEditPoint(previewCurrentMs, activeSegment.id)
    const next = splitRecordingSegment(editSegments, activeSegment.id, splitAt)
    if (next === editSegments) { flash('请把播放头移动到当前片段内部再拆分'); return }
    rememberEdit()
    setEditSegments(next)
    const right = next.find((segment) => segment.startMs === splitAt)
    if (right) { setActiveSegmentId(right.id); setTrimStart(right.startMs); setTrimEnd(right.endMs) }
    if (exportQuality === 'original') setExportQuality('balanced')
  }

  const deleteActiveSegment = (): void => {
    if (!activeSegment || editSegments.length <= 1) { flash('至少保留一个片段'); return }
    if (videoTrackLocked) { flash('视频轨已锁定'); return }
    rememberEdit()
    const next = editSegments.filter((segment) => segment.id !== activeSegment.id)
    setEditSegments(next); selectSegment(next[0])
    if (exportQuality === 'original') setExportQuality('balanced')
  }

  const toggleSegmentEnabled = (segmentId: string): void => {
    const segment = editSegments.find((item) => item.id === segmentId)
    if (!segment) return
    if (videoTrackLocked) { flash('视频轨已锁定'); return }
    if (segment.enabled !== false && editSegments.filter((item) => item.enabled !== false).length <= 1) { flash('至少启用一个导出片段'); return }
    rememberEdit()
    setEditSegments((items) => items.map((item) => item.id === segmentId ? { ...item, enabled: item.enabled === false } : item))
    if (exportQuality === 'original') setExportQuality('balanced')
  }

  const resetEdits = (): void => {
    rememberEdit()
    const full: RecordingEditSegment = { id: `segment-${Date.now()}`, startMs: 0, endMs: elapsed, enabled: true, label: '片段 1' }
    setEditSegments([full]); setActiveSegmentId(full.id); setTrimStart(0); setTrimEnd(elapsed); setPlaybackRate(1)
    setEditSettings({ speed: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 }, rotation: 0, contrast: 1, saturation: 1, gamma: 1, audioVolume: 1 })
    if (previewVideoRef.current) { previewVideoRef.current.playbackRate = 1; previewVideoRef.current.style.filter = '' }
  }

  const patchEditSettings = (patch: Partial<RecordingEditSettings>): void => {
    rememberEdit(true)
    setEditSettings((current) => ({ ...current, ...patch }))
    if (exportQuality === 'original') setExportQuality('balanced')
  }

  const updateTimelineItem = (target: TimelineEvent, patch: Partial<TimelineEvent>): void => {
    if (markerTrackLocked) { flash('标记轨已锁定'); return }
    rememberEdit(true)
    setTimeline((items) => items.map((item) => item === target ? { ...item, ...patch } : item))
  }

  const deleteTimelineItem = (target: TimelineEvent): void => {
    if (markerTrackLocked) { flash('标记轨已锁定'); return }
    rememberEdit()
    setTimeline((items) => items.filter((item) => item !== target))
  }

  const addTimelineMarker = (): void => {
    if (markerTrackLocked) { flash('标记轨已锁定'); return }
    rememberEdit()
    const at = snapEditPoint(previewCurrentMs)
    setTimeline((items) => [...items, { at, type: 'marker' as const, label: `章节 ${items.filter((item) => item.type === 'marker').length + 1}` }].sort((a, b) => a.at - b.at))
  }

  useEffect(() => {
    if (panel !== 'edit' || (!recordingBlob && !recordingSessionId)) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoEdit() : undoEdit() }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redoEdit() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [panel, recordingBlob, recordingSessionId, editHistory, editFuture, editSegments, editSettings, playbackRate, timeline])

  const savePreviewFrame = async (): Promise<void> => {
    const video = previewVideoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth) { flash('当前还没有可保存的视频帧'); return }
    const frame = document.createElement('canvas')
    frame.width = video.videoWidth; frame.height = video.videoHeight
    frame.getContext('2d')!.drawImage(video, 0, 0, frame.width, frame.height)
    const result = await island.saveImage(frame.toDataURL('image/png'), `${recordingName}_${formatRecordingTime(video.currentTime * 1000).replace(/:/g, '-')}`)
    if (result.ok) flash('当前帧已保存为 PNG')
    else if (!result.canceled) flash(result.error || '当前帧保存失败')
  }

  const buildRecordingProjectInput = (): RecordingProjectSaveInput => ({
    schema: 'agentic-island-recording-project/v2',
    id: projectIdRef.current || projectId || undefined,
    sessionId: recordingSessionId,
    name: recordingName,
    source: selectedSource ? { name: recordingSourceLabel(selectedSource), kind: selectedSource.kind, displayId: selectedSource.displayId } : null,
    durationMs: elapsed,
    size: { ...recordingSize },
    fps,
    hasAudio: recordingHasAudio,
    edit: { ...editSettings, crop: editSettings.crop ? { ...editSettings.crop } : undefined, speed: playbackRate, segments: editSegments.map((segment) => ({ ...segment })) },
    timeline: timeline.map((item) => ({ ...item })),
    transcript: { model: transcriptModel, language: transcriptLanguage, segments: transcriptSegments.map((item) => ({ ...item })) },
    workspace: { timelineZoom, timelineSnap, videoTrackLocked, markerTrackLocked, aiEditMode },
    aiResults: aiResults.map((item) => ({ ...item }))
  })

  const persistRecordingProject = async (showFeedback = false): Promise<RecordingProjectDocument | null> => {
    if (!recordingSessionId) { if (showFeedback) flash('内存录制无法建立可恢复工程，请重新录制以启用分块落盘'); return null }
    const token = ++projectSaveTokenRef.current
    setProjectSaveState('saving')
    const result: Awaited<ReturnType<typeof island.saveRecordingProject>> = await island.saveRecordingProject(buildRecordingProjectInput()).catch((error) => ({ ok: false, error: recordingStartError(error) }))
    if (token !== projectSaveTokenRef.current) return null
    if (!result.ok || !result.project) {
      setProjectSaveState('error')
      if (showFeedback) flash(result.error || '录屏工程保存失败')
      return null
    }
    projectIdRef.current = result.project.id; setProjectId(result.project.id); setProjectSaveState('saved')
    const listed: Awaited<ReturnType<typeof island.listRecordingProjects>> = await island.listRecordingProjects().catch(() => ({ ok: false }))
    if (listed.ok) setRecordingProjects(listed.projects || [])
    if (showFeedback) flash('工程已保存，可在工程库继续编辑')
    return result.project
  }

  const exportRecordingProjectFile = async (): Promise<void> => {
    const project = await persistRecordingProject(false)
    if (!project) { flash('工程保存失败，无法导出工程文件'); return }
    const result = await island.saveText(JSON.stringify(project, null, 2), `${recordingName}_剪辑工程`, 'json')
    if (result.ok) flash('v2 剪辑工程文件已导出')
    else flash(result.error || '工程文件导出失败')
  }

  useEffect(() => {
    if (status !== 'ready' || !recordingSessionId || !editSegments.length) return
    setProjectSaveState('saving')
    const timer = window.setTimeout(() => { void persistRecordingProject(false) }, 1000)
    return () => window.clearTimeout(timer)
  }, [status, recordingSessionId, recordingName, elapsed, recordingSize.width, recordingSize.height, fps, recordingHasAudio, editSegments, editSettings, playbackRate, timeline, transcriptModel, transcriptLanguage, transcriptSegments, timelineZoom, timelineSnap, videoTrackLocked, markerTrackLocked, aiEditMode, aiResults])

  const openRecordingProject = async (summary: RecordingProjectSummary): Promise<void> => {
    const sessionsResult: Awaited<ReturnType<typeof island.listRecordingSessions>> = await island.listRecordingSessions().catch(() => ({ ok: false }))
    const session = sessionsResult.ok ? (sessionsResult.sessions || []).find((item) => item.id === summary.sessionId) : undefined
    if (!session) { flash('工程素材已被清理，无法继续编辑'); return }
    await restoreRecordingSession(session, summary.id)
  }

  const duplicateRecordingProject = async (id: string): Promise<void> => {
    const result = await island.duplicateRecordingProject(id)
    if (!result.ok) { flash(result.error || '工程副本创建失败'); return }
    const listed = await island.listRecordingProjects()
    if (listed.ok) setRecordingProjects(listed.projects || [])
    flash('工程副本已创建')
  }

  const deleteRecordingProject = async (summary: RecordingProjectSummary): Promise<void> => {
    if (summary.id === projectId) { flash('当前正在编辑此工程，请先打开其他工程'); return }
    const result = await island.deleteRecordingProject(summary.id)
    if (!result.ok) { flash(result.error || '删除工程失败'); return }
    setRecordingProjects((items) => items.filter((item) => item.id !== summary.id))
    flash('工程记录已删除，原始录制素材仍保留')
  }

  const saveChapterFile = async (): Promise<void> => {
    const markers = timeline.filter((item) => item.type === 'marker' || item.type === 'start')
    const content = markers.map((item) => `${formatRecordingTime(item.at)} ${item.label}`).join('\n')
    const result = await island.saveText(content || '00:00 开始录制', `${recordingName}_章节`, 'txt')
    if (result.ok) flash('章节文件已保存')
  }

  const saveContactSheet = async (): Promise<void> => {
    if (!keyframes.length) { flash('暂无关键帧可生成分镜图'); return }
    const image = await makeContactSheet(keyframes, contextDataUrl)
    const result = await island.saveImage(image, `${recordingName}_分镜图`)
    if (result.ok) flash('关键帧分镜图已保存')
  }

  const exportRecording = async (): Promise<void> => {
    if ((!recordingBlob && !recordingSessionId) || exporting) return
    const jobId = `export-${Date.now()}`
    setExporting(true); setExportProgress({ jobId, phase: 'preparing', progress: 0 })
    const maxSize = exportResolution === '1080p' ? { width: 1920, height: 1080 } : exportResolution === '720p' ? { width: 1280, height: 720 } : recordingSize
    const scale = Math.min(1, maxSize.width / recordingSize.width, maxSize.height / recordingSize.height)
    const outputSize = { width: Math.max(2, Math.round(recordingSize.width * scale / 2) * 2), height: Math.max(2, Math.round(recordingSize.height * scale / 2) * 2) }
    const request = {
      jobId, name: recordingName, format, quality: exportQuality, durationMs: elapsed,
      trimStartMs: trimStart, trimEndMs: trimEnd || elapsed,
      width: recordingSize.width, height: recordingSize.height, fps, hasAudio: recordingHasAudio,
      outputWidth: outputSize.width, outputHeight: outputSize.height, outputFps: exportFps === 'source' ? fps : Number(exportFps),
      subtitle: { mode: format === 'mp4' || format === 'webm' ? exportSubtitleMode : 'none' as const, language: transcriptLanguage, segments: transcriptSegments },
      edit: { ...editSettings, speed: playbackRate, segments: editSegments }
    }
    const result = recordingSessionId
      ? await island.exportRecordingSession(recordingSessionId, request)
      : await island.exportRecording(await recordingBlob!.arrayBuffer(), request)
    setExporting(false)
    if (result.ok) flash(`已导出 ${result.path || ''}`)
    else if (!result.canceled) flash(result.error || '导出失败')
  }

  const runAI = async (label: string, prompt: string): Promise<void> => {
    if (!llmReady || aiBusy) return
    setAiBusy(label)
    try {
      const image = await makeContactSheet(keyframes, contextDataUrl)
      const persona = cameraEffect === 'anime' ? `实时动漫渲染（${animePalette}）` : cameraEffect === 'cartoon' ? `实时卡通渲染（${animePalette}）` : cameraEffect === 'avatar' ? `形象替换（${avatarName || '未导入'}）` : '原始人像'
      const context = `录制状态：${status}；来源：${recordingSourceLabel(selectedSource) || '未选择'}；时长：${formatRecordingTime(elapsed)}；剪辑区间：${formatRecordingTime(trimStart)}-${formatRecordingTime(trimEnd || elapsed)}；分辨率：${recordingSize.width}x${recordingSize.height}；帧率：${fps}；运镜：${motionMode}；摄像头画中画：${webcam ? `开启，${persona}` : '关闭'}；时间线：${timeline.map((item) => `${formatRecordingTime(item.at)} ${item.label}`).join('，') || '尚未录制'}。`
      const result = await onAIVision(AI_SYSTEM, image, `${context}\n任务：${prompt}`)
      setAiResults((items) => [{ id: Date.now(), label, text: result.ok ? (result.text || '未返回内容') : (result.error || 'AI 调用失败'), error: !result.ok }, ...items])
    } catch (error) {
      setAiResults((items) => [{ id: Date.now(), label, text: String(error), error: true }, ...items])
    } finally { setAiBusy('') }
  }

  const runAIAutoEdit = async (): Promise<void> => {
    if (!llmReady || aiBusy || (!recordingBlob && !recordingSessionId) || !keyframes.length) return
    const modeGuide = aiEditMode === 'tutorial'
      ? '教程精简：保留完整操作步骤和验证结果，删除明显无信息画面，章节按步骤命名，速度保持 1 到 1.25。'
      : aiEditMode === 'dynamic'
        ? '节奏增强：保留关键操作与结果，积极压缩重复或停顿画面，允许 1.25 到 1.5 倍速，但不得破坏可理解性。'
        : '保守整理：只切除有充分视觉证据的空白或重复区间，不确定内容必须保留，速度优先为 1。'
    setAiBusy('AI 智能粗剪')
    try {
      const image = await makeContactSheet(keyframes, contextDataUrl)
      const transcriptEvidence = transcriptSegments.length ? transcriptSegments.slice(0, 400).map((item) => `${Math.round(item.startMs)}-${Math.round(item.endMs)}ms ${item.text}`).join('\n') : '无真实转写；不得推断语音或静音。'
      const prompt = `为这段屏幕录制生成可直接应用的非破坏性粗剪方案。${modeGuide}
素材总时长：${Math.round(elapsed)}ms；关键帧时间：${keyframes.map((item) => Math.round(item.at)).join(', ') || '无'}；现有章节：${timeline.filter((item) => item.type === 'marker').map((item) => `${Math.round(item.at)}ms ${item.label}`).join('，') || '无'}。
真实音频转写（可能没有）：\n${transcriptEvidence}
只能依据拼图和上述事实判断，不能根据画面臆造语音、静音或未显示的操作。仅返回一个 JSON 对象，不要 Markdown：
{"title":"成片标题","summary":"本次粗剪依据","segments":[{"startMs":0,"endMs":1000,"label":"片段名","enabled":true}],"markers":[{"at":0,"label":"章节名"}],"speed":1,"adjustments":{"brightness":0,"contrast":1,"saturation":1,"gamma":1,"sharpen":0,"denoise":0,"audioVolume":1,"fadeInMs":0,"fadeOutMs":0}}
segments 必须按时间递增、互不重叠、至少保留一段，每段不少于 100ms，所有时间均使用毫秒且不得超过总时长。`
      const result = await onAIVision(AI_SYSTEM, image, prompt)
      const plan = result.ok && result.text ? parseRecordingAiEditPlan(result.text, elapsed) : null
      if (!plan) throw new Error(result.error || 'AI 返回的剪辑方案格式无效，工程未修改')
      rememberEdit()
      const segments: RecordingEditSegment[] = plan.segments.map((segment, index) => ({ ...segment, id: `ai-segment-${Date.now()}-${index}` }))
      const first = segments[0]
      setEditSegments(segments); setActiveSegmentId(first.id); setTrimStart(first.startMs); setTrimEnd(first.endMs)
      setPlaybackRate(plan.speed); if (previewVideoRef.current) previewVideoRef.current.playbackRate = plan.speed
      setEditSettings((current) => ({ ...current, ...plan.adjustments, speed: plan.speed, segments: undefined }))
      const aiTimeline: TimelineEvent[] = [
        { at: 0, type: 'start', label: '开始录制' },
        ...plan.markers.map((marker): TimelineEvent => ({ ...marker, type: 'marker' })),
        { at: elapsed, type: 'end', label: '录制完成' }
      ]
      setTimeline(aiTimeline.sort((a, b) => a.at - b.at))
      if (exportQuality === 'original') setExportQuality('balanced')
      setAiResults((items) => [{ id: Date.now(), label: 'AI 智能粗剪已应用', text: `${plan.title}\n${plan.summary || '已按关键帧生成结构化粗剪。'}\n\n保留 ${segments.length} 段，生成 ${plan.markers.length} 个章节，成片速度 ${plan.speed}×。可在剪辑页使用撤销恢复。` }, ...items])
      setPanel('edit'); flash(`AI 粗剪已应用：${segments.length} 段 · ${plan.markers.length} 章节`)
    } catch (error) {
      const message = recordingStartError(error)
      setAiResults((items) => [{ id: Date.now(), label: 'AI 智能粗剪', text: message, error: true }, ...items])
      flash(message)
    } finally { setAiBusy('') }
  }

  const runAudioTranscription = async (): Promise<void> => {
    if (aiBusy || !recordingSessionId || !recordingHasAudio) return
    setAiBusy('AI 音频转写')
    try {
      const result = await island.transcribeRecordingSession(recordingSessionId, llmConfig, transcriptModel, transcriptLanguage)
      if (!result.ok || !result.segments?.length) throw new Error(result.error || '转写端点没有返回带时间戳文本')
      setTranscriptSegments(result.segments)
      const text = result.text || result.segments.map((item) => item.text).join('\n')
      setAiResults((items) => [{ id: Date.now(), label: `真实音频转写 · ${transcriptModel}`, text: `${result.segments!.length} 个时间戳片段\n\n${text}` }, ...items])
      flash(`转写完成：${result.segments.length} 个字幕片段`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAiResults((items) => [{ id: Date.now(), label: 'AI 音频转写', text: message, error: true }, ...items])
      flash(message)
    } finally { setAiBusy('') }
  }

  const saveTranscript = async (format: 'srt' | 'vtt'): Promise<void> => {
    if (!transcriptSegments.length) return
    const content = format === 'srt' ? recordingTranscriptToSrt(transcriptSegments) : recordingTranscriptToVtt(transcriptSegments)
    const result = await island.saveText(content, `${recordingName}_字幕`, format)
    if (result.ok) flash(`${format.toUpperCase()} 字幕已保存`)
    else flash(result.error || '字幕保存失败')
  }

  const copyText = (value: string): void => { void navigator.clipboard.writeText(value).then(() => flash('已复制')) }
  const labelStyle: React.CSSProperties = { ...text.overline(), fontSize: 9.5 }
  const controlRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
  const progress = exportProgress?.progress || 0
  const recordingAvailable = Boolean(recordingBlob || recordingSessionId)
  const timelineLaneWidth = Math.max(Math.round(760 * timelineZoom), Math.round(Math.max(1, elapsed) / 1000 * 24 * timelineZoom))
  const timelineTickTarget = Math.max(250, elapsed / Math.max(1, timelineLaneWidth / 84))
  const timelineTickMs = [250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 300_000].find((value) => value >= timelineTickTarget) || 600_000
  const timelineTicks = Array.from({ length: Math.floor(elapsed / timelineTickMs) + 1 }, (_, index) => index * timelineTickMs)
  const trimDuration = editSegments.length ? recordingSegmentsDuration(editSegments, elapsed, playbackRate) : Math.max(0, (trimEnd || elapsed) - trimStart)
  const exportMaxSize = exportResolution === '1080p' ? { width: 1920, height: 1080 } : exportResolution === '720p' ? { width: 1280, height: 720 } : recordingSize
  const exportScale = Math.min(1, exportMaxSize.width / recordingSize.width, exportMaxSize.height / recordingSize.height)
  const exportOutputSize = { width: Math.max(2, Math.round(recordingSize.width * exportScale / 2) * 2), height: Math.max(2, Math.round(recordingSize.height * exportScale / 2) * 2) }
  const hasExportEdits = editSegments.length !== 1
    || editSegments[0]?.startMs > 0
    || editSegments[0]?.endMs < elapsed
    || playbackRate !== 1
    || Boolean(editSettings.rotation || editSettings.flipHorizontal || editSettings.flipVertical || editSettings.muteAudio)
    || Boolean(editSettings.crop && Object.values(editSettings.crop).some((value) => value > 0))
    || Math.abs(editSettings.brightness || 0) > 0.001
    || Math.abs((editSettings.contrast || 1) - 1) > 0.001
    || Math.abs((editSettings.saturation || 1) - 1) > 0.001
    || Math.abs((editSettings.gamma || 1) - 1) > 0.001
    || Number(editSettings.sharpen) > 0
    || Number(editSettings.denoise) > 0
    || Math.abs((editSettings.audioVolume || 1) - 1) > 0.001
    || Number(editSettings.fadeInMs) > 0
    || Number(editSettings.fadeOutMs) > 0
    || exportResolution !== 'source'
    || exportFps !== 'source'
    || exportSubtitleMode === 'embedded'
  const estimatedMbPerMinute = recordingVideoBitrate(recordingSize.width, recordingSize.height, fps, captureQuality) * 60 / 8 / 1_000_000
  const windowSourceSelected = selectedSource?.kind === 'window'
  const cameraVisualReady = !webcam || (cameraEffect === 'avatar' ? Boolean(avatarDataUrl) : cameraDevices.length > 0)
  const cameraVisualStatus = !webcam
    ? '未启用摄像头画中画'
    : cameraEffect === 'avatar'
      ? (avatarDataUrl ? `替换形象已就绪：${avatarName}` : '请先导入替换形象')
      : cameraDevices.length
        ? `${cameraEffect === 'anime' ? '实时动漫渲染' : cameraEffect === 'cartoon' ? '实时卡通渲染' : '摄像头画中画'}已就绪`
        : '启动时检查摄像头权限'
  const paused = status === 'paused'
  const compactOverlay = compact && (status === 'recording' || status === 'paused') ? createPortal(
      <div data-recording-compact style={{ position: 'fixed', inset: 0, zIndex: 216, pointerEvents: 'none' }}>
        <motion.div
          aria-hidden
          animate={{ opacity: paused ? 0.42 : [0.48, 0.92, 0.48] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 0 2px ${paused ? sem.warn : sem.danger}, inset 0 0 22px ${semBg(paused ? sem.warn : sem.danger, 0.22)}` }}
        />
        <motion.div
          initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          style={{ position: 'absolute', left: '50%', top: 14, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderRadius: R.pill, color: '#fff', background: 'rgba(10,12,16,.86)', border: `0.5px solid ${semBg(paused ? sem.warn : sem.danger, 0.72)}`, boxShadow: `0 8px 24px rgba(0,0,0,.34), 0 0 18px ${semBg(paused ? sem.warn : sem.danger, 0.2)}`, backdropFilter: 'blur(16px)' }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 7, background: paused ? sem.warn : sem.danger, boxShadow: `0 0 9px ${paused ? sem.warn : sem.danger}` }} />
          <span style={{ fontSize: 10.5, fontWeight: 760 }}>{paused ? 'PAUSED' : 'REC'}</span>
          <span style={{ ...text.num(11), color: '#fff' }}>{formatRecordingTime(elapsed)}</span>
          <span style={{ color: 'rgba(255,255,255,.56)', fontSize: 9.5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recordingSourceLabel(selectedSource)}</span>
        </motion.div>
        <motion.div
          data-solid
          data-recording-control
          variants={overlayPop}
          initial="initial"
          animate="animate"
          onMouseDown={(event) => event.stopPropagation()}
          onDoubleClick={() => { setCompact(false); island.setIgnoreMouse(false) }}
          style={{
            position: 'absolute', left: '50%', bottom: 26, transform: 'translateX(-50%)',
            width: 'min(560px, calc(100vw - 32px))', minHeight: 64, pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px 9px 14px',
            ...surface.overlay(), borderRadius: R.overlay, border: `0.5px solid ${semBg(paused ? sem.warn : sem.danger, 0.52)}`,
            boxShadow: `0 18px 55px rgba(0,0,0,.46), 0 0 28px ${semBg(paused ? sem.warn : sem.danger, 0.12)}`
          }}
        >
          <motion.span
            animate={paused ? { opacity: 1, scale: 1 } : { opacity: [1, 0.45, 1], scale: [1, 1.18, 1] }}
            transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: 11, height: 11, flex: 'none', borderRadius: 11, background: paused ? sem.warn : sem.danger, boxShadow: `0 0 14px ${paused ? sem.warn : sem.danger}` }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span style={{ ...text.num(15), color: ink(1), minWidth: 48 }}>{formatRecordingTime(elapsed)}</span>
              <span style={{ color: paused ? sem.warn : sem.danger, fontSize: 11, fontWeight: 700 }}>{paused ? '录制已暂停' : '正在录制'}</span>
              <span style={{ ...text.faint(), fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recordingSourceLabel(selectedSource)}</span>
            </div>
            <div style={{ ...text.faint(), fontSize: 9.5, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><span style={{ color: paused ? sem.warn : health.level === 'critical' ? sem.danger : health.level === 'warning' ? sem.warn : sem.calm }}>{paused ? '采集已暂停' : health.message}</span><span>· {health.bitrateMbps.toFixed(1)} Mb/s · {recordingSize.width}×{recordingSize.height} · {fps} FPS · {formatBytes(recordedBytes)}</span></div>
          </div>
          {systemAudio && <IconButton icon={systemMuted ? VolumeX : Volume2} onClick={() => setSystemMuted((value) => !value)} title={systemMuted ? '恢复系统声音' : '静音系统声音'} size={30} />}
          {microphone && <IconButton icon={micMuted ? MicOff : Mic} onClick={() => setMicMuted((value) => !value)} title={micMuted ? '恢复麦克风' : '静音麦克风'} size={30} />}
          <IconButton icon={Plus} onClick={addMarker} title="添加章节标记" size={30} />
          <IconButton icon={paused ? Play : Pause} onClick={pauseRecording} title={paused ? '继续录制' : '暂停录制'} size={30} />
          <IconButton icon={Maximize2} onClick={() => { setCompact(false); island.setIgnoreMouse(false) }} title="展开录屏工坊" size={30} />
          <IconButton icon={CircleStop} onClick={stopRecording} title="结束并预览" size={32} style={{ color: '#fff', background: sem.danger }} />
        </motion.div>
      </div>,
      document.body
    ) : null
  return (
    <>
      {compactOverlay}
      <div data-recording-studio data-recording-active={status === 'recording' || status === 'paused' ? 'true' : undefined} onMouseDown={(event) => event.stopPropagation()} style={{ position: 'fixed', inset: 0, zIndex: 214, display: compact ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.58)', backdropFilter: 'blur(9px)' }}>
      <motion.div variants={overlayPop} initial="initial" animate="animate" style={{ width: 'min(1380px, 94vw)', height: 'min(860px, 88vh)', minHeight: 640, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...surface.overlay(), borderRadius: R.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 54, padding: `0 ${SP.md + 2}px`, borderBottom: `0.5px solid ${hairline(0.1)}` }}>
          <div style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: R.sm, color: sem.danger, background: semBg(sem.danger, 0.14) }}><Video size={15} /></div>
          <div>
            <div style={text.subtitle()}>截图工坊 · 专业录屏</div>
            <div style={{ ...text.faint(), fontSize: 9.5 }}>智能运镜 · 高清采集 · AI 后期 · 本地导出</div>
          </div>
          <Segmented value="record" onChange={(value) => { if (value === 'image' && !locked) onBack() }} style={{ marginLeft: 10 }} options={[
            { key: 'image', label: '截图', icon: ImageIcon },
            { key: 'record', label: '录屏', icon: Video }
          ]} />
          <span style={{ flex: 1 }} />
          {toast && <span style={{ color: toast.includes('失败') || toast.includes('错误') ? sem.danger : sem.calm, fontSize: FS.tiny, fontWeight: 600, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast}</span>}
          {(status === 'recording' || status === 'paused') && <IconButton icon={Minimize2} onClick={() => setCompact(true)} title="收起为悬浮录制控制条" size={28} />}
          <IconButton icon={X} onClick={onClose} disabled={locked} title={locked ? '请先结束录制' : '关闭'} size={28} />
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#090b0e' }}>
            <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden', padding: 24 }}>
              <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', position: 'relative' }}>
                {status === 'ready' && recordingUrl ? (
                  <video
                    ref={previewVideoRef}
                    src={recordingUrl}
                    controls
                    autoPlay
                    playsInline
                    onLoadedMetadata={(event) => {
                      const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration * 1000 : elapsed
                      if (duration > 0) {
                        setElapsed(duration); elapsedRef.current = duration
                        setTrimEnd((current) => current > 1 ? Math.min(current, duration) : duration)
                        setEditSegments((items) => items.length === 1 && items[0].startMs === 0 && items[0].endMs <= 1
                          ? [{ ...items[0], endMs: duration }]
                          : items)
                      }
                      event.currentTarget.playbackRate = playbackRate
                    }}
                    onTimeUpdate={(event) => {
                      const current = event.currentTarget.currentTime * 1000
                      setPreviewCurrentMs(current)
                      const end = activeSegment?.endMs || trimEnd
                      const start = activeSegment?.startMs ?? trimStart
                      if (end > start && current >= end) {
                        event.currentTarget.pause(); event.currentTarget.currentTime = start / 1000; setPreviewCurrentMs(start)
                      }
                    }}
                    onError={() => setPreviewError('录制已完成，但浏览器无法解码预览。可以先导出 MP4；若导出也失败，请重新录制。')}
                    style={{
                      maxWidth: '100%', maxHeight: '100%', borderRadius: R.lg, boxShadow: '0 18px 60px rgba(0,0,0,.54)', background: '#000',
                      filter: `brightness(${1 + (editSettings.brightness || 0)}) contrast(${editSettings.contrast || 1}) saturate(${editSettings.saturation || 1})`,
                      transform: `rotate(${editSettings.rotation || 0}deg) scaleX(${editSettings.flipHorizontal ? -1 : 1}) scaleY(${editSettings.flipVertical ? -1 : 1})`
                    }}
                  />
                ) : (
                  <canvas ref={canvasRef} data-recording-canvas data-preview-source-id={previewSourceId} style={locked
                    ? { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }
                    : { maxWidth: '100%', maxHeight: '100%', aspectRatio: `${recordingSize.width}/${recordingSize.height}`, borderRadius: R.lg, boxShadow: '0 18px 60px rgba(0,0,0,.54)', background: '#11151b' }} />
                )}
                {(status === 'idle' || status === 'error') && (
                  <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                    {status === 'idle' && selectedSource?.thumbnail ? (
                      <div style={{ position: 'absolute', inset: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                        <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'grid', placeItems: 'center', position: 'relative' }}>
                          <video ref={sourcePreviewVideoRef} muted playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
                          {(!sourcePreviewing || previewSourceId !== sourceId) && <>
                            <img src={selectedSource.thumbnail} alt="当前录制来源预览" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: R.lg, boxShadow: '0 16px 48px rgba(0,0,0,.48)' }} />
                            {regionLocator && <svg data-recording-region-locator viewBox={`0 0 ${regionLocator.width} ${regionLocator.height}`} preserveAspectRatio="xMidYMid meet" aria-label="实际录制区域定位框" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
                              <rect ref={regionLocatorRectRef} x={regionLocator.crop.x} y={regionLocator.crop.y} width={regionLocator.crop.width} height={regionLocator.crop.height} fill="rgba(0,0,0,.05)" stroke={sem.danger} strokeWidth={Math.max(2, regionLocator.width / 520)} vectorEffect="non-scaling-stroke" strokeDasharray="9 6" />
                            </svg>}
                          </>}
                          {sourcePreviewing && previewSourceId === sourceId && regionLocator && <div data-recording-region-minimap title="实时取景范围" style={{ position: 'absolute', left: 10, top: 10, width: 'min(190px, 32%)', aspectRatio: `${regionLocator.width}/${regionLocator.height}`, overflow: 'hidden', borderRadius: R.sm, background: '#080a0d', border: `0.5px solid ${hairline(0.28)}`, boxShadow: '0 8px 24px rgba(0,0,0,.42)', pointerEvents: 'none' }}>
                            <img src={selectedSource.thumbnail} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill', opacity: 0.86 }} />
                            <svg data-recording-region-locator viewBox={`0 0 ${regionLocator.width} ${regionLocator.height}`} preserveAspectRatio="none" aria-label="实时录制区域定位框" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden' }}>
                              <rect ref={regionLocatorRectRef} x={regionLocator.crop.x} y={regionLocator.crop.y} width={regionLocator.crop.width} height={regionLocator.crop.height} fill="rgba(255,50,68,.05)" stroke={sem.danger} strokeWidth={Math.max(2, regionLocator.width / 430)} vectorEffect="non-scaling-stroke" />
                            </svg>
                          </div>}
                          <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 6, pointerEvents: 'auto' }}>
                            <Button sm variant="tinted" icon={sourcePreviewing && previewSourceId === sourceId ? EyeOff : Eye} title="试播最终合成画面" onClick={() => sourcePreviewing && previewSourceId === sourceId ? stopSourcePreview() : void startSourcePreview()}>{sourcePreviewing && previewSourceId === sourceId ? '停止成片试播' : '试播最终画面'}</Button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '90%', color: ink(2), fontSize: 11 }}>
                          {selectedSource.appIcon ? <img src={selectedSource.appIcon} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} /> : selectedSource.kind === 'screen' ? <Monitor size={15} /> : <Square size={15} />}
                          <span style={{ fontWeight: 680 }}>{sourcePreviewing && previewSourceId === sourceId ? '最终成片画面：' : '来源缩略图：'}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recordingSourceLabel(selectedSource)}</span>{sourcePreviewing && previewSourceId === sourceId && <span style={{ color: sem.calm }}>{recordingSize.width}×{recordingSize.height}</span>}
                        </div>
                        {sourcePreviewError && <span style={{ color: sem.danger, fontSize: 10, maxWidth: '85%', textAlign: 'center' }}>{sourcePreviewError}</span>}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: ink(3) }}>
                        {status === 'error' ? <X size={36} strokeWidth={1.2} color={sem.danger} /> : <Monitor size={36} strokeWidth={1.2} />}
                        <span style={{ ...text.body(), color: status === 'error' ? sem.danger : ink(2) }}>{status === 'error' ? '录屏启动失败' : `没有可录制的${sourceKind === 'screen' ? '显示器' : '窗口'}`}</span>
                        <span style={{ ...text.faint(), fontSize: 10.5, maxWidth: 440, textAlign: 'center', lineHeight: 1.65 }}>{status === 'error' ? errorMessage : '恢复目标窗口并点击刷新；最小化或受保护的窗口无法直接捕获。'}</span>
                      </div>
                    )}
                  </div>
                )}
                {status === 'starting' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: ink(2) }}>
                    <RefreshCw size={28} color={accent()} style={{ animation: 'spin 1s linear infinite' }} />
                    <div style={{ ...text.subtitle(), color: ink(1) }}>{startupMessage || '正在启动录屏…'}</div>
                    <div style={{ ...text.faint(), fontSize: 10.5 }}>连接成功后会自动收起为悬浮控制条</div>
                  </div>
                )}
                {(status === 'recording' || status === 'paused') && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: ink(2) }}>
                    <div style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', borderRadius: '50%', border: `1px solid ${semBg(status === 'paused' ? sem.warn : sem.danger, 0.7)}`, background: semBg(status === 'paused' ? sem.warn : sem.danger, 0.09), boxShadow: `0 0 36px ${semBg(status === 'paused' ? sem.warn : sem.danger, 0.15)}` }}>
                      {status === 'paused' ? <Pause size={24} /> : <Video size={24} />}
                    </div>
                    <div style={{ ...text.title(), color: ink(1), fontVariantNumeric: 'tabular-nums' }}>{formatRecordingTime(elapsed)}</div>
                    <div style={{ color: status === 'paused' ? sem.warn : health.level === 'critical' ? sem.danger : health.level === 'warning' ? sem.warn : sem.calm, fontSize: 10.5 }}>{status === 'paused' ? '录制已暂停' : `${health.message} · ${health.bitrateMbps.toFixed(1)} Mb/s${health.droppedPercent > 0 ? ` · 丢帧 ${health.droppedPercent.toFixed(1)}%` : ''}`}</div>
                  </div>
                )}
                {status === 'ready' && previewError && (
                  <div style={{ position: 'absolute', left: 24, right: 24, bottom: 18, padding: '9px 12px', borderRadius: R.md, color: '#fff', background: 'rgba(150,24,35,.88)', fontSize: 10.5, lineHeight: 1.55 }}>{previewError}</div>
                )}
              </div>

              {(status === 'recording' || status === 'paused') && (
                <div style={{ position: 'absolute', left: 18, top: 16, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: R.pill, background: 'rgba(5,7,10,.72)', border: `0.5px solid ${status === 'paused' ? semBg(sem.warn, 0.55) : semBg(sem.danger, 0.6)}`, backdropFilter: 'blur(16px)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: status === 'paused' ? sem.warn : sem.danger, boxShadow: status === 'paused' ? 'none' : `0 0 10px ${sem.danger}` }} />
                  <span style={{ ...text.num(12), color: ink(1) }}>{formatRecordingTime(elapsed)}</span>
                  <span style={{ ...text.faint(), fontSize: 9.5 }}>{status === 'paused' ? '已暂停' : `${recordingSize.width}×${recordingSize.height} · ${fps} FPS`}</span>
                </div>
              )}
              {status === 'countdown' && countdown > 0 && (
                <motion.div key={countdown} initial={{ scale: 0.55, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ position: 'absolute', width: 112, height: 112, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(7,9,12,.82)', border: `2px solid ${sem.danger}`, color: '#fff', fontSize: 48, fontWeight: 750, boxShadow: `0 0 54px ${semBg(sem.danger, 0.35)}` }}>{countdown}</motion.div>
              )}
              {locked && selectedSource && (
                <div style={{ position: 'absolute', right: 18, top: 16, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: R.pill, background: 'rgba(5,7,10,.68)', color: ink(2), fontSize: 10.5 }}>
                  {selectedSource.kind === 'screen' ? <Monitor size={12} /> : <Square size={12} />}{recordingSourceLabel(selectedSource)}
                </div>
              )}
            </div>

            {panel === 'edit' && status === 'ready' && recordingAvailable ? (
              <div data-recording-timeline style={{ height: 212, flex: 'none', display: 'flex', flexDirection: 'column', borderTop: `0.5px solid rgba(255,255,255,.08)`, background: '#0d1015' }}>
                <div style={{ height: 38, flex: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', borderBottom: `0.5px solid rgba(255,255,255,.07)` }}>
                  <IconButton icon={Undo2} title="撤销 (Ctrl+Z)" size={27} disabled={!editHistory.length} onClick={undoEdit} />
                  <IconButton icon={Redo2} title="重做 (Ctrl+Y)" size={27} disabled={!editFuture.length} onClick={redoEdit} />
                  <span style={{ width: 0.5, height: 18, background: 'rgba(255,255,255,.1)', margin: '0 2px' }} />
                  <IconButton icon={Split} title="在播放头拆分视频片段" size={27} disabled={!activeSegment || videoTrackLocked} onClick={splitActiveSegment} />
                  <IconButton icon={Plus} title="在播放头添加章节" size={27} disabled={markerTrackLocked} onClick={addTimelineMarker} />
                  <IconButton icon={Magnet} title={timelineSnap ? '关闭帧与边界磁吸' : '开启帧与边界磁吸'} size={27} onClick={() => setTimelineSnap((value) => !value)} style={{ color: timelineSnap ? accent() : ink(3) }} />
                  <span style={{ marginLeft: 5, ...text.num(10), color: ink(1) }}>{formatRecordingTime(previewCurrentMs)}</span>
                  <span style={{ ...text.faint(), fontSize: 9 }}>／ {formatRecordingTime(elapsed)}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ ...text.faint(), fontSize: 9 }}>{editSegments.filter((item) => item.enabled !== false).length} 段 · {timeline.filter((item) => item.type === 'marker').length} 章节</span>
                  <IconButton icon={ZoomOut} title="缩小时间线" size={27} disabled={timelineZoom <= 0.5} onClick={() => setTimelineZoom((value) => Math.max(0.5, value / 1.5))} />
                  <span style={{ ...text.num(9), width: 31, textAlign: 'center' }}>{Math.round(timelineZoom * 100)}%</span>
                  <IconButton icon={ZoomIn} title="放大时间线" size={27} disabled={timelineZoom >= 8} onClick={() => setTimelineZoom((value) => Math.min(8, value * 1.5))} />
                </div>
                <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                  <div style={{ width: 92, flex: 'none', borderRight: `0.5px solid rgba(255,255,255,.08)`, background: '#10141a' }}>
                    <div style={{ height: 25, display: 'flex', alignItems: 'center', padding: '0 8px', color: 'rgba(255,255,255,.38)', fontSize: 8.5 }}>轨道</div>
                    <div style={{ height: 45, display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', borderTop: `0.5px solid rgba(255,255,255,.05)` }}><Layers size={12} color={accent()} /><span style={{ flex: 1, color: ink(2), fontSize: 9.5 }}>V1 画面</span><IconButton icon={videoTrackLocked ? Lock : Unlock} title={videoTrackLocked ? '解锁视频轨' : '锁定视频轨'} size={23} onClick={() => setVideoTrackLocked((value) => !value)} /></div>
                    <div style={{ height: 45, display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', borderTop: `0.5px solid rgba(255,255,255,.05)` }}><Volume2 size={12} color={sem.calm} /><span style={{ flex: 1, color: ink(2), fontSize: 9.5 }}>A1 音频</span><IconButton icon={editSettings.muteAudio ? VolumeX : Volume2} title={editSettings.muteAudio ? '恢复音频轨' : '静音音频轨'} size={23} disabled={!recordingHasAudio} onClick={() => { rememberEdit(); setEditSettings((current) => ({ ...current, muteAudio: !current.muteAudio })) }} /></div>
                    <div style={{ height: 45, display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', borderTop: `0.5px solid rgba(255,255,255,.05)` }}><Tag size={12} color={sem.warn} /><span style={{ flex: 1, color: ink(2), fontSize: 9.5 }}>M1 章节</span><IconButton icon={markerTrackLocked ? Lock : Unlock} title={markerTrackLocked ? '解锁章节轨' : '锁定章节轨'} size={23} onClick={() => setMarkerTrackLocked((value) => !value)} /></div>
                  </div>
                  <div className="ai-scroll" style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
                    <div style={{ width: timelineLaneWidth, minWidth: '100%', height: 160, position: 'relative' }}>
                      <div style={{ height: 25, position: 'relative', borderBottom: `0.5px solid rgba(255,255,255,.06)`, cursor: 'crosshair' }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); seekPreview(snapEditPoint((event.clientX - rect.left) / rect.width * elapsed)) }}>
                        {timelineTicks.map((at) => <span key={at} style={{ position: 'absolute', left: `${elapsed ? at / elapsed * 100 : 0}%`, top: 0, bottom: 0, borderLeft: `0.5px solid rgba(255,255,255,.13)`, color: 'rgba(255,255,255,.42)', fontSize: 8, paddingLeft: 3, whiteSpace: 'nowrap' }}>{formatRecordingTime(at)}</span>)}
                      </div>
                      <div data-timeline-video-lane style={{ height: 45, position: 'relative', borderBottom: `0.5px solid rgba(255,255,255,.05)`, background: 'rgba(255,255,255,.018)', cursor: 'crosshair' }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); seekPreview(snapEditPoint((event.clientX - rect.left) / rect.width * elapsed)) }}>
                        {editSegments.map((segment, index) => <button key={segment.id} onClick={(event) => { event.stopPropagation(); selectSegment(segment) }} title={`${segment.label || `片段 ${index + 1}`} · ${formatRecordingTime(segment.startMs)} - ${formatRecordingTime(segment.endMs)}`} style={{ position: 'absolute', left: `${elapsed ? segment.startMs / elapsed * 100 : 0}%`, width: `${elapsed ? Math.max(0.18, (segment.endMs - segment.startMs) / elapsed * 100) : 100}%`, top: 5, bottom: 5, padding: '0 9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', border: segment.id === activeSegment?.id ? `1.5px solid ${accent()}` : `0.5px solid ${hairline(0.22)}`, borderRadius: 5, color: segment.enabled === false ? ink(4) : '#fff', background: segment.enabled === false ? 'rgba(255,255,255,.04)' : index % 2 ? semBg(sem.calm, 0.38) : semBg(accent(), 0.44), fontFamily: 'inherit', fontSize: 8.5, cursor: videoTrackLocked ? 'not-allowed' : 'pointer' }}><span onPointerDown={(event) => beginTimelineTrim(event, segment, 'start')} title="拖动入点" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: videoTrackLocked ? 'not-allowed' : 'ew-resize', background: segment.id === activeSegment?.id ? accent(0.72, 0.72) : 'rgba(255,255,255,.16)' }} />{segment.label || `片段 ${index + 1}`}<span onPointerDown={(event) => beginTimelineTrim(event, segment, 'end')} title="拖动出点" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: videoTrackLocked ? 'not-allowed' : 'ew-resize', background: segment.id === activeSegment?.id ? accent(0.72, 0.72) : 'rgba(255,255,255,.16)' }} /></button>)}
                      </div>
                      <div style={{ height: 45, position: 'relative', borderBottom: `0.5px solid rgba(255,255,255,.05)`, cursor: 'crosshair' }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); seekPreview(snapEditPoint((event.clientX - rect.left) / rect.width * elapsed)) }}>
                        {recordingHasAudio && <div style={{ position: 'absolute', inset: '6px 0', borderRadius: 5, opacity: editSettings.muteAudio ? 0.28 : 1, background: `repeating-linear-gradient(90deg, ${semBg(sem.calm, 0.34)} 0 3px, ${semBg(sem.calm, 0.13)} 3px 7px)`, border: `0.5px solid ${semBg(sem.calm, 0.5)}` }} />}
                        {!recordingHasAudio && <span style={{ position: 'absolute', left: 8, top: 15, color: ink(4), fontSize: 8.5 }}>该录制没有音轨</span>}
                      </div>
                      <div style={{ height: 45, position: 'relative', cursor: 'crosshair' }} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); seekPreview(snapEditPoint((event.clientX - rect.left) / rect.width * elapsed)) }}>
                        {timeline.filter((item) => item.type === 'marker' || item.type === 'start').map((item, index) => <button key={`${item.type}-${item.at}-${index}`} onClick={(event) => { event.stopPropagation(); seekPreview(item.at) }} title={`${formatRecordingTime(item.at)} ${item.label}`} style={{ position: 'absolute', left: `${elapsed ? item.at / elapsed * 100 : 0}%`, top: 5, bottom: 5, maxWidth: 130, padding: '0 6px', border: `0.5px solid ${semBg(item.type === 'start' ? sem.calm : sem.warn, 0.68)}`, borderRadius: 5, color: item.type === 'start' ? sem.calm : sem.warn, background: semBg(item.type === 'start' ? sem.calm : sem.warn, 0.13), fontFamily: 'inherit', fontSize: 8, whiteSpace: 'nowrap', cursor: 'pointer', transform: item.at >= elapsed * 0.92 ? 'translateX(-100%)' : undefined }}>{item.label}</button>)}
                      </div>
                      <span style={{ position: 'absolute', left: `${elapsed ? previewCurrentMs / elapsed * 100 : 0}%`, top: 0, bottom: 0, width: 1.5, background: '#fff', boxShadow: '0 0 7px rgba(255,255,255,.65)', pointerEvents: 'none', zIndex: 4 }}><span style={{ position: 'absolute', left: -4, top: 0, width: 9, height: 7, clipPath: 'polygon(0 0,100% 0,50% 100%)', background: '#fff' }} /></span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ minHeight: 62, display: 'flex', alignItems: 'center', gap: 10, padding: `0 ${SP.md}px`, borderTop: `0.5px solid rgba(255,255,255,.07)`, background: '#0d1015' }}>
                <div style={{ minWidth: 136 }}><div style={{ color: 'rgba(255,255,255,.46)', fontSize: 9.5 }}>时间线</div><div style={{ color: '#fff', fontSize: 12, fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{formatRecordingTime(elapsed)} · {timeline.filter((item) => item.type === 'marker').length} 章节 · {keyframes.length} 关键帧</div></div>
                <div style={{ flex: 1, height: 20, position: 'relative', borderRadius: R.pill, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}><div style={{ position: 'absolute', inset: 0, width: status === 'recording' || status === 'paused' ? '100%' : `${Math.min(100, elapsed ? 100 : 0)}%`, background: `linear-gradient(90deg, ${accent(0.78, 0.72)}, ${sem.calm})`, opacity: 0.36 }} />{timeline.filter((item) => item.type === 'marker').map((item, index) => <span key={`${item.at}-${index}`} title={`${formatRecordingTime(item.at)} ${item.label}`} style={{ position: 'absolute', left: `${elapsed ? Math.min(99, item.at / elapsed * 100) : 0}%`, top: 3, width: 3, height: 14, borderRadius: 2, background: sem.warn }} />)}</div>
                {recordingAvailable && <span style={{ color: 'rgba(255,255,255,.55)', fontSize: 10.5 }}>{formatBytes(recordedBytes)}</span>}
              </div>
            )}
          </div>

          <div className="ai-scroll recording-sidebar" style={{ width: 420, flex: 'none', overflow: 'auto', borderLeft: `0.5px solid ${hairline(0.1)}`, padding: `${SP.md}px ${SP.md + 2}px`, display: 'flex', flexDirection: 'column', gap: 13 }}>
            <Segmented<PanelTab> value={panel} onChange={setPanel} options={[
              { key: 'capture', label: '采集', icon: Aperture },
              { key: 'motion', label: '运镜', icon: MousePointer2 },
              { key: 'edit', label: '剪辑', icon: Scissors },
              { key: 'ai', label: 'AI', icon: Sparkles },
              { key: 'project', label: '工程', icon: FolderKanban },
              { key: 'export', label: '导出', icon: Film }
            ]} />

            {panel === 'capture' && (
              <>
                {recoverableSessions.filter((session) => session.id !== recordingSessionId).length > 0 && <div style={{ ...surface.card(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(1), fontSize: 10.5, fontWeight: 680 }}><RefreshCw size={12} color={sem.warn} />可恢复录制</span><span style={{ ...text.num(9), color: sem.warn }}>{recoverableSessions.filter((session) => session.id !== recordingSessionId).length} 项</span></div>
                  {recoverableSessions.filter((session) => session.id !== recordingSessionId).slice(0, 3).map((session) => <div key={session.id} style={{ ...controlRow, minWidth: 0, padding: '6px 7px', borderRadius: R.sm, background: surface.inset().background }}>
                    <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: ink(2), fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.name}</div><div style={{ ...text.faint(), fontSize: 8.5 }}>{session.status === 'interrupted' ? '异常中断' : '已落盘'} · {formatBytes(session.bytes)} · {session.width}×{session.height}</div></div>
                    <Button sm variant="tinted" icon={Play} onClick={() => void restoreRecordingSession(session)}>恢复</Button>
                    <IconButton icon={Trash2} title="删除恢复记录" size={25} onClick={() => void discardRecordingSession(session.id)} />
                  </div>)}
                </div>}
                <div style={labelStyle}>录制场景预设</div>
                <Segmented value={recordingPreset} onChange={applyPreset} options={[{ key: 'tutorial', label: '教程' }, { key: 'meeting', label: '会议' }, { key: 'demo', label: '演示' }, { key: 'custom', label: '自定义' }]} />
                <div style={{ ...controlRow, justifyContent: 'space-between' }}>
                  <span style={labelStyle}>录制来源</span>
                  <IconButton icon={RefreshCw} title="刷新来源" size={25} onClick={() => void loadSources()} disabled={locked || loadingSources} />
                </div>
                <Segmented value={sourceKind} onChange={changeSourceKind} options={[
                  { key: 'screen', label: '显示器', icon: Monitor },
                  { key: 'window', label: '窗口', icon: Square }
                ]} />
                <Input value={sourceQuery} onChange={setSourceQuery} placeholder={sourceKind === 'screen' ? '搜索显示器' : '搜索窗口标题或应用'} icon={Search} />
                <div style={{ ...controlRow, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {sourceKind === 'screen' && <IconButton icon={Network} title="物理屏幕拓扑" size={26} onClick={() => setSourceView('topology')} style={{ color: sourceView === 'topology' ? accent() : ink(3) }} />}
                    <IconButton icon={LayoutGrid} title="缩略图网格" size={26} onClick={() => setSourceView('grid')} style={{ color: sourceView === 'grid' ? accent() : ink(3) }} />
                    <IconButton icon={List} title="紧凑列表" size={26} onClick={() => setSourceView('list')} style={{ color: sourceView === 'list' ? accent() : ink(3) }} />
                  </div>
                  <Chip active={sourceAvailableOnly} onClick={() => setSourceAvailableOnly((value) => !value)}>{sourceAvailableOnly ? '仅可录制' : '包含失效项'}</Chip>
                </div>
                {sourceView === 'topology' && sourceKind === 'screen' && displayTopology ? (
                  <div style={{ height: 174, position: 'relative', overflow: 'hidden', borderRadius: R.md, background: surface.inset().background, border: `0.5px solid ${hairline(0.12)}`, padding: 12 }}>
                    {displayTopology.items.map((source) => {
                      const bounds = source.bounds!
                      const left = (bounds.x - displayTopology.minX) / displayTopology.width * 82 + 4
                      const top = (bounds.y - displayTopology.minY) / displayTopology.height * 70 + 8
                      const width = Math.max(25, bounds.width / displayTopology.width * 82)
                      const height = Math.max(30, bounds.height / displayTopology.height * 70)
                      return <button key={source.id} data-recording-source-id={source.id} data-selected={source.id === sourceId || undefined} onClick={() => selectSource(source.id)} disabled={locked || source.available === false} title={`${source.displayLabel || source.name} · 坐标 ${bounds.x},${bounds.y} · ${bounds.width}×${bounds.height}`} style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, width: `${Math.min(width, 88 - left)}%`, height: `${Math.min(height, 82 - top)}%`, minHeight: 46, borderRadius: R.sm, overflow: 'hidden', border: source.id === sourceId ? `2px solid ${accent()}` : `0.5px solid ${hairline(0.2)}`, background: '#10141a', color: '#fff', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {source.thumbnail && <img src={source.thumbnail} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.42 }} />}
                        <span style={{ position: 'relative', display: 'grid', placeItems: 'center', height: '100%', padding: 5, fontSize: 9.5, fontWeight: 700, textShadow: '0 1px 4px #000' }}>{source.displayLabel?.split(' · ')[0] || source.name}<small style={{ fontSize: 8, fontWeight: 500 }}>{source.nativeSize?.width || bounds.width}×{source.nativeSize?.height || bounds.height}</small></span>
                      </button>
                    })}
                  </div>
                ) : (
                  <div style={{ display: sourceView === 'list' ? 'flex' : 'grid', flexDirection: 'column', gridTemplateColumns: '1fr 1fr', gap: 7, maxHeight: 222, overflow: 'auto' }} className="ai-scroll">
                    {visibleSources.map((source) => (
                      <button key={source.id} data-recording-source-id={source.id} data-selected={source.id === sourceId || undefined} disabled={locked || source.available === false} title={source.available === false ? source.unavailableReason : `选择 ${source.name}`} onClick={() => selectSource(source.id)} style={{ minWidth: 0, minHeight: sourceView === 'list' ? 48 : undefined, padding: 0, display: sourceView === 'list' ? 'flex' : 'block', overflow: 'hidden', cursor: locked || source.available === false ? 'not-allowed' : 'pointer', opacity: source.available === false ? 0.52 : 1, textAlign: 'left', borderRadius: R.md, border: sourceId === source.id ? `2px solid ${accent()}` : `0.5px solid ${hairline(0.14)}`, background: surface.inset().background, color: ink(1), fontFamily: 'inherit' }}>
                        <div style={{ width: sourceView === 'list' ? 78 : '100%', height: sourceView === 'list' ? 48 : 82, flex: 'none', position: 'relative', display: 'grid', placeItems: 'center', background: '#0b0d10' }}>
                          {source.thumbnail ? <img src={source.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : source.kind === 'screen' ? <Monitor size={20} /> : <AppWindow size={20} />}
                          {source.appIcon && <img src={source.appIcon} alt="" style={{ position: 'absolute', left: 5, bottom: 5, width: 18, height: 18, padding: 2, borderRadius: 5, objectFit: 'contain', background: 'rgba(5,7,10,.78)' }} />}
                          {sourceId === source.id && <span style={{ position: 'absolute', right: 5, top: 5, display: 'grid', placeItems: 'center', width: 17, height: 17, borderRadius: 9, color: '#fff', background: accent() }}><Check size={10} strokeWidth={3} /></span>}
                        </div>
                        <div style={{ padding: sourceView === 'list' ? '7px 8px' : '6px 7px', minWidth: 0, flex: 1 }}><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ flex: 1, fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recordingSourceLabel(source)}</div><span role="button" title={sourceFavorites.includes(source.name) ? '取消收藏' : '收藏来源'} onClick={(event) => { event.stopPropagation(); toggleSourceFavorite(source.name) }} style={{ display: 'grid', placeItems: 'center', color: sourceFavorites.includes(source.name) ? sem.warn : ink(4) }}><Star size={12} fill={sourceFavorites.includes(source.name) ? 'currentColor' : 'none'} /></span></div>{source.displayLabel && <div style={{ ...text.faint(), fontSize: 8.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.name}</div>}{source.available === false && <div style={{ color: sem.warn, fontSize: 8.5, marginTop: 2 }}>当前不可录制</div>}</div>
                      </button>
                    ))}
                    {!visibleSources.length && <div style={{ gridColumn: '1 / -1', padding: '24px 8px', textAlign: 'center', color: ink(3), fontSize: 10.5 }}>{sourceQuery ? '没有匹配的录制来源' : sourceAvailableOnly ? '没有可录制来源，可切换查看失效项' : '没有检测到录制来源'}</div>}
                  </div>
                )}
                {selectedSource && <div style={{ ...surface.inset(), padding: '8px 9px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}><div style={{ color: ink(2), fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recordingSourceLabel(selectedSource)}</div><span data-preview-bound={previewSourceId === selectedSource.id || undefined} style={{ color: selectedSource.available === false ? sem.warn : sem.calm, fontSize: 9 }}>{selectedSource.available === false ? '不可用' : sourcePreviewing && previewSourceId === selectedSource.id ? '实时试播中' : sourcePreviewWantedRef.current ? '正在切换画面' : '已就绪'}</span><div style={{ ...text.faint(), gridColumn: '1 / -1', fontSize: 9 }}>{selectedSource.nativeSize ? `${selectedSource.nativeSize.width}×${selectedSource.nativeSize.height} 原生 · ` : ''}{selectedSource.scaleFactor ? `${Math.round(selectedSource.scaleFactor * 100)}% DPI · ` : ''}{selectedSource.bounds ? `坐标 ${selectedSource.bounds.x}, ${selectedSource.bounds.y}` : '窗口捕获'}</div></div>}
                <div style={{ height: 0.5, background: hairline(0.09) }} />
                <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>分辨率</span><Segmented value={resolution} onChange={setResolution} style={{ flex: 1 }} options={[{ key: 'source', label: '原生' }, { key: '1080p', label: '1080P' }, { key: '1440p', label: '2K' }, { key: '4k', label: '4K' }]} /></div>
                <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>画面比例</span><Segmented value={aspect} onChange={setAspect} style={{ flex: 1 }} options={[{ key: 'source', label: '跟随源' }, { key: '16:9', label: '横屏' }, { key: '9:16', label: '竖屏' }, { key: '1:1', label: '方形' }]} /></div>
                <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>适配方式</span><Segmented value={fitMode} onChange={setFitMode} style={{ flex: 1 }} options={[{ key: 'contain', label: '完整显示' }, { key: 'cover', label: '铺满画面' }]} /></div>
                <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>帧率</span>{[24, 30, 60].map((value) => <Chip key={value} active={fps === value} onClick={() => !locked && setFps(value)}>{value} FPS</Chip>)}</div>
                <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>画质</span>{(['standard', 'high', 'ultra'] as const).map((value) => <Chip key={value} active={captureQuality === value} onClick={() => !locked && setCaptureQuality(value)}>{value === 'standard' ? '标准' : value === 'high' ? '高清' : '极清'}</Chip>)}</div>
                <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 11 }}><Crop size={13} />自定义录制区域</span><Switch on={regionEnabled} onChange={(on) => {
                    setRegionEnabled(on)
                    if (on && !sourcePreviewing) window.setTimeout(() => void startSourcePreview(), 0)
                  }} /></div>
                  {regionEnabled && <>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 34 }}>左侧</span><Slider min={0} max={0.45} step={0.01} value={region.left} onChange={(value) => setRegion((current) => ({ ...current, left: value }))} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(region.left * 100)}%</span></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 34 }}>右侧</span><Slider min={0} max={0.45} step={0.01} value={region.right} onChange={(value) => setRegion((current) => ({ ...current, right: value }))} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(region.right * 100)}%</span></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 34 }}>顶部</span><Slider min={0} max={0.45} step={0.01} value={region.top} onChange={(value) => setRegion((current) => ({ ...current, top: value }))} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(region.top * 100)}%</span></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 34 }}>底部</span><Slider min={0} max={0.45} step={0.01} value={region.bottom} onChange={(value) => setRegion((current) => ({ ...current, bottom: value }))} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(region.bottom * 100)}%</span></div>
                    <Button sm variant="ghost" icon={RefreshCw} onClick={() => setRegion({ left: 0, top: 0, right: 0, bottom: 0 })}>重置区域</Button>
                  </>}
                </div>
                <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 11 }}><Volume2 size={13} />系统声音</span><Switch on={systemAudio} onChange={setSystemAudio} /></div>
                  {systemAudio && <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>系统音量</span><Slider min={0} max={2} step={0.05} value={systemGain} onChange={setSystemGain} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(systemGain * 100)}%</span></div>}
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 11 }}><Mic size={13} />麦克风降噪</span><Switch on={microphone} onChange={setMicrophone} /></div>
                  {microphone && micDevices.length > 0 && <select value={micDeviceId} onChange={(event) => setMicDeviceId(event.target.value)} disabled={locked} style={{ width: '100%', height: 30, border: 0, outline: 0, borderRadius: R.sm, padding: '0 8px', background: surface.card().background, color: ink(1), fontFamily: 'inherit', fontSize: 10.5 }}><option value="">系统默认麦克风</option>{micDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${device.deviceId.slice(0, 5)}`}</option>)}</select>}
                  {microphone && <>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>麦克风音量</span><Slider min={0} max={2} step={0.05} value={micGain} onChange={setMicGain} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(micGain * 100)}%</span></div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}><Chip active={noiseSuppression} onClick={() => setNoiseSuppression((value) => !value)}>环境降噪</Chip><Chip active={echoCancellation} onClick={() => setEchoCancellation((value) => !value)}>回声消除</Chip><Chip active={autoGainControl} onClick={() => setAutoGainControl((value) => !value)}>自动增益</Chip></div>
                  </>}
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 11 }}><Camera size={13} />摄像头画中画</span><Switch on={webcam} onChange={(on) => { setWebcam(on); if (!on) stopPersonaPreview() }} /></div>
                  {webcam && <>
                    <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...text.faint(), width: 52 }}>人物呈现</span><Segmented value={cameraEffect} onChange={setCameraEffect} style={{ flex: 1 }} options={[{ key: 'original', label: '原始' }, { key: 'anime', label: '动漫' }, { key: 'cartoon', label: '卡通' }, { key: 'avatar', label: '换装' }]} /></div>
                    {cameraEffect !== 'avatar' && cameraDevices.length > 0 && <select value={cameraDeviceId} onChange={(event) => { stopPersonaPreview(); setCameraDeviceId(event.target.value) }} disabled={locked} style={{ width: '100%', height: 30, border: 0, outline: 0, borderRadius: R.sm, padding: '0 8px', background: surface.card().background, color: ink(1), fontFamily: 'inherit', fontSize: 10.5 }}><option value="">系统默认摄像头</option>{cameraDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || `摄像头 ${device.deviceId.slice(0, 5)}`}</option>)}</select>}
                    {(cameraEffect === 'anime' || cameraEffect === 'cartoon') && <>
                      <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>{cameraEffect === 'anime' ? '手绘强度' : '卡通强度'}</span><Slider min={0.25} max={1} step={0.05} value={animeStrength} onChange={setAnimeStrength} style={{ flex: 1 }} /><span style={text.num(9.5)}>{Math.round(animeStrength * 100)}%</span></div>
                      <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>角色色调</span>{(['natural', 'warm', 'cool'] as const).map((value) => <Chip key={value} active={animePalette === value} onClick={() => !locked && setAnimePalette(value)}>{value === 'natural' ? '自然' : value === 'warm' ? '暖色' : '冷色'}</Chip>)}</div>
                      <Segmented value={neuralModel} onChange={selectNeuralModel} options={[{ key: 'handdrawn', label: '强手绘' }, { key: 'portrait', label: '柔和人像' }, { key: 'comic', label: '漫画' }]} />
                      <div style={{ ...surface.card(), padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ ...controlRow, minWidth: 0 }}><Bot size={12} color={neuralState.status === 'ready' ? sem.calm : neuralState.status === 'error' ? sem.danger : accent()} /><span style={{ color: ink(2), fontSize: 10, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{neuralModelName}</span><span style={{ ...text.num(9), color: neuralState.status === 'ready' ? sem.calm : ink(3) }}>{neuralState.status === 'ready' ? neuralState.provider : neuralState.status === 'loading' ? '加载中' : neuralState.status === 'error' ? '异常' : '待加载'}</span></div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}><Button sm variant="tinted" icon={Sparkles} disabled={locked || neuralState.status === 'loading'} onClick={() => void ensureNeuralStyle().catch((error) => setPersonaPreviewError(recordingStartError(error)))}>加载内置模型</Button><Button sm variant="ghost" icon={Upload} disabled={locked} onClick={() => void selectLocalFiles('.onnx').then((files) => importNeuralModel(files[0]))}>导入 ONNX</Button></div>
                        {neuralState.error && <div style={{ color: sem.danger, fontSize: 9, lineHeight: 1.45 }}>{neuralState.error}</div>}
                      </div>
                      <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.5 }}>{cameraEffect === 'anime' ? '本地神经网络重绘整个人像，强调柔和块面、手绘轮廓与自然肤色。' : '先进行神经人像重绘，再叠加强色阶与粗轮廓。'} 摄像头帧不会上传。</div>
                    </>}
                    {cameraEffect === 'avatar' && <>
                      <div style={{ ...controlRow, minHeight: 44 }}>
                        <div style={{ width: 40, height: 40, flex: 'none', overflow: 'hidden', display: 'grid', placeItems: 'center', borderRadius: cameraFrame === 'circle' ? '50%' : R.sm, background: surface.card().background, color: ink(3) }}>{avatarDataUrl ? <img src={avatarDataUrl} alt="替换形象预览" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserRound size={18} />}</div>
                        <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: ink(2), fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{avatarName || '尚未导入人物形象'}</div><div style={{ ...text.faint(), fontSize: 9 }}>PNG 透明背景效果最佳 · 最大 12 MB</div></div>
                        <Button sm variant="tinted" icon={Upload} disabled={locked} onClick={() => void chooseAvatar()}>{avatarDataUrl ? '替换' : '导入'}</Button>
                        {avatarDataUrl && <IconButton icon={X} title="移除替换形象" size={27} disabled={locked} onClick={() => { avatarImageRef.current = null; setAvatarDataUrl(''); setAvatarName(''); setCameraEffect('original'); setWebcam(false); void deleteRecordingAvatar().catch(() => {}) }} />}
                      </div>
                      <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...text.faint(), width: 52 }}>形象动效</span><Segmented value={avatarMotion} onChange={setAvatarMotion} style={{ flex: 1 }} options={[{ key: 'still', label: '静态' }, { key: 'breathe', label: '呼吸' }, { key: 'lively', label: '灵动' }]} /></div>
                    </>}
                    {personaPreviewing && <canvas ref={personaPreviewCanvasRef} data-persona-preview style={{ width: '100%', maxHeight: 176, objectFit: 'contain', borderRadius: R.md, background: '#10141a' }} />}
                    {personaPreviewError && <div style={{ color: sem.danger, fontSize: 9.5, lineHeight: 1.5 }}>{personaPreviewError}</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <Button sm variant="tinted" icon={personaPreviewing ? CircleStop : Play} disabled={locked} onClick={() => personaPreviewing ? stopPersonaPreview() : void startPersonaPreview()}>{personaPreviewing ? '停止人物预览' : '预览人物效果'}</Button>
                      <Button sm variant="ghost" icon={Eye} disabled={locked} onClick={() => { stopPersonaPreview(); setPanel('capture'); if (!sourcePreviewing) window.setTimeout(() => void startSourcePreview(), 0) }}>在最终画面中查看</Button>
                    </div>
                    <Segmented value={cameraPosition} onChange={setCameraPosition} options={[{ key: 'top-left', label: '左上' }, { key: 'top-right', label: '右上' }, { key: 'bottom-left', label: '左下' }, { key: 'bottom-right', label: '右下' }]} />
                    <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...text.faint(), width: 52 }}>人物画框</span><Segmented value={cameraFrame} onChange={setCameraFrame} style={{ flex: 1 }} options={[{ key: 'rounded', label: '圆角卡片' }, { key: 'circle', label: '圆形头像' }]} /></div>
                    <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...text.faint(), width: 52 }}>镜像人物</span><Switch on={cameraMirror} onChange={setCameraMirror} /></div>
                    <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...text.faint(), width: 52 }}>人物边框</span><Segmented value={cameraBorder} onChange={setCameraBorder} style={{ flex: 1 }} options={[{ key: 'light', label: '亮边' }, { key: 'accent', label: '主题色' }, { key: 'none', label: '无' }]} /></div>
                    <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...text.faint(), width: 52 }}>人物阴影</span><Switch on={cameraShadow} onChange={setCameraShadow} /></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 48 }}>画面大小</span><Slider min={0.12} max={0.34} step={0.02} value={cameraSize} onChange={setCameraSize} style={{ flex: 1 }} /><span style={text.num(9.5)}>{Math.round(cameraSize * 100)}%</span></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 48 }}>人物透明</span><Slider min={0.35} max={1} step={0.05} value={cameraOpacity} onChange={setCameraOpacity} style={{ flex: 1 }} /><span style={text.num(9.5)}>{Math.round(cameraOpacity * 100)}%</span></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 48 }}>边缘距离</span><Slider min={0.006} max={0.08} step={0.004} value={cameraMargin} onChange={setCameraMargin} style={{ flex: 1 }} /><span style={text.num(9.5)}>{Math.round(cameraMargin * 100)}%</span></div>
                  </>}
                </div>
                <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>倒计时</span>{[0, 3, 5, 10].map((value) => <Chip key={value} active={countdownSeconds === value} onClick={() => !locked && setCountdownSeconds(value)}>{value ? `${value}s` : '关闭'}</Chip>)}</div>
                <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ ...controlRow, color: ink(2), fontSize: 11 }}><Timer size={13} />自动停止与分段</div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>时长上限</span>{[0, 5, 15, 30].map((value) => <Chip key={value} active={maxDurationMinutes === value} onClick={() => setMaxDurationMinutes(value)}>{value ? `${value}分` : '不限'}</Chip>)}</div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>大小上限</span>{[0, 250, 500, 1000].map((value) => <Chip key={value} active={maxFileSizeMb === value} onClick={() => setMaxFileSizeMb(value)}>{value ? `${value >= 1000 ? '1GB' : `${value}M`}` : '不限'}</Chip>)}</div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>自动章节</span>{[0, 30, 60, 300].map((value) => <Chip key={value} active={autoMarkerSeconds === value} onClick={() => setAutoMarkerSeconds(value)}>{value ? `${value >= 60 ? `${value / 60}分` : `${value}秒`}` : '关闭'}</Chip>)}</div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>关键帧</span>{[5, 10, 15, 30].map((value) => <Chip key={value} active={keyframeIntervalSeconds === value} onClick={() => setKeyframeIntervalSeconds(value)}>{value}秒</Chip>)}</div>
                </div>
                <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ ...controlRow, color: ink(2), fontSize: 11 }}><Layers size={13} />成片叠加层</div>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><Tag size={12} />显示来源名称</span><Switch on={showSourceLabel} onChange={setShowSourceLabel} /></div>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><Clock3 size={12} />显示录制时间</span><Switch on={showTimestamp} onChange={setShowTimestamp} /></div>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><Type size={12} />文字水印</span><Switch on={watermarkEnabled} onChange={setWatermarkEnabled} /></div>
                  {watermarkEnabled && <><Input value={watermarkText} onChange={setWatermarkText} placeholder="输入水印文字" /><Segmented value={watermarkPosition} onChange={setWatermarkPosition} options={[{ key: 'top-left', label: '左上' }, { key: 'top-right', label: '右上' }, { key: 'bottom-left', label: '左下' }, { key: 'bottom-right', label: '右下' }]} /><div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>透明度</span><Slider min={0.2} max={1} step={0.05} value={watermarkOpacity} onChange={setWatermarkOpacity} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(watermarkOpacity * 100)}%</span></div></>}
                  <div style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><EyeOff size={12} />隐私遮挡条</div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>顶部遮挡</span><Slider min={0} max={0.3} step={0.01} value={privacyTop} onChange={setPrivacyTop} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(privacyTop * 100)}%</span></div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 52 }}>底部遮挡</span><Slider min={0} max={0.3} step={0.01} value={privacyBottom} onChange={setPrivacyBottom} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round(privacyBottom * 100)}%</span></div>
                </div>
                <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={labelStyle}>录制前检查</span><span style={{ ...text.num(9.5), color: sem.calm }}>约 {estimatedMbPerMinute.toFixed(0)} MB/分钟</span></div>
                  <div style={{ ...controlRow, color: selectedSource ? ink(2) : sem.danger, fontSize: 10 }}><Check size={11} color={selectedSource ? sem.calm : sem.danger} />{selectedSource ? `来源已就绪：${recordingSourceLabel(selectedSource)}` : '请选择录制来源'}</div>
                  <div style={{ ...controlRow, color: ink(2), fontSize: 10 }}><Check size={11} color={sem.calm} />{selectRecorderMime((mime) => MediaRecorder.isTypeSupported(mime)).replace('video/webm;codecs=', '').toUpperCase()} 编码器可用</div>
                  <div style={{ ...controlRow, color: microphone && !micDevices.length ? sem.warn : ink(2), fontSize: 10 }}><Check size={11} color={microphone && !micDevices.length ? sem.warn : sem.calm} />{microphone ? (micDevices.length ? '麦克风已检测' : '启动时检查麦克风权限') : '未启用麦克风'}</div>
                  <div style={{ ...controlRow, color: cameraVisualReady ? ink(2) : sem.warn, fontSize: 10 }}><Check size={11} color={cameraVisualReady ? sem.calm : sem.warn} />{cameraVisualStatus}</div>
                  <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.55 }}>开始后自动收起为悬浮控制条；控制条之外恢复点击穿透，可直接演示桌面内容。</div>
                </div>
              </>
            )}

            {panel === 'motion' && (
              <>
                <div style={labelStyle}>鼠标跟随智能运镜</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
                  {(['off', 'gentle', 'dynamic'] as const).map((value) => {
                    const active = (windowSourceSelected ? 'off' : motionMode) === value
                    return <button key={value} disabled={locked || windowSourceSelected} onClick={() => setMotionMode(value)} style={{ height: 64, borderRadius: R.md, border: active ? `2px solid ${accent()}` : `0.5px solid ${hairline(0.14)}`, background: active ? semBg(accent(), 0.13) : surface.inset().background, color: active ? accent() : ink(2), opacity: windowSourceSelected && value !== 'off' ? 0.42 : 1, fontFamily: 'inherit', cursor: locked || windowSourceSelected ? 'not-allowed' : 'pointer' }}><MousePointer2 size={17} /><div style={{ fontSize: 10.5, marginTop: 5 }}>{value === 'off' ? '固定画面' : value === 'gentle' ? '柔和聚焦' : '动态跟随'}</div></button>
                  })}
                </div>
                {windowSourceSelected ? (
                  <div style={{ ...surface.inset(), minHeight: 54, padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 9 }}><Lock size={14} color={sem.warn} /><div><div style={{ color: ink(1), fontSize: 11.5, fontWeight: 650 }}>窗口捕获 · 固定构图</div><div style={{ ...text.faint(), fontSize: 9.5, marginTop: 3 }}>裁剪、比例、画中画与叠加层保持生效</div></div></div>
                ) : <>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 56 }}>跟随速度</span><Slider min={0.15} max={1} step={0.05} value={motionStrength} onChange={setMotionStrength} style={{ flex: 1 }} /><span style={text.num(10)}>{Math.round(motionStrength * 100)}%</span></div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 56 }}>最大放大</span><Slider min={1.08} max={1.8} step={0.02} value={maxZoom} onChange={setMaxZoom} style={{ flex: 1 }} /><span style={text.num(10)}>{maxZoom.toFixed(2)}×</span></div>
                  <div style={{ ...controlRow, justifyContent: 'space-between', padding: '8px 0' }}><span style={{ ...controlRow, color: ink(2), fontSize: 11 }}><Zap size={13} />鼠标焦点光晕</span><Switch on={cursorHalo} onChange={setCursorHalo} /></div>
                  {cursorHalo && <>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 56 }}>光晕大小</span><Slider min={0.06} max={0.24} step={0.01} value={cursorHaloSize} onChange={setCursorHaloSize} style={{ flex: 1 }} /><span style={text.num(10)}>{Math.round(cursorHaloSize * 100)}%</span></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 56 }}>光晕颜色</span>{(['gold', 'blue', 'white'] as const).map((value) => <Chip key={value} active={cursorHaloColor === value} onClick={() => setCursorHaloColor(value)}>{value === 'gold' ? '金色' : value === 'blue' ? '蓝色' : '白色'}</Chip>)}</div>
                    <div style={{ ...controlRow, justifyContent: 'space-between', padding: '5px 0' }}><span style={{ ...controlRow, color: ink(2), fontSize: 11 }}><MousePointer2 size={13} />鼠标轨迹</span><Switch on={cursorTrail} onChange={setCursorTrail} /></div>
                  </>}
                  <div style={{ ...surface.inset(), padding: '11px 12px' }}>
                    <div style={{ color: ink(1), fontSize: 11.5, fontWeight: 650 }}>运镜引擎实时工作</div>
                    <div style={{ ...text.faint(), fontSize: 10, lineHeight: 1.65, marginTop: 5 }}>根据鼠标位置、移动速度和显示器边界平滑调整裁剪中心。快速移动时自动减弱放大，停留操作时聚焦内容，避免突跳和晕动。</div>
                  </div>
                  <div style={labelStyle}>已启用增强</div>
                  {['边缘约束与越界保护', '速度自适应缩放', '高阶平滑插值', '录制面板防捕获', `${keyframeIntervalSeconds} 秒自动关键帧`, '章节标记回填时间线'].map((item) => <div key={item} style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><Check size={12} color={sem.calm} />{item}</div>)}
                </>}
              </>
            )}

            {panel === 'edit' && (
              <>
                {!recordingAvailable ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, padding: '44px 10px', color: ink(3), textAlign: 'center' }}><Scissors size={30} strokeWidth={1.25} /><span style={text.body()}>结束录制后进入剪辑工作台</span><span style={{ ...text.faint(), fontSize: 10 }}>多片段剪辑、画面校正、音频处理与工程文件导出</span></div>
                ) : <>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={labelStyle}>非破坏性时间线</span><span style={{ ...text.num(10), color: sem.calm }}>{formatRecordingTime(trimDuration)} 成片 · {editSegments.filter((item) => item.enabled !== false).length} 段</span></div>
                  <div onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); seekPreview((event.clientX - rect.left) / rect.width * elapsed) }} style={{ height: 44, position: 'relative', borderRadius: R.sm, background: surface.inset().background, overflow: 'hidden', cursor: 'crosshair' }}>
                    {editSegments.map((segment, index) => <button key={segment.id} title={`${segment.label || `片段 ${index + 1}`} · ${formatRecordingTime(segment.startMs)}-${formatRecordingTime(segment.endMs)}`} onClick={(event) => { event.stopPropagation(); selectSegment(segment) }} style={{ position: 'absolute', left: `${segment.startMs / elapsed * 100}%`, width: `${Math.max(0.5, (segment.endMs - segment.startMs) / elapsed * 100)}%`, top: 7, bottom: 7, border: segment.id === activeSegment?.id ? `2px solid ${accent()}` : `0.5px solid ${hairline(0.2)}`, borderRadius: 5, background: segment.enabled === false ? surface.card().background : index % 2 ? semBg(sem.calm, 0.38) : semBg(accent(), 0.42), opacity: segment.enabled === false ? 0.42 : 1, cursor: 'pointer' }} />)}
                    <span style={{ position: 'absolute', left: `${elapsed ? previewCurrentMs / elapsed * 100 : 0}%`, top: 2, bottom: 2, width: 2, background: '#fff', boxShadow: '0 0 5px rgba(0,0,0,.7)', pointerEvents: 'none' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 132, overflow: 'auto' }} className="ai-scroll">
                    {editSegments.map((segment, index) => <button key={segment.id} onClick={() => selectSegment(segment)} style={{ minHeight: 32, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', border: segment.id === activeSegment?.id ? `1px solid ${accent()}` : 0, borderRadius: R.sm, background: surface.inset().background, color: ink(2), fontFamily: 'inherit', cursor: 'pointer', opacity: segment.enabled === false ? 0.48 : 1 }}><span style={{ width: 17, height: 17, display: 'grid', placeItems: 'center', borderRadius: 5, background: semBg(accent(), 0.17), color: accent(), fontSize: 8 }}>{index + 1}</span><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', fontSize: 10 }}>{segment.label || `片段 ${index + 1}`}</span><span style={{ ...text.num(9) }}>{formatRecordingTime(segment.endMs - segment.startMs)}</span><span role="switch" title={segment.enabled === false ? '启用片段' : '暂不导出'} onClick={(event) => { event.stopPropagation(); toggleSegmentEnabled(segment.id) }}><Eye size={12} /></span></button>)}
                  </div>
                  {activeSegment && <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ ...controlRow, justifyContent: 'space-between' }}><Input value={activeSegment.label || ''} onChange={(label) => updateActiveSegment({ label })} placeholder="片段名称" style={{ flex: 1 }} /><IconButton icon={Split} title="在播放头拆分" size={27} onClick={splitActiveSegment} /><IconButton icon={Trash2} title="删除片段" size={27} onClick={deleteActiveSegment} /></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 30 }}>入点</span><Slider min={0} max={Math.max(1000, elapsed)} step={Math.max(1, 1000 / fps)} value={activeSegment.startMs} onChange={(value) => updateActiveSegment({ startMs: Math.min(snapEditPoint(value, activeSegment.id), activeSegment.endMs - 100) })} style={{ flex: 1 }} /><span style={text.num(9)}>{formatRecordingTime(activeSegment.startMs)}</span></div>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 30 }}>出点</span><Slider min={0} max={Math.max(1000, elapsed)} step={Math.max(1, 1000 / fps)} value={activeSegment.endMs} onChange={(value) => updateActiveSegment({ endMs: Math.max(activeSegment.startMs + 100, snapEditPoint(value, activeSegment.id)) })} style={{ flex: 1 }} /><span style={text.num(9)}>{formatRecordingTime(activeSegment.endMs)}</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}><Button sm variant="tinted" icon={Play} onClick={playTrimmedPreview}>播放片段</Button><Button sm variant="ghost" icon={RefreshCw} onClick={resetEdits}>重置全部</Button></div>
                  </div>}
                  <div style={labelStyle}>成片速度</div>
                  <Segmented value={String(playbackRate)} onChange={(value) => { const rate = Number(value); setPlaybackRate(rate); patchEditSettings({ speed: rate }); if (previewVideoRef.current) previewVideoRef.current.playbackRate = rate }} options={[{ key: '0.5', label: '0.5×' }, { key: '1', label: '1×' }, { key: '1.25', label: '1.25×' }, { key: '1.5', label: '1.5×' }, { key: '2', label: '2×' }]} />
                  <div style={labelStyle}>画面变换</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}><Button sm variant="tinted" icon={RotateCw} onClick={() => patchEditSettings({ rotation: (((editSettings.rotation || 0) + 90) % 360) as 0 | 90 | 180 | 270 })}>{editSettings.rotation || 0}°</Button><IconButton icon={FlipHorizontal2} title="水平翻转" onClick={() => patchEditSettings({ flipHorizontal: !editSettings.flipHorizontal })} style={{ color: editSettings.flipHorizontal ? accent() : ink(3) }} /><IconButton icon={FlipVertical2} title="垂直翻转" onClick={() => patchEditSettings({ flipVertical: !editSettings.flipVertical })} style={{ color: editSettings.flipVertical ? accent() : ink(3) }} /><Button sm variant="ghost" icon={Camera} onClick={() => void savePreviewFrame()}>截帧</Button></div>
                  <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><Crop size={12} />成片裁切</span><span style={text.num(9)}>{Math.round(((editSettings.crop?.left || 0) + (editSettings.crop?.right || 0)) * 100)}% 横向</span></div>
                    {(['left', 'right', 'top', 'bottom'] as const).map((edge) => <div key={edge} style={controlRow}><span style={{ ...text.faint(), width: 28 }}>{edge === 'left' ? '左' : edge === 'right' ? '右' : edge === 'top' ? '上' : '下'}</span><Slider min={0} max={0.4} step={0.01} value={editSettings.crop?.[edge] || 0} onChange={(value) => patchEditSettings({ crop: { left: 0, top: 0, right: 0, bottom: 0, ...editSettings.crop, [edge]: value } })} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round((editSettings.crop?.[edge] || 0) * 100)}%</span></div>)}
                  </div>
                  <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><SlidersHorizontal size={12} />画面校正与增强</div>
                    {([
                      ['亮度', 'brightness', -0.5, 0.5, 0.01, 0], ['对比度', 'contrast', 0.5, 2, 0.05, 1], ['饱和度', 'saturation', 0, 2, 0.05, 1], ['伽马', 'gamma', 0.5, 2, 0.05, 1], ['锐化', 'sharpen', 0, 2, 0.1, 0], ['降噪', 'denoise', 0, 10, 0.5, 0]
                    ] as const).map(([label, key, min, max, step, fallback]) => <div key={key} style={controlRow}><span style={{ ...text.faint(), width: 38 }}>{label}</span><Slider min={min} max={max} step={step} value={Number(editSettings[key] ?? fallback)} onChange={(value) => patchEditSettings({ [key]: value })} style={{ flex: 1 }} /><span style={{ ...text.num(9), width: 26, textAlign: 'right' }}>{Number(editSettings[key] ?? fallback).toFixed(1)}</span></div>)}
                  </div>
                  {recordingHasAudio && <div style={{ ...surface.inset(), padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}><div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><Volume2 size={12} />音频后期</span><Switch on={!editSettings.muteAudio} onChange={(on) => patchEditSettings({ muteAudio: !on })} /></div><div style={controlRow}><span style={{ ...text.faint(), width: 38 }}>音量</span><Slider min={0} max={2} step={0.05} value={editSettings.audioVolume ?? 1} onChange={(value) => patchEditSettings({ audioVolume: value })} style={{ flex: 1 }} /><span style={text.num(9)}>{Math.round((editSettings.audioVolume ?? 1) * 100)}%</span></div><div style={controlRow}><span style={{ ...text.faint(), width: 38 }}>淡入</span><Slider min={0} max={3000} step={100} value={editSettings.fadeInMs || 0} onChange={(value) => patchEditSettings({ fadeInMs: value })} style={{ flex: 1 }} /><span style={text.num(9)}>{((editSettings.fadeInMs || 0) / 1000).toFixed(1)}s</span></div><div style={controlRow}><span style={{ ...text.faint(), width: 38 }}>淡出</span><Slider min={0} max={3000} step={100} value={editSettings.fadeOutMs || 0} onChange={(value) => patchEditSettings({ fadeOutMs: value })} style={{ flex: 1 }} /><span style={text.num(9)}>{((editSettings.fadeOutMs || 0) / 1000).toFixed(1)}s</span></div></div>}
                  <div style={labelStyle}>章节与工程资产</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 150, overflow: 'auto' }} className="ai-scroll">
                    {timeline.filter((item) => item.type === 'marker' || item.type === 'start').map((item, index) => <div key={`${item.type}-${item.at}-${index}`} style={{ minHeight: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', borderRadius: R.sm, background: surface.inset().background }}><button onClick={() => seekPreview(item.at)} style={{ border: 0, background: 'transparent', color: accent(), ...text.num(9.5), cursor: 'pointer' }}>{formatRecordingTime(item.at)}</button><Input value={item.label} onChange={(label) => updateTimelineItem(item, { label })} style={{ flex: 1 }} />{item.type === 'marker' && <IconButton icon={Trash2} title="删除章节" size={23} disabled={markerTrackLocked} onClick={() => deleteTimelineItem(item)} />}</div>)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}><Button sm variant="ghost" icon={Save} onClick={() => void persistRecordingProject(true)}>立即保存</Button><Button sm variant="ghost" icon={List} onClick={() => void saveChapterFile()}>章节文件</Button><Button sm variant="ghost" icon={Layers} onClick={() => void saveContactSheet()}>分镜图</Button><Button sm variant="ghost" icon={Camera} onClick={() => void savePreviewFrame()}>当前帧</Button></div>
                  {keyframes.length > 0 && <><div style={labelStyle}>关键帧导航</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>{keyframes.slice(-9).map((frame, index) => <button key={`${frame.at}-${index}`} data-recording-keyframe-at={Math.round(frame.at)} onClick={() => seekPreview(frame.at)} title={formatRecordingTime(frame.at)} style={{ padding: 0, border: `0.5px solid ${hairline(0.14)}`, borderRadius: R.sm, overflow: 'hidden', background: '#080a0d', cursor: 'pointer' }}><img src={frame.dataUrl} alt="" style={{ display: 'block', width: '100%', aspectRatio: '16/9', objectFit: 'cover' }} /></button>)}</div></>}
                </>}
              </>
            )}

            {panel === 'ai' && (
              <>
                {!llmReady && <div style={{ padding: '9px 11px', borderRadius: R.md, color: sem.warn, background: semBg(sem.warn, 0.13), fontSize: 10.5, lineHeight: 1.55 }}>请先在设置中配置支持图片输入的模型。</div>}
                <div style={{ ...surface.card(), padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(1), fontSize: 11.5, fontWeight: 700 }}><Sparkles size={13} color={accent()} />AI 智能粗剪</span><span style={{ ...text.num(9), color: keyframes.length ? sem.calm : sem.warn }}>{keyframes.length} 帧证据</span></div>
                  <Segmented value={aiEditMode} onChange={setAiEditMode} options={[{ key: 'conservative', label: '保守整理' }, { key: 'tutorial', label: '教程精简' }, { key: 'dynamic', label: '节奏增强' }]} />
                  <Button variant="primary" icon={WandSparkles} disabled={!llmReady || !!aiBusy || !recordingAvailable || !keyframes.length} onClick={() => void runAIAutoEdit()}>{aiBusy === 'AI 智能粗剪' ? '正在分析并生成时间线' : '生成并应用粗剪方案'}</Button>
                  <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.55 }}>根据关键帧与现有章节生成真实片段、章节、速度和基础画面校正。操作非破坏，可在剪辑页一步撤销；不会把画面推断冒充语音转写。</div>
                </div>
                <div style={{ ...surface.card(), padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(1), fontSize: 11.5, fontWeight: 700 }}><Volume2 size={13} color={sem.calm} />真实音频转写</span><span style={{ ...text.num(9), color: transcriptSegments.length ? sem.calm : ink(3) }}>{transcriptSegments.length} 字幕段</span></div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 44 }}>模型</span><Input value={transcriptModel} onChange={(value) => { setTranscriptModel(value); localStorage.setItem('recording-transcript-model', value) }} placeholder="whisper-1" style={{ flex: 1 }} /></div>
                  <Segmented value={transcriptLanguage} onChange={setTranscriptLanguage} options={[{ key: 'auto', label: '自动识别' }, { key: 'zh', label: '中文' }, { key: 'en', label: '英文' }]} />
                  <Button variant="tinted" icon={FileText} disabled={!!aiBusy || !recordingSessionId || !recordingHasAudio || !llmConfig.apiKey || !llmConfig.baseUrl || !transcriptModel.trim()} onClick={() => void runAudioTranscription()}>{aiBusy === 'AI 音频转写' ? '正在提取并转写音轨' : transcriptSegments.length ? '重新转写音轨' : '提取音轨并生成字幕'}</Button>
                  {transcriptSegments.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}><Button sm variant="ghost" icon={Download} onClick={() => void saveTranscript('srt')}>导出 SRT</Button><Button sm variant="ghost" icon={Download} onClick={() => void saveTranscript('vtt')}>导出 VTT</Button></div>}
                  <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.55 }}>音频先在本地切分压缩，再发送到所配置端点的 `/audio/transcriptions`。转写模型与聊天模型独立；端点不兼容时会返回原始错误。</div>
                </div>
                <div style={labelStyle}>录制前导演</div>
                <Button sm variant="tinted" icon={WandSparkles} disabled={!llmReady || !!aiBusy} onClick={() => void runAI('AI 导演包', '一次性输出：受众与目标、建议时长、逐镜头提纲、口播结构、演示数据准备、隐私预检和录前检查单。结果必须具体且可直接执行。')}>生成完整导演包</Button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{AI_ACTIONS.filter((action) => action.phase === 'plan').map((action) => <Chip key={action.key} icon={WandSparkles} onClick={() => void runAI(action.label, action.prompt)} style={{ opacity: llmReady && !aiBusy ? 1 : 0.4 }}>{action.label}</Chip>)}</div>
                <div style={labelStyle}>录制后分析</div>
                <Button sm variant="primary" icon={Sparkles} disabled={!llmReady || !!aiBusy || !keyframes.length} onClick={() => void runAI('AI 后期总检', '一次性完成成片后期分析：准确标题、摘要、章节建议、隐私与安全风险、画面质检、剪辑点、SOP、行动项、发布简介和封面建议。每部分分标题输出，无法从画面确认的内容必须标注。')}>运行 AI 后期总检</Button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{AI_ACTIONS.filter((action) => action.phase === 'post').map((action) => <Chip key={action.key} icon={Bot} onClick={() => void runAI(action.label, action.prompt)} style={{ opacity: llmReady && !aiBusy && keyframes.length ? 1 : 0.4 }}>{action.label}</Chip>)}</div>
                {aiBusy && <div style={{ ...controlRow, color: accent(), fontSize: 10.5 }}><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />{aiBusy}正在分析关键帧…</div>}
                {aiResults.map((result) => <motion.div key={result.id} variants={fadeScaleIn} initial="initial" animate="animate" style={result.error ? { padding: '9px 10px', borderRadius: R.md, background: semBg(sem.danger, 0.12) } : { ...surface.card(), padding: '9px 10px' }}>
                  <div style={{ ...controlRow, marginBottom: 6 }}><span style={{ color: result.error ? sem.danger : accent(), fontSize: 11, fontWeight: 700 }}>{result.label}</span><span style={{ flex: 1 }} />{!result.error && <><IconButton icon={ListChecks} size={23} title="转待办" onClick={() => onCreateTodo(result.text)} /><IconButton icon={FileText} size={23} title="存便签" onClick={() => onCreateNote(result.label, result.text)} /><IconButton icon={Copy} size={23} title="复制" onClick={() => copyText(result.text)} /></>}</div>
                  <div className="ai-scroll" style={{ color: result.error ? sem.danger : ink(1), fontSize: 10.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{result.text}</div>
                </motion.div>)}
              </>
            )}

            {panel === 'project' && (
              <>
                <div style={{ ...surface.card(), padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(1), fontSize: 11.5, fontWeight: 700 }}><FolderKanban size={13} color={accent()} />当前工程</span><span style={{ ...text.num(9), color: projectSaveState === 'error' ? sem.danger : projectSaveState === 'saved' ? sem.calm : projectSaveState === 'saving' ? sem.warn : ink(3) }}>{projectSaveState === 'saved' ? '已自动保存' : projectSaveState === 'saving' ? '保存中' : projectSaveState === 'error' ? '保存失败' : '等待素材'}</span></div>
                  {recordingAvailable ? <>
                    <div style={controlRow}><span style={{ ...text.faint(), width: 44 }}>名称</span><Input value={recordingName} onChange={setRecordingName} style={{ flex: 1 }} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                      <div style={{ ...surface.inset(), padding: '7px 8px' }}><div style={text.faint()}>片段</div><div style={{ ...text.num(11), marginTop: 3 }}>{editSegments.length}</div></div>
                      <div style={{ ...surface.inset(), padding: '7px 8px' }}><div style={text.faint()}>章节</div><div style={{ ...text.num(11), marginTop: 3 }}>{timeline.filter((item) => item.type === 'marker').length}</div></div>
                      <div style={{ ...surface.inset(), padding: '7px 8px' }}><div style={text.faint()}>字幕</div><div style={{ ...text.num(11), marginTop: 3 }}>{transcriptSegments.length}</div></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}><Button sm variant="primary" icon={Save} onClick={() => void persistRecordingProject(true)}>保存工程</Button><Button sm variant="tinted" icon={Download} onClick={() => void exportRecordingProjectFile()}>导出 JSON</Button></div>
                    <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.55 }}>编辑变化会在 1 秒后自动写入本地工程库。工程文件只保存非破坏编辑参数，原始视频继续由录制素材库管理。</div>
                  </> : <div style={{ ...text.faint(), padding: '12px 2px', textAlign: 'center' }}>完成或恢复一段落盘录制后即可建立工程</div>}
                </div>
                <div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={labelStyle}>工程库</span><span style={{ ...text.num(9), color: ink(3) }}>{recordingProjects.length} 项</span></div>
                <div className="ai-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 430, overflow: 'auto' }}>
                  {!recordingProjects.length && <div style={{ padding: '34px 10px', color: ink(3), textAlign: 'center' }}><FolderKanban size={28} strokeWidth={1.25} /><div style={{ ...text.body(), marginTop: 8 }}>暂无可继续编辑的工程</div></div>}
                  {recordingProjects.map((project) => <div key={project.id} style={{ ...surface.card(), padding: '9px 9px 8px', display: 'flex', flexDirection: 'column', gap: 7, outline: project.id === projectId ? `1px solid ${accent(0.72, 0.55)}` : undefined }}>
                    <div style={{ ...controlRow, minWidth: 0 }}><div style={{ minWidth: 0, flex: 1 }}><div style={{ color: ink(1), fontSize: 10.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</div><div style={{ ...text.faint(), fontSize: 8.5, marginTop: 2 }}>{new Date(project.updatedAt).toLocaleString()} · {formatRecordingTime(project.durationMs)}</div></div>{project.id === projectId && <Chip active>当前</Chip>}</div>
                    <div style={{ ...controlRow, color: ink(3), fontSize: 9 }}><span>{project.width}×{project.height}</span><span>·</span><span>{project.segmentCount} 片段</span><span>·</span><span>{project.transcriptCount} 字幕</span><span style={{ flex: 1 }} /></div>
                    <div style={{ ...controlRow }}><Button sm variant="tinted" icon={Play} onClick={() => void openRecordingProject(project)}>继续编辑</Button><span style={{ flex: 1 }} /><IconButton icon={Copy} title="创建工程副本" size={25} onClick={() => void duplicateRecordingProject(project.id)} /><IconButton icon={Trash2} title={project.id === projectId ? '当前工程不能删除' : '删除工程记录'} size={25} disabled={project.id === projectId} onClick={() => void deleteRecordingProject(project)} /></div>
                  </div>)}
                </div>
              </>
            )}

            {panel === 'export' && (
              <>
                {!recordingAvailable ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, padding: '44px 10px', color: ink(3), textAlign: 'center' }}><Film size={30} strokeWidth={1.25} /><span style={text.body()}>完成录制后可导出视频或 GIF</span><span style={{ ...text.faint(), fontSize: 10 }}>支持原始流、体积优化、视觉无损和无损归档</span></div> : <>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 46 }}>名称</span><Input value={recordingName} onChange={setRecordingName} style={{ flex: 1 }} /></div>
                  <div style={controlRow}><span style={{ ...text.faint(), width: 46 }}>格式</span><Segmented value={format} onChange={(value) => { setFormat(value); if (value !== 'webm' && exportQuality === 'original') setExportQuality('balanced'); if (value === 'gif' || value === 'mp3') setExportSubtitleMode('none') }} style={{ flex: 1 }} options={[{ key: 'mp4', label: 'MP4' }, { key: 'webm', label: 'WebM' }, { key: 'gif', label: 'GIF' }, { key: 'mp3', label: 'MP3' }]} /></div>
                  <div style={labelStyle}>压缩策略</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {format === 'webm' && !hasExportEdits && <Chip active={exportQuality === 'original'} onClick={() => setExportQuality('original')}>原始极速</Chip>}
                    <Chip active={exportQuality === 'compact'} onClick={() => setExportQuality('compact')}>小体积</Chip>
                    <Chip active={exportQuality === 'balanced'} onClick={() => setExportQuality('balanced')}>均衡</Chip>
                    <Chip active={exportQuality === 'near-lossless'} onClick={() => setExportQuality('near-lossless')}>{format === 'mp3' ? '320 kbps' : '视觉无损'}</Chip>
                    {format === 'webm' && <Chip active={exportQuality === 'lossless'} onClick={() => setExportQuality('lossless')}>无损归档</Chip>}
                  </div>
                  {format !== 'mp3' && <><div style={labelStyle}>输出画面</div><div style={controlRow}><Segmented value={exportResolution} onChange={setExportResolution} style={{ flex: 1 }} options={[{ key: 'source', label: '源分辨率' }, { key: '1080p', label: '1080p' }, { key: '720p', label: '720p' }]} /><Segmented value={exportFps} onChange={setExportFps} style={{ flex: 1 }} options={[{ key: 'source', label: `${fps}fps` }, { key: '30', label: '30' }, { key: '24', label: '24' }, { key: '15', label: '15' }]} /></div></>}
                  {(format === 'mp4' || format === 'webm') && <div style={{ ...surface.inset(), padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 7 }}><div style={{ ...controlRow, justifyContent: 'space-between' }}><span style={{ ...controlRow, color: ink(2), fontSize: 10.5 }}><Type size={12} />字幕轨</span><span style={{ ...text.num(9), color: transcriptSegments.length ? sem.calm : ink(3) }}>{transcriptSegments.length} 段</span></div><Segmented value={exportSubtitleMode} onChange={setExportSubtitleMode} options={[{ key: 'none', label: '不内嵌' }, { key: 'embedded', label: '内嵌可开关' }]} /><div style={{ ...text.faint(), fontSize: 9 }}>MP4 使用 mov_text，WebM 使用 WebVTT；字幕会按剪辑片段和播放速度自动重排时间码。</div></div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ ...surface.inset(), padding: '8px 10px' }}><div style={labelStyle}>源文件</div><div style={{ ...text.num(11), marginTop: 4 }}>{formatBytes(recordedBytes)}</div></div>
                    <div style={{ ...surface.inset(), padding: '8px 10px' }}><div style={labelStyle}>{format === 'mp3' ? '音频' : '输出画面'}</div><div style={{ ...text.num(11), marginTop: 4 }}>{format === 'mp3' ? (recordingHasAudio ? '包含音轨' : '无可用音轨') : `${exportOutputSize.width} × ${exportOutputSize.height}`}</div></div>
                    <div style={{ ...surface.inset(), padding: '8px 10px' }}><div style={labelStyle}>导出片段</div><div style={{ ...text.num(11), marginTop: 4 }}>{formatRecordingTime(trimDuration)}</div></div>
                    <div style={{ ...surface.inset(), padding: '8px 10px' }}><div style={labelStyle}>编码</div><div style={{ ...text.num(11), marginTop: 4 }}>{format === 'gif' ? 'Palette GIF' : format === 'mp4' ? 'H.264 / AAC' : format === 'mp3' ? 'MP3 Audio' : 'VP9 / Opus'}</div></div>
                  </div>
                  {exporting && <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><div style={{ ...controlRow }}><Gauge size={13} color={accent()} /><span style={{ color: ink(2), fontSize: 10.5 }}>{exportProgress?.message || '正在本地转码'}</span><span style={{ marginLeft: 'auto', ...text.num(10) }}>{Math.round(progress * 100)}%</span></div><div style={{ height: 5, borderRadius: R.pill, background: surface.inset().background, overflow: 'hidden' }}><div style={{ width: `${progress * 100}%`, height: '100%', background: accent(), transition: 'width .2s ease' }} /></div></div>}
                  <Button variant="primary" icon={Save} onClick={() => void exportRecording()} disabled={exporting || (format === 'mp3' && !recordingHasAudio) || (exportSubtitleMode === 'embedded' && !transcriptSegments.length)}>{exporting ? '正在导出' : `导出 ${format.toUpperCase()}`}</Button>
                  {exporting && <Button variant="ghost" icon={X} onClick={() => exportProgress && island.cancelRecordingExport(exportProgress.jobId)}>取消转码</Button>}
                  <div style={{ ...text.faint(), fontSize: 9.5, lineHeight: 1.6 }}>{trimDuration < elapsed ? `将按启用片段输出 ${formatRecordingTime(trimDuration)} 成片。` : ''}{format === 'gif' ? 'GIF 使用两阶段调色板与差分抖动，适合短演示。' : format === 'mp3' ? 'MP3 会沿用片段、速度、音量和淡入淡出设置。' : exportQuality === 'lossless' ? '无损归档保留每个视频像素，文件可能大于视觉无损版本。' : '可独立控制分辨率、帧率与可开关字幕轨；小体积适合聊天和文档附件。'}</div>
                </>}
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 60, padding: `0 ${SP.md + 2}px`, borderTop: `0.5px solid ${hairline(0.1)}` }}>
          <div style={{ minWidth: 220, ...text.faint(), fontSize: 10.5 }}>
            {status === 'idle' && selectedSource
              ? `开始后自动收起控制条 · ${recordingSourceLabel(selectedSource)} · ${resolution === 'source' ? '原生分辨率' : resolution.toUpperCase()} · ${fps} FPS`
              : selectedSource ? `${recordingSourceLabel(selectedSource)} · ${resolution === 'source' ? '原生分辨率' : resolution.toUpperCase()} · ${fps} FPS` : '等待选择录制来源'}
          </div>
          <span style={{ flex: 1 }} />
          {(status === 'idle' || status === 'error') && <Button variant="primary" icon={Play} onClick={() => void startRecording()} disabled={!selectedSource || loadingSources} style={{ background: sem.danger, color: '#fff' }}>开始录制</Button>}
          {status === 'countdown' && <Button variant="ghost" icon={X} onClick={cancelCountdown}>取消倒计时</Button>}
          {status === 'starting' && <Button variant="ghost" icon={RefreshCw} disabled>正在启动录屏</Button>}
          {(status === 'recording' || status === 'paused') && <><Button variant="ghost" icon={Plus} onClick={addMarker}>章节标记</Button><Button variant="ghost" icon={status === 'paused' ? Play : Pause} onClick={pauseRecording}>{status === 'paused' ? '继续' : '暂停'}</Button><Button variant="primary" icon={CircleStop} onClick={stopRecording} style={{ background: sem.danger, color: '#fff' }}>结束录制</Button></>}
          {status === 'ready' && <><Button variant="ghost" icon={RefreshCw} onClick={resetRecording}>重新录制</Button><Button variant="ghost" icon={Scissors} onClick={() => setPanel('edit')}>剪辑与预览</Button><Button variant="primary" icon={Save} onClick={() => setPanel('export')}>导出设置</Button></>}
        </div>
      </motion.div>
      </div>
    </>
  )
}
