import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, net, protocol, session, shell } from 'electron'
import { IPC } from '@shared/ipc'
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
import { desktopCapturer } from 'electron'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false }
  }
])

app.setAppUserModelId('studio.skyrec.app')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createMainWindow(): BrowserWindow {
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

  window.once('ready-to-show', () => window.show())

  const emitState = (): void => {
    if (!window.isDestroyed()) window.webContents.send(IPC.windowStateChanged, { maximized: window.isMaximized() })
  }
  window.on('maximize', emitState)
  window.on('unmaximize', emitState)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('window', 'renderer process gone', details)
  })

  return window
}

async function bootstrap(): Promise<void> {
  const paths = getPaths()
  configureLogger({ dir: paths.logs })
  await ensureDir(paths.logs)
  await ensureDir(paths.recordings)
  await ensureDir(paths.screenshots)
  await ensureDir(paths.projects)
  await ensureDir(paths.cache)
  await ensureDir(paths.temp)

  const settings = await loadSettings()
  applyMediaDirs(settings)
  primeRecorderSettings(settings)
  setBinaryOverrides({ ffmpegPath: settings.ffmpegPath, ffprobePath: settings.ffprobePath })

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

  registerIpc()
  void refreshSettingsSnapshot()

  mainWindow = createMainWindow()
  recorder.attachWindow(mainWindow)
  exporter.attachWindow(mainWindow)

  registerShortcuts(settings)

  windowState()
  void session.defaultSession.clearCache().catch(() => undefined)

  function windowState(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send(IPC.windowStateChanged, { maximized: mainWindow?.isMaximized() ?? false })
      })
    }
  }

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  logger.info('app', 'SkyRec Studio started', { version: app.getVersion(), platform: process.platform })
}

app.whenReady().then(bootstrap).catch((error) => {
  logger.error('app', 'startup failed', error)
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
