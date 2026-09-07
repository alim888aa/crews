import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect, Fiber, Cause } from 'effect'
import type { RoomEvent, FailureKind, SavedRoom } from '../shared/contracts.js'
import {
  atomicWrite,
  optionalJSON,
  object,
  string,
  uuid,
  alive,
} from './storage.js'
import { attempt, invalidRequest, type BackendError } from './errors.js'
import { jsonInput } from './input.js'
import {
  postEvent,
  listen,
  deliveryRuntimeLive,
  DeliveryRuntime,
} from './delivery-runtime.js'
import { readState } from './room.js'
import { runtimeConfig, codexHooksFile } from './paths.js'
import { installContextHooks } from './hooks.js'
import { envelope, inFlight, mark } from './relay.js'
import { decodeEvent } from './schema.js'

const runtime = path.dirname(fileURLToPath(import.meta.url))
const [command, id, token, detail] = process.argv.slice(2)
type Config = ReturnType<typeof runtimeConfig>
type Command = Effect.Effect<unknown, BackendError, DeliveryRuntime>

// Called inside attempt: argument validation stays in the typed failure channel.
function dispatch(config: Config, state: SavedRoom): Command {
  const directory = config.directory
  if (command === 'status') {
    const host = object(optionalJSON(path.join(directory, 'host.json')) ?? {})
    return Effect.succeed({
      currentTaskId: process.env.CODEX_THREAD_ID ?? null,
      relay: state.relay,
      hostAlive: host.running === true && alive(host.pid),
      inFlight: inFlight(directory, state),
      needsCatalog:
        !state.recentAt || (state.refreshRequestedAt ?? 0) > state.recentAt,
    })
  }
  if (command === 'prompt-chunk') {
    const delivery = state.deliveries.find(
      (d) => d.id === uuid(token) && d.workerId === uuid(id),
    )
    if (!delivery || delivery.status !== 'pending')
      throw invalidRequest('No pending delivery belongs to this task.')
    const claim = object(
      optionalJSON(path.join(directory, 'claims', delivery.id)),
    )
    const prompt = claim.prompt
    if (
      typeof prompt !== 'string' ||
      !prompt.length ||
      prompt.length > 1_000_000
    )
      throw invalidRequest('Invalid claimed delivery prompt.')
    const offset = Number(detail)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= prompt.length)
      throw invalidRequest('Invalid prompt offset.')
    const chunk = prompt.slice(offset, offset + 1000)
    return Effect.succeed({
      chunk,
      nextOffset:
        offset + chunk.length < prompt.length ? offset + chunk.length : null,
    })
  }
  if (command === 'register')
    return postEvent({
      kind: 'relay',
      taskId: uuid(id),
      automationId: string(token, 'automation ID'),
      token: uuid(detail),
    })
  if (command === 'catalog')
    return jsonInput(process.stdin).pipe(
      Effect.flatMap((input) =>
        attempt(
          'validate catalog',
          () =>
            decodeEvent({
              kind: 'catalog',
              tasks: object(input).tasks,
            }) as RoomEvent,
        ),
      ),
      Effect.flatMap(postEvent),
    )
  if (command === 'connect') {
    const worker = state.workers.find((w) => w.id === uuid(id))
    if (!worker || worker.token !== token)
      throw invalidRequest('Unknown or expired connection request.')
    return postEvent({
      kind: 'connect',
      workerId: worker.id,
      token: uuid(token),
    })
  }
  if (command === 'take' || command === 'reply' || command === 'progress') {
    const worker = state.workers.find((w) => w.id === uuid(id))
    const delivery = state.deliveries.find(
      (d) => d.id === uuid(token) && d.workerId === worker?.id,
    )
    if (!worker || !delivery)
      throw invalidRequest('This delivery does not belong to your task.')
    if (delivery.status === 'replied')
      return Effect.succeed({ completed: true })
    if (
      delivery.status !== 'pending' ||
      !fs.existsSync(path.join(directory, 'claims', delivery.id))
    )
      throw invalidRequest(
        'This delivery has not been dispatched. Wait for your turn.',
      )
    if (command === 'take') {
      const acknowledge = delivery.startedAt
        ? Effect.void
        : postEvent({
            kind: 'started',
            workerId: worker.id,
            deliveryId: delivery.id,
          })
      return acknowledge.pipe(
        Effect.zipRight(
          attempt('refresh delivery conversation', () => {
            const fresh = readState(directory)
            const current = fresh.deliveries.find((d) => d.id === delivery.id)!
            return current.status === 'replied'
              ? { completed: true }
              : envelope(fresh, current, directory)
          }),
        ),
      )
    }
    return jsonInput(process.stdin).pipe(
      Effect.flatMap((input) =>
        attempt('validate reply', () => {
          const body = object(input)
          return decodeEvent({
            kind: command,
            workerId: worker.id,
            deliveryId: delivery.id,
            text: body.text,
            to: body.to ?? [],
          }) as RoomEvent
        }),
      ),
      Effect.flatMap(postEvent),
    )
  }
  if (command === 'sent' || command === 'attention') {
    const failure = command === 'attention' ? token : undefined
    if (
      failure &&
      !['approval', 'uncertain', 'task', 'storage'].includes(failure)
    )
      throw invalidRequest('Choose a valid failure category.')
    return attempt('record delivery receipt', () =>
      mark(
        directory,
        uuid(id),
        command,
        detail ?? '',
        failure as FailureKind | undefined,
      ),
    )
  }
  if (command === 'relay-attention' || command === 'offline')
    return attempt('record relay presence', () => {
      const status = command === 'offline' ? 'offline' : 'attention'
      atomicWrite(path.join(directory, 'relay-presence.json'), {
        status,
        ...(status === 'attention'
          ? { detail: string(id, 'relay failure') }
          : {}),
        at: Date.now(),
        pid: process.pid,
      })
      return status === 'offline' ? { stopped: true } : { recorded: true }
    })
  if (command !== 'next') throw invalidRequest('Unknown Crews command.')
  return listen(id === 'compact')
}

const program = Effect.gen(function* () {
  const config = yield* attempt('load runtime configuration', runtimeConfig)
  if (command === 'install-hook')
    return yield* attempt('install Crews context hooks', () => ({
      ...installContextHooks(codexHooksFile(), runtime, config.nodeCommand),
      installed: true,
      trustRequired: true,
    }))
  const state = yield* attempt('read room', () => readState(config.directory))
  const action = yield* attempt('validate helper command', () =>
    dispatch(config, state),
  )
  return yield* action.pipe(
    Effect.provide(
      deliveryRuntimeLive(config.directory, runtime, config.nodeCommand),
    ),
  )
}).pipe(
  Effect.tap((value) => Effect.sync(() => console.log(JSON.stringify(value)))),
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      if (!Cause.isInterruptedOnly(cause)) {
        console.error(Cause.pretty(cause))
        process.exitCode = 1
      }
    }),
  ),
)
const fiber = Effect.runFork(program)
const interrupt = () => {
  Effect.runFork(Fiber.interrupt(fiber))
}
process.once('SIGTERM', interrupt)
process.once('SIGINT', interrupt)
