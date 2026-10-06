import fs from 'node:fs'
import path from 'node:path'
import { withAppServer, type AppServerClient } from './app-server.js'
import { managedPermissionSettings, verifyPermissions } from './create-task.js'
import { Room } from './room.js'
import { isManagedWriterConflict } from '../shared/contracts.js'
import { atomicWrite, optionalJSON } from './storage.js'

type RunClient = <T>(
  run: (client: AppServerClient) => Promise<T>,
  options: { experimentalApi: true },
) => Promise<T>

const retries = new Set<string>()

type Recovery = { sourceId: string; forkId: string | null }

function recoveryPath(room: Room, deliveryId: string): string {
  return path.join(room.directory, 'recoveries', deliveryId + '.json')
}

function readRecovery(file: string): Recovery | null {
  const value = optionalJSON(file)
  if (value === undefined) return null
  const saved = record(value, 'recovery record')
  if (
    typeof saved.sourceId !== 'string' ||
    (saved.forkId !== null && typeof saved.forkId !== 'string')
  )
    throw new Error(
      'Crews found an invalid recovery record. The delivery is still held.',
    )
  return saved as Recovery
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Codex returned invalid ${label}.`)
  return value as Record<string, unknown>
}

async function historyFork(
  client: AppServerClient,
  sourceId: string,
  title: string,
  permission: 'auto' | 'full',
  file: string,
  existing: Recovery | null,
): Promise<string> {
  let newId = existing?.forkId
  if (!newId) {
    const turns = record(
      await client.request('thread/turns/list', {
        threadId: sourceId,
        limit: 1,
        sortDirection: 'desc',
        itemsView: 'notLoaded',
      }),
      'turn list',
    )
    if (!Array.isArray(turns.data))
      throw new Error('Codex did not return turns.')
    const latest = turns.data[0]
    if (latest === undefined)
      throw new Error('Codex did not return a saved turn to recover from.')
    const turn = record(latest, 'latest turn')
    if (!['completed', 'interrupted', 'failed'].includes(String(turn.status)))
      throw new Error(
        'Codex is still working in this task. Retry after it finishes.',
      )
    if (typeof turn.id !== 'string')
      throw new Error('Codex did not return the latest turn ID.')

    // A lost fork response must never turn the next click into a second fork.
    atomicWrite(file, { sourceId, forkId: null } satisfies Recovery)
    let forked: Record<string, unknown>
    try {
      forked = record(
        await client.request('thread/fork', {
          threadId: sourceId,
          lastTurnId: turn.id,
        }),
        'fork response',
      )
    } catch (cause) {
      throw new Error(
        'Codex did not confirm whether it created a recovery task. This delivery is still held; check the Codex task before trying again.',
        { cause },
      )
    }
    const thread = record(forked.thread, 'forked thread')
    if (
      typeof thread.id !== 'string' ||
      !thread.id ||
      thread.id === sourceId ||
      (thread.forkedFromId !== undefined && thread.forkedFromId !== sourceId)
    )
      throw new Error('Codex did not confirm a distinct history fork.')
    newId = thread.id
    atomicWrite(file, { sourceId, forkId: newId } satisfies Recovery)
  }
  const settings = managedPermissionSettings(permission)
  const resumeParams = {
    threadId: newId,
    excludeTurns: true,
    approvalPolicy: settings.approvalPolicy,
    approvalsReviewer: settings.approvalsReviewer,
    permissions: settings.profileId,
  }
  let permissionsApplied = false
  for (let attempt = 0; attempt < 2; attempt++) {
    const resumed = record(
      await client.request('thread/resume', resumeParams),
      'fork permissions',
    )
    try {
      verifyPermissions(resumed, settings)
      permissionsApplied = true
      break
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
  if (!permissionsApplied)
    throw new Error('Codex did not apply the selected task permissions.')
  await client.request('thread/name/set', {
    threadId: newId,
    name: `${title} — Crews recovery ${newId.slice(0, 8)}`,
  })
  return newId
}

/** A click retries once. A desktop-held writer first moves the teammate to a named history fork. */
export async function retryManagedDelivery(
  room: Room,
  deliveryId: string,
  runClient: RunClient = withAppServer,
): Promise<void> {
  if (retries.has(deliveryId))
    throw new Error('This message is already being recovered.')
  retries.add(deliveryId)
  try {
    room.drain()
    const { worker, previous } = room.managedRetryTarget(deliveryId)
    const sourceId = worker.managed?.threadId
    const file = recoveryPath(room, deliveryId)
    const journal = readRecovery(file)
    // The teammate already adopted this fork; a leftover journal belongs to
    // the previous attempt and must not block recovery from a new writer lock.
    const saved = journal?.forkId === sourceId ? null : journal
    if (saved && sourceId !== saved.sourceId)
      throw new Error(
        'This teammate changed during recovery. The delivery is still held.',
      )
    if (
      sourceId &&
      isManagedWriterConflict(previous.failure, previous.detail, sourceId)
    ) {
      if (saved && !saved.forkId)
        throw new Error(
          'Codex may have created a recovery task without confirming its ID. The delivery is still held; check Codex before retrying.',
        )
      const newId = await runClient(
        (client) =>
          historyFork(
            client,
            sourceId,
            worker.title,
            worker.managed!.permission,
            file,
            saved,
          ),
        { experimentalApi: true },
      )
      // The fork's app-server has closed before the scheduler may start a turn.
      room.replaceManagedThread(deliveryId, sourceId, newId)
    }
    room.retryManaged(deliveryId)
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // A later writer lock recognizes this as an already adopted fork.
    }
  } finally {
    retries.delete(deliveryId)
  }
}
