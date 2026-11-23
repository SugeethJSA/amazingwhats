import { create } from "zustand"

interface MediaHubState {
  open: boolean
  openHub: () => void
  closeHub: () => void
}

/** Global intent for the combined Media / Docs / Links hub. */
export const useMediaHubStore = create<MediaHubState>(set => ({
  open: false,
  openHub: () => set({ open: true }),
  closeHub: () => set({ open: false }),
}))
