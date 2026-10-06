import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room, receipt, receiptPath } from '../backend/room.js'
import { claimBatch, inFlight } from '../backend/relay.js'
import { atomicWrite } from '../backend/storage.js'
import { managedPrompt } from '../backend/managed-workers.js'

test('Crews-owned teammates persist independently while the desktop relay skips them', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-managed-'))
  try {
    const room = new Room(directory)
    const managedId = randomUUID()
    const desktopId = randomUUID()
    const sessionId = randomUUID()
    room.addManaged(
      { id: managedId, title: 'Managed', handle: 'managed' },
      {
        cwd: directory,
        model: 'gpt-6-luna',
        effort: 'low',
        permission: 'full',
        threadId: null,
      },
    )
    room.setManagedThread(managedId, sessionId)
    room.receive({
      kind: 'catalog',
      catalogVersion: 1,
      tasks: [
        { id: desktopId, title: 'Desktop', cwd: directory, updatedAt: 1 },
        {
          id: sessionId,
          title: 'Managed session',
          cwd: directory,
          updatedAt: 2,
        },
      ],
    })
    assert.deepEqual(
      room.state.recent.map((task) => task.id),
      [desktopId],
    )
    room.add({ id: desktopId, title: 'Desktop', handle: 'desktop' })
    const approval = room.beginApproval(desktopId)
    room.receive({
      kind: 'connect',
      workerId: desktopId,
      token: approval.token,
    })
    room.receive({
      kind: 'relay',
      taskId: randomUUID(),
      automationId: 'test',
      token: room.state.relay.token,
    })
    room.send({ text: '@all check routing', parentId: null })
    const jobs = claimBatch(directory, '/runtime', ['node'])
    assert.deepEqual(
      jobs.map((job) => job.threadId),
      [desktopId],
    )
    const managedDelivery = room.state.deliveries.find(
      (delivery) => delivery.workerId === managedId,
    )!
    fs.writeFileSync(path.join(directory, 'claims', managedDelivery.id), '{}')
    atomicWrite(receiptPath(directory, managedDelivery.id), {
      status: 'sent',
      at: Date.now(),
      detail: 'managed turn',
    })
    assert.deepEqual(
      inFlight(directory).map((delivery) => delivery.threadId),
      [desktopId],
    )
    assert.equal(
      new Room(directory).state.workers[0]?.managed?.threadId,
      sessionId,
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a reviewed failed managed delivery can be retried only by an explicit action', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-managed-'))
  try {
    const room = new Room(directory)
    const id = randomUUID()
    room.addManaged(
      { id, title: 'Managed', handle: 'managed' },
      {
        cwd: directory,
        model: 'gpt-6-luna',
        effort: 'low',
        permission: 'full',
        threadId: null,
      },
    )
    room.send({ text: '@managed hello', parentId: null })
    const deliveryId = room.state.deliveries[0]!.id
    assert.throws(() => room.retryManaged(deliveryId))
    const claim = path.join(directory, 'claims', deliveryId)
    fs.writeFileSync(claim, '{}')
    atomicWrite(receiptPath(directory, deliveryId), {
      status: 'attention',
      at: Date.now(),
      detail: 'uncertain',
      failure: 'uncertain',
    })
    room.retryManaged(deliveryId)
    assert.equal(fs.existsSync(claim), false)
    assert.equal(receipt(directory, deliveryId), undefined)
    assert.equal(new Room(directory).state.deliveries[0]!.status, 'pending')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('only an empty managed thread can be replaced after a restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-managed-'))
  try {
    const room = new Room(directory)
    const workerId = randomUUID()
    const emptyId = randomUUID()
    const attemptedId = randomUUID()
    room.addManaged(
      { id: workerId, title: 'Managed', handle: 'managed' },
      {
        cwd: directory,
        model: 'gpt-6-luna',
        effort: 'low',
        permission: 'auto',
        threadId: null,
      },
    )
    room.setManagedThread(workerId, emptyId)
    assert.equal(
      new Room(directory).state.workers[0]?.managed?.turnAttempted,
      false,
    )
    room.clearEmptyManagedThread(workerId, emptyId)
    room.setManagedThread(workerId, attemptedId)
    room.markManagedTurnAttempted(workerId, attemptedId)
    assert.throws(() => room.clearEmptyManagedThread(workerId, attemptedId))
    assert.equal(
      new Room(directory).state.workers[0]?.managed?.threadId,
      attemptedId,
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a managed prompt shows every peer tag already merged into its turn', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-managed-'))
  try {
    const room = new Room(directory)
    const ids = Object.fromEntries(
      ['a', 'b', 'c'].map((handle) => {
        const id = randomUUID()
        room.addManaged(
          { id, title: handle, handle },
          {
            cwd: directory,
            model: 'gpt-6-luna',
            effort: 'low',
            permission: 'full',
            threadId: null,
          },
        )
        return [handle, id]
      }),
    )
    room.send({ text: '@all meet', parentId: null })
    for (const handle of ['a', 'b']) {
      const delivery = room.state.deliveries.find(
        (item) => item.workerId === ids[handle],
      )!
      room.receive({
        kind: 'started',
        workerId: delivery.workerId,
        deliveryId: delivery.id,
      })
      room.receive({
        kind: 'reply',
        workerId: delivery.workerId,
        deliveryId: delivery.id,
        text: `@c hello from ${handle}`,
        to: ['c'],
      })
    }
    const cDelivery = room.state.deliveries.find(
      (item) => item.workerId === ids.c,
    )!
    const c = room.state.workers.find((item) => item.id === ids.c)!
    const prompt = managedPrompt(room, c, cDelivery, '/runtime', ['node'])
    assert.ok(prompt.includes('"author":"@a"'))
    assert.ok(prompt.includes('"author":"@b"'))
    assert.ok(prompt.includes('"text":"@c hello from a"'))
    assert.ok(prompt.includes('"text":"@c hello from b"'))
    assert.ok(
      prompt.includes(
        'Use take.addressedMessages as the complete, current list.',
      ),
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('changing a managed model preserves its Codex chat and permissions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-managed-'))
  try {
    const room = new Room(directory)
    const id = randomUUID()
    const threadId = randomUUID()
    room.addManaged(
      { id, title: 'Model switch', handle: 'model-switch' },
      {
        cwd: directory,
        model: 'gpt-6-sol',
        effort: 'high',
        permission: 'full',
        threadId: null,
      },
    )
    room.setManagedThread(id, threadId)
    room.setManagedModel(id, 'gpt-6.1-sol', 'high', 'priority')
    assert.deepEqual(new Room(directory).state.workers[0]?.managed, {
      cwd: directory,
      model: 'gpt-6.1-sol',
      effort: 'high',
      serviceTier: 'priority',
      permission: 'full',
      threadId,
      turnAttempted: false,
    })
    assert.throws(() => room.setManagedModel(id, '', 'high'))
    room.setManagedModel(id, 'gpt-6.1-sol', 'high', 'default')
    assert.equal(
      new Room(directory).state.workers[0]?.managed?.serviceTier,
      'default',
    )
    room.setManagedModel(id, 'gpt-6.1-sol', 'high', null)
    assert.equal(
      new Room(directory).state.workers[0]?.managed?.serviceTier,
      undefined,
    )
    room.archiveTeammate(id)
    assert.throws(() => room.setManagedModel(id, 'gpt-6-sol', 'high'))
    assert.equal(
      new Room(directory).state.workers[0]?.managed?.model,
      'gpt-6.1-sol',
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
