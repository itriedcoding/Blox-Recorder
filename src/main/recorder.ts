/**
 * Recording session manager.
 *
 * The renderer owns the actual capture graph (Chromium desktop capture -> canvas
 * compositor -> MediaRecorder). This service owns everything that must survive a
 * renderer crash: the session directory, the append-only raw file, the input
 * event log, timers, status telemetry and the FFmpeg remux/transcode step.
 */
import { createWriteStream, type WriteStream } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import type {
  InputEventRecord,
  RecoveryEntry,
  RecorderStatus,
  RecordingRequest,
  RecordingResult,
  RecordingSession
} from '@shared/types'
import { QUALITY_BITRATE } from '@shared/defaults'
import { IPC } from '@shared/ipc'
import { ensureDir, exists, readDir, readJson, remove, stat, writeJson } from './fsx'
import { getPaths } from './paths'
import { logger } from './logger'
import { encoderChoiceFor, detectEncoders, probeMedia, runFfmpeg } from './ffmpeg'
import { loadSettings } from './settings'
import { inputCapture } from './input'

const EMPTY_STATUS: RecorderStatus = {
  phase: 'idle',
  session: null,
  elapsedMs: 0,
  pausedMs: 0,
  bytes: 0,
  fps: 0,
  droppedFrames: 0,
  cpuPercent: 0,
  memoryMB: 0,
  outputPath: null,
  error: null,
  countdownRemaining: 0
}

interface StoredSession {
  session: RecordingSession
  completed: boolean
  resultPath: string | null
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

export class RecorderService {
  private session: RecordingSession | null = null
  private stream: WriteStream | null = null
  private streamClosed: Promise<void> | null = null
  private target: BrowserWindow | null = null
  private startedAt = 0
  private pausedAt = 0
  private pausedTotal = 0
  private bytes = 0
  private droppedFrames = 0
  private countdownRemaining = 0
  private countdownTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private finalising: Promise<RecordingResult> | null = null
  private lastResult: RecordingResult | null = null
  private lastError: string | null = null

  attachWindow(window: BrowserWindow): void {
    this.target = window
  }

  private emit(channel: string, payload: unknown): void {
    if (this.target && !this.target.isDestroyed()) {
      this.target.webContents.send(channel, payload)
    }
  }

  private emitStatus(): void {
    this.emit(IPC.recorderTick, this.status())
  }

  status(): RecorderStatus {
    if (!this.session) {
      return { ...EMPTY_STATUS, outputPath: this.lastResult?.outputPath ?? null, error: this.lastError }
    }
    const pausedMs = this.pausedTotal + (this.pausedAt ? Date.now() - this.pausedAt : 0)
    const elapsed = this.startedAt ? Math.max(0, Date.now() - this.startedAt - pausedMs) : 0
    const metrics = app.getAppMetrics()
    const cpuPercent = metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0)
    const memoryMB = Math.round(metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024)
    return {
      phase: this.session.phase,
      session: this.session,
      elapsedMs: elapsed,
      pausedMs,
      bytes: this.bytes,
      fps: this.session.request.fps,
      droppedFrames: this.droppedFrames,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryMB,
      outputPath: this.lastResult?.outputPath ?? null,
      error: this.lastError,
      countdownRemaining: this.countdownRemaining
    }
  }

  async start(request: RecordingRequest, window: BrowserWindow): Promise<RecorderStatus> {
    if (this.session && ['countdown', 'recording', 'paused', 'finalizing'].includes(this.session.phase)) {
      throw new Error('A recording is already in progress')
    }
    this.target = window
    const settings = await loadSettings()
    const paths = getPaths()
    await ensureDir(paths.recordings)
    await ensureDir(paths.sessions)

    const id = `rec_${Date.now().toString(36)}`
    const dir = path.join(paths.sessions, id)
    await ensureDir(dir)
    const rawPath = path.join(dir, 'capture.webm')
    const eventsPath = path.join(dir, 'events.json')

    const session: RecordingSession = {
      id,
      dir,
      startedAt: Date.now(),
      phase: 'countdown',
      request,
      rawPath,
      eventsPath,
      error: null
    }
    this.session = session
    this.startedAt = 0
    this.pausedAt = 0
    this.pausedTotal = 0
    this.bytes = 0
    this.droppedFrames = 0
    this.lastError = null
    this.lastResult = null
    this.countdownRemaining = Math.max(0, Math.round(request.countdown))
    await writeJson(path.join(dir, 'session.json'), {
      session,
      completed: false,
      resultPath: null,
      captureInputEvents: request.captureInput && settings.captureInputEvents && settings.inputCaptureConsent
    } satisfies StoredSession & { captureInputEvents: boolean })

    this.emit(IPC.recorderPhase, this.status())
    this.emitStatus()

    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => this.emitStatus(), 500)

    if (this.countdownRemaining > 0) {
      this.countdownTimer = setInterval(() => {
        this.countdownRemaining -= 1
        this.emitStatus()
        if (this.countdownRemaining <= 0) {
          if (this.countdownTimer) clearInterval(this.countdownTimer)
          this.countdownTimer = null
          this.beginCapture()
        }
      }, 1000)
    } else {
      this.beginCapture()
    }

    logger.info('recorder', 'recording session created', { id, request: { sourceName: request.sourceName, fps: request.fps } })
    return this.status()
  }

  private beginCapture(): void {
    if (!this.session) return
    this.session.phase = 'recording'
    this.startedAt = Date.now()
    this.countdownRemaining = 0
    const settings = loadSettingsSync()
    if (this.session.request.captureInput && settings?.captureInputEvents && settings.inputCaptureConsent) {
      inputCapture.begin(this.session.request, (event) => this.emit(IPC.inputEvents, event))
    }
    this.emit(IPC.recorderPhase, this.status())
    this.emitStatus()
  }

  pause(): RecorderStatus {
    if (!this.session || this.session.phase !== 'recording') return this.status()
    this.session.phase = 'paused'
    this.pausedAt = Date.now()
    inputCapture.pause()
    this.emit(IPC.recorderPhase, this.status())
    this.emitStatus()
    return this.status()
  }

  resume(): RecorderStatus {
    if (!this.session || this.session.phase !== 'paused') return this.status()
    this.pausedTotal += Date.now() - this.pausedAt
    this.pausedAt = 0
    this.session.phase = 'recording'
    inputCapture.resume()
    this.emit(IPC.recorderPhase, this.status())
    this.emitStatus()
    return this.status()
  }

  reportDroppedFrames(count: number): void {
    this.droppedFrames = Math.max(this.droppedFrames, Math.round(count))
  }

  appendChunk(sessionId: string, chunk: Buffer): void {
    if (!this.session || this.session.id !== sessionId) return
    if (!this.stream) {
      this.stream = createWriteStream(this.session.rawPath, { flags: 'a' })
      this.streamClosed = new Promise((resolve, reject) => {
        this.stream?.on('close', () => resolve())
        this.stream?.on('error', (error) => {
          logger.error('recorder', 'raw write failed', error)
          reject(error)
        })
      })
    }
    this.stream.write(chunk)
    this.bytes += chunk.length
  }

  async stop(): Promise<RecordingResult> {
    if (!this.session) throw new Error('No active recording session')
    if (this.finalising) return this.finalising
    const session = this.session
    session.phase = 'finalizing'
    this.emit(IPC.recorderPhase, this.status())
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }

    this.finalising = (async () => {
      const events = await inputCapture.stop(session.eventsPath)
      if (this.stream) {
        await new Promise<void>((resolve) => this.stream?.end(resolve))
        this.stream = null
      }
      await this.streamClosed?.catch(() => undefined)
      const result = await this.finalise(session, events)
      this.session = null
      this.lastResult = result
      this.emit(IPC.recorderFinalized, result)
      this.emitStatus()
      return result
    })()

    try {
      return await this.finalising
    } catch (error) {
      this.lastError = (error as Error).message
      session.phase = 'error'
      session.error = this.lastError
      this.emit(IPC.recorderPhase, this.status())
      this.session = null
      throw error
    } finally {
      this.finalising = null
    }
  }

  async cancel(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.countdownTimer) clearInterval(this.countdownTimer)
    this.tickTimer = null
    this.countdownTimer = null
    await inputCapture.stop(null)
    if (this.stream) {
      await new Promise<void>((resolve) => this.stream?.end(resolve))
      this.stream = null
    }
    if (this.session) {
      await remove(this.session.dir)
      logger.info('recorder', 'recording cancelled', { id: this.session.id })
    }
    this.session = null
    this.bytes = 0
    this.startedAt = 0
    this.pausedTotal = 0
    this.pausedAt = 0
    this.emit(IPC.recorderPhase, this.status())
    this.emitStatus()
  }

  private async finalise(session: RecordingSession, events: InputEventRecord[]): Promise<RecordingResult> {
    const paths = getPaths()
    const settings = await loadSettings()
    const rawStat = await stat(session.rawPath)
    if (!rawStat || rawStat.size === 0) {
      throw new Error('The capture produced no video data. Check that the capture source still exists and try again.')
    }

    const extension = session.request.format === 'mkv' ? 'mkv' : 'mp4'
    const baseName = `SkyRec_${timestamp()}`
    let outputPath = path.join(paths.recordings, `${baseName}.${extension}`)
    const probe = await probeMedia(session.rawPath)
    const durationMs = probe?.duration ? Math.round(probe.duration * 1000) : Math.max(0, Date.now() - session.startedAt)

    let warning: string | null = null
    try {
      const encoders = await detectEncoders()
      const choice = encoderChoiceFor(extension === 'mkv' ? 'mkv' : 'mp4', settings.encoder, encoders)
      const bitrate = QUALITY_BITRATE[session.request.quality] * 1_000_000
      const args = [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-fflags',
        '+genpts',
        '-i',
        session.rawPath,
        '-c:v',
        choice.videoCodec,
        ...choice.args,
        '-b:v',
        String(bitrate),
        '-maxrate',
        String(Math.round(bitrate * 1.5)),
        '-bufsize',
        String(Math.round(bitrate * 2)),
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-movflags',
        '+faststart',
        outputPath
      ]
      logger.info('recorder', 'transcoding capture', { sessionId: session.id, encoder: choice.videoCodec })
      await runFfmpeg(args, { timeoutMs: 30 * 60_000 })
    } catch (error) {
      warning = `Video conversion failed (${(error as Error).message}). The raw WebM capture was kept instead.`
      logger.error('recorder', 'transcode failed, keeping raw capture', error)
      const fallback = path.join(paths.recordings, `${baseName}.webm`)
      try {
        await runFfmpeg(['-hide_banner', '-nostdin', '-y', '-fflags', '+genpts', '-i', session.rawPath, '-c', 'copy', fallback], {
          timeoutMs: 10 * 60_000
        })
        outputPath = fallback
      } catch (copyError) {
        logger.error('recorder', 'raw remux failed too', copyError)
        outputPath = session.rawPath
      }
    }

    const outputProbe = await probeMedia(outputPath)
    const outputStat = await stat(outputPath)
    const result: RecordingResult = {
      sessionId: session.id,
      outputPath,
      rawPath: session.rawPath,
      durationMs: outputProbe?.duration ? Math.round(outputProbe.duration * 1000) : durationMs,
      width: outputProbe?.width || session.request.targetWidth,
      height: outputProbe?.height || session.request.targetHeight,
      fps: outputProbe?.fps ? Math.round(outputProbe.fps) : session.request.fps,
      sizeBytes: outputStat?.size ?? 0,
      eventsPath: session.eventsPath,
      events,
      request: session.request,
      startedAt: session.startedAt
    }

    await writeJson(path.join(session.dir, 'result.json'), { result, warning })
    await writeJson(path.join(session.dir, 'session.json'), {
      session: { ...session, phase: 'completed' },
      completed: true,
      resultPath: path.join(session.dir, 'result.json')
    } satisfies StoredSession)
    logger.info('recorder', 'recording completed', { outputPath, durationMs: result.durationMs, sizeBytes: result.sizeBytes })
    if (warning) this.lastError = warning
    return result
  }

  async listRecoveries(): Promise<RecoveryEntry[]> {
    const paths = getPaths()
    const dirs = await readDir(paths.sessions)
    const entries: RecoveryEntry[] = []
    for (const dir of dirs) {
      if (!dir.isDirectory) continue
      const stored = await readJson<StoredSession>(path.join(paths.sessions, dir.name, 'session.json'))
      if (!stored?.session) continue
      const raw = await stat(stored.session.rawPath)
      if (!raw || raw.size === 0) continue
      if (stored.completed && (await exists(path.join(paths.sessions, dir.name, 'result.json')))) continue
      entries.push({
        id: stored.session.id,
        dir: stored.session.dir,
        rawPath: stored.session.rawPath,
        createdAt: new Date(stored.session.startedAt).toISOString(),
        sizeBytes: raw.size,
        request: stored.session.request ?? null,
        state: 'interrupted'
      })
    }
    entries.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    return entries
  }

  async recover(id: string): Promise<RecordingResult> {
    const paths = getPaths()
    const dir = path.join(paths.sessions, id)
    const stored = await readJson<StoredSession & { captureInputEvents?: boolean }>(path.join(dir, 'session.json'))
    if (!stored?.session) throw new Error('Recovery data not found for this session')
    const session = stored.session
    if (!(await exists(session.rawPath))) throw new Error('The interrupted capture file is missing')
    const events = (await readJson<InputEventRecord[]>(session.eventsPath)) ?? []
    const result = await this.finalise({ ...session, phase: 'finalizing' }, events)
    this.lastResult = result
    this.emit(IPC.recorderFinalized, result)
    return result
  }

  /** Graceful shutdown: keep whatever was captured so it can be recovered. */
  async shutdown(): Promise<void> {
    if (!this.session) return
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.countdownTimer) clearInterval(this.countdownTimer)
    this.tickTimer = null
    this.countdownTimer = null
    await inputCapture.stop(this.session.eventsPath)
    if (this.stream) {
      await new Promise<void>((resolve) => this.stream?.end(resolve))
      this.stream = null
    }
    try {
      await writeJson(path.join(this.session.dir, 'session.json'), {
        session: { ...this.session, phase: 'error', error: 'Application closed during recording' },
        completed: false,
        resultPath: null
      } satisfies StoredSession)
    } catch (error) {
      logger.warn('recorder', 'failed to persist interrupted session', error)
    }
    logger.warn('recorder', 'recording interrupted by shutdown', { id: this.session.id })
    this.session = null
  }

  lastRecording(): RecordingResult | null {
    return this.lastResult
  }
}

// Settings are cached in the settings service; this sync peek avoids making the
// countdown path async while still reading the user's real preferences.
let settingsPeek: Awaited<ReturnType<typeof loadSettings>> | null = null
export function primeRecorderSettings(settings: Awaited<ReturnType<typeof loadSettings>>): void {
  settingsPeek = settings
}
function loadSettingsSync(): Awaited<ReturnType<typeof loadSettings>> | null {
  return settingsPeek
}

export const recorder = new RecorderService()
