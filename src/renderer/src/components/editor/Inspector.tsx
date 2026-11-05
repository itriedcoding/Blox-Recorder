import { useMemo } from 'react'
import type { Clip, CropRect, EffectsSettings, TextStyle } from '@shared/types'
import { useStore } from '../../state/store'
import { Field, IconButton, NumberInput, SectionTitle, Segmented, Select, Slider, TextInput, Toggle, Button } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { clamp } from '@shared/time'

export function Inspector(): JSX.Element {
  const project = useStore((state) => state.project)
  const selectedClipId = useStore((state) => state.selectedClipId)
  const mutate = useStore((state) => state.mutate)
  const selectClip = useStore((state) => state.selectClip)
  const pushToast = useStore((state) => state.pushToast)

  const clip = useMemo(() => project?.clips.find((entry) => entry.id === selectedClipId) ?? null, [project, selectedClipId])
  const track = useMemo(() => project?.tracks.find((entry) => entry.id === clip?.trackId) ?? null, [project, clip])

  if (!project) return <div />

  const updateClip = (patch: Partial<Clip>): void => {
    if (!clip) return
    mutate((draft) => {
      const target = draft.clips.find((entry) => entry.id === clip.id)
      if (target) Object.assign(target, patch)
    })
  }

  const updateText = (patch: Partial<TextStyle>): void => {
    if (!clip?.text) return
    updateClip({ text: { ...clip.text, ...patch } })
  }

  const updateCrop = (patch: Partial<CropRect>): void => {
    if (!clip) return
    const current = clip.crop ?? { x: 0, y: 0, width: 1, height: 1 }
    updateClip({ crop: { ...current, ...patch } })
  }

  const duplicate = (): void => {
    if (!clip) return
    const copy: Clip = { ...structuredClone(clip), id: `clip_${Date.now().toString(36)}`, start: clip.start + clip.duration + 0.1 }
    mutate((draft) => {
      draft.clips.push(copy)
    })
    selectClip(copy.id)
    pushToast('success', 'Clip duplicated')
  }

  return (
    <aside className="flex w-[312px] shrink-0 flex-col border-l border-[var(--line)] bg-[rgba(6,10,16,0.55)]">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Icon name={clip ? (clip.kind === 'text' ? 'text' : clip.kind === 'audio' ? 'music' : 'film') : 'sliders'} size={14} className="text-sky-300/80" />
          <span className="text-[0.78rem] font-medium">{clip ? 'Clip properties' : 'Project properties'}</span>
        </div>
        {clip ? (
          <div className="flex items-center gap-0.5">
            <IconButton icon="copy" title="Duplicate clip" onClick={duplicate} />
            <IconButton
              icon="trash"
              title="Delete clip"
              tone="danger"
              onClick={() => {
                mutate((draft) => {
                  draft.clips = draft.clips.filter((entry) => entry.id !== clip.id)
                })
                selectClip(null)
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="scroll-area min-h-0 flex-1 px-3.5 py-3">
        {!clip ? (
          <div className="flex flex-col gap-4">
            <section>
              <SectionTitle>Composition</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Width">
                  <NumberInput value={project.width} min={320} max={7680} step={2} onChange={(width) => mutate((draft) => void (draft.width = Math.max(2, Math.round(width / 2) * 2)))} />
                </Field>
                <Field label="Height">
                  <NumberInput value={project.height} min={240} max={4320} step={2} onChange={(height) => mutate((draft) => void (draft.height = Math.max(2, Math.round(height / 2) * 2)))} />
                </Field>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Frame rate">
                  <Select
                    value={String(project.fps)}
                    onChange={(value) => mutate((draft) => void (draft.fps = Number(value)))}
                    options={[24, 25, 30, 50, 60, 120].map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
                  />
                </Field>
                <Field label="Background">
                  <input
                    type="color"
                    className="h-9 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
                    value={project.backgroundColor}
                    onChange={(event) => mutate((draft) => void (draft.backgroundColor = event.target.value))}
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Slider
                  label="Master volume"
                  min={0}
                  max={2}
                  value={project.masterVolume}
                  onChange={(value) => mutate((draft) => void (draft.masterVolume = value))}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
              </div>
            </section>

            <section>
              <SectionTitle>Cursor &amp; effects</SectionTitle>
              <EffectsEditor
                effects={project.cursor}
                onChange={(next) => mutate((draft) => void (draft.cursor = next))}
                events={project.events.length}
              />
            </section>

            <section className="rounded-xl border border-[var(--line)] bg-black/20 p-3">
              <div className="flex items-center gap-2 text-[0.72rem] text-[var(--text-1)]">
                <Icon name="info" size={13} className="text-sky-300" />
                Select a clip to edit it
              </div>
              <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--text-2)]">
                Trim, crop, speed, zoom, fades, transitions and text styling are all available per clip. Every change is saved in the project and applied
                during export.
              </p>
            </section>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <section>
              <SectionTitle right={<span className="text-[0.64rem] text-[var(--text-2)]">{track?.name}</span>}>Basics</SectionTitle>
              <Field label="Name">
                <TextInput value={clip.name} onChange={(name) => updateClip({ name })} />
              </Field>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Start (s)">
                  <NumberInput value={Number(clip.start.toFixed(2))} step={0.05} min={0} onChange={(start) => updateClip({ start: Math.max(0, start) })} />
                </Field>
                <Field label="Length (s)">
                  <NumberInput value={Number(clip.duration.toFixed(2))} step={0.05} min={0.1} onChange={(duration) => updateClip({ duration: Math.max(0.1, duration) })} />
                </Field>
              </div>
              {clip.kind !== 'text' && clip.kind !== 'image' ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="In point (s)">
                    <NumberInput value={Number(clip.inPoint.toFixed(2))} step={0.05} min={0} onChange={(inPoint) => updateClip({ inPoint: Math.max(0, inPoint) })} />
                  </Field>
                  <Field label="Speed">
                    <NumberInput value={clip.speed} step={0.05} min={0.1} max={8} suffix="×" onChange={(speed) => updateClip({ speed: clamp(speed, 0.1, 8) })} />
                  </Field>
                </div>
              ) : null}
            </section>

            {clip.kind === 'text' && clip.text ? (
              <section>
                <SectionTitle>Text</SectionTitle>
                <textarea
                  className="field min-h-[64px] resize-y"
                  value={clip.text.content}
                  onChange={(event) => updateText({ content: event.target.value })}
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Size">
                    <NumberInput value={clip.text.fontSize} min={8} max={400} onChange={(fontSize) => updateText({ fontSize })} />
                  </Field>
                  <Field label="Padding">
                    <NumberInput value={clip.text.padding} min={0} max={120} onChange={(padding) => updateText({ padding })} />
                  </Field>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Colour">
                    <input type="color" className="h-9 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-transparent" value={clip.text.color} onChange={(event) => updateText({ color: event.target.value })} />
                  </Field>
                  <Field label="Background">
                    <input
                      type="color"
                      className="h-9 w-full cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
                      value={normaliseColor(clip.text.background)}
                      onChange={(event) => {
                        const hex = event.target.value
                        updateText({ background: hexToRgba(hex, 0.65) })
                      }}
                    />
                  </Field>
                </div>
                <div className="mt-2">
                  <Segmented
                    value={clip.text.align}
                    onChange={(align) => updateText({ align })}
                    options={[
                      { value: 'left', label: 'Left' },
                      { value: 'center', label: 'Center' },
                      { value: 'right', label: 'Right' }
                    ]}
                  />
                </div>
                <div className="mt-1 grid grid-cols-2">
                  <Toggle label="Bold" checked={clip.text.bold} onChange={(bold) => updateText({ bold })} />
                  <Toggle label="Italic" checked={clip.text.italic} onChange={(italic) => updateText({ italic })} />
                </div>
                <Toggle label="Shadow" checked={clip.text.shadow} onChange={(shadow) => updateText({ shadow })} />
                <div className="mt-2 flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => {
                      updateText({ background: 'transparent' })
                    }}
                  >
                    No background
                  </Button>
                  <Button size="sm" onClick={() => updateClip({ transform: { ...clip.transform, x: 0, y: 0 } })}>
                    Centre
                  </Button>
                </div>
              </section>
            ) : null}

            {clip.kind === 'video' || clip.kind === 'image' ? (
              <>
                <section>
                  <SectionTitle>Transform</SectionTitle>
                  <Slider label="Zoom" min={1} max={2.5} value={clip.transform.scale} onChange={(scale) => updateClip({ transform: { ...clip.transform, scale } })} format={(value) => `${Math.round(value * 100)}%`} />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="Pan X">
                      <NumberInput value={clip.transform.x} step={0.01} min={-0.5} max={0.5} onChange={(x) => updateClip({ transform: { ...clip.transform, x: clamp(x, -0.5, 0.5) } })} />
                    </Field>
                    <Field label="Pan Y">
                      <NumberInput value={clip.transform.y} step={0.01} min={-0.5} max={0.5} onChange={(y) => updateClip({ transform: { ...clip.transform, y: clamp(y, -0.5, 0.5) } })} />
                    </Field>
                  </div>
                  <div className="mt-2">
                    <Slider
                      label="Opacity"
                      min={0}
                      max={1}
                      value={clip.transform.opacity}
                      onChange={(opacity) => updateClip({ transform: { ...clip.transform, opacity } })}
                      format={(value) => `${Math.round(value * 100)}%`}
                    />
                  </div>
                </section>

                <section>
                  <SectionTitle
                    right={
                      clip.crop ? (
                        <IconButton icon="close" title="Reset crop" onClick={() => updateClip({ crop: null })} />
                      ) : (
                        <IconButton icon="crop" title="Crop this clip" onClick={() => updateClip({ crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } })} />
                      )
                    }
                  >
                    Crop
                  </SectionTitle>
                  {clip.crop ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="X">
                        <NumberInput value={clip.crop.x} step={0.01} min={0} max={0.98} onChange={(x) => updateCrop({ x })} />
                      </Field>
                      <Field label="Y">
                        <NumberInput value={clip.crop.y} step={0.01} min={0} max={0.98} onChange={(y) => updateCrop({ y })} />
                      </Field>
                      <Field label="Width">
                        <NumberInput value={clip.crop.width} step={0.01} min={0.02} max={1} onChange={(width) => updateCrop({ width: clamp(width, 0.02, 1) })} />
                      </Field>
                      <Field label="Height">
                        <NumberInput value={clip.crop.height} step={0.01} min={0.02} max={1} onChange={(height) => updateCrop({ height: clamp(height, 0.02, 1) })} />
                      </Field>
                    </div>
                  ) : (
                    <p className="text-[0.68rem] text-[var(--text-2)]">Full frame. Crop to punch in on a region of the source.</p>
                  )}
                </section>

                <section>
                  <SectionTitle
                    right={
                      <Toggle
                        label=""
                        checked={Boolean(clip.zoom?.enabled)}
                        onChange={(enabled) =>
                          updateClip({ zoom: { enabled, amount: clip.zoom?.amount ?? 0.25, focus: clip.zoom?.focus ?? { x: 0.5, y: 0.5 }, ease: 'easeInOut', hold: clip.zoom?.hold ?? 0.6 } })
                        }
                      />
                    }
                  >
                    Zoom animation
                  </SectionTitle>
                  {clip.zoom?.enabled ? (
                    <div className="grid gap-2">
                      <Slider
                        label="Amount"
                        min={0.05}
                        max={1.5}
                        value={clip.zoom.amount}
                        onChange={(amount) => updateClip({ zoom: { ...clip.zoom!, amount } })}
                        format={(value) => `+${Math.round(value * 100)}%`}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Focus X">
                          <NumberInput value={clip.zoom.focus.x} step={0.01} min={0} max={1} onChange={(x) => updateClip({ zoom: { ...clip.zoom!, focus: { ...clip.zoom!.focus, x } } })} />
                        </Field>
                        <Field label="Focus Y">
                          <NumberInput value={clip.zoom.focus.y} step={0.01} min={0} max={1} onChange={(y) => updateClip({ zoom: { ...clip.zoom!, focus: { ...clip.zoom!.focus, y } } })} />
                        </Field>
                      </div>
                      <Slider
                        label="Hold"
                        min={0}
                        max={4}
                        step={0.05}
                        value={clip.zoom.hold}
                        onChange={(hold) => updateClip({ zoom: { ...clip.zoom!, hold } })}
                        format={(value) => `${value.toFixed(2)} s`}
                      />
                      <Select
                        value={clip.zoom.ease}
                        onChange={(ease) => updateClip({ zoom: { ...clip.zoom!, ease } })}
                        options={[
                          { value: 'easeInOut', label: 'Ease in / out' },
                          { value: 'linear', label: 'Linear' }
                        ]}
                      />
                    </div>
                  ) : (
                    <p className="text-[0.68rem] text-[var(--text-2)]">Add a smooth push-in around a focus point. Matches the exported render.</p>
                  )}
                </section>
                <section>
                  <SectionTitle>Animation</SectionTitle>
                  <div className="grid gap-2">
                    <Slider label="Fade in" min={0} max={Math.min(4, clip.duration / 2)} step={0.05} value={clip.fadeIn} onChange={(fadeIn) => updateClip({ fadeIn })} format={(value) => `${value.toFixed(2)} s`} />
                    <Slider label="Fade out" min={0} max={Math.min(4, clip.duration / 2)} step={0.05} value={clip.fadeOut} onChange={(fadeOut) => updateClip({ fadeOut })} format={(value) => `${value.toFixed(2)} s`} />
                    <Field label="Transition in">
                      <Select
                        value={clip.transitionIn?.type ?? 'none'}
                        onChange={(value) =>
                          updateClip({ transitionIn: value === 'none' ? null : { type: value as 'dissolve' | 'fade', duration: clip.transitionIn?.duration ?? 0.5 } })
                        }
                        options={[
                          { value: 'none', label: 'None' },
                          { value: 'dissolve', label: 'Dissolve' },
                          { value: 'fade', label: 'Fade' }
                        ]}
                      />
                    </Field>
                    {clip.transitionIn ? (
                      <Slider
                        label="Transition length"
                        min={0.1}
                        max={Math.min(3, clip.duration / 2)}
                        step={0.05}
                        value={clip.transitionIn.duration}
                        onChange={(duration) => updateClip({ transitionIn: { ...clip.transitionIn!, duration } })}
                        format={(value) => `${value.toFixed(2)} s`}
                      />
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}

            {clip.hasAudio ? (
              <section>
                <SectionTitle>Audio</SectionTitle>
                <Slider label="Volume" min={0} max={2} value={clip.volume} onChange={(volume) => updateClip({ volume })} format={(value) => `${Math.round(value * 100)}%`} />
                <div className="mt-2 grid gap-2">
                  <Slider label="Audio fade in" min={0} max={Math.min(4, clip.duration / 2)} step={0.05} value={clip.fadeIn} onChange={(fadeIn) => updateClip({ fadeIn })} format={(value) => `${value.toFixed(2)} s`} />
                  <Slider label="Audio fade out" min={0} max={Math.min(4, clip.duration / 2)} step={0.05} value={clip.fadeOut} onChange={(fadeOut) => updateClip({ fadeOut })} format={(value) => `${value.toFixed(2)} s`} />
                </div>
                <Toggle label="Mute clip" checked={clip.muted} onChange={(muted) => updateClip({ muted })} />
              </section>
            ) : null}

            {clip.kind === 'audio' ? (
              <section className="rounded-xl border border-[var(--line)] bg-black/20 p-3">
                <div className="flex items-center gap-2 text-[0.72rem] text-[var(--text-1)]">
                  <Icon name="music" size={13} className="text-emerald-300" />
                  Music / voiceover
                </div>
                <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--text-2)]">
                  Audio clips are mixed with microphone and system audio on export. Fades and volume here are applied sample-accurately by FFmpeg.
                </p>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  )
}

function EffectsEditor({ effects, onChange, events }: { effects: EffectsSettings; onChange: (next: EffectsSettings) => void; events: number }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 rounded-lg border border-[var(--line)] bg-black/20 px-2.5 py-1.5 text-[0.66rem] text-[var(--text-2)]">
        {events > 0 ? `${events.toLocaleString()} captured input events synced to the timeline` : 'No input events captured for this recording'}
      </div>
      <Toggle label="Enable effects" checked={effects.enabled} onChange={(enabled) => onChange({ ...effects, enabled })} />
      <Toggle label="Cursor highlight" checked={effects.cursorHighlight} onChange={(cursorHighlight) => onChange({ ...effects, cursorHighlight })} />
      <Toggle label="Click ripples" checked={effects.clickRipples} onChange={(clickRipples) => onChange({ ...effects, clickRipples })} />
      <Toggle label="Click sounds" checked={effects.clickSounds} onChange={(clickSounds) => onChange({ ...effects, clickSounds })} />
      <Toggle label="Keyboard sounds" checked={effects.keyboardSounds} onChange={(keyboardSounds) => onChange({ ...effects, keyboardSounds })} />
      <Toggle label="Smooth cursor" checked={effects.smoothCursor} onChange={(smoothCursor) => onChange({ ...effects, smoothCursor })} />
      <div className="mt-2 grid gap-2">
        <Select
          value={effects.pack}
          onChange={(pack) => onChange({ ...effects, pack })}
          options={[
            { value: 'soft', label: 'Sound pack · Soft' },
            { value: 'mechanical', label: 'Sound pack · Mechanical' },
            { value: 'crisp', label: 'Sound pack · Crisp' }
          ]}
        />
        <Slider label="Intensity" min={0} max={1} value={effects.intensity} onChange={(intensity) => onChange({ ...effects, intensity })} format={(value) => `${Math.round(value * 100)}%`} />
        <Slider label="Effect volume" min={0} max={1} value={effects.volume} onChange={(volume) => onChange({ ...effects, volume })} format={(value) => `${Math.round(value * 100)}%`} />
        <Slider label="Cursor size" min={10} max={64} step={1} value={effects.cursorSize} onChange={(cursorSize) => onChange({ ...effects, cursorSize })} format={(value) => `${Math.round(value)} px`} />
      </div>
    </div>
  )
}

function normaliseColor(value: string): string {
  if (value.startsWith('#')) return value
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return '#000000'
  const toHex = (part: string): string => Number(part).toString(16).padStart(2, '0')
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '')
  const int = Number.parseInt(cleaned, 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r},${g},${b},${alpha})`
}
