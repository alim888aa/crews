import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Attachments, validateImageIds } from '../backend/attachments.js'
import { Room } from '../backend/room.js'
import { envelope } from '../backend/relay.js'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=',
  'base64',
)
test('attachment storage survives restart, rejects bad IDs and never follows a file symlink', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-images-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = new Attachments(dir)
  const image = store.save(png, '../../Screenshot.png')
  assert.equal(image.name, 'Screenshot.png')
  assert.deepEqual(new Attachments(dir).resolve([image.id]), [image])
  assert.deepEqual(fs.readFileSync(store.file(image.id)), png)
  assert.throws(() => store.resolve(['../../state']))
  assert.throws(() => validateImageIds([image.id, image.id]))
  assert.throws(() => validateImageIds(Array.from({ length: 5 }, randomUUID)))
  assert.throws(() => store.save(Buffer.alloc(11 * 1024 * 1024), 'large.png'))
  fs.unlinkSync(store.file(image.id))
  fs.symlinkSync(
    path.join(dir, 'attachments', image.id + '.json'),
    path.join(dir, 'attachments', image.id + '.png'),
  )
  assert.throws(() => store.file(image.id))
  store.remove(image.id)
  assert.throws(() => store.resolve([image.id]))
})
test('images persist with messages and reach only their conversation; invalid sends are atomic', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-images-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const room = new Room(dir)
  const worker = randomUUID()
  room.receive({
    kind: 'catalog',
    tasks: [
      { id: worker, title: 'Tester', cwd: '/tmp', updatedAt: Date.now() },
    ],
  })
  room.add({ id: worker, title: 'Tester', handle: 'tester' })
  const store = new Attachments(dir)
  const image = store.save(png, 'Screenshot.png')
  const other = room.send({ text: '@tester unrelated', parentId: null })
  const root = room.send({
    text: '@tester inspect this',
    parentId: null,
    attachmentIds: [image.id],
  })
  const reply = room.send({
    text: '',
    parentId: root.id,
    attachmentIds: [image.id],
  })
  assert.equal(reply.attachments?.[0]?.id, image.id)
  const reopened = new Room(dir)
  assert.deepEqual(reopened.state.messages, room.state.messages)
  const delivery = room.state.deliveries.find((d) => d.messageId === reply.id)!
  const addressed = envelope(reopened.state, delivery, dir)
  assert.equal(
    addressed.messages.at(-1)?.attachments?.[0]?.path,
    store.file(image.id),
  )
  assert.equal(
    addressed.messages.some((m) => m.id === other.id),
    false,
  )
  const unrelated = envelope(room.state, room.state.deliveries[0]!, dir)
  assert.equal(
    unrelated.messages.some((m) => m.attachments?.length),
    false,
  )
  const before = structuredClone(room.state)
  assert.throws(() => room.send({ text: '', parentId: root.id }))
  assert.throws(() =>
    room.send({ text: '', parentId: null, attachmentIds: [image.id] }),
  )
  assert.throws(() =>
    room.send({
      text: '@tester broken',
      parentId: null,
      attachmentIds: [randomUUID()],
    }),
  )
  assert.deepEqual(room.state, before)
  assert.ok(fs.existsSync(store.file(image.id)))
})
