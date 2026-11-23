import { useRef, useEffect } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import clsx from "clsx"
import { getEase } from "../../store/useEaseStore"

interface ToggleButtonProps {
  isEnabled: boolean
  onToggle: () => void
  /** Accessible name for the switch. Callers should pass the setting label. */
  ariaLabel?: string
  disabled?: boolean
}

const ToggleButton = ({
  isEnabled,
  onToggle,
  ariaLabel = "Toggle setting",
  disabled = false,
}: ToggleButtonProps) => {
  const circleRef = useRef<HTMLDivElement>(null)

  const easeRef = useRef(getEase("ToggleButton", "slide"))

  useEffect(() => {
    easeRef.current = getEase("ToggleButton", "slide")
  })

  useGSAP(() => {
    if (!circleRef.current) return

    gsap.to(circleRef.current, {
      x: isEnabled ? 20 : 0,
      duration: 0.6,
      ease: easeRef.current,
      overwrite: "auto",
    })
  }, [isEnabled])

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isEnabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={clsx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors duration-300",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21c063] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        isEnabled
          ? "bg-toggle-bg dark:bg-toggle-dark-bg"
          : "bg-toggle-closed dark:bg-toggle-dark-closed",
      )}
    >
      <div
        ref={circleRef}
        className="size-5 rounded-full bg-toggle-circle dark:bg-toggle-dark-circle border border-black/10 dark:border-transparent shadow-md"
      />
    </button>
  )
}

export default ToggleButton
