import { invalidRequest } from './errors.js'
import { randomUUID } from 'node:crypto'
import type {
  ImageAttachment,
  SavedRoom,
  ChatMessage,
  RoomEvent,
  Teammate,
} from '../shared/contracts.js'
import { string, uuid } from './storage.js'
import { DEFAULT_REPLY_LIMIT } from '../shared/contracts.js'
export const handlesIn = (text: string) => [
  ...new Set(
    [...text.matchAll(/(?:^|[\s(])@([a-z][a-z0-9-]*)\b/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  ),
]
export function newRoom(): SavedRoom {
  return {
    version: 2,
    revision: 0,
    paused: false,
    replyLimit: DEFAULT_REPLY_LIMIT,
    workers: [],
    messages: [],
    deliveries: [],
    relay: { taskId: null, automationId: null, token: randomUUID() },
    recent: [],
    recentAt: null,
    refreshRequestedAt: null,
  }
}
export function validateTeammate(
  state: SavedRoom,
  input: { id: string; handle: string; title: string },
): Teammate {
  uuid(input.id)
  string(input.title, 'name')
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(input.handle) || input.handle === 'all')
    throw invalidRequest(
      'Use a unique @name, starting with a letter, up to 32 letters, digits or hyphens. “all” is reserved.',
    )
  if (input.title.length > 100)
    throw invalidRequest('Keep the name under 100 characters.')
  if (state.workers.some((w) => w.id !== input.id && w.handle === input.handle))
    throw invalidRequest('That @name is already taken.')
  if (input.id === state.relay.taskId)
    throw invalidRequest(
      'The relay delivers messages; choose a different task as a teammate.',
    )
  const old = state.workers.find((w) => w.id === input.id)
  return {
    ...input,
    initials: input.title
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase(),
    connection: old?.connection ?? 'new',
    token: old?.token ?? randomUUID(),
    connectedAt: old?.connectedAt ?? null,
  }
}
export function sendMessage(
  state: SavedRoom,
  text: string,
  parentId: string | null,
  attachments: ImageAttachment[] = [],
): ChatMessage {
  if (
    typeof text !== 'string' ||
    text.length > 120000 ||
    (!text.trim() && !attachments.length)
  )
    throw invalidRequest('Write a message or attach an image.')
  const parent = parentId
    ? state.messages.find((m) => m.id === parentId)
    : undefined
  if (parentId && !parent)
    throw invalidRequest('The reply target no longer exists.')
  const root = parent
    ? state.messages.find((m) => m.id === parent.rootId)!
    : undefined
  const allowed = root?.recipientIds ?? state.workers.map((w) => w.id)
  const handles = handlesIn(text)
  const named = handles
    .filter((h) => h !== 'all')
    .map((h) => {
      const w = state.workers.find((w) => w.handle === h)
      if (!w || !allowed.includes(w.id))
        throw invalidRequest('Choose a teammate in this conversation.')
      return w.id
    })
  const recipients = handles.includes('all')
    ? allowed
    : named.length
      ? named
      : (root?.recipientIds ?? [])
  if (!recipients.length)
    throw invalidRequest('Add and mention a teammate first.')
  if (recipients.length > state.replyLimit)
    throw invalidRequest(
      `This message needs ${recipients.length} replies. Increase the reply limit in the sidebar to at least ${recipients.length}.`,
    )
  const id = randomUUID(),
    mode = handles.includes('all') ? 'simultaneous' : 'ordered'
  const message: ChatMessage = {
    id,
    rootId: root?.id ?? id,
    parentId,
    authorId: 'user',
    kind: 'message',
    text,
    ...(attachments.length ? { attachments } : {}),
    createdAt: Date.now(),
    recipientIds: recipients,
    roundId: id,
    mode,
  }
  state.messages.push(message)
  recipients.forEach((workerId, i) =>
    state.deliveries.push({
      id: randomUUID(),
      workerId,
      messageId: id,
      rootId: message.rootId,
      roundId: id,
      status: mode === 'ordered' && i > 0 ? 'waiting' : 'pending',
      createdAt: Date.now(),
    }),
  )
  return message
}
export function acceptEvent(state: SavedRoom, event: RoomEvent) {
  if (event.kind === 'catalog') {
    state.recent = [...new Map(event.tasks.map((t) => [t.id, t])).values()]
      .filter((t) => t.id !== state.relay.taskId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
    state.recentAt = Date.now()
    return
  }
  if (event.kind === 'relay') {
    if (event.token !== state.relay.token)
      throw invalidRequest('This setup request has expired.')
    if (state.relay.taskId && state.relay.taskId !== event.taskId)
      throw invalidRequest(
        'A relay is already registered. Keep the existing relay.',
      )
    state.relay.taskId = event.taskId
    state.relay.automationId = event.automationId
    return
  }
  const worker = state.workers.find((w) => w.id === event.workerId)
  if (!worker) throw invalidRequest('Unknown teammate.')
  if (event.kind === 'connect') {
    if (event.token !== worker.token)
      throw invalidRequest(
        'This connection request has expired. Copy the current approval from Crews.',
      )
    worker.connection = 'connected'
    worker.connectedAt = Date.now()
    return
  }
  const delivery = state.deliveries.find(
    (d) => d.id === event.deliveryId && d.workerId === worker.id,
  )
  if (!delivery)
    throw invalidRequest('The delivery does not belong to this teammate.')
  if (delivery.status === 'replied') return
  if (delivery.status !== 'pending')
    throw invalidRequest('Wait for your turn before replying.')
  if (event.kind === 'started') {
    delivery.startedAt ??= Date.now()
    return
  }
  const root = state.messages.find((m) => m.id === delivery.rootId)!
  const round = state.messages.find((m) => m.id === delivery.roundId)!
  const peers = [...new Set(event.to)].map((h) =>
    state.workers.find((w) => w.handle === h),
  )
  if (
    peers.some(
      (w) => !w || w.id === worker.id || !root.recipientIds.includes(w.id),
    )
  )
    throw invalidRequest('Only address other teammates in this conversation.')
  if (event.kind === 'progress' && peers.length)
    throw invalidRequest('Progress cannot start peer deliveries.')
  const message: ChatMessage = {
    id: randomUUID(),
    rootId: root.id,
    parentId: delivery.messageId,
    authorId: worker.id,
    kind: event.kind,
    text: string(event.text),
    createdAt: Date.now(),
    recipientIds: peers.map((w) => w!.id),
    roundId: round.id,
  }
  if (event.kind === 'progress') {
    message.deliveryId = delivery.id
    const index = state.messages.findIndex(
      (m) => m.kind === 'progress' && m.deliveryId === delivery.id,
    )
    if (index >= 0)
      state.messages[index] = { ...message, id: state.messages[index]!.id }
    else state.messages.push(message)
    return
  }
  delivery.status = 'replied'
  delivery.replyId = message.id
  state.messages.push(message)
  worker.connection = 'connected'
  worker.connectedAt = Date.now()
  let remaining =
    state.replyLimit -
    state.deliveries.filter((d) => d.roundId === round.id).length
  const ordered = round.mode === 'ordered'
  const current = round.recipientIds.indexOf(worker.id)
  const order = [
    ...round.recipientIds.slice(current + 1),
    ...round.recipientIds.slice(0, current + 1),
  ]
  if (ordered) peers.sort((a, b) => order.indexOf(a!.id) - order.indexOf(b!.id))
  for (const peer of peers) {
    if (
      ordered &&
      state.deliveries.some(
        (d) =>
          d.roundId === round.id &&
          d.workerId === peer!.id &&
          d.status !== 'replied',
      )
    )
      continue
    if (remaining-- <= 0) {
      message.discussionPaused = true
      continue
    }
    state.deliveries.push({
      id: randomUUID(),
      workerId: peer!.id,
      messageId: message.id,
      rootId: root.id,
      roundId: round.id,
      status: ordered ? 'waiting' : 'pending',
      createdAt: Date.now(),
    })
  }
  if (ordered) {
    const next = state.deliveries.find(
      (d) => d.roundId === round.id && d.status === 'waiting',
    )
    if (next) {
      next.status = 'pending'
      next.messageId = message.id
    }
  }
}
