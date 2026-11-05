import { create } from 'zustand'
import type { AppInfo, AppSettings, Project, RecorderStatus, RecordingResult } from '@shared/types'
import { projectDuration } from '@shared/defaults'

export type View = 'record' | 'library' | 'editor' | 'exports' | 'screenshots' | 'settings'

export interface ToastItem {
  id: string
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
}

export type SaveState = 'saved' | 'dirty' | 'saving'

interface Store {
  view: View
  setView: (view: View) => void

  settings: AppSettings | null
  appInfo: AppInfo | null
  initialized: boolean
  init: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshAppInfo: () => Promise<void>

  toasts: ToastItem[]
  pushToast: (kind: ToastItem['kind'], title: string, detail?: string) => void
  dismissToast: (id: string) => void

  recorder: RecorderStatus | null
  setRecorder: (status: RecorderStatus) => void
  lastResult: RecordingResult | null
  setLastResult: (result: RecordingResult | null) => void

  project: Project | null
  past: Project[]
  future: Project[]
  selectedClipId: string | null
  playhead: number
  playing: boolean
  pixelsPerSecond: number
  saveState: SaveState
  openProject: (project: Project) => void
  closeProject: () => void
  selectClip: (id: string | null) => void
  setPlayhead: (seconds: number) => void
  setPlaying: (playing: boolean) => void
  setPixelsPerSecond: (value: number) => void
  mutate: (fn: (draft: Project) => void, options?: { history?: boolean }) => void
  beginHistory: () => void
  undo: () => void
  redo: () => void
  save: (silent?: boolean) => Promise<void>
  renameProject: (name: string) => void
}

const HISTORY_LIMIT = 80

export const useStore = create<Store>((set, get) => ({
  view: 'record',
  setView: (view) => set({ view }),

  settings: null,
  appInfo: null,
  initialized: false,
  init: async () => {
    const [settings, appInfo] = await Promise.all([window.api.settings.get(), window.api.app.info()])
    document.documentElement.dataset.theme = settings.theme
    set({ settings, appInfo, initialized: true })
    const status = await window.api.recorder.status()
    set({ recorder: status })
  },
  updateSettings: async (patch) => {
    const settings = await window.api.settings.update(patch)
    document.documentElement.dataset.theme = settings.theme
    set({ settings })
  },
  refreshAppInfo: async () => {
    const appInfo = await window.api.app.info()
    set({ appInfo })
  },

  toasts: [],
  pushToast: (kind, title, detail) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    set({ toasts: [...get().toasts, { id, kind, title, detail }] })
    const timeout = kind === 'error' ? 9000 : 4200
    window.setTimeout(() => get().dismissToast(id), timeout)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),

  recorder: null,
  setRecorder: (status) => set({ recorder: status }),
  lastResult: null,
  setLastResult: (result) => set({ lastResult: result }),

  project: null,
  past: [],
  future: [],
  selectedClipId: null,
  playhead: 0,
  playing: false,
  pixelsPerSecond: 90,
  saveState: 'saved',

  openProject: (project) =>
    set({
      project,
      past: [],
      future: [],
      selectedClipId: null,
      playhead: 0,
      playing: false,
      saveState: 'saved',
      view: 'editor'
    }),
  closeProject: () => set({ project: null, past: [], future: [], selectedClipId: null, playing: false, saveState: 'saved' }),
  selectClip: (id) => set({ selectedClipId: id }),
  setPlayhead: (seconds) => set({ playhead: Math.max(0, seconds) }),
  setPlaying: (playing) => set({ playing }),
  setPixelsPerSecond: (value) => set({ pixelsPerSecond: Math.max(18, Math.min(420, value)) }),

  beginHistory: () => {
    const { project, past } = get()
    if (!project) return
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] })
  },

  mutate: (fn, options) => {
    const { project, past, future } = get()
    if (!project) return
    const next = structuredClone(project)
    fn(next)
    next.duration = projectDuration(next)
    const withHistory = options?.history !== false
    set({
      project: next,
      past: withHistory ? [...past, project].slice(-HISTORY_LIMIT) : past,
      future: withHistory ? [] : future,
      saveState: 'dirty'
    })
  },

  undo: () => {
    const { past, future, project } = get()
    if (!project || !past.length) return
    const previous = past[past.length - 1]
    set({ project: previous, past: past.slice(0, -1), future: [project, ...future].slice(0, HISTORY_LIMIT), saveState: 'dirty' })
  },
  redo: () => {
    const { past, future, project } = get()
    if (!project || !future.length) return
    const next = future[0]
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: future.slice(1), saveState: 'dirty' })
  },

  save: async (silent = false) => {
    const { project, pushToast } = get()
    if (!project) return
    set({ saveState: 'saving' })
    try {
      const saved = await window.api.projects.save(project)
      set({ project: { ...get().project, ...saved }, saveState: 'saved' })
      if (!silent) pushToast('success', 'Project saved', saved.name)
    } catch (error) {
      set({ saveState: 'dirty' })
      pushToast('error', 'Could not save project', (error as Error).message)
    }
  },

  renameProject: (name) => {
    const { project } = get()
    if (!project) return
    get().mutate((draft) => {
      draft.name = name || 'Untitled project'
    })
  }
}))
