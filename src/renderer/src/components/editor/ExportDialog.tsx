import { useEffect, useMemo, useState } from 'react'
import type { ExportJob, ExportSettings } from '@shared/types'
import { defaultExportSettings } from '@shared/defaults'
import { formatBytes, formatTimecode } from '@shared/time'
import { useStore } from '../../state/store'
import { Badge, Button, Field, Modal, NumberInput, Progress, Select, Spinner, Slider, Toggle } from '../../components/ui'
import { Icon } from '../../components/Icon'

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const project = useStore((state) => state.project)
  const appInfo = useStore((state) => state.appInfo)
  const pushToast = useStore((state) => state.pushToast)
  const save = useStore((state) => state.save)
  const setView = useStore((state) => state.setView)

  const [settings, setSettings] = useState<ExportSettings>({ format: 'mp4', width: 1920, height: 1080, fps: 60, bitrateMbps: 16, audioBitrateKbps: 192, encoder: 'auto', denoise: false, includeEffects: true })
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [live, setLive] = useState<Record<string, { progress: number; stage: string; fps: number; speed: number }>>({})
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!project || !open) return
    setSettings((current) => ({ ...defaultExportSettings(project), encoder: current.encoder, denoise: current.denoise, includeEffects: current.includeEffects }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, open])

  useEffect(() => {
    if (!open) return
    void window.api.exports.list().then(setJobs)
    const unsubUpdate = window.api.exports.onUpdate((job) => {
      setJobs((current) => {
        const index = current.findIndex((entry) => entry.id === job.id)
        if (index === -1) return [job, ...current]
        const next = [...current]
        next[index] = job
        return next
      })
      if (job.status === 'completed') pushToast('success', 'Export finished', job.outputPath)
      if (job.status === 'failed') pushToast('error', 'Export failed', job.message ?? undefined)
    })
    const unsubProgress = window.api.exports.onProgress((progress) => {
      setLive((current) => ({ ...current, [progress.jobId]: { progress: progress.progress, stage: progress.stage, fps: progress.fps, speed: progress.speed } }))
    })
    return () => {
      unsubUpdate()
      unsubProgress()
    }
  }, [open, pushToast])

  const encoders = useMemo(() => appInfo?.encoders.filter((encoder) => encoder.available) ?? [], [appInfo])

  if (!project) return null

  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      await save(true)
      const outputPath = outputDir ? `${outputDir.replace(/[\\/]$/, '')}/${safeName(project.name)}.${settings.format}` : null
      const job = await window.api.exports.enqueue(project.id, settings, outputPath)
      setJobs((current) => [job, ...current.filter((entry) => entry.id !== job.id)])
      pushToast('info', 'Export queued', 'Rendering overlays and encoding with FFmpeg')
    } catch (error) {
      pushToast('error', 'Could not start the export', (error as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const active = jobs.filter((job) => ['queued', 'preparing', 'rendering'].includes(job.status))
  const finished = jobs.filter((job) => !['queued', 'preparing', 'rendering'].includes(job.status))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export video"
      subtitle={`${project.width}×${project.height} · ${project.fps} fps · ${formatTimecode(project.duration)}`}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={() => setView('exports')} icon="export">
            Open queue
          </Button>
          <Button variant="primary" icon="download" onClick={() => void start()} disabled={starting || !project.clips.length}>
            {starting ? 'Starting…' : `Export ${settings.format.toUpperCase()}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label="Format">
            <Select
              value={settings.format}
              onChange={(format) => setSettings((current) => ({ ...current, format, encoder: format === 'webm' ? 'cpu' : current.encoder }))}
              options={[
                { value: 'mp4', label: 'MP4 · H.264 + AAC (recommended)' },
                { value: 'mkv', label: 'MKV · H.264 + AAC' },
                { value: 'webm', label: 'WebM · VP9 + Opus' }
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Width">
              <NumberInput value={settings.width} min={320} max={7680} step={2} onChange={(width) => setSettings((current) => ({ ...current, width }))} />
            </Field>
            <Field label="Height">
              <NumberInput value={settings.height} min={240} max={4320} step={2} onChange={(height) => setSettings((current) => ({ ...current, height }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Frame rate">
              <Select
                value={String(settings.fps)}
                onChange={(value) => setSettings((current) => ({ ...current, fps: Number(value) }))}
                options={[24, 25, 30, 50, 60, 120].map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
              />
            </Field>
            <Field label="Video bitrate">
              <NumberInput value={settings.bitrateMbps} min={1} max={120} step={1} suffix="Mb/s" onChange={(bitrateMbps) => setSettings((current) => ({ ...current, bitrateMbps }))} />
            </Field>
          </div>
          <Field label="Hardware encoder">
            <Select
              value={settings.encoder}
              onChange={(encoder) => setSettings((current) => ({ ...current, encoder }))}
              options={[
                { value: 'auto', label: 'Automatic (best available)' },
                ...encoders.map((encoder) => ({ value: encoder.kind as ExportSettings['encoder'], label: encoder.label })),
                { value: 'cpu', label: 'CPU (x264)' }
              ]}
            />
          </Field>
          <Slider
            label="Audio bitrate"
            min={96}
            max={320}
            step={32}
            value={settings.audioBitrateKbps}
            onChange={(audioBitrateKbps) => setSettings((current) => ({ ...current, audioBitrateKbps }))}
            format={(value) => `${Math.round(value)} kb/s`}
          />
          <Toggle label="Include cursor & click effects" checked={settings.includeEffects} onChange={(includeEffects) => setSettings((current) => ({ ...current, includeEffects }))} />
          <Toggle label="Audio noise reduction" hint="FFT denoiser applied to the recording audio" checked={settings.denoise} onChange={(denoise) => setSettings((current) => ({ ...current, denoise }))} />
          <div className="flex items-center gap-2">
            <Button size="sm" icon="folder" onClick={() => void window.api.app.pickDirectory().then(setOutputDir)}>
              {outputDir ? 'Change folder' : 'Choose folder'}
            </Button>
            <span className="truncate text-[0.68rem] text-[var(--text-2)]">{outputDir ?? 'Default: Videos/SkyRec/Exports'}</span>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2 text-[0.68rem] leading-relaxed text-[var(--text-2)]">
            Export renders the text/cursor overlay frames, synthesises the click audio, then encodes the whole timeline with FFmpeg. A ~1 minute 1080p60
            project takes roughly 30–90 seconds with a hardware encoder.
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-2)]">Queue</div>
          {!jobs.length ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center">
              <Icon name="export" size={22} className="text-[var(--text-2)]" />
              <div className="mt-2 text-[0.74rem] text-[var(--text-1)]">No exports yet</div>
              <div className="mt-1 text-[0.68rem] text-[var(--text-2)]">Start one to see real encoder progress here.</div>
            </div>
          ) : (
            <div className="scroll-area flex max-h-[420px] flex-col gap-2">
              {[...active, ...finished].map((job) => {
                const progress = live[job.id]
                const running = job.status === 'queued' || job.status === 'preparing' || job.status === 'rendering'
                return (
                  <div key={job.id} className="rounded-xl border border-[var(--line)] bg-black/25 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[0.74rem] font-medium text-[var(--text-0)]">{job.outputPath.split(/[\\/]/).pop()}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[0.64rem] text-[var(--text-2)]">
                          <Badge
                            tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : job.status === 'canceled' ? 'warning' : 'accent'}
                          >
                            {job.status}
                          </Badge>
                          <span>{progress?.stage ?? job.stage}</span>
                          {progress?.speed ? <span>· {progress.speed.toFixed(1)}×</span> : null}
                        </div>
                      </div>
                      {running ? (
                        <Button size="sm" onClick={() => void window.api.exports.cancel(job.id)}>
                          Cancel
                        </Button>
                      ) : (
                        <Button size="sm" icon="folder" onClick={() => void window.api.exports.reveal(job.outputPath)}>
                          Show
                        </Button>
                      )}
                    </div>
                    <div className="mt-2">
                      <Progress value={job.status === 'completed' ? 1 : (progress?.progress ?? job.progress)} />
                      <div className="mt-1 flex items-center justify-between text-[0.62rem] text-[var(--text-2)]">
                        <span className="flex items-center gap-1">
                          {running ? <Spinner size={9} /> : null}
                          {Math.round((progress?.progress ?? job.progress) * 100)}%
                        </span>
                        <span>
                          {job.sizeBytes ? formatBytes(job.sizeBytes) : ''}
                          {job.durationMs ? ` · ${formatTimecode(job.durationMs / 1000)}` : ''}
                        </span>
                      </div>
                    </div>
                    {job.message ? <div className="mt-1 text-[0.64rem] text-red-300">{job.message}</div> : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'export'
}
