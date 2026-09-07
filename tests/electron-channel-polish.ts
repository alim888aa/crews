/** User-facing deletion and mention tests, using disposable local data only. */
import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { Attachments } from '../backend/attachments.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-polish-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  await app.whenReady()
  let room = new Room(directory)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'isolated-test',
    token: room.state.relay.token,
  })
  for (const handle of ['outsider', 'member']) {
    const id = randomUUID()
    room.receive({
      kind: 'catalog',
      tasks: [{ id, title: handle, updatedAt: 1, cwd: directory }],
    })
    room.add({ id, title: handle, handle })
  }
  const [outsider, member] = room.state.workers
  const target = room.createChannel({
    name: 'disposable',
    memberIds: [member!.id],
  })
  const other = room.createChannel({ name: 'keep-me', memberIds: [member!.id] })
  const png = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
  png.writeUInt32BE(1, 16)
  png.writeUInt32BE(1, 20)
  const images = new Attachments(directory)
  const sharedImage = images.save(png, 'shared.png')
  const exclusiveImage = images.save(png, 'exclusive.png')
  const root = room.send({
    text: '@member @outsider preserved order',
    channelId: target.id,
    parentId: null,
    attachmentIds: [sharedImage.id, exclusiveImage.id],
  })
  // Complete this isolated discussion so the channel is initially deletable.
  while (room.state.deliveries.some((d) => d.status === 'pending')) {
    const d = room.state.deliveries.find((d) => d.status === 'pending')!
    room.receive({
      kind: 'reply',
      workerId: d.workerId,
      deliveryId: d.id,
      text: 'fixture reply',
      to: [],
    })
  }
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.resolve('build/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  const broadcast = () => win.webContents.send('room:state', room.snapshot())
  let rejectDelete = false
  let injectPending = false
  let finishPick: (() => void) | undefined
  ipcMain.handle(
    'room:image-pick',
    () =>
      new Promise((resolve) => {
        finishPick = () => resolve([])
      }),
  )
  ipcMain.handle('room:snapshot', () => room.snapshot())
  ipcMain.handle('room:delete-channel', (_e, id) => {
    if (rejectDelete) throw new Error('Fixture disk failure')
    if (injectPending) {
      injectPending = false
      room.send({ text: '@member race', channelId: id, parentId: null })
    }
    const imageIds = room.deleteChannel(id)
    broadcast()
    return imageIds
  })
  ipcMain.handle('room:send', (_e, payload) => {
    const m = room.send(payload)
    broadcast()
    return m
  })
  const removedImages: string[] = []
  ipcMain.handle('room:image-remove', (_e, id) => {
    removedImages.push(id)
    images.remove(id)
  })
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const until = async (code: string) => {
    for (let i = 0; i < 80; i++) {
      if (await js(`Boolean(${code})`)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Timed out: ' + code)
  }
  const click = (label: string) =>
    js(
      `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`,
    )
  const dialogButton = (text: string) =>
    js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`,
    )
  const input = `document.querySelector('main.channel textarea')`
  const type = async (selector: string, text: string) => {
    await js(`${selector}.focus()`)
    await win.webContents.insertText(text)
  }
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await until(input)
    await js(
      `localStorage.setItem('crews-image-drafts-v1', JSON.stringify({${JSON.stringify('channel:' + other.id)}: ${JSON.stringify([sharedImage])}}))`,
    )
    await win.loadFile(path.resolve('dist/index.html'))
    await until(input)
    assert.equal(
      await js(`!!document.querySelector('[aria-label="Delete #general"]')`),
      false,
    )
    await type(input, '@member general survives')
    await click('Open #keep-me')
    await until(`document.querySelector('main h1')?.textContent === 'keep-me'`)
    await type(input, '@member other draft')
    await click('Open #disposable')
    await until(
      `document.querySelector('main h1')?.textContent === 'disposable'`,
    )
    const mentions = await js(
      `Array.from(document.querySelectorAll('main [aria-label="Mention teammates"] button')).map(b=>b.getAttribute('aria-label'))`,
    )
    assert.deepEqual(mentions, [
      'Mention all channel members',
      'Mention member',
      'Mention outsider',
    ])
    assert.deepEqual(root.recipientIds, [member!.id, outsider!.id])
    await type(input, '@member target draft')
    await click('Reply to You')
    const replyInput = `document.querySelector('[aria-label="Conversation replies"] textarea')`
    await until(replyInput)
    await type(replyInput, 'conversation draft')
    const conversationChoices = await js(
      `Array.from(document.querySelectorAll('[aria-label="Conversation replies"] [aria-label="Mention teammates"] button')).filter(b=>b.getAttribute('aria-label')?.startsWith('Mention ')).map(b=>({label:b.getAttribute('aria-label'),primary:b.classList.contains('font-semibold')}))`,
    )
    assert.equal(
      conversationChoices.find(
        (b: { label: string }) => b.label === 'Mention outsider',
      )?.primary,
      true,
    )
    await click('Delete #disposable')
    await until(`document.querySelector('[role="dialog"]')`)
    await js(
      `document.querySelector('main [aria-label="Attach images"]').click()`,
    )
    await until(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Delete channel')?.disabled`,
    )
    assert.ok(finishPick)
    finishPick()
    await until(
      `!Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Delete channel')?.disabled`,
    )
    assert.match(
      await js(`document.querySelector('[role="dialog"]').textContent`),
      /disposable/,
    )
    await dialogButton('Cancel')
    await until(`!document.querySelector('[role="dialog"]')`)
    assert.equal(await js(`${input}.value`), '@member target draft')
    assert.ok(room.state.channels.some((c) => c.id === target.id))
    await click('Delete #disposable')
    await until(`document.querySelector('[role="dialog"]')`)
    rejectDelete = true
    await dialogButton('Delete channel')
    await until(
      `document.querySelector('[role="alert"]')?.textContent.includes('Fixture disk failure')`,
    )
    assert.ok(room.state.messages.some((m) => m.id === root.id))
    assert.equal(
      await js(
        `JSON.parse(localStorage.getItem('crews-drafts-v3'))[${JSON.stringify('channel:' + target.id)}]`,
      ),
      '@member target draft',
    )
    rejectDelete = false
    injectPending = true
    await dialogButton('Delete channel')
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.ok(
      room.state.channels.some((c) => c.id === target.id),
      'backend rechecks pending work after dialog opens',
    )
    const pending = room.state.deliveries.find((d) => d.status === 'pending')!
    assert.ok(pending)
    room.receive({
      kind: 'reply',
      workerId: pending.workerId,
      deliveryId: pending.id,
      text: 'race completed',
      to: [],
    })
    broadcast()
    await until(`document.querySelector('[role="dialog"]')`)
    await dialogButton('Delete channel')
    await until(`!document.querySelector('[aria-label="Open #disposable"]')`)
    await until(`document.querySelector('main h1')?.textContent === 'general'`)
    assert.equal(await js(`${input}.value`), '@member general survives')
    assert.equal(
      await js(
        `JSON.parse(localStorage.getItem('crews-drafts-v3'))[${JSON.stringify('channel:' + target.id)}]`,
      ),
      undefined,
    )
    assert.equal(
      await js(
        `JSON.parse(localStorage.getItem('crews-drafts-v3'))[${JSON.stringify(root.id)}]`,
      ),
      undefined,
    )
    assert.equal(
      room.state.messages.some((m) => m.channelId === target.id),
      false,
    )
    assert.deepEqual(
      room.state.workers.map((w) => w.id),
      [outsider!.id, member!.id],
    )
    assert.deepEqual(
      room.state.channels.find((c) => c.id === other.id),
      other,
    )
    await click('Open #keep-me')
    await until(`${input}.value === '@member other draft'`)
    room = new Room(directory)
    assert.ok(removedImages.includes(exclusiveImage.id))
    assert.equal(removedImages.includes(sharedImage.id), false)
    assert.ok(fs.existsSync(images.file(sharedImage.id)))
    await win.loadFile(path.resolve('dist/index.html'))
    await until(input)
    assert.equal(
      await js(`!!document.querySelector('[aria-label="Open #disposable"]')`),
      false,
    )
    await click('Open #keep-me')
    await until(`document.querySelector('main h1')?.textContent === 'keep-me'`)
    await until(`${input}.value === '@member other draft'`)
    fs.writeFileSync(
      '/private/tmp/crews-channel-polish.png',
      (await win.webContents.capturePage()).toPNG(),
    )
    console.log(
      JSON.stringify({
        passed: true,
        directory,
        cases: [
          'member-first mention row',
          'typed order preserved',
          'general protected',
          'cancel preserves draft',
          'failed deletion preserves state',
          'pending work rechecked',
          'successful deletion isolates channel',
          'draft and history stay deleted after restart',
          'other channel and teammate preservation',
        ],
      }),
    )
  } finally {
    win.destroy()
    app.quit()
  }
})().catch((error) => {
  console.error(error)
  app.exit(1)
})
