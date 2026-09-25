import fs from 'node:fs'
import path from 'node:path'
import type { RecentTask } from '../shared/contracts.js'
import { withAppServer, type AppServerClient } from './app-server.js'
import { fetchModelCatalog, validateModelChoice } from './model-catalog.js'
import { fetchTaskCatalog } from './task-catalog.js'

const TURN_TIMEOUT_MS = 90_000

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Codex app-server returned invalid ${label}.`)
  return value as Record<string, unknown>
}

function taskFolder(value: string): string {
  if (!value.trim() || !path.isAbsolute(value))
    throw new Error('Choose an absolute project folder.')
  const cwd = path.resolve(value)
  try {
    if (!fs.statSync(cwd).isDirectory())
      throw new Error('The chosen project path is not a folder.')
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'The chosen project path is not a folder.'
    )
      throw error
    throw new Error('The chosen project folder is unavailable.', {
      cause: error,
    })
  }
  return cwd
}

function turnId(value: unknown): string {
  const turn = record(record(value, 'turn response').turn, 'turn')
  if (typeof turn.id !== 'string' || !turn.id)
    throw new Error('Codex app-server did not return a turn ID.')
  return turn.id
}

/** A failure after thread/start exposes its exact ID so the user can recover it. */
export class CreatedTaskError extends Error {
  constructor(
    readonly taskId: string,
    cause: unknown,
  ) {
    super(
      `Codex task ${taskId} was started, but Crews could not confirm it is ready. Refresh tasks and search for this ID. If it appears, select it instead of creating another. ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}

async function waitForTurn(
  client: AppServerClient,
  threadId: string,
  start: () => Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  const completed = new Map<string, string>()
  let wake: (() => void) | undefined
  const unsubscribe = client.onNotification((message) => {
    if (message.method !== 'turn/completed') return
    if (!message.params || typeof message.params !== 'object') return
    const params = message.params as Record<string, unknown>
    if (params.threadId !== threadId) return
    if (!params.turn || typeof params.turn !== 'object') return
    const turn = params.turn as Record<string, unknown>
    if (typeof turn.id !== 'string') return
    completed.set(turn.id, String(turn.status))
    wake?.()
  })
  try {
    const id = turnId(await start())
    if (!completed.has(id)) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          wake = undefined
          reject(new Error('The first Codex message did not finish in time.'))
        }, timeoutMs)
        wake = () => {
          if (!completed.has(id)) return
          clearTimeout(timer)
          resolve()
        }
        wake()
      })
    }
    if (completed.get(id) !== 'completed')
      throw new Error(`The first Codex turn ended as ${completed.get(id)}.`)
  } finally {
    unsubscribe()
  }
}

export async function createTaskWithClient(
  client: AppServerClient,
  title: string,
  cwd: string,
  model: string,
  effort: string,
  timeoutMs = TURN_TIMEOUT_MS,
): Promise<{ task: RecentTask; catalog: RecentTask[] }> {
  validateModelChoice(await fetchModelCatalog(client.request), model, effort)
  let id: string
  try {
    const started = record(
      await client.request('thread/start', { cwd, model, ephemeral: false }),
      'thread start',
    )
    const thread = record(started.thread, 'new thread')
    if (typeof thread.id !== 'string' || !thread.id)
      throw new Error('Codex app-server did not return a task ID.')
    id = thread.id
  } catch (cause) {
    // There is no client idempotency key for thread/start. A lost reply is uncertain.
    throw new Error(
      `Codex may have started “${title}”, but Crews did not receive its ID. Refresh the Codex task list and check for it before creating another. ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
  try {
    // An empty thread is not durable in desktop. This one small turn saves it.
    await waitForTurn(
      client,
      id,
      () =>
        client.request('turn/start', {
          threadId: id,
          model,
          effort,
          input: [
            {
              type: 'text',
              text: `This Codex task was created in Crews as ${title}. Reply with exactly Ready. Do not use tools, read files, or make changes. Further instructions will arrive in this task.`,
              text_elements: [],
            },
          ],
        }),
      timeoutMs,
    )
    await client.request('thread/name/set', { threadId: id, name: title })
    const saved = record(
      record(
        await client.request('thread/read', { threadId: id }),
        'thread read',
      ).thread,
      'saved thread',
    )
    if (saved.model !== model || saved.reasoningEffort !== effort)
      throw new Error('Codex did not retain the selected model and effort.')
    const catalog = await fetchTaskCatalog(client.request)
    const task = catalog.find((item) => item.id === id)
    if (!task)
      throw new Error('The completed task is not in the desktop task list yet.')
    return { task, catalog }
  } catch (cause) {
    throw new CreatedTaskError(id, cause)
  }
}

export async function createCodexTask(input: {
  title: string
  cwd: string
  model: string
  effort: string
}): Promise<{ task: RecentTask; catalog: RecentTask[] }> {
  const title = input.title.trim()
  if (!title || title.length > 100)
    throw new Error('Use a task name up to 100 characters.')
  const cwd = taskFolder(input.cwd)
  return withAppServer((client) =>
    createTaskWithClient(client, title, cwd, input.model, input.effort),
  )
}
