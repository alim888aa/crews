import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTaskWithClient,
  CreatedTaskError,
} from '../backend/create-task.js'
import type {
  AppServerClient,
  AppServerMessage,
} from '../backend/app-server.js'

function fakeClient(options: { complete?: boolean; listed?: boolean } = {}) {
  const calls: string[] = []
  const listeners = new Set<(message: AppServerMessage) => void>()
  const client: AppServerClient = {
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async request(method, params) {
      calls.push(method)
      if (method === 'thread/start') return { thread: { id: 'new-task' } }
      if (method === 'thread/name/set') return {}
      if (method === 'turn/start') {
        const input = (params as { input: { text: string }[] }).input
        assert.match(
          input[0]!.text,
          /Do not use tools, read files, or make changes/,
        )
        if (options.complete !== false)
          queueMicrotask(() => {
            for (const listener of listeners)
              listener({
                method: 'turn/completed',
                params: {
                  threadId: 'new-task',
                  turn: { id: 'first-turn', status: 'completed' },
                },
              })
          })
        return { turn: { id: 'first-turn' } }
      }
      if (method === 'thread/list')
        return {
          data:
            options.listed === false
              ? []
              : [
                  {
                    id: 'new-task',
                    name: 'New teammate',
                    preview: '',
                    cwd: '/project',
                    updatedAt: 1,
                    source: 'vscode',
                    ephemeral: false,
                    parentThreadId: null,
                  },
                ],
          nextCursor: null,
        }
      throw new Error(`Unexpected request ${method}`)
    },
    async close() {},
  }
  return { client, calls, listeners }
}

test('creation waits for the first turn and confirms the same desktop task ID', async () => {
  const { client, calls, listeners } = fakeClient()
  const result = await createTaskWithClient(
    client,
    'New teammate',
    '/project',
    50,
  )
  assert.equal(result.task.id, 'new-task')
  assert.deepEqual(calls, [
    'thread/start',
    'turn/start',
    'thread/name/set',
    'thread/list',
  ])
  assert.equal(listeners.size, 0)
})

test('uncertain first turn exposes the created ID without starting another turn', async () => {
  const { client, calls, listeners } = fakeClient({ complete: false })
  await assert.rejects(
    createTaskWithClient(client, 'New teammate', '/project', 2),
    (error: unknown) =>
      error instanceof CreatedTaskError &&
      error.taskId === 'new-task' &&
      /If it appears, select it instead of creating another/.test(
        error.message,
      ),
  )
  assert.equal(calls.filter((method) => method === 'turn/start').length, 1)
  assert.equal(listeners.size, 0)
})

test('completed but unlisted task stays recoverable by its exact ID', async () => {
  const { client } = fakeClient({ listed: false })
  await assert.rejects(
    createTaskWithClient(client, 'New teammate', '/project', 50),
    (error: unknown) =>
      error instanceof CreatedTaskError && error.taskId === 'new-task',
  )
})

test('lost thread-start response warns that the task may already exist', async () => {
  const { client, calls } = fakeClient()
  client.request = async (method) => {
    calls.push(method)
    throw new Error('Transport timed out')
  }
  await assert.rejects(
    createTaskWithClient(client, 'New teammate', '/project', 50),
    /Codex may have started “New teammate”.*check for it before creating another/,
  )
  assert.deepEqual(calls, ['thread/start'])
})
