/**
 * Real-time input capture for mouse/keyboard effects.
 *
 * Uses uiohook-napi (a native OS hook) to observe *events only*: pointer
 * coordinates, mouse buttons and a coarse key id. No text, no window titles and
 * no clipboard data are ever read or stored, and capture never starts without
 * explicit consent recorded in the settings file.
 */
import { createRequire } from 'node:module'
import type { InputCaptureState, InputEventRecord, RecordingRequest } from '@shared/types'
import { clamp } from '@shared/time'
import { writeJson } from './fsx'
import { logger } from './logger'

type HookEvent = { x?: number; y?: number; button?: number; keycode?: number }

interface UiHook {
  on(event: string, handler: (event: HookEvent) => void): void
  removeAllListeners(): void
  start(): void
  stop(): void
}

interface HookModule {
  uIOhook: UiHook
}

const nodeRequire = createRequire(__filename)

let hook: UiHook | null = null
let loadError: string | null = null

function getHook(): UiHook | null {
  if (hook) return hook
  if (loadError) return null
  try {
    const mod = nodeRequire('uiohook-napi') as HookModule
    hook = mod.uIOhook
    return hook
  } catch (error) {
    loadError = (error as Error).message || 'uiohook-napi unavailable'
    logger.warn('input', 'global input capture unavailable', loadError)
    return null
  }
}

export function inputCaptureAvailable(): { available: boolean; reason: string | null } {
  const instance = getHook()
  return { available: Boolean(instance), reason: instance ? null : loadError ?? 'Native input hook not installed' }
}

interface Mapping {
  scale: number
  monitorX: number
  monitorY: number
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  regionX: number
  regionY: number
  regionWidth: number
  regionHeight: number
}

function buildMapping(request: RecordingRequest): Mapping {
  const scale = request.monitorScaleFactor > 0 ? request.monitorScaleFactor : 1
  const region = request.region
  return {
    scale,
    monitorX: request.monitorBounds.x * scale,
    monitorY: request.monitorBounds.y * scale,
    sourceX: request.sourceBounds.x * scale,
    sourceY: request.sourceBounds.y * scale,
    sourceWidth: Math.max(1, request.sourceBounds.width * scale),
    sourceHeight: Math.max(1, request.sourceBounds.height * scale),
    regionX: region.enabled ? region.x : 0,
    regionY: region.enabled ? region.y : 0,
    regionWidth: region.enabled ? Math.max(0.01, region.width) : 1,
    regionHeight: region.enabled ? Math.max(0.01, region.height) : 1
  }
}

function normalise(mapping: Mapping, rawX: number, rawY: number): { x: number; y: number } {
  // uiohook reports physical virtual-desktop pixels; Electron gives us DIPs.
  const screenX = rawX
  const screenY = rawY
  const insideSourceX = (screenX - mapping.sourceX) / mapping.sourceWidth
  const insideSourceY = (screenY - mapping.sourceY) / mapping.sourceHeight
  return {
    x: clamp((insideSourceX - mapping.regionX) / mapping.regionWidth, 0, 1),
    y: clamp((insideSourceY - mapping.regionY) / mapping.regionHeight, 0, 1)
  }
}

class InputCapture {
  private events: InputEventRecord[] = []
  private mapping: Mapping | null = null
  private startTime = 0
  private active = false
  private paused = false
  private pausedTotal = 0
  private pausedAt = 0
  private lastMove = { t: -1, x: 0, y: 0 }
  private cursor = { x: 0, y: 0 }
  private onLiveEvent: ((event: InputEventRecord) => void) | null = null
  private flushTimer: NodeJS.Timeout | null = null

  state(consent: boolean): InputCaptureState {
    const info = inputCaptureAvailable()
    return { available: info.available, reason: info.reason, active: this.active, consent, eventCount: this.events.length }
  }

  begin(request: RecordingRequest, onLiveEvent: ((event: InputEventRecord) => void) | null): void {
    const instance = getHook()
    if (!instance) return
    if (this.active) void this.stop(null)
    this.events = []
    this.mapping = buildMapping(request)
    this.startTime = Date.now()
    this.pausedTotal = 0
    this.paused = false
    this.lastMove = { t: -1, x: 0, y: 0 }
    this.onLiveEvent = onLiveEvent

    instance.removeAllListeners()
    instance.on('mousemove', (event) => this.handleMove(event))
    instance.on('mousedown', (event) => this.handleMouseButton(event, 'down'))
    instance.on('mouseup', (event) => this.handleMouseButton(event, 'up'))
    instance.on('keydown', (event) => this.handleKey(event))
    try {
      instance.start()
      this.active = true
      logger.info('input', 'input capture started')
    } catch (error) {
      logger.error('input', 'failed to start input capture', error)
      this.active = false
      return
    }
    this.flushTimer = setInterval(() => this.flush(), 5000)
  }

  private now(): number {
    const elapsed = Date.now() - this.startTime - this.pausedTotal
    if (this.paused && this.pausedAt > 0) return this.pausedAt - this.startTime - this.pausedTotal
    return Math.max(0, elapsed)
  }

  private push(event: InputEventRecord): void {
    if (this.events.length > 400_000) return
    this.events.push(event)
    this.onLiveEvent?.(event)
  }

  private handleMove(event: HookEvent): void {
    if (!this.mapping || !this.active || this.paused) return
    if (typeof event.x !== 'number' || typeof event.y !== 'number') return
    const t = this.now()
    const position = normalise(this.mapping, event.x, event.y)
    this.cursor = position
    const dx = Math.abs(position.x - this.lastMove.x) * this.mapping.sourceWidth
    const dy = Math.abs(position.y - this.lastMove.y) * this.mapping.sourceHeight
    // Throttle: keep sub-pixel motion but cap the rate at ~120 Hz.
    if (t - this.lastMove.t < 8 && dx + dy < 2) return
    this.lastMove = { t, x: position.x, y: position.y }
    this.push({ t, type: 'move', x: position.x, y: position.y })
  }

  private handleMouseButton(event: HookEvent, type: 'down' | 'up'): void {
    if (!this.mapping || !this.active || this.paused) return
    const t = this.now()
    const position =
      typeof event.x === 'number' && typeof event.y === 'number'
        ? normalise(this.mapping, event.x, event.y)
        : this.cursor
    // uiohook: 1 = left, 2 = right, 3 = middle.
    this.push({ t, type, x: position.x, y: position.y, button: event.button ?? 1 })
  }

  private handleKey(event: HookEvent): void {
    if (!this.mapping || !this.active || this.paused) return
    const t = this.now()
    this.push({ t, type: 'down', x: this.cursor.x, y: this.cursor.y, keyId: event.keycode ?? 0 })
  }

  pause(): void {
    if (!this.active || this.paused) return
    this.paused = true
    this.pausedAt = Date.now()
  }

  resume(): void {
    if (!this.active || !this.paused) return
    this.pausedTotal += Date.now() - this.pausedAt
    this.paused = false
    this.pausedAt = 0
  }

  async flush(): Promise<void> {
    if (!this.active && !this.events.length) return
    void this.events
  }

  async stop(eventsPath: string | null): Promise<InputEventRecord[]> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    const instance = getHook()
    if (instance && this.active) {
      try {
        instance.stop()
        instance.removeAllListeners()
      } catch (error) {
        logger.warn('input', 'failed to stop input hook', error)
      }
    }
    this.active = false
    this.paused = false
    this.mapping = null
    this.onLiveEvent = null
    const events = this.events
    this.events = []
    if (eventsPath) {
      try {
        await writeJson(eventsPath, events)
      } catch (error) {
        logger.error('input', 'failed to persist input events', error)
      }
    }
    logger.info('input', 'input capture stopped', { events: events.length })
    return events
  }

  snapshot(): InputEventRecord[] {
    return [...this.events]
  }

  isActive(): boolean {
    return this.active
  }
}

export const inputCapture = new InputCapture()
