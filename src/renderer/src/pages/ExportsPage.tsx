import { useEffect, useState } from 'react'
import type { ExportJob } from '@shared/types'
import { formatBytes, formatTimecode } from '@shared/time'
import { useStore } from '../state/store'
import { Badge, Button, EmptyState, Progress, Spinner } from '../components/ui'
import { Icon } from '../components/Icon'

export function ExportsPage(): JSX.Element {
  const pushToast = useStore((state) => state.pushToast)
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [live, setLive] = useState<Record<string, { progress: number; stage: string; speed: number; fps: number }>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void window.api.exports.list().then((list) => {
      setJobs(list)
      setLoading(false)
    })
    const unsubUpdate = window.api.exports.onUpdate((job) => {
      setJobs((current) => {
        const index = current.findIndex((entry) => entry.id === job.id)
        if (index === -1) return [job, ...current]
        const next = [...current]
        next[index] = job
        return next
      })
    })
    const unsubProgress = window.api.exports.onProgress((progress) => {
      setLive((current) => ({ ...current, [progress.jobId]: { progress: progress.progress, stage: progress.stage, speed: progress.speed, fps: progress.fps } }))
    })
    return () => {
      unsubUpdate()
      unsubProgress()
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <div>
          <h1 className="text-[1.02rem] font-semibold tracking-tight">Export queue</h1>
          <p className="mt-0.5 text-[0.74rem] text-[var(--text-2)]">Real encoder progress straight from FFmpeg</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            icon="trash"
            onClick={() => {
              void window.api.exports.clear().then((next) => {
                setJobs(next)
                pushToast('info', 'Finished jobs cleared')
              })
            }}
          >
            Clear finished
          </Button>
          <Button size="sm" icon="refresh" onClick={() => void window.api.exports.list().then(setJobs)}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="scroll-area min-h-0 flex-1 px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-[0.78rem] text-[var(--text-2)]">
            <Spinner size={13} /> Loading queue…
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="export"
            title="Nothing exported yet"
            description="Export a project from the editor and its live progress, encoder speed and final file size will appear here."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {jobs.map((job) => {
              const progress = live[job.id]
              const running = ['queued', 'preparing', 'rendering'].includes(job.status)
              const percent = job.status === 'completed' ? 1 : (progress?.progress ?? job.progress)
              return (
                <div key={job.id} className="rounded-xl border border-[var(--line)] bg-[rgba(10,15,22,0.7)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                          job.status === 'completed'
                            ? 'bg-emerald-400/10 text-emerald-300'
                            : job.status === 'failed'
                              ? 'bg-red-400/10 text-red-300'
                              : 'bg-sky-400/10 text-sky-300'
                        }`}
                      >
                        <Icon name={job.status === 'completed' ? 'check' : job.status === 'failed' ? 'alert' : 'export'} size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[0.8rem] font-medium text-[var(--text-0)]">{job.outputPath.split(/[\\/]/).pop()}</div>
                        <div className="text-[0.66rem] text-[var(--text-2)]">
                          {job.projectName} · {job.settings.width}×{job.settings.height} · {job.settings.fps} fps · {job.settings.format.toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : job.status === 'canceled' ? 'warning' : 'accent'}>
                        {job.status}
                      </Badge>
                      {running ? (
                        <Button size="sm" onClick={() => void window.api.exports.cancel(job.id)}>
                          Cancel
                        </Button>
                      ) : (
                        <Button size="sm" icon="folder" onClick={() => void window.api.exports.reveal(job.outputPath)}>
                          Show in folder
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <Progress value={percent} />
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[0.64rem] text-[var(--text-2)]">
                      <span className="flex items-center gap-1.5">
                        {running ? <Spinner size={9} /> : null}
                        {progress?.stage ?? job.stage} · {Math.round(percent * 100)}%
                        {progress?.speed ? ` · ${progress.speed.toFixed(1)}×` : ''}
                      </span>
                      <span>
                        {job.sizeBytes ? formatBytes(job.sizeBytes) : ''}
                        {job.durationMs ? ` · ${formatTimecode(job.durationMs / 1000)}` : ''}
                        {job.finishedAt ? ` · finished ${new Date(job.finishedAt).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                    {job.message ? <div className="mt-1 text-[0.66rem] text-red-300">{job.message}</div> : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
