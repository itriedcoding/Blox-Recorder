import { useEffect } from 'react'
import { useStore } from './state/store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { Icon } from './components/Icon'
import { RecordPage } from './pages/RecordPage'
import { EditorPage } from './pages/EditorPage'
import { LibraryPage } from './pages/LibraryPage'
import { ScreenshotsPage } from './pages/ScreenshotsPage'
import { ExportsPage } from './pages/ExportsPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App(): JSX.Element {
  const initialized = useStore((state) => state.initialized)
  const view = useStore((state) => state.view)
  const project = useStore((state) => state.project)
  const saveState = useStore((state) => state.saveState)
  const settings = useStore((state) => state.settings)

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  useEffect(() => {
    const unsubTick = window.api.recorder.onTick((status) => useStore.getState().setRecorder(status))
    const unsubPhase = window.api.recorder.onPhase((status) => useStore.getState().setRecorder(status))
    const unsubFinal = window.api.recorder.onFinalized((result) => useStore.getState().setLastResult(result))
    return () => {
      unsubTick()
      unsubPhase()
      unsubFinal()
    }
  }, [])

  useEffect(() => {
    const unsub = window.api.shortcuts.onTrigger((action) => {
      const state = useStore.getState()
      if (action === 'saveProject') {
        if (state.project) void state.save()
        return
      }
      if (action === 'openEditor' && state.project) {
        state.setView('editor')
        return
      }
      window.dispatchEvent(new CustomEvent('skyrec:shortcut', { detail: action }))
    })
    return unsub
  }, [])

  // Autosave: snapshot the project into the recovery folder on an interval.
  useEffect(() => {
    if (!settings || !project) return
    const interval = window.setInterval(() => {
      const state = useStore.getState()
      if (!state.project || state.saveState === 'saved' || state.saveState === 'saving') return
      void window.api.projects.autosave(state.project).catch(() => undefined)
    }, Math.max(5, settings.autoSaveSeconds) * 1000)
    return () => window.clearInterval(interval)
  }, [project, settings, saveState])

  if (!initialized) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-0)]">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 shadow-[0_16px_40px_-12px_rgba(34,188,255,0.8)]">
          <Icon name="record" size={20} className="text-[#04131c]" />
        </div>
        <div className="text-[0.8rem] text-[var(--text-2)]">Starting SkyRec Studio…</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-0)]">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {view === 'record' ? <RecordPage /> : null}
          {view === 'editor' ? <EditorPage /> : null}
          {view === 'library' ? <LibraryPage /> : null}
          {view === 'screenshots' ? <ScreenshotsPage /> : null}
          {view === 'exports' ? <ExportsPage /> : null}
          {view === 'settings' ? <SettingsPage /> : null}
        </main>
      </div>
      <Toasts />
    </div>
  )
}
