import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room, receiptPath } from '../backend/room.js'
import { claimBatch, envelope } from '../backend/relay.js'
import { atomicWrite } from '../backend/storage.js'
import { messageActivity } from '../shared/activity.js'

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-dedupe-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const room = new Room(directory)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  for (const handle of ['a', 'b', 'c']) {
    const id = randomUUID()
    room.receive({
      kind: 'catalog',
      tasks: [{ id, title: handle, cwd: directory, updatedAt: 1 }],
    })
    room.add({ id, title: handle, handle })
    const worker = room.state.workers.find((item) => item.id === id)!
    room.receive({ kind: 'connect', workerId: id, token: worker.token })
  }
  const byHandle = (handle: string) =>
    room.state.workers.find((worker) => worker.handle === handle)!
  return { directory, room, byHandle }
}

test('two simultaneous peer tags already queued for C become one turn with both messages', (t) => {
  const { directory, room, byHandle } = fixture(t)
  const root = room.send({ text: '@all meet each other', parentId: null })
  const first = claimBatch(directory, '/runtime', ['node'])
  assert.equal(first.length, 3)
  const a = first.find((job) => job.threadId === byHandle('a').id)!
  const b = first.find((job) => job.threadId === byHandle('b').id)!
  const c = first.find((job) => job.threadId === byHandle('c').id)!
  room.receive({
    kind: 'reply',
    workerId: a.threadId,
    deliveryId: a.deliveryId,
    text: '@c hi from A',
    to: ['c'],
  })
  room.receive({
    kind: 'reply',
    workerId: b.threadId,
    deliveryId: b.deliveryId,
    text: '@c hi from B',
    to: ['c'],
  })
  const queued = room.state.deliveries.filter(
    (delivery) =>
      delivery.workerId === c.threadId && delivery.id !== c.deliveryId,
  )
  assert.equal(queued.length, 1)
  assert.equal(queued[0]?.coalescedMessageIds?.length, 1)

  room.receive({
    kind: 'started',
    workerId: c.threadId,
    deliveryId: c.deliveryId,
  })
  const reopened = new Room(directory)
  const covered = reopened.state.deliveries.filter(
    (delivery) => delivery.coalescedInto === c.deliveryId,
  )
  assert.deepEqual(
    covered.map((delivery) => delivery.id),
    queued.map((delivery) => delivery.id),
  )
  assert.ok(covered.every((delivery) => delivery.status === 'resolved'))
  assert.deepEqual(
    envelope(
      reopened.state,
      reopened.state.deliveries.find(
        (delivery) => delivery.id === c.deliveryId,
      )!,
      directory,
    ).addressedMessages.map((message) => message.text),
    [root.text, '@c hi from A', '@c hi from B'],
  )
  room.receive({
    kind: 'reply',
    workerId: c.threadId,
    deliveryId: c.deliveryId,
    text: '@a @b hi back',
    to: ['a', 'b'],
  })
  assert.equal(
    room.state.deliveries.filter(
      (delivery) =>
        delivery.workerId === c.threadId && delivery.status === 'pending',
    ).length,
    0,
  )
  assert.deepEqual(
    claimBatch(directory, '/runtime', ['node'])
      .map((job) => job.threadId)
      .sort(),
    [a.threadId, b.threadId].sort(),
  )
})

test('undispatched peer tags share one queue slot and one reply-limit slot', (t) => {
  const { directory, room, byHandle } = fixture(t)
  room.setReplyLimit(5)
  const root = room.send({ text: '@all meet each other', parentId: null })
  const [a, b, c] = ['a', 'b', 'c'].map((handle) =>
    room.state.deliveries.find(
      (delivery) => delivery.workerId === byHandle(handle).id,
    )!,
  )
  room.receive({
    kind: 'reply',
    workerId: a.workerId,
    deliveryId: a.id,
    text: '@c hi from A',
    to: ['c'],
  })
  room.receive({
    kind: 'reply',
    workerId: b.workerId,
    deliveryId: b.id,
    text: '@c hi from B',
    to: ['c'],
  })
  assert.equal(room.state.deliveries.length, 3)
  assert.deepEqual(
    room.state.deliveries.find((delivery) => delivery.id === c.id)
      ?.coalescedMessageIds?.length,
    2,
  )
  assert.deepEqual(
    messageActivity(room.snapshot(), room.state.messages.at(-1)!.id).map(
      (activity) => [activity.handle, activity.state],
    ),
    [['c', 'queued']],
  )
  assert.ok(room.state.messages.every((message) => !message.discussionPaused))
  const [job] = claimBatch(directory, '/runtime', ['node'])
  assert.equal(job?.threadId, c.workerId)
  room.receive({ kind: 'started', workerId: c.workerId, deliveryId: c.id })
  assert.deepEqual(
    envelope(
      room.state,
      room.state.deliveries.find((delivery) => delivery.id === c.id)!,
      directory,
    ).addressedMessages.map((message) => message.text),
    [root.text, '@c hi from A', '@c hi from B'],
  )
  room.receive({
    kind: 'reply',
    workerId: c.workerId,
    deliveryId: c.id,
    text: '@a @b hi back',
    to: ['a', 'b'],
  })
  assert.equal(room.state.deliveries.length, 5)
  assert.equal(room.state.messages.at(-1)?.discussionPaused, undefined)
})

test('a full reply limit still lets claimed C receive tags that arrive before take', (t) => {
  const { directory, room, byHandle } = fixture(t)
  room.setReplyLimit(3)
  const root = room.send({ text: '@all introductions', parentId: null })
  const jobs = claimBatch(directory, '/runtime', ['node'])
  const a = jobs.find((job) => job.threadId === byHandle('a').id)!
  const b = jobs.find((job) => job.threadId === byHandle('b').id)!
  const c = jobs.find((job) => job.threadId === byHandle('c').id)!
  room.receive({
    kind: 'reply',
    workerId: a.threadId,
    deliveryId: a.deliveryId,
    text: '@c hello A',
    to: ['c'],
  })
  room.receive({
    kind: 'reply',
    workerId: b.threadId,
    deliveryId: b.deliveryId,
    text: '@c hello B',
    to: ['c'],
  })
  assert.equal(room.state.deliveries.length, 3)
  assert.ok(room.state.messages.every((message) => !message.discussionPaused))
  room.receive({
    kind: 'started',
    workerId: c.threadId,
    deliveryId: c.deliveryId,
  })
  assert.deepEqual(
    envelope(
      room.state,
      room.state.deliveries.find((delivery) => delivery.id === c.deliveryId)!,
      directory,
    ).addressedMessages.map((message) => message.text),
    [root.text, '@c hello A', '@c hello B'],
  )
  room.receive({
    kind: 'reply',
    workerId: c.threadId,
    deliveryId: c.deliveryId,
    text: 'Hey A and B!',
    to: [],
  })
  assert.equal(room.state.deliveries.length, 3)
})

test('late peer tags and human follow-ups stay separate from the started turn', (t) => {
  const { directory, room, byHandle } = fixture(t)
  const root = room.send({ text: '@all discuss', parentId: null })
  const first = claimBatch(directory, '/runtime', ['node'])
  const a = first.find((job) => job.threadId === byHandle('a').id)!
  const b = first.find((job) => job.threadId === byHandle('b').id)!
  const c = first.find((job) => job.threadId === byHandle('c').id)!
  room.receive({
    kind: 'reply',
    workerId: a.threadId,
    deliveryId: a.deliveryId,
    text: '@c early',
    to: ['c'],
  })
  const human = room.send({
    text: '@c please check this too',
    parentId: root.id,
  })
  const otherRoundId = randomUUID()
  room.receive({
    kind: 'conversation-post',
    id: otherRoundId,
    workerId: a.threadId,
    token: byHandle('a').token,
    channelId: root.channelId,
    rootId: root.id,
    text: '@c separate topic',
    to: ['c'],
    mode: 'simultaneous',
  })
  room.receive({
    kind: 'started',
    workerId: c.threadId,
    deliveryId: c.deliveryId,
  })
  room.receive({
    kind: 'reply',
    workerId: b.threadId,
    deliveryId: b.deliveryId,
    text: '@c later',
    to: ['c'],
  })
  const pending = room.state.deliveries.filter(
    (delivery) =>
      delivery.workerId === c.threadId &&
      delivery.status === 'pending' &&
      delivery.id !== c.deliveryId,
  )
  assert.equal(pending.length, 3)
  assert.ok(pending.some((delivery) => delivery.messageId === human.id))
  assert.ok(pending.some((delivery) => delivery.messageId === otherRoundId))
  assert.ok(
    pending.some(
      (delivery) =>
        room.state.messages.find((message) => message.id === delivery.messageId)
          ?.text === '@c later',
    ),
  )
  assert.equal(
    room.state.deliveries.filter(
      (delivery) => delivery.coalescedInto === c.deliveryId,
    ).length,
    1,
  )
})

test('a claimed failed handoff is never folded into a different turn', (t) => {
  const { directory, room, byHandle } = fixture(t)
  room.send({ text: '@all discuss', parentId: null })
  const first = claimBatch(directory, '/runtime', ['node'])
  const a = first.find((job) => job.threadId === byHandle('a').id)!
  const c = first.find((job) => job.threadId === byHandle('c').id)!
  room.receive({
    kind: 'reply',
    workerId: a.threadId,
    deliveryId: a.deliveryId,
    text: '@c claimed',
    to: ['c'],
  })
  const peer = room.state.deliveries.find(
    (delivery) =>
      delivery.workerId === c.threadId && delivery.id !== c.deliveryId,
  )!
  fs.writeFileSync(path.join(directory, 'claims', peer.id), '{}')
  room.receive({
    kind: 'started',
    workerId: c.threadId,
    deliveryId: c.deliveryId,
  })
  assert.equal(
    room.state.deliveries.find((delivery) => delivery.id === peer.id)?.status,
    'pending',
  )
})

test('explicit retry keeps the old dispatch history after its claim is removed', (t) => {
  const { directory, room, byHandle } = fixture(t)
  room.send({ text: '@all discuss', parentId: null })
  const first = claimBatch(directory, '/runtime', ['node'])
  const a = first.find((job) => job.threadId === byHandle('a').id)!
  const c = first.find((job) => job.threadId === byHandle('c').id)!
  room.receive({
    kind: 'reply',
    workerId: a.threadId,
    deliveryId: a.deliveryId,
    text: '@c claimed',
    to: ['c'],
  })
  const peer = room.state.deliveries.find(
    (delivery) =>
      delivery.workerId === c.threadId && delivery.id !== c.deliveryId,
  )!
  room.transaction((state) => {
    state.workers.find((worker) => worker.id === c.threadId)!.managed = {
      cwd: directory,
      model: 'gpt-6-luna',
      effort: 'low',
      permission: 'full',
      threadId: null,
    }
  })
  fs.writeFileSync(path.join(directory, 'claims', peer.id), '{}')
  atomicWrite(receiptPath(directory, peer.id), {
    status: 'attention',
    failure: 'task',
    at: Date.now(),
    detail: 'Stopped before take',
  })
  room.retryManaged(peer.id)
  assert.equal(fs.existsSync(path.join(directory, 'claims', peer.id)), false)
  assert.equal(
    new Room(directory).state.deliveries.find(
      (delivery) => delivery.id === peer.id,
    )?.previouslyClaimed,
    true,
  )
  room.receive({
    kind: 'started',
    workerId: c.threadId,
    deliveryId: c.deliveryId,
  })
  assert.equal(
    room.state.deliveries.find((delivery) => delivery.id === peer.id)?.status,
    'pending',
  )
})
