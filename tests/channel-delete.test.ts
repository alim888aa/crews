import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Attachments } from '../backend/attachments.js'
import { Room } from '../backend/room.js'
import { atomicWrite } from '../backend/storage.js'
import { GENERAL_CHANNEL_ID } from '../shared/contracts.js'

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-delete-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return { directory, room: new Room(directory) }
}

function addWorker(room: Room, handle: string) {
  const id = randomUUID()
  room.transaction((state) => {
    state.recent.push({ id, title: handle, cwd: '/tmp', updatedAt: Date.now() })
  })
  room.add({ id, title: handle, handle })
  return id
}

function complete(room: Room, deliveryId: string, workerId: string) {
  room.receive({
    kind: 'reply',
    deliveryId,
    workerId,
    text: 'done',
    to: [],
  })
}

test('delete removes only the target channel and its completed records', (t) => {
  const { directory, room } = fixture(t)
  const workerId = addWorker(room, 'one')
  const removed = room.createChannel({ name: 'removed', memberIds: [workerId] })
  const kept = room.createChannel({ name: 'kept', memberIds: [workerId] })
  const removedMessage = room.send({
    text: '@one remove me',
    parentId: null,
    channelId: removed.id,
  })
  const keptMessage = room.send({
    text: '@one keep me',
    parentId: null,
    channelId: kept.id,
  })
  const delivery = room.state.deliveries.find(
    (candidate) => candidate.messageId === removedMessage.id,
  )!
  complete(room, delivery.id, workerId)
  atomicWrite(path.join(directory, 'claims', delivery.id), { prompt: 'old' })
  atomicWrite(path.join(directory, 'receipts', delivery.id + '.json'), {
    status: 'claimed',
    at: Date.now(),
    detail: 'old',
  })
  atomicWrite(path.join(directory, 'processed', 'reply.json'), {
    kind: 'reply',
    workerId,
    deliveryId: delivery.id,
    text: 'done',
    to: [],
  })

  room.deleteChannel(removed.id)

  assert.deepEqual(
    room.state.channels.map((channel) => channel.id),
    [GENERAL_CHANNEL_ID, kept.id],
  )
  assert.equal(room.state.workers.length, 1)
  assert.deepEqual(
    room.state.messages
      .filter((message) => message.channelId === kept.id)
      .map((message) => message.id),
    [keptMessage.id],
  )
  assert.equal(
    room.state.deliveries.some((candidate) => candidate.id === delivery.id),
    false,
  )
  assert.equal(
    fs.existsSync(path.join(directory, 'claims', delivery.id)),
    false,
  )
  assert.equal(
    fs.existsSync(path.join(directory, 'receipts', delivery.id + '.json')),
    false,
  )
  assert.equal(
    fs.existsSync(path.join(directory, 'processed', 'reply.json')),
    false,
  )
  assert.equal(
    new Room(directory).state.channels.some(
      (channel) => channel.id === removed.id,
    ),
    false,
  )
})

test('general, unknown, pending and waiting channels are rejected unchanged', (t) => {
  const { room } = fixture(t)
  const one = addWorker(room, 'one')
  const two = addWorker(room, 'two')
  const channel = room.createChannel({ name: 'busy', memberIds: [one, two] })
  room.send({ text: '@one @two wait', parentId: null, channelId: channel.id })
  assert.deepEqual(
    room.state.deliveries.map((delivery) => delivery.status),
    ['pending', 'waiting'],
  )
  const before = structuredClone(room.state)
  assert.throws(() => room.deleteChannel(GENERAL_CHANNEL_ID), /general channel/)
  assert.throws(() => room.deleteChannel(randomUUID()), /Unknown channel/)
  assert.throws(() => room.deleteChannel(channel.id), /pending replies/)
  assert.deepEqual(room.state, before)
})

test('delete rechecks current state and failed state save preserves state and files', (t) => {
  const { directory, room } = fixture(t)
  const workerId = addWorker(room, 'one')
  const channel = room.createChannel({ name: 'project', memberIds: [workerId] })
  const message = room.send({
    text: '@one work',
    parentId: null,
    channelId: channel.id,
  })
  const delivery = room.state.deliveries.find(
    (candidate) => candidate.messageId === message.id,
  )!
  complete(room, delivery.id, workerId)
  const staleDialogState = structuredClone(room.state)
  room.transaction((state) => {
    state.deliveries.find((candidate) => candidate.id === delivery.id)!.status =
      'pending'
  })
  assert.throws(() => room.deleteChannel(channel.id), /pending replies/)
  assert.notDeepEqual(room.state, staleDialogState)
  room.transaction((state) => {
    state.deliveries.find((candidate) => candidate.id === delivery.id)!.status =
      'replied'
  })
  atomicWrite(path.join(directory, 'claims', delivery.id), { prompt: 'keep' })
  const before = structuredClone(room.state)
  fs.rmSync(path.join(directory, 'state.json'))
  fs.mkdirSync(path.join(directory, 'state.json'))
  assert.throws(() => room.deleteChannel(channel.id))
  assert.deepEqual(room.state, before)
  assert.equal(fs.existsSync(path.join(directory, 'claims', delivery.id)), true)
})

test('restart keeps deletion and stale sends and replies fail', (t) => {
  const { directory, room } = fixture(t)
  const workerId = addWorker(room, 'one')
  const channel = room.createChannel({ name: 'gone', memberIds: [workerId] })
  const message = room.send({
    text: '@one work',
    parentId: null,
    channelId: channel.id,
  })
  const delivery = room.state.deliveries.find(
    (candidate) => candidate.messageId === message.id,
  )!
  complete(room, delivery.id, workerId)
  room.deleteChannel(channel.id)
  const restarted = new Room(directory)
  assert.throws(
    () =>
      restarted.send({
        text: '@one stale',
        parentId: null,
        channelId: channel.id,
      }),
    /existing channel/,
  )
  assert.throws(
    () => restarted.send({ text: '@one stale reply', parentId: message.id }),
    /reply target no longer exists/,
  )
  assert.throws(
    () =>
      restarted.receive({
        kind: 'reply',
        workerId,
        deliveryId: delivery.id,
        text: 'late',
        to: [],
      }),
    /does not belong/,
  )
})

test('an attachment still referenced by another channel is preserved', (t) => {
  const { directory, room } = fixture(t)
  const workerId = addWorker(room, 'one')
  const removed = room.createChannel({ name: 'removed', memberIds: [workerId] })
  const kept = room.createChannel({ name: 'kept', memberIds: [workerId] })
  const png = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
  png.writeUInt32BE(1, 16)
  png.writeUInt32BE(1, 20)
  const image = new Attachments(directory).save(png, 'shared.png')
  const first = room.send({
    text: '@one remove',
    parentId: null,
    channelId: removed.id,
    attachmentIds: [image.id],
  })
  room.send({
    text: '@one keep',
    parentId: null,
    channelId: kept.id,
    attachmentIds: [image.id],
  })
  const delivery = room.state.deliveries.find(
    (candidate) => candidate.messageId === first.id,
  )!
  complete(room, delivery.id, workerId)
  room.deleteChannel(removed.id)
  assert.doesNotThrow(() => new Attachments(directory).file(image.id))
})
