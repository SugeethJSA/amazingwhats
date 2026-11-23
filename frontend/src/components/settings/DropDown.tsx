import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { useState, useRef, useEffect } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import clsx from "clsx"
import { getEase } from "../../store/useEaseStore"

const DropDown = ({
  title,
  elements,
  icon,
  onToggle,
  placeholder = "Select an option",
}: {
  title: string
  elements: string[]
  icon?: React.ReactNode
  onToggle: (element: string) => void
  placeholder?: string
}) => {
  const [onOpen, setOnOpen] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const arrowRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])

  const easeOpenRef = useRef(getEase("DropDown", "open"))
  const easeCloseRef = useRef(getEase("DropDown", "close"))
  const easeRotateRef = useRef(getEase("DropDown", "rotate"))

  useEffect(() => {
    easeOpenRef.current = getEase("DropDown", "open")
    easeCloseRef.current = getEase("DropDown", "close")
    easeRotateRef.current = getEase("DropDown", "rotate")
  })

  const openMenu = () => {
    const start = selectedElement ? elements.indexOf(selectedElement) : 0
    setActiveIndex(start < 0 ? 0 : start)
    setOnOpen(true)
  }

  const toggleOpen = () => {
    if (onOpen) setOnOpen(false)
    else openMenu()
  }

  const handleSelect = (element: string) => {
    setSelectedElement(element)
    onToggle(element)
    setOnOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOnOpen(false)
      }
    }

    if (onOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onOpen])

  useEffect(() => {
    if (!onOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOnOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onOpen])

  useEffect(() => {
    if (onOpen) optionRefs.current[activeIndex]?.focus()
  }, [onOpen, activeIndex])

  useGSAP(() => {
    if (!dropdownRef.current || !arrowRef.current) return

    if (onOpen) {
      gsap.set(dropdownRef.current, { height: "auto" })
      const h = dropdownRef.current.offsetHeight

      gsap.fromTo(
        dropdownRef.current,
        { height: 0, opacity: 0 },
        { height: h, opacity: 1, duration: 0.3, ease: easeOpenRef.current },
      )

      gsap.to(arrowRef.current, {
        rotation: 180,
        duration: 0.3,
        ease: easeRotateRef.current,
      })
    } else {
      gsap.to(dropdownRef.current, {
        height: 0,
        opacity: 0,
        duration: 0.3,
        ease: easeCloseRef.current,
      })

      gsap.to(arrowRef.current, {
        rotation: 0,
        duration: 0.3,
        ease: easeRotateRef.current,
      })
    }
  }, [onOpen])

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (elements.length === 0) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!onOpen) openMenu()
      else if (event.key === "ArrowDown") setActiveIndex(i => (i + 1) % elements.length)
      else setActiveIndex(i => (i - 1 + elements.length) % elements.length)
    }
  }

  const onOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((index + 1) % elements.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((index - 1 + elements.length) % elements.length)
    } else if (event.key === "Home") {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === "End") {
      event.preventDefault()
      setActiveIndex(elements.length - 1)
    }
  }

  const label = title || placeholder

  return (
    <div ref={containerRef} className="flex flex-col">
      {title && (
        <div className="font-semibold mb-2 text-light-text dark:text-dark-text">{title}</div>
      )}
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={onOpen}
        onClick={toggleOpen}
        onKeyDown={onTriggerKeyDown}
        className={clsx(
          "flex min-h-9 w-full items-center justify-between rounded-md border p-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21c063] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary",
          "bg-dropdown-bg hover:bg-dropdown-hover-bg text-dropdown-text dark:bg-dropdown-dark-bg dark:hover:bg-dropdown-dark-hover-bg dark:text-dropdown-dark-text",
          "border-dropdown-border dark:border-dropdown-dark-border",
        )}
      >
        <span className="flex items-center gap-2">
          {icon}
          <span>{selectedElement || placeholder}</span>
        </span>
        <span ref={arrowRef} className="inline-flex shrink-0" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
          </svg>
        </span>
      </button>
      <div
        ref={dropdownRef}
        aria-hidden={!onOpen}
        className="overflow-hidden"
        style={{ height: 0, opacity: 0 }}
      >
        <div
          role="listbox"
          aria-label={label}
          className="mt-2 rounded-md border border-dropdown-border bg-dropdown-element-bg shadow-lg dark:border-dropdown-border dark:bg-dropdown-element-dark-bg"
        >
          {elements.map((element, index) => (
            <button
              key={index}
              ref={node => {
                optionRefs.current[index] = node
              }}
              type="button"
              role="option"
              aria-selected={selectedElement === element}
              tabIndex={onOpen ? 0 : -1}
              onClick={() => handleSelect(element)}
              onKeyDown={event => onOptionKeyDown(event, index)}
              className={clsx(
                "flex min-h-9 w-full items-center rounded-md px-2 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#21c063]/50",
                "hover:bg-dropdown-element-hover-bg dark:hover:bg-dropdown-element-dark-hover-bg text-dropdown-element-text dark:text-dropdown-element-dark-text",
                selectedElement === element &&
                  "bg-dropdown-element-hover-bg dark:bg-dropdown-element-dark-hover-bg",
              )}
            >
              {element}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default DropDown
