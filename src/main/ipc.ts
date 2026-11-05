import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  AppInfo,
  ExportSettings,
  InputCaptureState,
  Project,
  RecordingPreset,
  RecordingRequest,
  RecordingResult,
  ScreenshotRequest
} from '@shared/types'
import { getPaths, mediaUrl } from './paths'
import { logger } from './logger'
import { loadSettings, resetSettings, updateSettings, listPresets, savePreset, deletePreset } from './settings'
import { deleteProject, listProjects, loadProject, saveProject, createBlankProject, autosaveProject, listRecoveries, restoreRecovery, projectFromRecording } from './projects'
import { primeRecorderSettings, recorder } from './recorder'
import { inputCapture, inputCaptureAvailable } from './input'
import { detectEncoders, getFfmpegPath, getFfmpegVersion, getFfprobePath, probeMedia, thumbnail, waveform, detectSilence } from './ffmpeg'
import { exporter } from './exporter'
import { captureScreenshot, deleteScreenshot, listScreenshots, saveScreenshot, copyImage } from './screenshots'
import { encoderStatus, listCaptureSources, listMonitors, systemStats } from './system'
import { deleteRecording, listRecordingLibrary } from './library'
import { readText } from './fsx'
import { stageCapture } from './capture-state'

/** Latest settings snapshot, used by handlers that need synchronous access. */
let currentSettings: AppSettings | null = null

export async function refreshSettingsSnapshot(): Promise<AppSettings> {
  currentSettings = await loadSettings()
  primeRecorderSettings(currentSettings)
  return currentSettings
}

async function buildAppInfo(): Promise<AppInfo> {
  const paths = getPaths()
  if (!currentSettings) await refreshSettingsSnapshot()
  const input = inputCaptureAvailable()
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    ffmpegPath: await getFfmpegPath(),
    ffmpegVersion: await getFfmpegVersion(),
    ffprobePath: await getFfprobePath(),
    encoders: await detectEncoders(),
    recordingsDir: paths.recordings,
    projectsDir: paths.projects,
    screenshotsDir: paths.screenshots,
    inputCaptureAvailable: input.available,
    inputCaptureReason: input.reason,
    isPackaged: app.isPackaged,
    logsDir: paths.logs
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, async () => buildAppInfo())

  ipcMain.handle(IPC.appOpenPath, async (_event, target: string) => {
    const result = await shell.openPath(target)
    if (result) throw new Error(result)
  })
  ipcMain.handle(IPC.appShowItem, (_event, target: string) => {
    shell.showItemInFolder(target)
  })
  ipcMain.handle(IPC.appOpenExternal, async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened')
    await shell.openExternal(url)
  })
  ipcMain.handle(IPC.appPickDirectory, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(IPC.appPickFiles, async (event, kind: 'media' | 'any' = 'media') => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const filters =
      kind === 'media'
        ? [
            { name: 'Media', extensions: ['mp4', 'mkv', 'webm', 'mov', 'mp3', 'wav', 'aac', 'm4a', 'flac', 'png', 'jpg', 'jpeg', 'webp'] },
            { name: 'All files', extensions: ['*'] }
          ]
        : [{ name: 'All files', extensions: ['*'] }]
    const options: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IPC.appLog, (_event, payload: { level: 'info' | 'warn' | 'error'; scope: string; message: string }) => {
    logger[payload.level]?.(`renderer:${payload.scope}`, payload.message)
  })
  ipcMain.handle(IPC.appLogs, async () => {
    return (await readText(path.join(getPaths().logs, 'app.log'))) ?? ''
  })

  ipcMain.handle(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle(IPC.windowState, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return { maximized: window?.isMaximized() ?? false }
  })

  ipcMain.handle(IPC.settingsGet, async () => refreshSettingsSnapshot())
  ipcMain.handle(IPC.settingsUpdate, async (_event, patch: Partial<AppSettings>) => {
    const next = await updateSettings(patch)
    currentSettings = next
    primeRecorderSettings(next)
    return next
  })
  ipcMain.handle(IPC.settingsReset, async () => {
    const next = await resetSettings()
    currentSettings = next
    primeRecorderSettings(next)
    return next
  })

  ipcMain.handle(IPC.systemMonitors, () => listMonitors())
  ipcMain.handle(IPC.systemSources, (_event, kinds: ('screen' | 'window')[] = ['screen', 'window']) => listCaptureSources(kinds))
  ipcMain.handle(IPC.systemStats, () => systemStats())
  ipcMain.handle(IPC.systemEncoders, async (_event, refresh = false) => (refresh ? encoderStatus() : detectEncoders()))
  ipcMain.handle(IPC.systemRefreshEncoders, () => encoderStatus())

  ipcMain.handle(IPC.recorderStart, async (event, request: RecordingRequest) => {
    const settings = currentSettings ?? (await refreshSettingsSnapshot())
    if (request.captureInput && (!settings.captureInputEvents || !settings.inputCaptureConsent)) {
      request.captureInput = false
    }
    stageCapture(request.sourceId, request.systemAudio)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Recorder window is unavailable')
    return recorder.start(request, window)
  })
  ipcMain.handle(IPC.recorderPause, () => recorder.pause())
  ipcMain.handle(IPC.recorderResume, () => recorder.resume())
  ipcMain.handle(IPC.recorderStop, () => recorder.stop())
  ipcMain.handle(IPC.recorderCancel, () => recorder.cancel())
  ipcMain.handle(IPC.recorderStatus, () => recorder.status())
  ipcMain.handle(IPC.recorderReportDropped, (_event, count: number) => {
    recorder.reportDroppedFrames(count)
  })
  ipcMain.on(IPC.recorderChunk, (_event, sessionId: string, chunk: ArrayBuffer) => {
    recorder.appendChunk(sessionId, Buffer.from(chunk))
  })
  ipcMain.handle(IPC.recorderRecoveryList, () => recorder.listRecoveries())
  ipcMain.handle(IPC.recorderRecover, (_event, id: string) => recorder.recover(id))

  ipcMain.handle(IPC.inputState, async (): Promise<InputCaptureState> => {
    const settings = currentSettings ?? (await refreshSettingsSnapshot())
    return inputCapture.state(settings.inputCaptureConsent)
  })
  ipcMain.handle(IPC.inputEvents, () => inputCapture.snapshot())

  ipcMain.handle(IPC.presetsList, () => listPresets())
  ipcMain.handle(IPC.presetsSave, (_event, preset: RecordingPreset) => savePreset(preset))
  ipcMain.handle(IPC.presetsDelete, (_event, id: string) => deletePreset(id))

  ipcMain.handle(IPC.projectsList, () => listProjects())
  ipcMain.handle(IPC.projectsCreate, (_event, payload: { name: string; width?: number; height?: number; fps?: number }) =>
    createBlankProject(payload.name, payload.width, payload.height, payload.fps)
  )
  ipcMain.handle(IPC.projectsLoad, (_event, id: string) => loadProject(id))
  ipcMain.handle(IPC.projectsSave, (_event, project: Project) => saveProject(project))
  ipcMain.handle(IPC.projectsDelete, (_event, id: string) => deleteProject(id))
  ipcMain.handle(IPC.projectsAutosave, (_event, project: Project) => autosaveProject(project))
  ipcMain.handle(IPC.projectsRecoveryList, () => listRecoveries())
  ipcMain.handle(IPC.projectsRestoreRecovery, (_event, snapshotPath: string) => restoreRecovery(snapshotPath))

  ipcMain.handle(IPC.projectFromRecording, async (_event, result: RecordingResult) => {
    const project = await projectFromRecording(result)
    return project
  })

  ipcMain.handle(IPC.mediaProbe, (_event, file: string) => probeMedia(file))
  ipcMain.handle(IPC.mediaThumbnail, (_event, payload: { file: string; time: number; width?: number }) =>
    thumbnail(payload.file, payload.time, payload.width ?? 320)
  )
  ipcMain.handle(IPC.mediaWaveform, (_event, file: string) => waveform(file))
  ipcMain.handle(IPC.mediaDetectSilence, (_event, payload: { file: string; thresholdDb?: number; minDuration?: number }) =>
    detectSilence(payload.file, payload.thresholdDb, payload.minDuration)
  )
  ipcMain.handle(IPC.mediaImportFiles, async (_event, kind: 'media' | 'any' = 'media') => {
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const filters =
      kind === 'any'
        ? [{ name: 'All files', extensions: ['*'] }]
        : [
            { name: 'Media', extensions: ['mp4', 'mkv', 'webm', 'mov', 'mp3', 'wav', 'aac', 'm4a', 'flac', 'png', 'jpg', 'jpeg', 'webp'] },
            { name: 'All files', extensions: ['*'] }
          ]
    const options: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    const probes = []
    for (const file of result.filePaths) {
      probes.push({ path: file, probe: await probeMedia(file) })
    }
    return probes
  })

  ipcMain.handle(IPC.exportsEnqueue, (_event, payload: { projectId: string; settings: Partial<ExportSettings>; outputPath: string | null }) =>
    exporter.enqueue(payload.projectId, payload.settings, payload.outputPath)
  )
  ipcMain.handle(IPC.exportsList, () => exporter.list())
  ipcMain.handle(IPC.exportsCancel, (_event, id: string) => exporter.cancel(id))
  ipcMain.handle(IPC.exportsClear, () => exporter.clearFinished())
  ipcMain.handle(IPC.exportsReveal, (_event, file: string) => {
    shell.showItemInFolder(file)
  })
  ipcMain.handle(IPC.libraryOpenResult, async (_event, file: string) => {
    const result = await shell.openPath(file)
    if (result) throw new Error(result)
  })

  ipcMain.handle(IPC.screenshotsCapture, (_event, request: ScreenshotRequest) => captureScreenshot(request))
  ipcMain.handle(IPC.libraryOpenResult, async (_event, file: string) => {
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.screenshotsSave, (_event, payload: { dataUrl: string; name?: string }) => saveScreenshot(payload.dataUrl, payload.name))
  ipcMain.handle(IPC.screenshotsList, () => listScreenshots())
  ipcMain.handle(IPC.screenshotsDelete, (_event, file: string) => deleteScreenshot(file))
  ipcMain.handle(IPC.screenshotsCopy, (_event, dataUrl: string) => copyImage(dataUrl))

  ipcMain.handle(IPC.libraryRecordings, () => listRecordingLibrary())
  ipcMain.handle(IPC.libraryDeleteRecording, async (_event, file: string) => {
    await deleteRecording(file)
    return listRecordingLibrary()
  })

  ipcMain.handle('app:media-url', (_event, file: string) => mediaUrl(file))
}

export function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
