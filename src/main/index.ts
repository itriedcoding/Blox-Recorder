import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, desktopCapturer, dialog, ipcMain, net, protocol, session, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings } from '@shared/types'
import { getPaths, mediaUrl } from './paths'
import { configureLogger, logger } from './logger'
import { applyMediaDirs, loadSettings, updateSettings } from './settings'
import { registerIpc, refreshSettingsSnapshot } from './ipc'
import { setBinaryOverrides } from './ffmpeg'
import { primeRecorderSettings, recorder } from './recorder'
import { exporter } from './exporter'
import { ensureDir } from './fsx'
import { consumeCapture } from './capture-state'
import { registerShortcuts, unregisterShortcuts } from './shortcuts'
import { diagnosticsSnapshot, installCrashHandlers, launchLogPath, markStep, recordError } from './diagnostics'

/**
 * `--self-test` boots the real application, waits for the window and the
 * renderer, prints one machine-readable line and exits. CI runs it against the
 * packaged .exe so "the installer starts" is verified, not assumed.
 */
const SELF_TEST = process.argv.includes('--self-test')

installCrashHandlers((message) => {
  console.error(`[fatal] ${message}`)
  if (SELF_TEST) return
  try {
    dialog.showErrorBox('SkyRec Studio could not start', `${message}\n\nDetails: ${launchLogPath()}`)
  } catch {
    /* the dialog is a courtesy; failing to show it must not mask the real error */
  }
})

markStep('main bundle loaded', {
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  platform: process.platform,
  packaged: app.isPackaged
})

if (SELF_TEST) {
  // CI machines have no GPU driver; the boot path is what is under test here.
  app.disableHardwareAcceleration()
  app.setPath('userData', path.join(app.getPath('temp'), `skyrec-self-test-${process.pid}`))
  markStep('self-test mode', { userData: app.getPath('userData') })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false }
  }
])

app.setAppUserModelId('studio.skyrec.app')

// A second launch must never be the thing that leaves the app looking dead: when
// the lock is held we signal the existing instance and exit, and the first
// instance brings its window to the front (see the 'second-instance' handler).
const gotLock = SELF_TEST ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  markStep('another instance already holds the single-instance lock')
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let windowShown = false
let rendererReport: { mounted?: boolean; bridge?: boolean; href?: string } | null = null

function showWindow(window: BrowserWindow, reason: string): void {
  if (windowShown) return
  if (window.isDestroyed()) return
  windowShown = true
  markStep('main window shown', { reason })
  try {
    window.show()
    window.focus()
  } catch (error) {
    recordError('window', error)
  }
}

function failurePage(code: number, description: string, url: string): string {
  const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>SkyRec Studio</title></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#05070b;color:#dbe7f3;font:14px/1.6 system-ui,sans-serif">
<div style="max-width:680px;padding:32px;text-align:center">
<h1 style="font-size:18px;margin:0 0 12px">The SkyRec Studio interface failed to load</h1>
<p style="color:#93a4b8;margin:0 0 8px">${escape(description || 'Unknown error')} (code ${code})</p>
<p style="color:#93a4b8;margin:0 0 8px;word-break:break-all">${escape(url)}</p>
<p style="color:#93a4b8;margin:0">Full details are in <code>${escape(launchLogPath())}</code></p>
</div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function createMainWindow(): BrowserWindow {
  markStep('creating main window')
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#05070b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  window.once('ready-to-show', () => showWindow(window, 'ready-to-show'))
  window.webContents.once('did-finish-load', () => showWindow(window, 'did-finish-load'))

  // If the renderer never paints (GPU reset, blocked script, crash) the user
  // gets a visible window instead of a process with no UI.
  const showTimer = setTimeout(() => showWindow(window, 'show-timeout'), 8000)
  window.on('closed', () => clearTimeout(showTimer))

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (url.startsWith('data:text/html')) return
    recordError('renderer', `did-fail-load ${code} ${description} ${url}`)
    showWindow(window, 'renderer-failed')
    void window.loadURL(failurePage(code, description, url)).catch((error) => recordError('renderer', error))
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    recordError('preload', `${preloadPath}: ${error.message}`)
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // Surface renderer errors (including CSP violations) into the launch log.
    if (level >= 2) recordError('renderer-console', `${message} (${sourceId}:${line})`)
  })

  const emitState = (): void => {
    if (!window.isDestroyed()) window.webContents.send(IPC.windowStateChanged, { maximized: window.isMaximized() })
  }
  window.on('maximize', emitState)
  window.on('unmaximize', emitState)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    recordError('renderer', `renderer process gone: ${details.reason} (exit ${details.exitCode})`)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const loaded = devUrl
    ? window.loadURL(devUrl)
    : window.loadFile(path.join(__dirname, '../renderer/index.html'))

  void loaded.catch((error) => {
    recordError('renderer', error)
    showWindow(window, 'renderer-load-rejected')
    const target = devUrl ?? path.join(__dirname, '../renderer/index.html')
    void window
      .loadURL(failurePage(0, `Could not load ${target}`, target))
      .catch((fallbackError) => recordError('renderer', fallbackError))
  })

  return window
}

async function bootstrap(): Promise<void> {
  markStep('app ready')
  const paths = getPaths()
  configureLogger({ dir: paths.logs })

  for (const dir of [paths.logs, paths.recordings, paths.screenshots, paths.projects, paths.cache, paths.temp]) {
    try {
      await ensureDir(dir)
    } catch (error) {
      // A redirected or read-only Videos folder must not stop the app.
      recordError('directories', `${dir}: ${(error as Error).message}`)
    }
  }
  markStep('directories prepared')

  let settings: AppSettings
  try {
    settings = await loadSettings()
  } catch (error) {
    recordError('settings', error)
    settings = defaultSettings()
  }
  try {
    applyMediaDirs(settings)
  } catch (error) {
    recordError('settings', error)
  }
  primeRecorderSettings(settings)
  setBinaryOverrides({ ffmpegPath: settings.ffmpegPath, ffprobePath: settings.ffprobePath })
  markStep('settings loaded', { theme: settings.theme, inputConsent: settings.inputCaptureConsent })

  try {
    protocol.handle('media', async (request) => {
      try {
        const url = new URL(request.url)
        const file = url.searchParams.get('path')
        if (!file) return new Response('Missing path', { status: 400 })
        const response = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
        const headers = new Headers(response.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
        headers.set('Cache-Control', 'no-store')
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
      } catch (error) {
        logger.warn('protocol', 'media request failed', { url: request.url, error: (error as Error).message })
        return new Response('Not found', { status: 404 })
      }
    })
  } catch (error) {
    recordError('protocol', error)
  }

  try {
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        const pending = consumeCapture()
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
          const source = pending ? sources.find((entry) => entry.id === pending.sourceId) : sources[0]
          if (!source) {
            callback({})
            return
          }
          const canLoopback = process.platform === 'win32' && pending?.systemAudio
          callback(canLoopback ? { video: source, audio: 'loopback' } : { video: source })
        } catch (error) {
          logger.error('capture', 'display media request failed', error)
          callback({})
        }
      },
      { useSystemPicker: false }
    )

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      // Media permissions are only ever requested by our own recorder UI.
      callback(permission === 'media' || permission === 'display-capture' || permission === 'mediaKeySystem')
    })
  } catch (error) {
    recordError('session', error)
  }
  markStep('capture handlers installed')

  try {
    registerIpc()
  } catch (error) {
    recordError('ipc', error)
    notifyFatalIfSelfTest(error)
  }
  void refreshSettingsSnapshot().catch((error) => recordError('settings', error))

  ipcMain.on(IPC.rendererReady, (_event, payload) => {
    rendererReport = (payload ?? {}) as typeof rendererReport
    markStep('renderer reported ready', rendererReport)
  })

  mainWindow = createMainWindow()
  recorder.attachWindow(mainWindow)
  exporter.attachWindow(mainWindow)

  try {
    registerShortcuts(settings)
  } catch (error) {
    recordError('shortcuts', error)
  }

  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.windowStateChanged, { maximized: mainWindow.isMaximized() })
    }
  })

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow()
      recorder.attachWindow(mainWindow)
      exporter.attachWindow(mainWindow)
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    showWindow(mainWindow, 'second-instance')
    mainWindow.focus()
  })

  void session.defaultSession.clearCache().catch((error) => recordError('session', error))

  logger.info('app', 'SkyRec Studio started', { version: app.getVersion(), platform: process.platform })
  markStep('bootstrap complete', { ipcHandlersReady: true, build: app.getVersion() })

  if (SELF_TEST) void runSelfTest()
}

function notifyFatalIfSelfTest(error: unknown): void {
  if (SELF_TEST) {
    console.error(`SELF-TEST FAILED ${JSON.stringify({ reason: 'ipc registration failed', error: String(error) })}`)
    app.exit(1)
  }
}

async function runSelfTest(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !rendererReport) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  let bridge = false
  let visible = false
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      bridge = await mainWindow.webContents.executeJavaScript('typeof window.api === "object"', true)
    } catch (error) {
      recordError('self-test:bridge', error)
    }
    visible = mainWindow.isVisible()
  }

  const snapshot = diagnosticsSnapshot()
  const ok = Boolean(rendererReport?.mounted && windowShown && bridge && visible && snapshot.errors.length === 0)
  const report = {
    ok,
    windowShown,
    visible,
    rendererReport,
    bridge,
    errors: snapshot.errors.length,
    launchLog: snapshot.launchLog,
    uptimeMs: snapshot.uptimeMs,
    diagnostics: snapshot
  }
  console.log(`${ok ? 'SELF-TEST OK' : 'SELF-TEST FAILED'} ${JSON.stringify(report)}`)
  markStep(ok ? 'self-test passed' : 'self-test failed', report)
  app.exit(ok ? 0 : 1)
}

app.whenReady().then(bootstrap).catch((error) => {
  recordError('bootstrap', error)
  logger.error('app', 'startup failed', error)
  if (SELF_TEST) {
    console.log(`SELF-TEST FAILED ${JSON.stringify({ reason: 'bootstrap threw', error: String(error), diagnostics: diagnosticsSnapshot() })}`)
    app.exit(1)
    return
  }
  try {
    dialog.showErrorBox(
      'SkyRec Studio could not start',
      `${(error as Error).message ?? error}\n\nA log was written to ${launchLogPath()}`
    )
  } catch {
    /* ignore */
  }
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow()
    recorder.attachWindow(mainWindow)
    exporter.attachWindow(mainWindow)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  unregisterShortcuts()
})

app.on('before-quit', () => {
  void recorder.shutdown()
})

export { mediaUrl, updateSettings }
