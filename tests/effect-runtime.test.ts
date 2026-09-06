import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  Deferred,
  Effect,
  Either,
  Fiber,
  Layer,
  TestClock,
  TestContext,
} from 'effect'
import {
  DeliveryRuntime,
  deliveryRuntimeLive,
  listen,
  postEvent,
} from '../backend/delivery-runtime.js'
import {
  type BackendError,
  attemptAsync,
  EventRejected,
  invalidRequest,
} from '../backend/errors.js'
import { jsonInput } from '../backend/input.js'
import { atomicWrite } from '../backend/storage.js'
import { Room } from '../backend/room.js'
import type { RoomEvent } from '../shared/contracts.js'

const event: RoomEvent = { kind: 'catalog', tasks: [] }
const service = (overrides: Partial<ContextService> = {}): ContextService => ({
  publish: () => Effect.succeed('event.json'),
  accepted: () => Effect.succeed(false),
  listener: Effect.void,
  poll: () => Effect.succeed(undefined),
  idle: Effect.succeed({ waiting: true, inFlight: [] }),
  ...overrides,
})
type ContextService = typeof DeliveryRuntime.Service

test('receipt timeout uses TestClock and never republishes the event', async () => {
  let writes = 0,
    checks = 0
  await Effect.runPromise(
    Effect.gen(function* () {
      const published = yield* Deferred.make<void>()
      const layer = Layer.succeed(
        DeliveryRuntime,
        service({
          publish: () =>
            Effect.sync(() => {
              writes++
              return 'event.json'
            }).pipe(Effect.tap(() => Deferred.succeed(published, undefined))),
          accepted: () =>
            Effect.sync(() => {
              checks++
              return false
            }),
        }),
      )
      const fiber = yield* postEvent(event).pipe(
        Effect.provide(layer),
        Effect.fork,
      )
      yield* Deferred.await(published)
      yield* TestClock.adjust('10 seconds')
      assert.deepEqual(yield* Fiber.join(fiber), {
        accepted: false,
        queued: true,
      })
      assert.equal(writes, 1)
      assert.ok(checks > 1)
      const finished = checks
      yield* TestClock.adjust('1 minute')
      assert.equal(checks, finished)
    }).pipe(Effect.provide(TestContext.TestContext)),
  )
})

test('accepted and rejected receipts stop polling without retries', async () => {
  for (const rejected of [false, true]) {
    let writes = 0,
      checks = 0
    const layer = Layer.succeed(
      DeliveryRuntime,
      service({
        publish: () =>
          Effect.sync(() => {
            writes++
            return 'one'
          }),
        accepted: () =>
          Effect.suspend(() => {
            checks++
            return rejected
              ? Effect.fail(
                  new EventRejected({
                    eventId: 'one',
                    message: 'Connection token expired.',
                  }),
                )
              : Effect.succeed(true)
          }),
      }),
    )
    const result: Either.Either<unknown, BackendError> =
      await Effect.runPromise(
        postEvent(event).pipe(Effect.provide(layer), Effect.either),
      )
    if (rejected) {
      assert.ok(Either.isLeft(result))
      assert.equal(result.left._tag, 'EventRejected')
    } else {
      assert.ok(Either.isRight(result))
      assert.deepEqual(result.right, { accepted: true })
    }
    assert.equal(writes, 1)
    assert.equal(checks, 1)
  }
})

test('interrupting receipt waiting leaves one published event and stops polling', async () => {
  let writes = 0,
    checks = 0
  await Effect.runPromise(
    Effect.gen(function* () {
      const polled = yield* Deferred.make<void>()
      const layer = Layer.succeed(
        DeliveryRuntime,
        service({
          publish: () =>
            Effect.sync(() => {
              writes++
              return 'one'
            }),
          accepted: () =>
            Effect.sync(() => {
              checks++
              return false
            }).pipe(Effect.tap(() => Deferred.succeed(polled, undefined))),
        }),
      )
      const fiber = yield* postEvent(event).pipe(
        Effect.provide(layer),
        Effect.fork,
      )
      yield* Deferred.await(polled)
      yield* Fiber.interrupt(fiber)
      const stopped = checks
      yield* TestClock.adjust('1 minute')
      assert.equal(checks, stopped)
      assert.equal(writes, 1)
    }).pipe(Effect.provide(TestContext.TestContext)),
  )
})

test('listener scope releases on timeout, success, failure and interruption', async () => {
  for (const outcome of [
    'timeout',
    'success',
    'failure',
    'interrupt',
  ] as const) {
    let released = 0
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const layer = Layer.succeed(
          DeliveryRuntime,
          service({
            listener: Effect.acquireRelease(
              Deferred.succeed(started, undefined),
              () =>
                Effect.sync(() => {
                  released++
                }),
            ).pipe(Effect.asVoid),
            poll: () =>
              outcome === 'success'
                ? Effect.succeed({ stopped: true })
                : outcome === 'failure'
                  ? Effect.fail(invalidRequest('Bad queue.'))
                  : Effect.succeed(undefined),
          }),
        )
        const fiber = yield* listen(false).pipe(
          Effect.provide(layer),
          Effect.either,
          Effect.fork,
        )
        yield* Deferred.await(started)
        if (outcome === 'interrupt') yield* Fiber.interrupt(fiber)
        else {
          if (outcome === 'timeout') yield* TestClock.adjust('50 seconds')
          const result = yield* Fiber.join(fiber)
          if (outcome === 'failure') {
            assert.ok(Either.isLeft(result))
            assert.equal(result.left._tag, 'InvalidRequest')
          } else {
            assert.ok(Either.isRight(result))
            assert.deepEqual(
              result.right,
              outcome === 'timeout'
                ? { waiting: true, inFlight: [] }
                : { stopped: true },
            )
          }
        }
        assert.equal(released, 1)
      }).pipe(Effect.provide(TestContext.TestContext)),
    )
  }
})

test('live listener excludes a second owner and preserves a replacement lease', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-effect-lease-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const room = new Room(directory)
  room.receive({ kind: 'catalog', tasks: [] })
  atomicWrite(path.join(directory, 'host.json'), {
    running: true,
    pid: process.pid,
  })
  const layer = deliveryRuntimeLive(directory, '/unused', ['node'])
  const lock = path.join(directory, 'listener.json')
  await Effect.runPromise(
    Effect.gen(function* () {
      const first = yield* listen(false).pipe(
        Effect.provide(layer),
        Effect.fork,
      )
      yield* TestClock.adjust('1 second')
      assert.ok(fs.existsSync(lock))
      const second = yield* listen(false).pipe(
        Effect.provide(layer),
        Effect.either,
      )
      assert.ok(Either.isLeft(second))
      assert.equal(second.left._tag, 'ListenerBusy')
      const replacement = { pid: process.pid, lease: randomUUID() }
      atomicWrite(lock, replacement)
      yield* Fiber.interrupt(first)
      assert.deepEqual(JSON.parse(fs.readFileSync(lock, 'utf8')), replacement)
    }).pipe(Effect.provide(TestContext.TestContext)),
  )
})

test('external Promise failures retain their category', async () => {
  const input = invalidRequest('That @name is already taken.')
  const a = await Effect.runPromise(
    attemptAsync('UI request', () => Promise.reject(input)).pipe(Effect.either),
  )
  assert.ok(Either.isLeft(a))
  assert.equal(a.left, input)
  const denied = Object.assign(new Error('Access denied'), { code: 'EACCES' })
  const b = await Effect.runPromise(
    attemptAsync('read file', () => {
      throw denied
    }).pipe(Effect.either),
  )
  assert.ok(Either.isLeft(b))
  assert.equal(b.left._tag, 'StorageError')
})

test('JSON input preserves split UTF-8 and removes listeners after completion or interruption', async () => {
  const input = new PassThrough()
  const result = Effect.runPromise(jsonInput(input))
  const bytes = Buffer.from('{"text":"🛹"}')
  for (const byte of bytes) input.write(Buffer.from([byte]))
  input.end()
  assert.deepEqual(await result, { text: '🛹' })
  assert.equal(input.listenerCount('data'), 0)
  const waiting = new PassThrough()
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* jsonInput(waiting).pipe(Effect.fork)
      yield* Effect.yieldNow()
      assert.equal(waiting.listenerCount('data'), 1)
      yield* Fiber.interrupt(fiber)
      for (const event of ['data', 'error', 'end', 'close'])
        assert.equal(waiting.listenerCount(event), 0)
    }),
  )
  waiting.destroy()
})
