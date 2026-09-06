import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer, Option, Schedule, type Scope } from 'effect'
import type { RoomEvent } from '../shared/contracts.js'
import { atomicWrite, optionalJSON, object, alive } from './storage.js'
import {
  attempt,
  EventRejected,
  ListenerBusy,
  type BackendError,
} from './errors.js'
import { decodeEvent } from './schema.js'
import { claimBatch, inFlight } from './relay.js'
import { readState } from './room.js'

type Jobs = ReturnType<typeof claimBatch>
export type PollResult =
  | { stopped: true }
  | { jobs: Jobs | { deliveryId: string; threadId: string }[] }
  | { refreshCatalog: true; inFlight: ReturnType<typeof inFlight> }
  | { waiting: true; inFlight: ReturnType<typeof inFlight> }

export class DeliveryRuntime extends Context.Tag('CrewRoom/DeliveryRuntime')<
  DeliveryRuntime,
  {
    publish: (event: RoomEvent) => Effect.Effect<string, BackendError>
    accepted: (id: string) => Effect.Effect<boolean, BackendError>
    listener: Effect.Effect<void, BackendError, Scope.Scope>
    poll: (
      compact: boolean,
    ) => Effect.Effect<PollResult | undefined, BackendError>
    idle: Effect.Effect<PollResult, BackendError>
  }
>() {}

export function deliveryRuntimeLive(
  directory: string,
  runtime: string,
  executable: string[],
) {
  const lock = path.join(directory, 'listener.json')
  const presence = (status: string) =>
    atomicWrite(path.join(directory, 'relay-presence.json'), {
      status,
      at: Date.now(),
      pid: process.pid,
    })
  return Layer.succeed(DeliveryRuntime, {
    publish: (event) =>
      attempt('publish room event', () => {
        const checked = decodeEvent(event)
        const id = randomUUID() + '.json'
        atomicWrite(path.join(directory, 'events', id), checked)
        return id
      }),
    accepted: (id) =>
      attempt('read event receipt', () => {
        if (fs.existsSync(path.join(directory, 'processed', id))) return true
        const rejected = optionalJSON(
          path.join(directory, 'rejected', id + '.error.json'),
        )
        if (rejected)
          throw new EventRejected({
            eventId: id,
            message: String(object(rejected).error),
          })
        return false
      }),
    listener: Effect.acquireRelease(
      attempt('acquire relay listener', () => {
        const old = optionalJSON(lock)
        if (old && alive(object(old).pid))
          throw new ListenerBusy({
            message: 'A relay listener is already running.',
          })
        if (old) fs.unlinkSync(lock)
        const lease = randomUUID()
        try {
          fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, lease }), {
            flag: 'wx',
            mode: 0o600,
          })
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'EEXIST'
          )
            throw new ListenerBusy({
              message: 'A relay listener is already running.',
            })
          throw error
        }
        return lease
      }),
      (lease) =>
        attempt('release relay listener', () => {
          const current = optionalJSON(lock)
          if (
            current &&
            object(current).pid === process.pid &&
            object(current).lease === lease
          )
            fs.unlinkSync(lock)
        }).pipe(Effect.orDie),
    ).pipe(Effect.asVoid),
    poll: (compact) =>
      attempt('poll delivery queue', () => {
        const host = object(
          optionalJSON(path.join(directory, 'host.json')) ?? {},
        )
        if (host.running !== true || !alive(host.pid)) {
          presence('offline')
          return { stopped: true } as const
        }
        presence('waiting')
        const jobs = claimBatch(directory, runtime, executable)
        if (jobs.length) {
          presence('dispatching')
          return {
            jobs: compact
              ? jobs.map(({ deliveryId, threadId }) => ({
                  deliveryId,
                  threadId,
                }))
              : jobs,
          }
        }
        const state = readState(directory)
        if (!state.recentAt || (state.refreshRequestedAt ?? 0) > state.recentAt)
          return {
            refreshCatalog: true,
            inFlight: inFlight(directory, state),
          } as const
        return undefined
      }),
    idle: attempt(
      'read in-flight deliveries',
      () => ({ waiting: true, inFlight: inFlight(directory) }) as const,
    ),
  })
}

export const postEvent = (
  event: RoomEvent,
): Effect.Effect<
  { accepted: true } | { accepted: false; queued: true },
  BackendError,
  DeliveryRuntime
> =>
  Effect.gen(function* () {
    const runtime = yield* DeliveryRuntime
    // Publish once. Timeout/interruption leaves the durable event for the app to consume.
    const id = yield* runtime.publish(event)
    const receipt = yield* runtime.accepted(id).pipe(
      Effect.tap((accepted) =>
        accepted ? Effect.void : Effect.sleep('100 millis'),
      ),
      Effect.repeat({ until: (accepted) => accepted }),
      Effect.timeoutOption('10 seconds'),
    )
    return Option.isSome(receipt)
      ? ({ accepted: true } as const)
      : ({ accepted: false, queued: true } as const)
  })

export const listen = (
  compact: boolean,
): Effect.Effect<PollResult, BackendError, DeliveryRuntime> =>
  Effect.scoped(
    Effect.gen(function* () {
      const runtime = yield* DeliveryRuntime
      yield* runtime.listener
      const result = yield* runtime.poll(compact).pipe(
        Effect.tap((result) =>
          result === undefined ? Effect.sleep('1 second') : Effect.void,
        ),
        Effect.repeat({ until: (result) => result !== undefined }),
        Effect.timeoutOption('50 seconds'),
      )
      if (Option.isSome(result) && result.value !== undefined)
        return result.value
      return yield* runtime.idle
    }),
  )
