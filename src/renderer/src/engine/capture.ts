/**
 * Real screen-capture engine.
 *
 * Chromium performs the actual desktop capture (Electron's display-media handler
 * picks the source the user selected). Every frame is composited on a canvas at
 * the requested output resolution with the region crop, webcam bubble and the
 * cursor effects burned in, then encoded by MediaRecorder. Mic and system audio
 * are mixed through WebAudio, and the encoder output is streamed to the main
 * process so an interrupted recording is still recoverable on disk.
 */
import type { InputEventRecord, RecordingRequest } from '@shared/types'
import { QUALITY_BITRATE } from '@shared/defaults'
import { renderOneShot } from '@shared/effects-audio'
import { clamp } from '@shared/time'
import { drawFx, type ClickMark, type KeyMark } from './fx'

export interface CaptureCallbacks {
  onChunk: (chunk: ArrayBuffer) => void
  onError: (message: string) => void
  onStats: (stats: { fps: number; droppedFrames: number }) => void
}

const MAX_LIVE_MARKS = 64

export class CaptureEngine {
  private request: RecordingRequest | null = null
  private callbacks: CaptureCallbacks | null = null
  private displayStream: MediaStream | null = null
  private micStream: MediaStream | null = null
  private webcamStream: MediaStream | null = null
  private screenVideo: HTMLVideoElement | null = null
  private webcamVideo: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private audioCtx: AudioContext | null = null
  private fxGain: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private recorder: MediaRecorder | null = null
  private raf = 0
  private running = false
  private paused = false
  private clockStart = 0
  private pausedAt = 0
  private pausedTotal = 0
  private clicks: ClickMark[] = []
  private keys: KeyMark[] = []
  private cursor: { x: number; y: number } | null = null
  private frames = 0
  private dropped = 0
  private lastFrame = 0
  private statsTimer = 0
  private stopResolve: (() => void) | null = null
  private mimeType = ''

  isActive(): boolean {
    return this.running
  }

  elapsed(): number {
    if (!this.running) return 0
    const now = performance.now()
    const paused = this.pausedTotal + (this.pausedAt ? now - this.pausedAt : 0)
    return Math.max(0, (now - this.clockStart - paused) / 1000)
  }

  async start(request: RecordingRequest, callbacks: CaptureCallbacks): Promise<void> {
    this.request = request
    this.callbacks = callbacks
    this.clicks = []
    this.keys = []
    this.cursor = null
    this.frames = 0
    this.dropped = 0
    this.pausedTotal = 0
    this.pausedAt = 0

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: request.fps, max: request.fps } },
      audio: request.systemAudio
    })
    const videoTrack = display.getVideoTracks()[0]
    if (!videoTrack) {
      display.getTracks().forEach((track) => track.stop())
      throw new Error('The selected source did not provide a video track')
    }
    this.displayStream = display

    const screenVideo = document.createElement('video')
    screenVideo.srcObject = display
    screenVideo.muted = true
    screenVideo.playsInline = true
    await screenVideo.play()
    this.screenVideo = screenVideo

    videoTrack.addEventListener('ended', () => {
      callbacks.onError('The shared window or screen was closed. Recording stopped.')
      void this.stop()
    })

    if (request.micDeviceId) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: request.micDeviceId === 'default' ? undefined : { exact: request.micDeviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 2
          }
        })
      } catch (error) {
        callbacks.onError(`Microphone unavailable: ${(error as Error).message}. Recording continues without the microphone.`)
      }
    }

    if (request.webcam.enabled) {
      try {
        this.webcamStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: request.webcam.deviceId ? { exact: request.webcam.deviceId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }
        })
        const webcamVideo = document.createElement('video')
        webcamVideo.srcObject = this.webcamStream
        webcamVideo.muted = true
        webcamVideo.playsInline = true
        await webcamVideo.play()
        this.webcamVideo = webcamVideo
      } catch (error) {
        callbacks.onError(`Webcam unavailable: ${(error as Error).message}. Recording continues without the webcam.`)
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, request.targetWidth)
    canvas.height = Math.max(2, request.targetHeight)
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!ctx) throw new Error('Unable to create the capture canvas')
    this.canvas = canvas
    this.ctx = ctx

    const audio = new AudioContext({ sampleRate: 48000 })
    this.audioCtx = audio
    const destination = audio.createMediaStreamDestination()

    const systemTracks = display.getAudioTracks()
    if (systemTracks.length) {
      const source = audio.createMediaStreamSource(new MediaStream(systemTracks))
      const gain = audio.createGain()
      gain.gain.value = clamp(request.systemGain, 0, 2)
      source.connect(gain).connect(destination)
    }
    if (this.micStream && this.micStream.getAudioTracks().length) {
      const source = audio.createMediaStreamSource(this.micStream)
      const gain = audio.createGain()
      gain.gain.value = clamp(request.micGain, 0, 2)
      source.connect(gain).connect(destination)
    }
    this.fxGain = audio.createGain()
    this.fxGain.gain.value = clamp(request.effects.volume, 0, 1)
    this.fxGain.connect(destination)

    const canvasStream = canvas.captureStream(clamp(request.fps, 1, 144))
    const composite = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()])

    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    this.mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
    const bitrate = QUALITY_BITRATE[request.quality] * 1_000_000

    const recorder = new MediaRecorder(composite, {
      mimeType: this.mimeType || undefined,
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 192_000
    })
    this.recorder = recorder
    recorder.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return
      void event.data
        .arrayBuffer()
        .then((buffer) => this.callbacks?.onChunk(buffer))
        .catch((error: Error) => this.callbacks?.onError(`Failed to hand off captured data: ${error.message}`))
    }
    recorder.onerror = () => {
      this.callbacks?.onError('The media encoder reported an error')
    }
    recorder.onstop = () => {
      this.stopResolve?.()
      this.stopResolve = null
    }
    recorder.start(1000)

    this.running = true
    this.paused = false
    this.clockStart = performance.now()
    this.lastFrame = this.clockStart
    this.statsTimer = window.setInterval(() => {
      this.callbacks?.onStats({ fps: this.request?.fps ?? 0, droppedFrames: this.dropped })
    }, 1000)

    const draw = (now: number): void => {
      if (!this.running) return
      const frameBudget = 1000 / Math.max(1, this.request?.fps ?? 60)
      if (now - this.lastFrame > frameBudget * 2.2) this.dropped += 1
      this.lastFrame = now
      if (!this.paused) this.drawFrame()
      this.frames += 1
      this.raf = requestAnimationFrame(draw)
    }
    this.raf = requestAnimationFrame(draw)
  }

  private drawFrame(): void {
    const ctx = this.ctx
    const canvas = this.canvas
    const request = this.request
    if (!ctx || !canvas || !request) return
    const width = canvas.width
    const height = canvas.height
    ctx.fillStyle = '#05070b'
    ctx.fillRect(0, 0, width, height)

    const video = this.screenVideo
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      const region = request.region.enabled ? request.region : { x: 0, y: 0, width: 1, height: 1 }
      const sw = Math.max(1, region.width * video.videoWidth)
      const sh = Math.max(1, region.height * video.videoHeight)
      const sx = clamp(region.x, 0, 1) * video.videoWidth
      const sy = clamp(region.y, 0, 1) * video.videoHeight
      const cover = Math.max(width / sw, height / sh)
      const dw = sw * cover
      const dh = sh * cover
      ctx.drawImage(video, sx, sy, sw, sh, (width - dw) / 2, (height - dh) / 2, dw, dh)
    }

    this.drawWebcam(ctx, width, height)

    drawFx(ctx, {
      width,
      height,
      scale: height / 1080,
      time: this.elapsed(),
      settings: request.effects,
      cursor: this.cursor,
      clicks: this.clicks,
      keys: this.keys
    })
  }

  private drawWebcam(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const request = this.request
    const video = this.webcamVideo
    if (!request || !video || !request.webcam.enabled || video.readyState < 2) return
    const size = clamp(request.webcam.size, 0.06, 0.4) * width
    const margin = Math.round(width * 0.025)
    const webcam = request.webcam
    let x = width - size - margin
    let y = height - size - margin
    if (webcam.position === 'bottom-left') x = margin
    if (webcam.position === 'top-right') y = margin
    if (webcam.position === 'top-left') {
      x = margin
      y = margin
    }
    x += webcam.offsetX * width
    y += webcam.offsetY * height

    const radius = webcam.shape === 'circle' ? size / 2 : webcam.shape === 'rounded' ? size * 0.18 : size * 0.04
    ctx.save()
    ctx.beginPath()
    if (webcam.shape === 'circle') {
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
    } else {
      const r = radius
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + size, y, x + size, y + size, r)
      ctx.arcTo(x + size, y + size, x, y + size, r)
      ctx.arcTo(x, y + size, x, y, r)
      ctx.arcTo(x, y, x + size, y, r)
    }
    ctx.closePath()
    ctx.clip()

    const vw = video.videoWidth
    const vh = video.videoHeight
    const cover = Math.max(size / vw, size / vh)
    const dw = vw * cover
    const dh = vh * cover
    ctx.translate(x + size / 2, y + size / 2)
    if (webcam.mirrored) ctx.scale(-1, 1)
    ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = 'rgba(34,188,255,0.55)'
    ctx.lineWidth = Math.max(2, size * 0.012)
    ctx.beginPath()
    if (webcam.shape === 'circle') ctx.arc(x + size / 2, y + size / 2, size / 2 - ctx.lineWidth / 2, 0, Math.PI * 2)
    else ctx.rect(x, y, size, size)
    ctx.stroke()
    ctx.restore()
  }

  handleInputEvent(event: InputEventRecord): void {
    if (!this.running || this.paused) return
    const t = this.elapsed()
    if (event.type === 'move') {
      this.cursor = { x: event.x, y: event.y }
      return
    }
    if (event.type === 'down' && event.button !== undefined) {
      this.cursor = { x: event.x, y: event.y }
      this.clicks.push({ t, x: event.x, y: event.y, button: event.button === 2 ? 'right' : 'left' })
      if (this.clicks.length > MAX_LIVE_MARKS) this.clicks = this.clicks.slice(-MAX_LIVE_MARKS)
      this.playEffect(event.button === 2 ? 'click-right' : 'click-left', 0.9)
      return
    }
    if (event.type === 'down' && event.keyId !== undefined) {
      this.keys.push({ t })
      if (this.keys.length > MAX_LIVE_MARKS) this.keys = this.keys.slice(-MAX_LIVE_MARKS)
      this.playEffect('key', 0.7)
    }
  }

  private playEffect(kind: 'click-left' | 'click-right' | 'key', gainValue: number): void {
    const audio = this.audioCtx
    const request = this.request
    if (!audio || !this.fxGain || !request?.effects.enabled) return
    if (kind === 'key' && !request.effects.keyboardSounds) return
    if (kind !== 'key' && !request.effects.clickSounds) return
    const key = `${request.effects.pack}:${kind}`
    let buffer = this.buffers.get(key)
    if (!buffer) {
      const samples = renderOneShot(request.effects.pack, kind)
      buffer = audio.createBuffer(1, samples.length, audio.sampleRate)
      buffer.getChannelData(0).set(samples)
      this.buffers.set(key, buffer)
    }
    const source = audio.createBufferSource()
    source.buffer = buffer
    const gain = audio.createGain()
    gain.gain.value = gainValue
    source.connect(gain).connect(this.fxGain)
    source.start()
  }

  pause(): void {
    if (!this.running || this.paused) return
    this.paused = true
    this.pausedAt = performance.now()
    this.recorder?.pause()
  }

  resume(): void {
    if (!this.running || !this.paused) return
    this.pausedTotal += performance.now() - this.pausedAt
    this.pausedAt = 0
    this.paused = false
    this.recorder?.resume()
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.raf)
    window.clearInterval(this.statsTimer)
    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.stopResolve = resolve
        try {
          recorder.requestData()
        } catch {
          /* some platforms disallow requestData right before stop */
        }
        recorder.stop()
        window.setTimeout(() => resolve(), 3000)
      })
    }
    this.recorder = null
    this.displayStream?.getTracks().forEach((track) => track.stop())
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.webcamStream?.getTracks().forEach((track) => track.stop())
    this.screenVideo?.remove()
    this.webcamVideo?.remove()
    this.screenVideo = null
    this.webcamVideo = null
    this.displayStream = null
    this.micStream = null
    this.webcamStream = null
    this.fxGain = null
    if (this.audioCtx) {
      await this.audioCtx.close().catch(() => undefined)
      this.audioCtx = null
    }
    this.canvas = null
    this.ctx = null
    this.buffers.clear()
    this.request = null
    this.callbacks = null
  }
}

export function supportedRecordingMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}
