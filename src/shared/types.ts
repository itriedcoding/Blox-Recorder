/**
 * Shared domain model used by the main process (recording, FFmpeg export) and the
 * renderer (recording UI, preview canvas, timeline). Everything here is plain
 * JSON-serialisable data so projects can be stored and piped through IPC.
 */

export type Theme = 'dark' | 'light'

export type ShortcutAction =
  | 'startStopRecording'
  | 'pauseResumeRecording'
  | 'screenshot'
  | 'openEditor'
  | 'newProject'
  | 'saveProject'
  | 'exportVideo'

export type EncoderKind = 'auto' | 'nvidia' | 'intel' | 'amd' | 'cpu'

export interface EffectsSettings {
  /** Master switch for every cursor/keyboard effect. */
  enabled: boolean
  cursorHighlight: boolean
  clickRipples: boolean
  clickSounds: boolean
  keyboardSounds: boolean
  smoothCursor: boolean
  zoomOnClick: boolean
  /** 0..1 visual intensity multiplier. */
  intensity: number
  /** 0..1 effect audio volume. */
  volume: number
  pack: SoundPackId
  cursorSize: number
  cursorColor: string
  rippleColor: string
}

export type SoundPackId = 'soft' | 'mechanical' | 'crisp'

export interface AppSettings {
  theme: Theme
  /** Empty string means "use the app default location in the user's Videos folder". */
  recordingsDir: string
  projectsDir: string
  screenshotsDir: string
  /** Empty string means "use the bundled ffmpeg binary". */
  ffmpegPath: string
  /** Empty string means "use the bundled ffprobe binary". */
  ffprobePath: string
  countdownSeconds: number
  defaultFps: number
  defaultResolution: ResolutionPreset
  encoder: EncoderKind
  recordingFormat: 'mp4' | 'mkv'
  captureInputEvents: boolean
  /** Explicit user consent for global mouse/keyboard event capture. */
  inputCaptureConsent: boolean
  autoSaveSeconds: number
  hardwareMonitor: boolean
  effects: EffectsSettings
  shortcuts: Record<ShortcutAction, string>
  lastPresetId: string
}

export type ResolutionPreset = 'native' | '720p' | '1080p' | '1440p' | '4k'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MonitorInfo {
  id: string
  label: string
  bounds: Bounds
  workArea: Bounds
  scaleFactor: number
  primary: boolean
}

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  displayId: string | null
  appIcon: string | null
  thumbnail: string | null
  width: number
  height: number
  bounds: Bounds
}

export interface AudioDevice {
  id: string
  label: string
  kind: 'input' | 'output'
}

export interface WebcamSettings {
  enabled: boolean
  deviceId: string | null
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** Fraction of the output width used by the webcam bubble (0.06 - 0.4). */
  size: number
  mirrored: boolean
  shape: 'circle' | 'rounded' | 'square'
  /** Device-space crop centre offset in normalised units. */
  offsetX: number
  offsetY: number
}

export interface RegionSelection {
  enabled: boolean
  /** Normalised to the captured source: 0..1 */
  x: number
  y: number
  width: number
  height: number
}

export interface RecordingPreset {
  id: string
  name: string
  fps: number
  resolution: ResolutionPreset
  micDeviceId: string | null
  systemAudio: boolean
  webcam: WebcamSettings
  format: 'mp4' | 'mkv'
  quality: 'low' | 'medium' | 'high' | 'ultra'
  effects: EffectsSettings
  region: RegionSelection
  countdown: number
}

export interface RecordingRequest {
  /** desktopCapturer source id, e.g. "screen:0:0" or "window:12345:0". */
  sourceId: string
  sourceKind: 'screen' | 'window'
  sourceName: string
  sourceWidth: number
  sourceHeight: number
  sourceBounds: Bounds
  targetWidth: number
  targetHeight: number
  fps: number
  micDeviceId: string | null
  micGain: number
  systemAudio: boolean
  systemGain: number
  webcam: WebcamSettings
  region: RegionSelection
  effects: EffectsSettings
  countdown: number
  format: 'mp4' | 'mkv'
  quality: 'low' | 'medium' | 'high' | 'ultra'
  captureInput: boolean
  monitorBounds: Bounds
  monitorScaleFactor: number
}

export type RecordingPhase = 'idle' | 'countdown' | 'recording' | 'paused' | 'finalizing' | 'completed' | 'error'

export interface RecordingSession {
  id: string
  dir: string
  startedAt: number
  phase: RecordingPhase
  request: RecordingRequest
  rawPath: string
  eventsPath: string
  error: string | null
}

export interface RecorderStatus {
  phase: RecordingPhase
  session: RecordingSession | null
  elapsedMs: number
  pausedMs: number
  bytes: number
  fps: number
  droppedFrames: number
  cpuPercent: number
  memoryMB: number
  outputPath: string | null
  error: string | null
  countdownRemaining: number
}

export interface RecoveryEntry {
  id: string
  dir: string
  rawPath: string
  createdAt: string
  sizeBytes: number
  request: RecordingRequest | null
  state: 'interrupted' | 'finalized'
}

export interface RecordingResult {
  sessionId: string
  outputPath: string
  rawPath: string
  durationMs: number
  width: number
  height: number
  fps: number
  sizeBytes: number
  eventsPath: string
  events: InputEventRecord[]
  request: RecordingRequest
  startedAt: number
}

export interface LibraryRecording {
  path: string
  name: string
  sizeBytes: number
  createdAt: string
  durationMs: number
  width: number
  height: number
  fps: number
  thumbnail: string | null
  projectId: string | null
}

/* ------------------------------- input events ------------------------------ */

/**
 * Compact capture of real OS input events. `t` is milliseconds since the first
 * recorded frame; `x`/`y` are normalised (0..1) inside the captured source rect.
 * No key characters are ever stored for typing sounds -- only a coarse key id.
 */
export interface InputEventRecord {
  t: number
  type: 'move' | 'down' | 'up'
  x: number
  y: number
  button?: number
  keyId?: number
}

export interface InputCaptureState {
  available: boolean
  active: boolean
  reason: string | null
  consent: boolean
  eventCount: number
}

/* --------------------------------- project -------------------------------- */

export interface Vec2 {
  x: number
  y: number
}

export interface CropRect {
  /** Normalised crop origin and size within the source frame (0..1). */
  x: number
  y: number
  width: number
  height: number
}

export interface ClipTransform {
  /** Pan offset in normalised canvas units (-0.5..0.5). */
  x: number
  y: number
  /** Zoom factor, 1 = fit. */
  scale: number
  rotation: number
  opacity: number
}

export interface TextStyle {
  content: string
  fontFamily: string
  fontSize: number
  color: string
  background: string
  padding: number
  align: 'left' | 'center' | 'right'
  bold: boolean
  italic: boolean
  shadow: boolean
}

export interface ZoomEffect {
  enabled: boolean
  /** Extra zoom at the peak, e.g. 0.25 = 125%. */
  amount: number
  focus: Vec2
  ease: 'linear' | 'easeInOut'
  /** Seconds to hold the peak zoom before easing back. */
  hold: number
}

/** Transitions that are implemented identically in the preview and in FFmpeg. */
export type TransitionType = 'dissolve' | 'fade'

export interface TransitionEffect {
  type: TransitionType
  duration: number
}

export type ClipKind = 'video' | 'audio' | 'image' | 'text'

export interface Clip {
  id: string
  trackId: string
  kind: ClipKind
  name: string
  sourcePath: string | null
  /** Timeline position in seconds. */
  start: number
  /** Timeline length in seconds (already divided by speed). */
  duration: number
  /** Source in-point in seconds. */
  inPoint: number
  speed: number
  volume: number
  fadeIn: number
  fadeOut: number
  muted: boolean
  crop: CropRect | null
  transform: ClipTransform
  text: TextStyle | null
  zoom: ZoomEffect | null
  transitionIn: TransitionEffect | null
  sourceWidth: number | null
  sourceHeight: number | null
  sourceDuration: number | null
  hasAudio: boolean
  /** Timeline start of the recording this clip came from, used for effect sync. */
  originStart: number
}

export type TrackKind = 'video' | 'audio' | 'text'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  hidden: boolean
  locked: boolean
  volume: number
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  width: number
  height: number
  fps: number
  backgroundColor: string
  tracks: Track[]
  clips: Clip[]
  cursor: EffectsSettings
  events: InputEventRecord[]
  /** Original recording this project was created from (null for blank projects). */
  recording: {
    outputPath: string
    rawPath: string
    eventsPath: string
    startedAt: number
    sourceWidth: number
    sourceHeight: number
    monitorBounds: Bounds
    capturedBounds: Bounds
  } | null
  masterVolume: number
  /** Timeline length, recomputed from clips. */
  duration: number
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  createdAt: string
  duration: number
  width: number
  height: number
  fps: number
  clipCount: number
  thumbnail: string | null
  sourcePath: string | null
}

export interface MediaProbe {
  path: string
  duration: number
  width: number
  height: number
  fps: number
  hasVideo: boolean
  hasAudio: boolean
  sizeBytes: number
  codec: string | null
}

/* -------------------------------- exports --------------------------------- */

export type ExportFormat = 'mp4' | 'mkv' | 'webm'

export interface ExportSettings {
  format: ExportFormat
  width: number
  height: number
  fps: number
  /** Megabits per second for video. */
  bitrateMbps: number
  audioBitrateKbps: number
  encoder: EncoderKind
  denoise: boolean
  /** Burn the cursor/keyboard effects into the export. */
  includeEffects: boolean
}

export type ExportStatus = 'queued' | 'preparing' | 'rendering' | 'completed' | 'failed' | 'canceled'

export interface ExportJob {
  id: string
  projectId: string
  projectName: string
  outputPath: string
  settings: ExportSettings
  status: ExportStatus
  progress: number
  stage: string
  message: string | null
  createdAt: string
  finishedAt: string | null
  sizeBytes: number | null
  durationMs: number | null
  fps: number
}

export interface OverlayRenderRequest {
  project: Project
  settings: ExportSettings
  outputDir: string
  frameCount: number
  fps: number
}

export interface RenderProgress {
  jobId: string
  progress: number
  stage: string
  fps: number
  timeMs: number
  speed: number
}

/* ------------------------------- screenshots ------------------------------ */

export interface ScreenshotEntry {
  path: string
  name: string
  createdAt: string
  width: number
  height: number
  sizeBytes: number
}

export interface ScreenshotResult {
  path: string
  width: number
  height: number
  dataUrl: string
}

export interface ScreenshotRequest {
  sourceId: string
  sourceWidth: number
  sourceHeight: number
}

/* --------------------------------- system --------------------------------- */

export interface SystemStats {
  cpuPercent: number
  memoryMB: number
  memoryTotalMB: number
  uptimeSeconds: number
  rendererCpuPercent: number
  diskFreeMB: number | null
}

export interface EncoderInfo {
  name: string
  kind: EncoderKind
  available: boolean
  label: string
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  platform: string
  ffmpegPath: string
  ffmpegVersion: string | null
  ffprobePath: string
  encoders: EncoderInfo[]
  recordingsDir: string
  projectsDir: string
  screenshotsDir: string
  inputCaptureAvailable: boolean
  inputCaptureReason: string | null
  isPackaged: boolean
  logsDir: string
}

export interface FfmpegProgressSnapshot {
  timeMs: number
  fps: number
  speed: number
  frame: number
}

export interface SilenceRange {
  start: number
  end: number
}

export interface OperationLogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  scope: string
  message: string
}

export interface IpcError {
  message: string
  code?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: IpcError }
