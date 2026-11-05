/**
 * Frame-accurate editor preview.
 *
 * Renders the project model onto a canvas: every video track is composited in
 * order with crop / zoom / pan / transitions, then the text layer and the
 * cursor effects are drawn on top using the shared drawing code.
 */
import type { Clip, Project } from '@shared/types'
import { buildEffectTimeline, cursorAt, type EffectTimeline } from '@shared/effect-timeline'
import { renderOneShot } from '@shared/effects-audio'
import { clamp, snapToFrame } from '@shared/time'
import { drawFx, drawTextClips, zoomProgressAt } from './fx'

interface PreviewOptions {
  onTime: (seconds: number) => void
  onPlayingChange: (playing: boolean) => void
}

export class PreviewEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private project: Project | null = null
  private videos = new Map<string, HTMLVideoElement>()
  private audioCtx: AudioContext | null = null
  private fxBuffers = new Map<string, AudioBuffer>()
  private effects: EffectTimeline = { moves: [], clicks: [], keys: [], duration: 0, empty: true }
  private playing = false
  private raf = 0
  private lastTime = 0
  private position = 0
  private lastSoundTime = -1
  private options: PreviewOptions
  private volume = 1

  constructor(canvas: HTMLCanvasElement, options: PreviewOptions) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.ctx = ctx
    this.options = options
  }

  setProject(project: Project): void {
    const changedSource = this.project?.id !== project.id
    this.project = project
    this.effects = buildEffectTimeline(project)
    if (changedSource) this.releaseVideos()
    this.canvas.width = project.width
    this.canvas.height = project.height
    if (!this.playing) this.render(this.position)
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1)
  }

  getPosition(): number {
    return this.position
  }

  isPlaying(): boolean {
    return this.playing
  }

  duration(): number {
    if (!this.project) return 0
    return Math.max(0.1, this.project.duration)
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx
    try {
      this.audioCtx = new AudioContext({ sampleRate: 48000 })
      return this.audioCtx
    } catch {
      return null
    }
  }

  private bufferFor(kind: 'click-left' | 'click-right' | 'key'): AudioBuffer | null {
    const pack = this.project?.cursor.pack ?? 'soft'
    const key = `${pack}:${kind}`
    const cached = this.fxBuffers.get(key)
    if (cached) return cached
    const audio = this.ensureAudioContext()
    if (!audio) return null
    const samples = renderOneShot(pack, kind)
    const buffer = audio.createBuffer(1, samples.length, audio.sampleRate)
    buffer.getChannelData(0).set(samples)
    this.fxBuffers.set(key, buffer)
    return buffer
  }

  private playEffectsRange(from: number, to: number): void {
    const project = this.project
    if (!project || to <= from) return
    const settings = project.cursor
    if (!settings.enabled) return
    const audio = this.ensureAudioContext()
    if (!audio) return
    if (audio.state === 'suspended') void audio.resume()
    const now = audio.currentTime + 0.02
    if (settings.clickSounds) {
      for (const click of this.effects.clicks) {
        if (click.t > from && click.t <= to) {
          const buffer = this.bufferFor(click.button === 'right' ? 'click-right' : 'click-left')
          if (!buffer) continue
          const source = audio.createBufferSource()
          source.buffer = buffer
          const gain = audio.createGain()
          gain.gain.value = settings.volume * 0.9
          source.connect(gain).connect(audio.destination)
          source.start(now)
        }
      }
    }
    if (settings.keyboardSounds) {
      for (const key of this.effects.keys) {
        if (key.t > from && key.t <= to) {
          const buffer = this.bufferFor('key')
          if (!buffer) continue
          const source = audio.createBufferSource()
          source.buffer = buffer
          const gain = audio.createGain()
          gain.gain.value = settings.volume * 0.7
          source.connect(gain).connect(audio.destination)
          source.start(now)
        }
      }
    }
  }

  private videoFor(path: string): HTMLVideoElement | null {
    const existing = this.videos.get(path)
    if (existing) return existing
    try {
      const video = document.createElement('video')
      video.src = window.api.app.mediaUrl(path)
      video.preload = 'auto'
      video.muted = false
      video.playsInline = true
      video.load()
      this.videos.set(path, video)
      return video
    } catch {
      return null
    }
  }

  private releaseVideos(): void {
    for (const video of this.videos.values()) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    this.videos.clear()
  }

  private activeVideoClips(time: number): Clip[] {
    const project = this.project
    if (!project) return []
    const visibleTracks = project.tracks.filter((track) => track.kind === 'video' && !track.hidden).map((track) => track.id)
    return project.clips
      .filter((clip) => visibleTracks.includes(clip.trackId) && clip.sourcePath && clip.kind !== 'text' && clip.kind !== 'audio')
      .filter((clip) => time >= clip.start - 0.001 && time < clip.start + clip.duration - 0.001)
      .sort((a, b) => {
        const trackA = visibleTracks.indexOf(a.trackId)
        const trackB = visibleTracks.indexOf(b.trackId)
        if (trackA !== trackB) return trackA - trackB
        return a.start - b.start
      })
  }

  private drawClip(clip: Clip, time: number, playing: boolean): void {
    const project = this.project
    if (!project || !clip.sourcePath) return
    const video = this.videoFor(clip.sourcePath)
    if (!video) return
    const local = time - clip.start
    const target = clip.inPoint + local * (clip.speed || 1)

    if (playing) {
      video.playbackRate = clamp(clip.speed || 1, 0.1, 16)
      if (video.paused && video.readyState >= 2) void video.play().catch(() => undefined)
      if (video.readyState >= 2 && Math.abs(video.currentTime - target) > 0.25) {
        video.currentTime = Math.max(0, target)
      }
    } else {
      if (!video.paused) video.pause()
      if (video.readyState >= 2 && Math.abs(video.currentTime - target) > 0.04) {
        video.currentTime = Math.max(0, target)
      }
    }

    const track = project.tracks.find((entry) => entry.id === clip.trackId)
    const gain = clamp(clip.volume, 0, 4) * (track?.volume ?? 1) * this.volume
    video.volume = clamp(gain, 0, 1)
    video.muted = clip.muted || (track?.muted ?? false) || gain <= 0.001

    if (video.readyState < 2) return
    const sourceWidth = video.videoWidth || clip.sourceWidth || project.width
    const sourceHeight = video.videoHeight || clip.sourceHeight || project.height
    if (!sourceWidth || !sourceHeight) return

    const canvasWidth = project.width
    const canvasHeight = project.height
    const crop = clip.crop ?? { x: 0, y: 0, width: 1, height: 1 }
    const sx = clamp(crop.x, 0, 1) * sourceWidth
    const sy = clamp(crop.y, 0, 1) * sourceHeight
    const sw = Math.max(1, clamp(crop.width, 0.02, 1) * sourceWidth)
    const sh = Math.max(1, clamp(crop.height, 0.02, 1) * sourceHeight)

    // Cover-fit the cropped region into the canvas.
    const cover = Math.max(canvasWidth / sw, canvasHeight / sh)
    const zoomProgress = zoomProgressAt(clip, local)
    const zoomAmount = clip.zoom?.enabled ? clamp(clip.zoom.amount, 0, 2) : 0
    const zoom = clamp(clip.transform.scale, 1, 3) * (1 + zoomAmount * zoomProgress)
    const panX = clamp(0.5 + clip.transform.x, 0, 1)
    const panY = clamp(0.5 + clip.transform.y, 0, 1)
    const focusX = clip.zoom?.enabled ? clamp(clip.zoom.focus.x, 0, 1) : 0.5
    const focusY = clip.zoom?.enabled ? clamp(clip.zoom.focus.y, 0, 1) : 0.5
    const centerX = clamp(panX + (focusX - 0.5) * zoomProgress, 0, 1)
    const centerY = clamp(panY + (focusY - 0.5) * zoomProgress, 0, 1)

    const visibleWidth = (canvasWidth / (cover * zoom)) / sw
    const visibleHeight = (canvasHeight / (cover * zoom)) / sh
    const visibleSourceX = sx + clamp(centerX, 0, 1) * (sw - visibleWidth * sw)
    const visibleSourceY = sy + clamp(centerY, 0, 1) * (sh - visibleHeight * sh)
    const sourceW = Math.max(1, visibleWidth * sw)
    const sourceH = Math.max(1, visibleHeight * sh)

    const fadeIn = clip.fadeIn > 0 ? clamp(local / clip.fadeIn, 0, 1) : 1
    const fadeOut = clip.fadeOut > 0 ? clamp((clip.duration - local) / clip.fadeOut, 0, 1) : 1
    const transition = clip.transitionIn ? clamp(local / Math.max(0.01, clip.transitionIn.duration), 0, 1) : 1
    const alpha = clamp(clip.transform.opacity, 0, 1) * Math.min(fadeIn, fadeOut) * transition

    this.ctx.save()
    this.ctx.globalAlpha = alpha
    this.ctx.drawImage(video, visibleSourceX, visibleSourceY, sourceW, sourceH, 0, 0, canvasWidth, canvasHeight)
    this.ctx.restore()
  }

  render(time: number): void {
    const project = this.project
    if (!project) return
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = project.backgroundColor
    ctx.fillRect(0, 0, project.width, project.height)
    ctx.restore()

    const playing = this.playing
    for (const clip of this.activeVideoClips(time)) this.drawClip(clip, time, playing)

    drawTextClips(ctx, project, time, project.width, project.height)

    if (project.cursor.enabled && !this.effects.empty) {
      const cursor = cursorAt(this.effects, time, project.cursor.smoothCursor)
      drawFx(ctx, {
        width: project.width,
        height: project.height,
        scale: project.height / 1080,
        time,
        settings: project.cursor,
        cursor,
        clicks: this.effects.clicks,
        keys: this.effects.keys
      })
    }
  }

  seek(seconds: number): void {
    this.position = clamp(snapToFrame(seconds, this.project?.fps ?? 30), 0, this.duration())
    this.render(this.position)
    this.options.onTime(this.position)
  }

  play(from?: number): void {
    if (!this.project) return
    if (from !== undefined) this.seek(from)
    if (this.position >= this.duration() - 0.02) this.position = 0
    this.playing = true
    this.lastTime = performance.now()
    this.lastSoundTime = this.position
    this.options.onPlayingChange(true)
    this.ensureAudioContext()
    const tick = (now: number): void => {
      if (!this.playing) return
      const delta = Math.min(0.25, (now - this.lastTime) / 1000)
      this.lastTime = now
      this.position += delta
      if (this.position >= this.duration()) {
        this.position = this.duration()
        this.render(this.position)
        this.options.onTime(this.position)
        this.pause()
        return
      }
      this.render(this.position)
      this.playEffectsRange(this.lastSoundTime, this.position)
      this.lastSoundTime = this.position
      this.options.onTime(this.position)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  pause(): void {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.options.onPlayingChange(false)
    for (const video of this.videos.values()) video.pause()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  dispose(): void {
    this.pause()
    this.releaseVideos()
    void this.audioCtx?.close()
    this.audioCtx = null
  }
}
