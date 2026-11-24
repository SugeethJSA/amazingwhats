import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import {
  GetContact,
  GetJIDUser,
  GetProfileColor,
} from "../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import type * as types from "../../bindings/go.mau.fi/whatsmeow/types/models.js"

interface ContactStore {
  contacts: Record<string, { name: string; senderColor: string; timestamp: number }>
  getContactName: (jid: any) => Promise<string>
  getContactColor: (jid: any) => Promise<string>
  getSenderInfo: (jid: string) => Promise<{ name: string; color: string }>
  disposeCache: () => void
}

export const useContactStore = create<ContactStore>()(
  immer((set, get) => ({
    contacts: {},

    getContactName: async jidAny => {
      // Empty/placeholder identifiers are common while the contact store is
      // repopulating after a resync. Skip the binding call entirely instead
      // of producing a raw "Binding call failed" error.
      if (!jidAny) return ""
      let userId = ""
      try {
        userId = await GetJIDUser(jidAny)
        if (!userId) return ""

        const cached = get().contacts[userId]
        if (cached) return cached.name

        const contact = await GetContact(jidAny)
        const displayName = contact?.full_name || contact?.push_name || userId
        const senderColor = await GetProfileColor(jidAny)

        set(state => {
          state.contacts[userId] = {
            name: displayName,
            senderColor,
            timestamp: Date.now(),
          }
        })
        return displayName
      } catch {
        return userId
      }
    },

    getContactColor: async jidAny => {
      if (!jidAny) return "#2b7fff"
      let userId = ""
      try {
        userId = await GetJIDUser(jidAny)
        if (!userId) return "#2b7fff"

        const cached = get().contacts[userId]
        if (cached) return cached.senderColor

        const senderColor = await GetProfileColor(jidAny)
        const contact = await GetContact(jidAny)
        const displayName = contact?.full_name || contact?.push_name || userId

        set(state => {
          state.contacts[userId] = {
            name: displayName,
            senderColor,
            timestamp: Date.now(),
          }
        })
        return senderColor
      } catch {
        return "#2b7fff"
      }
    },

    // Cached name+color for a message sender, keyed by the raw JID so repeated
    // renders while scrolling a group chat don't fire a GetContact/GetJIDUser
    // RPC per message. One fetch per sender, then synchronous cache hits.
    getSenderInfo: async (jid: string) => {
      if (!jid || !jid.trim()) return { name: "", color: "#2b7fff" }
      const cached = get().contacts[jid]
      if (cached) return { name: cached.name, color: cached.senderColor }
      try {
        const contact = await GetContact(jid as unknown as types.JID)
        const name = contact?.full_name
          ? contact.full_name
          : contact?.push_name
            ? "~ " + contact.push_name
            : ""
        const color = await GetProfileColor(jid)
        set(state => {
          state.contacts[jid] = { name, senderColor: color, timestamp: Date.now() }
        })
        return { name, color }
      } catch {
        return { name: "", color: "#2b7fff" }
      }
    },

    disposeCache: () =>
      set(state => {
        state.contacts = {}
      }),
  })),
)
