import { DEFAULT_REPLY_LIMIT, GENERAL_CHANNEL_ID } from '../shared/contracts'
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
  channels: [{ id: GENERAL_CHANNEL_ID, name: 'general', memberIds: [] }],
  messages: [],
  mentions: [],
  workers: [],
  hireRequests: [],
  deliveries: [],
  paused: false,
  replyLimit: DEFAULT_REPLY_LIMIT,
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
type MentionNavigation = {
  messageId: string
  rootId: string
  channelId: string
}
let mentionNavigation: MentionNavigation | null = null
const mentionNavigationListeners = new Set<() => void>()
export const getMentionNavigation = () => mentionNavigation
export const subscribeMentionNavigation = (listener: () => void) => {
  mentionNavigationListeners.add(listener)
  return () => {
    mentionNavigationListeners.delete(listener)
  }
}
export function clearMentionNavigation() {
  if (!mentionNavigation) return
  mentionNavigation = null
  mentionNavigationListeners.forEach((listener) => listener())
}
export function openMention(messageId: string) {
  const message = state.messages.find((item) => item.id === messageId)
  if (
    !message ||
    !state.mentions.some((mention) => mention.messageId === messageId)
  )
    return
  mentionNavigation = {
    messageId,
    rootId: message.rootId,
    channelId: message.channelId,
  }
  mentionNavigationListeners.forEach((listener) => listener())
  void window.crew.readMentions(message.rootId).catch((error) => {
    roomError =
      error instanceof Error ? error.message : 'Could not mark mention read.'
    errorListeners.forEach((listener) => listener())
  })
}
function update(next: RoomState) {
  if (next.revision >= state.revision) {
    state = next
    pruneDeletedDrafts(next)
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
  window.crew.onOpenMention(openMention)
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

type DraftOperation = {
  pending?: 'sending' | 'uploading' | 'deleting'
  error: string
}
let draftOperations: Record<string, DraftOperation> = {}
export const getDraftOperations = () => draftOperations
function updateDraftOperation(key: string, value: DraftOperation) {
  draftOperations = { ...draftOperations, [key]: value }
  draftListeners.forEach((fn) => fn())
}
// Keep pending work across Composer remounts, but never persist a stale lock on restart.
export function beginDraftOperation(
  key: string,
  pending: 'sending' | 'uploading',
) {
  if (draftOperations[key]?.pending) return false
  updateDraftOperation(key, { pending, error: '' })
  return true
}
export function endDraftOperation(key: string) {
  updateDraftOperation(key, { error: draftOperations[key]?.error ?? '' })
}
export function setDraftError(key: string, error: string) {
  updateDraftOperation(key, { ...draftOperations[key], error })
}

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
let draftCleanupPending = false
function persistDraftCleanup() {
  try {
    localStorage.setItem(draftKey, JSON.stringify(drafts))
    localStorage.setItem(imageDraftKey, JSON.stringify(imageDrafts))
    draftCleanupPending = false
  } catch {
    // A committed room update must still reach the UI when local storage fails.
    draftCleanupPending = true
    roomError =
      'Some deleted drafts could not be cleared from this device’s storage. Your room changes were saved.'
    errorListeners.forEach((fn) => fn())
  }
}
function pruneDeletedDrafts(room: RoomState) {
  const roots = new Set(
    room.messages.filter((m) => m.id === m.rootId).map((m) => m.id),
  )
  const channels = new Set(room.channels.map((c) => c.id))
  const valid = (key: string) =>
    key === 'channel' ||
    (key.startsWith('channel:') ? channels.has(key.slice(8)) : roots.has(key))
  // Also handles a restart between the backend commit and the renderer's draft cleanup.
  const nextDrafts = Object.entries(drafts).filter(([key]) => valid(key))
  const nextImages = Object.entries(imageDrafts).filter(([key]) => valid(key))
  const changed =
    nextDrafts.length !== Object.keys(drafts).length ||
    nextImages.length !== Object.keys(imageDrafts).length
  if (changed) {
    drafts = Object.fromEntries(nextDrafts)
    imageDrafts = Object.fromEntries(nextImages)
  }
  if (changed || draftCleanupPending) persistDraftCleanup()
}
export function setImageDrafts(
  key: string,
  images: import('../shared/contracts').ImageAttachment[],
) {
  imageDrafts = { ...imageDrafts, [key]: images }
  localStorage.setItem(imageDraftKey, JSON.stringify(imageDrafts))
  draftListeners.forEach((fn) => fn())
}

function channelDraftKeys(channelId: string) {
  return [
    `channel:${channelId}`,
    ...state.messages
      .filter((m) => m.channelId === channelId && m.id === m.rootId)
      .map((m) => m.id),
  ]
}

export function channelHasDraftWork(channelId: string) {
  return channelDraftKeys(channelId).some(
    (key) => draftOperations[key]?.pending,
  )
}

export async function deleteChannel(channelId: string) {
  const keys = channelDraftKeys(channelId)
  if (keys.some((key) => draftOperations[key]?.pending))
    throw new Error(
      'Finish this channel’s send or image upload before deleting it.',
    )
  // Lock every composer in the channel before crossing the asynchronous IPC boundary.
  for (const key of keys)
    updateDraftOperation(key, { pending: 'deleting', error: '' })
  const removedImages = keys.flatMap((key) => imageDrafts[key] ?? [])
  try {
    const messageImageIds = await window.crew.deleteChannel(channelId)
    drafts = Object.fromEntries(
      Object.entries(drafts).filter(([key]) => !keys.includes(key)),
    )
    imageDrafts = Object.fromEntries(
      Object.entries(imageDrafts).filter(([key]) => !keys.includes(key)),
    )
    persistDraftCleanup()
    const kept = new Set(
      Object.values(imageDrafts)
        .flat()
        .map((a) => a.id),
    )
    for (const id of new Set([
      ...messageImageIds,
      ...removedImages.map((image) => image.id),
    ])) {
      if (!kept.has(id)) {
        try {
          await window.crew.removeImage(id)
        } catch {
          roomError = 'Channel deleted, but a draft image could not be removed.'
          errorListeners.forEach((fn) => fn())
        }
      }
    }
  } finally {
    draftOperations = Object.fromEntries(
      Object.entries(draftOperations).filter(([key]) => !keys.includes(key)),
    )
    draftListeners.forEach((fn) => fn())
  }
}
