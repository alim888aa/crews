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

function fakeClient(
  options: {
    complete?: boolean
    listed?: boolean
    permission?: 'auto' | 'full'
    wrongPermissions?: boolean
    profileAllowed?: boolean
  } = {},
) {
  const calls: string[] = []
  const permission = options.permission ?? 'auto'
  const approvalPolicy = permission === 'full' ? 'never' : 'on-request'
  const sandboxType =
    permission === 'full' ? 'dangerFullAccess' : 'workspaceWrite'
  const profileId = permission === 'full' ? ':danger-full-access' : ':workspace'
  const listeners = new Set<(message: AppServerMessage) => void>()
  const client: AppServerClient = {
    onRequest() {
      return () => {}
    },
    onClose() {
      return () => {}
    },
    onNotification(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async request(method, params) {
      calls.push(method)
      if (method === 'model/list')
        return {
          data: [
            {
              model: 'gpt-6-sol',
              displayName: 'GPT-6-Sol',
              description: 'Test model',
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: 'medium' },
                { reasoningEffort: 'high' },
              ],
              defaultReasoningEffort: 'medium',
              isDefault: true,
            },
          ],
          nextCursor: null,
        }
      if (method === 'permissionProfile/list') {
        assert.deepEqual(params, { cwd: '/project' })
        return {
          data: [{ id: profileId, allowed: options.profileAllowed !== false }],
          nextCursor: null,
        }
      }
      if (method === 'thread/start') {
        const request = params as {
          model: string
          approvalPolicy: string
          approvalsReviewer: string
          permissions: string
        }
        assert.equal(request.model, 'gpt-6-sol')
        assert.equal(request.approvalPolicy, approvalPolicy)
        assert.equal(request.approvalsReviewer, 'auto_review')
        assert.equal(request.permissions, profileId)
        return {
          thread: { id: 'new-task' },
          approvalPolicy: options.wrongPermissions
            ? 'on-request'
            : approvalPolicy,
          approvalsReviewer: 'auto_review',
          activePermissionProfile: { id: profileId },
          sandbox: { type: sandboxType },
        }
      }
      if (method === 'thread/name/set') return {}
      if (method === 'turn/start') {
        const request = params as {
          input: { text: string }[]
          model: string
          effort: string
          approvalPolicy: string
          approvalsReviewer: string
          permissions: string
        }
        assert.equal(request.model, 'gpt-6-sol')
        assert.equal(request.effort, 'high')
        assert.equal(request.approvalPolicy, approvalPolicy)
        assert.equal(request.approvalsReviewer, 'auto_review')
        assert.equal(request.permissions, profileId)
        const input = request.input
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
      if (method === 'thread/read')
        return {
          thread: { model: 'gpt-6-sol', reasoningEffort: 'high' },
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
    'gpt-6-sol',
    'high',
    'auto',
    50,
  )
  assert.equal(result.task.id, 'new-task')
  assert.deepEqual(calls, [
    'model/list',
    'permissionProfile/list',
    'thread/start',
    'turn/start',
    'thread/name/set',
    'thread/read',
    'thread/list',
  ])
  assert.equal(listeners.size, 0)
})

test('uncertain first turn exposes the created ID without starting another turn', async () => {
  const { client, calls, listeners } = fakeClient({ complete: false })
  await assert.rejects(
    createTaskWithClient(
      client,
      'New teammate',
      '/project',
      'gpt-6-sol',
      'high',
      'auto',
      2,
    ),
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
    createTaskWithClient(
      client,
      'New teammate',
      '/project',
      'gpt-6-sol',
      'high',
      'auto',
      50,
    ),
    (error: unknown) =>
      error instanceof CreatedTaskError && error.taskId === 'new-task',
  )
})

test('lost thread-start response warns that the task may already exist', async () => {
  const { client, calls } = fakeClient()
  const original = client.request
  client.request = async (method, params) => {
    if (method === 'thread/start') {
      calls.push(method)
      throw new Error('Transport timed out')
    }
    return original(method, params)
  }
  await assert.rejects(
    createTaskWithClient(
      client,
      'New teammate',
      '/project',
      'gpt-6-sol',
      'high',
      'auto',
      50,
    ),
    /Codex may have started “New teammate”.*check for it before creating another/,
  )
  assert.deepEqual(calls, [
    'model/list',
    'permissionProfile/list',
    'thread/start',
  ])
})

test('unsupported model effort is rejected before starting a task', async () => {
  const { client, calls } = fakeClient()
  await assert.rejects(
    createTaskWithClient(
      client,
      'New teammate',
      '/project',
      'gpt-6-sol',
      'ultra',
      'auto',
      50,
    ),
    /effort supported by that model/,
  )
  assert.deepEqual(calls, ['model/list'])
})

test('full access is applied to the task and its first turn', async () => {
  const { client } = fakeClient({ permission: 'full' })
  const result = await createTaskWithClient(
    client,
    'New teammate',
    '/project',
    'gpt-6-sol',
    'high',
    'full',
    50,
  )
  assert.equal(result.task.id, 'new-task')
})

test('creation stops if Codex rejects the requested permissions', async () => {
  const { client, calls } = fakeClient({
    permission: 'full',
    wrongPermissions: true,
  })
  await assert.rejects(
    createTaskWithClient(
      client,
      'New teammate',
      '/project',
      'gpt-6-sol',
      'high',
      'full',
      50,
    ),
    (error: unknown) =>
      error instanceof CreatedTaskError &&
      error.taskId === 'new-task' &&
      /did not apply the selected task permissions/.test(error.message),
  )
  assert.deepEqual(calls, [
    'model/list',
    'permissionProfile/list',
    'thread/start',
  ])
})

test('disallowed permission profile blocks creation before starting a task', async () => {
  const { client, calls } = fakeClient({
    permission: 'full',
    profileAllowed: false,
  })
  await assert.rejects(
    createTaskWithClient(
      client,
      'New teammate',
      '/project',
      'gpt-6-sol',
      'high',
      'full',
      50,
    ),
    /does not allow that permission mode/,
  )
  assert.deepEqual(calls, ['model/list', 'permissionProfile/list'])
})
