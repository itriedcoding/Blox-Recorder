#!/usr/bin/env node
/**
 * Boot smoke test for the built main process.
 *
 * It loads `out/main/index.js` with a mocked `electron` module and runs the real
 * bootstrap path: settings load, directory creation, IPC registration, media
 * protocol handler, display-media handler, window creation and recorder/exporter
 * attachment. That is exactly the code that runs first on a user's machine, and
 * the Electron APIs it touches (BrowserWindow, ipcMain, session, screen,
 * desktopCapturer, protocol, globalShortcut) are all faked here.
 *
 * It cannot verify pixels or Windows capture, but it does prove the packaged
 * main process starts, registers every IPC channel, and creates its window
 * without throwing.
 */
import Module from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const mainBundle = path.join(root, 'out', 'main', 'index.js')
const preloadBundle = path.join(root, 'out', 'preload', 'index.js')
const rendererHtml = path.join(root, 'out', 'renderer', 'index.html')

if (!fs.existsSync(mainBundle)) {
  console.error(`smoke: ${mainBundle} is missing -- run "npm run build" first`)
  process.exit(1)
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'skyrec-smoke-'))
const videos = path.join(userData, 'Videos')
fs.mkdirSync(videos, { recursive: true })

const handlers = new Map()
const windows = []
const schemeRegistrations = []
const protocolHandlers = new Map()
const sessionHandlers = {}
const shortcutRegistrations = []
let didFinishBootstrap = false
let bootstrapError = null
const listeners = new Map()

function makeWindow(options) {
  const contents = {
    send: () => undefined,
    once: () => contents,
    on: () => contents,
    setWindowOpenHandler: () => contents,
    openDevTools: () => undefined,
    executeJavaScript: async () => undefined,
    insertCSS: async () => '',
    getURL: () => '',
    session: fakeSession,
    id: windows.length + 1
  }
  const win = {
    options,
    webContents: contents,
    once: () => win,
    on: () => win,
    show: () => undefined,
    hide: () => undefined,
    focus: () => undefined,
    restore: () => undefined,
    isDestroyed: () => false,
    isMaximized: () => false,
    isMinimized: () => false,
    minimize: () => undefined,
    maximize: () => undefined,
    unmaximize: () => undefined,
    close: () => undefined,
    destroy: () => undefined,
    setBounds: () => undefined,
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    setAlwaysOnTop: () => undefined,
    setFullScreen: () => undefined,
    setMenuBarVisibility: () => undefined,
    loadURL: async () => undefined,
    loadFile: async () => undefined
  }
  windows.push(win)
  return win
}

const fakeSession = {
  setDisplayMediaRequestHandler: (handler, options) => {
    sessionHandlers.displayMedia = { handler, options }
  },
  setPermissionRequestHandler: (handler) => {
    sessionHandlers.permission = handler
  },
  clearCache: async () => undefined,
  webRequest: { onHeadersReceived: () => undefined },
  setPermissionCheckHandler: () => undefined,
  cookies: { get: async () => [] }
}

const electron = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return userData
      if (name === 'videos') return videos
      if (name === 'logs') return path.join(userData, 'logs')
      if (name === 'temp') return path.join(userData, 'temp')
      if (name === 'home') return userData
      return userData
    },
    getVersion: () => '1.0.0',
    getName: () => 'SkyRec Studio',
    setName: () => undefined,
    setAppUserModelId: () => undefined,
    requestSingleInstanceLock: () => true,
    releaseSingleInstanceLock: () => undefined,
    whenReady: () => Promise.resolve(),
    quit: () => undefined,
    exit: () => undefined,
    relaunch: () => undefined,
    getAppMetrics: () => [],
    getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled' }),
    isPackaged: false,
    on: (event, handler) => listeners.set(event, handler),
    once: (event, handler) => listeners.set(event, handler),
    removeAllListeners: () => undefined,
    commandLine: { appendSwitch: () => undefined, appendArgument: () => undefined },
    setPath: () => undefined,
    disableHardwareAcceleration: () => undefined
  },
  BrowserWindow: Object.assign(
    function BrowserWindow(options) {
      return makeWindow(options)
    },
    {
      getAllWindows: () => windows,
      fromWebContents: () => windows[0] ?? null,
      getFocusedWindow: () => windows[0] ?? null
    }
  ),
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler),
    handleOnce: (channel, handler) => handlers.set(channel, handler),
    on: (channel) => handlers.set(channel, () => undefined),
    once: (channel) => handlers.set(channel, () => undefined),
    removeHandler: (channel) => handlers.delete(channel),
    removeAllListeners: () => undefined
  },
  protocol: {
    registerSchemesAsPrivileged: (schemes) => schemeRegistrations.push(...schemes),
    handle: (scheme, handler) => protocolHandlers.set(scheme, handler),
    isProtocolHandled: () => false
  },
  session: { defaultSession: fakeSession, fromPartition: () => fakeSession },
  net: {
    fetch: async () => new Response('ok', { status: 200 }),
    isOnline: () => true,
    resolveHost: async () => ({ endpoints: [] })
  },
  shell: {
    openExternal: async () => undefined,
    openPath: async () => '',
    showItemInFolder: () => undefined,
    trashItem: async () => undefined
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
    showErrorBox: () => undefined
  },
  screen: {
    getAllDisplays: () => [
      { id: 1, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true },
      { id: 2, label: 'Display 2', bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, scaleFactor: 1, primary: false }
    ],
    getPrimaryDisplay: () => ({ id: 1, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true }),
    getDisplayNearestPoint: () => ({ id: 1, label: 'Display 1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true }),
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    on: () => undefined,
    removeListener: () => undefined
  },
  desktopCapturer: {
    getSources: async () => [
      {
        id: 'screen:0:0',
        name: 'Display 1',
        display_id: '1',
        thumbnail: { toDataURL: () => 'data:image/png;base64,', getSize: () => ({ width: 0, height: 0 }), isEmpty: () => true },
        appIcon: null
      }
    ]
  },
  globalShortcut: {
    register: (accelerator, handler) => {
      shortcutRegistrations.push({ accelerator, handler })
      return true
    },
    unregister: () => undefined,
    unregisterAll: () => undefined,
    isRegistered: () => true
  },
  Menu: {
    setApplicationMenu: () => undefined,
    buildFromTemplate: () => ({}),
    getApplicationMenu: () => null
  },
  Tray: function Tray() {
    return { setToolTip: () => undefined, setContextMenu: () => undefined, on: () => undefined, destroy: () => undefined, popUpContextMenu: () => undefined }
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, toDataURL: () => '', resize: () => ({}) }),
    createEmpty: () => ({ isEmpty: () => true, toDataURL: () => '' })
  },
  nativeTheme: { shouldUseDarkColors: true, on: () => undefined, themeSource: 'system' },
  clipboard: { writeImage: () => undefined, writeText: () => undefined, readText: () => '' },
  powerMonitor: { getSystemIdleState: () => 'active', getSystemIdleTime: () => 0, on: () => undefined },
  powerSaveBlocker: { start: () => 1, stop: () => undefined, isStarted: () => true },
  Notification: function Notification() {
    return { show: () => undefined, on: () => undefined }
  },
  systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: async () => true },
  webContents: { getAllWebContents: () => [] }
}

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electron
  return originalLoad.call(this, request, parent, isMain)
}

const require = Module.createRequire(import.meta.url)
let loadError = null
try {
  require(mainBundle)
} catch (error) {
  loadError = error
}

const deadline = Date.now() + 20_000
async function waitFor(condition) {
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

const failures = []
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` -- ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`)
  }
}

if (loadError) {
  console.error('smoke: main bundle threw while loading:', loadError)
  process.exit(1)
}

// bootstrap() is started by app.whenReady(); wait for the artefacts it creates.
const booted = await waitFor(() => windows.length > 0 && handlers.size > 20)
didFinishBootstrap = booted
if (!booted) bootstrapError = 'bootstrap did not create a window and register IPC handlers in time'

console.log('\nmain-process boot smoke test')
check('media:// scheme registered as privileged', schemeRegistrations.some((entry) => entry.scheme === 'media'))
check('app bootstrap created the main window', windows.length > 0, `windows=${windows.length}`)
check('window uses the frameless black shell', windows[0]?.options?.frame === false && windows[0]?.options?.backgroundColor === '#05070b')
check(
  'window is sandboxed (contextIsolation, no node integration)',
  windows[0]?.options?.webPreferences?.contextIsolation === true && windows[0]?.options?.webPreferences?.nodeIntegration === false
)
check('media protocol handler installed', protocolHandlers.has('media'))
check('display-media request handler installed', Boolean(sessionHandlers.displayMedia))
check('system picker disabled so our staged source is used', sessionHandlers.displayMedia?.options?.useSystemPicker === false)
check('permission handler installed', Boolean(sessionHandlers.permission))
check('ipc handlers registered', handlers.size > 20, `handlers=${handlers.size}`)

const expectedChannels = [
  'app:info',
  'settings:get',
  'settings:update',
  'system:monitors',
  'system:sources',
  'system:stats',
  'system:encoders',
  'recorder:start',
  'recorder:pause',
  'recorder:resume',
  'recorder:stop',
  'recorder:status',
  'recorder:recovery-list',
  'input:state',
  'presets:list',
  'projects:list',
  'projects:save',
  'projects:autosave',
  'media:probe',
  'media:thumbnail',
  'media:waveform',
  'media:detect-silence',
  'exports:enqueue',
  'exports:list',
  'screenshots:capture',
  'screenshots:save',
  'library:recordings',
  'window:minimize',
  'window:close'
]
const missingHandlers = expectedChannels.filter((channel) => !handlers.has(channel))
check('every expected IPC channel is registered', missingHandlers.length === 0, missingHandlers.join(', '))

check('recordings directory created', fs.existsSync(path.join(videos, 'SkyRec')))
check('preload bundle exists next to main', fs.existsSync(preloadBundle))
check('renderer entry exists next to main', fs.existsSync(rendererHtml))

// Exercise the real handlers that do not need a Windows desktop.
try {
  const info = await handlers.get('app:info')({})
  check(
    'app:info returns install details',
    Boolean(info && typeof info.version === 'string' && typeof info.recordingsDir === 'string'),
    JSON.stringify(info && { version: info.version, platform: info.platform, encoders: Array.isArray(info.encoders) })
  )
} catch (error) {
  check('app:info returns install details', false, error.message)
}

try {
  const monitors = await handlers.get('system:monitors')({})
  check('system:monitors maps the OS displays', Array.isArray(monitors) && monitors.length === 2 && monitors[0].primary === true)
} catch (error) {
  check('system:monitors maps the OS displays', false, error.message)
}

try {
  const status = await handlers.get('recorder:status')({})
  check('recorder:status is idle before recording', status?.phase === 'idle', JSON.stringify(status?.phase))
} catch (error) {
  check('recorder:status is idle before recording', false, error.message)
}

try {
  const settings = await handlers.get('settings:get')({})
  check('settings:get returns defaults', settings?.theme === 'dark' && settings?.inputCaptureConsent === false)
  const updated = await handlers.get('settings:update')({}, { theme: 'light' })
  check('settings:update persists the change', updated?.theme === 'light' && (await handlers.get('settings:get')({})).theme === 'light')
  check('settings persisted to disk', fs.existsSync(path.join(userData, 'settings.json')))
} catch (error) {
  check('settings round-trip', false, error.message)
}

try {
  const stats = await handlers.get('system:stats')({})
  check('system:stats returns real numbers', typeof stats?.cpuPercent === 'number' && typeof stats?.memoryMB === 'number')
} catch (error) {
  check('system:stats returns real numbers', false, error.message)
}

try {
  const encoderList = await handlers.get('system:encoders')({}, true)
  check('system:encoders probes FFmpeg', Array.isArray(encoderList) && encoderList.length > 0)
} catch (error) {
  check('system:encoders probes FFmpeg', false, error.message)
}

try {
  const list = await handlers.get('projects:list')({})
  check('projects:list works on an empty library', Array.isArray(list) && list.length === 0)
} catch (error) {
  check('projects:list works on an empty library', false, error.message)
}

if (bootstrapError) check('bootstrap completed', false, bootstrapError)
if (didFinishBootstrap) check('bootstrap completed', true)

fs.rmSync(userData, { recursive: true, force: true })

if (failures.length) {
  console.error(`\nsmoke: ${failures.length} check(s) failed:\n${failures.map((entry) => ` - ${entry}`).join('\n')}`)
  process.exit(1)
}

console.log(`\nsmoke: main process booted and ${handlers.size} IPC handlers are live`)
process.exit(0)
