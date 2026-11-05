# SkyRec Studio — architecture

SkyRec Studio is an Electron application: a hardened main process that owns all
privileged work (capture negotiation, disk I/O, FFmpeg, input hooks, window
management) and a sandboxed React renderer that owns the UI, the canvas
compositor and the timeline. They talk over a typed IPC bridge exposed by
`src/preload/index.ts`; nothing else is exposed to the page.

```
┌──────────────────────── main process (Node, full privileges) ────────────────────────┐
│  recorder.ts    session lifecycle, countdown, pause/resume, chunk writer, recovery   │
│  capture-state.ts  stages the chosen desktopCapturer source for getDisplayMedia      │
│  input.ts       uiohook-napi global mouse/keyboard sampler (consent-gated)           │
│  exporter.ts    export queue, overlay-frame window, FFmpeg process + progress        │
│  ffmpeg.ts      binary resolution, encoder detection, probe, thumbs, waveform        │
│  projects.ts    project CRUD, autosave, crash-recovery snapshots                     │
│  library.ts / screenshots.ts / settings.ts / shortcuts.ts / system.ts / logger.ts    │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                        │  contextBridge "api" (typed, allow-listed)
┌───────────────────────────────────────┴─────────────────────────────────────────────┐
│  renderer (React + Zustand)                                                          │
│  engine/capture.ts   getDisplayMedia → canvas compositor → MediaRecorder → IPC chunks│
│  engine/preview.ts   the project's playback engine (video/audio graphs + FX drawing)  │
│  engine/fx.ts        cursor, click ripple, keystroke bubble and zoom math            │
│  overlay.tsx         off-screen window that rasterises FX frames to transparent PNGs  │
│  Timeline / Inspector / ExportDialog / pages/*                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Recording pipeline

1. `system:sources` enumerates real `desktopCapturer` sources (screens and windows
   with thumbnails); monitors come from `screen.getAllDisplays()`.
2. `recorder:start` creates a session directory under
   `<recordings>/.sessions/<id>/`, starts the countdown, and stages the chosen
   source. `setDisplayMediaRequestHandler` hands the renderer exactly that source
   (plus Windows loopback audio when system audio is enabled), so the user gets no
   second picker and cannot be tricked into capturing another display.
3. The renderer calls `getDisplayMedia({ video, audio })`, builds the capture
   graph in `engine/capture.ts`, and draws every frame into a canvas at the target
   resolution: cover-fit/crop for regions, webcam bubble compositing, cursor
   highlight, click ripples and keystroke bubbles are all drawn there — so what
   you see on screen while recording is what lands in the file.
4. `MediaRecorder` (VP9/VP8 WebM, hardware assisted by Chromium) emits ~1 s
   chunks that are streamed over IPC and appended to `raw.webm` in order. The main
   process counts dropped frames reported by the renderer.
5. On stop, FFmpeg transcodes `raw.webm` → `output.mp4|mkv` with the selected
   hardware encoder (NVENC / QSV / AMF / libx264), and the input-event log is
   written next to it. The project is created automatically and opened in the
   editor. If the transcode fails, the raw file is kept and the error is surfaced.

Crash safety: sessions are marked `recording` on disk. On the next launch the
recovery panel lists them, and the raw WebM is remuxed into a playable MP4
without re-encoding.

## Effects pipeline

`input.ts` samples global mouse moves and clicks (60 Hz throttle) and keystrokes
as **normalised coordinates plus a coarse key id only** — never key text, never
window titles. Consent must be granted in Settings, capture only runs while a
recording is active, and the log is stored in the project file.

`shared/effect-timeline.ts` turns that log into timeline cues (clicks, keys,
smoothed cursor path), `shared/effects-audio.ts` synthesises every sound
procedurally (no sample files, identical bytes in preview and export), and
`engine/fx.ts` draws the visuals. Because both preview and export call the same
functions, effects line up frame-accurately in the editor and in the MP4.

## Export pipeline

1. `exporter.ts` creates a hidden `overlay.html` window and hands it the project
   plus the output geometry. The window renders one transparent PNG per frame
   (cursor, ripples, keystrokes, text clips) and streams them back over IPC.
2. `shared/filtergraph.ts` compiles the project into a single FFmpeg
   `filter_complex`: trim/setpts/fps per clip, cover-fit scale + per-frame zoom
   (animated `scale` with `eval=frame` feeding a fixed-size `crop`), fades,
   dissolve transitions, track compositing, audio trim/atempo/volume/afades/
   adelay/amix/alimiter, denoise (`afftdn`) and the effect WAV.
3. FFmpeg runs with `-progress pipe:1`; the exporter parses `out_time_us` into
   real percentage, ETA and speed, and the queue reports it to the UI. Cancelling
   kills the process and removes the partial file.

The overlay pass is skipped automatically when the project has no effects and no
text clips, and the effect track is skipped when the mix would be silent.

## Storage

| Path | Contents |
| --- | --- |
| `%USERPROFILE%\Videos\SkyRec` | recordings (`*.mp4`/`*.mkv`), `Screenshots\`, `.sessions\` |
| `%APPDATA%\skyrec\projects` | `*.skyrec.json` projects and `*.autosave.json` |
| `%APPDATA%\skyrec\settings.json` | all settings and shortcuts |
| `%APPDATA%\skyrec\presets.json` | recording presets |
| `%APPDATA%\skyrec\logs` | rotating logs (`main.log`) |
| `%APPDATA%\skyrec\cache` | thumbnails |

Directories are user-configurable in Settings. Projects are plain JSON, so they
are portable and diff-able.

## Privacy model

- Global input capture is off until the user grants explicit consent, and the
  consent flag is visible in Settings next to the availability state.
- Only pointer position, button, and a numeric key id are stored — no text, no
  clipboard, no window titles.
- Screen capture is always initiated by the user through `desktopCapturer`; the
  app never captures silently, and there is no background process doing so.
- The renderer is sandboxed (`contextIsolation`, `nodeIntegration: false`), all
  file access is mediated by the main process, and media is served through a
  registered `media://` protocol with range-request support.

## Testing

`npm test` runs Vitest:

- `tests/filtergraph.test.ts` — graph compilation (tracks, fades, zoom, mixing).
- `tests/timeline-ops.test.ts` — split/trim/subtract/ripple-delete maths.
- `tests/effects-audio.test.ts` — cue placement, WAV encoding, timeline mapping.
- `tests/export-pipeline.test.ts` — generates real media with the bundled
  FFmpeg, builds the graph, renders and ffprobes the result (the same code path
  the app uses, so a regression in the graph fails CI).
