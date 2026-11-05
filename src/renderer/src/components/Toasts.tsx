import { useStore } from '../state/store'
import { Icon } from './Icon'

export function Toasts(): JSX.Element {
  const toasts = useStore((state) => state.toasts)
  const dismiss = useStore((state) => state.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => {
        const tone =
          toast.kind === 'error'
            ? 'border-red-400/35 bg-[rgba(40,12,18,0.94)]'
            : toast.kind === 'success'
              ? 'border-emerald-400/30 bg-[rgba(9,32,26,0.94)]'
              : 'border-[var(--line-strong)] bg-[rgba(10,15,22,0.95)]'
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto animate-fade-in rounded-xl border px-3.5 py-2.5 shadow-[0_18px_48px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md ${tone}`}
          >
            <div className="flex items-start gap-2.5">
              <Icon
                name={toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'info'}
                size={15}
                className={toast.kind === 'error' ? 'mt-0.5 text-red-300' : toast.kind === 'success' ? 'mt-0.5 text-emerald-300' : 'mt-0.5 text-sky-300'}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[0.78rem] font-medium text-[var(--text-0)]">{toast.title}</div>
                {toast.detail ? <div className="mt-0.5 break-words text-[0.7rem] leading-relaxed text-[var(--text-2)]">{toast.detail}</div> : null}
              </div>
              <button type="button" onClick={() => dismiss(toast.id)} className="text-[var(--text-2)] hover:text-white">
                <Icon name="close" size={13} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
