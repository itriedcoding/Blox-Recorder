/**
 * Tiny shared holder for the capture source the renderer is about to request
 * through getDisplayMedia(). Electron's display-media handler is invoked by
 * Chromium without our renderer's arguments, so the selection must be staged
 * in the main process first.
 */
interface PendingCapture {
  sourceId: string
  systemAudio: boolean
}

let pending: PendingCapture | null = null

export function stageCapture(sourceId: string, systemAudio: boolean): void {
  pending = { sourceId, systemAudio }
}

export function consumeCapture(): PendingCapture | null {
  const value = pending
  pending = null
  return value
}

export function peekCapture(): PendingCapture | null {
  return pending
}
