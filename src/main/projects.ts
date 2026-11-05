import path from 'node:path'
import type { Project, ProjectSummary, RecordingResult } from '@shared/types'
import { createProject, defaultClip, newId, projectDuration } from '@shared/defaults'
import { ensureDir, exists, readDir, readJson, remove, stat, writeJson } from './fsx'
import { getPaths } from './paths'
import { logger } from './logger'
import { probeMedia, thumbnail } from './ffmpeg'

const PROJECT_EXTENSION = '.skyrec.json'

function projectFile(id: string): string {
  return path.join(getPaths().projects, `${id}${PROJECT_EXTENSION}`)
}

function recoveryDir(id: string): string {
  return path.join(getPaths().userData, 'recovery', id)
}

export function summariseProject(project: Project, thumbPath: string | null): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    duration: projectDuration(project),
    width: project.width,
    height: project.height,
    fps: project.fps,
    clipCount: project.clips.length,
    thumbnail: thumbPath,
    sourcePath: project.recording?.outputPath ?? null
  }
}

async function thumbnailFor(project: Project): Promise<string | null> {
  const source = project.recording?.outputPath
  if (!source) return null
  if (!(await exists(source))) return null
  return thumbnail(source, Math.min(2, Math.max(0.1, projectDuration(project) / 4)), 480)
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const dir = getPaths().projects
  await ensureDir(dir)
  const entries = await readDir(dir)
  const summaries: ProjectSummary[] = []
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(PROJECT_EXTENSION)) continue
    const project = await readJson<Project>(path.join(dir, entry.name))
    if (!project || !project.id) continue
    summaries.push(summariseProject(project, await thumbnailFor(project)))
  }
  summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return summaries
}

export async function loadProject(id: string): Promise<Project | null> {
  const project = await readJson<Project>(projectFile(id))
  if (!project) return null
  return project
}

export async function saveProject(project: Project): Promise<Project> {
  const withDuration: Project = { ...project, duration: projectDuration(project), updatedAt: new Date().toISOString() }
  await writeJson(projectFile(project.id), withDuration)
  return withDuration
}

export async function deleteProject(id: string): Promise<void> {
  await remove(projectFile(id))
  await remove(recoveryDir(id))
}

export async function createBlankProject(name: string, width = 1920, height = 1080, fps = 60): Promise<Project> {
  const project = createProject(name, width, height, fps)
  return saveProject(project)
}

/** Autosave snapshot used by the recovery flow after a crash. */
export async function autosaveProject(project: Project): Promise<{ savedAt: string; path: string }> {
  const dir = recoveryDir(project.id)
  await ensureDir(dir)
  const stamp = Date.now()
  const file = path.join(dir, `${stamp}.json`)
  await writeJson(file, { project: { ...project, updatedAt: new Date().toISOString() }, savedAt: new Date(stamp).toISOString() })
  // Keep only the five most recent snapshots per project.
  const snapshots = (await readDir(dir))
    .filter((entry) => !entry.isDirectory && entry.name.endsWith('.json'))
    .map((entry) => Number(entry.name.replace('.json', '')))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
  for (const old of snapshots.slice(5)) {
    await remove(path.join(dir, `${old}.json`))
  }
  return { savedAt: new Date(stamp).toISOString(), path: file }
}

export interface RecoverySnapshot {
  projectId: string
  projectName: string
  savedAt: string
  path: string
  clips: number
}

export async function listRecoveries(): Promise<RecoverySnapshot[]> {
  const base = path.join(getPaths().userData, 'recovery')
  const dirs = await readDir(base)
  const snapshots: RecoverySnapshot[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory) continue
    const files = (await readDir(path.join(base, dir.name))).filter((file) => !file.isDirectory && file.name.endsWith('.json'))
    for (const file of files) {
      const payload = await readJson<{ project?: Project; savedAt?: string }>(path.join(base, dir.name, file.name))
      if (!payload?.project) continue
      snapshots.push({
        projectId: payload.project.id,
        projectName: payload.project.name,
        savedAt: payload.savedAt ?? new Date(Number(file.name.replace('.json', ''))).toISOString(),
        path: path.join(base, dir.name, file.name),
        clips: payload.project.clips.length
      })
    }
  }
  snapshots.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
  return snapshots
}

export async function restoreRecovery(snapshotPath: string): Promise<Project | null> {
  const payload = await readJson<{ project?: Project }>(snapshotPath)
  if (!payload?.project) return null
  return saveProject(payload.project)
}

/** Build a fully editable project from a finished recording. */
export async function projectFromRecording(result: RecordingResult): Promise<Project> {
  const probe = await probeMedia(result.outputPath)
  const width = probe?.width || result.width
  const height = probe?.height || result.height
  const fps = probe?.fps ? Math.round(probe.fps) : result.fps
  const duration = probe?.duration || result.durationMs / 1000

  const project = createProject(
    path.basename(result.outputPath).replace(/\.[^.]+$/, ''),
    width,
    height,
    fps || 60
  )

  project.recording = {
    outputPath: result.outputPath,
    rawPath: result.rawPath,
    eventsPath: result.eventsPath,
    startedAt: result.startedAt,
    sourceWidth: result.request.sourceWidth,
    sourceHeight: result.request.sourceHeight,
    monitorBounds: result.request.monitorBounds,
    capturedBounds: result.request.sourceBounds
  }
  project.events = result.events ?? []
  project.cursor = result.request.effects

  const videoClip = defaultClip('video', 'track-video-1', {
    name: path.basename(result.outputPath),
    sourcePath: result.outputPath,
    start: 0,
    duration,
    inPoint: 0,
    hasAudio: probe?.hasAudio ?? true,
    sourceWidth: width,
    sourceHeight: height,
    sourceDuration: duration
  })
  project.clips = [videoClip]
  project.duration = projectDuration(project)
  logger.info('projects', 'project created from recording', { id: project.id, duration })
  return saveProject(project)
}

export async function duplicateProject(id: string): Promise<Project | null> {
  const project = await loadProject(id)
  if (!project) return null
  const copy: Project = {
    ...project,
    id: newId('proj'),
    name: `${project.name} copy`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  return saveProject(copy)
}

export async function projectFileSize(id: string): Promise<number> {
  const info = await stat(projectFile(id))
  return info?.size ?? 0
}

export function projectPath(id: string): string {
  return projectFile(id)
}
