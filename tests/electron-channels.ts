/** Isolated channel UI smoke test. Never connects or messages live Codex tasks. */
import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-channels-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
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
  ipcMain.handle('room:snapshot', () => room.snapshot())
  ipcMain.handle('room:create-channel', (_event, payload) => {
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
    await js(`document.querySelector('input[type="checkbox"]').click()`)
    await js(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Create channel').click()`,
    )
    await until(`document.querySelector('main h1')?.textContent === 'project'`)
    const project = room.state.channels.find((c) => c.name === 'project')!
    assert.deepEqual(project.memberIds, [engineer.id])
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
    await click('Open #project')
    await until(`${mainText}.value === ''`)
    await type(mainText, '@engineer delayed send')
    holdSend = true
    await click('Send message')
    while (!releaseSend) await new Promise((resolve) => setTimeout(resolve, 20))
    await click('Open #general')
    await until(`${mainText}.value === '@engineer general draft'`)
    releaseSend()
    await until(
      `!document.querySelector('main.channel').textContent.includes('delayed send')`,
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(room.state.messages.at(-1)!.channelId, project.id)
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
      `document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length === 2`,
    )
    await js(
      `document.querySelectorAll('[role="dialog"] input[type="checkbox"]')[1].click()`,
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
      'PASS channel creation, membership save/retry, guest mentions, @all, separate drafts, delayed send/reply routing and restart',
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
