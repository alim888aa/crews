import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Room } from '../backend/room.js'
import { reviewableFileChanges } from '../backend/managed-workers.js'

test('app-server file-change items keep paths, diffs and move details reviewable', () => {
  assert.deepEqual(
    reviewableFileChanges([
      {
        path: '/project/new.ts',
        kind: { type: 'update', move_path: '/project/old.ts' },
        diff: '-old\n+new',
      },
    ]),
    [
      {
        path: '/project/new.ts',
        kind: 'update (move path: /project/old.ts)',
        diff: '-old\n+new',
      },
    ],
  )
  assert.equal(reviewableFileChanges([{ path: '/project/new.ts', kind: 'update', diff: '+new' }]), null)
})

test('managed command approvals wait for an explicit Crews decision', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-approval-'))
  try {
    const room = new Room(directory)
    const pending = room.requestManagedApproval(
      'worker',
      'delivery',
      'item/commandExecution/requestApproval',
      { command: 'echo hello', reason: 'Run the requested command' },
      new AbortController().signal,
    )
    const [approval] = room.snapshot().managedApprovals ?? []
    assert.ok(approval)
    assert.match(approval.detail, /Run the requested command/)
    assert.match(approval.detail, /echo hello/)
    room.answerManagedApproval(approval.id, 'accept')
    assert.deepEqual(await pending, { decision: 'accept' })
    assert.deepEqual(room.snapshot().managedApprovals, [])
    assert.throws(() => room.answerManagedApproval(approval.id, 'accept'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('managed permission requests grant only the requested access for one turn', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-approval-'))
  try {
    const room = new Room(directory)
    const permissions = { network: { enabled: true } }
    const pending = room.requestManagedApproval(
      'worker',
      'delivery',
      'item/permissions/requestApproval',
      { permissions },
      new AbortController().signal,
    )
    const [approval] = room.snapshot().managedApprovals ?? []
    assert.ok(approval)
    room.answerManagedApproval(approval.id, 'accept')
    assert.deepEqual(await pending, { permissions, scope: 'turn' })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('closing Crews declines a pending approval', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-approval-'))
  try {
    const room = new Room(directory)
    const controller = new AbortController()
    const pending = room.requestManagedApproval(
      'worker',
      'delivery',
      'item/fileChange/requestApproval',
      { reason: 'Edit a file', grantRoot: directory },
      controller.signal,
      [{ path: path.join(directory, 'file.ts'), kind: 'update', diff: '+safe edit' }],
    )
    const [approval] = room.snapshot().managedApprovals ?? []
    assert.ok(approval)
    assert.match(approval.detail, /safe edit/)
    assert.match(approval.detail, /Additional write root/)
    controller.abort()
    assert.deepEqual(await pending, { decision: 'decline' })
    assert.deepEqual(room.snapshot().managedApprovals, [])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('managed file changes are declined without a reviewable patch', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-approval-'))
  try {
    const room = new Room(directory)
    const result = await room.requestManagedApproval(
      'worker',
      'delivery',
      'item/fileChange/requestApproval',
      { reason: 'Apply an unspecified edit', itemId: 'item-1' },
      new AbortController().signal,
    )
    assert.deepEqual(result, { decision: 'decline' })
    assert.deepEqual(room.snapshot().managedApprovals, [])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
