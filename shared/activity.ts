import type { RoomState } from './contracts.js'
import { addressedMessageForDelivery } from './deliveries.js'

export type ActivityState =
  'working' | 'queued' | 'next' | 'approval' | 'attention' | 'paused' | 'sent'
export function conversationActivity(room: RoomState, rootId: string) {
  const pending = room.deliveries.filter(
    (d) => d.rootId === rootId && d.status !== 'replied',
  )
  return deliveryActivity(room, pending)
}

export function messageActivity(room: RoomState, messageId: string) {
  return deliveryActivity(
    room,
    room.deliveries.filter(
      (d) =>
        d.status !== 'replied' &&
        addressedMessageForDelivery(room, d)?.id === messageId,
    ),
  )
}

function deliveryActivity(room: RoomState, pending: RoomState['deliveries']) {
  const seen = new Set<string>()
  return pending
    .sort(
      (a, b) => Number(a.status === 'waiting') - Number(b.status === 'waiting'),
    )
    .flatMap((delivery) => {
      const worker = room.workers.find((w) => w.id === delivery.workerId)
      if (!worker || seen.has(worker.id)) return []
      seen.add(worker.id)
      const state: ActivityState =
        delivery.failure === 'approval' || worker.connection !== 'connected'
          ? 'approval'
          : delivery.error
            ? 'attention'
            : delivery.startedAt !== undefined
              ? 'working'
              : delivery.status === 'waiting'
                ? 'next'
                : delivery.relayStatus === 'sent' ||
                    delivery.relayStatus === 'claimed'
                  ? 'sent'
                  : room.paused
                    ? 'paused'
                    : 'queued'
      return [{ workerId: worker.id, handle: worker.handle, state }]
    })
}
