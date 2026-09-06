import type { CrewAPI, RoomState } from '../shared/contracts'
export type {
  Worker,
  ChatMessage,
  RoomState,
  RecentTask,
  Approval,
} from '../shared/contracts'
declare global {
  interface Window {
    crew: CrewAPI
  }
}

let state: RoomState = {
  version: 2,
  revision: -1,
  messages: [],
  workers: [],
  deliveries: [],
  paused: false,
  recent: [],
  recentAt: null,
  refreshRequestedAt: null,
  relay: {
    taskId: null,
    automationId: null,
    token: '',
    status: 'offline',
    lastSeen: null,
    delayed: false,
  },
}
const listeners = new Set<() => void>()
export const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const getSnapshot = () => state
function update(next: RoomState) {
  if (next.revision >= state.revision) {
    state = next
    listeners.forEach((fn) => fn())
  }
}
let roomError = ''
const errorListeners = new Set<() => void>()
export const subscribeErrors = (listener: () => void) => {
  errorListeners.add(listener)
  return () => {
    errorListeners.delete(listener)
  }
}
export const getRoomError = () => roomError
export function clearRoomError() {
  roomError = ''
  errorListeners.forEach((fn) => fn())
}
export async function connect() {
  window.crew.onState(update)
  window.crew.onError((error) => {
    if (error !== roomError) {
      roomError = error
      errorListeners.forEach((fn) => fn())
    }
  })
  update(await window.crew.snapshot())
}

const draftKey = 'crews-drafts-v3'
let drafts: Record<string, string> = {}
try {
  drafts = JSON.parse(localStorage.getItem(draftKey) || '{}')
} catch {
  /* A damaged draft must not prevent opening the room. */
}
const draftListeners = new Set<() => void>()
export const subscribeDrafts = (listener: () => void) => {
  draftListeners.add(listener)
  return () => {
    draftListeners.delete(listener)
  }
}
export const getDrafts = () => drafts
export function setDraft(key: string, value: string) {
  drafts = { ...drafts, [key]: value }
  localStorage.setItem(draftKey, JSON.stringify(drafts))
  draftListeners.forEach((fn) => fn())
}

const imageDraftKey = 'crews-image-drafts-v1'
let imageDrafts: Record<
  string,
  import('../shared/contracts').ImageAttachment[]
> = {}
try {
  imageDrafts = JSON.parse(localStorage.getItem(imageDraftKey) || '{}')
} catch {
  /* Keep text drafts usable if image drafts are damaged. */
}
export const getImageDrafts = () => imageDrafts
export function setImageDrafts(
  key: string,
  images: import('../shared/contracts').ImageAttachment[],
) {
  imageDrafts = { ...imageDrafts, [key]: images }
  localStorage.setItem(imageDraftKey, JSON.stringify(imageDrafts))
  draftListeners.forEach((fn) => fn())
}
