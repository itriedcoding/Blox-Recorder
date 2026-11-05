/**
 * End-to-end export test: generates real source media with FFmpeg, compiles a
 * multi-track project into a filter graph, runs the actual encode and verifies
 * the produced file. This is the same code path the app uses on Windows.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildExportPlan } from '@shared/filtergraph'
import { createProject, defaultClip, defaultEffects } from '@shared/defaults'
import { encodeWav, renderEffectsPcm } from '@shared/effects-audio'
import type { ExportSettings } from '@shared/types'

const artifacts = path.resolve(__dirname, '.artifacts')
const ffmpegBin = String(ffmpegStatic)
const ffprobeBin = (ffprobeStatic as unknown as { path: string }).path

function run(binary: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => (stdout += data.toString()))
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    c ^= buffer[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function transparentPng(width: number, height: number, box: boolean): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const index = row + 1 + x * 4
      const inside = box && x > width * 0.4 && x < width * 0.6 && y > height * 0.4 && y < height * 0.6
      raw[index] = inside ? 34 : 0
      raw[index + 1] = inside ? 188 : 0
      raw[index + 2] = inside ? 255 : 0
      raw[index + 3] = inside ? 255 : 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

describe('export pipeline (real FFmpeg)', () => {
  const sourceA = path.join(artifacts, 'source-a.mp4')
  const sourceB = path.join(artifacts, 'source-b.mp4')
  const musicFile = path.join(artifacts, 'music.wav')
  const overlayDir = path.join(artifacts, 'overlay')
  const fxFile = path.join(artifacts, 'fx.wav')
  const output = path.join(artifacts, 'export.mp4')
  const silent = path.join(artifacts, 'export-no-overlay.mp4')
  const FPS = 15

  beforeAll(async () => {
    mkdirSync(artifacts, { recursive: true })
    mkdirSync(overlayDir, { recursive: true })

    const a = await run(ffmpegBin, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourceA
    ])
    expect(a.code, a.stderr.slice(-800)).toBe(0)

    const b = await run(ffmpegBin, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', sourceB
    ])
    expect(b.code, b.stderr.slice(-800)).toBe(0)

    const m = await run(ffmpegBin, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
      '-c:a', 'pcm_s16le', '-ar', '48000', musicFile
    ])
    expect(m.code, m.stderr.slice(-800)).toBe(0)

    const samples = renderEffectsPcm({
      duration: 3.2,
      volume: 0.6,
      pack: 'soft',
      clicks: [{ t: 0.6, button: 'left' }, { t: 1.8, button: 'right' }],
      keys: [{ t: 1.2 }, { t: 2.2 }]
    })
    writeFileSync(fxFile, Buffer.from(encodeWav(samples)))

    for (let frame = 1; frame <= Math.ceil(3.2 * FPS); frame++) {
      writeFileSync(path.join(overlayDir, `${String(frame).padStart(6, '0')}.png`), transparentPng(320, 180, frame % 5 === 0))
    }
  }, 120_000)

  afterAll(() => {
    // artefacts stay under tests/.artifacts (git-ignored) for manual inspection
  })

  it('renders a full multi-track project with effects audio and overlay frames', async () => {
    const project = createProject('pipeline', 320, 180, FPS)
    project.recording = {
      outputPath: sourceA,
      rawPath: '',
      eventsPath: '',
      startedAt: 0,
      sourceWidth: 320,
      sourceHeight: 180,
      monitorBounds: { x: 0, y: 0, width: 320, height: 180 },
      capturedBounds: { x: 0, y: 0, width: 320, height: 180 }
    }
    project.events = [
      { t: 600, type: 'move', x: 0.3, y: 0.4 },
      { t: 900, type: 'down', x: 0.35, y: 0.45, button: 1 },
      { t: 1500, type: 'down', x: 0.5, y: 0.5, keyId: 22 }
    ]
    project.cursor = { ...defaultEffects(), clickSounds: true, keyboardSounds: true, volume: 0.6 }
    project.clips = [
      defaultClip('video', 'track-video-1', {
        id: 'main',
        sourcePath: sourceA,
        start: 0,
        duration: 2.4,
        inPoint: 0.4,
        hasAudio: true,
        sourceDuration: 4
      }),
      defaultClip('video', 'track-overlay', {
        id: 'pip',
        sourcePath: sourceB,
        kind: 'video',
        start: 1.2,
        duration: 1.2,
        inPoint: 0,
        hasAudio: false,
        fadeIn: 0.2,
        transitionIn: { type: 'dissolve', duration: 0.3 },
        zoom: { enabled: true, amount: 0.2, focus: { x: 0.5, y: 0.5 }, ease: 'easeInOut', hold: 0.3 }
      }),
      defaultClip('text', 'track-text', {
        id: 'caption',
        start: 0.2,
        duration: 1.5,
        text: {
          content: 'SkyRec test',
          fontFamily: 'sans-serif',
          fontSize: 20,
          color: '#ffffff',
          background: 'rgba(0,0,0,0.5)',
          padding: 4,
          align: 'center',
          bold: true,
          italic: false,
          shadow: true
        }
      }),
      defaultClip('audio', 'track-music', {
        id: 'music',
        sourcePath: musicFile,
        start: 0.5,
        duration: 2,
        volume: 0.4,
        fadeIn: 0.3,
        fadeOut: 0.3
      })
    ]
    project.duration = 2.4

    const settings: ExportSettings = {
      format: 'mp4',
      width: 320,
      height: 180,
      fps: FPS,
      bitrateMbps: 3,
      audioBitrateKbps: 128,
      encoder: 'cpu',
      denoise: true,
      includeEffects: true
    }

    const plan = buildExportPlan({
      project,
      settings,
      encoder: { videoCodec: 'libx264', audioCodec: 'aac', args: ['-preset', 'ultrafast', '-pix_fmt', 'yuv420p'], label: 'test' },
      effectsWavPath: fxFile,
      overlayPattern: path.join(overlayDir, '%06d.png'),
      outputPath: output
    })

    const result = await run(ffmpegBin, plan.args)
    expect(result.code, result.stderr.slice(-1600)).toBe(0)
    expect(existsSync(output)).toBe(true)

    const probe = await run(ffprobeBin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', output])
    const info = JSON.parse(probe.stdout) as {
      streams: { codec_type: string; width?: number; height?: number; codec_name?: string }[]
      format: { duration: string; size: string }
    }
    const video = info.streams.find((stream) => stream.codec_type === 'video')
    const audio = info.streams.find((stream) => stream.codec_type === 'audio')
    expect(video?.codec_name).toBe('h264')
    expect(video?.width).toBe(320)
    expect(video?.height).toBe(180)
    expect(audio?.codec_name).toBe('aac')
    expect(Number(info.format.duration)).toBeGreaterThan(2)
    expect(Number(info.format.size)).toBeGreaterThan(10_000)
  }, 180_000)

  it('renders without overlays or effect audio (video-only graph)', async () => {
    const project = createProject('simple', 320, 180, FPS)
    project.clips = [
      defaultClip('video', 'track-video-1', {
        id: 'only',
        sourcePath: sourceB,
        start: 0,
        duration: 1.5,
        inPoint: 0.2,
        hasAudio: false,
        speed: 1.5
      })
    ]
    project.duration = 1.5
    const settings: ExportSettings = {
      format: 'mkv',
      width: 320,
      height: 180,
      fps: FPS,
      bitrateMbps: 2,
      audioBitrateKbps: 128,
      encoder: 'cpu',
      denoise: false,
      includeEffects: false
    }
    const plan = buildExportPlan({
      project,
      settings,
      encoder: { videoCodec: 'libx264', audioCodec: 'aac', args: ['-preset', 'ultrafast', '-pix_fmt', 'yuv420p'], label: 'test' },
      effectsWavPath: null,
      overlayPattern: null,
      outputPath: silent
    })
    expect(plan.hasAudio).toBe(false)
    const result = await run(ffmpegBin, plan.args)
    expect(result.code, result.stderr.slice(-1600)).toBe(0)
    expect(existsSync(silent)).toBe(true)
  }, 120_000)
})
