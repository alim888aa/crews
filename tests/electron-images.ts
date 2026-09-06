/** Run after npm run build with npm run test:images. Uses an isolated room. */
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Room } from '../backend/room.js'
import { Attachments } from '../backend/attachments.js'
import { importImage, registerImageHandlers } from '../electron/images.js'

void (async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-image-ui-'))
  app.setPath('userData', path.join(directory, 'browser'))
  protocol.registerSchemesAsPrivileged([
    { scheme: 'crew-image', privileges: { standard: true, secure: true } },
  ])
  await app.whenReady()
  const room = new Room(directory)
  room.receive({
    kind: 'relay',
    taskId: randomUUID(),
    automationId: 'isolated-test',
    token: room.state.relay.token,
  })
  const id = randomUUID()
  room.receive({
    kind: 'catalog',
    tasks: [{ id, title: 'Test agent', cwd: directory, updatedAt: Date.now() }],
  })
  room.add({ id, title: 'Test agent', handle: 'test-agent' })
  const root = room.send({
    text: '@test-agent Screenshot test',
    parentId: null,
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
  win.webContents.on('console-message', (_e, _level, message) =>
    console.log('renderer', message),
  )
  let rejectSend = false
  ipcMain.handle('room:snapshot', () => room.snapshot())
  ipcMain.handle('room:send', (_event, payload) => {
    if (rejectSend) throw new Error('Test send failure')
    const message = room.send(payload)
    win.webContents.send('room:state', room.snapshot())
    return message
  })
  registerImageHandlers(room, win, (channel, fn) =>
    ipcMain.handle(channel, (_event, value) => fn(value)),
  )
  const js = (code: string) => win.webContents.executeJavaScript(code)
  const wait = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (code: string) => {
    for (let n = 0; n < 50; n++) {
      if (await js(`Boolean(${code})`)) return
      await wait(100)
    }
    throw new Error('Timed out: ' + code)
  }
  const click = (label: string) =>
    js(
      `document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`,
    )
  let failed = false
  try {
    await win.loadFile(path.resolve('dist/index.html'))
    win.show()
    win.focus()
    await until(
      `Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Open conversation')`,
    )
    await js(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Open conversation').click()`,
    )
    await wait(350)
    const textarea = `document.getElementById('compose-${root.id}')`
    const form = `${textarea}.closest('form')`
    const previews = `${form}.querySelectorAll('img')`
    // Real native image decoder, file storage, IPC, protocol and renderer.
    const bitmap = Buffer.alloc(120 * 80 * 4, 200)
    const image = nativeImage.createFromBitmap(bitmap, {
      width: 120,
      height: 80,
      scaleFactor: 1,
    })
    assert.throws(() =>
      importImage(new Attachments(directory), {
        name: 'fake.png',
        bytes: Buffer.from('not an image'),
      }),
    )
    assert.throws(() =>
      importImage(new Attachments(directory), {
        name: 'broken.png',
        bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    )
    await clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([new Uint8Array(image.toPNG())], {
          type: 'image/png',
        }),
      }),
    ])
    await js(`${textarea}.focus()`)
    win.webContents.paste()
    await until(
      `${previews}.length === 1 && ${previews}[0].naturalWidth === 120`,
    )
    console.log('PASS native screenshot paste, decoding, IPC and image preview')
    win.webContents.reload()
    await until(
      `Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Open conversation')`,
    )
    await js(
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Open conversation').click()`,
    )
    await until(
      `${previews}.length === 1 && ${previews}[0].naturalWidth === 120`,
    )
    console.log('PASS pasted image draft survives renderer restart')
    const imageId = JSON.parse(
      await js(`localStorage.getItem('crews-image-drafts-v1')`),
    )[root.id][0].id
    await js(`${form}.querySelector('[aria-label^="View "]').click()`)
    await until(
      `document.querySelector('[role="dialog"] img')?.naturalWidth === 120`,
    )
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await wait()
    await js(`${form}.querySelector('[aria-label^="Remove "]').click()`)
    await until(`${previews}.length === 0`)
    assert.equal(
      fs.existsSync(path.join(directory, 'attachments', imageId + '.png')),
      false,
    )
    console.log('PASS enlarged preview and removal delete only an unsent image')
    const file = path.join(directory, 'selected.png')
    fs.writeFileSync(file, image.toPNG())
    // Picker selection is controlled; import handler is the production implementation.
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    await js(`${form}.querySelector('[aria-label="Attach images"]').click()`)
    await wait()
    assert.equal(await js(`${previews}.length`), 0)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    await js(`${form}.querySelector('[aria-label="Attach images"]').click()`)
    await until(
      `${previews}.length === 1 && ${previews}[0].naturalWidth === 120`,
    )
    rejectSend = true
    await click('Send reply')
    await wait()
    assert.equal(await js(`${previews}.length`), 1)
    assert.ok(
      await js(`document.body.textContent.includes('Test send failure')`),
    )
    rejectSend = false
    await click('Send reply')
    await until(`${previews}.length === 0`)
    assert.equal(room.state.messages.at(-1)?.text, '')
    const sent = room.state.messages.at(-1)!.attachments![0]!
    await js(`window.crew.removeImage(${JSON.stringify(sent.id)})`)
    assert.ok(fs.existsSync(new Attachments(directory).file(sent.id)))
    assert.ok(new Room(directory).state.messages.at(-1)?.attachments?.length)
    console.log(
      'PASS picker cancel/select, failed-send draft retention, image-only send and sent-image retention',
    )
    await clipboard.writeText('ordinary pasted text')
    await js(`${textarea}.focus()`)
    win.webContents.paste()
    await until(`${textarea}.value === 'ordinary pasted text'`)
    assert.equal(await js(`${previews}.length`), 0)
    console.log('PASS ordinary text paste stays text')
    const diagnostic = await js(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480;
      const c = canvas.getContext('2d'); c.fillStyle = '#f7f4ef'; c.fillRect(0,0,800,480);
      c.fillStyle = '#427454'; c.beginPath(); c.arc(165,210,80,0,Math.PI*2); c.fill();
      c.fillStyle = '#20251f'; c.font = '44px Helvetica'; c.fillText('Screenshot check',285,160); c.fillText('CEDAR 742',285,240);
      return canvas.toDataURL('image/png').split(',')[1];
    })()`)
    fs.writeFileSync(
      '/tmp/crew-visual-check.png',
      Buffer.from(diagnostic, 'base64'),
    )
    await win
      .capturePage()
      .then((screenshot) =>
        fs.writeFileSync('/tmp/crew-images-verified.png', screenshot.toPNG()),
      )
  } catch (error) {
    failed = true
    console.error(error)
  }
  win.destroy()
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(failed ? 1 : 0)
})()
