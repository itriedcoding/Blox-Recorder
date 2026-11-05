/**
 * Pure timeline operations. Keeping them free of React/DOM state makes the
 * destructive edits (split, trim, ripple delete) unit-testable.
 */
import type { Clip } from './types'
import { clamp } from './time'
import { newId } from './defaults'

export interface TimeRange {
  start: number
  end: number
}

export function clipEnd(clip: Pick<Clip, 'start' | 'duration'>): number {
  return clip.start + clip.duration
}

/** Split a clip at a timeline position, returning one or two clips. */
export function splitClipAt(clip: Clip, time: number): Clip[] {
  const end = clipEnd(clip)
  if (time <= clip.start + 0.001 || time >= end - 0.001) return [clip]
  const leftDuration = time - clip.start
  const rightDuration = end - time
  const left: Clip = { ...clip, duration: leftDuration, transitionIn: clip.transitionIn }
  const right: Clip = {
    ...clip,
    id: newId('clip'),
    start: time,
    duration: rightDuration,
    inPoint: clip.inPoint + leftDuration * (clip.speed || 1),
    transitionIn: null,
    fadeIn: 0
  }
  left.fadeOut = 0
  return [left, right]
}

/** Move a clip's left edge while keeping the source in sync. */
export function trimClipStart(clip: Clip, newStart: number): Clip {
  const end = clipEnd(clip)
  const limited = clamp(newStart, 0, end - 0.1)
  const delta = limited - clip.start
  const speed = clip.speed || 1
  const nextInPoint = Math.max(0, clip.inPoint + delta * speed)
  return {
    ...clip,
    start: limited,
    duration: end - limited,
    inPoint: nextInPoint,
    fadeIn: Math.min(clip.fadeIn, end - limited)
  }
}

/** Move a clip's right edge. */
export function trimClipEnd(clip: Clip, newEnd: number): Clip {
  const minEnd = clip.start + 0.1
  const sourceLimit = clip.sourceDuration ? clip.start + (clip.sourceDuration - clip.inPoint) / (clip.speed || 1) : Number.POSITIVE_INFINITY
  const limited = clamp(newEnd, minEnd, Math.max(minEnd, sourceLimit))
  return { ...clip, duration: limited - clip.start, fadeOut: Math.min(clip.fadeOut, limited - clip.start) }
}

/** Portion of a clip that lies inside [from, to], with the source in-point adjusted. */
export function sliceClip(clip: Clip, from: number, to: number): Clip | null {
  const start = Math.max(clip.start, from)
  const end = Math.min(clipEnd(clip), to)
  if (end - start <= 0.02) return null
  const speed = clip.speed || 1
  return {
    ...clip,
    start,
    duration: end - start,
    inPoint: Math.max(0, clip.inPoint + (start - clip.start) * speed)
  }
}

/** Subtract timeline ranges from a single clip. */
export function subtractRanges(clip: Clip, ranges: TimeRange[]): Clip[] {
  let segments: TimeRange[] = [{ start: clip.start, end: clipEnd(clip) }]
  for (const range of ranges) {
    const next: TimeRange[] = []
    for (const segment of segments) {
      if (range.end <= segment.start || range.start >= segment.end) {
        next.push(segment)
        continue
      }
      if (range.start > segment.start) next.push({ start: segment.start, end: range.start })
      if (range.end < segment.end) next.push({ start: range.end, end: segment.end })
    }
    segments = next
  }
  return segments
    .map((segment) => sliceClip(clip, segment.start, segment.end))
    .filter((value): value is Clip => value !== null)
}

/**
 * Ripple delete: remove time ranges from every clip and pull later clips left so
 * no gaps are left behind. Ranges are clamped to the timeline.
 */
export function rippleDelete(clips: Clip[], ranges: TimeRange[], keepTrackIds?: Set<string>): Clip[] {
  const normalised = ranges
    .map((range) => ({ start: Math.max(0, range.start), end: Math.max(0, range.end) }))
    .filter((range) => range.end - range.start > 0.02)
    .sort((a, b) => a.start - b.start)
  if (!normalised.length) return clips

  const removedBefore = (time: number): number =>
    normalised.reduce((total, range) => total + (range.end <= time ? range.end - range.start : 0), 0)

  const result: Clip[] = []
  for (const clip of clips) {
    if (keepTrackIds && !keepTrackIds.has(clip.trackId)) {
      result.push(clip)
      continue
    }
    const pieces = subtractRanges(clip, normalised)
    const firstStart = clip.start
    pieces.forEach((piece, index) => {
      const shift = removedBefore(piece.start)
      const next: Clip = { ...piece, start: Math.max(0, piece.start - shift) }
      if (index === 0 && next.start < firstStart) next.start = Math.max(0, firstStart - removedBefore(firstStart))
      result.push(next)
    })
  }
  return result
}

export function clipsOverlapping(clips: Clip[], time: number): Clip[] {
  return clips.filter((clip) => time >= clip.start && time < clipEnd(clip))
}

export function snapTime(time: number, candidates: number[], threshold: number): number {
  let best = time
  let bestDistance = threshold
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - time)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0)
}
