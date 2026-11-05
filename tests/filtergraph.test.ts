import { describe, expect, it } from 'vitest'
import { atempoChain, buildExportPlan, X264_FALLBACK } from '@shared/filtergraph'
import { createProject, defaultClip, defaultEffects } from '@shared/defaults'
import type { ExportSettings } from '@shared/types'

function buildProject() {
  const project = createProject('Filtergraph test', 640, 360, 30)
  project.events = [
    { t: 200, type: 'move', x: 0.2, y: 0.3 },
    { t: 400, type: 'down', x: 0.25, y: 0.35, button: 1 },
    { t: 900, type: 'down', x: 0.4, y: 0.4, keyId: 30 }
  ]
  project.clips = [
    defaultClip('video', 'track-video-1', {
      id: 'clipA',
      sourcePath: 'C:/media/source-a.mp4',
      start: 0,
      duration: 2,
      inPoint: 0.5,
      hasAudio: true,
      speed: 1
    }),
    defaultClip('video', 'track-overlay', {
      id: 'clipB',
      sourcePath: 'C:/media/overlay.png',
      kind: 'image',
      start: 1,
      duration: 1.5,
      hasAudio: false,
      fadeIn: 0.3,
      transitionIn: { type: 'dissolve', duration: 0.4 },
      zoom: { enabled: true, amount: 0.3, focus: { x: 0.5, y: 0.5 }, ease: 'easeInOut', hold: 0.4 }
    }),
    defaultClip('text', 'track-text', {
      id: 'text1',
      name: 'Title',
      text: {
        content: 'Hello SkyRec',
        fontFamily: 'sans-serif',
        fontSize: 42,
        color: '#ffffff',
        background: 'transparent',
        padding: 8,
        align: 'center',
        bold: true,
        italic: false,
        shadow: true
      }
    }),
    defaultClip('audio', 'track-music', {
      id: 'music',
      sourcePath: 'C:/media/music.mp3',
      start: 0.4,
      duration: 2.5,
      volume: 0.6,
      fadeIn: 0.5
    })
  ]
  project.cursor = { ...defaultEffects(), clickSounds: true, keyboardSounds: true }
  project.duration = 2.5
  return project
}

const settings: ExportSettings = {
  format: 'mp4',
  width: 640,
  height: 360,
  fps: 30,
  bitrateMbps: 6,
  audioBitrateKbps: 160,
  encoder: 'auto',
  denoise: true,
  includeEffects: true
}

describe('buildExportPlan', () => {
  const project = buildProject()
  const plan = buildExportPlan({
    project,
    settings,
    encoder: X264_FALLBACK,
    effectsWavPath: 'C:/temp/fx.wav',
    overlayPattern: 'C:/temp/overlay/%06d.png',
    outputPath: 'C:/out/final.mp4'
  })

  it('registers each unique media source once', () => {
    expect(plan.inputs).toEqual([
      'C:/media/source-a.mp4',
      'C:/media/overlay.png',
      'C:/media/music.mp3',
      'C:/temp/fx.wav',
      'C:/temp/overlay/%06d.png'
    ])
  })

  it('trims, speeds and time-shifts video clips', () => {
    expect(plan.filter).toContain('[0:v]trim=start=0.5:end=2.5,setpts=(PTS-STARTPTS)/1')
    expect(plan.filter).toContain('tpad=start_mode=add:start_duration=1')
    expect(plan.filter).toContain('tpad=stop_mode=add:stop_duration=')
  })

  it('applies fades, alpha transitions and zoom expressions', () => {
    expect(plan.filter).toContain('fade=t=in:st=0:d=0.4:alpha=1')
    expect(plan.filter).toContain('scale=w=640:h=360:force_original_aspect_ratio=increase')
    expect(plan.filter).toContain("scale=w='trunc(640*(")
    expect(plan.filter).toContain(':eval=frame')
    expect(plan.filter).toContain('if(lt(t,')
  })

  it('mixes all audio sources including the effect track', () => {
    expect(plan.filter).toContain('atrim=start=0.5:end=2.5')
    expect(plan.filter).toContain('adelay=delays=400:all=1')
    expect(plan.filter).toContain('afftdn=nf=-28:tn=1')
    expect(plan.filter).toContain('amix=inputs=3:normalize=0')
    expect(plan.hasAudio).toBe(true)
  })

  it('composites tracks in order and overlays the effect frames', () => {
    expect(plan.filter).toContain('color=c=0x05070b:s=640x360:r=30')
    expect(plan.filter.indexOf('[vclipA]')).toBeLessThan(plan.filter.indexOf('[vclipB]'))
    expect(plan.filter).toContain('overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto')
    expect(plan.hasOverlay).toBe(true)
    expect(plan.args.join(' ')).toContain('-framerate 30 -i C:/temp/overlay/%06d.png')
  })

  it('encodes to the requested container with faststart and a hard duration', () => {
    expect(plan.args).toEqual(expect.arrayContaining(['-c:v', 'libx264']))
    expect(plan.args).toEqual(expect.arrayContaining(['-c:a', 'aac']))
    expect(plan.args).toEqual(expect.arrayContaining(['-movflags', '+faststart']))
    expect(plan.args[plan.args.length - 1]).toBe('C:/out/final.mp4')
    expect(plan.duration).toBeGreaterThanOrEqual(2.5)
  })

  it('uses VP9/Opus without hardware encoders for webm', () => {
    const webm = buildExportPlan({
      project,
      settings: { ...settings, format: 'webm' },
      encoder: { videoCodec: 'libvpx-vp9', audioCodec: 'libopus', args: [], label: 'VP9' },
      effectsWavPath: null,
      overlayPattern: null,
      outputPath: 'C:/out/final.webm'
    })
    expect(webm.args).toEqual(expect.arrayContaining(['-c:v', 'libvpx-vp9']))
    expect(webm.args).toEqual(expect.arrayContaining(['-c:a', 'libopus']))
    expect(webm.filter).not.toContain('[afx]')
  })

  it('honours muted tracks and disabled effects', () => {
    const muted = structuredClone(project)
    muted.tracks = muted.tracks.map((track) => (track.id === 'track-music' ? { ...track, muted: true } : track))
    muted.cursor = { ...muted.cursor, enabled: false }
    const planMuted = buildExportPlan({
      project: muted,
      settings,
      encoder: X264_FALLBACK,
      effectsWavPath: 'C:/temp/fx.wav',
      overlayPattern: null,
      outputPath: 'C:/out/x.mp4'
    })
    expect(planMuted.filter).not.toContain('[afx]')
    expect(planMuted.filter).not.toContain('[amusic]')
  })
})

describe('atempoChain', () => {
  it('chains atempo filters inside the allowed 0.5-2 range', () => {
    expect(atempoChain(1)).toBe('anull')
    expect(atempoChain(2)).toBe('atempo=2')
    expect(atempoChain(4.5)).toBe('atempo=2,atempo=2,atempo=1.125')
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.5')
  })
})
