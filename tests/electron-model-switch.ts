/** Disposable UI check for changing a Crews-owned teammate's model. */
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { validateModelChoice } from '../backend/model-catalog.js'
import type { CodexModelOption } from '../shared/contracts.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-model-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  await app.whenReady()
  const room = new Room(directory)
  const workerId = randomUUID()
  const threadId = randomUUID()
  room.addManaged(
    { id: workerId, title: 'Model Switch', handle: 'model-switch' },
    {
      cwd: directory,
      model: 'gpt-6-sol',
      effort: 'high',
      permission: 'full',
      threadId: null,
    },
  )
  room.setManagedThread(workerId, threadId)
  const models: CodexModelOption[] = [
    {
      model: 'gpt-6-sol',
      displayName: 'GPT-6-Sol',
      description: '',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      fastServiceTier: 'priority',
      isDefault: false,
    },
    {
      model: 'gpt-6.1-sol',
      displayName: 'GPT-6.1-Sol',
      description: '',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      fastServiceTier: 'priority',
      isDefault: true,
    },
  ]
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 850,
    webPreferences: {
      preload: path.resolve('build/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  ipcMain.handle('room:snapshot', () => room.snapshot())
  ipcMain.handle('room:models', () => models)
  ipcMain.handle('room:managed-model', (_event, payload) => {
    validateModelChoice(models, payload.model, payload.effort)
    room.setManagedModel(
      payload.id,
      payload.model,
      payload.effort,
      payload.serviceTier,
    )
    win.webContents.send('room:state', room.snapshot())
  })
  const js = (code: string) => win.webContents.executeJavaScript(code)
  async function until(code: string) {
    for (let i = 0; i < 60; i++) {
      if (await js(`Boolean(${code})`)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for ' + code)
  }
  const click = (label: string) =>
    js(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent?.trim() === ${JSON.stringify(label)}
      )
      if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)})
      button.click()
    })()`)
  let failed = false
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await until(
      'document.querySelector(\'[aria-label="View profile for Model Switch"]\')',
    )
    await js(
      'document.querySelector(\'[aria-label="View profile for Model Switch"]\').click()',
    )
    await until(
      "document.body.textContent.includes('gpt-6-sol · high · Codex default')",
    )
    await click('Change settings')
    await until("document.getElementById('teammate-model')")
    assert.equal(
      await js("document.getElementById('teammate-model').value"),
      'gpt-6-sol',
    )
    await js(`(() => {
      const select = document.getElementById('teammate-model')
      select.value = 'gpt-6.1-sol'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await until(
      "document.getElementById('teammate-model').value === 'gpt-6.1-sol'",
    )
    assert.equal(
      await js("document.getElementById('teammate-effort').value"),
      'high',
    )
    await js(`(() => {
      const select = document.getElementById('teammate-speed')
      select.value = 'priority'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await until(
      "document.getElementById('teammate-speed').value === 'priority'",
    )
    await click('Save settings')
    await until(
      "document.body.textContent.includes('gpt-6.1-sol · high · Fast')",
    )
    const saved = new Room(directory).state.workers[0]?.managed
    assert.equal(saved?.model, 'gpt-6.1-sol')
    assert.equal(saved?.effort, 'high')
    assert.equal(saved?.serviceTier, 'priority')
    assert.equal(saved?.threadId, threadId)
    assert.equal(saved?.permission, 'full')
    console.log(
      'PASS: profile switches to Sol 6.1 Fast with high effort and keeps the Codex chat',
    )
  } catch (error) {
    console.error(error)
    failed = true
  } finally {
    win.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
    app.exit(failed ? 1 : 0)
  }
})()
