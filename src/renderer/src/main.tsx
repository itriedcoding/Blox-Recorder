import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/**
 * Tell the main process the interface is alive. The main process uses this to
 * show the window immediately (instead of waiting for a paint event that may
 * never come) and the `--self-test` CI check uses it as proof the renderer and
 * the preload bridge both work in the packaged build.
 */
function reportReady(): void {
  try {
    const bridge = typeof window !== 'undefined' && typeof window.api === 'object'
    window.api?.app?.rendererReady?.({ mounted: true, bridge, href: window.location.href })
  } catch {
    /* reporting must never be able to break the interface */
  }
}

function FatalScreen({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-0)] p-8 text-center">
      <div className="text-[0.95rem] font-semibold text-[var(--text-0)]">The SkyRec Studio interface could not start</div>
      <div className="max-w-[640px] break-words text-[0.8rem] text-[var(--text-2)]">{message}</div>
      <div className="text-[0.75rem] text-[var(--text-3)]">The full details are written to the application log.</div>
    </div>
  )
}

interface BoundaryState {
  error: string | null
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error: error.message }
  }

  override componentDidCatch(error: Error): void {
    void window.api?.app?.log?.('error', 'renderer', `interface crashed: ${error.message}`)
  }

  override render(): React.ReactNode {
    if (this.state.error) return <FatalScreen message={this.state.error} />
    return this.props.children
  }
}

const container = document.getElementById('root')

try {
  if (!container) throw new Error('Root container missing')
  createRoot(container).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
  // Two frames plus a short delay: readiness means the first frame was painted.
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.setTimeout(reportReady, 200)))
  } else {
    window.setTimeout(reportReady, 200)
  }
} catch (error) {
  if (container) container.textContent = `SkyRec Studio could not start its interface: ${(error as Error).message}`
  reportReady()
}

window.addEventListener('error', (event) => {
  void window.api?.app?.log?.('error', 'renderer', event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
  void window.api?.app?.log?.('error', 'renderer', `unhandled rejection: ${reason}`)
})
