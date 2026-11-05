import type { ChangeEvent, ReactNode } from 'react'
import { useEffect } from 'react'
import { Icon, type IconName } from './Icon'

export function Button({
  children,
  onClick,
  variant = 'ghost',
  icon,
  disabled,
  size = 'md',
  title,
  type = 'button',
  className = ''
}: {
  children?: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger' | 'plain'
  icon?: IconName
  disabled?: boolean
  size?: 'sm' | 'md'
  title?: string
  type?: 'button' | 'submit'
  className?: string
}): JSX.Element {
  const variantClass = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'plain' ? '' : 'btn-ghost'
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`btn ${variantClass} ${size === 'sm' ? 'px-2.5 py-1.5 text-[0.75rem]' : ''} ${className}`}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  onClick,
  title,
  active = false,
  disabled = false,
  size = 18,
  tone = 'default',
  className = ''
}: {
  icon: IconName
  onClick?: () => void
  title: string
  active?: boolean
  disabled?: boolean
  size?: number
  tone?: 'default' | 'danger'
  className?: string
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`icon-btn ${active ? 'bg-[rgba(34,188,255,0.16)] text-sky-300' : ''} ${
        tone === 'danger' ? 'hover:bg-[rgba(255,92,122,0.16)] hover:text-[#ffb3c1]' : ''
      } ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer select-none group">
      <span className="min-w-0">
        <span className="block text-[0.82rem] text-[var(--text-0)]">{label}</span>
        {hint ? <span className="block text-[0.7rem] text-[var(--text-2)] mt-0.5">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[22px] w-[40px] rounded-full transition-colors duration-200 shrink-0 ${
          checked ? 'bg-sky-500' : 'bg-[rgba(148,176,210,0.24)]'
        }`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${
            checked ? 'left-[21px]' : 'left-[3px]'
          }`}
        />
      </button>
    </label>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  label,
  format,
  disabled
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  label: string
  format?: (value: number) => string
  disabled?: boolean
}): JSX.Element {
  return (
    <div className={disabled ? 'opacity-45 pointer-events-none' : ''}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[0.72rem] uppercase tracking-[0.08em] text-[var(--text-2)] font-semibold">{label}</span>
        <span className="text-[0.72rem] font-mono text-[var(--text-1)]">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        className="range w-full"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-[0.72rem] uppercase tracking-[0.08em] text-[var(--text-2)] font-semibold mb-1.5">{label}</span>
      {children}
      {hint ? <span className="block text-[0.68rem] text-[var(--text-2)] mt-1">{hint}</span> : null}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  onBlur
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
  onBlur?: () => void
}): JSX.Element {
  return (
    <input
      className={`field ${mono ? 'font-mono text-[0.75rem]' : ''}`}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}): JSX.Element {
  return (
    <div className="relative">
      <input
        type="number"
        className="field pr-10"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
      {suffix ? <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.68rem] text-[var(--text-2)]">{suffix}</span> : null}
    </div>
  )
}

export function Select<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; disabled?: boolean }[]
}): JSX.Element {
  return (
    <div className="relative">
      <select
        className="field appearance-none pr-8 cursor-pointer"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled} className="bg-[#0d131c] text-[#eaf4ff]">
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-2)]" />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon?: IconName }[]
}): JSX.Element {
  return (
    <div className="flex gap-1 rounded-xl bg-[rgba(6,10,16,0.55)] p-1 border border-[var(--line)]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.75rem] font-medium transition-all duration-150 ${
            value === option.value
              ? 'bg-[rgba(34,188,255,0.18)] text-sky-200 shadow-[inset_0_0_0_1px_rgba(34,188,255,0.32)]'
              : 'text-[var(--text-2)] hover:text-[var(--text-0)] hover:bg-[rgba(148,176,210,0.08)]'
          }`}
        >
          {option.icon ? <Icon name={option.icon} size={14} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-xl'
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  width?: string
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[3px]" onClick={onClose} />
      <div className={`relative w-full ${width} panel animate-scale-in overflow-hidden`}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-[var(--line)]">
          <div>
            <h2 className="text-[1rem] font-semibold text-[var(--text-0)]">{title}</h2>
            {subtitle ? <p className="text-[0.76rem] text-[var(--text-2)] mt-1">{subtitle}</p> : null}
          </div>
          <IconButton icon="close" title="Close" onClick={onClose} />
        </div>
        <div className="px-6 py-5 max-h-[70vh] scroll-area">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--line)] bg-black/20">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Progress({ value, className = '' }: { value: number; className?: string }): JSX.Element {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-[rgba(148,176,210,0.14)] ${className}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-300 transition-[width] duration-200"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning'
}): JSX.Element {
  const tones: Record<string, string> = {
    neutral: 'bg-[rgba(148,176,210,0.1)] text-[var(--text-1)] border-[var(--line)]',
    accent: 'bg-[rgba(34,188,255,0.14)] text-[#8ce0ff] border-[rgba(34,188,255,0.3)]',
    success: 'bg-[rgba(52,211,153,0.13)] text-[#7ff0c2] border-[rgba(52,211,153,0.3)]',
    danger: 'bg-[rgba(255,92,122,0.13)] text-[#ffb3c1] border-[rgba(255,92,122,0.3)]',
    warning: 'bg-[rgba(251,191,36,0.13)] text-[#ffd97a] border-[rgba(251,191,36,0.3)]'
  }
  return <span className={`chip ${tones[tone]}`}>{children}</span>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[0.7rem] uppercase tracking-[0.14em] text-[var(--text-2)] font-semibold">{children}</h3>
      {right}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: IconName
  title: string
  description: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="h-14 w-14 rounded-2xl bg-[rgba(34,188,255,0.1)] border border-[rgba(34,188,255,0.2)] flex items-center justify-center text-sky-300 mb-4">
        <Icon name={icon} size={24} />
      </div>
      <h3 className="text-[0.95rem] font-semibold text-[var(--text-0)]">{title}</h3>
      <p className="text-[0.8rem] text-[var(--text-2)] mt-1.5 max-w-sm leading-relaxed">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-[rgba(148,176,210,0.25)] border-t-sky-400"
      style={{ width: size, height: size }}
    />
  )
}

export function Stat({ label, value, icon }: { label: string; value: string; icon?: IconName }): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[rgba(6,10,16,0.35)] px-3 py-2">
      {icon ? <Icon name={icon} size={15} className="text-sky-300/80" /> : null}
      <div className="min-w-0">
        <div className="text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-2)] font-semibold">{label}</div>
        <div className="text-[0.82rem] font-mono text-[var(--text-0)] truncate">{value}</div>
      </div>
    </div>
  )
}
