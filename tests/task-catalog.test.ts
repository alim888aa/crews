import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  fetchTaskCatalog,
  stopAppServer,
  type StoppableChild,
} from '../backend/task-catalog.js'

function thread(
  id: string,
  updatedAt: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: null,
    preview: `Task ${id}`,
    cwd: '/project',
    updatedAt,
    source: 'vscode',
    ephemeral: false,
    parentThreadId: null,
    ...extra,
  }
}

test('catalog follows every cursor, filters roots and deduplicates newest metadata', async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const pages = [
    {
      data: [
        thread('older', 2, { name: '  Named   task  ' }),
        thread('skip-cli', 99, { source: 'cli' }),
        thread('skip-child', 98, { parentThreadId: 'parent' }),
      ],
      nextCursor: 'page-2',
    },
    {
      data: [
        thread('newer', 3),
        thread('older', 1),
        thread('skip-ephemeral', 100, { ephemeral: true }),
      ],
      nextCursor: null,
    },
  ]
  const tasks = await fetchTaskCatalog(async (method, params) => {
    calls.push({ method, params: params as Record<string, unknown> })
    return pages[calls.length - 1]
  })
  assert.deepEqual(tasks, [
    { id: 'newer', title: 'Task newer', cwd: '/project', updatedAt: 3000 },
    { id: 'older', title: 'Named   task', cwd: '/project', updatedAt: 2000 },
  ])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0]!.params.modelProviders, [])
  assert.deepEqual(calls[0]!.params.sourceKinds, ['vscode'])
  assert.equal(calls[0]!.params.archived, false)
  assert.equal(calls[1]!.params.cursor, 'page-2')
})

test('catalog rejects malformed and repeated pagination instead of returning partial data', async () => {
  await assert.rejects(
    fetchTaskCatalog(async () => ({ data: [], nextCursor: 42 })),
    /invalid pagination cursor/,
  )
  await assert.rejects(
    fetchTaskCatalog(async () => ({ data: [], nextCursor: 'same' })),
    /repeated a pagination cursor/,
  )
  await assert.rejects(
    fetchTaskCatalog(async () => ({ nextCursor: null })),
    /without data/,
  )
})

test('app-server shutdown forces a stubborn child down and removes its listener', async () => {
  class StubbornChild extends EventEmitter implements StoppableChild {
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    signals: NodeJS.Signals[] = []
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      this.signals.push(signal)
      if (signal === 'SIGKILL')
        queueMicrotask(() => {
          this.signalCode = signal
          this.emit('close')
        })
      return true
    }
  }
  const child = new StubbornChild()
  await stopAppServer(child, 1, 20)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.listenerCount('close'), 0)
})

test('app-server shutdown leaves an already closed child alone', async () => {
  class ClosedChild extends EventEmitter implements StoppableChild {
    exitCode = 0
    signalCode: NodeJS.Signals | null = null
    kill(): boolean {
      throw new Error('should not kill an exited child')
    }
  }
  const child = new ClosedChild()
  await stopAppServer(child, 1, 1)
  assert.equal(child.listenerCount('close'), 0)
})
