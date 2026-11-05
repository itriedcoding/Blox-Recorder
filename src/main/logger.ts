import { appendFile, ensureDir } from './fsx'

export type LogLevel = 'info' | 'warn' | 'error'

interface LogOptions {
  dir: string
  fileName?: string
}

let options: LogOptions | null = null

export function configureLogger(opts: LogOptions): void {
  options = opts
}

function line(level: LogLevel, scope: string, message: string, detail?: unknown): string {
  const timestamp = new Date().toISOString()
  const extra = detail === undefined ? '' : ` ${safeStringify(detail)}`
  return `${timestamp} [${level.toUpperCase()}] [${scope}] ${message}${extra}\n`
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return JSON.stringify({ message: value.message, stack: value.stack })
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function log(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  const text = line(level, scope, message, detail)
  if (level === 'error') console.error(text.trimEnd())
  else if (level === 'warn') console.warn(text.trimEnd())
  else console.log(text.trimEnd())
  if (!options) return
  const path = `${options.dir}/${options.fileName ?? 'app.log'}`
  void ensureDir(options.dir)
    .then(() => appendFile(path, text))
    .catch(() => undefined)
}

export const logger = {
  info: (scope: string, message: string, detail?: unknown) => log('info', scope, message, detail),
  warn: (scope: string, message: string, detail?: unknown) => log('warn', scope, message, detail),
  error: (scope: string, message: string, detail?: unknown) => log('error', scope, message, detail)
}
