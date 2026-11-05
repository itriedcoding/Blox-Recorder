import { spawn } from 'node:child_process'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { EncoderChoice } from '@shared/filtergraph'
import type { EncoderInfo, ExportFormat, EncoderKind, MediaProbe, SilenceRange } from '@shared/types'
import { clamp } from '@shared/time'
import { ensureDir, exists } from './fsx'
import { getPaths, resolveBundledBinary } from './paths'
import { logger } from './logger'

let ffmpegPathCache: string | null = null
let ffprobePathCache: string | null = null
let versionCache: string | null = null
let encoderCache: EncoderInfo[] | null = null

export interface BinaryOverrides {
  ffmpegPath: string
  ffprobePath: string
}

let overrides: BinaryOverrides = { ffmpegPath: '', ffprobePath: '' }

export function setBinaryOverrides(next: BinaryOverrides): void {
  if (next.ffmpegPath !== overrides.ffmpegPath) {
    ffmpegPathCache = null
    versionCache = null
    encoderCache = null
  }
  if (next.ffprobePath !== overrides.ffprobePath) ffprobePathCache = null
  overrides = next
}

export async function getFfmpegPath(): Promise<string> {
  if (ffmpegPathCache) return ffmpegPathCache
  if (overrides.ffmpegPath) {
    if (await exists(overrides.ffmpegPath)) {
      ffmpegPathCache = overrides.ffmpegPath
      return ffmpegPathCache
    }
    logger.warn('ffmpeg', 'configured ffmpeg path does not exist, falling back to bundled binary', { path: overrides.ffmpegPath })
  }
  const resolved = await resolveBundledBinary(ffmpegStatic ? String(ffmpegStatic) : null)
  ffmpegPathCache = resolved ?? 'ffmpeg'
  return ffmpegPathCache
}

export async function getFfprobePath(): Promise<string> {
  if (ffprobePathCache) return ffprobePathCache
  if (overrides.ffprobePath) {
    if (await exists(overrides.ffprobePath)) {
      ffprobePathCache = overrides.ffprobePath
      return ffprobePathCache
    }
    logger.warn('ffmpeg', 'configured ffprobe path does not exist, falling back to bundled binary', { path: overrides.ffprobePath })
  }
  const candidate = ffprobeStatic && typeof ffprobeStatic === 'object' ? ffprobeStatic.path : null
  const resolved = await resolveBundledBinary(candidate ? String(candidate) : null)
  ffprobePathCache = resolved ?? 'ffprobe'
  return ffprobePathCache
}

export interface RunOptions {
  cwd?: string
  onProgress?: (progress: { timeMs: number; fps: number; speed: number; frame: number }) => void
  onStderr?: (chunk: string) => void
  signal?: AbortSignal
  timeoutMs?: number
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'FfmpegError'
  }
}

function spawnCollect(binary: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, cwd: options.cwd })
    let stdout = ''
    let stderr = ''
    let settled = false
    let killedByTimeout = false

    const timer = options.timeoutMs
      ? setTimeout(() => {
          killedByTimeout = true
          child.kill('SIGKILL')
        }, options.timeoutMs)
      : null

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text
      if (options.onProgress) {
        for (const line of text.split(/\r?\n/)) {
          const [key, value] = line.split('=')
          if (!key || value === undefined) continue
          if (key === 'out_time_us' || key === 'out_time_ms') {
            const micros = Number(value)
            if (Number.isFinite(micros)) lastProgress.timeMs = micros / 1000
          } else if (key === 'fps') {
            const fps = Number(value)
            if (Number.isFinite(fps)) lastProgress.fps = fps
          } else if (key === 'speed') {
            const speed = Number(String(value).replace('x', ''))
            if (Number.isFinite(speed)) lastProgress.speed = speed
          } else if (key === 'frame') {
            const frame = Number(value)
            if (Number.isFinite(frame)) lastProgress.frame = frame
            options.onProgress({ ...lastProgress })
          } else if (key === 'progress') {
            options.onProgress({ ...lastProgress })
          }
        }
      }
    })
    const lastProgress = { timeMs: 0, fps: 0, speed: 0, frame: 0 }

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      if (stderr.length > 240_000) stderr = stderr.slice(-160_000)
      options.onStderr?.(text)
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(new FfmpegError(`Failed to start ${path.basename(binary)}: ${error.message}`, null, stderr))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (killedByTimeout) {
        reject(new FfmpegError('FFmpeg timed out', code, stderr))
        return
      }
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

export async function runFfmpeg(args: string[], options: RunOptions = {}): Promise<RunResult> {
  const binary = await getFfmpegPath()
  const result = await spawnCollect(binary, args, options)
  if (result.code !== 0) {
    const tail = result.stderr.trim().split(/\r?\n/).slice(-12).join('\n')
    throw new FfmpegError(`FFmpeg exited with code ${result.code}`, result.code, tail)
  }
  return result
}

export async function getFfmpegVersion(): Promise<string | null> {
  if (versionCache) return versionCache
  try {
    const binary = await getFfmpegPath()
    const result = await spawnCollect(binary, ['-hide_banner', '-version'], { timeoutMs: 15_000 })
    const first = result.stdout.split(/\r?\n/)[0] ?? ''
    versionCache = first.replace(/^ffmpeg version\s*/i, '').split(' ')[0] || null
  } catch (error) {
    logger.warn('ffmpeg', 'unable to read ffmpeg version', error)
    versionCache = null
  }
  return versionCache
}

const VIDEO_ENCODER_KINDS: Record<string, EncoderKind> = {
  h264_nvenc: 'nvidia',
  hevc_nvenc: 'nvidia',
  av1_nvenc: 'nvidia',
  h264_qsv: 'intel',
  hevc_qsv: 'intel',
  h264_amf: 'amd',
  hevc_amf: 'amd',
  libx264: 'cpu',
  libx265: 'cpu',
  'libvpx-vp9': 'cpu'
}

const ENCODER_LABELS: Record<string, string> = {
  h264_nvenc: 'NVIDIA NVENC H.264',
  hevc_nvenc: 'NVIDIA NVENC HEVC',
  h264_qsv: 'Intel Quick Sync H.264',
  h264_amf: 'AMD AMF H.264',
  libx264: 'CPU x264',
  'libvpx-vp9': 'CPU VP9'
}

export async function detectEncoders(force = false): Promise<EncoderInfo[]> {
  if (encoderCache && !force) return encoderCache
  let available = new Set<string>()
  try {
    const binary = await getFfmpegPath()
    const result = await spawnCollect(binary, ['-hide_banner', '-encoders'], { timeoutMs: 20_000 })
    available = new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*V[\w.]{5}\s+(\S+)/)?.[1])
        .filter((name): name is string => Boolean(name))
    )
  } catch (error) {
    logger.error('ffmpeg', 'encoder detection failed', error)
  }
  const encoders: EncoderInfo[] = Object.keys(VIDEO_ENCODER_KINDS).map((name) => ({
    name,
    kind: VIDEO_ENCODER_KINDS[name],
    available: available.has(name),
    label: ENCODER_LABELS[name] ?? name
  }))
  encoderCache = encoders
  return encoders
}

export function encoderChoiceFor(format: ExportFormat, kind: EncoderKind, encoders: EncoderInfo[]): EncoderChoice {
  const has = (name: string): boolean => encoders.some((encoder) => encoder.name === name && encoder.available)
  if (format === 'webm') {
    return {
      videoCodec: 'libvpx-vp9',
      audioCodec: 'libopus',
      args: ['-pix_fmt', 'yuv420p'],
      label: 'VP9'
    }
  }
  const wanted: { kind: EncoderKind; codec: string }[] =
    kind === 'auto'
      ? [
          { kind: 'nvidia', codec: 'h264_nvenc' },
          { kind: 'intel', codec: 'h264_qsv' },
          { kind: 'amd', codec: 'h264_amf' }
        ]
      : kind === 'nvidia'
        ? [{ kind: 'nvidia', codec: 'h264_nvenc' }]
        : kind === 'intel'
          ? [{ kind: 'intel', codec: 'h264_qsv' }]
          : kind === 'amd'
            ? [{ kind: 'amd', codec: 'h264_amf' }]
            : []

  for (const candidate of wanted) {
    if (has(candidate.codec)) {
      const args: string[] =
        candidate.codec === 'h264_nvenc'
          ? ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-spatial-aq', '1', '-pix_fmt', 'yuv420p']
          : candidate.codec === 'h264_qsv'
            ? ['-preset', 'veryfast', '-global_quality', '23', '-pix_fmt', 'nv12']
            : ['-quality', 'balanced', '-rc', 'cqp', '-qp_i', '21', '-qp_p', '23', '-pix_fmt', 'yuv420p']
      return { videoCodec: candidate.codec, audioCodec: 'aac', args, label: ENCODER_LABELS[candidate.codec] ?? candidate.codec }
    }
  }

  return {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    args: ['-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2'],
    label: 'CPU x264'
  }
}

export interface ProbeResult extends MediaProbe {
  videoCodec: string | null
  audioCodec: string | null
}

export async function probeMedia(file: string): Promise<ProbeResult | null> {
  if (!(await exists(file))) return null
  try {
    const binary = await getFfprobePath()
    const result = await spawnCollect(binary, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
      timeoutMs: 30_000
    })
    if (result.code !== 0) return null
    const parsed = JSON.parse(result.stdout) as {
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }[]
      format?: { duration?: string; size?: string }
    }
    const streams = parsed.streams ?? []
    const video = streams.find((stream) => stream.codec_type === 'video')
    const audio = streams.find((stream) => stream.codec_type === 'audio')
    const [num, den] = (video?.r_frame_rate ?? '0/1').split('/').map(Number)
    const fps = den ? num / den : 0
    return {
      path: file,
      duration: Number(parsed.format?.duration ?? video?.duration ?? 0) || 0,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      fps: Number.isFinite(fps) ? Math.round(fps * 1000) / 1000 : 0,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
      sizeBytes: Number(parsed.format?.size ?? 0) || 0,
      codec: video?.codec_name ?? null,
      videoCodec: video?.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null
    }
  } catch (error) {
    logger.warn('ffmpeg', 'probe failed', { file, error: (error as Error).message })
    return null
  }
}

export async function thumbnail(file: string, timeSeconds: number, width = 480): Promise<string | null> {
  const paths = getPaths()
  await ensureDir(paths.presetsThumbs)
  const safeName = `${path.basename(file).replace(/[^a-zA-Z0-9_-]/g, '_')}_${Math.round(timeSeconds * 1000)}_${width}.jpg`
  const output = path.join(paths.presetsThumbs, safeName)
  if (await exists(output)) return output
  try {
    await runFfmpeg(
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss',
        clamp(timeSeconds, 0, 86_400).toFixed(3),
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        `scale=${width}:-2:flags=lanczos`,
        '-q:v',
        '4',
        output
      ],
      { timeoutMs: 60_000 }
    )
    return output
  } catch (error) {
    logger.warn('ffmpeg', 'thumbnail failed', { file, error: (error as Error).message })
    return null
  }
}

/** Real waveform peaks decoded from the source audio. */
export async function waveform(file: string, buckets = 900): Promise<number[]> {
  const binary = await getFfmpegPath()
  return new Promise((resolve) => {
    const child = spawn(binary, ['-hide_banner', '-nostdin', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], {
      windowsHide: true
    })
    const chunks: Buffer[] = []
    let total = 0
    const limit = 220 * 1024 * 1024
    child.stdout.on('data', (data: Buffer) => {
      total += data.length
      if (total <= limit) chunks.push(data)
    })
    child.on('error', () => resolve([]))
    child.on('close', () => {
      const buffer = Buffer.concat(chunks)
      if (!buffer.length) {
        resolve([])
        return
      }
      const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2))
      const size = Math.max(1, Math.floor(samples.length / buckets))
      const peaks: number[] = []
      for (let i = 0; i < buckets; i++) {
        let peak = 0
        const start = i * size
        for (let j = start; j < Math.min(start + size, samples.length); j++) {
          const value = Math.abs(samples[j]) / 32768
          if (value > peak) peak = value
        }
        peaks.push(Math.round(peak * 1000) / 1000)
      }
      resolve(peaks)
    })
  })
}

/** Detect silent stretches so the editor can tighten them away. */
export async function detectSilence(file: string, thresholdDb = -35, minDuration = 0.45): Promise<SilenceRange[]> {
  try {
    const result = await runFfmpeg(
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        file,
        '-map',
        '0:a:0',
        '-af',
        `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
        '-f',
        'null',
        '-'
      ],
      { timeoutMs: 180_000 }
    )
    const ranges: SilenceRange[] = []
    let pending: number | null = null
    const lines = result.stderr.split(/\r?\n/)
    for (const line of lines) {
      const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/)
      if (startMatch) pending = Math.max(0, Number(startMatch[1]))
      const endMatch = line.match(/silence_end:\s*([\d.]+)/)
      if (endMatch && pending !== null) {
        ranges.push({ start: pending, end: Number(endMatch[1]) })
        pending = null
      }
    }
    return ranges
  } catch (error) {
    logger.warn('ffmpeg', 'silence detection failed', (error as Error).message)
    return []
  }
}

export function invalidateEncoderCache(): void {
  encoderCache = null
}
