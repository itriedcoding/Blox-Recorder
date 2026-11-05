import path from 'node:path'
import { app } from 'electron'
import type { AppSettings, RecordingPreset } from '@shared/types'
import { defaultPreset, defaultSettings } from '@shared/defaults'
import { getPaths, setMediaDirs } from './paths'
import { readJson, writeJson } from './fsx'
import { logger } from './logger'

let cached: AppSettings | null = null
let cachedPresets: RecordingPreset[] | null = null

function defaultDirs(): { recordingsDir: string; projectsDir: string; screenshotsDir: string } {
  const videos = app.getPath('videos')
  const userData = app.getPath('userData')
  return {
    recordingsDir: path.join(videos, 'SkyRec'),
    projectsDir: path.join(userData, 'projects'),
    screenshotsDir: path.join(videos, 'SkyRec', 'Screenshots')
  }
}

export function normaliseSettings(raw: Partial<AppSettings> | null): AppSettings {
  const base = defaultSettings()
  const merged: AppSettings = {
    ...base,
    ...(raw ?? {}),
    effects: { ...base.effects, ...(raw?.effects ?? {}) },
    shortcuts: { ...base.shortcuts, ...(raw?.shortcuts ?? {}) }
  }
  merged.countdownSeconds = Math.max(0, Math.min(10, Number(merged.countdownSeconds) || 0))
  merged.defaultFps = [24, 30, 50, 60, 120, 144].includes(merged.defaultFps) ? merged.defaultFps : 60
  merged.autoSaveSeconds = Math.max(5, Math.min(300, Number(merged.autoSaveSeconds) || 20))
  return merged
}

export async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached
  const paths = getPaths()
  const raw = await readJson<Partial<AppSettings>>(paths.settingsFile)
  cached = normaliseSettings(raw)
  applyMediaDirs(cached)
  return cached
}

export function applyMediaDirs(settings: AppSettings): void {
  const dirs = defaultDirs()
  setMediaDirs({
    recordingsDir: settings.recordingsDir || dirs.recordingsDir,
    projectsDir: settings.projectsDir || dirs.projectsDir,
    screenshotsDir: settings.screenshotsDir || dirs.screenshotsDir
  })
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const next = normaliseSettings({
    ...current,
    ...patch,
    effects: { ...current.effects, ...(patch.effects ?? {}) },
    shortcuts: { ...current.shortcuts, ...(patch.shortcuts ?? {}) }
  })
  cached = next
  applyMediaDirs(next)
  await writeJson(getPaths().settingsFile, next)
  logger.info('settings', 'settings updated', { keys: Object.keys(patch) })
  return next
}

export async function resetSettings(): Promise<AppSettings> {
  cached = defaultSettings()
  applyMediaDirs(cached)
  await writeJson(getPaths().settingsFile, cached)
  return cached
}

export async function listPresets(): Promise<RecordingPreset[]> {
  if (cachedPresets) return cachedPresets
  const stored = await readJson<RecordingPreset[]>(getPaths().presetsFile)
  const base = defaultPreset()
  const presets = Array.isArray(stored) && stored.length ? stored : [base]
  if (!presets.some((preset) => preset.id === base.id) && !stored?.length) {
    presets.unshift(base)
  }
  const normalised = presets.map((preset) => ({
    ...defaultPreset(),
    ...preset,
    webcam: { ...defaultPreset().webcam, ...(preset.webcam ?? {}) },
    effects: { ...defaultPreset().effects, ...(preset.effects ?? {}) },
    region: { ...defaultPreset().region, ...(preset.region ?? {}) }
  }))
  cachedPresets = normalised
  return normalised
}

export async function savePreset(preset: RecordingPreset): Promise<RecordingPreset[]> {
  const presets = await listPresets()
  const index = presets.findIndex((entry) => entry.id === preset.id)
  if (index >= 0) presets[index] = preset
  else presets.push(preset)
  cachedPresets = presets
  await writeJson(getPaths().presetsFile, presets)
  return presets
}

export async function deletePreset(id: string): Promise<RecordingPreset[]> {
  const presets = (await listPresets()).filter((entry) => entry.id !== id)
  cachedPresets = presets.length ? presets : [defaultPreset()]
  await writeJson(getPaths().presetsFile, cachedPresets)
  return cachedPresets
}

export function invalidatePresetCache(): void {
  cachedPresets = null
}
