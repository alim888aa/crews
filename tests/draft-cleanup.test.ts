import test from 'node:test'
import assert from 'node:assert/strict'
import type { RoomState } from '../shared/contracts.js'

test('failed draft cleanup never blocks snapshots or turns a committed deletion into failure', async () => {
  let failWrites = true
  const saved = new Map<string, string>([
    ['crews-drafts-v3', JSON.stringify({ 'channel:gone': 'old draft' })],
  ])
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error('storage unavailable')
        saved.set(key, value)
      },
    },
  })
  let receive: (state: RoomState) => void = () => {
    throw new Error('not connected')
  }
  let snapshot: RoomState
  Object.assign(globalThis, {
    window: {
      crew: {
        onState: (callback: typeof receive) => {
          receive = callback
          return () => {}
        },
        onError: () => () => {},
        snapshot: async () => snapshot,
        deleteChannel: async (id: string) => {
          snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            channels: snapshot.channels.filter((c) => c.id !== id),
          }
          receive(snapshot)
          return []
        },
      },
    },
  })
  // Load the renderer under the test's browser globals without pulling its DOM
  // types into the separate Node-only backend TypeScript project.
  const moduleUrl = new URL('../src/store.ts', import.meta.url).href
  const store = await import(moduleUrl)
  snapshot = { ...store.getSnapshot(), revision: 1 }
  let notifications = 0
  store.subscribe(() => notifications++)
  await store.connect()
  assert.equal(
    notifications,
    1,
    'initial connection reaches subscribers despite storage failure',
  )
  assert.equal(store.getDrafts()['channel:gone'], undefined)
  assert.match(store.getRoomError(), /room changes were saved/)
  snapshot = { ...snapshot, revision: 2, paused: true }
  receive(snapshot)
  assert.equal(notifications, 2)
  assert.equal(store.getSnapshot().paused, true)
  failWrites = false
  snapshot = {
    ...snapshot,
    revision: 3,
    channels: [
      ...snapshot.channels,
      { id: 'project', name: 'project', memberIds: [] },
    ],
  }
  receive(snapshot)
  assert.equal(
    JSON.parse(saved.get('crews-drafts-v3')!)['channel:gone'],
    undefined,
    'cleanup retries when storage recovers',
  )
  store.setDraft('channel:project', 'to delete')
  failWrites = true
  await assert.doesNotReject(store.deleteChannel('project'))
  assert.equal(
    store.getSnapshot().channels.some((c: { id: string }) => c.id === 'project'),
    false,
  )
  assert.equal(store.getDrafts()['channel:project'], undefined)
  assert.equal(store.channelHasDraftWork('project'), false)
  assert.equal(notifications, 4)
})
