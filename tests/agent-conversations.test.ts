import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Effect, Fiber } from 'effect'
import { Room } from '../backend/room.js'
import { installRuntime } from '../backend/runtime.js'
import { envelope } from '../backend/relay.js'
import { channelMemberIds } from '../shared/channels.js'
import type { HireDraft } from '../shared/contracts.js'

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-agent-chats-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const room = new Room(directory)
  const add = (handle: string) => {
    const id = randomUUID()
    room.addManaged(
      { id, title: handle, handle },
      {
        cwd: directory,
        model: 'gpt-6-sol',
        effort: 'low',
        permission: 'full',
        threadId: null,
      },
    )
    return room.state.workers.find((worker) => worker.id === id)!
  }
  const lead = add('lead')
  const guest = add('guest')
  const outsider = add('outsider')
  const channel = room.createChannel({
    name: 'project',
    memberIds: [lead.id],
  })
  const invitation = room.send({
    text: '@guest Join this project discussion',
    parentId: null,
    channelId: channel.id,
  })
  return { room, directory, lead, guest, outsider, channel, invitation }
}

test('a user-invited guest recruits into its channel and starts and extends conversations', (t) => {
  const { room, directory, lead, guest, outsider, channel, invitation } =
    fixture(t)
  const guestDelivery = room.state.deliveries.find(
    (delivery) => delivery.workerId === guest.id,
  )!
  const taken = envelope(room.state, guestDelivery, directory)
  assert.equal(taken.projectMembership, 'guest')
  assert.deepEqual(
    taken.projectMembers?.map((member) => member.handle),
    ['lead'],
  )
  const startedId = randomUUID()
  room.receive({
    kind: 'conversation-start',
    id: startedId,
    workerId: guest.id,
    token: guest.token,
    channelId: channel.id,
    text: 'Review our project plan',
    to: ['lead'],
    mode: 'ordered',
  })
  const started = room.state.messages.find(
    (message) => message.id === startedId,
  )!
  assert.equal(started.authorId, guest.id)
  assert.equal(started.rootId, started.id)
  assert.equal(started.channelId, channel.id)
  assert.deepEqual(started.recipientIds, [lead.id])
  assert.ok(
    room.state.deliveries.some(
      (delivery) =>
        delivery.messageId === started.id && delivery.workerId === lead.id,
    ),
  )

  const draft: HireDraft = {
    title: 'Project QA',
    handle: 'project-qa',
    role: 'QA reviewer',
    identity: 'Check this project.',
    cwd: directory,
    model: 'gpt-6-sol',
    effort: 'low',
    permission: 'full',
  }
  const requestId = randomUUID()
  room.receive({
    kind: 'hire',
    id: requestId,
    workerId: guest.id,
    token: guest.token,
    rootId: invitation.id,
    draft,
  })
  assert.equal(room.state.hireRequests[0]?.channelId, channel.id)
  assert.throws(() => room.deleteChannel(channel.id))
  const hired = room.approveHire(requestId, draft, directory)
  assert.ok(channelMemberIds(room.state, channel.id).includes(hired.id))
  assert.ok(channelMemberIds(room.state, 'general').includes(hired.id))

  const inviteId = randomUUID()
  room.receive({
    kind: 'conversation-post',
    id: inviteId,
    workerId: guest.id,
    token: guest.token,
    channelId: channel.id,
    rootId: started.id,
    text: 'QA, join the review',
    to: [hired.handle],
    mode: 'ordered',
  })
  const invite = room.state.messages.find((message) => message.id === inviteId)!
  assert.equal(invite.rootId, started.id)
  assert.deepEqual(invite.recipientIds, [hired.id])
  assert.ok(
    room.state.deliveries.some(
      (delivery) =>
        delivery.messageId === invite.id && delivery.workerId === hired.id,
    ),
  )
  assert.throws(() =>
    room.receive({
      kind: 'conversation-start',
      id: randomUUID(),
      workerId: outsider.id,
      token: outsider.token,
      channelId: channel.id,
      text: 'Uninvited project chat',
      to: ['lead'],
      mode: 'ordered',
    }),
  )
  assert.throws(() =>
    room.receive({
      kind: 'hire',
      id: randomUUID(),
      workerId: outsider.id,
      token: outsider.token,
      rootId: invitation.id,
      draft: { ...draft, handle: 'another-qa' },
    }),
  )
})

test('the built conversation helper checks the exact task and channel invitation', async (t) => {
  const { room, directory, guest, channel } = fixture(t)
  const taskId = randomUUID()
  room.setManagedThread(guest.id, taskId)
  const runtime = path.join(directory, 'runtime')
  installRuntime(path.resolve('build'), runtime, directory, [process.execPath])
  const watcher = Effect.runFork(room.watch())
  t.after(() => Effect.runPromise(Fiber.interrupt(watcher)))
  const cli = path.join(runtime, 'cli.mjs')
  const call = (threadId: string) =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [cli, 'conversation-start', guest.id, channel.id],
        { env: { ...process.env, CODEX_THREAD_ID: threadId } },
      )
      let output = ''
      child.stdout.on('data', (chunk) => (output += String(chunk)))
      child.stderr.on('data', (chunk) => (output += String(chunk)))
      child.on('close', (code) => resolve({ code, output }))
      child.stdin.end(
        JSON.stringify({ text: 'Start the review', to: ['lead'] }),
      )
    })
  const denied = await call(randomUUID())
  assert.notEqual(denied.code, 0)
  const accepted = await call(taskId)
  assert.equal(accepted.code, 0)
  const result = JSON.parse(accepted.output)
  assert.equal(result.accepted, true)
  assert.equal(
    room.state.messages.find((item) => item.id === result.rootId)?.authorId,
    guest.id,
  )
})

test('removing a channel member revokes old guest rights until the user reinvites them', (t) => {
  const { room, guest, channel } = fixture(t)
  room.setChannelMembers({ id: channel.id, memberIds: [guest.id] })
  room.setChannelMembers({ id: channel.id, memberIds: [] })
  const start = () =>
    room.receive({
      kind: 'conversation-start',
      id: randomUUID(),
      workerId: guest.id,
      token: guest.token,
      channelId: channel.id,
      text: 'Guest project chat',
      to: [],
      mode: 'ordered',
    })
  assert.throws(start)
  room.send({
    text: '@guest Please rejoin this project discussion',
    parentId: null,
    channelId: channel.id,
  })
  assert.doesNotThrow(start)
})
