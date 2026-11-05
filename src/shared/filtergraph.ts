/**
 * FFmpeg export graph builder.
 *
 * The project model is compiled into a single filter_complex graph:
 *   - one normalised layer per video clip (trim -> speed -> crop -> zoom/pan ->
 *     fade), time-shifted with tpad and composited with `overlay`
 *   - one padded audio stream per audio-bearing clip (speed via atempo, gain,
 *     fades, delays) mixed with the procedural effect track
 *   - an optional RGBA frame sequence (cursor, click ripples, text overlays)
 *     rendered by the renderer and composited on top
 *
 * Everything here is pure/deterministic so it can be unit-tested without a GPU
 * or a display. Actual encoding is driven by src/main/services/exporter.ts.
 */
import type { Clip, EffectsSettings, ExportSettings, Project } from './types'
import { clamp } from './time'

export interface EncoderChoice {
  /** ffmpeg video codec name, e.g. libx264 / h264_nvenc / libvpx-vp9 */
  videoCodec: string
  audioCodec: string
  /** Extra codec-turning arguments, excluding -b:v etc. */
  args: string[]
  label: string
}

export interface ExportPlanInput {
  project: Project
  settings: ExportSettings
  encoder: EncoderChoice
  effectsWavPath: string | null
  overlayPattern: string | null
  outputPath: string
}

export interface ExportPlan {
  args: string[]
  filter: string
  inputs: string[]
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  hasOverlay: boolean
}

export const X264_FALLBACK: EncoderChoice = {
  videoCodec: 'libx264',
  audioCodec: 'aac',
  args: ['-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2'],
  label: 'CPU (libx264)'
}

const MAX_DIMENSION = 7680

function fixed(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return '0'
  const text = value.toFixed(digits)
  return text.replace(/\.?0+$/, '') || '0'
}

function evenInt(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

/** ffmpeg atempo only accepts 0.5 - 2.0 per instance, so chain it. */
export function atempoChain(speed: number): string {
  const target = clamp(speed, 0.05, 20)
  const filters: string[] = []
  let remaining = target
  while (remaining > 2.0001) {
    filters.push('atempo=2')
    remaining /= 2
  }
  while (remaining < 0.4999) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  if (Math.abs(remaining - 1) > 0.001) filters.push(`atempo=${fixed(remaining, 6)}`)
  return filters.length ? filters.join(',') : 'anull'
}

function hexToFfmpegColor(hex: string): string {
  const cleaned = hex.replace('#', '').trim()
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) return `0x${cleaned.toLowerCase()}`
  return '0x05070b'
}

/**
 * Zoom envelope expression over clip-local time `t`.
 * Returns an expression string that stays inside [0, 1].
 */
export function zoomProgressExpression(clip: Clip): string {
  const zoom = clip.zoom
  if (!zoom?.enabled) return '0'
  const duration = Math.max(0.1, clip.duration)
  const rise = Math.min(0.7, Math.max(0.18, duration * 0.25))
  const hold = clamp(zoom.hold, 0, Math.max(0, duration - rise * 2))
  const fall = Math.max(0.1, Math.min(rise, duration - rise - hold))
  const raw = `if(lt(t,${fixed(rise)}),t/${fixed(rise)},if(lt(t,${fixed(rise + hold)}),1,min(1,max(0,(${fixed(duration)}-t)/${fixed(fall)}))))`
  if (zoom.ease === 'easeInOut') {
    return `((${raw})*(${raw})*(3-2*(${raw})))`
  }
  return raw
}

function buildVideoClipChain(
  clip: Clip,
  inputIndex: number,
  width: number,
  height: number,
  fps: number,
  projectDuration: number,
  isImage: boolean
): string {
  const speed = clamp(clip.speed, 0.1, 20)
  const sourceLength = clip.duration * speed
  const inPoint = Math.max(0, clip.inPoint)
  const outPoint = inPoint + sourceLength
  const parts: string[] = []

  parts.push(`trim=start=${fixed(inPoint)}:end=${fixed(outPoint)}`)
  parts.push(`setpts=(PTS-STARTPTS)/${fixed(speed)}`)
  if (isImage) {
    // Looped still images have no intrinsic duration; normalise the rate only.
    parts.push(`fps=${fps}`)
  } else {
    parts.push(`fps=${fps}`)
  }

  if (clip.crop) {
    const cw = clamp(clip.crop.width, 0.02, 1)
    const ch = clamp(clip.crop.height, 0.02, 1)
    const cx = clamp(clip.crop.x, 0, 1 - cw)
    const cy = clamp(clip.crop.y, 0, 1 - ch)
    parts.push(`crop=w='trunc(iw*${fixed(cw, 5)}/2)*2':h='trunc(ih*${fixed(ch, 5)}/2)*2':x='iw*${fixed(cx, 5)}':y='ih*${fixed(cy, 5)}'`)
  }

  // Cover-fit the source to the canvas, then zoom/pan by cropping a moving
  // window and scaling it back up. This mirrors the preview renderer exactly.
  parts.push(`scale=w=${width}:h=${height}:force_original_aspect_ratio=increase`)
  parts.push(`crop=w=${width}:h=${height}`)

  const baseScale = clamp(clip.transform.scale, 1, 3)
  const zoom = clip.zoom
  const zoomAmount = zoom?.enabled ? clamp(zoom.amount, 0, 2) : 0
  const panX = clamp(0.5 + clip.transform.x, 0, 1)
  const panY = clamp(0.5 + clip.transform.y, 0, 1)
  const focusX = zoom?.enabled ? clamp(zoom.focus.x, 0, 1) : 0.5
  const focusY = zoom?.enabled ? clamp(zoom.focus.y, 0, 1) : 0.5
  const progress = zoomAmount > 0 ? zoomProgressExpression(clip) : '0'
  const zoomExpr = zoomAmount > 0 ? `(${fixed(baseScale)}*(1+${fixed(zoomAmount)}*(${progress})))` : fixed(baseScale)

  if (baseScale > 1 || zoomAmount > 0) {
    // `crop` evaluates w/h only once, so the animated zoom must be expressed as
    // a per-frame upscale followed by a static-size crop of the moving window.
    parts.push(`scale=w='trunc(${width}*(${zoomExpr})/2)*2':h='trunc(${height}*(${zoomExpr})/2)*2':eval=frame`)
    parts.push(
      `crop=w=${width}:h=${height}:x='(iw-ow)*min(1,max(0,${fixed(panX)}+(${fixed(focusX)}-0.5)*(${progress})))':y='(ih-oh)*min(1,max(0,${fixed(panY)}+(${fixed(focusY)}-0.5)*(${progress})))'`
    )
  }
  parts.push('setsar=1')
  parts.push('format=rgba')

  const transitionIn = clip.transitionIn ? clamp(clip.transitionIn.duration, 0, Math.min(2, clip.duration / 2)) : 0
  const fadeIn = Math.max(clamp(clip.fadeIn, 0, clip.duration / 2), transitionIn)
  if (fadeIn > 0.01) {
    parts.push(`fade=t=in:st=0:d=${fixed(fadeIn)}:alpha=1`)
  }
  const fadeOut = clamp(clip.fadeOut, 0, clip.duration / 2)
  if (fadeOut > 0.01) {
    parts.push(`fade=t=out:st=${fixed(clip.duration - fadeOut)}:d=${fixed(fadeOut)}:alpha=1`)
  }

  const start = Math.max(0, clip.start)
  if (start > 0.001) {
    parts.push(`tpad=start_mode=add:start_duration=${fixed(start)}:color=black@0`)
  }
  const tail = projectDuration - (clip.start + clip.duration) + 0.5
  if (tail > 0.001) {
    parts.push(`tpad=stop_mode=add:stop_duration=${fixed(tail)}:color=black@0`)
  }

  return `[${inputIndex}:v]${parts.join(',')}[v${clip.id.replace(/[^a-zA-Z0-9_]/g, '')}]`
}

function buildAudioClipChain(
  clip: Clip,
  inputIndex: number,
  trackVolume: number,
  denoise: boolean,
  isRecordingClip: boolean
): string {
  const speed = clamp(clip.speed, 0.1, 20)
  const sourceLength = clip.duration * speed
  const inPoint = Math.max(0, clip.inPoint)
  const parts: string[] = []

  parts.push(`atrim=start=${fixed(inPoint)}:end=${fixed(inPoint + sourceLength)}`)
  parts.push('asetpts=PTS-STARTPTS')
  parts.push('aresample=48000')
  parts.push('aformat=sample_fmts=fltp:channel_layouts=stereo')
  if (denoise && isRecordingClip) parts.push('afftdn=nf=-28:tn=1')
  if (Math.abs(speed - 1) > 0.001) parts.push(atempoChain(speed))

  const gain = clamp(clip.volume, 0, 4) * clamp(trackVolume, 0, 4)
  if (Math.abs(gain - 1) > 0.001) parts.push(`volume=${fixed(gain)}`)
  const fadeIn = clamp(clip.fadeIn, 0, clip.duration)
  if (fadeIn > 0.01) parts.push(`afade=t=in:st=0:d=${fixed(fadeIn)}:curve=tri`)
  const fadeOut = clamp(clip.fadeOut, 0, clip.duration)
  if (fadeOut > 0.01) parts.push(`afade=t=out:st=${fixed(clip.duration - fadeOut)}:d=${fixed(fadeOut)}:curve=tri`)

  const delayMs = Math.max(0, Math.round(clip.start * 1000))
  if (delayMs > 0) parts.push(`adelay=delays=${delayMs}:all=1`)

  return `[${inputIndex}:a]${parts.join(',')}[a${clip.id.replace(/[^a-zA-Z0-9_]/g, '')}]`
}

function effectVolume(effects: EffectsSettings): number {
  return effects.enabled && (effects.clickSounds || effects.keyboardSounds) ? clamp(effects.volume, 0, 1) : 0
}

export function buildExportPlan(input: ExportPlanInput): ExportPlan {
  const { project, settings, encoder, effectsWavPath, overlayPattern, outputPath } = input
  const width = evenInt(clamp(settings.width, 16, MAX_DIMENSION))
  const height = evenInt(clamp(settings.height, 16, MAX_DIMENSION))
  const fps = clamp(settings.fps, 1, 240)
  const projectDuration = Math.max(0.2, project.duration || project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) || 1)

  const videoTracks = project.tracks.filter((track) => track.kind === 'video')
  const audioTracks = project.tracks.filter((track) => track.kind === 'audio')

  const inputPaths: string[] = []
  const inputIndex = new Map<string, number>()
  const inputIsImage = new Map<string, boolean>()
  const registerInput = (path: string, image: boolean): number => {
    const existing = inputIndex.get(path)
    if (existing !== undefined) return existing
    const index = inputPaths.length
    inputPaths.push(path)
    inputIndex.set(path, index)
    inputIsImage.set(path, image)
    return index
  }

  const usedVideoClips: { clip: Clip; index: number }[] = []
  for (const track of videoTracks) {
    if (track.hidden) continue
    const clips = project.clips
      .filter((clip) => clip.trackId === track.id && clip.kind !== 'text' && clip.sourcePath)
      .sort((a, b) => a.start - b.start)
    for (const clip of clips) {
      usedVideoClips.push({ clip, index: registerInput(clip.sourcePath as string, clip.kind === 'image') })
    }
  }

  const usedAudioClips: { clip: Clip; index: number; trackVolume: number; isRecording: boolean }[] = []
  const recordingClip = project.clips.find((clip) => clip.sourcePath && clip.sourcePath === project.recording?.outputPath)
  for (const track of [...videoTracks, ...audioTracks]) {
    if (track.muted) continue
    const clips = project.clips
      .filter((clip) => clip.trackId === track.id && clip.hasAudio && !clip.muted && clip.sourcePath && clip.kind !== 'text' && clip.kind !== 'image')
      .sort((a, b) => a.start - b.start)
    for (const clip of clips) {
      usedAudioClips.push({
        clip,
        index: registerInput(clip.sourcePath as string, false),
        trackVolume: track.volume,
        isRecording: recordingClip ? clip.id === recordingClip.id : clip.kind === 'video'
      })
    }
  }

  let effectsIndex: number | null = null
  if (effectsWavPath) {
    effectsIndex = inputPaths.length
    inputPaths.push(effectsWavPath)
  }
  let overlayIndex: number | null = null
  if (overlayPattern) {
    overlayIndex = inputPaths.length
    inputPaths.push(overlayPattern)
  }

  const filters: string[] = []
  for (const { clip, index } of usedVideoClips) {
    filters.push(buildVideoClipChain(clip, index, width, height, fps, projectDuration, inputIsImage.get(clip.sourcePath as string) === true))
  }

  const audioLabels: string[] = []
  const denoise = settings.denoise
  for (const { clip, index, trackVolume, isRecording } of usedAudioClips) {
    filters.push(buildAudioClipChain(clip, index, trackVolume, denoise, isRecording))
    audioLabels.push(`[a${clip.id.replace(/[^a-zA-Z0-9_]/g, '')}]`)
  }

  if (effectsIndex !== null && effectVolume(project.cursor) > 0) {
    filters.push(`[${effectsIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${fixed(effectVolume(project.cursor))}[afx]`)
    audioLabels.push('[afx]')
  }

  let hasAudio = false
  let audioOut = ''
  if (audioLabels.length === 1) {
    filters.push(`${audioLabels[0]}volume=${fixed(clamp(project.masterVolume, 0, 4))},alimiter=limit=0.95[aout]`)
    hasAudio = true
    audioOut = '[aout]'
  } else if (audioLabels.length > 1) {
    filters.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,volume=${fixed(clamp(project.masterVolume, 0, 4))},alimiter=limit=0.95[aout]`
    )
    hasAudio = true
    audioOut = '[aout]'
  }

  // ---- video compositing -------------------------------------------------
  filters.push(`color=c=${hexToFfmpegColor(project.backgroundColor)}:s=${width}x${height}:r=${fps}:d=${fixed(projectDuration)}[bg]`)

  let previous = '[bg]'
  let layerCount = 0
  for (const track of videoTracks) {
    if (track.hidden) continue
    const layers = usedVideoClips.filter((entry) => entry.clip.trackId === track.id)
    for (const { clip } of layers) {
      const label = `[v${clip.id.replace(/[^a-zA-Z0-9_]/g, '')}]`
      const out = `[vc${layerCount}]`
      filters.push(`${previous}${label}overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto${out}`)
      previous = out
      layerCount++
    }
  }

  let hasOverlay = false
  if (overlayIndex !== null) {
    filters.push(`[${overlayIndex}:v]format=rgba,setsar=1[ovlsrc]`)
    filters.push(`${previous}[ovlsrc]overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto[ovlout]`)
    previous = '[ovlout]'
    hasOverlay = true
  }

  filters.push(`${previous}format=yuv420p[vout]`)

  // ---- arguments ---------------------------------------------------------
  const args: string[] = ['-hide_banner', '-nostdin', '-y']
  inputPaths.forEach((path, index) => {
    if (overlayIndex !== null && index === overlayIndex) {
      args.push('-framerate', String(fps), '-i', path)
      return
    }
    if (inputIsImage.get(path)) {
      args.push('-loop', '1', '-framerate', String(fps), '-t', fixed(projectDuration + 1), '-i', path)
      return
    }
    args.push('-i', path)
  })

  args.push('-filter_complex', filters.join(';'))
  args.push('-map', '[vout]')
  if (hasAudio) args.push('-map', audioOut)

  const videoBitrate = Math.max(1, settings.bitrateMbps) * 1_000_000
  args.push('-c:v', encoder.videoCodec)
  args.push(...encoder.args)
  if (encoder.videoCodec === 'libvpx-vp9') {
    args.push('-b:v', String(Math.round(videoBitrate)), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2')
  } else if (encoder.videoCodec === 'libx264' || encoder.videoCodec === 'libx265') {
    args.push('-maxrate', String(Math.round(videoBitrate * 1.5)), '-bufsize', String(Math.round(videoBitrate * 3)))
  } else {
    args.push('-b:v', String(Math.round(videoBitrate)), '-maxrate', String(Math.round(videoBitrate * 1.4)), '-bufsize', String(Math.round(videoBitrate * 2)))
  }

  if (hasAudio) {
    args.push('-c:a', encoder.audioCodec, '-b:a', `${Math.max(64, settings.audioBitrateKbps)}k`, '-ar', '48000')
  }

  if (settings.format === 'mp4') args.push('-movflags', '+faststart')
  args.push('-t', fixed(projectDuration))
  args.push('-r', String(fps))
  args.push('-progress', 'pipe:1', '-nostats')
  args.push(outputPath)

  return {
    args,
    filter: filters.join(';'),
    inputs: inputPaths,
    duration: projectDuration,
    width,
    height,
    fps,
    hasAudio,
    hasOverlay
  }
}
