import { useEffect, useId, useRef, useState } from 'react'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'

export type SelectOption = { value: string; label: string }

export function Select({
  options,
  value,
  onChange,
  label,
  name,
  disabled = false,
}: {
  options: readonly SelectOption[]
  value: string
  onChange: (value: string) => void
  label: string
  name?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const selected = options.findIndex((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (open) optionRefs.current[active]?.focus()
  }, [active, open])

  function choose(index: number) {
    onChange(options[index].value)
    setOpen(false)
    trigger.current?.focus()
  }

  function openAt(index: number) {
    setActive(index)
    setOpen(true)
  }

  return (
    <div className="business-select" ref={root}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={trigger}
        className="business-select-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(selected, 0)))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openAt(
              Math.max(
                0,
                Math.min(options.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)),
              ),
            )
          }
        }}
      >
        <span>{options[selected]?.label ?? label}</span>
        <IconChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          className="business-select-options"
          role="listbox"
          aria-label={label}
          onKeyDown={(event) => {
            let next = active
            if (event.key === 'ArrowDown') next = Math.min(active + 1, options.length - 1)
            else if (event.key === 'ArrowUp') next = Math.max(active - 1, 0)
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = options.length - 1
            else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              choose(active)
              return
            } else if (event.key === 'Escape' || event.key === 'Tab') {
              setOpen(false)
              if (event.key === 'Escape') {
                event.preventDefault()
                trigger.current?.focus()
              }
              return
            } else return
            event.preventDefault()
            setActive(next)
          }}
        >
          {options.map((option, index) => (
            <button
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={value === option.value ? 'selected' : ''}
              key={option.value}
              onClick={() => choose(index)}
              onMouseEnter={() => setActive(index)}
            >
              <span>{option.label}</span>
              {value === option.value && <IconCheck size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
