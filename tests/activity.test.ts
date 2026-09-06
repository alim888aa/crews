import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { claimBatch, mark } from '../backend/relay.js'
import { conversationActivity, messageActivity } from '../shared/activity.js'

function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-activity-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const room = new Room(dir)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  room.receive({
    kind: 'catalog',
    tasks: ['one', 'two'].map((title) => ({
      id: randomUUID(),
      title,
      cwd: '/tmp',
      updatedAt: Date.now(),
    })),
  })
  for (const task of room.state.recent) {
    room.add({ ...task, handle: task.title })
    const worker = room.state.workers.at(-1)!
    room.receive({ kind: 'connect', workerId: worker.id, token: worker.token })
  }
  return { room, dir }
}
test('activity follows acknowledged start, ordered turn advance and completion', (t) => {
  const { room, dir } = fixture(t)
  const root = room.send({ text: '@one @two discuss', parentId: null })
  const activity = () =>
    conversationActivity(room.snapshot(), root.id).map((a) => [
      a.handle,
      a.state,
    ])
  assert.deepEqual(activity(), [
    ['one', 'queued'],
    ['two', 'next'],
  ])
  const [job] = claimBatch(dir, '/runtime', ['node'])
  mark(dir, job!.deliveryId, 'sent', '')
  assert.deepEqual(activity(), [
    ['one', 'sent'],
    ['two', 'next'],
  ])
  const d = room.state.deliveries[0]!
  room.receive({ kind: 'started', workerId: d.workerId, deliveryId: d.id })
  assert.deepEqual(activity(), [
    ['one', 'working'],
    ['two', 'next'],
  ])
  assert.equal(
    new Room(dir).state.deliveries[0]?.startedAt,
    room.state.deliveries[0]?.startedAt,
  )
  const firstStart = room.state.deliveries[0]?.startedAt
  room.receive({ kind: 'started', workerId: d.workerId, deliveryId: d.id })
  assert.equal(room.state.deliveries[0]?.startedAt, firstStart)
  room.receive({
    kind: 'reply',
    workerId: d.workerId,
    deliveryId: d.id,
    text: 'Done',
    to: [],
  })
  assert.deepEqual(activity(), [['two', 'queued']])
  const second = room.state.deliveries[1]!
  room.receive({
    kind: 'reply',
    workerId: second.workerId,
    deliveryId: second.id,
    text: 'Done too',
    to: [],
  })
  assert.deepEqual(activity(), [])
})
test('parallel conversations dispatch different workers; the same task queues behind itself', (t) => {
  const { room, dir } = fixture(t)
  const first = room.send({ text: '@one A', parentId: null })
  const second = room.send({ text: '@two B', parentId: null })
  const third = room.send({ text: '@one C', parentId: null })
  const jobs = claimBatch(dir, '/runtime', ['node'])
  assert.equal(jobs.length, 2)
  for (const job of jobs)
    room.receive({
      kind: 'started',
      workerId: job.threadId,
      deliveryId: job.deliveryId,
    })
  assert.equal(
    conversationActivity(room.snapshot(), first.id)[0]?.state,
    'working',
  )
  assert.equal(
    conversationActivity(room.snapshot(), second.id)[0]?.state,
    'working',
  )
  assert.equal(
    conversationActivity(room.snapshot(), third.id)[0]?.state,
    'queued',
  )
  assert.deepEqual(claimBatch(dir, '/runtime', ['node']), [])
})
test('approval failures override working; waiting speakers cannot acknowledge a start', (t) => {
  const { room, dir } = fixture(t)
  const root = room.send({ text: '@one @two discuss', parentId: null })
  const waiting = room.state.deliveries[1]!
  assert.throws(() =>
    room.receive({
      kind: 'started',
      workerId: waiting.workerId,
      deliveryId: waiting.id,
    }),
  )
  const [job] = claimBatch(dir, '/runtime', ['node'])
  room.receive({
    kind: 'started',
    workerId: job!.threadId,
    deliveryId: job!.deliveryId,
  })
  mark(dir, job!.deliveryId, 'attention', 'Needs approval', 'approval')
  assert.equal(
    conversationActivity(room.snapshot(), root.id)[0]?.state,
    'approval',
  )
  assert.equal(
    room.snapshot().workers.find((w) => w.id === job!.threadId)?.presence,
    'attention',
  )
})

test('a new message has its own queued status while that teammate works on an earlier message', (t) => {
  const { room, dir } = fixture(t)
  const first = room.send({ text: '@one first', parentId: null })
  const [job] = claimBatch(dir, '/runtime', ['node'])
  room.receive({
    kind: 'started',
    workerId: job!.threadId,
    deliveryId: job!.deliveryId,
  })
  const second = room.send({ text: '@one second', parentId: first.id })
  assert.equal(messageActivity(room.snapshot(), first.id)[0]?.state, 'working')
  assert.equal(messageActivity(room.snapshot(), second.id)[0]?.state, 'queued')
  room.receive({
    kind: 'reply',
    workerId: job!.threadId,
    deliveryId: job!.deliveryId,
    text: 'Done first',
    to: [],
  })
  assert.deepEqual(messageActivity(room.snapshot(), first.id), [])
  const [next] = claimBatch(dir, '/runtime', ['node'])
  assert.ok(next)
  room.receive({
    kind: 'started',
    workerId: next.threadId,
    deliveryId: next.deliveryId,
  })
  assert.equal(messageActivity(room.snapshot(), second.id)[0]?.state, 'working')
  room.receive({
    kind: 'reply',
    workerId: next.threadId,
    deliveryId: next.deliveryId,
    text: 'Done second',
    to: [],
  })
  assert.deepEqual(messageActivity(room.snapshot(), second.id), [])
})

test('a peer message queues behind the recipient busy in another conversation and dispatches once', (t) => {
  const { room, dir } = fixture(t)
  const busy = room.send({ text: '@two busy elsewhere', parentId: null })
  const [busyJob] = claimBatch(dir, '/runtime', ['node'])
  room.receive({
    kind: 'started',
    workerId: busyJob!.threadId,
    deliveryId: busyJob!.deliveryId,
  })
  const root = room.send({ text: '@one @two discuss', parentId: null })
  const [job] = claimBatch(dir, '/runtime', ['node'])
  assert.ok(job)
  room.receive({
    kind: 'reply',
    workerId: job.threadId,
    deliveryId: job.deliveryId,
    text: '@two please review this',
    to: ['two'],
  })
  const peer = room.state.messages.at(-1)!
  assert.equal(messageActivity(room.snapshot(), peer.id)[0]?.state, 'queued')
  assert.equal(messageActivity(room.snapshot(), busy.id)[0]?.state, 'working')
  assert.deepEqual(messageActivity(room.snapshot(), root.id), [])
  assert.deepEqual(claimBatch(dir, '/runtime', ['node']), [])
  room.receive({
    kind: 'reply',
    workerId: busyJob!.threadId,
    deliveryId: busyJob!.deliveryId,
    text: 'Done elsewhere',
    to: [],
  })
  const [next] = claimBatch(dir, '/runtime', ['node'])
  assert.equal(next?.threadId, busyJob!.threadId)
  assert.deepEqual(claimBatch(dir, '/runtime', ['node']), [])
  mark(dir, next!.deliveryId, 'attention', 'Real failure', 'task')
  assert.equal(messageActivity(room.snapshot(), peer.id)[0]?.state, 'attention')
})

test('ordered speakers stay on the user request when the previous reply does not address them', (t) => {
  const { room, dir } = fixture(t)
  const root = room.send({ text: '@one @two discuss', parentId: null })
  const [job] = claimBatch(dir, '/runtime', ['node'])
  assert.deepEqual(
    messageActivity(room.snapshot(), root.id).map((a) => a.state),
    ['sent', 'next'],
  )
  room.receive({
    kind: 'reply',
    workerId: job!.threadId,
    deliveryId: job!.deliveryId,
    text: 'My answer',
    to: [],
  })
  const reply = room.state.messages.at(-1)!
  assert.deepEqual(messageActivity(room.snapshot(), reply.id), [])
  assert.equal(messageActivity(room.snapshot(), root.id)[0]?.handle, 'two')
  assert.equal(messageActivity(room.snapshot(), root.id)[0]?.state, 'queued')
})
