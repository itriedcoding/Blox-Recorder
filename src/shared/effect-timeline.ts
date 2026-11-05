/**
 * Maps raw recording input events (captured in real time by the main process)
 * onto the project timeline, so the same cue data drives the live preview, the
 * editor overlay and the baked export overlay.
 */
import type { Clip, InputEventRecord, Project } from './types'
import { clamp } from './time'

export interface CursorSample {
  t: number
  x: number
  y: number
}

export interface ClickCue {
  t: number
  x: number
  y: number
  button: 'left' | 'right'
}

export interface KeyCue {
  t: number
  x: number
  y: number
}

export interface EffectTimeline {
  moves: CursorSample[]
  clicks: ClickCue[]
  keys: KeyCue[]
  duration: number
  /** True when the project contains no usable input events. */
  empty: boolean
}

const EMPTY: EffectTimeline = { moves: [], clicks: [], keys: [], duration: 0, empty: true }

/** The clip that carries the original screen recording, if any. */
export function findRecordingClip(project: Project): Clip | null {
  const recordingPath = project.recording?.outputPath ?? project.recording?.rawPath ?? null
  const videoTracks = project.tracks.filter((track) => track.kind === 'video')
  const mainTrackId = videoTracks[0]?.id
  const onMain = project.clips.filter((clip) => clip.trackId === mainTrackId && clip.sourcePath)
  if (recordingPath) {
    const exact = onMain.find((clip) => clip.sourcePath === recordingPath)
    if (exact) return exact
    const byName = onMain.find((clip) => clip.sourcePath?.includes(recordingPath.split(/[\\/]/).pop() ?? '\u0000'))
    if (byName) return byName
  }
  return onMain[0] ?? null
}

/** Convert a recording-relative time to a timeline time for a given clip. */
export function recordingTimeToTimeline(clip: Clip, recordingSeconds: number): number {
  const speed = clip.speed > 0 ? clip.speed : 1
  return clip.start + (recordingSeconds - clip.inPoint) / speed
}

export function buildEffectTimeline(project: Project, events?: InputEventRecord[]): EffectTimeline {
  const list = events ?? project.events
  if (!list.length) return EMPTY
  const clip = findRecordingClip(project)
  if (!clip) return EMPTY

  const speed = clip.speed > 0 ? clip.speed : 1
  const clipEnd = clip.start + clip.duration
  const moves: CursorSample[] = []
  const clicks: ClickCue[] = []
  const keys: KeyCue[] = []

  for (const event of list) {
    const recordingSeconds = event.t / 1000
    if (recordingSeconds < clip.inPoint) continue
    const timelineTime = clip.start + (recordingSeconds - clip.inPoint) / speed
    if (timelineTime < clip.start || timelineTime > clipEnd) continue
    const x = clamp(event.x, 0, 1)
    const y = clamp(event.y, 0, 1)
    if (event.type === 'move') {
      moves.push({ t: timelineTime, x, y })
    } else if (event.type === 'down' && event.button !== undefined) {
      clicks.push({ t: timelineTime, x, y, button: event.button === 2 ? 'right' : 'left' })
    } else if (event.type === 'down' && event.keyId !== undefined) {
      // Key presses only carry a coarse key id, never the produced character.
      keys.push({ t: timelineTime, x, y })
    }
  }

  moves.sort((a, b) => a.t - b.t)
  clicks.sort((a, b) => a.t - b.t)
  keys.sort((a, b) => a.t - b.t)

  return { moves, clicks, keys, duration: clipEnd, empty: moves.length + clicks.length + keys.length === 0 }
}

/**
 * Cursor position at a given timeline time, with optional smoothing.
 * Uses linear interpolation between real captured move events.
 */
export function cursorAt(timeline: EffectTimeline, time: number, smooth = true): { x: number; y: number } | null {
  const { moves } = timeline
  if (!moves.length) return null
  if (moves.length === 1) return { x: moves[0].x, y: moves[0].y }

  let low = 0
  let high = moves.length - 1
  if (time <= moves[0].t) return { x: moves[0].x, y: moves[0].y }
  if (time >= moves[high].t) return { x: moves[high].x, y: moves[high].y }

  while (low < high - 1) {
    const mid = (low + high) >> 1
    if (moves[mid].t <= time) low = mid
    else high = mid
  }
  const a = moves[low]
  const b = moves[high]
  const span = b.t - a.t
  const raw = span > 0 ? (time - a.t) / span : 1
  const k = smooth ? raw * raw * (3 - 2 * raw) : raw
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
}

/** Clicks that should be visible (ripple animation) at a timeline time. */
export function activeClicks(timeline: EffectTimeline, time: number, windowSeconds = 0.55): ClickCue[] {
  return timeline.clicks.filter((cue) => time >= cue.t && time <= cue.t + windowSeconds)
}

export function totalCues(timeline: EffectTimeline): number {
  return timeline.moves.length + timeline.clicks.length + timeline.keys.length
}
