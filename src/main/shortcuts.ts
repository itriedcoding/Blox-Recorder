import { BrowserWindow, globalShortcut } from 'electron'
import type { AppSettings, ShortcutAction } from '@shared/types'
import { IPC } from '@shared/ipc'
import { logger } from './logger'

let registered = new Set<string>()

function send(action: ShortcutAction): void {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.isVisible())
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
  window.webContents.send(IPC.shortcut, action)
}

export function registerShortcuts(settings: AppSettings): void {
  for (const accelerator of registered) {
    try {
      globalShortcut.unregister(accelerator)
    } catch {
      /* ignore */
    }
  }
  registered = new Set()
  const actions = Object.keys(settings.shortcuts) as ShortcutAction[]
  for (const action of actions) {
    const accelerator = settings.shortcuts[action]?.trim()
    if (!accelerator) continue
    if (registered.has(accelerator)) continue
    try {
      const ok = globalShortcut.register(accelerator, () => send(action))
      if (ok) {
        registered.add(accelerator)
      } else {
        logger.warn('shortcuts', 'shortcut already in use', { accelerator, action })
      }
    } catch (error) {
      logger.warn('shortcuts', 'invalid shortcut', { accelerator, action, error: (error as Error).message })
    }
  }
  logger.info('shortcuts', 'global shortcuts registered', { count: registered.size })
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
  registered = new Set()
}
