/**
 * Export queue: turns a project into a real media file.
 *
 * Pipeline per job:
 *   1. render the RGBA overlay sequence (cursor, click ripples, text) in an
 *      offscreen renderer window using the very same drawing code as the editor
 *   2. synthesise the effect audio track from the captured input events
 *   3. compile the FFmpeg filter graph and encode with the best available
 *      hardware encoder, reporting real progress parsed from ffmpeg
 */
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { ExportJob, ExportSettings, Project, RenderProgress } from '@shared/types'
import { buildEffectTimeline } from '@shared/effect-timeline'
import { encodeWav, renderEffectsPcm } from '@shared/effects-audio'
import { buildExportPlan } from '@shared/filtergraph'
import { defaultExportSettings } from '@shared/defaults'
import { IPC } from '@shared/ipc'
import { ensureDir, readDir, readJson, remove, stat, writeBinary, writeJson } from './fsx'
import { getPaths } from './paths'
import { logger } from './logger'
import { detectEncoders, encoderChoiceFor, probeMedia, runFfmpeg } from './ffmpeg'
import { loadProject, saveProject } from './projects'

interface OverlayResult {
  frameCount: number
  fps: number
}

class ExportService {
  private jobs: ExportJob[] = []
  private controllers = new Map<string, AbortController>()
  private running = false
  private loaded = false
  private window: BrowserWindow | null = null

  attachWindow(window: BrowserWindow): void {
    this.window = window
  }

  private emit(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, payload)
  }

  private async persist(): Promise<void> {
    await writeJson(path.join(getPaths().userData, 'exports.json'), this.jobs)
  }

  async list(): Promise<ExportJob[]> {
    if (!this.loaded) {
      const stored = await readJson<ExportJob[]>(path.join(getPaths().userData, 'exports.json'))
      if (Array.isArray(stored)) {
        this.jobs = stored.map((job) => ({
          ...job,
          status: job.status === 'rendering' || job.status === 'preparing' || job.status === 'queued' ? 'failed' : job.status,
          message:
            job.status === 'rendering' || job.status === 'preparing' || job.status === 'queued'
              ? 'Interrupted by app restart'
              : job.message
        }))
      }
      this.loaded = true
    }
    return this.jobs
  }

  async enqueue(projectId: string, settings: Partial<ExportSettings>, outputPath: string | null): Promise<ExportJob> {
    const project = await loadProject(projectId)
    if (!project) throw new Error('Project not found')
    const merged: ExportSettings = { ...defaultExportSettings(project), ...settings }
    const paths = getPaths()
    const exportsDir = path.join(paths.recordings, 'Exports')
    await ensureDir(exportsDir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safeName = project.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'export'
    const target = outputPath || path.join(exportsDir, `${safeName}_${stamp}.${merged.format}`)

    const job: ExportJob = {
      id: `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      projectId,
      projectName: project.name,
      outputPath: target,
      settings: merged,
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      message: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      sizeBytes: null,
      durationMs: null,
      fps: project.fps
    }
    this.jobs.unshift(job)
    await this.persist()
    this.emit(IPC.exportsUpdated, job)
    void this.pump()
    return job
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.find((entry) => entry.id === jobId)
    if (!job) return
    if (job.status === 'queued') {
      job.status = 'canceled'
      job.stage = 'Canceled'
      job.finishedAt = new Date().toISOString()
      await this.persist()
      this.emit(IPC.exportsUpdated, job)
      return
    }
    this.controllers.get(jobId)?.abort()
  }

  async clearFinished(): Promise<ExportJob[]> {
    this.jobs = this.jobs.filter((job) => job.status === 'queued' || job.status === 'rendering' || job.status === 'preparing')
    await this.persist()
    return this.jobs
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const next = this.jobs.find((job) => job.status === 'queued')
        if (!next) break
        await this.run(next)
      }
    } finally {
      this.running = false
    }
  }

  private update(job: ExportJob, patch: Partial<ExportJob>): void {
    Object.assign(job, patch)
    this.emit(IPC.exportsUpdated, job)
  }

  private emitProgress(job: ExportJob, progress: number, stage: string, fps = 0, timeMs = 0, speed = 0): void {
    job.progress = Math.max(0, Math.min(1, progress))
    job.stage = stage
    const payload: RenderProgress = { jobId: job.id, progress: job.progress, stage, fps, timeMs, speed }
    this.emit(IPC.exportsProgress, payload)
  }

  private overlayEnabled(project: Project, settings: ExportSettings): { frames: number; fps: number; needed: boolean } {
    const overlayFps = Math.min(settings.fps, 30)
    const frames = Math.max(1, Math.ceil(project.duration * overlayFps))
    const hasText = project.clips.some((clip) => clip.kind === 'text' && clip.text)
    const timeline = buildEffectTimeline(project)
    const effectsNeeded =
      settings.includeEffects &&
      project.cursor.enabled &&
      !timeline.empty &&
      (project.cursor.cursorHighlight || project.cursor.clickRipples)
    return { frames, fps: overlayFps, needed: hasText || effectsNeeded }
  }

  private overlayWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    throw new Error('Application window is not available')
  }

  private async renderOverlay(
    project: Project,
    settings: ExportSettings,
    outputDir: string,
    frames: number,
    fps: number,
    job: ExportJob,
    controller: AbortController
  ): Promise<OverlayResult> {
    await ensureDir(outputDir)
    const parent = this.overlayWindow()
    const preloadPath = path.join(__dirname, '../preload/index.js')
    const overlayWindow = new BrowserWindow({
      show: false,
      parent,
      width: 640,
      height: 360,
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true,
        backgroundThrottling: false,
        offscreen: false
      }
    })

    try {
      const result = new Promise<OverlayResult>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Overlay rendering timed out')), 60 * 60_000)
        const cleanup = (): void => {
          clearTimeout(timeout)
          ipcMain.removeHandler(IPC.overlayFrame)
          ipcMain.removeHandler(IPC.overlayDone)
          ipcMain.removeAllListeners(IPC.overlayProgress)
          if (!overlayWindow.isDestroyed()) overlayWindow.destroy()
        }

        ipcMain.handle(IPC.overlayFrame, async (event, payload: { index: number; data: ArrayBuffer }) => {
          if (event.sender !== overlayWindow.webContents) return false
          const file = path.join(outputDir, `${String(payload.index + 1).padStart(6, '0')}.png`)
          await writeBinary(file, new Uint8Array(payload.data))
          return true
        })
        ipcMain.handle(IPC.overlayDone, async () => {
          cleanup()
          resolve({ frameCount: frames, fps })
          return true
        })

        controller.signal.addEventListener('abort', () => {
          cleanup()
          reject(new Error('Export canceled'))
        })

        ipcMain.on(IPC.overlayProgress, (event, payload: { index: number; total: number }) => {
          if (event.sender !== overlayWindow.webContents) return
          this.emitProgress(job, (payload.index / Math.max(1, payload.total)) * 0.34, `Rendering overlays ${payload.index}/${payload.total}`)
        })

        overlayWindow.webContents.once('render-process-gone', () => {
          cleanup()
          reject(new Error('The overlay renderer crashed'))
        })
      })

      const devUrl = process.env['ELECTRON_RENDERER_URL']
      if (devUrl) await overlayWindow.loadURL(`${devUrl}/overlay.html`)
      else await overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'))

      overlayWindow.webContents.send(IPC.overlayStart, {
        project,
        settings,
        outputDir,
        frameCount: frames,
        fps
      })
      return await result
    } finally {
      if (!overlayWindow.isDestroyed()) overlayWindow.destroy()
    }
  }

  private async writeEffectsAudio(project: Project, settings: ExportSettings, job: ExportJob): Promise<string | null> {
    if (!settings.includeEffects) return null
    const effects = project.cursor
    if (!effects.enabled || (!effects.clickSounds && !effects.keyboardSounds)) return null
    const timeline = buildEffectTimeline(project)
    if (timeline.empty) return null
    const clicks = effects.clickSounds ? timeline.clicks.map((cue) => ({ t: cue.t, button: cue.button })) : []
    const keys = effects.keyboardSounds ? timeline.keys.map((cue) => ({ t: cue.t })) : []
    if (!clicks.length && !keys.length) return null
    const samples = renderEffectsPcm({
      duration: project.duration,
      volume: effects.volume,
      pack: effects.pack,
      clicks,
      keys
    })
    const wav = encodeWav(samples)
    const file = path.join(getPaths().temp, `fx_${job.id}.wav`)
    await ensureDir(getPaths().temp)
    await writeBinary(file, wav)
    logger.info('exporter', 'effect audio rendered', { cues: clicks.length + keys.length, bytes: wav.length })
    return file
  }

  private async run(job: ExportJob): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    const tempDir = path.join(getPaths().temp, `overlay_${job.id}`)
    let effectsWav: string | null = null
    try {
      job.status = 'preparing'
      job.progress = 0
      this.update(job, { status: 'preparing', stage: 'Preparing' })
      await this.persist()
      const project = await loadProject(job.projectId)
      if (!project) throw new Error('Project could not be loaded')
      if (!project.clips.length) throw new Error('The timeline is empty - add at least one clip before exporting')
      await saveProject(project)

      const settings = job.settings
      const overlay = this.overlayEnabled(project, settings)
      let overlayPattern: string | null = null
      if (overlay.needed) {
        this.emitProgress(job, 0.01, 'Rendering overlays')
        await this.renderOverlay(project, settings, tempDir, overlay.frames, overlay.fps, job, controller)
        overlayPattern = path.join(tempDir, '%06d.png')
        this.emitProgress(job, 0.34, 'Overlays ready')
      }

      if (controller.signal.aborted) throw new Error('Export canceled')
      effectsWav = await this.writeEffectsAudio(project, settings, job)

      const encoders = await detectEncoders()
      const choice = encoderChoiceFor(settings.format, settings.encoder, encoders)
      const plan = buildExportPlan({
        project,
        settings,
        encoder: choice,
        effectsWavPath: effectsWav,
        overlayPattern,
        outputPath: job.outputPath
      })

      job.status = 'rendering'
      this.update(job, { status: 'rendering', stage: `Encoding with ${choice.label}` })
      logger.info('exporter', 'starting encode', { jobId: job.id, encoder: choice.videoCodec, args: plan.args.length })

      await runFfmpeg(plan.args, {
        signal: controller.signal,
        onProgress: (progress) => {
          const ratio = plan.duration > 0 ? Math.min(1, progress.timeMs / 1000 / plan.duration) : 0
          this.emitProgress(job, 0.34 + ratio * 0.65, `Encoding with ${choice.label}`, progress.fps, progress.timeMs, progress.speed)
        }
      })

      const probe = await probeMedia(job.outputPath)
      const info = await stat(job.outputPath)
      this.update(job, {
        status: 'completed',
        progress: 1,
        stage: 'Completed',
        finishedAt: new Date().toISOString(),
        sizeBytes: info?.size ?? 0,
        durationMs: probe?.duration ? Math.round(probe.duration * 1000) : null,
        fps: probe?.fps ? Math.round(probe.fps) : settings.fps,
        message: null
      })
      logger.info('exporter', 'export completed', { jobId: job.id, outputPath: job.outputPath, sizeBytes: info?.size })
    } catch (error) {
      const aborted = controller.signal.aborted
      const message = (error as Error).message || 'Export failed'
      this.update(job, {
        status: aborted ? 'canceled' : 'failed',
        stage: aborted ? 'Canceled' : 'Failed',
        message: aborted ? 'Canceled by user' : message,
        finishedAt: new Date().toISOString()
      })
      logger.error('exporter', 'export failed', { jobId: job.id, message })
      if (!aborted) {
        const tail = (error as { stderr?: string }).stderr
        if (tail) logger.error('exporter', 'ffmpeg output', tail.split(/\r?\n/).slice(-8).join(' | '))
      }
    } finally {
      this.controllers.delete(job.id)
      await remove(tempDir)
      if (effectsWav) await remove(effectsWav)
      await this.persist()
      this.emit(IPC.exportsUpdated, job)
    }
  }
}

export const exporter = new ExportService()
export async function listExportDirectory(): Promise<string[]> {
  return (await readDir(path.join(getPaths().recordings, 'Exports'))).map((entry) => entry.name)
}
