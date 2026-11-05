import os from 'node:os'
import { app, desktopCapturer, screen } from 'electron'
import type { CaptureSource, MonitorInfo, SystemStats } from '@shared/types'
import { getPaths } from './paths'
import { statfs } from './fsx'
import { detectEncoders } from './ffmpeg'

export function listMonitors(): MonitorInfo[] {
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id
  return displays.map((display, index) => ({
    id: String(display.id),
    label: display.label || `Display ${index + 1}`,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    workArea: {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height
    },
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId
  }))
}

export async function listCaptureSources(kinds: ('screen' | 'window')[] = ['screen', 'window']): Promise<CaptureSource[]> {
  const displays = listMonitors()
  const sources = await desktopCapturer.getSources({
    types: kinds,
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true
  })
  return sources.map((source) => {
    const displayId = source.display_id || null
    const display = displays.find((entry) => entry.id === displayId) ?? displays.find((entry) => entry.primary) ?? displays[0]
    return {
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen') ? 'screen' : 'window',
      displayId,
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : null,
      width: display?.bounds.width ?? 1920,
      height: display?.bounds.height ?? 1080,
      bounds: source.id.startsWith('screen') && display ? display.bounds : { x: 0, y: 0, width: display?.bounds.width ?? 1920, height: display?.bounds.height ?? 1080 }
    }
  })
}

export async function systemStats(): Promise<SystemStats> {
  const metrics = app.getAppMetrics()
  const cpuPercent = metrics.reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0)
  const memoryMB = Math.round(metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024)
  const rendererCpuPercent = metrics
    .filter((metric) => metric.type === 'Tab')
    .reduce((sum, metric) => sum + metric.cpu.percentCPUUsage, 0)
  const disk = await statfs(getPaths().recordings)
  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryMB,
    memoryTotalMB: Math.round(os.totalmem() / (1024 * 1024)),
    uptimeSeconds: Math.round(process.uptime()),
    rendererCpuPercent: Math.round(rendererCpuPercent * 10) / 10,
    diskFreeMB: disk ? Math.round(disk.free / (1024 * 1024)) : null
  }
}

export async function encoderStatus(): Promise<Awaited<ReturnType<typeof detectEncoders>>> {
  return detectEncoders()
}
