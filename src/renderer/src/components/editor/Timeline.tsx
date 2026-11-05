import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Clip, Track } from '@shared/types'
import { defaultClip, newId } from '@shared/defaults'
import { snapToFrame } from '@shared/time'
import { rippleDelete, splitClipAt, totalDuration, trimClipEnd, trimClipStart } from '@shared/timeline-ops'
import { useStore } from '../../state/store'
import { Icon } from '../../components/Icon'
import { Button, IconButton, Spinner } from '../../components/ui'

const TRACK_HEIGHT: Record<Track['kind'], number> = { video: 56, audio: 44, text: 40 }

function clipColor(clip: Clip, track: Track | undefined): { background: string; border: string; text: string } {
  if (clip.kind === 'text') return { background: 'linear-gradient(180deg,#f7c948,#d9a212)', border: 'rgba(247,201,72,0.55)', text: '#2a1d02' }
  if (clip.kind === 'audio') return { background: 'linear-gradient(180deg,#34d399,#0f9e73)', border: 'rgba(52,211,153,0.5)', text: '#04241b' }
  if (track?.name.toLowerCase().includes('music')) return { background: 'linear-gradient(180deg,#2dd4bf,#0d9488)', border: 'rgba(45,212,191,0.5)', text: '#032623' }
  if (clip.kind === 'image') return { background: 'linear-gradient(180deg,#a78bfa,#7c5cf5)', border: 'rgba(167,139,250,0.5)', text: '#14092e' }
  if (track?.id === 'track-overlay') return { background: 'linear-gradient(180deg,#818cf8,#4f46e5)', border: 'rgba(129,140,248,0.5)', text: '#080b2b' }
  return { background: 'linear-gradient(180deg,#38bdf8,#0284c7)', border: 'rgba(56,189,248,0.55)', text: '#021521' }
}

function Waveform({ path, height }: { path: string; height: number }): JSX.Element | null {
  const [peaks, setPeaks] = useState<number[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.media
      .waveform(path)
      .then((values) => {
        if (!cancelled) setPeaks(values)
      })
      .catch(() => setPeaks([]))
    return () => {
      cancelled = true
    }
  }, [path])

  if (!peaks || peaks.length === 0) return null
  const step = Math.max(1, Math.ceil(peaks.length / 160))
  const points: string[] = []
  for (let index = 0; index < peaks.length; index += step) {
    const x = (index / (peaks.length - 1)) * 100
    const amplitude = Math.max(0.04, peaks[index]) * (height / 2 - 2)
    points.push(`${x.toFixed(2)},${(height / 2 - amplitude).toFixed(2)}`)
    points.push(`${x.toFixed(2)},${(height / 2 + amplitude).toFixed(2)}`)
  }
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full opacity-45">
      <polyline points={points.join(' ')} fill="none" stroke="rgba(2,30,24,0.85)" strokeWidth={0.8} />
    </svg>
  )
}

export function Timeline(): JSX.Element {
  const project = useStore((state) => state.project)
  const playhead = useStore((state) => state.playhead)
  const pixelsPerSecond = useStore((state) => state.pixelsPerSecond)
  const setPixelsPerSecond = useStore((state) => state.setPixelsPerSecond)
  const selectedClipId = useStore((state) => state.selectedClipId)
  const selectClip = useStore((state) => state.selectClip)
  const setPlayhead = useStore((state) => state.setPlayhead)
  const mutate = useStore((state) => state.mutate)
  const beginHistory = useStore((state) => state.beginHistory)
  const pushToast = useStore((state) => state.pushToast)
  const appInfo = useStore((state) => state.appInfo)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lanesRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ mode: 'move' | 'left' | 'right'; clipId: string; startX: number; original: Clip; pps: number } | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const tracks = project?.tracks ?? []
  const clips = project?.clips ?? []
  const duration = Math.max(totalDuration(clips), 8)
  const innerWidth = Math.max(600, duration * pixelsPerSecond + 240)

  const snapCandidates = useMemo(() => {
    const values = [0, playhead]
    for (const clip of clips) {
      values.push(clip.start, clip.start + clip.duration)
    }
    return values
  }, [clips, playhead])

  const snap = useCallback(
    (time: number): number => {
      const threshold = snapEnabled ? 8 / pixelsPerSecond : 0
      let best = time
      let bestDistance = threshold
      for (const candidate of snapCandidates) {
        const distance = Math.abs(candidate - time)
        if (distance < bestDistance) {
          best = candidate
          bestDistance = distance
        }
      }
      return Math.max(0, snapToFrame(best, project?.fps ?? 30))
    },
    [pixelsPerSecond, project?.fps, snapEnabled, snapCandidates]
  )

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const rect = lanesRef.current?.getBoundingClientRect()
      if (!rect) return
      const time = Math.max(0, (clientX - rect.left) / pixelsPerSecond)
      setPlayhead(Math.min(time, duration))
    },
    [duration, pixelsPerSecond, setPlayhead]
  )

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const delta = (event.clientX - drag.startX) / drag.pps
      const state = useStore.getState()
      state.mutate(
        (draft) => {
          const clip = draft.clips.find((entry) => entry.id === drag.clipId)
          if (!clip) return
          if (drag.mode === 'move') {
            const nextStart = snap(Math.max(0, drag.original.start + delta))
            clip.start = nextStart
          } else if (drag.mode === 'left') {
            Object.assign(clip, trimClipStart(drag.original, drag.original.start + delta))
          } else {
            Object.assign(clip, trimClipEnd(drag.original, drag.original.start + drag.original.duration + delta))
          }
        },
        { history: false }
      )
    }
    const up = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [snap])

  const beginDrag = (event: React.PointerEvent, clip: Clip, mode: 'move' | 'left' | 'right'): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const track = project?.tracks.find((entry) => entry.id === clip.trackId)
    if (track?.locked) {
      pushToast('info', 'Track is locked', 'Unlock the track to edit its clips.')
      return
    }
    selectClip(clip.id)
    beginHistory()
    dragRef.current = { mode, clipId: clip.id, startX: event.clientX, original: structuredClone(clip), pps: pixelsPerSecond }
  }

  if (!project) return <div />

  const addMediaPaths = async (paths: string[], atTime?: number): Promise<void> => {
    if (!paths.length) return
    setBusy('Importing…')
    try {
      const added: Clip[] = []
      let cursor = atTime ?? playhead
      for (const path of paths) {
        const probe = await window.api.media.probe(path)
        const isImage = /\.(png|jpe?g|webp|gif)$/i.test(path)
        const isAudio = !isImage && !probe?.hasVideo
        if (!probe && !isImage) {
          pushToast('error', 'Unsupported file', path)
          continue
        }
        const kind: Clip['kind'] = isImage ? 'image' : isAudio ? 'audio' : 'video'
        const track = isImage
          ? project.tracks.find((entry) => entry.id === 'track-overlay')
          : isAudio
            ? project.tracks.find((entry) => entry.id === 'track-music')
            : project.tracks.find((entry) => entry.id === 'track-video-1')
        const targetTrack = track ?? project.tracks.find((entry) => (kind === 'audio' ? entry.kind === 'audio' : entry.kind === 'video'))
        if (!targetTrack) continue
        const trackEnd = project.clips.filter((clip) => clip.trackId === targetTrack.id).reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0)
        const start = Math.max(cursor, atTime !== undefined ? atTime : trackEnd)
        const duration = isImage ? 5 : Math.max(0.2, probe?.duration ?? 5)
        added.push(
          defaultClip(kind, targetTrack.id, {
            name: path.split(/[\\/]/).pop() ?? 'Media',
            sourcePath: path,
            start,
            duration,
            inPoint: 0,
            sourceDuration: isImage ? null : duration,
            sourceWidth: probe?.width ?? null,
            sourceHeight: probe?.height ?? null,
            hasAudio: Boolean(probe?.hasAudio)
          })
        )
        cursor = start + duration
      }
      if (!added.length) return
      mutate((draft) => {
        draft.clips = [...draft.clips, ...added]
      })
      pushToast('success', 'Added to timeline', `${added.length} clip${added.length > 1 ? 's' : ''}`)
    } catch (error) {
      pushToast('error', 'Import failed', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const importMedia = async (): Promise<void> => {
    const files = await window.api.media.importFiles()
    await addMediaPaths(files.map((file) => file.path))
  }

  const addText = (): void => {
    const track = project.tracks.find((entry) => entry.kind === 'text')
    if (!track) return
    const clip = defaultClip('text', track.id, {
      name: 'Text card',
      start: playhead,
      duration: 4,
      hasAudio: false,
      text: {
        content: 'Your text here',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        fontSize: Math.round(project.height * 0.062),
        color: '#ffffff',
        background: 'rgba(6,12,20,0.62)',
        padding: Math.round(project.height * 0.02),
        align: 'center',
        bold: true,
        italic: false,
        shadow: true
      },
      transform: { x: 0, y: 0.34, scale: 1, rotation: 0, opacity: 1 }
    })
    mutate((draft) => {
      draft.clips.push(clip)
    })
    selectClip(clip.id)
  }

  const splitSelected = (): void => {
    const clip = project.clips.find((entry) => entry.id === selectedClipId)
    if (!clip) {
      pushToast('info', 'Select a clip to split at the playhead')
      return
    }
    const pieces = splitClipAt(clip, playhead)
    if (pieces.length === 1) {
      pushToast('info', 'Move the playhead inside the clip to split it')
      return
    }
    mutate((draft) => {
      draft.clips = draft.clips.flatMap((entry) => (entry.id === clip.id ? pieces : [entry]))
    })
  }

  const deleteSelected = (): void => {
    if (!selectedClipId) return
    mutate((draft) => {
      draft.clips = draft.clips.filter((entry) => entry.id !== selectedClipId)
    })
    selectClip(null)
  }

  const removeSilence = async (): Promise<void> => {
    const source = project.recording?.outputPath
    if (!source) {
      pushToast('info', 'No recording in this project', 'Silence removal works on clips recorded with SkyRec.')
      return
    }
    setBusy('Analysing silence…')
    try {
      const ranges = await window.api.media.detectSilence(source, -35, 0.5)
      if (!ranges.length) {
        pushToast('info', 'No silence detected', 'The audio track has no quiet stretches longer than half a second.')
        return
      }
      const sourceClip = project.clips.find((clip) => clip.sourcePath === source)
      const offset = sourceClip ? sourceClip.start - sourceClip.inPoint / (sourceClip.speed || 1) : 0
      const speed = sourceClip?.speed ?? 1
      const timelineRanges = ranges.map((range) => ({ start: offset + range.start / speed, end: offset + range.end / speed }))
      const before = totalDuration(project.clips)
      mutate((draft) => {
        draft.clips = rippleDelete(draft.clips, timelineRanges)
      })
      const after = totalDuration(useStore.getState().project?.clips ?? [])
      pushToast('success', 'Silence removed', `${ranges.length} gaps tightened · ${before.toFixed(1)}s → ${after.toFixed(1)}s`)
    } catch (error) {
      pushToast('error', 'Silence analysis failed', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const toggleTrack = (trackId: string, key: 'muted' | 'hidden' | 'locked'): void => {
    mutate((draft) => {
      const track = draft.tracks.find((entry) => entry.id === trackId)
      if (track) track[key] = !track[key]
    })
  }

  const tickStep = pixelsPerSecond >= 150 ? 1 : pixelsPerSecond >= 80 ? 2 : 5
  const ticks: number[] = []
  for (let second = 0; second <= duration + 2; second += tickStep) ticks.push(second)

  return (
    <section className="flex shrink-0 flex-col border-t border-[var(--line)] bg-[rgba(6,10,16,0.72)]" style={{ height: 322 }}>
      <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-3 py-1.5">
        <Button size="sm" icon="plus" onClick={() => void importMedia()} disabled={Boolean(busy)}>
          Media
        </Button>
        <Button size="sm" icon="text" onClick={addText}>
          Text
        </Button>
        <Button size="sm" icon="scissors" onClick={splitSelected}>
          Split
        </Button>
        <IconButton icon="trash" title="Delete selected clip" onClick={deleteSelected} disabled={!selectedClipId} />
        <div className="mx-1 h-5 w-px bg-[var(--line)]" />
        <Button size="sm" icon="wand" onClick={() => void removeSilence()} disabled={Boolean(busy)}>
          Remove silence
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {busy ? (
            <div className="flex items-center gap-1.5 text-[0.68rem] text-[var(--text-2)]">
              <Spinner size={12} /> {busy}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setSnapEnabled((value) => !value)}
            className={`chip !py-1 ${snapEnabled ? '!bg-sky-400/15 !text-sky-200 !border-sky-400/35' : ''}`}
            title="Snap clips to edges and the playhead"
          >
            <Icon name="move" size={11} /> Snap
          </button>
          <div className="flex items-center gap-1.5">
            <Icon name="zoom-out" size={13} className="text-[var(--text-2)]" />
            <input
              type="range"
              min={18}
              max={420}
              step={1}
              value={pixelsPerSecond}
              onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
              className="range w-[92px]"
              title="Timeline zoom"
            />
            <Icon name="zoom-in" size={13} className="text-[var(--text-2)]" />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[128px] shrink-0 border-r border-[var(--line)] bg-[rgba(4,7,11,0.5)]">
          <div className="h-7 border-b border-[var(--line)] px-2.5 text-[0.6rem] uppercase tracking-[0.1em] leading-7 text-[var(--text-2)]">
            Tracks
          </div>
          {tracks.map((track) => (
            <div
              key={track.id}
              className="flex items-center gap-1 border-b border-[var(--line)] px-2"
              style={{ height: TRACK_HEIGHT[track.kind] }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.68rem] font-medium text-[var(--text-1)]">{track.name}</div>
                <div className="text-[0.56rem] uppercase tracking-wider text-[var(--text-2)]">{track.kind}</div>
              </div>
              <div className="flex items-center gap-0.5">
                {track.kind === 'audio' ? (
                  <button type="button" title={track.muted ? 'Unmute track' : 'Mute track'} onClick={() => toggleTrack(track.id, 'muted')} className={`icon-btn !h-6 !w-6 ${track.muted ? 'text-red-300' : ''}`}>
                    <Icon name="volume" size={12} />
                  </button>
                ) : (
                  <button type="button" title={track.hidden ? 'Show track' : 'Hide track'} onClick={() => toggleTrack(track.id, 'hidden')} className={`icon-btn !h-6 !w-6 ${track.hidden ? 'text-amber-300' : ''}`}>
                    <Icon name="eye" size={12} />
                  </button>
                )}
                <button type="button" title={track.locked ? 'Unlock track' : 'Lock track'} onClick={() => toggleTrack(track.id, 'locked')} className={`icon-btn !h-6 !w-6 ${track.locked ? 'text-sky-300' : ''}`}>
                  <Icon name="lock" size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div
          ref={scrollRef}
          className={`relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden ${dragOver ? 'bg-sky-400/[0.05]' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragOver(false)
            const files = Array.from(event.dataTransfer.files ?? [])
            const paths = files.map((file) => window.api.app.pathForFile(file)).filter(Boolean)
            void addMediaPaths(paths)
          }}
        >
          <div style={{ width: innerWidth }} className="relative">
            <div
              className="relative h-7 cursor-ew-resize border-b border-[var(--line)] bg-[rgba(4,7,11,0.4)]"
              onPointerDown={(event) => {
                seekFromEvent(event.clientX)
                const move = (moveEvent: PointerEvent): void => seekFromEvent(moveEvent.clientX)
                const up = (): void => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            >
              {ticks.map((second) => (
                <div key={second} className="absolute top-0 h-full" style={{ left: second * pixelsPerSecond }}>
                  <div className="h-2 w-px bg-[var(--line-strong)]" />
                  <span className="ml-1 select-none font-mono text-[0.56rem] text-[var(--text-2)]">{formatRuler(second)}</span>
                </div>
              ))}
            </div>

            <div ref={lanesRef}>
              {tracks.map((track) => {
                const trackClips = clips.filter((clip) => clip.trackId === track.id)
                return (
                  <div
                    key={track.id}
                    className="relative border-b border-[var(--line)]"
                    style={{ height: TRACK_HEIGHT[track.kind] }}
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) selectClip(null)
                    }}
                  >
                    <div className="pointer-events-none absolute inset-0">
                      {ticks.map((second) => (
                        <div key={second} className="absolute top-0 h-full w-px bg-white/[0.035]" style={{ left: second * pixelsPerSecond }} />
                      ))}
                    </div>
                    {trackClips.map((clip) => {
                      const colors = clipColor(clip, track)
                      const width = Math.max(8, clip.duration * pixelsPerSecond)
                      const selected = clip.id === selectedClipId
                      return (
                        <div
                          key={clip.id}
                          className={`track-clip group ${selected ? 'selected' : ''}`}
                          style={{ left: clip.start * pixelsPerSecond, width, background: colors.background, border: `1px solid ${colors.border}` }}
                          onPointerDown={(event) => beginDrag(event, clip, 'move')}
                          title={`${clip.name} · ${clip.duration.toFixed(2)}s`}
                        >
                          <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 transition group-hover:opacity-100" onPointerDown={(event) => beginDrag(event, clip, 'left')} />
                          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 transition group-hover:opacity-100" onPointerDown={(event) => beginDrag(event, clip, 'right')} />
                          {clip.hasAudio && clip.kind !== 'text' && clip.sourcePath ? <Waveform path={clip.sourcePath} height={TRACK_HEIGHT[track.kind] - 8} /> : null}
                          <div className="relative flex h-full flex-col justify-center gap-0.5 px-2" style={{ color: colors.text }}>
                            <div className="flex items-center gap-1 truncate text-[0.68rem] font-semibold leading-none">
                              {clip.kind === 'text' ? <Icon name="text" size={10} /> : clip.kind === 'audio' ? <Icon name="music" size={10} /> : <Icon name="film" size={10} />}
                              <span className="truncate">{clip.kind === 'text' && clip.text ? clip.text.content.split('\n')[0].slice(0, 32) || 'Text' : clip.name}</span>
                            </div>
                            <div className="truncate font-mono text-[0.56rem] opacity-70">
                              {clip.duration.toFixed(2)}s
                              {clip.speed !== 1 ? ` · ${clip.speed.toFixed(2)}×` : ''}
                              {clip.zoom?.enabled ? ' · zoom' : ''}
                            </div>
                          </div>
                          {clip.transitionIn && clip.transitionIn.duration > 0 ? (
                            <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: Math.min(width, clip.transitionIn.duration * pixelsPerSecond) }} title="Transition" />
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            <div
              className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-sky-400"
              style={{ left: playhead * pixelsPerSecond }}
            >
              <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rounded-sm bg-sky-400 shadow-[0_0_10px_rgba(34,188,255,0.9)]" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-1 text-[0.62rem] text-[var(--text-2)]">
        <span>
          {clips.length} clips · {tracks.length} tracks · {totalDuration(clips).toFixed(2)}s
        </span>
        <span className="flex items-center gap-2">
          <span className="kbd">Space</span> play
          <span className="kbd">S</span> split
          <span className="kbd">Del</span> remove
          {appInfo?.ffmpegVersion ? <span className="ml-2 font-mono">ffmpeg {appInfo.ffmpegVersion}</span> : null}
        </span>
      </div>
    </section>
  )
}

function formatRuler(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)
  return minutes > 0 ? `${minutes}:${rest.toString().padStart(2, '0')}` : `${rest}s`
}

void newId
