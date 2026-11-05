import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { PreviewEngine } from '../engine/preview'
import { Icon } from '../components/Icon'
import { Badge, Button, EmptyState, IconButton, Slider } from '../components/ui'
import { Timeline } from '../components/editor/Timeline'
import { Inspector } from '../components/editor/Inspector'
import { ExportDialog } from '../components/editor/ExportDialog'
import { clamp, formatTimecode } from '@shared/time'
import { totalDuration } from '@shared/timeline-ops'

export function EditorPage(): JSX.Element {
  const project = useStore((state) => state.project)
  const playhead = useStore((state) => state.playhead)
  const playing = useStore((state) => state.playing)
  const saveState = useStore((state) => state.saveState)
  const save = useStore((state) => state.save)
  const undo = useStore((state) => state.undo)
  const redo = useStore((state) => state.redo)
  const canUndo = useStore((state) => state.past.length > 0)
  const canRedo = useStore((state) => state.future.length > 0)
  const renameProject = useStore((state) => state.renameProject)
  const selectedClipId = useStore((state) => state.selectedClipId)
  const selectClip = useStore((state) => state.selectClip)
  const mutate = useStore((state) => state.mutate)
  const setView = useStore((state) => state.setView)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<PreviewEngine | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [masterVolume, setMasterVolume] = useState(1)
  const [nameDraft, setNameDraft] = useState(project?.name ?? '')

  useEffect(() => {
    setNameDraft(project?.name ?? '')
  }, [project?.id, project?.name])

  useEffect(() => {
    if (!canvasRef.current) return
    const engine = new PreviewEngine(canvasRef.current, {
      onTime: (time) => useStore.getState().setPlayhead(time),
      onPlayingChange: (value) => useStore.getState().setPlaying(value)
    })
    engineRef.current = engine
    if (useStore.getState().project) engine.setProject(useStore.getState().project as NonNullable<typeof project>)
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    if (project && engineRef.current) {
      engineRef.current.setProject(project)
      if (!playing) engineRef.current.seek(useStore.getState().playhead)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || playing) return
    if (Math.abs(engine.getPosition() - playhead) > 0.001) engine.seek(playhead)
  }, [playhead, playing])

  useEffect(() => {
    engineRef.current?.setVolume(masterVolume)
  }, [masterVolume])

  const duration = useMemo(() => (project ? Math.max(totalDuration(project.clips), 0.5) : 0), [project])

  const seekTo = useCallback(
    (time: number) => {
      if (!project) return
      engineRef.current?.seek(clamp(time, 0, Math.max(project.duration, 0.05)))
    },
    [project]
  )

  const deleteSelected = useCallback(() => {
    if (!selectedClipId) return
    mutate((draft) => {
      draft.clips = draft.clips.filter((clip) => clip.id !== selectedClipId)
    })
    selectClip(null)
  }, [mutate, selectClip, selectedClipId])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (!project) return
      if (event.code === 'Space') {
        event.preventDefault()
        engineRef.current?.toggle()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        seekTo((engineRef.current?.getPosition() ?? 0) + 1 / project.fps)
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seekTo((engineRef.current?.getPosition() ?? 0) - 1 / project.fps)
      }
      if (event.key === 'Home') seekTo(0)
      if (event.key === 'End') seekTo(duration)
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
      }
      const shortcut = (action: string): void => {
        window.dispatchEvent(new CustomEvent('skyrec:shortcut', { detail: action }))
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        shortcut('exportVideo')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [deleteSelected, duration, project, redo, save, seekTo, undo])

  useEffect(() => {
    const handler = (event: Event): void => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'exportVideo') setExportOpen(true)
    }
    window.addEventListener('skyrec:shortcut', handler)
    return () => window.removeEventListener('skyrec:shortcut', handler)
  }, [])

  if (!project) {
    return (
      <EmptyState
        icon="film"
        title="No project open"
        description="Record something or pick a project from the library to start editing."
        action={
          <Button variant="primary" icon="record" onClick={() => setView('record')}>
            Go to recorder
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <Button size="sm" icon="chevron-right" className="!rotate-180" onClick={() => setView('library')} title="Back to library">
          Library
        </Button>
        <input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => renameProject(nameDraft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
          className="min-w-0 max-w-[280px] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[0.86rem] font-medium text-[var(--text-0)] outline-none transition hover:border-[var(--line)] focus:border-sky-400/50 focus:bg-black/20"
        />
        <Badge tone="neutral">
          {project.width}×{project.height} · {project.fps} fps
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <IconButton icon="undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <IconButton icon="redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
          <div className="mx-1 h-5 w-px bg-[var(--line)]" />
          <Button size="sm" icon="save" onClick={() => void save()} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" icon="export" variant="primary" onClick={() => setExportOpen(true)}>
            Export
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#03050a] p-4">
            <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" />
            <canvas
              ref={canvasRef}
              width={project.width}
              height={project.height}
              className="relative max-h-full max-w-full rounded-lg border border-[var(--line)] object-contain shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]"
              style={{ aspectRatio: `${project.width} / ${project.height}` }}
            />
            {!project.clips.length ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                <div className="text-[0.86rem] font-medium text-[var(--text-0)]">Timeline is empty</div>
                <div className="text-[0.74rem] text-[var(--text-2)]">Drop a video, add a text card or pull in music below.</div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-2">
            <div className="flex items-center gap-1">
              <IconButton icon="skip-start" title="Jump to start (Home)" onClick={() => seekTo(0)} />
              <IconButton icon="chevron-right" title="Previous frame" className="rotate-180" onClick={() => seekTo((engineRef.current?.getPosition() ?? 0) - 1 / project.fps)} />
              <button
                type="button"
                onClick={() => engineRef.current?.toggle()}
                className="mx-1 flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-[#04131c] shadow-[0_10px_24px_-10px_rgba(34,188,255,0.9)] transition hover:bg-sky-400"
                title="Play / pause (Space)"
              >
                <Icon name={playing ? 'pause' : 'play'} size={16} />
              </button>
              <IconButton icon="chevron-right" title="Next frame" onClick={() => seekTo((engineRef.current?.getPosition() ?? 0) + 1 / project.fps)} />
              <IconButton icon="skip-end" title="Jump to end (End)" onClick={() => seekTo(duration)} />
            </div>
            <div className="flex items-baseline gap-1.5 rounded-lg border border-[var(--line)] bg-black/25 px-2.5 py-1">
              <span className="font-mono text-[0.8rem] tabular-nums text-[var(--text-0)]">{formatTimecode(playhead, true, project.fps)}</span>
              <span className="text-[0.68rem] text-[var(--text-2)]">/ {formatTimecode(duration, false)}</span>
            </div>
            <div className="ml-auto flex w-[150px] items-center gap-2">
              <Icon name="volume" size={14} className="shrink-0 text-[var(--text-2)]" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={masterVolume}
                onChange={(event) => setMasterVolume(Number(event.target.value))}
                className="range w-full"
                title="Preview volume"
              />
            </div>
          </div>
        </div>

        <Inspector />
      </div>

      <Timeline />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  )
}

export function SliderRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }): JSX.Element {
  return <Slider label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
}
