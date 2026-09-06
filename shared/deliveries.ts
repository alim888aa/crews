import type { ChatMessage, Delivery, SavedRoom } from './contracts.js'

export function addressedMessageForDelivery(
  room: Pick<SavedRoom, 'messages'>,
  delivery: Delivery,
): ChatMessage | undefined {
  // Stop at this delivery's handoff so newer queued requests cannot replace it.
  // Recipient IDs include named mentions, @all and implicit conversation replies.
  const handoff = room.messages.findIndex((m) => m.id === delivery.messageId)
  for (let i = handoff; i >= 0; i--) {
    const m = room.messages[i]!
    if (
      m.rootId === delivery.rootId &&
      m.roundId === delivery.roundId &&
      m.kind !== 'progress' &&
      m.recipientIds.includes(delivery.workerId)
    )
      return m
  }
  return undefined
}
