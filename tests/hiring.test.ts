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
import type { HireDraft } from '../shared/contracts.js'

function fixture(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-hiring-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const room = new Room(directory)
  const requesterId = randomUUID()
  room.addManaged(
    { id: requesterId, title: 'Lead', handle: 'lead' },
    {
      cwd: directory,
      model: 'gpt-6-sol',
      effort: 'high',
      permission: 'full',
      threadId: null,
    },
  )
  const draft: HireDraft = {
    title: 'QA Worker',
    handle: 'qa-worker',
    role: 'QA reviewer',
    identity: 'Review changes before release.',
    cwd: directory,
    model: 'gpt-6-sol',
    effort: 'high',
    serviceTier: 'priority',
    permission: 'auto',
  }
  const channel = room.createChannel({
    name: 'project',
    memberIds: [requesterId],
  })
  const root = room.send({
    text: '@lead Build the team',
    parentId: null,
    channelId: channel.id,
  })
  return { room, directory, requesterId, draft, channel, root }
}

test('a hire request waits for human approval and keeps the reviewed edits', (t) => {
  const { room, directory, requesterId, draft, channel, root } = fixture(t)
  const token = room.state.workers[0]!.token
  const id = randomUUID()
  room.receive({
    kind: 'hire',
    id,
    workerId: requesterId,
    token,
    rootId: root.id,
    draft,
  })
  assert.equal(room.state.workers.length, 1)
  assert.equal(room.state.hireRequests[0]?.status, 'pending')
  assert.throws(() =>
    room.receive({
      kind: 'hire',
      id: randomUUID(),
      workerId: requesterId,
      token: randomUUID(),
      rootId: root.id,
      draft,
    }),
  )
  const edited = {
    ...draft,
    title: 'Release QA',
    handle: 'release-qa',
    identity: 'Verify the actual build.',
    permission: 'full' as const,
  }
  const worker = room.approveHire(id, edited, directory)
  assert.equal(worker.title, 'Release QA')
  assert.equal(worker.handle, 'release-qa')
  assert.equal(worker.identity, 'Verify the actual build.')
  assert.equal(worker.managed?.permission, 'full')
  assert.equal(worker.managed?.serviceTier, 'priority')
  assert.equal(worker.managed?.threadId, null)
  assert.ok(
    room.state.channels
      .find((item) => item.id === channel.id)
      ?.memberIds.includes(worker.id),
  )
  assert.equal(room.state.hireRequests[0]?.workerId, worker.id)
  assert.equal(room.state.hireRequests[0]?.status, 'approved')
  assert.throws(() => room.approveHire(id, edited, directory))
  const reopened = new Room(directory)
  assert.equal(reopened.state.hireRequests[0]?.status, 'approved')
  assert.ok(reopened.state.workers.some((item) => item.id === worker.id))
})

test('a declined hire cannot create a teammate later', (t) => {
  const { room, directory, requesterId, draft, root } = fixture(t)
  const id = randomUUID()
  room.receive({
    kind: 'hire',
    id,
    workerId: requesterId,
    token: room.state.workers[0]!.token,
    rootId: root.id,
    draft,
  })
  room.declineHire(id)
  assert.equal(new Room(directory).state.hireRequests[0]?.status, 'declined')
  assert.throws(() => room.approveHire(id, draft, directory))
  assert.equal(room.state.workers.length, 1)
})

test('the real helper accepts a request only from its own Codex task', async (t) => {
  const { room, directory, requesterId, draft, root } = fixture(t)
  const taskId = randomUUID()
  room.setManagedThread(requesterId, taskId)
  const runtime = path.join(directory, 'runtime')
  installRuntime(path.resolve('build'), runtime, directory, [process.execPath])
  const watcher = Effect.runFork(room.watch())
  t.after(() => Effect.runPromise(Fiber.interrupt(watcher)))
  const cli = path.join(runtime, 'cli.mjs')
  const call = (threadId: string) =>
    new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [cli, 'hire', requesterId, root.id],
        {
          env: { ...process.env, CODEX_THREAD_ID: threadId },
        },
      )
      let output = ''
      child.stdout.on('data', (chunk) => (output += String(chunk)))
      child.stderr.on('data', (chunk) => (output += String(chunk)))
      child.on('close', (code) => resolve({ code, output }))
      child.stdin.end(JSON.stringify(draft))
    })
  const denied = await call(randomUUID())
  assert.notEqual(denied.code, 0)
  assert.equal(room.state.hireRequests.length, 0)
  const accepted = await call(taskId)
  assert.equal(accepted.code, 0)
  const result = JSON.parse(accepted.output)
  assert.equal(result.accepted, true)
  assert.equal(room.state.hireRequests[0]?.id, result.requestId)
  assert.equal(room.state.workers.length, 1)
})
