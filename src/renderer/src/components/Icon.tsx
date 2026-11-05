import type { SVGProps } from 'react'

export type IconName =
  | 'record'
  | 'stop'
  | 'pause'
  | 'play'
  | 'skip-start'
  | 'skip-end'
  | 'monitor'
  | 'window'
  | 'mic'
  | 'speaker'
  | 'camera'
  | 'folder'
  | 'film'
  | 'image'
  | 'settings'
  | 'sliders'
  | 'scissors'
  | 'undo'
  | 'redo'
  | 'save'
  | 'export'
  | 'trash'
  | 'plus'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'chevron-down'
  | 'chevron-right'
  | 'check'
  | 'clock'
  | 'sparkles'
  | 'cursor'
  | 'keyboard'
  | 'music'
  | 'text'
  | 'zoom-in'
  | 'zoom-out'
  | 'download'
  | 'refresh'
  | 'external'
  | 'copy'
  | 'pen'
  | 'square'
  | 'arrow'
  | 'layers'
  | 'lock'
  | 'eye'
  | 'volume'
  | 'alert'
  | 'info'
  | 'cpu'
  | 'gpu'
  | 'disk'
  | 'bolt'
  | 'wand'
  | 'move'
  | 'crop'
  | 'gauge'
  | 'shield'
  | 'expander'

const PATHS: Record<IconName, string> = {
  record: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z',
  stop: 'M7 7h10v10H7z',
  pause: 'M9 5v14M15 5v14',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  'skip-start': 'M18 5v14L7 12l11-7ZM6 5v14',
  'skip-end': 'M6 5v14l11-7L6 5ZM18 5v14',
  monitor: 'M3 5.5h18v10H3zM8 20h8M12 15.5V20',
  window: 'M3 6h18v12H3zM3 9.5h18',
  mic: 'M12 4a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 12 4ZM7 11.5a5 5 0 0 0 10 0M12 16.5V20',
  speaker: 'M4 10v4h3l4 3.5v-11L7 10H4ZM15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10',
  camera: 'M4 8h3l1.5-2h7L17 8h3v10H4zM12 12.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  folder: 'M3 7h6l2 2.5h10V19H3z',
  film: 'M3 5h18v14H3zM7 5v14M17 5v14M3 10h4M3 14h4M17 10h4M17 14h4',
  image: 'M3 5h18v14H3zM7 15l3.5-4 2.5 3 2-2.5 4 3.5',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3a8 8 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.9-1.7L14.2 2h-4l-.4 2.7A8 8 0 0 0 6.9 6.4l-2.3-1-2 3.4 2 1.5A8 8 0 0 0 4.4 12c0 .6.1 1.1.2 1.7l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.9 1.7l.4 2.7h4l.4-2.7a8 8 0 0 0 2.9-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7Z',
  sliders: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5M13 5v4M7 10v4M11 15v4',
  scissors: 'M6 6l12 12M6 18L18 6M8 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  undo: 'M9 7H5V3M5 7a8 8 0 1 1-1 8',
  redo: 'M15 7h4V3M19 7a8 8 0 1 0 1 8',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-6h8v6',
  export: 'M12 3v12M8 11l4 4 4-4M4 19h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  minimize: 'M5 12h14',
  maximize: 'M5 5h14v14H5z',
  restore: 'M8 8h11v11H8zM5 16V5h11',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  check: 'M5 13l4 4L19 7',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM18 15l.9 2.3 2.1.7-2.1.7L18 21l-.9-2.3-2.1-.7 2.1-.7L18 15Z',
  cursor: 'M6 3l12 8-5 1.5L11 19 6 3Z',
  keyboard: 'M3 7h18v10H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
  music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  text: 'M5 6V4h14v2M12 4v16M8 20h8',
  'zoom-in': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l5 5M8 11h6M11 8v6',
  'zoom-out': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l5 5M8 11h6',
  download: 'M12 4v11M8 11l4 4 4-4M4 20h16',
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  pen: 'M4 20l4-1 10-10-3-3L5 16l-1 4Z',
  square: 'M4 4h16v16H4z',
  arrow: 'M4 20L20 4M20 4h-7M20 4v7',
  layers: 'M12 3l9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  eye: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  volume: 'M4 10v4h3l4 3.5v-11L7 10H4ZM15 9.5a4 4 0 0 1 0 5',
  alert: 'M12 4l9 16H3L12 4ZM12 10v4M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 8h.01',
  cpu: 'M7 7h10v10H7zM4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3',
  gpu: 'M3 7h18v10H3zM7 11h4M7 14h4M15 11h3v3h-3z',
  disk: 'M3 6h18v12H3zM7 15h.01M11 15h6',
  bolt: 'M13 3L5 14h5l-1 7 8-11h-5l1-7Z',
  wand: 'M5 19L16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM5 9l.7 1.3L7 11l-1.3.7L5 13l-.7-1.3L3 11l1.3-.7L5 9Z',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  crop: 'M6 3v14a1 1 0 0 0 1 1h14M3 6h14a1 1 0 0 1 1 1v14',
  gauge: 'M12 13l4-4M4 18a9 9 0 1 1 16 0',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4',
  expander: 'M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5'
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  filled?: boolean
}

export function Icon({ name, size = 18, filled = false, ...rest }: IconProps): JSX.Element {
  const isFilled = filled || name === 'record' || name === 'play' || name === 'stop'
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={isFilled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
