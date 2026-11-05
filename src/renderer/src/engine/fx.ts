/**
 * Cursor / click / keystroke / text drawing.
 *
 * One implementation shared by the live recorder compositor, the editor preview
 * and the offscreen export overlay renderer, so what you preview is exactly what
 * gets baked into the exported file.
 */
import type { Clip, EffectsSettings, Project } from '@shared/types'
import { clamp, easeInOut } from '@shared/time'

export interface ClickMark {
  t: number
  x: number
  y: number
  button: 'left' | 'right'
}

export interface KeyMark {
  t: number
}

export interface FxInput {
  width: number
  height: number
  /** Output-height scale factor relative to the reference (project) resolution. */
  scale: number
  time: number
  settings: EffectsSettings
  cursor: { x: number; y: number } | null
  clicks: ClickMark[]
  keys: KeyMark[]
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '')
  const value = cleaned.length === 3 ? cleaned.split('').map((c) => c + c).join('') : cleaned
  const int = Number.parseInt(value, 16)
  if (!Number.isFinite(int)) return `rgba(34,188,255,${alpha})`
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r},${g},${b},${alpha})`
}

export const RIPPLE_DURATION = 0.62

export function drawFx(ctx: CanvasRenderingContext2D, input: FxInput): void {
  const { settings, width, height, time, scale } = input
  if (!settings.enabled) return
  const intensity = clamp(settings.intensity, 0, 1)

  if (settings.clickRipples) {
    for (const click of input.clicks) {
      const age = time - click.t
      if (age < 0 || age > RIPPLE_DURATION) continue
      const progress = age / RIPPLE_DURATION
      const radius = (14 + progress * 46) * scale * (0.7 + intensity * 0.6)
      const alpha = (1 - progress) * 0.75 * intensity * (click.button === 'right' ? 1 : 0.9)
      const color = click.button === 'right' ? '#ffb454' : settings.rippleColor
      const cx = click.x * width
      const cy = click.y * height

      const outer = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius)
      outer.addColorStop(0, hexToRgba(color, alpha * 0.45))
      outer.addColorStop(1, hexToRgba(color, 0))
      ctx.fillStyle = outer
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = hexToRgba(color, alpha)
      ctx.lineWidth = Math.max(1, 2.4 * scale * (1 - progress))
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2)
      ctx.stroke()

      if (progress < 0.35) {
        ctx.fillStyle = hexToRgba(color, (1 - progress / 0.35) * 0.9)
        ctx.beginPath()
        ctx.arc(cx, cy, 3.2 * scale, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  if (settings.cursorHighlight && input.cursor) {
    const cx = input.cursor.x * width
    const cy = input.cursor.y * height
    const base = settings.cursorSize * scale * 0.5

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 2.6)
    glow.addColorStop(0, hexToRgba(settings.cursorColor, 0.35 * intensity))
    glow.addColorStop(0.55, hexToRgba(settings.cursorColor, 0.16 * intensity))
    glow.addColorStop(1, hexToRgba(settings.cursorColor, 0))
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, base * 2.6, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = hexToRgba(settings.cursorColor, 0.9)
    ctx.lineWidth = Math.max(1.2, 2.2 * scale)
    ctx.beginPath()
    ctx.arc(cx, cy, base, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(1.6, base * 0.24), 0, Math.PI * 2)
    ctx.fill()
  }

  if (settings.keyboardSounds && input.keys.length) {
    const recent = input.keys.filter((key) => time - key.t >= 0 && time - key.t < 0.32)
    if (recent.length) {
      const anchorX = (input.cursor?.x ?? 0.5) * width
      const anchorY = (input.cursor?.y ?? 0.5) * height
      recent.slice(-3).forEach((key, index) => {
        const age = clamp((time - key.t) / 0.32, 0, 1)
        const size = 13 * scale
        const x = anchorX + (index - 1) * (size + 4 * scale)
        const y = anchorY + 26 * scale - age * 8 * scale
        ctx.globalAlpha = (1 - age) * 0.9
        ctx.fillStyle = 'rgba(9,14,20,0.82)'
        ctx.strokeStyle = hexToRgba(settings.cursorColor, 0.7)
        ctx.lineWidth = 1
        roundRect(ctx, x - size / 2, y - size / 2, size, size, 3 * scale)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.beginPath()
        ctx.arc(x, y, 1.6 * scale, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      })
    }
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/** Text clips active at the given timeline time. */
export function activeTextClips(project: Project, time: number): Clip[] {
  const textTracks = new Set(project.tracks.filter((track) => track.kind === 'text' && !track.hidden).map((track) => track.id))
  return project.clips.filter(
    (clip) => clip.kind === 'text' && clip.text && textTracks.has(clip.trackId) && time >= clip.start && time < clip.start + clip.duration
  )
}

export function drawTextClips(ctx: CanvasRenderingContext2D, project: Project, time: number, width: number, height: number): void {
  const scale = height / Math.max(1, project.height)
  for (const clip of activeTextClips(project, time)) {
    const style = clip.text
    if (!style) continue
    const local = time - clip.start
    const fadeIn = clip.fadeIn > 0 ? clamp(local / clip.fadeIn, 0, 1) : 1
    const fadeOut = clip.fadeOut > 0 ? clamp((clip.duration - local) / clip.fadeOut, 0, 1) : 1
    const alpha = clip.transform.opacity * Math.min(fadeIn, fadeOut)
    if (alpha <= 0.001) continue

    const fontSize = Math.max(8, style.fontSize * scale)
    const padding = style.padding * scale
    const lines = style.content.split('\n')
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? '700' : '500'} ${fontSize}px ${style.fontFamily}`
    ctx.textBaseline = 'top'
    const widths = lines.map((line) => ctx.measureText(line).width)
    const boxWidth = Math.min(width - 24 * scale, Math.max(...widths) + padding * 2)
    const lineHeight = fontSize * 1.28
    const boxHeight = lines.length * lineHeight + padding * 2
    const centerX = (0.5 + clip.transform.x) * width
    const centerY = (0.5 + clip.transform.y) * height
    let left = centerX - boxWidth / 2
    if (style.align === 'left') left = centerX
    if (style.align === 'right') left = centerX - boxWidth
    left = clamp(left, 8 * scale, width - boxWidth - 8 * scale)
    const top = clamp(centerY - boxHeight / 2, 8 * scale, height - boxHeight - 8 * scale)

    if (style.background && style.background !== 'transparent') {
      ctx.fillStyle = style.background
      roundRect(ctx, left, top, boxWidth, boxHeight, Math.max(4, 8 * scale))
      ctx.fill()
    }
    if (style.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = 14 * scale
      ctx.shadowOffsetY = 3 * scale
    }
    ctx.fillStyle = style.color
    lines.forEach((line, index) => {
      let x = left + padding
      if (style.align === 'center') x = left + (boxWidth - widths[index]) / 2
      if (style.align === 'right') x = left + boxWidth - padding - widths[index]
      ctx.fillText(line, x, top + padding + index * lineHeight)
    })
    ctx.restore()
  }
}

/** Envelope used by both the preview and FFmpeg for the per-clip zoom. */
export function zoomProgressAt(clip: Clip, localTime: number): number {
  const zoom = clip.zoom
  if (!zoom?.enabled) return 0
  const duration = Math.max(0.1, clip.duration)
  const rise = Math.min(0.7, Math.max(0.18, duration * 0.25))
  const hold = clamp(zoom.hold, 0, Math.max(0, duration - rise * 2))
  const fall = Math.max(0.1, Math.min(rise, duration - rise - hold))
  const t = clamp(localTime, 0, duration)
  let value: number
  if (t < rise) value = t / rise
  else if (t < rise + hold) value = 1
  else value = Math.min(1, Math.max(0, (duration - t) / fall))
  return zoom.ease === 'easeInOut' ? easeInOut(value) : value
}
