/** Small time/format helpers shared by both processes. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatTimecode(seconds: number, withFrames = false, fps = 30): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const total = Math.floor(safe)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const base = `${h > 0 ? `${pad(h)}:` : ''}${pad(m)}:${pad(s)}`
  if (!withFrames) return base
  const frames = Math.floor((safe - total) * fps)
  return `${base}:${pad(frames)}`
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds)
  if (safe < 1) return `${Math.round(safe * 1000)} ms`
  return formatTimecode(safe)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, index)
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

/** Snap a timeline position to the nearest frame boundary. */
export function snapToFrame(seconds: number, fps: number): number {
  if (fps <= 0) return seconds
  return Math.round(seconds * fps) / fps
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
