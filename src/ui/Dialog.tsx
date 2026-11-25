import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  label: string
  className?: string
  /** Omit for a dialog that has to be answered. */
  onClose?: () => void
  children: ReactNode
}

export function Dialog({ label, className = '', onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && !el.open) el.showModal()
    return () => el?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-label={label}
      onCancel={(e) => { e.preventDefault(); onClose?.() }}
    >
      <div className="dialog-scroll">{children}</div>
    </dialog>
  )
}
