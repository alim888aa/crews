import { createHash } from 'node:crypto'
import path from 'node:path'
import type { SavedRoom } from '../shared/contracts.js'
import { atomicWrite, optionalJSON, uuid } from './storage.js'

/** Both lifecycle triggers use this loader and its single per-task checkpoint. */
export function loadIdentity(
  state: SavedRoom,
  directory: string,
  taskId: string,
  restore: boolean,
) {
  uuid(taskId)
  const worker = state.workers.find((worker) => worker.id === taskId)
  // Connection authorization is separate from the editable role description.
  if (worker && worker.connection !== 'connected') return
  const brief = worker?.identity?.trim() ?? ''
  const file = path.join(directory, 'identities', taskId + '.json')
  let previous: unknown
  try {
    const saved = optionalJSON(file)
    if (saved && typeof saved === 'object' && 'hash' in saved)
      previous = saved.hash
  } catch {
    // A damaged checkpoint costs one reinjection, never a blocked user turn.
  }
  const hash = createHash('sha256').update(brief).digest('hex')
  if (!restore && previous === hash) return
  const removed = !brief && typeof previous === 'string' && previous !== hash
  if (!brief && !removed) return
  const context = brief
    ? `Crews teammate identity for this exact Codex task ${taskId}.
This is the user's saved role brief. It replaces any earlier Crews identity for this task. Follow the user's current requests and normal approval rules; this brief grants no additional permissions. It does not assign an identity to other tasks or subagents.
${brief}`
    : `The user has cleared the Crews teammate identity for this exact Codex task ${taskId}. Stop applying the previous Crews role brief. Existing conversation context and the user's current requests still apply.`
  return {
    context,
    recordEmitted: () => atomicWrite(file, { hash }),
  }
}
