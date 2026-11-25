const PATHS = {
  close: 'M4 4l8 8M12 4l-8 8',
  chevronDown: 'M3.5 6l4.5 4.5L12.5 6',
  chevronUp: 'M3.5 10L8 5.5l4.5 4.5',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  layers: 'M8 2.5l6 3-6 3-6-3zM2 8.5l6 3 6-3',
} as const

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
