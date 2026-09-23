import { useEffect, useId, useRef, useState } from 'react'
import { IconCheck, IconChevronDown, IconSearch, IconX } from '@tabler/icons-react'

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
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const selected = options.findIndex((option) => option.value === value)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = normalizedQuery
    ? options.filter(
        (option) =>
          option.label.toLocaleLowerCase().includes(normalizedQuery) ||
          option.value.toLocaleLowerCase().includes(normalizedQuery),
      )
    : [...options]

  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useEffect(() => {
    if (open) search.current?.focus()
  }, [open])

  function close(focusTrigger = false) {
    setOpen(false)
    setQuery('')
    if (focusTrigger) trigger.current?.focus()
  }

  function choose(option: SelectOption) {
    onChange(option.value)
    close(true)
  }

  function openMenu() {
    setQuery('')
    setActive(Math.max(selected, 0))
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
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu()
          }
        }}
      >
        <span>{options[selected]?.label ?? label}</span>
        <IconChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="business-select-options">
          <div className="business-select-search">
            <IconSearch size={16} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              value={query}
              placeholder={`搜索${label}`}
              aria-label={`搜索${label}`}
              aria-controls={id}
              aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const index = event.key === 'ArrowDown' ? 0 : filtered.length - 1
                  setActive(Math.max(index, 0))
                  optionRefs.current[Math.max(index, 0)]?.focus()
                } else if (event.key === 'Enter' && filtered[active]) {
                  event.preventDefault()
                  choose(filtered[active])
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  close(true)
                } else if (event.key === 'Tab') close()
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => {
                  setQuery('')
                  setActive(0)
                  search.current?.focus()
                }}
              >
                <IconX size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <div id={id} className="business-select-list" role="listbox" aria-label={label}>
            {filtered.map((option, index) => (
              <button
                id={`${id}-${index}`}
                ref={(element) => {
                  optionRefs.current[index] = element
                }}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className={value === option.value ? 'selected' : ''}
                key={option.value}
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(index)}
                onKeyDown={(event) => {
                  let next = active
                  if (event.key === 'ArrowDown') next = Math.min(active + 1, filtered.length - 1)
                  else if (event.key === 'ArrowUp') next = Math.max(active - 1, 0)
                  else if (event.key === 'Home') next = 0
                  else if (event.key === 'End') next = filtered.length - 1
                  else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    choose(option)
                    return
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    close(true)
                    return
                  } else if (event.key === 'Tab') {
                    close()
                    return
                  } else if (event.key.length === 1) {
                    search.current?.focus()
                    return
                  } else return
                  event.preventDefault()
                  setActive(next)
                  optionRefs.current[next]?.focus()
                }}
              >
                <span>{option.label}</span>
                {value === option.value && <IconCheck size={15} aria-hidden="true" />}
              </button>
            ))}
            {!filtered.length && <p className="business-select-empty">没有匹配选项</p>}
          </div>
        </div>
      )}
    </div>
  )
}
