import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  newRoom,
  sendMessage,
  acceptEvent,
  validateTeammate,
} from '../backend/domain.js'
import type { SavedRoom, RoomEvent } from '../shared/contracts.js'
const pair = () => {
  const s = newRoom()
  s.workers = ['one', 'two', 'three'].map((handle) =>
    validateTeammate(s, { id: randomUUID(), handle, title: handle }),
  )
  return s
}
const reply = (
  s: SavedRoom,
  index: number,
  text: string,
  to: string[] = [],
): Extract<RoomEvent, { kind: 'reply' | 'progress' }> => ({
  kind: 'reply',
  workerId: s.deliveries[index]!.workerId,
  deliveryId: s.deliveries[index]!.id,
  text,
  to,
})
test('fresh installs have no hardcoded teammates or relay', () => {
  const s = newRoom()
  assert.equal(s.workers.length, 0)
  assert.equal(s.relay.taskId, null)
})
test('ordered mentions preserve order and advance only after final reply', () => {
  const s = pair()
  sendMessage(s, '@two @one Hello', null)
  assert.equal(s.deliveries[0]!.workerId, s.workers[1]!.id)
  assert.equal(s.deliveries[1]!.status, 'waiting')
  acceptEvent(s, { ...reply(s, 0, 'working'), kind: 'progress' })
  assert.equal(s.deliveries[1]!.status, 'waiting')
  acceptEvent(s, reply(s, 0, 'First'))
  assert.equal(s.deliveries[1]!.status, 'pending')
  assert.equal(s.deliveries[1]!.messageId, s.messages.at(-1)!.id)
})
test('duplicate reply is ignored and waiting replies are rejected', () => {
  const s = pair()
  sendMessage(s, '@one @two hi', null)
  assert.throws(() => acceptEvent(s, reply(s, 1, 'too soon')))
  const event = reply(s, 0, 'once')
  acceptEvent(s, event)
  const count = s.messages.length
  acceptEvent(s, event)
  assert.equal(s.messages.length, count)
})
test('@all includes the room or only the conversation participants', () => {
  const s = pair(),
    m = sendMessage(s, '@one @two hi', null)
  const n = sendMessage(s, '@all opinions', m.id)
  assert.deepEqual(n.recipientIds, m.recipientIds)
  assert.equal(n.mode, 'simultaneous')
  const top = sendMessage(s, '@all room', null)
  assert.equal(top.recipientIds.length, 3)
  assert.throws(() => sendMessage(s, '@three join', m.id))
  assert.throws(() => sendMessage(s, '@all @missing hi', null))
})
test('ordered peer requests do not duplicate already waiting speakers', () => {
  const s = pair()
  sendMessage(s, '@one @two hi', null)
  acceptEvent(s, reply(s, 0, 'Your turn', ['two']))
  assert.equal(s.deliveries.length, 2)
  acceptEvent(s, reply(s, 1, 'Back to you', ['one']))
  assert.equal(s.deliveries.length, 3)
  assert.equal(s.deliveries[2]!.status, 'pending')
})
test('progress cannot dispatch peers and each round respects the selected limit', () => {
  const s = pair()
  s.replyLimit = 16
  sendMessage(s, '@one @two hi', null)
  assert.throws(() =>
    acceptEvent(s, { ...reply(s, 0, 'working', ['two']), kind: 'progress' }),
  )
  for (let i = 0; i < 16; i++) {
    const d = s.deliveries[i]
    if (!d) break
    acceptEvent(
      s,
      reply(s, i, 'next', [d.workerId === s.workers[0]!.id ? 'two' : 'one']),
    )
  }
  assert.equal(s.deliveries.length, 16)
  assert.equal(s.messages.at(-1)!.discussionPaused, true)
})
test('teammates use unique valid handles and stable task IDs', () => {
  const s = pair()
  assert.throws(() =>
    validateTeammate(s, { id: randomUUID(), handle: 'one', title: 'copy' }),
  )
  assert.throws(() =>
    validateTeammate(s, { id: randomUUID(), handle: 'all', title: 'reserved' }),
  )
  assert.throws(() =>
    validateTeammate(s, { id: '../../escape', handle: 'ok', title: 'bad' }),
  )
  const edited = validateTeammate(s, {
    ...s.workers[0]!,
    title: 'New name',
    handle: 'new-name',
  })
  assert.equal(edited.token, s.workers[0]!.token)
})
test('connection receipt must match the exact teammate and nonce', () => {
  const s = pair(),
    w = s.workers[0]!
  assert.throws(() =>
    acceptEvent(s, { kind: 'connect', workerId: w.id, token: randomUUID() }),
  )
  acceptEvent(s, { kind: 'connect', workerId: w.id, token: w.token })
  assert.equal(w.connection, 'connected')
})
test('recent task picker deduplicates, excludes relay and chooses ten newest', () => {
  const s = newRoom()
  const tasks = Array.from({ length: 13 }, (_, i) => ({
    id: randomUUID(),
    title: 'Task ' + i,
    updatedAt: i,
    cwd: '/local',
  }))
  s.relay.taskId = tasks[12]!.id
  acceptEvent(s, { kind: 'catalog', tasks: [...tasks, tasks[0]!] })
  assert.equal(s.recent.length, 10)
  assert.equal(s.recent[0]!.updatedAt, 11)
  assert.equal(s.recent.at(-1)!.updatedAt, 2)
})
test('setup cannot replace a previously registered relay', () => {
  const s = newRoom()
  const taskId = randomUUID()
  acceptEvent(s, {
    kind: 'relay',
    taskId,
    automationId: 'pending',
    token: s.relay.token,
  })
  acceptEvent(s, {
    kind: 'relay',
    taskId,
    automationId: 'automation',
    token: s.relay.token,
  })
  assert.equal(s.relay.automationId, 'automation')
  assert.throws(() =>
    acceptEvent(s, {
      kind: 'relay',
      taskId: randomUUID(),
      automationId: 'other',
      token: s.relay.token,
    }),
  )
})

test('a limit below the initial recipient count rejects the whole send', () => {
  const s = pair()
  s.replyLimit = 2
  assert.throws(
    () => sendMessage(s, '@all hi', null),
    /Increase the reply limit/,
  )
  assert.equal(s.messages.length, 0)
  assert.equal(s.deliveries.length, 0)
})

test('lowering the limit lets queued replies finish without allocating more', () => {
  const s = pair()
  sendMessage(s, '@all discuss', null)
  s.replyLimit = 1
  acceptEvent(s, reply(s, 0, 'next', ['two']))
  acceptEvent(s, reply(s, 1, 'next', ['one']))
  acceptEvent(s, reply(s, 2, 'next', ['one']))
  assert.equal(s.deliveries.length, 3)
  assert.ok(s.deliveries.every((d) => d.status === 'replied'))
  assert.equal(s.messages.at(-1)!.discussionPaused, true)
})

test('raising the limit applies to ongoing discussions and new messages get a fresh budget', () => {
  const s = pair()
  s.replyLimit = 2
  const root = sendMessage(s, '@one @two discuss', null)
  acceptEvent(s, reply(s, 0, 'first'))
  s.replyLimit = 4
  acceptEvent(s, reply(s, 1, 'next', ['one']))
  assert.equal(s.deliveries.length, 3)
  acceptEvent(s, reply(s, 2, 'next', ['two']))
  acceptEvent(s, reply(s, 3, 'next', ['one']))
  assert.equal(s.deliveries.length, 4)
  assert.equal(s.messages.at(-1)!.discussionPaused, true)
  sendMessage(s, '@one continue', root.id)
  assert.equal(s.deliveries.length, 5)
  acceptEvent(s, reply(s, 4, 'next', ['two']))
  assert.equal(s.deliveries.length, 6)
})
