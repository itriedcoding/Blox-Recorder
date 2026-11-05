import { useEffect, useState } from 'react'
import type { AppSettings, EncoderKind, ShortcutAction } from '@shared/types'
import { DEFAULT_SHORTCUTS, RESOLUTION_PRESETS } from '@shared/defaults'
import { useStore } from '../state/store'
import { Badge, Button, Field, Modal, SectionTitle, Select, Slider, TextInput, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  startStopRecording: 'Start / stop recording',
  pauseResumeRecording: 'Pause / resume recording',
  screenshot: 'Capture screenshot',
  openEditor: 'Open editor',
  newProject: 'New project',
  saveProject: 'Save project',
  exportVideo: 'Export video'
}

export function SettingsPage(): JSX.Element {
  const settings = useStore((state) => state.settings)
  const appInfo = useStore((state) => state.appInfo)
  const updateSettings = useStore((state) => state.updateSettings)
  const refreshAppInfo = useStore((state) => state.refreshAppInfo)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logs, setLogs] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!logsOpen) return
    void window.api.app.logs().then(setLogs)
  }, [logsOpen])

  if (!settings) return <div />

  const patch = (next: Partial<AppSettings>): void => {
    void updateSettings(next)
  }

  const pickDir = async (key: 'recordingsDir' | 'projectsDir' | 'screenshotsDir'): Promise<void> => {
    const dir = await window.api.app.pickDirectory()
    if (dir) patch({ [key]: dir } as Partial<AppSettings>)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <div>
          <h1 className="text-[1.02rem] font-semibold tracking-tight">Settings</h1>
          <p className="mt-0.5 text-[0.74rem] text-[var(--text-2)]">Everything is stored locally in your user profile</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" icon="info" onClick={() => setLogsOpen(true)}>
            Logs
          </Button>
          <Button
            size="sm"
            icon="refresh"
            onClick={() => {
              void window.api.settings.reset().then(() => window.location.reload())
            }}
          >
            Reset defaults
          </Button>
        </div>
      </div>

      <div className="scroll-area min-h-0 flex-1 px-5 py-4">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
          <section className="panel px-4 py-3.5">
            <SectionTitle>Appearance</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <Button variant={settings.theme === 'dark' ? 'primary' : 'ghost'} onClick={() => patch({ theme: 'dark' })}>
                Dark
              </Button>
              <Button variant={settings.theme === 'light' ? 'primary' : 'ghost'} onClick={() => patch({ theme: 'light' })}>
                Light
              </Button>
            </div>
            <div className="mt-3">
              <Toggle
                label="Live hardware monitor"
                hint="Shows CPU and memory usage while recording"
                checked={settings.hardwareMonitor}
                onChange={(hardwareMonitor) => patch({ hardwareMonitor })}
              />
            </div>
            <div className="mt-2">
              <Slider
                label="Autosave interval"
                min={5}
                max={300}
                step={5}
                value={settings.autoSaveSeconds}
                onChange={(autoSaveSeconds) => patch({ autoSaveSeconds })}
                format={(value) => `${Math.round(value)} s`}
              />
            </div>
          </section>

          <section className="panel px-4 py-3.5">
            <SectionTitle>Storage</SectionTitle>
            <div className="flex flex-col gap-2">
              <Field label="Recordings folder" hint={settings.recordingsDir || appInfo?.recordingsDir}>
                <div className="flex gap-2">
                  <TextInput value={settings.recordingsDir} onChange={(value) => patch({ recordingsDir: value })} placeholder={appInfo?.recordingsDir} mono />
                  <Button size="sm" icon="folder" onClick={() => void pickDir('recordingsDir')}>
                    Pick
                  </Button>
                </div>
              </Field>
              <Field label="Projects folder" hint={settings.projectsDir || appInfo?.projectsDir}>
                <div className="flex gap-2">
                  <TextInput value={settings.projectsDir} onChange={(value) => patch({ projectsDir: value })} placeholder={appInfo?.projectsDir} mono />
                  <Button size="sm" icon="folder" onClick={() => void pickDir('projectsDir')}>
                    Pick
                  </Button>
                </div>
              </Field>
              <Field label="Screenshots folder" hint={settings.screenshotsDir || appInfo?.screenshotsDir}>
                <div className="flex gap-2">
                  <TextInput value={settings.screenshotsDir} onChange={(value) => patch({ screenshotsDir: value })} placeholder={appInfo?.screenshotsDir} mono />
                  <Button size="sm" icon="folder" onClick={() => void pickDir('screenshotsDir')}>
                    Pick
                  </Button>
                </div>
              </Field>
            </div>
          </section>

          <section className="panel px-4 py-3.5">
            <SectionTitle>Recording defaults</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Resolution">
                <Select
                  value={settings.defaultResolution}
                  onChange={(defaultResolution) => patch({ defaultResolution })}
                  options={RESOLUTION_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
                />
              </Field>
              <Field label="Frame rate">
                <Select
                  value={String(settings.defaultFps)}
                  onChange={(value) => patch({ defaultFps: Number(value) })}
                  options={[24, 30, 50, 60, 120, 144].map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
                />
              </Field>
              <Field label="Countdown">
                <Select
                  value={String(settings.countdownSeconds)}
                  onChange={(value) => patch({ countdownSeconds: Number(value) })}
                  options={[0, 3, 5, 10].map((seconds) => ({ value: String(seconds), label: `${seconds} s` }))}
                />
              </Field>
              <Field label="Format">
                <Select
                  value={settings.recordingFormat}
                  onChange={(recordingFormat) => patch({ recordingFormat })}
                  options={[
                    { value: 'mp4', label: 'MP4' },
                    { value: 'mkv', label: 'MKV' }
                  ]}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Hardware encoder">
                <Select
                  value={settings.encoder}
                  onChange={(encoder) => patch({ encoder: encoder as EncoderKind })}
                  options={[
                    { value: 'auto', label: 'Automatic (best available)' },
                    ...(appInfo?.encoders ?? []).filter((encoder) => encoder.available).map((encoder) => ({ value: encoder.kind, label: `${encoder.label}` })),
                    { value: 'cpu', label: 'CPU (x264)' }
                  ]}
                />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(appInfo?.encoders ?? []).map((encoder) => (
                <Badge key={encoder.name} tone={encoder.available ? 'success' : 'neutral'}>
                  {encoder.name}
                  {encoder.available ? '' : ' (n/a)'}
                </Badge>
              ))}
            </div>
            <Button
              size="sm"
              icon="refresh"
              className="mt-2"
              onClick={() => {
                setRefreshing(true)
                void window.api.system.encoders(true).then(() => refreshAppInfo()).finally(() => setRefreshing(false))
              }}
              disabled={refreshing}
            >
              {refreshing ? 'Detecting…' : 'Re-detect encoders'}
            </Button>
          </section>

          <section className="panel px-4 py-3.5">
            <SectionTitle>Input capture &amp; privacy</SectionTitle>
            <Toggle
              label="Capture mouse & keyboard events"
              hint="Records pointer position, mouse buttons and coarse key ids while recording. No text, passwords, clipboard or window titles are ever captured."
              checked={settings.captureInputEvents}
              onChange={(captureInputEvents) => patch({ captureInputEvents })}
            />
            <div className={`mt-2 rounded-xl border p-3 ${settings.inputCaptureConsent ? 'border-emerald-400/25 bg-emerald-400/[0.05]' : 'border-amber-400/25 bg-amber-400/[0.05]'}`}>
              <div className="flex items-start gap-2">
                <Icon name={settings.inputCaptureConsent ? 'shield' : 'alert'} size={14} className={settings.inputCaptureConsent ? 'mt-0.5 text-emerald-300' : 'mt-0.5 text-amber-300'} />
                <div className="text-[0.7rem] leading-relaxed text-[var(--text-1)]">
                  {settings.inputCaptureConsent
                    ? 'Consent granted for this machine. Disable it at any time; capture also stops the moment a recording ends.'
                    : 'Effects are disabled until you grant consent. The hook is only active while a recording is running.'}
                </div>
              </div>
              <Toggle
                label="I consent to input event capture"
                checked={settings.inputCaptureConsent}
                onChange={(inputCaptureConsent) => patch({ inputCaptureConsent })}
              />
            </div>
            <div className="mt-2 text-[0.68rem] text-[var(--text-2)]">
              Native hook:{' '}
              {appInfo?.inputCaptureAvailable ? (
                <span className="text-emerald-300">available</span>
              ) : (
                <span className="text-amber-300">{appInfo?.inputCaptureReason ?? 'unavailable'}</span>
              )}
            </div>
          </section>

          <section className="panel px-4 py-3.5 lg:col-span-2">
            <SectionTitle
              right={
                <Button size="sm" onClick={() => patch({ shortcuts: DEFAULT_SHORTCUTS })}>
                  Reset shortcuts
                </Button>
              }
            >
              Global shortcuts
            </SectionTitle>
            <div className="grid gap-2 md:grid-cols-2">
              {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((action) => (
                <div key={action} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2">
                  <span className="text-[0.74rem] text-[var(--text-1)]">{SHORTCUT_LABELS[action]}</span>
                  <ShortcutRecorder value={settings.shortcuts[action]} onChange={(value) => patch({ shortcuts: { ...settings.shortcuts, [action]: value } })} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[0.66rem] text-[var(--text-2)]">
              Global shortcuts work while the app is in the background. Changes apply immediately.
            </p>
          </section>

          <section className="panel px-4 py-3.5 lg:col-span-2">
            <SectionTitle
              right={
                <Button size="sm" icon="external" onClick={() => void window.api.app.openPath(appInfo?.logsDir ?? '')}>
                  Open log folder
                </Button>
              }
            >
              Engine
            </SectionTitle>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="FFmpeg binary" hint={appInfo?.ffmpegPath}>
                <TextInput value={settings.ffmpegPath} onChange={(value) => patch({ ffmpegPath: value })} placeholder="Bundled FFmpeg" mono />
              </Field>
              <Field label="FFprobe binary" hint={appInfo?.ffprobePath}>
                <TextInput value={settings.ffprobePath} onChange={(value) => patch({ ffprobePath: value })} placeholder="Bundled FFprobe" mono />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem] text-[var(--text-2)] md:grid-cols-4">
              <div className="rounded-lg border border-[var(--line)] px-2.5 py-2">
                <div className="text-[0.6rem] uppercase tracking-wider">App</div>
                <div className="font-mono text-[0.72rem] text-[var(--text-0)]">v{appInfo?.version}</div>
              </div>
              <div className="rounded-lg border border-[var(--line)] px-2.5 py-2">
                <div className="text-[0.6rem] uppercase tracking-wider">Electron</div>
                <div className="font-mono text-[0.72rem] text-[var(--text-0)]">{appInfo?.electron}</div>
              </div>
              <div className="rounded-lg border border-[var(--line)] px-2.5 py-2">
                <div className="text-[0.6rem] uppercase tracking-wider">Chromium</div>
                <div className="font-mono text-[0.72rem] text-[var(--text-0)]">{appInfo?.chrome}</div>
              </div>
              <div className="rounded-lg border border-[var(--line)] px-2.5 py-2">
                <div className="text-[0.6rem] uppercase tracking-wider">FFmpeg</div>
                <div className="font-mono text-[0.72rem] text-[var(--text-0)]">{appInfo?.ffmpegVersion ?? 'not found'}</div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Modal open={logsOpen} onClose={() => setLogsOpen(false)} title="Application log" subtitle={appInfo?.logsDir} width="max-w-4xl">
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-black/50 p-3 font-mono text-[0.66rem] leading-relaxed text-[var(--text-1)]">
          {logs || 'No log entries yet.'}
        </pre>
      </Modal>
    </div>
  )
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
  const [recording, setRecording] = useState(false)

  return (
    <button
      type="button"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(event) => {
        if (!recording) return
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Escape') {
          setRecording(false)
          return
        }
        const key = event.key
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return
        const parts: string[] = []
        if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
        if (event.shiftKey) parts.push('Shift')
        if (event.altKey) parts.push('Alt')
        const normalized = key.length === 1 ? key.toUpperCase() : key
        parts.push(normalized === ' ' ? 'Space' : normalized)
        onChange(parts.join('+'))
        setRecording(false)
      }}
      className={`min-w-[168px] rounded-lg border px-2.5 py-1.5 font-mono text-[0.68rem] transition ${
        recording ? 'border-sky-400/60 bg-sky-400/10 text-sky-200' : 'border-[var(--line)] bg-black/30 text-[var(--text-1)] hover:border-[var(--line-strong)]'
      }`}
      title="Click and press a key combination"
    >
      {recording ? 'Press a key combo…' : value || 'Not set'}
    </button>
  )
}
