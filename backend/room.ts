import { attempt, invalidRequest } from './errors.js'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Effect, Schedule } from 'effect'
import type {
  SavedRoom,
  RoomState,
  RoomEvent,
  Receipt,
  Teammate,
} from '../shared/contracts.js'
import {
  acceptEvent,
  newRoom,
  sendMessage,
  validateTeammate,
} from './domain.js'
import { atomicWrite, optionalJSON, object } from './storage.js'
import { Attachments } from './attachments.js'
import { decodeState, decodeEvent } from './schema.js'
export const receiptPath = (dir: string, id: string) =>
  path.join(dir, 'receipts', id + '.json')
export function readState(directory: string): SavedRoom {
  const value = optionalJSON(path.join(directory, 'state.json'))
  return value === undefined
    ? newRoom()
    : (structuredClone(decodeState(value)) as SavedRoom)
}
export function receipt(directory: string, id: string): Receipt | undefined {
  const value = optionalJSON(receiptPath(directory, id))
  if (value === undefined) return undefined
  const r = object(value)
  if (
    !['claimed', 'sent', 'attention'].includes(String(r.status)) ||
    typeof r.at !== 'number' ||
    typeof r.detail !== 'string'
  )
    throw invalidRequest('Invalid delivery receipt.')
  if (
    r.failure &&
    !['approval', 'uncertain', 'task', 'storage'].includes(String(r.failure))
  )
    throw invalidRequest('Invalid delivery failure.')
  return r as unknown as Receipt
}
export class Room extends EventEmitter {
  state: SavedRoom
  constructor(readonly directory: string) {
    super()
    for (const f of ['events', 'processed', 'rejected', 'claims', 'receipts'])
      fs.mkdirSync(path.join(directory, f), { recursive: true, mode: 0o700 })
    this.state = readState(directory)
    atomicWrite(path.join(directory, 'state.json'), this.state)
  }
  transaction<A>(change: (state: SavedRoom) => A): A {
    const next = structuredClone(this.state)
    const result = change(next)
    next.revision++
    atomicWrite(path.join(this.directory, 'state.json'), next)
    this.state = next
    return result
  }
  send(payload: {
    text: string
    parentId: string | null
    attachmentIds?: string[]
  }) {
    const images = new Attachments(this.directory).resolve(
      payload.attachmentIds ?? [],
    )
    return this.transaction((s) =>
      sendMessage(s, payload.text, payload.parentId, images),
    )
  }
  add(input: { id: string; title: string; handle: string }) {
    this.transaction((s) => {
      if (s.workers.some((w) => w.id === input.id))
        throw invalidRequest('This task is already in the room.')
      if (!s.recent.some((t) => t.id === input.id))
        throw invalidRequest(
          'Refresh recent tasks and choose one from the list.',
        )
      s.workers.push(validateTeammate(s, input))
    })
  }
  edit(input: { id: string; title: string; handle: string }) {
    this.transaction((s) => {
      const index = s.workers.findIndex((w) => w.id === input.id)
      if (index < 0) throw invalidRequest('Unknown teammate.')
      if (
        s.workers[index]!.handle !== input.handle &&
        s.deliveries.some((d) => d.status !== 'replied')
      )
        throw invalidRequest(
          'Finish pending deliveries before changing an @name. Display names can be edited now.',
        )
      s.workers[index] = validateTeammate(s, input)
    })
  }
  beginApproval(id: string): Teammate {
    return this.transaction((s) => {
      const w = s.workers.find((w) => w.id === id)
      if (!w) throw invalidRequest('Unknown teammate.')
      // Reopening a waiting approval keeps its token valid for a prompt already copied.
      if (w.connection !== 'awaiting') w.token = randomUUID()
      w.connection = 'awaiting'
      return { ...w }
    })
  }
  receive(event: RoomEvent) {
    this.transaction((s) => acceptEvent(s, event))
    if (event.kind === 'connect') {
      for (const d of this.state.deliveries.filter(
        (d) => d.workerId === event.workerId && d.status === 'pending',
      )) {
        const old = receipt(this.directory, d.id)
        if (old?.failure === 'approval')
          atomicWrite(receiptPath(this.directory, d.id), {
            ...old,
            failure: 'task',
            detail:
              'Connection reapproved. Finish this same pending delivery in the original task; it has not been sent again.',
          })
      }
    }
  }
  drain() {
    for (const name of fs
      .readdirSync(path.join(this.directory, 'events'))
      .filter((f) => f.endsWith('.json'))) {
      const source = path.join(this.directory, 'events', name)
      try {
        const event = decodeEvent(optionalJSON(source)) as RoomEvent
        this.receive(event)
        fs.renameSync(source, path.join(this.directory, 'processed', name))
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'Invalid room event.'
        // Preserve failed events for inspection; never turn a malformed reply into a success.
        if (fs.existsSync(source))
          fs.renameSync(source, path.join(this.directory, 'rejected', name))
        atomicWrite(
          path.join(this.directory, 'rejected', name + '.error.json'),
          { error: detail },
        )
        this.emit('deliveryError', detail)
      }
    }
  }
  snapshot(): RoomState {
    const presence = object(
      optionalJSON(path.join(this.directory, 'relay-presence.json')) ?? {},
    )
    const seen = typeof presence.at === 'number' ? presence.at : null
    const host = object(
      optionalJSON(path.join(this.directory, 'host.json')) ?? {},
    )
    const start =
      typeof host.startedAt === 'number' ? host.startedAt : Date.now()
    const deliveries = this.state.deliveries.map((d) => {
      const r =
        d.status !== 'replied' ? receipt(this.directory, d.id) : undefined
      return {
        ...d,
        relayStatus: r?.status,
        error: r?.status === 'attention' ? r.detail : undefined,
        failure: r?.failure,
      }
    })
    return {
      ...this.state,
      deliveries,
      workers: this.state.workers.map((w) => {
        const open = deliveries.filter(
          (d) => d.workerId === w.id && d.status !== 'replied',
        )
        const permission = open.some((d) => d.failure === 'approval')
        return {
          ...w,
          connection:
            permission && w.connection !== 'awaiting'
              ? 'approval'
              : w.connection,
          pending: open.length,
          lastSeen: w.connectedAt,
          presence: open.some((d) => d.relayStatus === 'attention')
            ? 'attention'
            : open.some((d) => d.startedAt !== undefined)
              ? 'working'
              : open.some(
                    (d) =>
                      d.relayStatus === 'claimed' || d.relayStatus === 'sent',
                  )
                ? 'unconfirmed'
                : open.some((d) => d.status === 'pending')
                  ? 'queued'
                  : open.length
                    ? 'turn'
                    : 'idle',
        }
      }),
      relay: {
        ...this.state.relay,
        status:
          seen && Date.now() - seen < 75_000
            ? String(presence.status)
            : 'offline',
        lastSeen: seen,
        error:
          presence.status === 'attention' && typeof presence.detail === 'string'
            ? presence.detail
            : undefined,
        delayed: Date.now() - Math.max(start, seen ?? 0) > 180_000,
      },
    }
  }
  watch() {
    return Effect.suspend(() => {
      let last = ''
      return attempt('read room updates', () => {
        this.drain()
        const snapshot = this.snapshot(),
          serialized = JSON.stringify(snapshot)
        if (serialized !== last) {
          last = serialized
          this.emit('change', snapshot)
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() =>
            this.emit(
              'deliveryError',
              `Could not read room updates: ${error.message}`,
            ),
          ),
        ),
        Effect.repeat(Schedule.spaced('500 millis')),
      )
    })
  }
}
