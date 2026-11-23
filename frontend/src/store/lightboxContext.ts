import { create } from "zustand"

/**
 * The message the lightbox is currently showing.
 *
 * The legacy `useUIStore.openLightbox(src, kind)` only carries bytes, so the
 * media viewer keeps its own small, typed context for the message actions
 * (star, pin, react, forward, download, jump-to-message). All strings are
 * untrusted payload data; consumers must use them only as display text or as
 * store/RPC keys.
 */
export interface LightboxMessageContext {
  messageId: string | null
  chatJid: string | null
  senderJid: string | null
  pushName: string | null
  timestamp: string | null
  caption: string | null
  isFromMe: boolean
  starred: boolean
  pinned: boolean
}

interface LightboxContextStore extends LightboxMessageContext {
  /** Merge a partial update; callers can write just the fields they know. */
  setLightboxMessage: (ctx: Partial<LightboxMessageContext>) => void
  clearLightboxMessage: () => void
}

export const EMPTY_LIGHTBOX_MESSAGE: LightboxMessageContext = {
  messageId: null,
  chatJid: null,
  senderJid: null,
  pushName: null,
  timestamp: null,
  caption: null,
  isFromMe: false,
  starred: false,
  pinned: false,
}

export const useLightboxContext = create<LightboxContextStore>(set => ({
  ...EMPTY_LIGHTBOX_MESSAGE,
  setLightboxMessage: ctx => set(ctx),
  clearLightboxMessage: () => set({ ...EMPTY_LIGHTBOX_MESSAGE }),
}))
