import path from 'node:path'
import type { LibraryRecording, ProjectSummary } from '@shared/types'
import { ensureDir, readDir, remove, stat } from './fsx'
import { getPaths } from './paths'
import { logger } from './logger'
import { probeMedia, thumbnail } from './ffmpeg'
import { listProjects } from './projects'

const MEDIA_EXTENSIONS = /\.(mp4|mkv|webm|mov)$/i

export async function listRecordingLibrary(): Promise<LibraryRecording[]> {
  const paths = getPaths()
  await ensureDir(paths.recordings)
  const entries = await readDir(paths.recordings)
  const projects: ProjectSummary[] = await listProjects()
  const results: LibraryRecording[] = []
  for (const entry of entries) {
    if (entry.isDirectory || !MEDIA_EXTENSIONS.test(entry.name)) continue
    const file = path.join(paths.recordings, entry.name)
    const info = await stat(file)
    const probe = await probeMedia(file)
    const project = projects.find((candidate) => candidate.sourcePath === file) ?? null
    results.push({
      path: file,
      name: entry.name,
      sizeBytes: info?.size ?? entry.size,
      createdAt: new Date(info?.mtimeMs ?? Date.now()).toISOString(),
      durationMs: Math.round((probe?.duration ?? 0) * 1000),
      width: probe?.width ?? 0,
      height: probe?.height ?? 0,
      fps: probe?.fps ?? 0,
      thumbnail: await thumbnail(file, 1, 400),
      projectId: project?.id ?? null
    })
  }
  results.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return results
}

export async function deleteRecording(file: string): Promise<void> {
  const paths = getPaths()
  const resolved = path.resolve(file)
  if (!resolved.startsWith(path.resolve(paths.recordings))) {
    throw new Error('Refusing to delete a file outside the recordings folder')
  }
  await remove(resolved)
  logger.info('library', 'recording deleted', { file })
}
