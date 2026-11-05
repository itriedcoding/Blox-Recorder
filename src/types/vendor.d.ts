declare module 'ffprobe-static' {
  const ffprobe: { path: string; version: string }
  export = ffprobe
}

declare module 'uiohook-napi' {
  export interface UiohookMouseEvent {
    type: string
    x: number
    y: number
    button: number
    clicks: number
    mask: number
    time: number
  }
  export interface UiohookKeyboardEvent {
    type: string
    keycode: number
    rawcode: number
    mask: number
    time: number
  }
  export interface UiohookWheelEvent {
    type: string
    x: number
    y: number
    rotation: number
    direction: number
    amount: number
    time: number
  }
  export interface UiohookApi {
    on(event: 'mousemove' | 'mousedown' | 'mouseup' | 'click', listener: (event: UiohookMouseEvent) => void): void
    on(event: 'keydown' | 'keyup', listener: (event: UiohookKeyboardEvent) => void): void
    on(event: 'wheel', listener: (event: UiohookWheelEvent) => void): void
    removeAllListeners(event?: string): void
    start(): void
    stop(): void
  }
  export const uIOhook: UiohookApi
}
