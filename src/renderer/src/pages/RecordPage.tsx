import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AudioDevice,
  CaptureSource,
  EffectsSettings,
  MonitorInfo,
  RecorderStatus,
  RecordingPreset,
  RecordingRequest,
  RecordingResult,
  RecoveryEntry,
  RegionSelection,
  ResolutionPreset,
  WebcamSettings
} from '@shared/types'
import { RESOLUTION_PRESETS, defaultPreset, newId, resolutionForPreset } from '@shared/defaults'
import { formatBytes, formatTimecode, clamp } from '@shared/time'
import { renderOneShot } from '@shared/effects-audio'
import { useStore } from '../state/store'
import { Badge, Button, Field, IconButton, Progress, SectionTitle, Segmented, Select, Slider, Stat, TextInput, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { CaptureEngine } from '../engine/capture'

interface RecorderOptions {
  resolution: ResolutionPreset
  fps: number
  quality: 'low' | 'medium' | 'high' | 'ultra'
  format: 'mp4' | 'mkv'
  micDeviceId: string | null
  micGain: number
  systemAudio: boolean
  systemGain: number
  webcam: WebcamSettings
  effects: EffectsSettings
  countdown: number
  region: RegionSelection
}

function optionsFromPreset(preset: RecordingPreset): RecorderOptions {
  return {
    resolution: preset.resolution,
    fps: preset.fps,
    quality: preset.quality,
    format: preset.format,
    micDeviceId: preset.micDeviceId,
    micGain: 1,
    systemAudio: preset.systemAudio,
    systemGain: 1,
    webcam: preset.webcam,
    effects: preset.effects,
    countdown: preset.countdown,
    region: preset.region
  }
}

export function RecordPage(): JSX.Element {
  const appInfo = useStore((state) => state.appInfo)
  const settings = useStore((state) => state.settings)
  const pushToast = useStore((state) => state.pushToast)
  const recorder = useStore((state) => state.recorder)
  const setRecorder = useStore((state) => state.setRecorder)
  const lastResult = useStore((state) => state.lastResult)
  const setLastResult = useStore((state) => state.setLastResult)
  const openProject = useStore((state) => state.openProject)
  const setView = useStore((state) => state.setView)
  const updateSettings = useStore((state) => state.updateSettings)

  const [sources, setSources] = useState<CaptureSource[]>([])
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [loadingSources, setLoadingSources] = useState(true)
  const [options, setOptions] = useState<RecorderOptions>(() => optionsFromPreset(defaultPreset()))
  const [presets, setPresets] = useState<RecordingPreset[]>([])
  const [audioInputs, setAudioInputs] = useState<AudioDevice[]>([])
  const [webcamDevices, setWebcamDevices] = useState<AudioDevice[]>([])
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [recoveries, setRecoveries] = useState<RecoveryEntry[]>([])
  const [regionOpen, setRegionOpen] = useState(false)
  const [stats, setStats] = useState({ fps: 0, droppedFrames: 0 })
  const [presetName, setPresetName] = useState('')
  const [showPresetSave, setShowPresetSave] = useState(false)

  const engineRef = useRef<CaptureEngine | null>(null)
  const startRequestRef = useRef<RecordingRequest | null>(null)
  const audioRef = useRef<AudioContext | null>(null)

  const selected = useMemo(() => sources.find((source) => source.id === selectedId) ?? null, [sources, selectedId])
  const filtered = useMemo(() => sources.filter((source) => source.kind === tab), [sources, tab])
  const monitor = useMemo(() => {
    if (!selected) return monitors[0] ?? null
    return monitors.find((entry) => entry.id === selected.displayId) ?? monitors.find((entry) => entry.primary) ?? monitors[0] ?? null
  }, [monitors, selected])

  const active = Boolean(recorder && ['countdown', 'recording', 'paused', 'finalizing'].includes(recorder.phase))
  const finalizing = recorder?.phase === 'finalizing'

  const refreshSources = useCallback(async () => {
    try {
      const [nextSources, nextMonitors] = await Promise.all([window.api.system.sources(['screen', 'window']), window.api.system.monitors()])
      setSources((current) => {
        const keep = current.length ? nextSources.find((source) => source.id === selectedId) : null
        return nextSources.length || !keep ? nextSources : current
      })
      setMonitors(nextMonitors)
      setSelectedId((current) => {
        if (current && nextSources.some((source) => source.id === current)) return current
        return nextSources.find((source) => source.kind === 'screen')?.id ?? nextSources[0]?.id ?? null
      })
    } catch (error) {
      pushToast('error', 'Could not list capture sources', (error as Error).message)
    } finally {
      setLoadingSources(false)
    }
  }, [pushToast, selectedId])

  useEffect(() => {
    void refreshSources()
  }, [refreshSources])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = useStore.getState().recorder
      if (!current || !['countdown', 'recording'].includes(current.phase)) void refreshSources()
    }, 8000)
    return () => window.clearInterval(timer)
  }, [refreshSources])

  useEffect(() => {
    void window.api.presets.list().then((list) => {
      setPresets(list)
      const preferred = settings?.lastPresetId ? list.find((preset) => preset.id === settings.lastPresetId) : null
      if (preferred) setOptions(optionsFromPreset(preferred))
    })
  }, [settings?.lastPresetId])

  useEffect(() => {
    const unsub = window.api.recorder.onPhase((status: RecorderStatus) => {
      setRecorder(status)
      if (status.phase === 'recording' && status.session && !engineRef.current?.isActive()) {
        void startEngine(status)
      }
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const unsub = window.api.recorder.onInputEvent((event) => {
      engineRef.current?.handleInputEvent(event)
    })
    return unsub
  }, [])

  useEffect(() => {
    void window.api.recorder.listRecoveries().then(setRecoveries)
  }, [])

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setAudioInputs(
        devices
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({ id: device.deviceId || `input-${index}`, label: device.label || `Microphone ${index + 1}`, kind: 'input' }))
      )
      setWebcamDevices(
        devices
          .filter((device) => device.kind === 'videoinput')
          .map((device, index) => ({ id: device.deviceId || `camera-${index}`, label: device.label || `Camera ${index + 1}`, kind: 'input' }))
      )
    } catch {
      setAudioInputs([])
    }
  }, [])

  useEffect(() => {
    void enumerateDevices()
  }, [enumerateDevices])

  const startEngine = async (status: RecorderStatus): Promise<void> => {
    if (!status.session) return
    const engine = new CaptureEngine()
    engineRef.current = engine
    try {
      await engine.start(status.session.request, {
        onChunk: (buffer) => window.api.recorder.sendChunk(status.session!.id, buffer),
        onError: (message) => pushToast('error', 'Capture issue', message),
        onStats: (next) => {
          setStats(next)
          void window.api.recorder.reportDroppedFrames(next.droppedFrames)
        }
      })
    } catch (error) {
      const message = (error as Error).message
      setStartError(message)
      pushToast('error', 'Could not start capture', message)
      await window.api.recorder.cancel()
      useStore.getState().setRecorder(await window.api.recorder.status())
    }
  }

  const buildRequest = (): RecordingRequest | null => {
    if (!selected) return null
    const size = resolutionForPreset(options.resolution, selected.width, selected.height)
    return {
      sourceId: selected.id,
      sourceKind: selected.kind,
      sourceName: selected.name,
      sourceWidth: selected.width,
      sourceHeight: selected.height,
      sourceBounds: selected.bounds,
      targetWidth: size.width,
      targetHeight: size.height,
      fps: options.fps,
      micDeviceId: options.micDeviceId,
      micGain: options.micGain,
      systemAudio: options.systemAudio,
      systemGain: options.systemGain,
      webcam: options.webcam,
      region: options.region,
      effects: options.effects,
      countdown: options.countdown,
      format: options.format,
      quality: options.quality,
      captureInput: Boolean(settings?.captureInputEvents && settings?.inputCaptureConsent),
      monitorBounds: monitor?.bounds ?? { x: 0, y: 0, width: selected.width, height: selected.height },
      monitorScaleFactor: monitor?.scaleFactor ?? 1
    }
  }

  const beginRecording = async (): Promise<void> => {
    const request = buildRequest()
    if (!request) {
      pushToast('error', 'Pick a capture source first')
      return
    }
    if (request.captureInput && !settings?.inputCaptureConsent) {
      pushToast('info', 'Mouse & keyboard effects are off', 'Enable global input capture consent in Settings to record click and typing effects.')
    }
    setBusy(true)
    setStartError(null)
    try {
      startRequestRef.current = request
      const status = await window.api.recorder.start(request)
      setRecorder(status)
      if (status.phase === 'recording' && status.session) await startEngine(status)
    } catch (error) {
      pushToast('error', 'Recording could not start', (error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finishRecording = async (): Promise<RecordingResult | null> => {
    setBusy(true)
    try {
      await engineRef.current?.stop()
      engineRef.current = null
      const result = await window.api.recorder.stop()
      setLastResult(result)
      const status = await window.api.recorder.status()
      setRecorder(status)
      pushToast('success', 'Recording saved', result.outputPath)
      return result
    } catch (error) {
      pushToast('error', 'Recording could not be finalised', (error as Error).message)
      setRecorder(await window.api.recorder.status())
      return null
    } finally {
      setBusy(false)
      void refreshSources()
    }
  }

  const togglePause = async (): Promise<void> => {
    if (!recorder) return
    if (recorder.phase === 'recording') {
      engineRef.current?.pause()
      setRecorder(await window.api.recorder.pause())
    } else if (recorder.phase === 'paused') {
      engineRef.current?.resume()
      setRecorder(await window.api.recorder.resume())
    }
  }

  const cancelRecording = async (): Promise<void> => {
    await engineRef.current?.stop()
    engineRef.current = null
    await window.api.recorder.cancel()
    setRecorder(await window.api.recorder.status())
  }

  const openInEditor = async (result: RecordingResult): Promise<void> => {
    try {
      const project = await window.api.projects.fromRecording(result)
      openProject(project)
      pushToast('success', 'Project ready', 'The recording is loaded on the timeline')
    } catch (error) {
      pushToast('error', 'Could not create a project', (error as Error).message)
    }
  }

  const captureScreenshot = async (): Promise<void> => {
    if (!selected) {
      pushToast('error', 'Pick a capture source first')
      return
    }
    try {
      const shot = await window.api.screenshots.capture({
        sourceId: selected.id,
        sourceWidth: selected.width,
        sourceHeight: selected.height
      })
      pushToast('success', 'Screenshot saved', shot.path)
      setView('screenshots')
    } catch (error) {
      pushToast('error', 'Screenshot failed', (error as Error).message)
    }
  }

  useEffect(() => {
    const handler = (event: Event): void => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'startStopRecording') {
        if (recorder && ['recording', 'paused'].includes(recorder.phase)) void finishRecording()
        else if (!recorder || recorder.phase === 'idle') void beginRecording()
      }
      if (action === 'pauseResumeRecording') void togglePause()
      if (action === 'screenshot') void captureScreenshot()
    }
    window.addEventListener('skyrec:shortcut', handler)
    return () => window.removeEventListener('skyrec:shortcut', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, selected, options, monitor])

  const previewSound = (kind: 'click-left' | 'click-right' | 'key'): void => {
    if (!audioRef.current) audioRef.current = new AudioContext()
    const audio = audioRef.current
    if (audio.state === 'suspended') void audio.resume()
    const samples = renderOneShot(options.effects.pack, kind)
    const buffer = audio.createBuffer(1, samples.length, audio.sampleRate)
    buffer.getChannelData(0).set(samples)
    const source = audio.createBufferSource()
    source.buffer = buffer
    const gain = audio.createGain()
    gain.gain.value = 0.8
    source.connect(gain).connect(audio.destination)
    source.start()
  }

  const applyPreset = (id: string): void => {
    const preset = presets.find((entry) => entry.id === id)
    if (!preset) return
    setOptions(optionsFromPreset(preset))
    void updateSettings({ lastPresetId: preset.id })
  }

  const savePreset = async (): Promise<void> => {
    const name = presetName.trim() || `Preset ${presets.length + 1}`
    const preset: RecordingPreset = {
      id: newId('preset'),
      name,
      fps: options.fps,
      resolution: options.resolution,
      micDeviceId: options.micDeviceId,
      systemAudio: options.systemAudio,
      webcam: options.webcam,
      format: options.format,
      quality: options.quality,
      effects: options.effects,
      region: options.region,
      countdown: options.countdown
    }
    const next = await window.api.presets.save(preset)
    setPresets(next)
    setPresetName('')
    setShowPresetSave(false)
    void updateSettings({ lastPresetId: preset.id })
    pushToast('success', 'Preset saved', name)
  }

  const deletePreset = async (id: string): Promise<void> => {
    const next = await window.api.presets.delete(id)
    setPresets(next)
    pushToast('info', 'Preset removed')
  }

  const recover = async (entry: RecoveryEntry): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.recorder.recover(entry.id)
      setLastResult(result)
      setRecoveries((current) => current.filter((item) => item.id !== entry.id))
      pushToast('success', 'Interrupted recording recovered', result.outputPath)
    } catch (error) {
      pushToast('error', 'Recovery failed', (error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const phase = recorder?.phase ?? 'idle'
  const elapsedSeconds = (recorder?.elapsedMs ?? 0) / 1000

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
          <div>
            <h1 className="text-[1.02rem] font-semibold tracking-tight">Recorder</h1>
            <p className="mt-0.5 text-[0.74rem] text-[var(--text-2)]">
              {active ? 'Capturing with the Windows graphics pipeline' : 'Pick a screen, window or region and record with effects'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button icon="refresh" onClick={() => void refreshSources()} size="sm">
              Refresh
            </Button>
            <Button icon="image" onClick={() => void captureScreenshot()} size="sm" disabled={!selected || active}>
              Screenshot
            </Button>
            <Button icon="folder" size="sm" onClick={() => setView('library')}>
              Library
            </Button>
          </div>
        </div>

        <div className="scroll-area min-h-0 flex-1 px-5 py-4">
          {recoveries.length ? (
            <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3">
              <div className="flex items-center gap-2 text-[0.8rem] font-medium text-amber-200">
                <Icon name="alert" size={15} />
                {recoveries.length} interrupted recording{recoveries.length > 1 ? 's' : ''} found
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {recoveries.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-black/20 px-3 py-2">
                    <div className="min-w-0 text-[0.72rem] text-[var(--text-1)]">
                      <span className="font-mono">{new Date(entry.createdAt).toLocaleString()}</span>
                      <span className="mx-2 text-[var(--text-2)]">·</span>
                      {formatBytes(entry.sizeBytes)}
                    </div>
                    <Button size="sm" icon="refresh" onClick={() => void recover(entry)} disabled={busy}>
                      Recover
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-col gap-4">
              <section className="panel overflow-hidden">
                <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Icon name="monitor" size={15} className="text-sky-300/80" />
                    <span className="text-[0.78rem] font-medium">Capture source</span>
                  </div>
                  <Segmented
                    value={tab}
                    onChange={(value) => setTab(value)}
                    options={[
                      { value: 'screen', label: 'Displays', icon: 'monitor' },
                      { value: 'window', label: 'Windows', icon: 'window' }
                    ]}
                  />
                </div>
                <div className="scroll-area max-h-[290px] p-3">
                  {loadingSources ? (
                    <div className="grid grid-cols-2 gap-3">
                      {[0, 1, 2, 3].map((index) => (
                        <div key={index} className="h-[104px] animate-pulse rounded-xl bg-white/5" />
                      ))}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="py-10 text-center text-[0.78rem] text-[var(--text-2)]">
                      No {tab === 'screen' ? 'displays' : 'windows'} found. Open a window and hit Refresh.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {filtered.map((source) => {
                        const isSelected = source.id === selectedId
                        return (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => setSelectedId(source.id)}
                            className={`group overflow-hidden rounded-xl border text-left transition-all duration-150 ${
                              isSelected
                                ? 'border-sky-400/70 bg-sky-400/[0.08] shadow-[0_0_0_1px_rgba(34,188,255,0.35),0_16px_32px_-24px_rgba(34,188,255,0.9)]'
                                : 'border-[var(--line)] bg-black/20 hover:border-[var(--line-strong)] hover:bg-white/[0.03]'
                            }`}
                          >
                            <div className="relative aspect-video w-full overflow-hidden bg-black/50">
                              {source.thumbnail ? (
                                <img src={source.thumbnail} alt={source.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[var(--text-2)]">
                                  <Icon name={source.kind === 'screen' ? 'monitor' : 'window'} size={22} />
                                </div>
                              )}
                              {source.appIcon ? (
                                <img src={source.appIcon} alt="" className="absolute left-1.5 top-1.5 h-5 w-5 rounded" />
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1.5 px-2 py-1.5">
                              <span className="truncate text-[0.7rem] text-[var(--text-1)]">{source.name}</span>
                              {isSelected ? <Icon name="check" size={12} className="ml-auto shrink-0 text-sky-300" /> : null}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>

              <section className="panel relative overflow-hidden">
                <div className="relative flex min-h-[268px] flex-col items-center justify-center gap-4 p-6">
                  <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
                  {phase === 'countdown' ? (
                    <div className="relative z-10 flex flex-col items-center gap-3">
                      <div className="text-[4.2rem] font-semibold tracking-tight text-sky-300 tabular-nums">{recorder?.countdownRemaining ?? 0}</div>
                      <div className="text-[0.8rem] text-[var(--text-2)]">Recording starts in…</div>
                      <Button variant="danger" size="sm" onClick={() => void cancelRecording()}>
                        Cancel
                      </Button>
                    </div>
                  ) : active ? (
                    <div className="relative z-10 flex w-full flex-col items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${phase === 'paused' ? 'bg-amber-400' : 'bg-red-500 animate-pulse-rec'}`} />
                        <span className="font-mono text-[2.4rem] font-semibold tabular-nums text-[var(--text-0)]">{formatTimecode(elapsedSeconds)}</span>
                      </div>
                      <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label="Output" value={`${recorder?.fps ?? 0} fps`} icon="film" />
                        <Stat label="Size" value={formatBytes(recorder?.bytes ?? 0)} icon="disk" />
                        <Stat label="CPU" value={`${(recorder?.cpuPercent ?? 0).toFixed(0)}%`} icon="cpu" />
                        <Stat label="Dropped" value={String(stats.droppedFrames)} icon="alert" />
                      </div>
                      {finalizing ? (
                        <div className="w-full max-w-sm">
                          <Progress value={0.6} />
                          <p className="mt-2 text-center text-[0.72rem] text-[var(--text-2)]">Finalising with FFmpeg…</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button icon={phase === 'paused' ? 'play' : 'pause'} onClick={() => void togglePause()} disabled={finalizing}>
                            {phase === 'paused' ? 'Resume' : 'Pause'}
                          </Button>
                          <Button icon="stop" variant="primary" onClick={() => void finishRecording()} disabled={busy}>
                            Stop &amp; save
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => void cancelRecording()} disabled={busy}>
                            Discard
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="relative z-10 flex flex-col items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void beginRecording()}
                        disabled={!selected || busy}
                        className="group relative flex h-[92px] w-[92px] items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-[#04131c] shadow-[0_20px_50px_-18px_rgba(34,188,255,0.95)] transition-transform duration-150 hover:scale-[1.04] active:scale-[0.98] disabled:opacity-40"
                      >
                        <span className="absolute inset-[-8px] rounded-full border border-sky-400/25 transition group-hover:border-sky-400/50" />
                        <Icon name="record" size={30} />
                      </button>
                      <div className="text-center">
                        <div className="text-[0.82rem] font-medium text-[var(--text-0)]">
                          {selected ? selected.name : 'Select a source'}
                        </div>
                        <div className="mt-0.5 text-[0.7rem] text-[var(--text-2)]">
                          {options.fps} fps · {options.resolution === 'native' ? 'native resolution' : options.resolution} · {options.quality} quality ·{' '}
                          {options.format.toUpperCase()}
                        </div>
                      </div>
                      {startError ? <div className="max-w-md text-center text-[0.72rem] text-red-300">{startError}</div> : null}
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <Badge tone={settings?.inputCaptureConsent ? 'success' : 'neutral'}>
                          <Icon name="cursor" size={11} /> {settings?.inputCaptureConsent ? 'Cursor effects armed' : 'Effects need consent'}
                        </Badge>
                        <Badge tone={appInfo?.inputCaptureAvailable ? 'accent' : 'warning'}>
                          <Icon name="shield" size={11} /> {appInfo?.inputCaptureAvailable ? 'Input hook ready' : 'Input hook unavailable'}
                        </Badge>
                        <Badge tone="neutral">
                          <Icon name="bolt" size={11} /> {appInfo?.ffmpegVersion ? `FFmpeg ${appInfo.ffmpegVersion}` : 'FFmpeg missing'}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {lastResult ? (
                <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
                      <Icon name="check" size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[0.78rem] font-medium text-[var(--text-0)]">Last recording ready</div>
                      <div className="truncate text-[0.68rem] text-[var(--text-2)]">
                        {formatTimecode(lastResult.durationMs / 1000)} · {formatBytes(lastResult.sizeBytes)} · {lastResult.width}×{lastResult.height}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" icon="external" onClick={() => void window.api.library.openFile(lastResult.outputPath)}>
                      Play
                    </Button>
                    <Button size="sm" icon="film" variant="primary" onClick={() => void openInEditor(lastResult)}>
                      Open in editor
                    </Button>
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="flex flex-col gap-4">
              <section className="panel px-4 py-3.5">
                <SectionTitle
                  right={
                    <div className="flex items-center gap-1">
                      <IconButton icon="plus" title="Save current settings as a preset" onClick={() => setShowPresetSave((value) => !value)} />
                      <IconButton
                        icon="trash"
                        title="Delete selected preset"
                        onClick={() => {
                          const id = settings?.lastPresetId
                          if (id && presets.length > 1) void deletePreset(id)
                        }}
                      />
                    </div>
                  }
                >
                  Presets
                </SectionTitle>
                <Select
                  value={settings?.lastPresetId ?? presets[0]?.id ?? ''}
                  onChange={applyPreset}
                  options={presets.map((preset) => ({ value: preset.id, label: preset.name }))}
                />
                {showPresetSave ? (
                  <div className="mt-2 flex gap-2">
                    <TextInput value={presetName} onChange={setPresetName} placeholder="Preset name" />
                    <Button variant="primary" size="sm" onClick={() => void savePreset()}>
                      Save
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="panel px-4 py-3.5">
                <SectionTitle>Video</SectionTitle>
                <div className="flex flex-col gap-3">
                  <Field label="Resolution">
                    <Select
                      value={options.resolution}
                      onChange={(value) => setOptions((current) => ({ ...current, resolution: value }))}
                      options={RESOLUTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
                    />
                  </Field>
                  <Field label="Frame rate">
                    <Select
                      value={String(options.fps)}
                      onChange={(value) => setOptions((current) => ({ ...current, fps: Number(value) }))}
                      options={[24, 30, 50, 60, 120, 144].map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Quality">
                      <Select
                        value={options.quality}
                        onChange={(value) => setOptions((current) => ({ ...current, quality: value }))}
                        options={[
                          { value: 'low', label: 'Low' },
                          { value: 'medium', label: 'Medium' },
                          { value: 'high', label: 'High' },
                          { value: 'ultra', label: 'Ultra' }
                        ]}
                      />
                    </Field>
                    <Field label="Format">
                      <Select
                        value={options.format}
                        onChange={(value) => setOptions((current) => ({ ...current, format: value }))}
                        options={[
                          { value: 'mp4', label: 'MP4' },
                          { value: 'mkv', label: 'MKV' }
                        ]}
                      />
                    </Field>
                  </div>
                  <Field label="Output size" hint={selected ? `Target: ${resolutionForPreset(options.resolution, selected.width, selected.height).width}×${resolutionForPreset(options.resolution, selected.width, selected.height).height}` : undefined}>
                    <div className="flex items-center gap-2">
                      <Button size="sm" icon="crop" onClick={() => setRegionOpen(true)} disabled={!selected}>
                        {options.region.enabled ? 'Edit region' : 'Select region'}
                      </Button>
                      {options.region.enabled ? (
                        <Button
                          size="sm"
                          onClick={() => setOptions((current) => ({ ...current, region: { enabled: false, x: 0, y: 0, width: 1, height: 1 } }))}
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  </Field>
                  <Field label="Countdown">
                    <Select
                      value={String(options.countdown)}
                      onChange={(value) => setOptions((current) => ({ ...current, countdown: Number(value) }))}
                      options={[0, 3, 5, 10].map((seconds) => ({ value: String(seconds), label: `${seconds} s` }))}
                    />
                  </Field>
                </div>
              </section>

              <section className="panel px-4 py-3.5">
                <SectionTitle
                  right={
                    <IconButton icon="refresh" title="Refresh audio devices" onClick={() => void enumerateDevices()} />
                  }
                >
                  Audio
                </SectionTitle>
                <Toggle
                  label="Microphone"
                  hint="Records your voice into the capture"
                  checked={options.micDeviceId !== null}
                  onChange={(value) =>
                    setOptions((current) => ({ ...current, micDeviceId: value ? (audioInputs[0]?.id ?? 'default') : null }))
                  }
                />
                {options.micDeviceId !== null ? (
                  <div className="mb-2 grid gap-2">
                    <Select
                      value={options.micDeviceId}
                      onChange={(value) => setOptions((current) => ({ ...current, micDeviceId: value }))}
                      options={[{ value: 'default', label: 'System default' }, ...audioInputs
                        .filter((device) => device.id !== 'default')
                        .map((device) => ({ value: device.id, label: device.label }))]}
                    />
                    <Slider
                      label="Mic gain"
                      min={0}
                      max={2}
                      value={options.micGain}
                      onChange={(value) => setOptions((current) => ({ ...current, micGain: value }))}
                      format={(value) => `${Math.round(value * 100)}%`}
                    />
                  </div>
                ) : null}
                <Toggle
                  label="System audio"
                  hint="Loopback capture of everything playing on Windows"
                  checked={options.systemAudio}
                  onChange={(value) => setOptions((current) => ({ ...current, systemAudio: value }))}
                />
                {options.systemAudio ? (
                  <Slider
                    label="System volume"
                    min={0}
                    max={2}
                    value={options.systemGain}
                    onChange={(value) => setOptions((current) => ({ ...current, systemGain: value }))}
                    format={(value) => `${Math.round(value * 100)}%`}
                  />
                ) : null}
              </section>

              <WebcamPanel
                webcam={options.webcam}
                devices={webcamDevices}
                onChange={(webcam) => setOptions((current) => ({ ...current, webcam }))}
              />

              <EffectsPanel
                effects={options.effects}
                onChange={(effects) => setOptions((current) => ({ ...current, effects }))}
                onPreview={previewSound}
                consent={Boolean(settings?.inputCaptureConsent)}
                available={Boolean(appInfo?.inputCaptureAvailable)}
                onGrantConsent={() => {
                  void updateSettings({ inputCaptureConsent: true })
                  pushToast('info', 'Input capture enabled', 'Only click positions, buttons and coarse key ids are stored — never text.')
                }}
              />
            </aside>
          </div>
        </div>
      </div>

      {regionOpen && selected ? (
        <RegionPicker
          source={selected}
          region={options.region}
          onClose={() => setRegionOpen(false)}
          onApply={(region) => {
            setOptions((current) => ({ ...current, region }))
            setRegionOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function WebcamPanel({
  webcam,
  devices,
  onChange
}: {
  webcam: WebcamSettings
  devices: AudioDevice[]
  onChange: (webcam: WebcamSettings) => void
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const stop = (): void => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (!webcam.enabled) {
      stop()
      return
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: webcam.deviceId ? { exact: webcam.deviceId } : undefined, width: { ideal: 640 }, height: { ideal: 360 } }
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setError(null)
      } catch (caught) {
        setError((caught as Error).message)
      }
    })()
    return () => {
      cancelled = true
      stop()
    }
  }, [webcam.enabled, webcam.deviceId])

  return (
    <section className="panel px-4 py-3.5">
      <SectionTitle>Webcam overlay</SectionTitle>
      <Toggle
        label="Show webcam"
        hint="Burned into the recording with the chosen shape and corner"
        checked={webcam.enabled}
        onChange={(enabled) => onChange({ ...webcam, enabled })}
      />
      {webcam.enabled ? (
        <div className="mt-2 flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-black/40">
            <video ref={videoRef} muted playsInline className="h-32 w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[0.62rem] text-white/70">
              {error ? `Camera error: ${error}` : 'Live preview'}
            </div>
          </div>
          <Select
            value={webcam.deviceId ?? 'default'}
            onChange={(value) => onChange({ ...webcam, deviceId: value === 'default' ? null : value })}
            options={[{ value: 'default', label: 'Default camera' }, ...devices.map((device) => ({ value: device.id, label: device.label }))]}
          />
          <Segmented
            value={webcam.position}
            onChange={(position) => onChange({ ...webcam, position })}
            options={[
              { value: 'top-left', label: '↖' },
              { value: 'top-right', label: '↗' },
              { value: 'bottom-left', label: '↙' },
              { value: 'bottom-right', label: '↘' }
            ]}
          />
          <Segmented
            value={webcam.shape}
            onChange={(shape) => onChange({ ...webcam, shape })}
            options={[
              { value: 'circle', label: 'Circle' },
              { value: 'rounded', label: 'Rounded' },
              { value: 'square', label: 'Square' }
            ]}
          />
          <Slider
            label="Size"
            min={0.08}
            max={0.32}
            step={0.01}
            value={webcam.size}
            onChange={(size) => onChange({ ...webcam, size })}
            format={(value) => `${Math.round(value * 100)}%`}
          />
          <Toggle label="Mirror horizontally" checked={webcam.mirrored} onChange={(mirrored) => onChange({ ...webcam, mirrored })} />
        </div>
      ) : null}
    </section>
  )
}

function EffectsPanel({
  effects,
  onChange,
  onPreview,
  consent,
  available,
  onGrantConsent
}: {
  effects: EffectsSettings
  onChange: (effects: EffectsSettings) => void
  onPreview: (kind: 'click-left' | 'click-right' | 'key') => void
  consent: boolean
  available: boolean
  onGrantConsent: () => void
}): JSX.Element {
  return (
    <section className="panel px-4 py-3.5">
      <SectionTitle>Cursor &amp; keyboard effects</SectionTitle>
      {!available ? (
        <div className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2 text-[0.7rem] text-amber-200">
          The native input hook is unavailable, so click/keyboard effects cannot be captured on this machine.
        </div>
      ) : !consent ? (
        <div className="mb-2 rounded-lg border border-sky-400/30 bg-sky-400/[0.08] px-3 py-2">
          <div className="text-[0.7rem] leading-relaxed text-sky-100/90">
            Effects need your explicit consent. SkyRec records only pointer coordinates, mouse buttons and coarse key ids — never text, passwords or
            clipboard contents.
          </div>
          <Button size="sm" variant="primary" className="mt-2" onClick={onGrantConsent}>
            Allow input effects
          </Button>
        </div>
      ) : null}
      <Toggle label="Enable effects" checked={effects.enabled} onChange={(enabled) => onChange({ ...effects, enabled })} />
      <Toggle
        label="Cursor highlight"
        checked={effects.cursorHighlight}
        onChange={(cursorHighlight) => onChange({ ...effects, cursorHighlight })}
      />
      <Toggle label="Click ripples" checked={effects.clickRipples} onChange={(clickRipples) => onChange({ ...effects, clickRipples })} />
      <Toggle label="Click sounds" checked={effects.clickSounds} onChange={(clickSounds) => onChange({ ...effects, clickSounds })} />
      <Toggle label="Keyboard sounds" checked={effects.keyboardSounds} onChange={(keyboardSounds) => onChange({ ...effects, keyboardSounds })} />
      <Toggle
        label="Smooth cursor path"
        hint="Interpolates pointer samples for silky motion"
        checked={effects.smoothCursor}
        onChange={(smoothCursor) => onChange({ ...effects, smoothCursor })}
      />
      <Toggle label="Zoom on click" checked={effects.zoomOnClick} onChange={(zoomOnClick) => onChange({ ...effects, zoomOnClick })} />
      <div className="mt-3 grid gap-3">
        <Field label="Sound pack">
          <Select
            value={effects.pack}
            onChange={(pack) => onChange({ ...effects, pack })}
            options={[
              { value: 'soft', label: 'Soft' },
              { value: 'mechanical', label: 'Mechanical' },
              { value: 'crisp', label: 'Crisp' }
            ]}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => onPreview('click-left')}>
            Test left
          </Button>
          <Button size="sm" onClick={() => onPreview('click-right')}>
            Test right
          </Button>
          <Button size="sm" onClick={() => onPreview('key')}>
            Test key
          </Button>
        </div>
        <Slider
          label="Intensity"
          min={0}
          max={1}
          value={effects.intensity}
          onChange={(intensity) => onChange({ ...effects, intensity })}
          format={(value) => `${Math.round(value * 100)}%`}
        />
        <Slider
          label="Effect volume"
          min={0}
          max={1}
          value={effects.volume}
          onChange={(volume) => onChange({ ...effects, volume })}
          format={(value) => `${Math.round(value * 100)}%`}
        />
        <Slider
          label="Cursor size"
          min={10}
          max={64}
          step={1}
          value={effects.cursorSize}
          onChange={(cursorSize) => onChange({ ...effects, cursorSize })}
          format={(value) => `${Math.round(value)} px`}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Cursor colour">
            <input
              type="color"
              className="h-9 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
              value={effects.cursorColor}
              onChange={(event) => onChange({ ...effects, cursorColor: event.target.value })}
            />
          </Field>
          <Field label="Ripple colour">
            <input
              type="color"
              className="h-9 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
              value={effects.rippleColor}
              onChange={(event) => onChange({ ...effects, rippleColor: event.target.value })}
            />
          </Field>
        </div>
      </div>
      <p className="mt-3 text-[0.66rem] leading-relaxed text-[var(--text-2)]">
        Effects are editable after recording: their intensity, sounds and pack can be changed in the editor and are re-baked on export.
      </p>
    </section>
  )
}

function RegionPicker({
  source,
  region,
  onApply,
  onClose
}: {
  source: CaptureSource
  region: RegionSelection
  onApply: (region: RegionSelection) => void
  onClose: () => void
}): JSX.Element {
  const [rect, setRect] = useState({ x: region.x, y: region.y, width: region.width, height: region.height })
  const [dragging, setDragging] = useState<{ startX: number; startY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const position = (event: React.PointerEvent): { x: number; y: number } => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl panel animate-scale-in overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
          <div>
            <h2 className="text-[0.92rem] font-semibold">Custom region</h2>
            <p className="text-[0.72rem] text-[var(--text-2)]">Drag on the source preview to pick the exact area to record.</p>
          </div>
          <IconButton icon="close" title="Close" onClick={onClose} />
        </div>
        <div className="p-5">
          <div
            ref={containerRef}
            className="relative aspect-video w-full cursor-crosshair overflow-hidden rounded-xl border border-[var(--line)] bg-black"
            onPointerDown={(event) => {
              const point = position(event)
              setDragging({ startX: point.x, startY: point.y })
              setRect({ x: point.x, y: point.y, width: 0.001, height: 0.001 })
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!dragging) return
              const point = position(event)
              setRect({
                x: Math.min(dragging.startX, point.x),
                y: Math.min(dragging.startY, point.y),
                width: Math.abs(point.x - dragging.startX),
                height: Math.abs(point.y - dragging.startY)
              })
            }}
            onPointerUp={() => setDragging(null)}
          >
            {source.thumbnail ? <img src={source.thumbnail} alt={source.name} className="h-full w-full object-contain opacity-80" /> : null}
            <div className="pointer-events-none absolute inset-0 bg-[rgba(3,6,10,0.45)]" />
            <div
              className="pointer-events-none absolute border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(3,6,10,0.5)]"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`
              }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-[0.72rem] text-[var(--text-2)]">
            <span>
              {Math.round(rect.width * 100)}% × {Math.round(rect.height * 100)}% of the source
            </span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setRect({ x: 0, y: 0, width: 1, height: 1 })}>
                Full frame
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  onApply({
                    enabled: rect.width > 0.02 && rect.height > 0.02,
                    x: rect.x,
                    y: rect.y,
                    width: Math.max(0.02, rect.width),
                    height: Math.max(0.02, rect.height)
                  })
                }
              >
                Use region
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
