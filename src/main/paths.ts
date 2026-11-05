import { app } from 'electron'
import path from 'node:path'
import { exists } from './fsx'

export interface AppPaths {
  userData: string
  logs: string
  projects: string
  recordings: string
  screenshots: string
  sessions: string
  cache: string
  temp: string
  settingsFile: string
  presetsFile: string
  presetsThumbs: string
}

let overrideDirs: { recordingsDir: string; projectsDir: string; screenshotsDir: string } | null = null

export function setMediaDirs(dirs: { recordingsDir: string; projectsDir: string; screenshotsDir: string }): void {
  overrideDirs = dirs
}

export function getPaths(): AppPaths {
  const userData = app.getPath('userData')
  const videos = app.getPath('videos')
  const recordings = overrideDirs?.recordingsDir || path.join(videos, 'SkyRec')
  const projects = overrideDirs?.projectsDir || path.join(userData, 'projects')
  const screenshots = overrideDirs?.screenshotsDir || path.join(videos, 'SkyRec', 'Screenshots')
  return {
    userData,
    logs: path.join(userData, 'logs'),
    projects,
    recordings,
    screenshots,
    sessions: path.join(recordings, '.sessions'),
    cache: path.join(userData, 'cache'),
    temp: path.join(userData, 'temp'),
    settingsFile: path.join(userData, 'settings.json'),
    presetsFile: path.join(userData, 'presets.json'),
    presetsThumbs: path.join(userData, 'cache', 'thumbs')
  }
}

/** Turn a filesystem path into a URL the renderer can load (range-request safe). */
export function mediaUrl(filePath: string): string {
  return `media://local/file?path=${encodeURIComponent(filePath)}`
}

export async function resolveBundledBinary(candidate: string | null): Promise<string | null> {
  if (!candidate) return null
  const unpacked = candidate.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  if (await exists(unpacked)) return unpacked
  if (await exists(candidate)) return candidate
  return null
}
