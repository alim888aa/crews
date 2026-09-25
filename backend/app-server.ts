import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const REQUEST_TIMEOUT_MS = 15_000

export type AppServerMessage = Record<string, unknown>
export type AppServerRequest = (
  method: string,
  params: unknown,
) => Promise<unknown>

export interface StoppableChild {
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals): boolean
  once(event: 'close', listener: () => void): this
  removeListener(event: 'close', listener: () => void): this
}

/** Stop a child cleanly, then force it down without hanging the caller. */
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

function findCodex(): string {
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
  const executable = [
    ...bundled,
    ...fromPath,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ].find((candidate) => {
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

export interface AppServerClient {
  request: AppServerRequest
  onNotification(listener: (message: AppServerMessage) => void): () => void
  close(): Promise<void>
}

function clientFor(child: ChildProcessWithoutNullStreams): AppServerClient {
  let nextId = 1
  let ended: Error | null = null
  let stderr = ''
  const listeners = new Set<(message: AppServerMessage) => void>()
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
        `Codex app-server exited before completing the request (${code}).${stderr.trim() ? ' ' + stderr.trim() : ''}`,
      ),
    ),
  )
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message: AppServerMessage
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Invalid JSON-RPC message.')
      message = parsed as AppServerMessage
    } catch (cause) {
      fail(new Error('Codex app-server returned malformed JSON.', { cause }))
      return
    }
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        // Creation never delegates tool or approval requests to the app.
        child.stdin.write(
          JSON.stringify({
            id: message.id,
            error: { code: -32601, message: 'Unsupported Crews request.' },
          }) + '\n',
        )
      } else for (const listener of listeners) listener(message)
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
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async close() {
      child.stdin.end()
      await stopAppServer(child)
    },
  }
}

export async function withAppServer<T>(
  run: (client: AppServerClient) => Promise<T>,
): Promise<T> {
  const child = spawn(findCodex(), ['app-server', '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const client = clientFor(child)
  try {
    await client.request('initialize', {
      clientInfo: { name: 'crews', title: 'Crews', version: '0.3.6' },
    })
    child.stdin.write(
      JSON.stringify({ method: 'initialized', params: {} }) + '\n',
    )
    return await run(client)
  } finally {
    await client.close()
  }
}
