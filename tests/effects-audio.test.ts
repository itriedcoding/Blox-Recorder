import { describe, expect, it } from 'vitest'
import { EFFECT_SAMPLE_RATE, encodeWav, renderEffectsPcm, renderOneShot } from '@shared/effects-audio'
import { buildEffectTimeline, cursorAt } from '@shared/effect-timeline'
import { createProject, defaultClip, defaultEffects } from '@shared/defaults'

describe('procedural effect audio', () => {
  it('renders deterministic one-shots per pack', () => {
    const a = renderOneShot('soft', 'click-left')
    const b = renderOneShot('soft', 'click-left')
    const other = renderOneShot('crisp', 'click-left')
    expect(a).toEqual(b)
    expect(a.some((value, index) => Math.abs(value - other[index]) > 0.01)).toBe(true)
    expect(Math.max(...Array.from(a).map(Math.abs))).toBeGreaterThan(0.05)
    expect(Math.max(...Array.from(a).map(Math.abs))).toBeLessThanOrEqual(1)
  })

  it('places cues at the correct sample offsets and nowhere else', () => {
    const samples = renderEffectsPcm({
      duration: 2,
      volume: 0.8,
      pack: 'mechanical',
      clicks: [{ t: 1, button: 'left' }],
      keys: []
    })
    expect(samples.length).toBe(2 * EFFECT_SAMPLE_RATE)
    const windowStart = EFFECT_SAMPLE_RATE - 2205
    const windowEnd = EFFECT_SAMPLE_RATE + 2205
    let quietBefore = 0
    let loudAtCue = 0
    for (let i = 0; i < samples.length; i++) {
      if (i < windowStart && Math.abs(samples[i]) > 1e-6) quietBefore++
      if (i >= windowStart && i <= windowEnd && Math.abs(samples[i]) > 0.02) loudAtCue++
    }
    expect(quietBefore).toBe(0)
    expect(loudAtCue).toBeGreaterThan(100)
  })

  it('scales with the requested volume and never clips', () => {
    const loud = renderEffectsPcm({ duration: 1, volume: 4, pack: 'crisp', clicks: [{ t: 0.1, button: 'right' }], keys: [] })
    for (const value of loud) {
      expect(Math.abs(value)).toBeLessThanOrEqual(0.93)
    }
  })

  it('writes a valid 16-bit mono WAV container', () => {
    const samples = renderOneShot('soft', 'key')
    const wav = encodeWav(samples)
    const header = Buffer.from(wav.buffer, wav.byteOffset, 44)
    expect(header.toString('ascii', 0, 4)).toBe('RIFF')
    expect(header.toString('ascii', 8, 12)).toBe('WAVE')
    expect(header.readUInt16LE(22)).toBe(1)
    expect(header.readUInt32LE(24)).toBe(EFFECT_SAMPLE_RATE)
    expect(header.readUInt16LE(34)).toBe(16)
    expect(header.readUInt32LE(40)).toBe(samples.length * 2)
    expect(wav.length).toBe(44 + samples.length * 2)
  })
})

describe('effect timeline mapping', () => {
  const project = createProject('sync', 640, 360, 30)
  project.events = [
    { t: 1000, type: 'move', x: 0.1, y: 0.1 },
    { t: 2000, type: 'move', x: 0.5, y: 0.5 },
    { t: 2200, type: 'down', x: 0.5, y: 0.5, button: 1 },
    { t: 2500, type: 'down', x: 0.5, y: 0.5, keyId: 12 },
    { t: 4000, type: 'move', x: 1.4, y: -0.2 }
  ]
  project.recording = {
    outputPath: 'C:/rec.mp4',
    rawPath: '',
    eventsPath: '',
    startedAt: 0,
    sourceWidth: 640,
    sourceHeight: 360,
    monitorBounds: { x: 0, y: 0, width: 640, height: 360 },
    capturedBounds: { x: 0, y: 0, width: 640, height: 360 }
  }
  project.clips = [defaultClip('video', 'track-video-1', { sourcePath: 'C:/rec.mp4', start: 2, duration: 10, inPoint: 1 })]
  project.cursor = defaultEffects()

  it('shifts recording time onto the timeline and clamps positions', () => {
    const timeline = buildEffectTimeline(project)
    expect(timeline.moves[0].t).toBeCloseTo(2, 5)
    expect(timeline.moves[1].t).toBeCloseTo(3, 5)
    expect(timeline.clicks[0]).toMatchObject({ t: 3.2, button: 'left' })
    expect(timeline.keys[0].t).toBeCloseTo(3.5, 5)
    expect(timeline.moves[2]).toMatchObject({ x: 1, y: 0 })
  })

  it('interpolates and smooths the cursor path', () => {
    const timeline = buildEffectTimeline(project)
    const mid = cursorAt(timeline, 2.5, false)
    expect(mid?.x).toBeCloseTo(0.3, 5)
    const smooth = cursorAt(timeline, 2.25, true)
    expect(smooth?.x).toBeGreaterThan(0.1)
    expect(smooth?.x).toBeLessThan(0.5)
  })

  it('drops events outside the trimmed clip range', () => {
    const shortened = structuredClone(project)
    // Timeline [2, 3] shows source 1.0-2.0s only, so the 2.2s click and 2.5s key
    // are outside the visible material and must not be drawn or sounded.
    shortened.clips = [defaultClip('video', 'track-video-1', { sourcePath: 'C:/rec.mp4', start: 2, duration: 1, inPoint: 1 })]
    const timeline = buildEffectTimeline(shortened)
    expect(timeline.clicks).toHaveLength(0)
    expect(timeline.keys).toHaveLength(0)
    expect(timeline.moves).toHaveLength(2)
    expect(timeline.moves[1].t).toBeCloseTo(3, 5)
  })
})
