import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import { Room } from '../backend/room.js'
import { installRuntime } from '../backend/runtime.js'
import { claimBatch, envelope } from '../backend/relay.js'
import { loadRoster, projectRosters } from '../backend/roster.js'

const exec = promisify(execFile)

function fixture(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-roster-'))
  const runtime = path.join(dir, 'runtime')
  installRuntime(path.resolve('build'), runtime, dir, [process.execPath])
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return {
    dir,
    runtime,
    room: new Room(dir),
    cli: path.join(runtime, 'cli.mjs'),
  }
}

function add(room: Room, handle: string, role: string) {
  const id = randomUUID()
  room.receive({
    kind: 'catalog',
    tasks: [{ id, title: handle, updatedAt: Date.now(), cwd: '' }],
  })
  room.add({ id, title: handle, handle, role, identity: 'Private ' + handle })
  room.receive({
    kind: 'connect',
    workerId: id,
    token: room.state.workers.find((worker) => worker.id === id)!.token,
  })
  return id
}

async function hook(runtime: string, worker: string) {
  const child = spawn(
    process.execPath,
    [path.join(runtime, 'context-hook.mjs')],
    {
      env: { ...process.env, CODEX_THREAD_ID: worker },
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += String(chunk)))
  const done = new Promise<number | null>((resolve) =>
    child.once('close', resolve),
  )
  child.stdin.end(
    JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: worker }),
  )
  assert.equal(await done, 0)
  return output
}

test('rosters follow current channel membership and keep identity briefs private', (t) => {
  const { dir, room } = fixture(t)
  const a = add(room, 'lead', 'Engineering lead')
  const b = add(room, 'qa', 'QA lead')
  const c = add(room, 'intern', 'Intern')
  const alpha = room.createChannel({ name: 'alpha', memberIds: [a, b] })
  room.createChannel({ name: 'beta', memberIds: [a, c] })
  const forQa = projectRosters(room.state, b)
  assert.deepEqual(
    forQa.map((project) => project.name),
    ['general', 'alpha'],
  )
  assert.deepEqual(
    forQa[1]!.members.map((member) => member.handle),
    ['lead', 'qa'],
  )
  const first = loadRoster(room.state, dir, b, false)!
  assert.match(first.context, /Engineering lead/)
  assert.doesNotMatch(first.context, /Private lead|"name":"beta"/)
  first.recordEmitted()
  assert.equal(loadRoster(room.state, dir, b, false), undefined)
  room.setChannelMembers({ id: alpha.id, memberIds: [a] })
  const changed = loadRoster(room.state, dir, b, false)!
  assert.doesNotMatch(changed.context, /"name":"alpha"/)
  changed.recordEmitted()
  room.edit({ id: a, title: 'lead', handle: 'lead', role: 'Architecture' })
  assert.match(loadRoster(room.state, dir, b, false)!.context, /Architecture/)
  assert.equal(
    new Room(dir).state.workers.find((worker) => worker.id === a)!.role,
    'Architecture',
  )
  assert.throws(() =>
    room.edit({ id: a, title: 'lead', handle: 'lead', role: 'Two\nlines' }),
  )
  assert.equal(
    room.state.workers.find((worker) => worker.id === a)!.role,
    'Architecture',
  )
})

test('ordinary takes refresh the project roster and same-project contact keeps context', async (t) => {
  const { dir, runtime, room, cli } = fixture(t)
  const lead = add(room, 'lead', 'Engineering lead')
  const qa = add(room, 'qa', 'QA lead')
  const outsider = add(room, 'outsider', 'Other project')
  const alpha = room.createChannel({ name: 'alpha', memberIds: [lead, qa] })
  room.createChannel({ name: 'beta', memberIds: [outsider] })
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'test',
    token: room.state.relay.token,
  })
  const root = room.send({
    text: '@lead Review this',
    parentId: null,
    channelId: alpha.id,
  })
  const [job] = claimBatch(dir, runtime, [process.execPath])
  assert.ok(job)
  room.receive({ kind: 'started', workerId: lead, deliveryId: job.deliveryId })
  const take = async () =>
    JSON.parse(
      (await exec(process.execPath, [cli, 'take', lead, job.deliveryId]))
        .stdout,
    )
  const first = await take()
  assert.deepEqual(
    first.projectMembers.map((member: { handle: string }) => member.handle),
    ['lead', 'qa'],
  )
  assert.equal(first.projectMembership, 'member')
  assert.equal(first.rosterUpdate, undefined)
  assert.doesNotMatch(JSON.stringify(first), /"name":"beta"/)
  assert.match(await hook(runtime, lead), /QA lead/)
  room.edit({ id: qa, title: 'qa', handle: 'qa', role: 'Release reviewer' })
  const edited = await take()
  assert.deepEqual(edited.projectMembers[1], {
    handle: 'qa',
    role: 'Release reviewer',
  })
  assert.match(await hook(runtime, lead), /Release reviewer/)
  room.edit({ id: qa, title: 'qa', handle: 'qa', role: 'Test owner' })
  assert.match(await hook(runtime, lead), /Test owner/)
  assert.deepEqual((await take()).projectMembers[1], {
    handle: 'qa',
    role: 'Test owner',
  })
  assert.throws(() =>
    room.receive({
      kind: 'reply',
      workerId: lead,
      deliveryId: job.deliveryId,
      text: 'Cross-project',
      to: ['outsider'],
    }),
  )
  room.receive({
    kind: 'reply',
    workerId: lead,
    deliveryId: job.deliveryId,
    text: '@qa please review this',
    to: ['qa'],
  })
  const peer = room.state.messages.at(-1)!
  assert.equal(peer.rootId, root.id)
  assert.equal(peer.parentId, root.id)
  assert.equal(peer.channelId, alpha.id)
  assert.equal(room.state.deliveries.at(-1)!.workerId, qa)
  assert.deepEqual(
    envelope(room.state, room.state.deliveries.at(-1)!, dir).messages.map(
      (message) => message.id,
    ),
    [root.id, peer.id],
  )
})

test('reapproval withdraws a previously emitted roster until reconnection', async (t) => {
  const { dir, runtime, room } = fixture(t)
  const qa = add(room, 'qa', 'Release reviewer')
  const alpha = room.createChannel({ name: 'alpha', memberIds: [qa] })
  const first = loadRoster(room.state, dir, qa, false)!
  assert.match(first.context, /"name":"alpha"/)
  first.recordEmitted()

  const approval = room.beginApproval(qa)
  room.setChannelMembers({ id: alpha.id, memberIds: [] })
  const revoked = await hook(runtime, qa)
  assert.match(revoked, /rosters.*withdrawn/)
  assert.doesNotMatch(revoked, /Release reviewer|"name":"alpha"/)
  assert.equal(loadRoster(room.state, dir, qa, false), undefined)

  room.receive({ kind: 'connect', workerId: qa, token: approval.token })
  const restored = await hook(runtime, qa)
  assert.match(restored, /Current Crews project rosters/)
  assert.doesNotMatch(restored, /"name":"alpha"/)
})

test('a user-invited conversation guest can address channel members', (t) => {
  const { dir, room } = fixture(t)
  const lead = add(room, 'lead', 'Engineering lead')
  const qa = add(room, 'qa', 'QA lead')
  const guest = add(room, 'guest', 'Visitor')
  const alpha = room.createChannel({ name: 'alpha', memberIds: [lead, qa] })
  room.send({
    text: '@guest and @lead discuss',
    parentId: null,
    channelId: alpha.id,
  })
  const delivery = room.state.deliveries.find(
    (item) => item.workerId === guest,
  )!
  const context = envelope(room.state, delivery, dir)
  assert.equal(context.projectMembership, 'guest')
  assert.deepEqual(
    context.projectMembers?.map((member) => member.handle),
    ['lead', 'qa'],
  )
  room.receive({
    kind: 'reply',
    workerId: guest,
    deliveryId: delivery.id,
    text: '@qa join',
    to: ['qa'],
  })
  assert.ok(
    room.state.deliveries.some(
      (item) => item.workerId === qa && item.rootId === delivery.rootId,
    ),
  )
})
