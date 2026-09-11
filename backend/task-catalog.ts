import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { RecentTask } from '../shared/contracts.js'

const REQUEST_TIMEOUT_MS = 15_000
const PAGE_SIZE = 100

type Request = (method: string, params: unknown) => Promise<unknown>

export interface StoppableChild {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'close', listener: () => void): this
  removeListener(event: 'close', listener: () => void): this
}

/** Stop a child cleanly, then force it down without letting refresh hang forever. */
export async function stopAppServer(
  child: StoppableChild,
  termGraceMs = 500,
  killGraceMs = 500,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    let finished = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(termTimer)
      if (killTimer) clearTimeout(killTimer)
      child.removeListener('close', finish)
      resolve()
    }
    child.once('close', finish)
    const termTimer = setTimeout(() => {
      if (finished) return
      child.kill('SIGKILL')
      killTimer = setTimeout(finish, killGraceMs)
    }, termGraceMs)
    child.kill('SIGTERM')
  })
}

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
  request: Request,
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

function executableCandidates(): string[] {
  const applications = [
    '/Applications',
    path.join(process.env.HOME ?? '', 'Applications'),
  ]
  const bundled = applications.flatMap((directory) => [
    path.join(directory, 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
    path.join(directory, 'Codex.app', 'Contents', 'Resources', 'codex'),
  ])
  const fromPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'codex'))
  return [
    ...bundled,
    ...fromPath,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ]
}

function findCodex(): string {
  const executable = executableCandidates().find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  })
  if (!executable)
    throw new Error('Could not find the installed Codex executable.')
  return executable
}

function appServerClient(child: ChildProcessWithoutNullStreams): {
  request: Request
  close: () => Promise<void>
} {
  let nextId = 1
  let ended: Error | null = null
  let stderr = ''
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  const fail = (error: Error) => {
    if (ended) return
    ended = error
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    pending.clear()
  }
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4_000)
  })
  child.stdin.on('error', (cause) =>
    fail(new Error('Could not write to Codex app-server.', { cause })),
  )
  child.on('error', (cause) =>
    fail(new Error('Could not start Codex app-server.', { cause })),
  )
  child.on('close', (code) =>
    fail(
      new Error(
        `Codex app-server exited before completing the catalog request (${code}).${stderr.trim() ? ' ' + stderr.trim() : ''}`,
      ),
    ),
  )
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message: Record<string, unknown>
    try {
      message = record(JSON.parse(line), 'JSON-RPC message')
    } catch (cause) {
      fail(new Error('Codex app-server returned malformed JSON.', { cause }))
      return
    }
    if (typeof message.id !== 'number') return
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error !== undefined)
      item.reject(
        new Error(
          `Codex app-server rejected the request: ${JSON.stringify(message.error)}`,
        ),
      )
    else item.resolve(message.result)
  })
  return {
    request(method, params) {
      if (ended) return Promise.reject(ended)
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Codex app-server ${method} request timed out.`))
          child.kill('SIGTERM')
        }, REQUEST_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      })
    },
    async close() {
      child.stdin.end()
      await stopAppServer(child)
    },
  }
}

export async function loadTaskCatalog(): Promise<RecentTask[]> {
  const child = spawn(findCodex(), ['app-server', '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const client = appServerClient(child)
  try {
    await client.request('initialize', {
      clientInfo: { name: 'crews', title: 'Crews', version: '0.3.5' },
    })
    child.stdin.write(
      JSON.stringify({ method: 'initialized', params: {} }) + '\n',
    )
    return await fetchTaskCatalog(client.request)
  } finally {
    await client.close()
  }
}
