import { invalidRequest } from './errors.js'
import { randomUUID } from 'node:crypto'
import type {
  ImageAttachment,
  SavedRoom,
  ChatMessage,
  RoomEvent,
  Teammate,
  TeammateInput,
  Channel,
} from '../shared/contracts.js'
import { string, uuid } from './storage.js'
import {
  DEFAULT_REPLY_LIMIT,
  GENERAL_CHANNEL_ID,
  MAX_IDENTITY_LENGTH,
  MAX_ROLE_LENGTH,
} from '../shared/contracts.js'
import {
  channelMemberIds,
  conversationParticipantIds,
  canInitiateInChannel,
  userInvitedToChannel,
} from '../shared/channels.js'
export const handlesIn = (text: string) => [
  ...new Set(
    [...text.matchAll(/(?:^|[\s(])@([a-z][a-z0-9-]*)\b/gi)].map((m) =>
      m[1].toLowerCase(),
    ),
  ),
]
// @you is a human alert in agent text, never a teammate delivery target.
export const mentionsUser = (text: string) =>
  /(?:^|[\s(])@you(?![a-z0-9-])/i.test(text)

function recordHumanMention(state: SavedRoom, message: ChatMessage) {
  if (
    mentionsUser(message.text) &&
    !state.mentions.some((mention) => mention.messageId === message.id)
  )
    state.mentions.push({ messageId: message.id })
}
export function newRoom(): SavedRoom {
  return {
    version: 2,
    revision: 0,
    paused: false,
    replyLimit: DEFAULT_REPLY_LIMIT,
    channels: [
      { id: GENERAL_CHANNEL_ID, name: GENERAL_CHANNEL_ID, memberIds: [] },
    ],
    workers: [],
    hireRequests: [],
    messages: [],
    mentions: [],
    deliveries: [],
    relay: { taskId: null, automationId: null, token: randomUUID() },
    recent: [],
    recentAt: null,
    refreshRequestedAt: null,
  }
}
export function validateChannel(
  state: SavedRoom,
  input: { id?: string; name: string; memberIds: string[] },
): Channel {
  const name = string(input.name, 'channel name').trim().toLowerCase()
  if (!/^[a-z0-9-]{1,40}$/.test(name))
    throw invalidRequest(
      'Use up to 40 lowercase letters, digits or hyphens for the channel name.',
    )
  if (name === GENERAL_CHANNEL_ID && input.id !== GENERAL_CHANNEL_ID)
    throw invalidRequest('The general channel name is reserved.')
  if (
    state.channels.some(
      (channel) => channel.id !== input.id && channel.name === name,
    )
  )
    throw invalidRequest('That channel name is already taken.')
  if (!Array.isArray(input.memberIds))
    throw invalidRequest('Invalid channel members.')
  const memberIds = [...new Set(input.memberIds)]
  const existing = state.channels.find((channel) => channel.id === input.id)
  if (
    memberIds.some(
      (id) =>
        !state.workers.some(
          (worker) =>
            worker.id === id &&
            (!worker.archivedAt || existing?.memberIds.includes(id)),
        ),
    )
  )
    throw invalidRequest('Choose known teammates for this channel.')
  return { id: input.id ?? randomUUID(), name, memberIds }
}
export function validateTeammate(
  state: SavedRoom,
  input: TeammateInput,
): Teammate {
  uuid(input.id)
  string(input.title, 'name')
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(input.handle) ||
    ['all', 'you'].includes(input.handle)
  )
    throw invalidRequest(
      'Use a unique @name, starting with a letter, up to 32 letters, digits or hyphens. “all” and “you” are reserved.',
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
  const identity = input.identity ?? old?.identity ?? ''
  if (typeof identity !== 'string' || identity.length > MAX_IDENTITY_LENGTH)
    throw invalidRequest(
      `Keep the identity under ${MAX_IDENTITY_LENGTH} characters.`,
    )
  const role = input.role ?? old?.role ?? ''
  if (
    typeof role !== 'string' ||
    role.length > MAX_ROLE_LENGTH ||
    /[\r\n]/.test(role)
  )
    throw invalidRequest(
      `Keep the role on one line under ${MAX_ROLE_LENGTH} characters.`,
    )
  return {
    ...input,
    identity: identity.trim(),
    role: role.trim(),
    initials: input.title
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase(),
    connection: old?.connection ?? 'new',
    token: old?.token ?? randomUUID(),
    connectedAt: old?.connectedAt ?? null,
    ...(old?.archivedAt ? { archivedAt: old.archivedAt } : {}),
    ...(old?.managed ? { managed: old.managed } : {}),
  }
}
export function sendMessage(
  state: SavedRoom,
  text: string,
  parentId: string | null,
  attachments: ImageAttachment[] = [],
  channelId?: string,
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
  const selectedChannelId = parent?.channelId ?? channelId ?? GENERAL_CHANNEL_ID
  if (parent && channelId !== undefined && channelId !== parent.channelId)
    throw invalidRequest('A reply stays in its original channel.')
  const channelExists = state.channels.some(
    (channel) => channel.id === selectedChannelId,
  )
  if (!channelExists) throw invalidRequest('Choose an existing channel.')
  const channelMembers = channelMemberIds(state, selectedChannelId)
  const root = parent
    ? state.messages.find((m) => m.id === parent.rootId)!
    : undefined
  const allDefaults = root
    ? conversationParticipantIds(state, root.id)
    : channelMembers
  const handles = handlesIn(text)
  const named = handles
    .filter((h) => h !== 'all' && h !== 'you')
    .map((h) => {
      const w = state.workers.find((w) => w.handle === h && !w.archivedAt)
      if (!w) throw invalidRequest('Choose a known teammate.')
      return w.id
    })
  const recipients = handles.includes('all')
    ? [...new Set([...allDefaults, ...named])]
    : named.length
      ? named
      : root
        ? allDefaults
        : []
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
    ...(selectedChannelId !== GENERAL_CHANNEL_ID
      ? {
          invitedGuestIds: recipients.filter(
            (workerId) => !channelMembers.includes(workerId),
          ),
        }
      : {}),
    roundId: id,
    channelId: selectedChannelId,
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
function addAgentConversationMessage(
  state: SavedRoom,
  event: Extract<
    RoomEvent,
    { kind: 'conversation-start' | 'conversation-post' }
  >,
  root?: ChatMessage,
) {
  if (state.messages.some((message) => message.id === event.id)) return
  const participants = root ? conversationParticipantIds(state, root.id) : []
  const memberIds = channelMemberIds(state, event.channelId)
  const recipientIds = [...new Set(event.to)].map((handle) => {
    const target = state.workers.find(
      (worker) => worker.handle === handle && !worker.archivedAt,
    )
    if (
      !target ||
      target.id === event.workerId ||
      (!memberIds.includes(target.id) && !participants.includes(target.id))
    )
      throw invalidRequest('Invite a teammate in this channel or conversation.')
    return target.id
  })
  if (recipientIds.length > state.replyLimit)
    throw invalidRequest('This conversation exceeds the reply limit.')
  const message: ChatMessage = {
    id: event.id,
    rootId: root?.id ?? event.id,
    parentId: root?.id ?? null,
    authorId: event.workerId,
    kind: root ? 'reply' : 'message',
    text: event.text,
    createdAt: Date.now(),
    recipientIds,
    roundId: event.id,
    channelId: event.channelId,
    mode: event.mode,
  }
  state.messages.push(message)
  recordHumanMention(state, message)
  recipientIds.forEach((workerId, index) =>
    state.deliveries.push({
      id: randomUUID(),
      workerId,
      messageId: message.id,
      rootId: message.rootId,
      roundId: message.roundId,
      status: event.mode === 'ordered' && index > 0 ? 'waiting' : 'pending',
      createdAt: Date.now(),
    }),
  )
}
export function acceptEvent(
  state: SavedRoom,
  event: RoomEvent,
  canCoalesce: (delivery: SavedRoom['deliveries'][number]) => boolean = () =>
    false,
  canCoverClaimed: (
    delivery: SavedRoom['deliveries'][number],
  ) => boolean = () => false,
) {
  if (event.kind === 'catalog') {
    // An in-flight older relay must not replace the complete direct catalog.
    if (state.catalogVersion === 1 && event.catalogVersion !== 1) return
    if (event.catalogVersion === 1) state.catalogVersion = 1
    state.recent = [...new Map(event.tasks.map((t) => [t.id, t])).values()]
      .filter(
        (task) =>
          task.id !== state.relay.taskId &&
          !state.workers.some((worker) => worker.managed?.threadId === task.id),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
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
  if (worker.archivedAt)
    throw invalidRequest('This teammate is archived in Crews.')
  if (event.kind === 'hire') {
    if (worker.connection !== 'connected' || event.token !== worker.token)
      throw invalidRequest('Only a connected teammate can request a hire.')
    if (state.hireRequests.some((request) => request.id === event.id)) return
    const root = state.messages.find(
      (message) =>
        message.id === event.rootId && message.rootId === event.rootId,
    )
    if (
      !root ||
      !conversationParticipantIds(state, root.id).includes(worker.id) ||
      !canInitiateInChannel(state, worker.id, root.channelId)
    )
      throw invalidRequest('Request a hire from your own invited conversation.')
    validateTeammate(state, { id: event.id, ...event.draft })
    state.hireRequests.push({
      id: event.id,
      requesterId: worker.id,
      channelId: root.channelId,
      rootId: root.id,
      draft: event.draft,
      status: 'pending',
      createdAt: Date.now(),
    })
    return
  }
  if (
    event.kind === 'conversation-start' ||
    event.kind === 'conversation-post'
  ) {
    if (worker.connection !== 'connected' || event.token !== worker.token)
      throw invalidRequest('Only your connected task can start a conversation.')
    const channel = state.channels.find((item) => item.id === event.channelId)
    if (!channel || !canInitiateInChannel(state, worker.id, channel.id))
      throw invalidRequest('This teammate was not invited into that channel.')
    if (event.kind === 'conversation-start') {
      addAgentConversationMessage(state, event)
    } else {
      const root = state.messages.find(
        (message) =>
          message.id === event.rootId && message.rootId === event.rootId,
      )
      if (
        !root ||
        root.channelId !== event.channelId ||
        !conversationParticipantIds(state, root.id).includes(worker.id)
      )
        throw invalidRequest(
          'Join this conversation before inviting teammates.',
        )
      addAgentConversationMessage(state, event, root)
    }
    return
  }
  if (event.kind === 'connect') {
    if (event.token !== worker.token)
      throw invalidRequest(
        'This connection request has expired. Copy the current approval from Crews.',
      )
    worker.connection = 'connected'
    worker.connectedAt = Date.now()
    return
  }
  if (event.kind === 'profile') {
    if (worker.connection !== 'connected' || event.token !== worker.token)
      throw invalidRequest('This teammate is not connected to Crews.')
    if (event.role === undefined && event.identity === undefined)
      throw invalidRequest('Choose a description or instructions to update.')
    const index = state.workers.findIndex((w) => w.id === worker.id)
    state.workers[index] = validateTeammate(state, {
      id: worker.id,
      title: worker.title,
      handle: worker.handle,
      role: event.role ?? worker.role ?? '',
      identity: event.identity ?? worker.identity ?? '',
    })
    return
  }
  const delivery = state.deliveries.find(
    (d) => d.id === event.deliveryId && d.workerId === worker.id,
  )
  if (!delivery)
    throw invalidRequest('The delivery does not belong to this teammate.')
  if (delivery.status === 'replied' || delivery.status === 'resolved') return
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
  const participants = conversationParticipantIds(state, root.id)
  const projectMembers = channelMemberIds(state, root.channelId)
  const workerIsMember =
    projectMembers.includes(worker.id) ||
    userInvitedToChannel(state, worker.id, root.channelId)
  if (
    peers.some(
      (w) =>
        !w ||
        w.id === worker.id ||
        (!participants.includes(w.id) &&
          !(workerIsMember && projectMembers.includes(w.id))),
    )
  )
    throw invalidRequest(
      'Only address conversation participants or members of your current project.',
    )
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
    channelId: root.channelId,
  }
  if (event.kind === 'progress') {
    message.deliveryId = delivery.id
    const index = state.messages.findIndex(
      (m) => m.kind === 'progress' && m.deliveryId === delivery.id,
    )
    if (index >= 0) message.id = state.messages[index]!.id
    if (index >= 0) state.messages[index] = message
    else state.messages.push(message)
    recordHumanMention(state, message)
    return
  }
  delivery.status = 'replied'
  delivery.replyId = message.id
  state.messages.push(message)
  recordHumanMention(state, message)
  worker.connection = 'connected'
  worker.connectedAt = Date.now()
  let remaining =
    state.replyLimit -
    state.deliveries.filter((d) => d.roundId === round.id && !d.coalescedInto)
      .length
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
          (d.status === 'pending' || d.status === 'waiting'),
      )
    )
      continue
    if (!ordered) {
      const queued = state.deliveries.find(
        (d) =>
          d.rootId === root.id &&
          d.roundId === round.id &&
          d.workerId === peer!.id &&
          d.status === 'pending' &&
          d.startedAt === undefined &&
          canCoalesce(d),
      )
      if (queued) {
        queued.coalescedMessageIds ??= []
        queued.coalescedMessageIds.push(message.id)
        continue
      }
    }
    if (remaining <= 0) {
      const claimed = !ordered
        ? state.deliveries.find(
            (d) =>
              d.rootId === root.id &&
              d.roundId === round.id &&
              d.workerId === peer!.id &&
              d.status === 'pending' &&
              d.startedAt === undefined &&
              canCoverClaimed(d),
          )
        : undefined
      if (claimed) {
        claimed.coalescedMessageIds ??= []
        claimed.coalescedMessageIds.push(message.id)
        continue
      }
      message.discussionPaused = true
      continue
    }
    remaining--
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
