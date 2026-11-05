# Known limitations

Everything listed here is a deliberate, documented gap. Nothing in the app
pretends to do something it does not: if a capability is missing, its control is
absent rather than decorative.

## Platform

1. **Windows-only capture.** Recording relies on Chromium's `getDisplayMedia`
   with Windows loopback audio. The macOS/Linux targets in
   `electron-builder.yml` are packaging targets only; capture is not supported
   or tested there. The editor, export engine, filter graph and effect synthesis
   are platform independent and are tested on Linux in CI.
2. **The installer is not code-signed.** No certificate is available to the
   project, so SmartScreen reports an unknown publisher on first launch. Windows
   Defender may also warn about `uiohook-napi` (a native global-input hook), just
   as it does for OBS plugins and other macro utilities.

## Recording

3. **System audio depends on the driver stack.** Windows loopback capture is
   provided by Chromium; apps that mark their audio output as protected (some
   DRM players) will not be captured.
4. **Global input capture needs the native hook.** `uiohook-napi` is an
   `optionalDependency`. If your security software blocks it, the app still
   records video and audio, but no click/keystroke effects can be collected; the
   UI states the reason instead of silently producing nothing.
5. **4K / 120 fps is hardware dependent.** The compositor and the WebM encoder
   run on the GPU where possible; the drop-frame counter and the CPU readout show
   when a machine cannot keep up. No frame rate is faked.
6. **Keystroke visualisation is aggregate.** Only a numeric key id is recorded, so
   the overlay can show "a key was pressed" with a generic bubble. Per-key
   characters are intentionally never stored (privacy).

## Effects

7. **Three built-in sound packs, no import.** Click and typing sounds are
   synthesised at runtime (`soft`, `mechanical`, `crisp`). Importing external
   `.wav` sample packs is not implemented; when it is, it belongs in
   `shared/effects-audio.ts` so preview and export stay identical.
8. **Cursor motion cannot be invented.** Effects follow the recorded event log.
   You can change intensity, colours, sounds, smoothing, zoom and pack, and remove
   effects, but you cannot draw new pointer paths where none were captured.

## Editor

9. **In-editor voiceover recording is not implemented.** Microphone audio is
   captured with the screen recording (and can be trimmed, mixed and faded). To
   add narration after the fact, record it separately and import it as an audio
   clip on the Music track.
10. **Webcam background removal / blur is not implemented.** Real background blur
    needs a person-segmentation model; shipping a fake blur (blurring the subject
    too) would be dishonest, so no control is shown. The webcam bubble itself
    supports position, size, shape, mirroring and offsets.
11. **Transitions are limited to dissolve and fade.** Both are implemented
    identically in the preview and in the FFmpeg graph; no transition is offered
    that only works in one of them.
12. **Zoom animation is a keyframed crop, not a camera rig.** Per-clip zoom eases
    in to a focus point, holds, and eases back. Arbitrary multi-keyframe camera
    paths are not supported.
13. **Text styling is a fixed set** (family, size, colour, background, alignment,
    bold, italic, shadow). Rich text, per-word animation and custom font loading
    from disk are not implemented.

## Export

14. **Hardware encoders are used when present.** NVENC, QSV and AMF are detected
    at runtime; if none is available the app falls back to `libx264` and says so.
    Detection is a real encoder probe, not a static list.
15. **Effect frames are rendered by the app, then composited.** The overlay pass
    rasterises one PNG per frame in a hidden window; very long timelines with
    effects enabled take proportionally longer to prepare. Projects without
    effects or text skip the pass entirely.
16. **One video stream per track position.** The graph composites tracks by
    stacking overlays; there is no nested sequence/composition model.

## Documentation

17. **No UI screenshots are committed.** The build environment for this
    repository has no display server, so Electron cannot render its window there.
    Rather than fabricate images, the README documents the UI in text and explains
    how to capture screenshots on Windows (`npm run dev`, then Win+Shift+S).
18. **The Windows installer was produced by CI, not hand-run here.** The
    workflow builds it on `windows-latest` and fails if no `.exe` is produced, but
    this environment cannot execute a Windows binary, so first-launch behaviour on
    a real desktop must be confirmed on Windows.
19. **The packaged self-test covers startup, not capture.** `--self-test` proves
    that the released executable launches, shows its window, mounts the renderer
    and exposes the preload bridge. Screen capture, the loopback audio device and
    the native input hook still require an interactive desktop session and are not
    exercised by it.
