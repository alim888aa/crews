/** Isolated channel UI smoke test. Never connects or messages live Codex tasks. */
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  nativeImage,
  dialog,
} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { registerImageHandlers } from '../electron/images.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-channels-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  protocol.registerSchemesAsPrivileged([
    { scheme: 'crew-image', privileges: { standard: true, secure: true } },
  ])
  await app.whenReady()
  let room = new Room(directory)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'isolated-test',
    token: room.state.relay.token,
  })
  for (const handle of ['engineer', 'vp']) {
    const id = randomUUID()
    room.receive({
      kind: 'catalog',
      tasks: [{ id, title: handle, updatedAt: 1, cwd: directory }],
    })
    room.add({ id, title: handle, handle })
  }
  const engineer = room.state.workers[0]!
  const vp = room.state.workers[1]!
  room.send({ text: '@engineer Original general chat', parentId: null })
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
  let releaseSend: (() => void) | undefined
  let holdSend = false
  let rejectMembers = false
  let pendingSendCount = 0
  let holdTaskCreation = false
  let releaseTaskCreation: (() => void) | undefined
  let holdChannelSave = false
  let releaseChannelSave: (() => void) | undefined
  const openedConnections: string[] = []
  const pickers: Array<{
    resolve: (result: Electron.OpenDialogReturnValue) => void
    reject: (error: Error) => void
  }> = []
  dialog.showOpenDialog = async () =>
    new Promise((resolve, reject) => {
      pickers.push({ resolve, reject })
    })
  registerImageHandlers(room, win, (channel, fn) =>
    ipcMain.handle(channel, (_event, value) => fn(value)),
  )
  ipcMain.handle('room:snapshot', () => room.snapshot())
  ipcMain.handle('room:models', () => [
    {
      model: 'gpt-6-luna',
      displayName: 'GPT-6-Luna',
      description: 'Fixture model',
      efforts: ['low'],
      defaultEffort: 'low',
      isDefault: true,
    },
  ])
  ipcMain.handle('room:create-task', async (_event, input) => {
    if (holdTaskCreation)
      await new Promise<void>((resolve) => {
        releaseTaskCreation = resolve
      })
    const id = randomUUID()
    room.addManaged(
      {
        id,
        title: input.title as string,
        handle: input.handle as string,
        identity: input.identity as string,
        role: input.role as string,
      },
      {
        cwd: input.cwd as string,
        model: input.model as string,
        effort: input.effort as string,
        permission: input.permission as 'auto' | 'full',
        threadId: null,
      },
    )
    broadcast()
    return {
      worker: room.snapshot().workers.find((worker) => worker.id === id),
    }
  })
  ipcMain.handle('room:copy-open', (_event, input) => {
    openedConnections.push(input.id as string)
  })
  ipcMain.handle('room:create-channel', async (_event, payload) => {
    if (holdChannelSave)
      await new Promise<void>((resolve) => {
        releaseChannelSave = resolve
      })
    const channel = room.createChannel(payload)
    broadcast()
    return channel
  })
  ipcMain.handle('room:channel-members', (_event, payload) => {
    if (rejectMembers) throw new Error('Test member save failure')
    room.setChannelMembers(payload)
    broadcast()
  })
  ipcMain.handle('room:send', async (_event, payload) => {
    if (holdSend)
      await new Promise<void>((resolve) => {
        pendingSendCount++
        releaseSend = resolve
      })
    const message = room.send(payload)
    broadcast()
    return message
  })
  const js = (code: string) => win.webContents.executeJavaScript(code)
  async function until(code: string) {
    for (let i = 0; i < 60; i++) {
      if (await js(`Boolean(${code})`)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Timed out: ' + code)
  }
  const click = (label: string) =>
    js(
      `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`,
    )
  const mainText = `document.querySelector('main.channel textarea')`
  async function type(selector: string, text: string) {
    await js(`${selector}.focus()`)
    await win.webContents.insertText(text)
  }
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await until(`${mainText}`)
    await type(mainText, '@engineer general draft')
    await click('New channel')
    await until(`document.getElementById('channel-name')`)
    await type(`document.getElementById('channel-name')`, 'project')
    await js(`document.querySelector('[role="checkbox"]').click()`)
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Create channel').click()`,
    )
    await until(`document.querySelector('main h1')?.textContent === 'project'`)
    const project = room.state.channels.find((c) => c.name === 'project')!
    assert.deepEqual(project.memberIds, [engineer.id])
    assert.equal(
      await js(
        `Boolean(document.querySelector('[aria-label="Room and teammates"] [aria-label="View profile for engineer"]'))`,
      ),
      true,
    )
    assert.equal(
      await js(
        `Boolean(document.querySelector('[aria-label="Room and teammates"] [aria-label="View profile for vp"]'))`,
      ),
      false,
    )
    assert.equal(await js(`${mainText}.value`), '')
    assert.equal(
      await js(
        `document.querySelector('main.channel').textContent.includes('Original general chat')`,
      ),
      false,
    )
    await type(mainText, '@all Project meeting')
    await click('Send message')
    await until(
      `document.querySelector('[aria-label="Conversation replies"] textarea')`,
    )
    const root = room.state.messages.at(-1)!
    assert.equal(root.channelId, project.id)
    assert.deepEqual(root.recipientIds, [engineer.id])
    const replyText = `document.querySelector('[aria-label="Conversation replies"] textarea')`
    await type(replyText, '@vp Join this meeting')
    await click('Send reply')
    await until(`${replyText}.value === ''`)
    assert.deepEqual(room.state.messages.at(-1)!.recipientIds, [vp.id])
    assert.deepEqual(
      room.state.channels.find((c) => c.id === project.id)!.memberIds,
      [engineer.id],
    )
    await type(replyText, '@all Meeting followup')
    await click('Send reply')
    await until(`${replyText}.value === ''`)
    assert.deepEqual(
      new Set(room.state.messages.at(-1)!.recipientIds),
      new Set([engineer.id, vp.id]),
    )
    await click('Open #general')
    await until(`${mainText}.value === '@engineer general draft'`)
    assert.equal(
      await js(
        `Boolean(document.querySelector('[aria-label="Room and teammates"] [aria-label="View profile for vp"]'))`,
      ),
      true,
    )
    await click('Open #project')
    await until(`${mainText}.value === ''`)
    await type(mainText, '@engineer delayed send')
    // Pending image work and its errors survive the same channel remounts as sends.
    await click('Attach images')
    while (!pickers[0]) await new Promise((resolve) => setTimeout(resolve, 20))
    await click('Open #general')
    await click('Open #project')
    assert.equal(
      await js(
        `document.querySelector('main [aria-label="Attach images"]').disabled`,
      ),
      true,
    )
    pickers[0]!.reject(new Error('Test picker failure'))
    await until(
      `document.querySelector('main.channel').textContent.includes('Test picker failure')`,
    )
    await click('Attach images')
    while (!pickers[1]) await new Promise((resolve) => setTimeout(resolve, 20))
    const imageFile = path.join(directory, 'draft.png')
    fs.writeFileSync(
      imageFile,
      nativeImage
        .createFromBitmap(Buffer.alloc(32 * 24 * 4, 180), {
          width: 32,
          height: 24,
          scaleFactor: 1,
        })
        .toPNG(),
    )
    pickers[1]!.resolve({ canceled: false, filePaths: [imageFile] })
    await until(`document.querySelector('main form img')?.naturalWidth === 32`)
    holdSend = true
    await click('Send message')
    while (!releaseSend) await new Promise((resolve) => setTimeout(resolve, 20))
    await click('Open #general')
    await until(`${mainText}.value === '@engineer general draft'`)
    await click('Open #project')
    await until(`${mainText}.value === '@engineer delayed send'`)
    assert.equal(
      await js(
        `document.querySelector('main [aria-label="Send message"]').disabled`,
      ),
      true,
    )
    assert.equal(
      await js(
        `document.querySelector('main [aria-label="Attach images"]').disabled`,
      ),
      true,
    )
    await js(
      `${mainText}.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(pendingSendCount, 1)
    await click('Open #general')
    releaseSend()
    await until(
      `!document.querySelector('main.channel').textContent.includes('delayed send')`,
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(room.state.messages.at(-1)!.channelId, project.id)
    assert.equal(
      room.state.messages.filter(
        (message) => message.text === '@engineer delayed send',
      ).length,
      1,
    )
    assert.equal(room.state.messages.at(-1)!.attachments?.length, 1)
    assert.equal(
      await js(`document.querySelector('main h1').textContent`),
      'general',
    )
    assert.equal(await js(`${mainText}.value`), '@engineer general draft')
    const delivery = room.state.deliveries.find((d) => d.rootId === root.id)!
    room.receive({
      kind: 'reply',
      workerId: engineer.id,
      deliveryId: delivery.id,
      text: 'Late project reply',
      to: [],
    })
    broadcast()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      await js(
        `document.querySelector('main.channel').textContent.includes('Late project reply')`,
      ),
      false,
    )
    await click('Open #project')
    await until(
      `document.querySelector('main.channel').textContent.includes('Late project reply')`,
    )
    await click('Manage channel members')
    await until(
      `document.querySelectorAll('[role="dialog"] [role="checkbox"]').length === 2`,
    )
    await js(
      `document.querySelectorAll('[role="dialog"] [role="checkbox"]')[1].click()`,
    )
    rejectMembers = true
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Save members').click()`,
    )
    await until(
      `document.querySelector('[role="dialog"]').textContent.includes('Test member save failure')`,
    )
    assert.deepEqual(
      room.state.channels.find((c) => c.id === project.id)!.memberIds,
      [engineer.id],
    )
    rejectMembers = false
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Save members').click()`,
    )
    await until(`!document.querySelector('[role="dialog"]')`)
    assert.deepEqual(
      new Set(room.state.channels.find((c) => c.id === project.id)!.memberIds),
      new Set([engineer.id, vp.id]),
    )
    await click('New channel')
    await until(`document.getElementById('channel-name')`)
    await type(`document.getElementById('channel-name')`, 'new-team')
    await js(
      `document.querySelector('[role="dialog"] [role="checkbox"]').click()`,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Create teammate').click()`,
    )
    await until(`document.getElementById('new-teammate-name')`)
    await type(`document.getElementById('new-teammate-name')`, 'New Worker')
    await type(`document.getElementById('new-teammate-folder')`, directory)
    assert.equal(
      await js(`document.getElementById('new-teammate-permission').value`),
      'full',
    )
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Create teammate').click()`,
    )
    await until(`document.getElementById('channel-name')`)
    const newWorker = room.state.workers.find(
      (worker) => worker.handle === 'new-worker',
    )!
    assert.equal(
      await js(`document.getElementById('channel-name').value`),
      'new-team',
    )
    assert.equal(
      await js(
        `Boolean(document.getElementById('channel-member-${newWorker.id}')?.checked)`,
      ),
      true,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Create teammate').click()`,
    )
    await until(`document.getElementById('new-teammate-name')`)
    await type(`document.getElementById('new-teammate-name')`, 'Second Worker')
    await type(`document.getElementById('new-teammate-folder')`, directory)
    holdTaskCreation = true
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Create teammate').click()`,
    )
    while (!releaseTaskCreation)
      await new Promise((resolve) => setTimeout(resolve, 20))
    await until(
      `document.querySelector('[role="dialog"]')?.textContent.includes('Creating teammate')`,
    )
    assert.equal(
      await js(`document.querySelector('[data-slot="dialog-close"]')`),
      null,
    )
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(
      await js(`Boolean(document.getElementById('new-teammate-name'))`),
      true,
    )
    holdTaskCreation = false
    releaseTaskCreation()
    await until(`document.getElementById('channel-name')`)
    const secondWorker = room.state.workers.find(
      (worker) => worker.handle === 'second-worker',
    )!
    assert.equal(
      await js(
        `Boolean(document.getElementById('channel-member-${secondWorker.id}')?.checked)`,
      ),
      true,
    )
    await js(
      `document.getElementById('channel-member-${secondWorker.id}').click()`,
    )
    assert.equal(
      await js(
        `Boolean(document.getElementById('channel-member-${secondWorker.id}')?.checked)`,
      ),
      false,
    )
    await js(
      `document.getElementById('channel-member-${secondWorker.id}').click()`,
    )
    assert.equal(
      await js(
        `Boolean(document.getElementById('channel-member-${secondWorker.id}')?.checked)`,
      ),
      true,
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    fs.writeFileSync(
      '/private/tmp/crews-new-channel-draft.png',
      (await win.webContents.capturePage()).toPNG(),
    )
    assert.deepEqual(openedConnections, [])
    holdChannelSave = true
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Create channel').click()`,
    )
    while (!releaseChannelSave)
      await new Promise((resolve) => setTimeout(resolve, 20))
    await until(`document.getElementById('channel-name')?.disabled`)
    assert.equal(
      await js(`document.querySelector('[data-slot="dialog-close"]')`),
      null,
    )
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Cancel')?.disabled`,
      ),
      true,
    )
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    assert.equal(
      await js(`Boolean(document.getElementById('channel-name'))`),
      true,
    )
    holdChannelSave = false
    releaseChannelSave()
    await until(`document.querySelector('main h1')?.textContent === 'new-team'`)
    await until(`!document.querySelector('[role="dialog"]')`)
    assert.deepEqual(openedConnections, [])
    assert.deepEqual(
      new Set(
        room.state.channels.find((c) => c.name === 'new-team')!.memberIds,
      ),
      new Set([engineer.id, newWorker.id, secondWorker.id]),
    )
    fs.writeFileSync(
      '/private/tmp/crews-channels-ui.png',
      (await win.webContents.capturePage()).toPNG(),
    )
    room = new Room(directory)
    await win.loadFile(path.resolve('dist/index.html'))
    await until(`${mainText}`)
    assert.equal(await js(`${mainText}.value`), '@engineer general draft')
    assert.equal(
      room.state.channels.find((c) => c.id === project.id)!.name,
      'project',
    )
    console.log(
      'PASS channel creation with new teammate, membership save/retry, guests, drafts, pending upload/send remount guards, late replies and restart',
    )
  } catch (error) {
    console.error(error)
    console.error(
      await js(`document.querySelector('main.channel')?.textContent`),
    )
    process.exitCode = 1
  } finally {
    win.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
    app.exit(Number(process.exitCode) || 0)
  }
})()
