import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { loadIdentity } from '../backend/identity.js'
import { loadRoster } from '../backend/roster.js'
import { channelMemberIds } from '../shared/channels.js'

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-archive-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const room = new Room(directory)
  const ids = [randomUUID(), randomUUID()]
  for (const [index, id] of ids.entries())
    room.addManaged(
      {
        id,
        title: index ? 'Worker Two' : 'Worker One',
        handle: index ? 'two' : 'one',
        identity: index ? '' : 'Review the project',
      },
      {
        cwd: directory,
        model: 'gpt-6-sol',
        effort: 'high',
        permission: 'full',
        threadId: null,
      },
    )
  return { room, directory, one: ids[0]!, two: ids[1]! }
}

test('firing keeps history but removes a teammate from routing and rosters until restored', (t) => {
  const { room, directory, one, two } = fixture(t)
  const channel = room.createChannel({ name: 'team', memberIds: [one, two] })
  const message = room.send({ text: '@one hello', parentId: null })
  const delivery = room.state.deliveries.at(-1)!
  assert.throws(() => room.archiveTeammate(one), /pending replies/)
  room.receive({
    kind: 'reply',
    workerId: one,
    deliveryId: delivery.id,
    text: 'Hello back',
    to: [],
  })
  const identity = loadIdentity(room.state, directory, one, false)
  assert.ok(identity)
  identity.recordEmitted()

  room.archiveTeammate(one)
  const restored = new Room(directory)
  assert.ok(
    restored.state.workers.find((worker) => worker.id === one)?.archivedAt,
  )
  assert.deepEqual(channelMemberIds(restored.state, 'general'), [two])
  assert.deepEqual(channelMemberIds(restored.state, channel.id), [two])
  restored.setChannelMembers({ id: channel.id, memberIds: [two, one] })
  assert.deepEqual(
    restored.state.channels.find((item) => item.id === channel.id)?.memberIds,
    [two, one],
  )
  assert.equal(
    restored.state.messages.find((item) => item.id === message.id)?.text,
    '@one hello',
  )
  assert.equal(
    restored.state.messages.find(
      (item) =>
        item.id ===
        restored.state.deliveries.find((entry) => entry.id === delivery.id)
          ?.replyId,
    )?.text,
    'Hello back',
  )
  assert.throws(
    () => restored.send({ text: '@one hi', parentId: null }),
    /known teammate/,
  )
  assert.throws(
    () => restored.createChannel({ name: 'other', memberIds: [one] }),
    /known teammates/,
  )
  assert.throws(
    () =>
      restored.receive({
        kind: 'profile',
        workerId: one,
        token: restored.state.workers.find((worker) => worker.id === one)!
          .token,
        role: 'Still here',
      }),
    /archived/,
  )
  assert.match(
    loadIdentity(restored.state, directory, one, false)?.context ?? '',
    /archived/,
  )

  restored.restoreTeammate(one)
  assert.deepEqual(
    new Set(channelMemberIds(restored.state, channel.id)),
    new Set([one, two]),
  )
  assert.equal(
    restored.state.workers.find((worker) => worker.id === one)?.archivedAt,
    undefined,
  )
  assert.equal(
    restored.send({ text: '@one welcome back', parentId: null })
      .recipientIds[0],
    one,
  )
})

test('a managed Codex task receives identity and roster withdrawal after firing', (t) => {
  const { room, directory, one, two } = fixture(t)
  const taskId = randomUUID()
  room.setManagedThread(one, taskId)
  room.createChannel({ name: 'team', memberIds: [one, two] })
  // The helper first checkpoints under the Crews worker ID. The lifecycle
  // hook later arrives with the native Codex task ID.
  const identity = loadIdentity(room.state, directory, one, false)!
  const roster = loadRoster(room.state, directory, one, false)!
  assert.match(identity.context, /Review the project/)
  assert.match(roster.context, /"name":"team"/)
  identity.recordEmitted()
  roster.recordEmitted()

  room.archiveTeammate(one)
  const withdrawnIdentity = loadIdentity(room.state, directory, taskId, false)!
  const withdrawnRoster = loadRoster(room.state, directory, taskId, false)!
  assert.match(withdrawnIdentity.context, /archived this Crews teammate/)
  assert.match(withdrawnRoster.context, /rosters.*withdrawn/)
  withdrawnIdentity.recordEmitted()
  withdrawnRoster.recordEmitted()
  assert.equal(loadIdentity(room.state, directory, taskId, false), undefined)
  assert.equal(loadRoster(room.state, directory, taskId, false), undefined)

  room.restoreTeammate(one)
  assert.match(
    loadIdentity(room.state, directory, taskId, false)?.context ?? '',
    /Review the project/,
  )
  assert.match(
    loadRoster(room.state, directory, taskId, false)?.context ?? '',
    /"name":"team"/,
  )
})
