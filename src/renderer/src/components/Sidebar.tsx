import { useStore, type View } from '../state/store'
import { Icon, type IconName } from './Icon'

const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: 'record', label: 'Record', icon: 'record' },
  { view: 'editor', label: 'Editor', icon: 'film' },
  { view: 'library', label: 'Library', icon: 'folder' },
  { view: 'screenshots', label: 'Screens', icon: 'image' },
  { view: 'exports', label: 'Exports', icon: 'export' }
]

export function Sidebar(): JSX.Element {
  const view = useStore((state) => state.view)
  const setView = useStore((state) => state.setView)
  const appInfo = useStore((state) => state.appInfo)
  const project = useStore((state) => state.project)

  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center justify-between border-r border-[var(--line)] bg-[rgba(6,10,16,0.6)] py-3">
      <div className="flex w-full flex-col items-center gap-1">
        {NAV.map((item) => {
          const active = view === item.view
          const disabled = item.view === 'editor' && !project
          return (
            <button
              key={item.view}
              type="button"
              disabled={disabled}
              onClick={() => setView(item.view)}
              title={item.label}
              className={`group relative flex w-[60px] flex-col items-center gap-1 rounded-xl py-2 transition-all duration-150 ${
                active ? 'bg-[rgba(34,188,255,0.14)] text-sky-200' : 'text-[var(--text-2)] hover:bg-white/5 hover:text-[var(--text-0)]'
              } ${disabled ? 'opacity-30 pointer-events-none' : ''}`}
            >
              {active ? <span className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r bg-sky-400" /> : null}
              <Icon name={item.icon} size={19} />
              <span className="text-[0.6rem] font-medium tracking-wide">{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex w-full flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => setView('settings')}
          title="Settings"
          className={`flex w-[60px] flex-col items-center gap-1 rounded-xl py-2 transition-all ${
            view === 'settings' ? 'bg-[rgba(34,188,255,0.14)] text-sky-200' : 'text-[var(--text-2)] hover:bg-white/5 hover:text-[var(--text-0)]'
          }`}
        >
          <Icon name="settings" size={18} />
          <span className="text-[0.6rem] font-medium">Settings</span>
        </button>
        <span className="mt-1 text-[0.55rem] font-mono text-[var(--text-2)]">v{appInfo?.version ?? '1.0.0'}</span>
      </div>
    </nav>
  )
}
