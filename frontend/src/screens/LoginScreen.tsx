import { useState, useEffect } from "react"
import Wordmark from "@/components/common/Wordmark"
import { PairPhone } from "../../bindings/github.com/lugvitc/whats4linux/api/api.js"

const PAIR_WINDOW_SECONDS = 120

/** Turn a backend error into a plain-language message with a clear next step. */
function friendlyPairError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : ""
  const text = raw.toLowerCase()
  if (!text) return "We couldn't request a pairing code. Check your connection and try again."
  if (text.includes("rate") || text.includes("too many"))
    return "Too many attempts. Wait a moment before trying again."
  if (text.includes("timeout") || text.includes("timed out") || text.includes("deadline"))
    return "The request timed out. Try again in a moment."
  if (
    text.includes("network") ||
    text.includes("connection") ||
    text.includes("dial") ||
    text.includes("unreachable")
  )
    return "We couldn't reach WhatsApp. Check your connection and try again."
  if (text.includes("phone") || text.includes("number") || text.includes("invalid"))
    return "That phone number wasn't accepted. Include your country code and try again."
  return "We couldn't request a pairing code. Check the number and try again."
}

function friendlyStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"

export function LoginScreen({
  canvasRef,
  status,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  status?: string
}) {
  const [pairingMode, setPairingMode] = useState(false)
  const [phoneInput, setPhoneInput] = useState("")
  const [pairingCode, setPairingCode] = useState("")
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState("")
  const [qrReady, setQrReady] = useState(false)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(PAIR_WINDOW_SECONDS)
  const [codeExpired, setCodeExpired] = useState(false)

  // Track when a QR is painted on the canvas.
  useEffect(() => {
    if (!canvasRef.current) return
    const observer = new MutationObserver(() => setQrReady(true))
    observer.observe(canvasRef.current, { attributes: true, childList: true, subtree: true })
    const ctx = canvasRef.current.getContext("2d")
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, 1, 1)
      if (imageData.data[3] > 0) setQrReady(true)
    }
    return () => observer.disconnect()
  }, [canvasRef])

  // Countdown for the "keep this window open" pairing state.
  useEffect(() => {
    if (expiresAt === null) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) {
        setCodeExpired(true)
        setExpiresAt(null)
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  const handlePair = async () => {
    const phone = phoneInput.replace(/[^0-9]/g, "")
    if (phone.length < 7) return
    setPairingBusy(true)
    setPairingError("")
    setPairingCode("")
    setCodeExpired(false)
    setExpiresAt(null)
    try {
      const code = await PairPhone(phone)
      setPairingCode(code)
      setSecondsLeft(PAIR_WINDOW_SECONDS)
      setExpiresAt(Date.now() + PAIR_WINDOW_SECONDS * 1000)
    } catch (err) {
      setPairingError(friendlyPairError(err))
    } finally {
      setPairingBusy(false)
    }
  }

  const leavePairingMode = () => {
    setPairingMode(false)
    setPairingCode("")
    setPairingError("")
    setExpiresAt(null)
    setCodeExpired(false)
  }

  const timeLabel = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`

  return (
    <div className="min-h-screen flex items-center justify-center p-4 overflow-x-hidden overflow-y-auto bg-dark-bg">
      <div className="relative z-10 w-full max-w-[900px] rounded-2xl overflow-hidden flex flex-col md:flex-row shadow-2xl bg-dark-secondary md:min-h-[480px]">
        {/* LEFT: instructions */}
        <div className="flex-1 p-6 md:p-12 flex flex-col justify-center">
          {/* Shared wordmark; `dark` forces its light ink on this always-dark surface. */}
          <div className="mb-10">
            <span className="dark">
              <Wordmark textClassName="text-[22px]" markClassName="h-8 w-8" />
            </span>
            <div className="mt-1 text-xs" style={{ color: "#aebac1" }}>
              Direct multi-device client
            </div>
          </div>

          {!pairingMode ? (
            <>
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: "#e9edef", letterSpacing: "-0.02em" }}
              >
                Log in to WhatsApp
              </h1>
              <p className="text-sm mb-8" style={{ color: "#aebac1" }}>
                Use your phone to scan the QR code and connect.
              </p>
              <ol className="space-y-4" style={{ color: "#aebac1" }}>
                {[
                  "Open WhatsApp on your phone",
                  <span key="2">
                    Tap{" "}
                    <b className="font-semibold" style={{ color: "#e9edef" }}>
                      Menu
                    </b>{" "}
                    or{" "}
                    <b className="font-semibold" style={{ color: "#e9edef" }}>
                      Settings
                    </b>
                  </span>,
                  <span key="3">
                    Select{" "}
                    <b className="font-semibold" style={{ color: "#e9edef" }}>
                      Linked Devices
                    </b>
                  </span>,
                  "Point your phone at this screen to scan",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold mt-0.5"
                      style={{ background: "rgba(255,255,255,0.08)", color: "#aebac1" }}
                    >
                      {i + 1}
                    </span>
                    <span className="text-sm leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>

              <button
                type="button"
                onClick={() => setPairingMode(true)}
                className={`mt-10 self-start text-sm font-medium transition-colors hover:opacity-80 ${focusRing}`}
                style={{ color: "#21c063" }}
              >
                Link with phone number instead →
              </button>
            </>
          ) : (
            <>
              <h1
                className="text-2xl font-semibold mb-2"
                style={{ color: "#e9edef", letterSpacing: "-0.02em" }}
              >
                Link with phone number
              </h1>
              <p className="text-sm mb-8" style={{ color: "#aebac1" }}>
                Enter your phone number to receive a pairing code.
              </p>
              <div className="flex flex-col gap-4">
                <label htmlFor="pair-phone" className="sr-only">
                  Phone number including country code
                </label>
                <input
                  id="pair-phone"
                  autoFocus
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  aria-describedby="pair-phone-hint"
                  className={`w-full rounded-xl px-4 py-3 text-sm outline-none placeholder:text-neutral-cool ${focusRing}`}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#e9edef",
                  }}
                  placeholder="+1 234 567 8900"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handlePair()}
                />
                <p id="pair-phone-hint" className="text-xs -mt-2" style={{ color: "#aebac1" }}>
                  Include your country code.
                </p>

                {pairingCode && (
                  <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="rounded-xl p-5 text-center"
                    style={{
                      background: "rgba(33,192,99,0.08)",
                      border: "1px solid rgba(33,192,99,0.2)",
                    }}
                  >
                    <p className="text-xs mb-2" style={{ color: "#aebac1" }}>
                      Your pairing code
                    </p>
                    <p
                      className="text-4xl font-bold font-mono tracking-[0.3em]"
                      style={{ color: codeExpired ? "#aebac1" : "#21c063", letterSpacing: "0.3em" }}
                    >
                      {pairingCode}
                    </p>
                    <p className="mt-3 text-xs" style={{ color: "#aebac1" }}>
                      Enter this in WhatsApp → Linked Devices → Link a device
                    </p>
                  </div>
                )}

                {pairingError && (
                  <div
                    role="alert"
                    className="rounded-lg px-3 py-3 text-sm"
                    style={{
                      color: "#ffd6d6",
                      background: "rgba(180,40,40,0.16)",
                      border: "1px solid rgba(239,68,68,0.35)",
                    }}
                  >
                    <p>{pairingError}</p>
                    <div className="mt-2 flex flex-wrap gap-4">
                      <button
                        type="button"
                        onClick={handlePair}
                        className={`text-sm font-semibold hover:opacity-80 ${focusRing}`}
                        style={{ color: "#21c063" }}
                      >
                        Try again
                      </button>
                      <button
                        type="button"
                        onClick={leavePairingMode}
                        className={`text-sm hover:opacity-80 ${focusRing}`}
                        style={{ color: "#aebac1" }}
                      >
                        Scan the QR code instead
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handlePair}
                    disabled={pairingBusy || phoneInput.replace(/[^0-9]/g, "").length < 7}
                    aria-busy={pairingBusy}
                    className={`flex-1 rounded-xl py-3 text-sm font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${focusRing}`}
                    style={{ background: "#21c063", color: "#0a1014" }}
                  >
                    {pairingBusy ? "Generating…" : "Get pairing code"}
                  </button>
                  <button
                    type="button"
                    onClick={leavePairingMode}
                    className={`rounded-xl px-4 py-3 text-sm transition-all hover:opacity-80 ${focusRing}`}
                    style={{
                      color: "#aebac1",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    Back
                  </button>
                </div>

                <p role="status" aria-live="polite" className="sr-only">
                  {pairingBusy
                    ? "Requesting a pairing code…"
                    : pairingCode
                      ? "Pairing code ready. Enter it in WhatsApp."
                      : ""}
                </p>
              </div>
            </>
          )}

          <p className="mt-8 text-xs leading-relaxed" style={{ color: "#aebac1" }}>
            Unofficial client — not affiliated with WhatsApp or Meta. Messages stay on this device;
            no telemetry.
          </p>
        </div>

        {/* Divider: horizontal when stacked, vertical at md and up */}
        <div className="h-px w-full bg-white/10 md:h-auto md:w-px" aria-hidden="true" />

        {/* RIGHT: QR / pairing mode info */}
        <div className="w-full md:w-[340px] flex-shrink-0 flex flex-col items-center justify-center p-6 md:p-10 gap-6">
          {!pairingMode ? (
            <>
              <div
                className="relative rounded-2xl p-3 bg-white"
                style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.35)" }}
              >
                {!qrReady && (
                  <div className="absolute inset-3 rounded-xl qr-placeholder skeleton flex items-center justify-center">
                    <svg
                      viewBox="0 0 40 40"
                      width="40"
                      height="40"
                      style={{ opacity: 0.25 }}
                      aria-hidden="true"
                    >
                      <rect
                        x="2"
                        y="2"
                        width="16"
                        height="16"
                        rx="3"
                        fill="none"
                        stroke="#111"
                        strokeWidth="2"
                      />
                      <rect
                        x="22"
                        y="2"
                        width="16"
                        height="16"
                        rx="3"
                        fill="none"
                        stroke="#111"
                        strokeWidth="2"
                      />
                      <rect
                        x="2"
                        y="22"
                        width="16"
                        height="16"
                        rx="3"
                        fill="none"
                        stroke="#111"
                        strokeWidth="2"
                      />
                      <rect x="6" y="6" width="8" height="8" rx="1" fill="#111" opacity="0.3" />
                      <rect x="26" y="6" width="8" height="8" rx="1" fill="#111" opacity="0.3" />
                      <rect x="6" y="26" width="8" height="8" rx="1" fill="#111" opacity="0.3" />
                    </svg>
                  </div>
                )}
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label="QR code — scan with WhatsApp on your phone to link this device"
                  className="block rounded-xl"
                  style={{
                    width: "100%",
                    maxWidth: 264,
                    height: "auto",
                    aspectRatio: "1 / 1",
                    opacity: qrReady ? 1 : 0,
                    transition: "opacity 0.4s",
                  }}
                />
              </div>

              <p
                role="status"
                aria-live="polite"
                className="text-sm text-center"
                style={{ color: "#aebac1" }}
              >
                {qrReady
                  ? "Scan this code with WhatsApp on your phone."
                  : "Preparing your QR code…"}
              </p>

              {status && status !== "waiting" && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs font-medium"
                  style={{ color: "#21c063" }}
                >
                  {friendlyStatus(status)}
                </p>
              )}
            </>
          ) : (
            <div className="text-center flex flex-col items-center gap-4">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: "rgba(33,192,99,0.12)" }}
              >
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#21c063"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="6" y="2" width="12" height="20" rx="2" />
                  <path d="M10 18h4" />
                  <path d="m9 10 2 2 4-4" />
                </svg>
              </div>
              <div>
                <p className="font-semibold mb-1" style={{ color: "#e9edef" }}>
                  Check your phone
                </p>
                <p className="text-sm" style={{ color: "#aebac1" }}>
                  Enter the code in WhatsApp
                  <br />
                  under Linked Devices
                </p>
              </div>
              <div className="w-full max-w-[240px] flex flex-col items-center gap-2">
                <p className="text-xs" style={{ color: "#aebac1" }}>
                  Keep this window open —{" "}
                  {codeExpired ? "code expired" : `code expires in ${timeLabel}`}
                </p>
                {!codeExpired && (
                  <div
                    role="progressbar"
                    aria-label="Time remaining to enter the pairing code"
                    aria-valuemin={0}
                    aria-valuemax={PAIR_WINDOW_SECONDS}
                    aria-valuenow={secondsLeft}
                    className="w-full h-1.5 rounded-full overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.1)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(secondsLeft / PAIR_WINDOW_SECONDS) * 100}%`,
                        background: "#21c063",
                        transition: "width 1s linear",
                      }}
                    />
                  </div>
                )}
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs"
                  style={{ color: codeExpired ? "#ffd6d6" : "#aebac1" }}
                >
                  {codeExpired
                    ? "That code has expired. Generate a new one to continue."
                    : pairingCode
                      ? "Waiting for your phone to finish linking…"
                      : "Waiting for your pairing code…"}
                </p>
                {codeExpired && (
                  <button
                    type="button"
                    onClick={handlePair}
                    className={`text-sm font-semibold hover:opacity-80 ${focusRing}`}
                    style={{ color: "#21c063" }}
                  >
                    Generate a new code
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
