import path from 'node:path'
import { clipboard, desktopCapturer, nativeImage } from 'electron'
import type { ScreenshotEntry, ScreenshotRequest, ScreenshotResult } from '@shared/types'
import { ensureDir, readDir, remove, stat, writeBinary } from './fsx'
import { getPaths } from './paths'
import { logger } from './logger'

function stamp(): string {
  const now = new Date()
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

export async function captureScreenshot(request: ScreenshotRequest): Promise<ScreenshotResult> {
  const width = Math.max(64, Math.round(request.sourceWidth))
  const height = Math.max(64, Math.round(request.sourceHeight))
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  const source = sources.find((entry) => entry.id === request.sourceId) ?? sources[0]
  if (!source) throw new Error('No capture source is available for a screenshot')
  const image = source.thumbnail
  if (image.isEmpty()) throw new Error('The capture source returned an empty frame')
  const size = image.getSize()
  const paths = getPaths()
  await ensureDir(paths.screenshots)
  const file = path.join(paths.screenshots, `Screenshot_${stamp()}.png`)
  await writeBinary(file, image.toPNG())
  logger.info('screenshots', 'screenshot captured', { file, size })
  return { path: file, width: size.width, height: size.height, dataUrl: image.toDataURL() }
}

export async function saveScreenshot(dataUrl: string, name?: string): Promise<string> {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('The annotated image is empty')
  const paths = getPaths()
  await ensureDir(paths.screenshots)
  const safe = (name || `Annotated_${stamp()}`).replace(/[^a-zA-Z0-9 _-]/g, '').trim()
  const file = path.join(paths.screenshots, `${safe || `Annotated_${stamp()}`}.png`)
  await writeBinary(file, image.toPNG())
  return file
}

export async function listScreenshots(): Promise<ScreenshotEntry[]> {
  const paths = getPaths()
  await ensureDir(paths.screenshots)
  const entries = await readDir(paths.screenshots)
  const results: ScreenshotEntry[] = []
  for (const entry of entries) {
    if (entry.isDirectory || !/\.(png|jpg|jpeg)$/i.test(entry.name)) continue
    const file = path.join(paths.screenshots, entry.name)
    const info = await stat(file)
    const image = nativeImage.createFromPath(file)
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize()
    results.push({
      path: file,
      name: entry.name,
      createdAt: new Date(info?.mtimeMs ?? Date.now()).toISOString(),
      width: size.width,
      height: size.height,
      sizeBytes: info?.size ?? entry.size
    })
  }
  results.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return results
}

export async function deleteScreenshot(file: string): Promise<void> {
  const paths = getPaths()
  if (!path.resolve(file).startsWith(path.resolve(paths.screenshots))) {
    throw new Error('Refusing to delete a file outside the screenshots folder')
  }
  await remove(file)
}

export function copyImage(dataUrl: string): void {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('Nothing to copy')
  clipboard.writeImage(image)
}
