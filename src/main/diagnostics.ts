/**
 * Startup diagnostics.
 *
 * The main process can fail before Electron is ready (bad binary, blocked
 * native module, unwritable data directory) or before a window ever paints.
 * In both cases the user sees nothing at all, which is impossible to debug.
 * This module writes a synchronous launch log from the very first statement of
 * the bundle, so a launch that never reaches the logger still leaves evidence.
 *
 * It deliberately avoids `app.getPath()`: it must work before `whenReady()`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface StepEntry {
  step: string
  elapsedMs: number
  detail?: string
}

export interface ErrorEntry {
  at: string
  scope: string
  message: string
  stack?: string
}

const startedAt = Date.now()
const steps: StepEntry[] = []
const errors: ErrorEntry[] = []

let fatalHandler: ((message: string) => void) | null = null
let fatalShown = false

function summarise(value: unknown): string {
  if (value instanceof Error) return value.message
  if (value === undefined) return ''
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text && text.length > 600 ? `${text.slice(0, 600)}…` : (text ?? '')
  } catch {
    return String(value)
  }
}

function resolveLogFile(): string {
  const override = process.env['SKYREC_LAUNCH_LOG']
  if (override) return override
  // Windows: %APPDATA%\skyrec\logs\launch.log (Electron's userData folder).
  const roaming = process.env['APPDATA']
  if (roaming) return path.join(roaming, 'skyrec', 'logs', 'launch.log')
  const stateHome = process.env['XDG_STATE_HOME'] ?? path.join(os.homedir(), '.local', 'state')
  return path.join(stateHome, 'skyrec', 'logs', 'launch.log')
}

export function launchLogPath(): string {
  return resolveLogFile()
}

/** Append one line to the launch log. Never throws, never blocks the caller. */
export function writeLaunchLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  try {
    const file = resolveLogFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, line)
  } catch {
    /* a log we cannot write must never be the reason the app fails */
  }
  try {
    console.log(line.trimEnd())
  } catch {
    /* ignore */
  }
}

export function markStep(step: string, detail?: unknown): void {
  const elapsedMs = Date.now() - startedAt
  const text = summarise(detail)
  steps.push({ step, elapsedMs, detail: text || undefined })
  writeLaunchLog(`step ${step} (+${elapsedMs}ms)${text ? ` ${text}` : ''}`)
}

export function recordError(scope: string, error: unknown): void {
  const entry: ErrorEntry = {
    at: new Date().toISOString(),
    scope,
    message: error instanceof Error ? error.message : summarise(error) || 'unknown error',
    stack: error instanceof Error ? (error.stack ?? undefined) : undefined
  }
  errors.push(entry)
  writeLaunchLog(`error [${scope}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ''}`)
}

export function diagnosticsSnapshot(): {
  startedAt: string
  uptimeMs: number
  steps: StepEntry[]
  errors: ErrorEntry[]
  launchLog: string
} {
  return {
    startedAt: new Date(startedAt).toISOString(),
    uptimeMs: Date.now() - startedAt,
    steps: [...steps],
    errors: [...errors],
    launchLog: launchLogPath()
  }
}

/**
 * Uncaught main-process errors used to end the process silently. Now they are
 * written to disk and surfaced through the fatal handler (the app shows a
 * dialog) so a broken launch is never invisible.
 */
export function installCrashHandlers(onFatal?: (message: string) => void): void {
  fatalHandler = onFatal ?? null
  process.on('uncaughtException', (error) => {
    recordError('uncaughtException', error)
    notifyFatal(error instanceof Error ? error.message : String(error))
  })
  process.on('unhandledRejection', (reason) => {
    recordError('unhandledRejection', reason)
  })
}

export function notifyFatal(message: string): void {
  if (fatalShown) return
  fatalShown = true
  writeLaunchLog(`fatal ${message}`)
  try {
    fatalHandler?.(message)
  } catch {
    /* ignore */
  }
}
