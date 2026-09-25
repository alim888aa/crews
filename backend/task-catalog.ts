import type { RecentTask } from '../shared/contracts.js'
import {
  withAppServer,
  stopAppServer,
  type AppServerRequest,
  type StoppableChild,
} from './app-server.js'

const PAGE_SIZE = 100
export { stopAppServer }
export type { StoppableChild }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Codex app-server returned invalid ${label}.`)
  return value as Record<string, unknown>
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function shortPreview(value: unknown): string {
  const title = cleanName(value).replace(/\s+/g, ' ')
  return title.length <= 80 ? title : title.slice(0, 79).trimEnd() + '…'
}

function taskFromThread(value: unknown): RecentTask | null {
  const thread = record(value, 'thread metadata')
  if (
    thread.source !== 'vscode' ||
    thread.ephemeral === true ||
    (thread.parentThreadId !== null && thread.parentThreadId !== undefined) ||
    typeof thread.id !== 'string' ||
    !thread.id ||
    typeof thread.cwd !== 'string' ||
    typeof thread.updatedAt !== 'number' ||
    !Number.isFinite(thread.updatedAt)
  )
    return null
  const title = cleanName(thread.name) || shortPreview(thread.preview)
  return {
    id: thread.id,
    title: title || 'Untitled task',
    cwd: thread.cwd,
    updatedAt: thread.updatedAt * 1000,
  }
}

/** Fetch every non-archived desktop task, rejecting rather than returning a partial catalog. */
export async function fetchTaskCatalog(
  request: AppServerRequest,
): Promise<RecentTask[]> {
  const tasks = new Map<string, RecentTask>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  do {
    const page = record(
      await request('thread/list', {
        cursor,
        limit: PAGE_SIZE,
        sortKey: 'updated_at',
        sortDirection: 'desc',
        modelProviders: [],
        sourceKinds: ['vscode'],
        archived: false,
        useStateDbOnly: true,
      }),
      'thread list',
    )
    if (!Array.isArray(page.data))
      throw new Error('Codex app-server returned a thread list without data.')
    for (const value of page.data) {
      const task = taskFromThread(value)
      const prior = task ? tasks.get(task.id) : undefined
      if (task && (!prior || task.updatedAt > prior.updatedAt))
        tasks.set(task.id, task)
    }
    if (page.nextCursor !== null && typeof page.nextCursor !== 'string')
      throw new Error('Codex app-server returned an invalid pagination cursor.')
    cursor = page.nextCursor as string | null
    if (cursor) {
      if (cursors.has(cursor))
        throw new Error('Codex app-server repeated a pagination cursor.')
      cursors.add(cursor)
    }
  } while (cursor)
  return [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadTaskCatalog(): Promise<RecentTask[]> {
  return withAppServer((client) => fetchTaskCatalog(client.request))
}
