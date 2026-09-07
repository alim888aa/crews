import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  newRoom,
  sendMessage,
  validateTeammate,
  acceptEvent,
} from '../backend/domain.js'
import { Room } from '../backend/room.js'
import { atomicWrite } from '../backend/storage.js'
import { decodeState } from '../backend/schema.js'
import { envelope, claimBatch } from '../backend/relay.js'
import {
  channelMemberIds,
  conversationParticipantIds,
} from '../shared/channels.js'
import { GENERAL_CHANNEL_ID } from '../shared/contracts.js'

function populatedRoom() {
  const room = newRoom()
  room.workers = ['one', 'two', 'three'].map((handle) =>
    validateTeammate(room, { id: randomUUID(), handle, title: handle }),
  )
  return room
}

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-channels-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return { directory, room: new Room(directory) }
}

test('legacy rooms and messages migrate to a dynamic general channel and persist it', (t) => {
  const { directory, room } = fixture(t)
  const state = populatedRoom()
  const message = sendMessage(state, '@one hello', null)
  const { channels: _channels, messages, ...oldState } = state
  const legacy = {
    ...oldState,
    messages: messages.map(
      ({ channelId: _channelId, ...oldMessage }) => oldMessage,
    ),
  }
  atomicWrite(path.join(directory, 'state.json'), legacy)
  const restored = new Room(directory)
  assert.deepEqual(restored.state.channels, [
    { id: GENERAL_CHANNEL_ID, name: 'general', memberIds: [] },
  ])
  assert.equal(restored.state.messages[0]!.channelId, GENERAL_CHANNEL_ID)
  assert.equal(channelMemberIds(restored.state, GENERAL_CHANNEL_ID).length, 3)
  assert.deepEqual(
    decodeState(
      JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')),
    ).messages[0]!.channelId,
    message.channelId,
  )
  assert.equal(room.state.channels[0]!.id, GENERAL_CHANNEL_ID)
})

test('channel creation normalizes names, validates members and saves atomically', (t) => {
  const { directory, room } = fixture(t)
  room.transaction((state) => {
    state.workers = populatedRoom().workers
  })
  const members = room.state.workers.slice(0, 2).map((worker) => worker.id)
  const channel = room.createChannel({
    name: 'Project-One',
    memberIds: members,
  })
  assert.equal(channel.name, 'project-one')
  assert.deepEqual(new Room(directory).state.channels.at(-1), channel)
  const before = fs.readFileSync(path.join(directory, 'state.json'), 'utf8')
  assert.throws(() =>
    room.createChannel({ name: 'PROJECT-ONE', memberIds: [] }),
  )
  assert.throws(() => room.createChannel({ name: 'bad name', memberIds: [] }))
  assert.throws(() =>
    room.createChannel({ name: 'valid', memberIds: [randomUUID()] }),
  )
  assert.equal(
    fs.readFileSync(path.join(directory, 'state.json'), 'utf8'),
    before,
  )
  room.setChannelMembers({ id: channel.id, memberIds: [members[1]!] })
  assert.deepEqual(room.state.channels.at(-1)!.memberIds, [members[1]!])
})

test('a failed channel save leaves the live room unchanged', (t) => {
  const { directory, room } = fixture(t)
  const before = structuredClone(room.state)
  fs.rmSync(path.join(directory, 'state.json'))
  fs.mkdirSync(path.join(directory, 'state.json'))
  assert.throws(() => room.createChannel({ name: 'project', memberIds: [] }))
  assert.deepEqual(room.state, before)
})

test('channel routing supports guests while @all stays scoped to the conversation', () => {
  const room = populatedRoom()
  const channelId = randomUUID()
  room.channels.push({
    id: channelId,
    name: 'project',
    memberIds: room.workers.slice(0, 2).map((worker) => worker.id),
  })
  const root = sendMessage(room, '@all @three start', null, [], channelId)
  assert.deepEqual(
    root.recipientIds,
    room.workers.map((worker) => worker.id),
  )
  assert.equal(root.channelId, channelId)
  room.channels[1]!.memberIds = [room.workers[0]!.id]
  const followup = sendMessage(room, '@all continue', root.id)
  assert.deepEqual(followup.recipientIds, root.recipientIds)
  assert.deepEqual(conversationParticipantIds(room, root.id), root.recipientIds)
  assert.throws(() => sendMessage(room, '@missing hello', root.id))
  assert.throws(() =>
    sendMessage(room, '@one wrong', root.id, [], GENERAL_CHANNEL_ID),
  )
})

test('peer followups stay with current participants after channel membership changes', () => {
  const room = populatedRoom()
  const channelId = randomUUID()
  room.channels.push({
    id: channelId,
    name: 'project',
    memberIds: [room.workers[0]!.id],
  })
  sendMessage(room, '@one @two start', null, [], channelId)
  room.channels[1]!.memberIds = []
  const first = room.deliveries[0]!
  acceptEvent(room, {
    kind: 'reply',
    workerId: first.workerId,
    deliveryId: first.id,
    text: '@two still here',
    to: ['two'],
  })
  assert.equal(room.messages.at(-1)!.channelId, channelId)
  assert.throws(() =>
    acceptEvent(room, {
      kind: 'reply',
      workerId: room.deliveries[1]!.workerId,
      deliveryId: room.deliveries[1]!.id,
      text: '@three join',
      to: ['three'],
    }),
  )
})

test('separate channels keep conversation context isolated while sharing one worker queue', (t) => {
  const { directory, room } = fixture(t)
  room.transaction((state) => {
    state.workers = populatedRoom().workers
  })
  const workerId = room.state.workers[0]!.id
  const alpha = room.createChannel({ name: 'alpha', memberIds: [workerId] })
  const beta = room.createChannel({ name: 'beta', memberIds: [workerId] })
  const first = room.send({
    text: '@one alpha',
    parentId: null,
    channelId: alpha.id,
  })
  const second = room.send({
    text: '@one beta',
    parentId: null,
    channelId: beta.id,
  })
  assert.equal(
    room.state.deliveries.filter((delivery) => delivery.workerId === workerId)
      .length,
    2,
  )
  const firstContext = envelope(
    room.state,
    room.state.deliveries[0]!,
    directory,
  )
  const secondContext = envelope(
    room.state,
    room.state.deliveries[1]!,
    directory,
  )
  assert.deepEqual(
    firstContext.messages.map((message) => message.id),
    [first.id],
  )
  assert.deepEqual(
    secondContext.messages.map((message) => message.id),
    [second.id],
  )
  const worker = room.state.workers[0]!
  room.receive({ kind: 'connect', workerId, token: worker.token })
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  const [claimed] = claimBatch(directory, '/test-runtime', ['node'])
  assert.ok(claimed)
  assert.equal(claimed.deliveryId, room.state.deliveries[0]!.id)
  assert.deepEqual(claimBatch(directory, '/test-runtime', ['node']), [])
  room.receive({
    kind: 'reply',
    workerId,
    deliveryId: claimed.deliveryId,
    text: 'alpha done',
    to: [],
  })
  assert.equal(
    claimBatch(directory, '/test-runtime', ['node'])[0]!.deliveryId,
    room.state.deliveries[1]!.id,
  )
})
