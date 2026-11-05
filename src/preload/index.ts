import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppInfo,
  AppSettings,
  CaptureSource,
  EncoderInfo,
  ExportJob,
  ExportSettings,
  InputCaptureState,
  InputEventRecord,
  LibraryRecording,
  MediaProbe,
  MonitorInfo,
  OverlayRenderRequest,
  Project,
  ProjectSummary,
  RecorderStatus,
  RecordingPreset,
  RecordingRequest,
  RecordingResult,
  RecoveryEntry,
  RenderProgress,
  ScreenshotEntry,
  ScreenshotRequest,
  ScreenshotResult,
  ShortcutAction,
  SilenceRange,
  SystemStats
} from '@shared/types'

export interface ImportedMedia {
  path: string
  probe: MediaProbe | null
}

export interface RecoverySnapshotInfo {
  projectId: string
  projectName: string
  savedAt: string
  path: string
  clips: number
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

export function mediaUrl(file: string): string {
  return `media://local/file?path=${encodeURIComponent(file)}`
}

const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
    openPath: (target: string): Promise<void> => ipcRenderer.invoke(IPC.appOpenPath, target),
    showItem: (target: string): Promise<void> => ipcRenderer.invoke(IPC.appShowItem, target),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.appOpenExternal, url),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.appPickDirectory),
    pickFiles: (kind: 'media' | 'any' = 'media'): Promise<string[]> => ipcRenderer.invoke(IPC.appPickFiles, kind),
    logs: (): Promise<string> => ipcRenderer.invoke(IPC.appLogs),
    log: (level: 'info' | 'warn' | 'error', scope: string, message: string): Promise<void> =>
      ipcRenderer.invoke(IPC.appLog, { level, scope, message }),
    mediaUrl,
    pathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
    state: (): Promise<{ maximized: boolean }> => ipcRenderer.invoke(IPC.windowState),
    onStateChange: (callback: (state: { maximized: boolean }) => void): (() => void) =>
      subscribe(IPC.windowStateChanged, callback)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    reset: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsReset)
  },
  system: {
    monitors: (): Promise<MonitorInfo[]> => ipcRenderer.invoke(IPC.systemMonitors),
    sources: (kinds: ('screen' | 'window')[] = ['screen', 'window']): Promise<CaptureSource[]> =>
      ipcRenderer.invoke(IPC.systemSources, kinds),
    stats: (): Promise<SystemStats> => ipcRenderer.invoke(IPC.systemStats),
    encoders: (refresh = false): Promise<EncoderInfo[]> => ipcRenderer.invoke(IPC.systemEncoders, refresh)
  },
  recorder: {
    start: (request: RecordingRequest): Promise<RecorderStatus> => ipcRenderer.invoke(IPC.recorderStart, request),
    pause: (): Promise<RecorderStatus> => ipcRenderer.invoke(IPC.recorderPause),
    resume: (): Promise<RecorderStatus> => ipcRenderer.invoke(IPC.recorderResume),
    stop: (): Promise<RecordingResult> => ipcRenderer.invoke(IPC.recorderStop),
    cancel: (): Promise<void> => ipcRenderer.invoke(IPC.recorderCancel),
    status: (): Promise<RecorderStatus> => ipcRenderer.invoke(IPC.recorderStatus),
    reportDroppedFrames: (count: number): Promise<void> => ipcRenderer.invoke(IPC.recorderReportDropped, count),
    sendChunk: (sessionId: string, chunk: ArrayBuffer): void => {
      ipcRenderer.send(IPC.recorderChunk, sessionId, chunk)
    },
    listRecoveries: (): Promise<RecoveryEntry[]> => ipcRenderer.invoke(IPC.recorderRecoveryList),
    recover: (id: string): Promise<RecordingResult> => ipcRenderer.invoke(IPC.recorderRecover, id),
    onTick: (callback: (status: RecorderStatus) => void): (() => void) => subscribe(IPC.recorderTick, callback),
    onPhase: (callback: (status: RecorderStatus) => void): (() => void) => subscribe(IPC.recorderPhase, callback),
    onFinalized: (callback: (result: RecordingResult) => void): (() => void) => subscribe(IPC.recorderFinalized, callback),
    onInputEvent: (callback: (event: InputEventRecord) => void): (() => void) => subscribe(IPC.inputEvents, callback)
  },
  input: {
    state: (): Promise<InputCaptureState> => ipcRenderer.invoke(IPC.inputState),
    events: (): Promise<InputEventRecord[]> => ipcRenderer.invoke(IPC.inputEvents)
  },
  presets: {
    list: (): Promise<RecordingPreset[]> => ipcRenderer.invoke(IPC.presetsList),
    save: (preset: RecordingPreset): Promise<RecordingPreset[]> => ipcRenderer.invoke(IPC.presetsSave, preset),
    delete: (id: string): Promise<RecordingPreset[]> => ipcRenderer.invoke(IPC.presetsDelete, id)
  },
  projects: {
    list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke(IPC.projectsList),
    create: (name: string, width?: number, height?: number, fps?: number): Promise<Project> =>
      ipcRenderer.invoke(IPC.projectsCreate, { name, width, height, fps }),
    load: (id: string): Promise<Project | null> => ipcRenderer.invoke(IPC.projectsLoad, id),
    save: (project: Project): Promise<Project> => ipcRenderer.invoke(IPC.projectsSave, project),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectsDelete, id),
    autosave: (project: Project): Promise<{ savedAt: string; path: string }> => ipcRenderer.invoke(IPC.projectsAutosave, project),
    fromRecording: (result: RecordingResult): Promise<Project> => ipcRenderer.invoke(IPC.projectFromRecording, result),
    recoveryList: (): Promise<RecoverySnapshotInfo[]> => ipcRenderer.invoke(IPC.projectsRecoveryList),
    restoreRecovery: (snapshotPath: string): Promise<Project | null> => ipcRenderer.invoke(IPC.projectsRestoreRecovery, snapshotPath)
  },
  media: {
    probe: (file: string): Promise<MediaProbe | null> => ipcRenderer.invoke(IPC.mediaProbe, file),
    thumbnail: (file: string, time: number, width?: number): Promise<string | null> =>
      ipcRenderer.invoke(IPC.mediaThumbnail, { file, time, width }),
    waveform: (file: string): Promise<number[]> => ipcRenderer.invoke(IPC.mediaWaveform, file),
    detectSilence: (file: string, thresholdDb?: number, minDuration?: number): Promise<SilenceRange[]> =>
      ipcRenderer.invoke(IPC.mediaDetectSilence, { file, thresholdDb, minDuration }),
    importFiles: (): Promise<ImportedMedia[]> => ipcRenderer.invoke(IPC.mediaImportFiles, 'media')
  },
  exports: {
    enqueue: (projectId: string, settings: Partial<ExportSettings>, outputPath: string | null): Promise<ExportJob> =>
      ipcRenderer.invoke(IPC.exportsEnqueue, { projectId, settings, outputPath }),
    list: (): Promise<ExportJob[]> => ipcRenderer.invoke(IPC.exportsList),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke(IPC.exportsCancel, id),
    clear: (): Promise<ExportJob[]> => ipcRenderer.invoke(IPC.exportsClear),
    reveal: (file: string): Promise<void> => ipcRenderer.invoke(IPC.exportsReveal, file),
    onProgress: (callback: (progress: RenderProgress) => void): (() => void) => subscribe(IPC.exportsProgress, callback),
    onUpdate: (callback: (job: ExportJob) => void): (() => void) => subscribe(IPC.exportsUpdated, callback)
  },
  screenshots: {
    capture: (request: ScreenshotRequest): Promise<ScreenshotResult> => ipcRenderer.invoke(IPC.screenshotsCapture, request),
    save: (dataUrl: string, name?: string): Promise<string> => ipcRenderer.invoke(IPC.screenshotsSave, { dataUrl, name }),
    list: (): Promise<ScreenshotEntry[]> => ipcRenderer.invoke(IPC.screenshotsList),
    remove: (file: string): Promise<void> => ipcRenderer.invoke(IPC.screenshotsDelete, file),
    copy: (dataUrl: string): Promise<void> => ipcRenderer.invoke(IPC.screenshotsCopy, dataUrl)
  },
  library: {
    recordings: (): Promise<LibraryRecording[]> => ipcRenderer.invoke(IPC.libraryRecordings),
    deleteRecording: (file: string): Promise<LibraryRecording[]> => ipcRenderer.invoke(IPC.libraryDeleteRecording, file),
    openFile: (file: string): Promise<void> => ipcRenderer.invoke(IPC.libraryOpenResult, file)
  },
  shortcuts: {
    onTrigger: (callback: (action: ShortcutAction) => void): (() => void) => subscribe(IPC.shortcut, callback)
  },
  overlay: {
    onStart: (callback: (payload: OverlayRenderRequest) => void): (() => void) => subscribe(IPC.overlayStart, callback),
    sendFrame: (index: number, data: ArrayBuffer): Promise<boolean> => ipcRenderer.invoke(IPC.overlayFrame, { index, data }),
    reportProgress: (index: number, total: number): void => {
      ipcRenderer.send(IPC.overlayProgress, { index, total })
    },
    done: (): Promise<boolean> => ipcRenderer.invoke(IPC.overlayDone)
  }
}

export type SkyRecApi = typeof api

contextBridge.exposeInMainWorld('api', api)
