/** Disposable hiring and new-chat UI test. No live room or Codex task is touched. */
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import type { HireDraft } from '../shared/contracts.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-hiring-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  await app.whenReady()
  const room = new Room(directory)
  const leadId = randomUUID()
  room.addManaged(
    { id: leadId, title: 'Team Lead', handle: 'lead' },
    {
      cwd: directory,
      model: 'gpt-6-sol',
      effort: 'high',
      permission: 'full',
      threadId: null,
    },
  )
  const draft: HireDraft = {
    title: 'Proposed QA',
    handle: 'proposed-qa',
    role: 'Checks the work',
    identity: 'Review the actual change.',
    cwd: directory,
    model: 'gpt-6-sol',
    effort: 'low',
    serviceTier: 'priority',
    permission: 'auto',
  }
  const channel = room.createChannel({
    name: 'project',
    memberIds: [leadId],
  })
  const root = room.send({
    text: '@lead Recruit a QA teammate',
    parentId: null,
    channelId: channel.id,
  })
  const hire = (name: string, handle = draft.handle) => {
    const id = randomUUID()
    room.receive({
      kind: 'hire',
      id,
      workerId: leadId,
      token: room.state.workers[0]!.token,
      rootId: root.id,
      draft: { ...draft, title: name, handle },
    })
    return id
  }
  const first = hire('Proposed QA')
  const second = hire('Decline Me')
  const third = hire('Direct Hire', 'direct-hire')
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
  ipcMain.handle('room:models', () => [
    {
      model: 'gpt-6-sol',
      displayName: 'GPT-6 Sol',
      description: '',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      fastServiceTier: 'priority',
      isDefault: true,
    },
  ])
  ipcMain.handle('room:approve-hire', (_event, payload) => {
    const worker = room.approveHire(payload.id, payload.draft, directory)
    broadcast()
    return {
      worker: room.snapshot().workers.find((item) => item.id === worker.id),
    }
  })
  ipcMain.handle('room:decline-hire', (_event, id) => {
    room.declineHire(id)
    broadcast()
  })
  ipcMain.handle('room:send', (_event, payload) => {
    const message = room.send(payload)
    broadcast()
    return message
  })
  const js = (source: string) => win.webContents.executeJavaScript(source)
  async function until(source: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await js(`Boolean(${source})`)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for ' + source)
  }
  async function replace(selector: string, value: string) {
    await js(
      `document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).select()`,
    )
    await win.webContents.insertText(value)
  }
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await until(
      `document.querySelector('[role="alert"]')?.textContent.includes('New hire requested')`,
    )
    if (process.env.CREWS_CAPTURE) {
      win.showInactive()
      await new Promise((resolve) => setTimeout(resolve, 200))
      fs.writeFileSync(
        process.env.CREWS_CAPTURE,
        (await win.webContents.capturePage()).toPNG(),
      )
    }
    assert.equal(room.state.workers.length, 1)
    assert.equal(room.state.hireRequests[0]?.channelId, channel.id)
    assert.equal(
      await js(
        `document.querySelector('[role="alert"]')?.textContent.includes('Proposed QA')`,
      ),
      true,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="alert"] button')).find((button) => button.textContent === 'Review & edit').click()`,
    )
    await until(`document.querySelector('#new-teammate-name')`)
    await replace('#new-teammate-name', 'Release QA')
    await replace('#new-teammate-handle', 'release-qa')
    await replace('#new-teammate-identity', 'Test the shipped build.')
    await js(
      `document.querySelector('#new-teammate-effort').value = 'high'; document.querySelector('#new-teammate-effort').dispatchEvent(new Event('change', { bubbles: true }))`,
    )
    await js(
      `document.querySelector('#new-teammate-permission').value = 'full'; document.querySelector('#new-teammate-permission').dispatchEvent(new Event('change', { bubbles: true }))`,
    )
    await js(
      `Array.from(document.querySelectorAll('[role="alert"] button')).find((button) => button.textContent === 'Approve & hire').click()`,
    )
    await until(
      `document.querySelector('[role="alert"]')?.textContent.includes('Decline Me')`,
    )
    const approved = room.state.workers.find(
      (worker) => worker.handle === 'release-qa',
    )!
    assert.ok(approved)
    assert.equal(approved.title, 'Release QA')
    assert.equal(approved.identity, 'Test the shipped build.')
    assert.equal(approved.managed?.effort, 'high')
    assert.equal(approved.managed?.serviceTier, 'priority')
    assert.equal(approved.managed?.permission, 'full')
    assert.equal(approved.managed?.threadId, null)
    assert.ok(
      room.state.channels
        .find((item) => item.id === channel.id)
        ?.memberIds.includes(approved.id),
    )
    assert.equal(
      room.state.hireRequests.find((request) => request.id === first)?.status,
      'approved',
    )
    await js(
      `Array.from(document.querySelectorAll('[role="alert"] button')).find((button) => button.textContent === 'Decline').click()`,
    )
    await until(
      `document.querySelector('[role="alert"]')?.textContent.includes('Direct Hire')`,
    )
    assert.equal(
      room.state.hireRequests.find((request) => request.id === second)?.status,
      'declined',
    )
    await js(
      `Array.from(document.querySelectorAll('[role="alert"] button')).find((button) => button.textContent === 'Approve & hire').click()`,
    )
    await until(`!document.querySelector('[role="alert"]')`)
    assert.equal(
      room.state.hireRequests.find((request) => request.id === third)?.status,
      'approved',
    )
    assert.ok(
      room.state.workers.some((worker) => worker.handle === 'direct-hire'),
    )
    const agentRootId = randomUUID()
    room.receive({
      kind: 'conversation-start',
      id: agentRootId,
      workerId: leadId,
      token: room.state.workers.find((worker) => worker.id === leadId)!.token,
      channelId: channel.id,
      text: 'Agent-created QA chat',
      to: [],
      mode: 'ordered',
    })
    room.receive({
      kind: 'conversation-post',
      id: randomUUID(),
      workerId: leadId,
      token: room.state.workers.find((worker) => worker.id === leadId)!.token,
      channelId: channel.id,
      rootId: agentRootId,
      text: 'Please join this QA chat',
      to: [approved.handle],
      mode: 'ordered',
    })
    broadcast()
    await js(`document.querySelector('[aria-label="Open #project"]').click()`)
    await until(`document.querySelector('main h1')?.textContent === 'project'`)
    await until(
      `document.querySelector('main')?.textContent.includes('Agent-created QA chat')`,
    )
    assert.ok(
      room.state.deliveries.some(
        (delivery) =>
          delivery.rootId === agentRootId && delivery.workerId === approved.id,
      ),
    )
    await js(`document.querySelector('main textarea').focus()`)
    await win.webContents.insertText('@release-qa Welcome to the team')
    await js(
      `document.querySelector('main [aria-label="Send message"]').click()`,
    )
    await until(
      `document.querySelector('main')?.textContent.includes('Welcome to the team')`,
    )
    assert.equal(room.state.messages.at(-1)?.recipientIds[0], approved.id)
    assert.equal(room.state.messages.at(-1)?.channelId, channel.id)
    console.log(
      'Hiring UI: request, edit, direct approve, decline, agent conversation, new chat passed',
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
