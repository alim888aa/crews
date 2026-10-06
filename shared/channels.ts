import type { SavedRoom } from './contracts.js'
import { GENERAL_CHANNEL_ID } from './contracts.js'

export function channelMemberIds(room: SavedRoom, channelId: string): string[] {
  const channel = room.channels.find((candidate) => candidate.id === channelId)
  if (!channel) return []
  return channel.id === GENERAL_CHANNEL_ID
    ? room.workers
        .filter((worker) => !worker.archivedAt)
        .map((worker) => worker.id)
    : channel.memberIds.filter((id) =>
        room.workers.some((worker) => worker.id === id && !worker.archivedAt),
      )
}

export function userInvitedToChannel(
  room: SavedRoom,
  workerId: string,
  channelId: string,
): boolean {
  return room.messages.some(
    (message) =>
      message.authorId === 'user' &&
      message.channelId === channelId &&
      message.invitedGuestIds?.includes(workerId),
  )
}

export function canInitiateInChannel(
  room: SavedRoom,
  workerId: string,
  channelId: string,
): boolean {
  return (
    channelMemberIds(room, channelId).includes(workerId) ||
    userInvitedToChannel(room, workerId, channelId)
  )
}

export function conversationParticipantIds(
  room: SavedRoom,
  rootId: string,
): string[] {
  const seen = new Set<string>()
  const participants: string[] = []
  const include = (id: string) => {
    if (
      seen.has(id) ||
      !room.workers.some((worker) => worker.id === id && !worker.archivedAt)
    )
      return
    seen.add(id)
    participants.push(id)
  }
  for (const message of room.messages) {
    if (message.rootId !== rootId) continue
    for (const id of message.recipientIds) include(id)
    if (message.authorId !== 'user') include(message.authorId)
  }
  return participants
}
