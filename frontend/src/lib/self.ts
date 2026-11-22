import { GetMyJID } from "../../bindings/github.com/lugvitc/whats4linux/api/api.js"

let myUser = ""

// The phone-number part of a JID, ignoring device and server suffixes.
export function userPart(jid: string): string {
  return (jid || "").split("@")[0].split(":")[0]
}

export async function initSelf() {
  try {
    myUser = userPart(await GetMyJID())
  } catch {
    /* not logged in yet */
  }
}

// Clear the cached identity on logout so isMe() cannot classify a new
// account's senders against the previous account's phone number.
export function resetSelf() {
  myUser = ""
}

// Whether a reaction sender is us ("me" is the optimistic local marker).
export function isMe(senderId: string): boolean {
  if (!senderId) return false
  if (senderId === "me") return true
  return !!myUser && userPart(senderId) === myUser
}
