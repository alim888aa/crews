import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { retryManagedDelivery } from '../backend/managed-retry.js'
import { Room, receipt, receiptPath } from '../backend/room.js'
import { atomicWrite } from '../backend/storage.js'
import type { AppServerClient } from '../backend/app-server.js'

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-writer-'))
  const room = new Room(directory)
  const workerId = randomUUID()
  const sourceId = randomUUID()
  room.addManaged(
    { id: workerId, title: 'QA lead', handle: 'qa-lead' },
    {
      cwd: directory,
      model: 'gpt-6-sol',
      effort: 'high',
      permission: 'full',
      threadId: sourceId,
      turnAttempted: true,
    },
  )
  room.send({ text: '@qa-lead review this change', parentId: null })
  const deliveryId = room.state.deliveries[0]!.id
  const claim = path.join(directory, 'claims', deliveryId)
  fs.writeFileSync(claim, '{"prompt":"saved"}')
  atomicWrite(receiptPath(directory, deliveryId), {
    status: 'attention',
    at: Date.now(),
    detail: `The Crews-owned Codex turn stopped with an uncertain outcome: Codex app-server rejected the request: {"code":-32600,"message":"thread ${sourceId} already has an active writer"}`,
    failure: 'uncertain',
  })
  return {
    room,
    directory,
    sourceId,
    deliveryId,
    claim,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  }
}

function appServer(
  calls: Array<{ method: string; params: unknown }>,
  sourceId: string,
  forkId: string,
  latestStatus: string | null = 'completed',
) {
  const client = {
    async request(method: string, params: unknown): Promise<unknown> {
      calls.push({ method, params })
      if (method === 'thread/turns/list')
        return {
          data:
            latestStatus === null
              ? []
              : [{ id: randomUUID(), status: latestStatus }],
        }
      if (method === 'thread/fork')
        return { thread: { id: forkId, forkedFromId: sourceId } }
      if (method === 'thread/resume')
        return {
          thread: { id: forkId },
          activePermissionProfile: { id: ':danger-full-access' },
          approvalPolicy: 'never',
          approvalsReviewer: 'auto_review',
          sandbox: { type: 'dangerFullAccess' },
        }
      if (method === 'thread/name/set') return {}
      throw new Error(`Unexpected ${method}`)
    },
  } as AppServerClient
  return async <T>(run: (client: AppServerClient) => Promise<T>) => run(client)
}

test('Retry moves a desktop-locked teammate to a named history fork before replaying', async () => {
  const f = fixture()
  try {
    const forkId = randomUUID()
    const calls: Array<{ method: string; params: unknown }> = []
    await retryManagedDelivery(
      f.room,
      f.deliveryId,
      appServer(calls, f.sourceId, forkId),
    )
    assert.deepEqual(
      calls.map((call) => call.method),
      ['thread/turns/list', 'thread/fork', 'thread/resume', 'thread/name/set'],
    )
    assert.equal(
      (calls[1]!.params as { threadId: string }).threadId,
      f.sourceId,
    )
    assert.match(
      (calls[3]!.params as { name: string }).name,
      /^QA lead — Crews recovery /,
    )
    assert.equal(
      new Room(f.directory).state.workers[0]?.managed?.threadId,
      forkId,
    )
    assert.equal(fs.existsSync(f.claim), false)
    assert.equal(receipt(f.directory, f.deliveryId), undefined)
  } finally {
    f.cleanup()
  }
})

test('Retry keeps the claim when the source task still has an active turn', async () => {
  const f = fixture()
  try {
    const calls: Array<{ method: string; params: unknown }> = []
    await assert.rejects(
      retryManagedDelivery(
        f.room,
        f.deliveryId,
        appServer(calls, f.sourceId, randomUUID(), 'inProgress'),
      ),
      /still working/,
    )
    assert.deepEqual(
      calls.map((call) => call.method),
      ['thread/turns/list'],
    )
    assert.equal(f.room.state.workers[0]?.managed?.threadId, f.sourceId)
    assert.equal(fs.existsSync(f.claim), true)
    assert.equal(receipt(f.directory, f.deliveryId)?.status, 'attention')
  } finally {
    f.cleanup()
  }
})

test('Retry keeps the source and claim when Codex has no saved turn boundary', async () => {
  const f = fixture()
  try {
    const calls: Array<{ method: string; params: unknown }> = []
    await assert.rejects(
      retryManagedDelivery(
        f.room,
        f.deliveryId,
        appServer(calls, f.sourceId, randomUUID(), null),
      ),
      /saved turn/,
    )
    assert.deepEqual(
      calls.map((call) => call.method),
      ['thread/turns/list'],
    )
    assert.equal(f.room.state.workers[0]?.managed?.threadId, f.sourceId)
    assert.equal(fs.existsSync(f.claim), true)
    assert.equal(receipt(f.directory, f.deliveryId)?.status, 'attention')
  } finally {
    f.cleanup()
  }
})

test('Retry keeps the old task and claim when fork permissions differ', async () => {
  const f = fixture()
  try {
    const calls: Array<{ method: string; params: unknown }> = []
    const run = appServer(calls, f.sourceId, randomUUID())
    await assert.rejects(
      retryManagedDelivery(f.room, f.deliveryId, async (callback) =>
        run(async (client) => {
          const request = client.request
          client.request = async (method, params) => {
            const result = await request(method, params)
            if (method === 'thread/resume')
              return { ...(result as object), approvalPolicy: 'on-request' }
            return result
          }
          return callback(client)
        }),
      ),
      /permissions/,
    )
    assert.equal(f.room.state.workers[0]?.managed?.threadId, f.sourceId)
    assert.equal(fs.existsSync(f.claim), true)
    assert.equal(receipt(f.directory, f.deliveryId)?.status, 'attention')
    const saved = JSON.parse(
      fs.readFileSync(
        path.join(f.directory, 'recoveries', f.deliveryId + '.json'),
        'utf8',
      ),
    ) as { sourceId: string; forkId: string }
    assert.equal(saved.sourceId, f.sourceId)
    assert.notEqual(saved.forkId, f.sourceId)
    await retryManagedDelivery(
      new Room(f.directory),
      f.deliveryId,
      appServer(calls, f.sourceId, saved.forkId),
    )
    assert.equal(
      calls.filter((call) => call.method === 'thread/fork').length,
      1,
    )
    assert.equal(
      new Room(f.directory).state.workers[0]?.managed?.threadId,
      saved.forkId,
    )
    assert.equal(fs.existsSync(f.claim), false)
    assert.equal(
      fs.existsSync(
        path.join(f.directory, 'recoveries', f.deliveryId + '.json'),
      ),
      false,
    )
  } finally {
    f.cleanup()
  }
})

test('Retry rechecks a transient permission response without making another fork', async () => {
  const f = fixture()
  try {
    const calls: Array<{ method: string; params: unknown }> = []
    const forkId = randomUUID()
    const run = appServer(calls, f.sourceId, forkId)
    let resumes = 0
    await retryManagedDelivery(f.room, f.deliveryId, async (callback) =>
      run(async (client) => {
        const request = client.request
        client.request = async (method, params) => {
          const result = await request(method, params)
          if (method === 'thread/resume' && resumes++ === 0)
            return { ...(result as object), approvalPolicy: 'on-request' }
          return result
        }
        return callback(client)
      }),
    )
    assert.equal(
      calls.filter((call) => call.method === 'thread/fork').length,
      1,
    )
    assert.equal(
      calls.filter((call) => call.method === 'thread/resume').length,
      2,
    )
    assert.equal(f.room.state.workers[0]?.managed?.threadId, forkId)
    assert.equal(fs.existsSync(f.claim), false)
  } finally {
    f.cleanup()
  }
})

test('Retry does not make another fork after an unconfirmed fork response', async () => {
  const f = fixture()
  try {
    const calls: Array<{ method: string; params: unknown }> = []
    const run = appServer(calls, f.sourceId, randomUUID())
    await assert.rejects(
      retryManagedDelivery(f.room, f.deliveryId, async (callback) =>
        run(async (client) => {
          const request = client.request
          client.request = async (method, params) => {
            if (method === 'thread/fork') {
              calls.push({ method, params })
              throw new Error('connection lost')
            }
            return request(method, params)
          }
          return callback(client)
        }),
      ),
      /did not confirm whether it created/,
    )
    await assert.rejects(
      retryManagedDelivery(
        new Room(f.directory),
        f.deliveryId,
        appServer(calls, f.sourceId, randomUUID()),
      ),
      /may have created a recovery task/,
    )
    assert.equal(
      calls.filter((call) => call.method === 'thread/fork').length,
      1,
    )
    assert.equal(fs.existsSync(f.claim), true)
    assert.equal(receipt(f.directory, f.deliveryId)?.status, 'attention')
  } finally {
    f.cleanup()
  }
})

test('a leftover journal does not block a later writer conflict on the adopted fork', async () => {
  const f = fixture()
  try {
    const firstForkId = randomUUID()
    f.room.replaceManagedThread(f.deliveryId, f.sourceId, firstForkId)
    atomicWrite(path.join(f.directory, 'recoveries', f.deliveryId + '.json'), {
      sourceId: f.sourceId,
      forkId: firstForkId,
    })
    // The first retry was released, then its new task hit a writer lock too.
    atomicWrite(receiptPath(f.directory, f.deliveryId), {
      status: 'attention',
      at: Date.now(),
      detail: `thread ${firstForkId} already has an active writer`,
      failure: 'writer',
    })
    const secondForkId = randomUUID()
    const calls: Array<{ method: string; params: unknown }> = []
    await retryManagedDelivery(
      new Room(f.directory),
      f.deliveryId,
      appServer(calls, firstForkId, secondForkId),
    )
    assert.equal(
      calls.filter((call) => call.method === 'thread/fork').length,
      1,
    )
    assert.equal(
      new Room(f.directory).state.workers[0]?.managed?.threadId,
      secondForkId,
    )
    assert.equal(fs.existsSync(f.claim), false)
  } finally {
    f.cleanup()
  }
})
