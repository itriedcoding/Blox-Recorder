import type { SkyRecApi } from './index'

declare global {
  interface Window {
    api: SkyRecApi
  }
}

export {}
