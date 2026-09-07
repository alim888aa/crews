/** Isolated UI check; run after building. Never connects or messages live tasks. */
import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { installContextHooks } from '../backend/hooks.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crews-identity-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  await app.whenReady()
  let room = new Room(directory)
  const worker = randomUUID()
  room.receive({
    kind: 'catalog',
    tasks: [{ id: worker, title: 'Intern', updatedAt: 1, cwd: directory }],
  })
  room.add({ id: worker, title: 'Intern', handle: 'intern' })
  room.receive({
    kind: 'connect',
    workerId: worker,
    token: room.state.workers[0]!.token,
  })
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
  ipcMain.handle('room:edit', (_event, value) => {
    room.edit(value)
    win.webContents.send('room:state', room.snapshot())
  })
  const hookFile = path.join(directory, 'hooks.json')
  ipcMain.handle('room:context-hooks', () => {
    installContextHooks(hookFile, path.join(directory, 'runtime'), [
      process.execPath,
    ])
  })
  const js = (code: string) => win.webContents.executeJavaScript(code)
  async function until(code: string) {
    for (let i = 0; i < 50; i++) {
      if (await js(`Boolean(${code})`)) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('Timed out: ' + code)
  }
  const openEditor = async () => {
    await until(`document.querySelector('[aria-label="Manage Intern"]')`)
    await js(`document.querySelector('[aria-label="Manage Intern"]').click()`)
    await until(`document.getElementById('teammate-identity')`)
  }
  const click = (text: string) =>
    js(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`,
    )
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    await openEditor()
    await js("document.getElementById('teammate-identity').focus()")
    await win.webContents.insertText(
      'You are our intern. Reproduce bugs before suggesting fixes.',
    )
    await click('Install context hooks')
    await until("document.body.textContent.includes('Installed. Review both')")
    const hooks = JSON.parse(fs.readFileSync(hookFile, 'utf8')).hooks
    assert.equal(hooks.SessionStart.length, 1)
    assert.equal(hooks.UserPromptSubmit.length, 1)
    assert.doesNotMatch(JSON.stringify(hooks), /trustedHash|bypass/)
    await click('Save changes')
    await until("!document.getElementById('teammate-identity')")
    assert.match(room.state.workers[0]!.identity!, /Reproduce bugs/)
    room = new Room(directory)
    await win.loadFile(path.resolve('dist/index.html'))
    await openEditor()
    assert.match(
      await js("document.getElementById('teammate-identity').value"),
      /Reproduce bugs/,
    )
    win.show()
    await js("Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))")
    await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    fs.writeFileSync(
      '/tmp/crews-identity-ui.png',
      (await win.webContents.capturePage()).toPNG(),
    )
    await js(
      "document.getElementById('teammate-identity').focus();document.getElementById('teammate-identity').select()",
    )
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
    await until("document.getElementById('teammate-identity').value === ''")
    await click('Save changes')
    await until("!document.getElementById('teammate-identity')")
    assert.equal(new Room(directory).state.workers[0]!.identity, '')
    console.log(
      'PASS: identity editor, persistence, clearing and hook install without granting trust',
    )
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    win.destroy()
    fs.rmSync(directory, { recursive: true, force: true })
    app.exit(Number(process.exitCode) || 0)
  }
})()
