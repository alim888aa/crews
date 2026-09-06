import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect, Cause } from 'effect'
import { compactionRecovery } from './compaction.js'
import { runtimeConfig } from './paths.js'
import { readState, receipt } from './room.js'
import { atomicWrite, object, uuid } from './storage.js'
import { attempt, invalidRequest } from './errors.js'
import { jsonInput } from './input.js'

// A one-shot Effect boundary: it never dispatches or executes room work.
const program = Effect.gen(function* () {
  const input = yield* jsonInput(process.stdin, 64_000)
  const pending = yield* attempt('load compaction recovery', () => {
    const event = object(input)
    if (
      event.hook_event_name !== 'SessionStart' ||
      event.source !== 'compact' ||
      event.agent_id
    )
      return
    const taskId = uuid(event.session_id)
    if (process.env.CODEX_THREAD_ID && process.env.CODEX_THREAD_ID !== taskId)
      throw invalidRequest('Hook session does not match the current task.')
    const config = runtimeConfig()
    const recovery = compactionRecovery(
      readState(config.directory),
      taskId,
      path.dirname(fileURLToPath(import.meta.url)),
      config.nodeCommand,
      (id) =>
        fs.existsSync(path.join(config.directory, 'claims', id)) &&
        receipt(config.directory, id)?.status !== 'attention',
    )
    return recovery
      ? { recovery, taskId, directory: config.directory }
      : undefined
  })
  if (!pending) return
  const { recovery, taskId, directory } = pending
  yield* Effect.sync(() =>
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: recovery.context,
        },
      }),
    ),
  )
  // This diagnostic must not prevent the already-built context from being delivered.
  yield* attempt('record compaction recovery', () =>
    atomicWrite(path.join(directory, 'compactions', taskId + '.json'), {
      at: Date.now(),
      taskId,
      deliveryId: recovery.deliveryId,
      messageId: recovery.messageId,
      contextEmitted: true,
    }),
  ).pipe(Effect.catchAll(() => Effect.void))
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      if (!Cause.isInterruptedOnly(cause))
        console.error(
          'Crews compaction recovery unavailable:',
          Cause.pretty(cause),
        )
    }),
  ),
)
// A missing/broken room must not stop normal Codex work.
await Effect.runPromise(program)
