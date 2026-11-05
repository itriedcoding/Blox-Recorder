import { describe, expect, it } from 'vitest'
import { defaultClip } from '@shared/defaults'
import { rippleDelete, splitClipAt, subtractRanges, totalDuration, trimClipEnd, trimClipStart } from '@shared/timeline-ops'
import type { Clip } from '@shared/types'

function clip(patch: Partial<Clip> = {}): Clip {
  return defaultClip('video', 'track-video-1', { start: 0, duration: 10, inPoint: 5, sourceDuration: 60, ...patch })
}

describe('splitClipAt', () => {
  it('splits a clip into two frame-adjacent pieces preserving source offsets', () => {
    const [left, right] = splitClipAt(clip({ speed: 2 }), 4)
    expect(left.start).toBe(0)
    expect(left.duration).toBe(4)
    expect(left.inPoint).toBe(5)
    expect(right.start).toBe(4)
    expect(right.duration).toBe(6)
    // 4 timeline seconds at 2x consumes 8 source seconds
    expect(right.inPoint).toBe(13)
    expect(right.id).not.toBe(left.id)
  })

  it('refuses to split outside the clip', () => {
    const source = clip()
    expect(splitClipAt(source, 0).length).toBe(1)
    expect(splitClipAt(source, 10).length).toBe(1)
    expect(splitClipAt(source, 20).length).toBe(1)
  })
})

describe('trim helpers', () => {
  it('moves the start and the source in-point together', () => {
    const trimmed = trimClipStart(clip({ speed: 0.5 }), 2)
    expect(trimmed.start).toBe(2)
    expect(trimmed.duration).toBe(8)
    expect(trimmed.inPoint).toBe(6)
  })

  it('clamps the end to the available source material', () => {
    const trimmed = trimClipEnd(clip({ speed: 1, inPoint: 55, sourceDuration: 60 }), 99)
    expect(trimmed.duration).toBeCloseTo(5, 5)
  })
})

describe('subtractRanges', () => {
  it('returns the surviving segments with adjusted in-points', () => {
    const pieces = subtractRanges(clip(), [
      { start: 2, end: 4 },
      { start: 7, end: 9 }
    ])
    expect(pieces.map((piece) => [piece.start, piece.duration, piece.inPoint])).toEqual([
      [0, 2, 5],
      [4, 3, 9],
      [9, 1, 14]
    ])
  })
})

describe('rippleDelete', () => {
  it('removes ranges from every track and closes the gaps', () => {
    const main = clip({ start: 0, duration: 10, inPoint: 0 })
    const music = defaultClip('audio', 'track-music', { start: 0, duration: 10, inPoint: 0, sourceDuration: 20 })
    const result = rippleDelete([main, music], [{ start: 3, end: 5 }])
    expect(result.length).toBe(4)
    const mainPieces = result.filter((entry) => entry.trackId === 'track-video-1').sort((a, b) => a.start - b.start)
    expect(mainPieces[0].duration).toBe(3)
    expect(mainPieces[1].start).toBe(3)
    expect(mainPieces[1].duration).toBe(5)
    expect(mainPieces[1].inPoint).toBe(5)
    expect(totalDuration(mainPieces)).toBe(8)
  })

  it('leaves untouched tracks alone when excluded', () => {
    const video = clip({ trackId: 'track-video-1' })
    const music = defaultClip('audio', 'track-music', { start: 0, duration: 10 })
    const result = rippleDelete([video, music], [{ start: 1, end: 2 }], new Set(['track-video-1']))
    expect(result.filter((entry) => entry.trackId === 'track-music')).toHaveLength(1)
    expect(result.filter((entry) => entry.trackId === 'track-music')[0].duration).toBe(10)
  })

  it('is a no-op without ranges', () => {
    const clips = [clip()]
    expect(rippleDelete(clips, [])).toEqual(clips)
  })
})
