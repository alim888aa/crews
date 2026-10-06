/** Disposable renderer smoke test; never sends to a real Codex task. */
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'

async function waitFor(win: BrowserWindow, check: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await win.webContents.executeJavaScript(check)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Renderer did not reach expected state: ' + check)
}

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-mentions-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  await app.whenReady()
  const room = new Room(directory)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'fixture',
    token: room.state.relay.token,
  })
  const workerId = randomUUID()
  room.receive({
    kind: 'catalog',
    tasks: [{ id: workerId, title: 'Lead', updatedAt: 1, cwd: directory }],
  })
  room.add({ id: workerId, title: 'Lead', handle: 'lead' })
  const project = room.createChannel({ name: 'project', memberIds: [workerId] })
  const mentionIds: string[] = []
  for (const [channelId, label] of [
    ['general', 'General'],
    [project.id, 'Project'],
  ]) {
    const root = room.send({
      text: `@lead ${label} question`,
      parentId: null,
      channelId,
    })
    const delivery = room.state.deliveries.find(
      (item) => item.messageId === root.id,
    )!
    room.receive({
      kind: 'reply',
      workerId,
      deliveryId: delivery.id,
      text: `@you ${label} needs your decision`,
      to: [],
    })
    mentionIds.push(
      room.state.deliveries.find((item) => item.id === delivery.id)!.replyId!,
    )
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
  ipcMain.handle('room:snapshot', () => room.snapshot())
  ipcMain.handle('room:read-mentions', (_event, rootId) => {
    room.readMentions(rootId)
    win.webContents.send('room:state', room.snapshot())
  })
  const releaseSends: Array<() => void> = []
  ipcMain.handle('room:send', async (_event, payload) => {
    await new Promise<void>((resolve) => {
      releaseSends.push(resolve)
    })
    const message = room.send(payload)
    win.webContents.send('room:state', room.snapshot())
    return message
  })
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await waitFor(
      win,
      `document.querySelector('[aria-label="Mentions, 2 unread"]') !== null`,
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Mentions, 2 unread"]').click()`,
    )
    await waitFor(
      win,
      `document.body.textContent.includes('Project needs your decision')`,
    )
    await win.webContents.executeJavaScript(`
      [...document.querySelectorAll('[data-slot="sheet-content"] button')]
        .find((button) => button.textContent.includes('Project needs your decision')).click()
    `)
    await waitFor(
      win,
      `document.querySelector('main h1')?.textContent === 'project' && document.querySelector('[aria-label="Conversation replies"]')?.textContent.includes('Project needs your decision')`,
    )
    assert.equal(
      room.state.mentions.filter((mention) => !mention.readAt).length,
      1,
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Close conversation"]').click()`,
    )
    await waitFor(
      win,
      `document.querySelector('main h1')?.textContent === 'project'`,
    )
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('main button')].find((button) => button.textContent.includes('reply')).click()`,
    )
    await waitFor(
      win,
      `document.querySelector('[aria-label="Conversation replies"]')?.textContent.includes('Project needs your decision')`,
    )

    // The native notification click sends this same event with the saved message ID.
    win.webContents.send('room:open-mention', mentionIds[0])
    await waitFor(
      win,
      `document.querySelector('main h1')?.textContent === 'general' && document.querySelector('[aria-label="Conversation replies"]')?.textContent.includes('General needs your decision')`,
    )
    assert.equal(
      room.state.mentions.filter((mention) => !mention.readAt).length,
      0,
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('main textarea').focus()`,
    )
    await win.webContents.insertText('@lead delayed general send')
    await win.webContents.executeJavaScript(
      `document.querySelector('main [aria-label="Send message"]').click()`,
    )
    for (let attempt = 0; attempt < 60 && releaseSends.length < 1; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      releaseSends.length,
      1,
      'send is pending before switching channels',
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Open #project"]').click()`,
    )
    await waitFor(
      win,
      `document.querySelector('main h1')?.textContent === 'project'`,
    )
    releaseSends[0]!()
    for (
      let attempt = 0;
      attempt < 60 &&
      !room.state.messages.some(
        (item) => item.text === '@lead delayed general send',
      );
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 100))
    await win.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    )
    assert.ok(
      room.state.messages.some(
        (item) => item.text === '@lead delayed general send',
      ),
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('main h1')?.textContent`,
      ),
      'project',
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Conversation replies"]') === null`,
      ),
      true,
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Open #general"]').click()`,
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('main textarea').focus()`,
    )
    await win.webContents.insertText('@lead another delayed send')
    await win.webContents.executeJavaScript(
      `document.querySelector('main [aria-label="Send message"]').click()`,
    )
    for (let attempt = 0; attempt < 60 && releaseSends.length < 2; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(releaseSends.length, 2)
    await win.webContents.executeJavaScript(
      `document.querySelector('[aria-label="Open #project"]').click()`,
    )
    await waitFor(
      win,
      `document.querySelector('main h1')?.textContent === 'project'`,
    )
    win.webContents.send('room:open-mention', mentionIds[0])
    await waitFor(
      win,
      `document.querySelector('main h1')?.textContent === 'general'`,
    )
    releaseSends[1]!()
    for (
      let attempt = 0;
      attempt < 60 &&
      !room.state.messages.some(
        (item) => item.text === '@lead another delayed send',
      );
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 100))
    await win.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('main h1')?.textContent`,
      ),
      'general',
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Conversation replies"]')?.textContent.includes('another delayed send')`,
      ),
      true,
    )
    console.log(
      'Mention inbox, channel navigation and delayed-send guard passed.',
    )
  } finally {
    win.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
    app.quit()
  }
})().catch((error) => {
  console.error(error)
  app.exit(1)
})
