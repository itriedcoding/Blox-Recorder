/**
 * Offscreen overlay rasteriser used by the export pipeline.
 *
 * This window never shows anything: it receives a project, draws the text layer
 * and the cursor/click effects frame by frame with the exact drawing code used
 * by the editor preview, and streams transparent PNG frames back to the main
 * process where FFmpeg composites them over the encoded video.
 */
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { buildEffectTimeline, cursorAt } from '@shared/effect-timeline'
import { drawFx, drawTextClips } from './engine/fx'

function OverlayRenderer(): null {
  const busy = useRef(false)

  useEffect(() => {
    const unsubscribe = window.api.overlay.onStart((payload) => {
      if (busy.current) return
      busy.current = true
      void (async () => {
        const { project, settings, frameCount, fps } = payload
        const width = Math.max(2, settings.width)
        const height = Math.max(2, settings.height)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        document.body.appendChild(canvas)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          await window.api.overlay.done()
          return
        }
        const timeline = buildEffectTimeline(project)
        const cursorEnabled = settings.includeEffects && project.cursor.enabled && !timeline.empty

        for (let index = 0; index < frameCount; index++) {
          const time = index / fps
          ctx.clearRect(0, 0, width, height)
          drawTextClips(ctx, project, time, width, height)
          if (cursorEnabled) {
            const cursor = cursorAt(timeline, time, project.cursor.smoothCursor)
            drawFx(ctx, {
              width,
              height,
              scale: height / Math.max(1, project.height) * (project.height / 1080),
              time,
              settings: project.cursor,
              cursor,
              clicks: timeline.clicks,
              keys: timeline.keys
            })
          }
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'))
          if (!blob) continue
          const data = await blob.arrayBuffer()
          await window.api.overlay.sendFrame(index, data)
          if (index % 4 === 0 || index === frameCount - 1) window.api.overlay.reportProgress(index + 1, frameCount)
        }
        await window.api.overlay.done()
      })()
    })
    return unsubscribe
  }, [])

  return null
}

const container = document.getElementById('overlay-root') ?? document.body
const mount = document.createElement('div')
container.appendChild(mount)
createRoot(mount).render(<OverlayRenderer />)
