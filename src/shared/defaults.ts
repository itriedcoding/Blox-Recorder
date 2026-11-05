import type {
  AppSettings,
  Clip,
  EffectsSettings,
  ExportSettings,
  Project,
  RecordingPreset,
  ResolutionPreset,
  Track,
  WebcamSettings
} from './types'

export const RESOLUTION_PRESETS: { id: ResolutionPreset; label: string; height: number }[] = [
  { id: 'native', label: 'Native', height: 0 },
  { id: '720p', label: '720p', height: 720 },
  { id: '1080p', label: '1080p', height: 1080 },
  { id: '1440p', label: '1440p', height: 1440 },
  { id: '4k', label: '4K', height: 2160 }
]

export const QUALITY_BITRATE: Record<'low' | 'medium' | 'high' | 'ultra', number> = {
  low: 4,
  medium: 8,
  high: 16,
  ultra: 32
}

export const DEFAULT_SHORTCUTS: AppSettings['shortcuts'] = {
  startStopRecording: 'CommandOrControl+Shift+R',
  pauseResumeRecording: 'CommandOrControl+Shift+P',
  screenshot: 'CommandOrControl+Shift+S',
  openEditor: 'CommandOrControl+E',
  newProject: 'CommandOrControl+N',
  saveProject: 'CommandOrControl+S',
  exportVideo: 'CommandOrControl+Shift+E'
}

export function defaultEffects(): EffectsSettings {
  return {
    enabled: true,
    cursorHighlight: true,
    clickRipples: true,
    clickSounds: true,
    keyboardSounds: false,
    smoothCursor: true,
    zoomOnClick: true,
    intensity: 0.75,
    volume: 0.5,
    pack: 'soft',
    cursorSize: 26,
    cursorColor: '#22bcff',
    rippleColor: '#22bcff'
  }
}

export function defaultWebcam(): WebcamSettings {
  return {
    enabled: false,
    deviceId: null,
    position: 'bottom-right',
    size: 0.16,
    mirrored: true,
    shape: 'circle',
    offsetX: 0,
    offsetY: 0
  }
}

export function defaultSettings(): AppSettings {
  return {
    theme: 'dark',
    recordingsDir: '',
    projectsDir: '',
    screenshotsDir: '',
    ffmpegPath: '',
    ffprobePath: '',
    countdownSeconds: 3,
    defaultFps: 60,
    defaultResolution: 'native',
    encoder: 'auto',
    recordingFormat: 'mp4',
    captureInputEvents: true,
    inputCaptureConsent: false,
    autoSaveSeconds: 20,
    hardwareMonitor: true,
    effects: defaultEffects(),
    shortcuts: DEFAULT_SHORTCUTS,
    lastPresetId: 'preset-default'
  }
}

export function defaultPreset(): RecordingPreset {
  return {
    id: 'preset-default',
    name: 'Balanced 1080p60',
    fps: 60,
    resolution: '1080p',
    micDeviceId: null,
    systemAudio: true,
    webcam: defaultWebcam(),
    format: 'mp4',
    quality: 'high',
    effects: defaultEffects(),
    region: { enabled: false, x: 0, y: 0, width: 1, height: 1 },
    countdown: 3
  }
}

export function defaultExportSettings(project: Pick<Project, 'width' | 'height' | 'fps'>): ExportSettings {
  return {
    format: 'mp4',
    width: project.width,
    height: project.height,
    fps: project.fps,
    bitrateMbps: 16,
    audioBitrateKbps: 192,
    encoder: 'auto',
    denoise: false,
    includeEffects: true
  }
}

export function resolutionForPreset(preset: ResolutionPreset, sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const entry = RESOLUTION_PRESETS.find((r) => r.id === preset)
  const target = entry?.height ?? 0
  if (!target) return { width: even(sourceWidth), height: even(sourceHeight) }
  const aspect = sourceWidth / sourceHeight || 16 / 9
  const height = target
  const width = Math.round(height * aspect)
  return { width: even(width), height: even(height) }
}

export function even(value: number): number {
  const rounded = Math.round(value)
  return rounded % 2 === 0 ? rounded : rounded - 1
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyTracks(): Track[] {
  return [
    { id: 'track-video-1', kind: 'video', name: 'Screen', muted: false, hidden: false, locked: false, volume: 1 },
    { id: 'track-overlay', kind: 'video', name: 'Overlay', muted: false, hidden: false, locked: false, volume: 1 },
    { id: 'track-text', kind: 'text', name: 'Text', muted: false, hidden: false, locked: false, volume: 1 },
    { id: 'track-audio-1', kind: 'audio', name: 'Microphone', muted: false, hidden: false, locked: false, volume: 1 },
    { id: 'track-music', kind: 'audio', name: 'Music', muted: false, hidden: false, locked: false, volume: 0.6 }
  ]
}

export function defaultClip(kind: Clip['kind'], trackId: string, patch: Partial<Clip> = {}): Clip {
  return {
    id: newId('clip'),
    trackId,
    kind,
    name: 'Clip',
    sourcePath: null,
    start: 0,
    duration: 5,
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    muted: false,
    crop: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    text: null,
    zoom: null,
    transitionIn: null,
    sourceWidth: null,
    sourceHeight: null,
    sourceDuration: null,
    hasAudio: kind === 'video' || kind === 'audio',
    originStart: 0,
    ...patch
  }
}

export function createProject(name: string, width = 1920, height = 1080, fps = 60): Project {
  const now = new Date().toISOString()
  return {
    id: newId('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    width,
    height,
    fps,
    backgroundColor: '#05070b',
    tracks: createEmptyTracks(),
    clips: [],
    cursor: defaultEffects(),
    events: [],
    recording: null,
    masterVolume: 1,
    duration: 0
  }
}

export function projectDuration(project: Pick<Project, 'clips'>): number {
  return project.clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0)
}
