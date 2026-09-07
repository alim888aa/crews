import { installContextHooks } from '../backend/hooks.js'
import {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  shell,
  dialog,
  protocol,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Effect, Scope, Exit } from 'effect'
import { attempt, attemptAsync } from '../backend/errors.js'
import { validateImageIds } from '../backend/attachments.js'
import { registerImageHandlers } from './images.js'
import { Room } from '../backend/room.js'
import { atomicWrite, object, string, uuid } from '../backend/storage.js'
import {
  dataDirectory,
  codexHooksFile,
  supportDirectory,
  runtimeDirectory,
} from '../backend/paths.js'
import { installRuntime } from '../backend/runtime.js'
import { messageLink } from '../shared/links.js'
import { setupApproval, connectionApproval } from '../backend/prompts.js'
const build = path.dirname(fileURLToPath(import.meta.url)),
  root = path.dirname(build)
const directory = dataDirectory(),
  runtime = runtimeDirectory()
const executable = ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', process.execPath]
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
app.setPath(
  'userData',
  path.join(
    process.env.CREWS_DATA ? directory : supportDirectory(),
    'electron-v3',
  ),
)
app.setName('Crews')
protocol.registerSchemesAsPrivileged([
  { scheme: 'crew-image', privileges: { standard: true, secure: true } },
])
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let window: BrowserWindow | undefined
  app
    .whenReady()
    .then(async () => {
      installRuntime(build, runtime, directory, executable)
      const room = new Room(directory)
      atomicWrite(path.join(directory, 'host.json'), {
        running: true,
        pid: process.pid,
        startedAt: Date.now(),
      })
      window = new BrowserWindow({
        title: 'Crews',
        width: 1300,
        height: 860,
        minWidth: 760,
        minHeight: 600,
        show: false,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#ffffff',
        webPreferences: {
          preload: path.join(build, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          backgroundThrottling: false,
        },
      })
      const entry = path.join(root, 'dist', 'index.html'),
        entryUrl = pathToFileURL(entry).href
      window.once('ready-to-show', () => window?.show())
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== entryUrl) event.preventDefault()
      })
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      )
      window.webContents.session.setPermissionCheckHandler(() => false)
      const handle = (channel: string, fn: (payload: unknown) => unknown) =>
        ipcMain.handle(channel, (event, payload: unknown) => {
          if (
            !window ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame.url !== entryUrl
          )
            throw new Error('Unknown request source.')
          return Effect.runPromise(
            attemptAsync(channel, () => fn(payload)),
          ).catch((error) => {
            throw new Error(
              error instanceof Error ? error.message : String(error),
            )
          })
        })
      registerImageHandlers(room, window, handle)
      const teammate = (value: unknown) => {
        const id = uuid(value),
          w = room.state.workers.find((w) => w.id === id)
        if (!w) throw new Error('Unknown teammate.')
        return w
      }
      const input = (value: unknown) => {
        const v = object(value)
        return {
          id: uuid(v.id),
          title: string(v.title, 'name').trim(),
          handle: string(v.handle, '@name').trim().toLowerCase(),
          ...(v.identity === undefined
            ? {}
            : {
                identity:
                  typeof v.identity === 'string'
                    ? v.identity
                    : string(v.identity, 'identity'),
              }),
        }
      }
      handle('room:context-hooks', () => {
        installContextHooks(codexHooksFile(), runtime, executable)
      })
      handle('room:snapshot', () => room.snapshot())
      handle('room:send', (value) => {
        const v = object(value)
        return room.send({
          text: typeof v.text === 'string' ? v.text : string(v.text),
          attachmentIds:
            v.attachmentIds === undefined
              ? []
              : validateImageIds(v.attachmentIds),
          parentId: v.parentId === null ? null : uuid(v.parentId),
        })
      })
      handle('room:reply-limit', (value) => room.setReplyLimit(value))
      handle('room:pause', (value) => {
        if (typeof value !== 'boolean') throw new Error('Invalid pause state.')
        room.transaction((s) => {
          s.paused = value
        })
      })
      handle('room:add', (value) => room.add(input(value)))
      handle('room:edit', (value) => room.edit(input(value)))
      handle('room:refresh', () =>
        room.transaction((s) => {
          s.refreshRequestedAt = Date.now()
        }),
      )
      handle('room:approval', (value) =>
        connectionApproval(
          room.state,
          room.beginApproval(teammate(value).id),
          directory,
          runtime,
          executable,
        ),
      )
      handle('room:copy-open', (value) => {
        const w = teammate(object(value).id)
        const approval = connectionApproval(
          room.state,
          room.beginApproval(w.id),
          directory,
          runtime,
          executable,
        )
        clipboard.writeText(approval.text)
        return shell.openExternal(approval.url)
      })
      handle('room:setup', () => {
        const approval = setupApproval(room.state, directory, runtime)
        if (room.state.relay.taskId) clipboard.writeText(approval.text)
        return shell.openExternal(approval.url).then(() => approval)
      })
      handle('room:open-task', (value) =>
        shell.openExternal('codex://threads/' + teammate(value).id),
      )
      handle('room:open-link', (value) => {
        const url = messageLink(value)
        if (!url) throw new Error('This link cannot be opened from a message.')
        return shell.openExternal(url)
      })
      handle('room:open-relay', () => {
        if (!room.state.relay.taskId) throw new Error('Connect Codex first.')
        return shell.openExternal('codex://threads/' + room.state.relay.taskId)
      })
      room.on('change', (snapshot) => {
        if (window && !window.isDestroyed())
          window.webContents.send('room:state', snapshot)
      })
      room.on('deliveryError', (error) => {
        if (window && !window.isDestroyed())
          window.webContents.send('room:error', error)
      })
      const scope = Effect.runSync(Scope.make())
      Effect.runSync(
        Scope.addFinalizer(
          scope,
          attempt('mark room closed', () => {
            atomicWrite(path.join(directory, 'host.json'), {
              running: false,
              pid: process.pid,
            })
          }).pipe(Effect.orDie),
        ),
      )
      Effect.runSync(room.watch().pipe(Effect.forkScoped, Scope.extend(scope)))
      let closing = false,
        closed = false
      app.on('before-quit', (event) => {
        if (closed) return
        event.preventDefault()
        if (closing) return
        closing = true
        void Effect.runPromise(Scope.close(scope, Exit.void))
          .catch((error) => {
            console.error('Crews shutdown failed', error)
          })
          .finally(() => {
            closed = true
            app.quit()
          })
      })
      app.on('second-instance', () => {
        if (window?.isMinimized()) window.restore()
        window?.show()
        window?.focus()
      })
      app.on('window-all-closed', () => app.quit())
      await window.loadFile(entry)
    })
    .catch((error) => {
      dialog.showErrorBox('Crews could not start', String(error))
      app.quit()
    })
}
