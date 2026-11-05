/**
 * Procedural mouse/keyboard effect audio.
 *
 * Every click and keystroke sound used by the recorder preview and the export
 * renderer is synthesised from this module, so what you hear while editing is
 * bit-for-bit the same waveform that gets mixed into the exported file. No
 * samples are downloaded and no external sound pack is required.
 */
import type { SoundPackId } from './types'

export const EFFECT_SAMPLE_RATE = 44100

export type OneShotKind = 'click-left' | 'click-right' | 'key'

interface SoundSpec {
  duration: number
  toneHz: number
  toneGain: number
  noiseGain: number
  noiseLowpass: number
  attack: number
  decay: number
  gain: number
}

const PACKS: Record<SoundPackId, Record<OneShotKind, SoundSpec>> = {
  soft: {
    'click-left': { duration: 0.07, toneHz: 720, toneGain: 0.32, noiseGain: 0.16, noiseLowpass: 0.35, attack: 0.0015, decay: 0.05, gain: 0.62 },
    'click-right': { duration: 0.085, toneHz: 540, toneGain: 0.34, noiseGain: 0.2, noiseLowpass: 0.28, attack: 0.0018, decay: 0.06, gain: 0.66 },
    key: { duration: 0.045, toneHz: 1180, toneGain: 0.18, noiseGain: 0.3, noiseLowpass: 0.55, attack: 0.0008, decay: 0.03, gain: 0.5 }
  },
  mechanical: {
    'click-left': { duration: 0.09, toneHz: 420, toneGain: 0.42, noiseGain: 0.34, noiseLowpass: 0.5, attack: 0.0006, decay: 0.07, gain: 0.78 },
    'click-right': { duration: 0.11, toneHz: 320, toneGain: 0.44, noiseGain: 0.36, noiseLowpass: 0.42, attack: 0.0006, decay: 0.08, gain: 0.8 },
    key: { duration: 0.055, toneHz: 980, toneGain: 0.22, noiseGain: 0.45, noiseLowpass: 0.62, attack: 0.0004, decay: 0.035, gain: 0.66 }
  },
  crisp: {
    'click-left': { duration: 0.055, toneHz: 1500, toneGain: 0.28, noiseGain: 0.3, noiseLowpass: 0.8, attack: 0.0004, decay: 0.04, gain: 0.7 },
    'click-right': { duration: 0.065, toneHz: 1150, toneGain: 0.3, noiseGain: 0.32, noiseLowpass: 0.74, attack: 0.0004, decay: 0.05, gain: 0.72 },
    key: { duration: 0.032, toneHz: 2100, toneGain: 0.14, noiseGain: 0.4, noiseLowpass: 0.88, attack: 0.0002, decay: 0.022, gain: 0.56 }
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Render a single effect sound as mono float samples in [-1, 1]. */
export function renderOneShot(pack: SoundPackId, kind: OneShotKind): Float32Array {
  const spec = PACKS[pack][kind]
  const length = Math.max(1, Math.round(spec.duration * EFFECT_SAMPLE_RATE))
  const out = new Float32Array(length)
  const random = mulberry32(kind === 'key' ? 0x5eed1 : kind === 'click-left' ? 0x5eed2 : 0x5eed3)
  let lowpassed = 0

  for (let i = 0; i < length; i++) {
    const t = i / EFFECT_SAMPLE_RATE
    const attackEnvelope = Math.min(1, t / Math.max(spec.attack, 1e-5))
    const decayEnvelope = Math.exp(-t / Math.max(spec.decay, 1e-5) * 3.2)
    const envelope = attackEnvelope * decayEnvelope

    const noise = random() * 2 - 1
    lowpassed += (noise - lowpassed) * spec.noiseLowpass
    const tone = Math.sin(2 * Math.PI * spec.toneHz * t) * Math.exp(-t / Math.max(spec.decay, 1e-5) * 4)

    out[i] = (tone * spec.toneGain + lowpassed * spec.noiseGain) * envelope * spec.gain
  }

  // Short 2 ms fade-out tail removes the click that a hard cut would produce.
  const tail = Math.min(length, Math.round(0.002 * EFFECT_SAMPLE_RATE))
  for (let i = 0; i < tail; i++) {
    out[length - 1 - i] *= i / tail
  }
  return out
}

export interface EffectsMixRequest {
  sampleRate?: number
  duration: number
  volume: number
  pack: SoundPackId
  clicks: { t: number; button: 'left' | 'right' }[]
  keys: { t: number }[]
}

/**
 * Mix every click/keystroke cue into one mono track aligned to the timeline.
 * Cues outside the timeline are dropped; overlapping sounds are summed with a
 * soft limiter so dense typing never clips.
 */
export function renderEffectsPcm(request: EffectsMixRequest): Float32Array {
  const sampleRate = request.sampleRate ?? EFFECT_SAMPLE_RATE
  const length = Math.max(1, Math.round(request.duration * sampleRate))
  const mix = new Float32Array(length)
  const cache = new Map<OneShotKind, Float32Array>()
  const get = (kind: OneShotKind): Float32Array => {
    let sound = cache.get(kind)
    if (!sound) {
      sound = renderOneShot(request.pack, kind)
      cache.set(kind, sound)
    }
    return sound
  }

  const place = (kind: OneShotKind, t: number): void => {
    if (!Number.isFinite(t) || t < 0 || t >= request.duration) return
    const start = Math.round(t * sampleRate)
    const sound = get(kind)
    for (let i = 0; i < sound.length; i++) {
      const index = start + i
      if (index >= length) break
      mix[index] += sound[i]
    }
  }

  for (const click of request.clicks) place(click.button === 'right' ? 'click-right' : 'click-left', click.t)
  for (const key of request.keys) place('key', key.t)

  const gain = Math.max(0, request.volume)
  for (let i = 0; i < length; i++) {
    const value = mix[i] * gain
    // tanh soft clip: musical limiting instead of ugly hard clipping.
    mix[i] = Math.tanh(value * 1.15) * 0.92
  }
  return mix
}

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = EFFECT_SAMPLE_RATE): Uint8Array {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}
