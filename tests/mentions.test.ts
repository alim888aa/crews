import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { mentionsUser } from '../backend/domain.js'

test('only a deliberate @you token makes a human mention', () => {
  assert.equal(mentionsUser('@you please decide'), true)
  assert.equal(mentionsUser('Can (@YOU) check this?'), true)
  assert.equal(mentionsUser('@you-later'), false)
  assert.equal(mentionsUser('mail@you.example'), false)
})

test('accepted agent mentions alert once and remain unread until opened', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-mentions-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const room = new Room(directory)
  const workerId = randomUUID()
  room.receive({
    kind: 'catalog',
    tasks: [{ id: workerId, title: 'Lead', updatedAt: 1, cwd: directory }],
  })
  room.add({ id: workerId, title: 'Lead', handle: 'lead' })
  assert.throws(() =>
    room.add({ id: randomUUID(), title: 'You', handle: 'you' }),
  )
  const root = room.send({
    text: '@lead please ask @you if needed',
    parentId: null,
  })
  const delivery = room.state.deliveries.find(
    (item) => item.messageId === root.id,
  )!
  const alerts: string[] = []
  room.on('humanMention', (message) => alerts.push(message.id))
  room.receive({
    kind: 'progress',
    workerId,
    deliveryId: delivery.id,
    text: 'Working',
    to: [],
  })
  room.receive({
    kind: 'progress',
    workerId,
    deliveryId: delivery.id,
    text: '@you need a decision',
    to: [],
  })
  room.receive({
    kind: 'progress',
    workerId,
    deliveryId: delivery.id,
    text: '@you still need a decision',
    to: [],
  })
  room.receive({
    kind: 'reply',
    workerId,
    deliveryId: delivery.id,
    text: '@you please approve this choice',
    to: [],
  })
  assert.equal(alerts.length, 2)
  assert.equal(room.state.mentions.length, 2)
  assert.ok(room.state.mentions.every((item) => item.readAt === undefined))
  room.readMentions(root.id)
  assert.ok(
    room.state.mentions.every((item) => typeof item.readAt === 'number'),
  )
  assert.equal(new Room(directory).state.mentions.length, 2)
  assert.ok(
    new Room(directory).state.mentions.every(
      (item) => typeof item.readAt === 'number',
    ),
  )
  room.readMentions(root.id)
  assert.equal(alerts.length, 2)
})

test('old rooms start with an empty mention inbox', (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'crews-mentions-old-'),
  )
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  new Room(directory)
  const statePath = path.join(directory, 'state.json')
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  delete saved.mentions
  fs.writeFileSync(statePath, JSON.stringify(saved))
  assert.deepEqual(new Room(directory).state.mentions, [])
})
