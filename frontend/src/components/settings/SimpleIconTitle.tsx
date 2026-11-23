import clsx from "clsx"
import type { ReactNode } from "react"

const SimpleIconTitle = ({
  title,
  icon,
  clickable = true,
  anchor,
  link,
  onNavigate,
}: {
  title: string
  icon: string
  clickable?: boolean
  anchor?: ReactNode
  link?: string
  onNavigate?: (anchor: ReactNode) => void
}) => {
  const handleClick = () => {
    if (!clickable) return
    if (anchor && onNavigate) {
      onNavigate(anchor)
    } else if (link) {
      window.open(link, "_blank")
    }
  }

  return (
    <button
      type="button"
      disabled={!clickable}
      aria-label={title}
      onClick={handleClick}
      className={clsx(
        "flex w-full flex-row items-center gap-4 rounded-xl p-4 text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21c063] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary",
        clickable
          ? "cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          : "cursor-default",
      )}
    >
      <div>{icon}</div>
      <div className="text-xl font-semibold text-light-text dark:text-dark-text">{title}</div>
    </button>
  )
}

export default SimpleIconTitle
