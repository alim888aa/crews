/** Disposable archive UI test. No real Codex task or live room is touched. */
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-archive-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  await app.whenReady()
  const room = new Room(directory)
  for (const handle of ['one', 'two']) {
    room.addManaged(
      { id: randomUUID(), title: `Worker ${handle}`, handle },
      {
        cwd: directory,
        model: 'gpt-6-sol',
        effort: 'high',
        permission: 'full',
        threadId: null,
      },
    )
  }
  const project = room.createChannel({
    name: 'project',
    memberIds: room.state.workers.map((worker) => worker.id),
  })
  const first = room.send({ text: '@one historical question', parentId: null })
  room.receive({
    kind: 'reply',
    workerId: room.state.workers[0]!.id,
    deliveryId: room.state.deliveries[0]!.id,
    text: 'Historical answer',
    to: [],
  })
  room.send({ text: '@two still pending', parentId: null })

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
  ipcMain.handle('room:snapshot', () => room.snapshot())
  ipcMain.handle('room:archive-teammate', (_event, id) => {
    room.archiveTeammate(id)
    broadcast()
  })
  ipcMain.handle('room:restore-teammate', (_event, id) => {
    room.restoreTeammate(id)
    broadcast()
  })
  ipcMain.handle('room:channel-members', (_event, input) => {
    room.setChannelMembers(input)
    broadcast()
  })
  const js = (source: string) => win.webContents.executeJavaScript(source)
  async function until(source: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await js(`Boolean(${source})`)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for ' + source)
  }
  const click = (label: string) =>
    js(
      `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}).click()`,
    )
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await until(`document.querySelector('[aria-label="Fire @one"]')`)
    await click('Fire @two')
    await until(
      `document.querySelector('[role="dialog"]')?.textContent.includes('pending replies')`,
    )
    assert.equal(
      await js(
        `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === 'Fire teammate')?.disabled`,
      ),
      true,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === 'Keep teammate').click()`,
    )
    await click('Fire @one')
    await until(
      `document.querySelector('[role="dialog"]')?.textContent.includes('Fire @one?')`,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === 'Fire teammate').click()`,
    )
    await until(`!document.querySelector('[aria-label="Fire @one"]')`)
    assert.ok(room.state.workers[0]?.archivedAt)
    assert.equal(
      room.state.messages.find((item) => item.id === first.id)?.text,
      '@one historical question',
    )
    await click('Open #project')
    await click('Manage channel members')
    await until(
      `document.querySelector('[role="dialog"]')?.textContent.includes('Manage #project')`,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === 'Save members').click()`,
    )
    await until(`!document.querySelector('[role="dialog"]')`)
    assert.deepEqual(
      new Set(
        room.state.channels.find((channel) => channel.id === project.id)
          ?.memberIds,
      ),
      new Set(room.state.workers.map((worker) => worker.id)),
    )
    await click('Archived teammates (1)')
    await until(
      `document.querySelector('[role="dialog"]')?.textContent.includes('@one')`,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent.includes('Restore')).click()`,
    )
    await until(`document.querySelector('[aria-label="Fire @one"]')`)
    assert.equal(room.state.workers[0]?.archivedAt, undefined)
    assert.deepEqual(
      new Set(
        room.state.channels.find((channel) => channel.id === project.id)
          ?.memberIds,
      ),
      new Set(room.state.workers.map((worker) => worker.id)),
    )
    console.log(
      'Archive UI: pending guard, fire, channel membership, history, restore passed',
    )
  } finally {
    win.destroy()
    app.quit()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  app.exit(1)
})
