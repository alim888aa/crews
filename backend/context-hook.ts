import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect, Cause } from 'effect'
import { compactionRecovery } from './compaction.js'
import { loadIdentity } from './identity.js'
import { runtimeConfig } from './paths.js'
import { readState, receipt } from './room.js'
import { atomicWrite, object, uuid } from './storage.js'
import { attempt, invalidRequest } from './errors.js'
import { jsonInput } from './input.js'

// Both hooks run synchronously. This entrypoint never dispatches room work.
const program = Effect.gen(function* () {
  const input = yield* jsonInput(process.stdin, 2_000_000)
  const event = object(input)
  const sessionStart = event.hook_event_name === 'SessionStart'
  if (
    event.agent_id ||
    (!sessionStart && event.hook_event_name !== 'UserPromptSubmit')
  )
    return
  if (
    sessionStart &&
    !['startup', 'resume', 'clear', 'compact'].includes(String(event.source))
  )
    return
  const taskId = uuid(event.session_id)
  if (process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID !== taskId)
    throw invalidRequest('Hook session does not match the current task.')
  const config = runtimeConfig()
  const state = yield* attempt('read context room', () =>
    readState(config.directory),
  )
  const identity = yield* attempt('load teammate identity', () =>
    loadIdentity(state, config.directory, taskId, sessionStart),
  ).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
  const recovery =
    sessionStart && event.source === 'compact'
      ? yield* attempt('load compaction recovery', () =>
          compactionRecovery(
            state,
            taskId,
            path.dirname(fileURLToPath(import.meta.url)),
            config.nodeCommand,
            (id) =>
              fs.existsSync(path.join(config.directory, 'claims', id)) &&
              receipt(config.directory, id)?.status !== 'attention',
          ),
        ).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      : undefined
  const context = [identity?.context, recovery?.context]
    .filter(Boolean)
    .join('\n\n')
  if (!context) return
  yield* Effect.sync(() =>
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event.hook_event_name,
          additionalContext: context,
        },
      }),
    ),
  )
  // Checkpoints describe emitted output, never claim a model followed it.
  if (identity)
    yield* attempt('record identity context', identity.recordEmitted).pipe(
      Effect.catchAll(() => Effect.void),
    )
  if (recovery)
    yield* attempt('record compaction recovery', () =>
      atomicWrite(
        path.join(config.directory, 'compactions', taskId + '.json'),
        {
          at: Date.now(),
          taskId,
          deliveryId: recovery.deliveryId,
          messageId: recovery.messageId,
          contextEmitted: true,
        },
      ),
    ).pipe(Effect.catchAll(() => Effect.void))
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      if (!Cause.isInterruptedOnly(cause))
        console.error('Crews context unavailable:', Cause.pretty(cause))
    }),
  ),
)
// A missing/broken room must not stop ordinary Codex work.
await Effect.runPromise(program)
