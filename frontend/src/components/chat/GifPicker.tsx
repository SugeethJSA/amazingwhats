import React, { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import clsx from "clsx"

// Same single focus treatment as the composer: colour comes from the shared
// --color-focus-ring token, so light and dark both clear 3:1.
const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus-ring)"

interface GifImage {
  url: string
}

interface GifResult {
  id: string
  title?: string
  images: {
    fixed_width: GifImage
    original: GifImage
  }
}

interface GiphyResponse {
  data?: GifResult[]
}

export interface GifPickerProps {
  /** User-supplied GIPHY beta key. Empty means "no provider path available". */
  apiKey: string
  /** Receives a real image/gif File built from the fetched GIPHY bytes. */
  onSelect: (file: File) => void
  onClose: () => void
  /** Opens the local-file path (the no-key fallback). */
  onPickFromFile: () => void
}

const NETWORK_ERROR = "Couldn't reach GIPHY. Check your connection and try again."
const RATE_LIMIT_ERROR =
  "GIPHY rate limit reached (100 calls/hour on free beta keys). Please try again later."
const DOWNLOAD_ERROR = "Couldn't download that GIF. Please try another."

/**
 * GIF search panel. Requests go straight from the WebView to GIPHY — there is
 * no backend proxy and no bundled/shared key. With no key the panel only offers
 * the local-file action; it never shows placeholder or fabricated results.
 */
export function GifPicker({ apiKey, onSelect, onClose, onPickFromFile }: GifPickerProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const requestSeqRef = useRef(0)
  const selectingRef = useRef(false)
  // The parent passes an inline close callback; a ref keeps the mount-only
  // accessibility effect from re-running (and stealing focus) on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const hasKey = apiKey.trim().length > 0
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<"trending" | "search">("trending")
  const [results, setResults] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  // Latest request wins: an older response can never overwrite a newer one.
  const runFetch = useCallback(async (url: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const seq = ++requestSeqRef.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (seq !== requestSeqRef.current) return
      if (response.status === 429) {
        setResults([])
        setError(RATE_LIMIT_ERROR)
        return
      }
      if (!response.ok) {
        setResults([])
        setError(NETWORK_ERROR)
        return
      }
      const json = (await response.json()) as GiphyResponse
      if (seq !== requestSeqRef.current) return
      const data = Array.isArray(json.data) ? json.data : []
      setResults(
        data.filter(
          gif => Boolean(gif?.images?.fixed_width?.url) && Boolean(gif?.images?.original?.url),
        ),
      )
    } catch {
      if (seq !== requestSeqRef.current || controller.signal.aborted) return
      setResults([])
      setError(NETWORK_ERROR)
    } finally {
      if (seq === requestSeqRef.current) setLoading(false)
    }
  }, [])

  const showTrending = useCallback(() => {
    if (!hasKey) return
    setMode("trending")
    void runFetch(
      `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey.trim())}&limit=20`,
    )
  }, [apiKey, hasKey, runFetch])

  // Open on real trending data so the panel never starts with dead controls.
  useEffect(() => {
    if (!hasKey) return
    showTrending()
    return () => controllerRef.current?.abort()
    // Only re-run when the key changes; showTrending already depends on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey, apiKey])

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    const term = query.trim()
    if (!term || !hasKey) return
    setMode("search")
    void runFetch(
      `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey.trim())}&q=${encodeURIComponent(term)}&limit=20&offset=0`,
    )
  }

  const selectGif = async (gif: GifResult) => {
    if (selectingRef.current) return
    selectingRef.current = true
    setSelectingId(gif.id)
    setError(null)
    try {
      // GIPHY's CDN serves the bytes directly to the WebView; no Go binding and
      // no data URL intermediate. The File goes through the existing send path.
      const response = await fetch(gif.images.original.url)
      if (!response.ok) throw new Error("GIF download failed")
      const blob = await response.blob()
      const file = new File([blob], "giphy.gif", { type: "image/gif" })
      onSelect(file)
    } catch {
      setError(DOWNLOAD_ERROR)
    } finally {
      selectingRef.current = false
      setSelectingId(null)
    }
  }

  const pickFromFile = () => {
    onPickFromFile()
    onClose()
  }

  // Escape closes; Tab is trapped inside the dialog. Focus returns to whatever
  // opened it. Capture phase keeps Escape ahead of chat-level handlers.
  useEffect(() => {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    const frame = requestAnimationFrame(() => {
      if (hasKey) searchRef.current?.focus()
      else fileButtonRef.current?.focus()
    })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKey, true)
      controllerRef.current?.abort()
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : null
      target?.focus()
    }
  }, [hasKey])

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[80vh] w-[420px] max-w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-dark-secondary"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/10">
          <h2 id={titleId} className="text-base font-semibold text-light-text dark:text-dark-text">
            Choose a GIF
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close GIF picker"
            title="Close"
            className={clsx(
              "rounded-full p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10",
              FOCUS_RING,
            )}
          >
            ×
          </button>
        </div>

        {hasKey ? (
          <>
            <form onSubmit={submitSearch} className="flex gap-2 px-4 pt-3">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Search GIFs</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search GIFs"
                  aria-label="Search GIFs"
                  className={clsx(
                    "w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm",
                    "text-light-text placeholder:text-light-muted dark:border-white/20 dark:text-dark-text dark:placeholder:text-dark-muted",
                    FOCUS_RING,
                  )}
                />
              </label>
              <button
                type="submit"
                disabled={!query.trim()}
                className={clsx(
                  "rounded-lg bg-green px-3 py-2 text-sm font-medium text-action-ink transition-colors hover:bg-green-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
                  FOCUS_RING,
                )}
              >
                Search
              </button>
              <button
                type="button"
                onClick={showTrending}
                aria-pressed={mode === "trending"}
                className={clsx(
                  "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-light-text transition-colors hover:bg-gray-100 dark:border-white/20 dark:text-dark-text dark:hover:bg-white/10 motion-reduce:transition-none",
                  FOCUS_RING,
                )}
              >
                Trending
              </button>
            </form>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading && (
                <p
                  role="status"
                  className="mb-3 flex items-center gap-2 text-sm text-light-muted dark:text-dark-muted"
                >
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 rounded-full border-2 border-green border-t-transparent animate-spin motion-reduce:animate-none"
                  />
                  Loading GIFs…
                </p>
              )}
              {error && (
                <p role="alert" className="mb-3 text-sm text-danger-ink dark:text-danger-soft">
                  {error}
                </p>
              )}
              {!loading && !error && results.length === 0 && (
                <p className="text-sm text-light-muted dark:text-dark-muted">
                  No GIFs to show. Search above or open Trending.
                </p>
              )}
              {results.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {results.map(gif => (
                    <button
                      key={gif.id}
                      type="button"
                      onClick={() => void selectGif(gif)}
                      disabled={selectingId !== null}
                      aria-label={`Send GIF: ${gif.title || gif.id}`}
                      className={clsx(
                        "overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition-colors hover:border-green disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/5 motion-reduce:transition-none",
                        FOCUS_RING,
                      )}
                    >
                      <img
                        src={gif.images.fixed_width.url}
                        alt={gif.title || "GIF preview"}
                        loading="lazy"
                        className="h-32 w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-4">
            <p className="text-sm leading-relaxed text-light-text dark:text-dark-text">
              Add a GIPHY API key in Settings → Advanced to search GIFs.
            </p>
            <p className="mt-1 text-xs text-light-muted dark:text-dark-muted">
              Free beta keys work here. GIFs you send are attributed to GIPHY.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 dark:border-white/10">
          <button
            ref={fileButtonRef}
            type="button"
            onClick={pickFromFile}
            className={clsx(
              "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-light-text transition-colors hover:bg-gray-100 dark:border-white/20 dark:text-dark-text dark:hover:bg-white/10 motion-reduce:transition-none",
              FOCUS_RING,
            )}
          >
            Choose GIF from file
          </button>
          {hasKey && (
            <a
              href="https://giphy.com"
              target="_blank"
              rel="noopener noreferrer"
              className={clsx(
                "text-xs font-medium text-light-muted hover:text-light-text dark:text-dark-muted dark:hover:text-dark-text",
                FOCUS_RING,
              )}
            >
              Powered by GIPHY
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
