import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { Icon } from './Icon'

export function TitleBar(): JSX.Element {
  const project = useStore((state) => state.project)
  const saveState = useStore((state) => state.saveState)
  const view = useStore((state) => state.view)
  const recorder = useStore((state) => state.recorder)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.state().then((state) => setMaximized(state.maximized))
    return window.api.window.onStateChange((state) => setMaximized(state.maximized))
  }, [])

  const active = recorder && ['recording', 'paused', 'countdown'].includes(recorder.phase)
  const label = view === 'editor' && project ? project.name : viewTitle(view)

  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[rgba(5,8,12,0.82)] px-3 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-sky-400 to-sky-600 shadow-[0_4px_14px_-4px_rgba(34,188,255,0.9)]">
          <Icon name="record" size={12} className="text-[#04131c]" />
        </div>
        <span className="text-[0.78rem] font-semibold tracking-tight text-[var(--text-0)]">SkyRec Studio</span>
        <span className="h-3.5 w-px bg-[var(--line-strong)]" />
        <span className="truncate text-[0.74rem] text-[var(--text-1)] max-w-[280px]">{label}</span>
        {view === 'editor' && saveState !== 'saved' ? (
          <span className="chip !py-0 !px-2 text-[0.6rem] !text-sky-200 !border-sky-400/30 !bg-sky-400/10">
            {saveState === 'saving' ? 'saving…' : 'unsaved'}
          </span>
        ) : null}
        {active ? (
          <span className="chip !py-0.5 !px-2 !text-[0.62rem] !bg-red-500/15 !border-red-400/35 !text-red-200">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse-rec" />
            {recorder?.phase === 'paused' ? 'paused' : recorder?.phase === 'countdown' ? 'starting' : 'recording'}
          </span>
        ) : null}
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void window.api.window.minimize()}
          className="flex h-8 w-10 items-center justify-center rounded-md text-[var(--text-1)] transition hover:bg-white/5 hover:text-white"
        >
          <Icon name="minimize" size={14} />
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.api.window.toggleMaximize().then(setMaximized)}
          className="flex h-8 w-10 items-center justify-center rounded-md text-[var(--text-1)] transition hover:bg-white/5 hover:text-white"
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
        </button>
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={() => void window.api.window.close()}
          className="flex h-8 w-10 items-center justify-center rounded-md text-[var(--text-1)] transition hover:bg-red-500/90 hover:text-white"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
  )
}

function viewTitle(view: string): string {
  switch (view) {
    case 'record':
      return 'Recorder'
    case 'library':
      return 'Library'
    case 'exports':
      return 'Export queue'
    case 'screenshots':
      return 'Screenshots'
    case 'settings':
      return 'Settings'
    default:
      return 'Editor'
  }
}
