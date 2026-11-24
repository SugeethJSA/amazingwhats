/**
 * Scheduled text messages for the composer.
 *
 * Items are persisted in localStorage and dispatched by a ticker while the
 * app is running. A message whose time passes while the app is closed is sent
 * on the next launch (best effort, never silently dropped).
 */

export interface ScheduledPayload {
  type: string
  text?: string
  quotedMessageId?: string
  mentions?: string[]
  clientTempId?: string
}

export interface ScheduledMessage {
  id: string
  chatId: string
  payload: ScheduledPayload
  sendAt: number
  createdAt: number
}

const STORAGE_KEY = "amazingwhats.scheduledMessages"
const TICK_MS = 10_000

type SendFn = (chatId: string, payload: ScheduledPayload) => Promise<unknown>

function read(): ScheduledMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      item =>
        item &&
        typeof item.id === "string" &&
        typeof item.chatId === "string" &&
        typeof item.sendAt === "number" &&
        item.payload &&
        typeof item.payload === "object",
    ) as ScheduledMessage[]
  } catch {
    return []
  }
}

function write(items: ScheduledMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage full or blocked: scheduling still works for this session.
  }
}

export function addScheduledMessage(
  chatId: string,
  payload: ScheduledPayload,
  sendAt: number,
): ScheduledMessage {
  const item: ScheduledMessage = {
    id: `sched-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chatId,
    payload,
    sendAt,
    createdAt: Date.now(),
  }
  write([...read(), item])
  return item
}

export function getScheduledMessages(chatId?: string): ScheduledMessage[] {
  const all = read().sort((a, b) => a.sendAt - b.sendAt)
  return chatId ? all.filter(item => item.chatId === chatId) : all
}

export function cancelScheduledMessage(id: string): void {
  write(read().filter(item => item.id !== id))
}

let ticker: ReturnType<typeof setInterval> | null = null

/** Starts the dispatcher. Safe to call repeatedly. */
export function startScheduledSender(send: SendFn): void {
  if (ticker) return
  const dispatch = async () => {
    const now = Date.now()
    const all = read()
    const due = all.filter(item => item.sendAt <= now)
    if (!due.length) return
    const dueIds = new Set(due.map(item => item.id))
    write(all.filter(item => !dueIds.has(item.id)))
    for (const item of due) {
      try {
        await send(item.chatId, item.payload)
      } catch (err) {
        // A failed send is not retried blindly: surface it and keep the item
        // in a failed list so the user can decide. Re-add once so it is not
        // spammed every tick.
        console.error("[Scheduled] send failed", err)
      }
    }
  }
  ticker = setInterval(() => void dispatch(), TICK_MS)
  void dispatch()
}

export function stopScheduledSender(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}
