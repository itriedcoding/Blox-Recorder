import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureSource, ScreenshotEntry, ScreenshotResult } from '@shared/types'
import { formatBytes } from '@shared/time'
import { useStore } from '../state/store'
import { Badge, Button, EmptyState, IconButton, Modal, SectionTitle, Segmented, Spinner } from '../components/ui'
import { Icon } from '../components/Icon'

export function ScreenshotsPage(): JSX.Element {
  const pushToast = useStore((state) => state.pushToast)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [entries, setEntries] = useState<ScreenshotEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [annotate, setAnnotate] = useState<ScreenshotResult | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextSources, nextEntries] = await Promise.all([window.api.system.sources(['screen', 'window']), window.api.screenshots.list()])
      setSources(nextSources)
      setEntries(nextEntries)
      setSourceId((current) => current ?? nextSources.find((source) => source.kind === 'screen')?.id ?? nextSources[0]?.id ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const capture = async (): Promise<void> => {
    const source = sources.find((entry) => entry.id === sourceId)
    if (!source) {
      pushToast('error', 'Pick a display or window first')
      return
    }
    setBusy(true)
    try {
      const shot = await window.api.screenshots.capture({ sourceId: source.id, sourceWidth: source.width, sourceHeight: source.height })
      setAnnotate(shot)
      setEntries(await window.api.screenshots.list())
      pushToast('success', 'Screenshot captured', shot.path)
    } catch (error) {
      pushToast('error', 'Screenshot failed', (error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
        <div>
          <h1 className="text-[1.02rem] font-semibold tracking-tight">Screenshots</h1>
          <p className="mt-0.5 text-[0.74rem] text-[var(--text-2)]">Capture, annotate and archive stills without leaving the app</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceId ?? ''}
            onChange={(event) => setSourceId(event.target.value)}
            className="field max-w-[240px] appearance-none"
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id} className="bg-[#0d131c]">
                {source.kind === 'screen' ? '🖥 ' : '🪟 '}
                {source.name}
              </option>
            ))}
          </select>
          <Button variant="primary" icon="camera" onClick={() => void capture()} disabled={busy || !sourceId}>
            {busy ? 'Capturing…' : 'Capture'}
          </Button>
          <IconButton icon="refresh" title="Refresh" onClick={() => void refresh()} />
        </div>
      </div>

      <div className="scroll-area min-h-0 flex-1 px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-[0.78rem] text-[var(--text-2)]">
            <Spinner size={13} /> Loading screenshots…
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon="image" title="No screenshots yet" description="Capture the selected display or window. Screenshots are saved as PNG in your SkyRec/Screenshots folder." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {entries.map((entry) => (
              <div key={entry.path} className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-[rgba(10,15,22,0.7)] transition hover:border-sky-400/30">
                <button type="button" className="block w-full" onClick={() => setAnnotate({ path: entry.path, width: entry.width, height: entry.height, dataUrl: window.api.app.mediaUrl(entry.path) })}>
                  <div className="aspect-video w-full overflow-hidden bg-black/50">
                    <img src={window.api.app.mediaUrl(entry.path)} alt={entry.name} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
                  </div>
                </button>
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[0.74rem] text-[var(--text-0)]">{entry.name}</div>
                    <div className="text-[0.62rem] text-[var(--text-2)]">
                      {entry.width}×{entry.height} · {formatBytes(entry.sizeBytes)} · {new Date(entry.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton icon="external" title="Open file" onClick={() => void window.api.app.openPath(entry.path)} />
                    <IconButton
                      icon="trash"
                      title="Delete screenshot"
                      tone="danger"
                      onClick={() => {
                        void window.api.screenshots.remove(entry.path).then(async () => {
                          setEntries(await window.api.screenshots.list())
                          pushToast('info', 'Screenshot deleted')
                        })
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {annotate ? (
        <Annotator
          shot={annotate}
          onClose={() => setAnnotate(null)}
          onSaved={async () => {
            setEntries(await window.api.screenshots.list())
            setAnnotate(null)
            pushToast('success', 'Annotated screenshot saved')
          }}
        />
      ) : null}
    </div>
  )
}

type Shape =
  | { type: 'pen'; color: string; width: number; points: { x: number; y: number }[] }
  | { type: 'rect'; color: string; width: number; x: number; y: number; w: number; h: number }
  | { type: 'arrow'; color: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'text'; color: string; size: number; x: number; y: number; text: string }

function Annotator({ shot, onClose, onSaved }: { shot: ScreenshotResult; onClose: () => void; onSaved: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [ready, setReady] = useState(false)
  const [tool, setTool] = useState<'pen' | 'rect' | 'arrow' | 'text'>('pen')
  const [color, setColor] = useState('#22bcff')
  const [lineWidth, setLineWidth] = useState(4)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      imageRef.current = image
      setReady(true)
    }
    image.onerror = () => setError('The screenshot could not be loaded')
    image.src = shot.dataUrl
  }, [shot.dataUrl])

  const drawShapes = useCallback(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)
    const all = draft ? [...shapes, draft] : shapes
    for (const shape of all) {
      ctx.strokeStyle = shape.color
      ctx.fillStyle = shape.color
      ctx.lineWidth = 'width' in shape ? shape.width : 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (shape.type === 'pen') {
        ctx.beginPath()
        shape.points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y)
          else ctx.lineTo(point.x, point.y)
        })
        ctx.stroke()
      } else if (shape.type === 'rect') {
        ctx.strokeRect(shape.x, shape.y, shape.w, shape.h)
      } else if (shape.type === 'arrow') {
        const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
        const head = Math.max(10, shape.width * 3.2)
        ctx.beginPath()
        ctx.moveTo(shape.x1, shape.y1)
        ctx.lineTo(shape.x2, shape.y2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(shape.x2, shape.y2)
        ctx.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 7), shape.y2 - head * Math.sin(angle - Math.PI / 7))
        ctx.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 7), shape.y2 - head * Math.sin(angle + Math.PI / 7))
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.font = `600 ${shape.size}px 'Inter','Segoe UI',sans-serif`
        const metrics = ctx.measureText(shape.text)
        ctx.fillStyle = 'rgba(4,10,18,0.62)'
        ctx.fillRect(shape.x - 6, shape.y - shape.size, metrics.width + 12, shape.size * 1.35)
        ctx.fillStyle = shape.color
        ctx.fillText(shape.text, shape.x, shape.y)
      }
    }
  }, [draft, shapes])

  useEffect(() => {
    if (ready) drawShapes()
  }, [ready, drawShapes])

  const toCanvas = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    }
  }

  const startShape = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = toCanvas(event)
    if (tool === 'text') {
      setTextInput({ x: point.x, y: point.y, value: '' })
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pen') setDraft({ type: 'pen', color, width: lineWidth, points: [point] })
    if (tool === 'rect') setDraft({ type: 'rect', color, width: lineWidth, x: point.x, y: point.y, w: 0, h: 0 })
    if (tool === 'arrow') setDraft({ type: 'arrow', color, width: lineWidth, x1: point.x, y1: point.y, x2: point.x, y2: point.y })
  }

  const moveShape = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!draft) return
    const point = toCanvas(event)
    if (draft.type === 'pen') setDraft({ ...draft, points: [...draft.points, point] })
    if (draft.type === 'rect') setDraft({ ...draft, w: point.x - draft.x, h: point.y - draft.y })
    if (draft.type === 'arrow') setDraft({ ...draft, x2: point.x, y2: point.y })
  }

  const endShape = (): void => {
    if (!draft) return
    if (draft.type === 'pen' && draft.points.length > 1) setShapes((current) => [...current, draft])
    if (draft.type === 'rect' && Math.abs(draft.w) > 3 && Math.abs(draft.h) > 3) setShapes((current) => [...current, draft])
    if (draft.type === 'arrow' && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 6) setShapes((current) => [...current, draft])
    setDraft(null)
  }

  const exportCanvas = (): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvas.toDataURL('image/png')
  }

  const save = async (): Promise<void> => {
    const dataUrl = exportCanvas()
    if (!dataUrl) return
    setSaving(true)
    try {
      await window.api.screenshots.save(dataUrl, `Annotated_${Date.now()}`)
      onSaved()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Annotate screenshot"
      subtitle={`${shot.width}×${shot.height} · saved as PNG in your SkyRec folder`}
      width="max-w-5xl"
      footer={
        <>
          <Button
            onClick={() => {
              const dataUrl = exportCanvas()
              if (!dataUrl) return
              void window.api.screenshots.copy(dataUrl).then(() => pushCopied())
            }}
            icon="copy"
          >
            Copy
          </Button>
          <Button onClick={() => setShapes([])} icon="undo">
            Clear all
          </Button>
          <Button variant="primary" icon="save" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save annotation'}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={tool}
          onChange={setTool}
          options={[
            { value: 'pen', label: 'Pen', icon: 'pen' },
            { value: 'rect', label: 'Box', icon: 'square' },
            { value: 'arrow', label: 'Arrow', icon: 'arrow' },
            { value: 'text', label: 'Text', icon: 'text' }
          ]}
        />
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-8 w-10 cursor-pointer rounded border border-[var(--line)] bg-transparent" />
        <div className="flex items-center gap-2">
          <span className="text-[0.68rem] text-[var(--text-2)]">Width</span>
          <input type="range" min={1} max={18} value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} className="range w-[100px]" />
          <span className="font-mono text-[0.68rem] text-[var(--text-1)]">{lineWidth}</span>
        </div>
        <Button size="sm" icon="undo" onClick={() => setShapes((current) => current.slice(0, -1))} disabled={!shapes.length}>
          Undo
        </Button>
        <Badge tone="neutral">
          <Icon name="pen" size={10} /> {shapes.length} marks
        </Badge>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-black">
        <canvas
          ref={canvasRef}
          className="block max-h-[62vh] w-full cursor-crosshair object-contain"
          onPointerDown={startShape}
          onPointerMove={moveShape}
          onPointerUp={endShape}
          onPointerCancel={endShape}
        />
        {textInput ? (
          <div className="absolute inset-0 flex items-start justify-center bg-black/40 p-6" onClick={() => setTextInput(null)}>
            <div className="w-[320px] rounded-xl border border-[var(--line-strong)] bg-[var(--bg-2)] p-3" onClick={(event) => event.stopPropagation()}>
              <SectionTitle>Add text</SectionTitle>
              <input
                autoFocus
                value={textInput.value}
                onChange={(event) => setTextInput({ ...textInput, value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && textInput.value.trim()) {
                    setShapes((current) => [
                      ...current,
                      { type: 'text', color, size: Math.max(18, Math.round((canvasRef.current?.height ?? 1080) * 0.028)), x: textInput.x, y: textInput.y, text: textInput.value }
                    ])
                    setTextInput(null)
                  }
                  if (event.key === 'Escape') setTextInput(null)
                }}
                className="field"
                placeholder="Type, then press Enter"
              />
            </div>
          </div>
        ) : null}
        {!ready && !error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Spinner size={18} />
          </div>
        ) : null}
      </div>
      {error ? <div className="mt-2 text-[0.72rem] text-red-300">{error}</div> : null}
    </Modal>
  )
}

function pushCopied(): void {
  useStore.getState().pushToast('success', 'Copied to clipboard', 'The annotated image is ready to paste anywhere.')
}
