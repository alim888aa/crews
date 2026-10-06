import { loadTaskCatalog } from '../backend/task-catalog.js'
import { validateManagedChoice } from '../backend/create-task.js'
import {
  loadModelCatalog,
  validateModelChoice,
  validateServiceTierChoice,
} from '../backend/model-catalog.js'
import { installContextHooks } from '../backend/hooks.js'
import {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  shell,
  dialog,
  protocol,
  Notification,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Effect, Scope, Exit } from 'effect'
import { attempt, attemptAsync } from '../backend/errors.js'
import { validateImageIds } from '../backend/attachments.js'
import { registerImageHandlers } from './images.js'
import { Room } from '../backend/room.js'
import { validateTeammate } from '../backend/domain.js'
import { parseTeammateInput } from './teammate-input.js'
import { decodeHireDraft } from '../backend/schema.js'
import { randomUUID } from 'node:crypto'
import { atomicWrite, object, string, uuid } from '../backend/storage.js'
import {
  dataDirectory,
  codexHooksFile,
  supportDirectory,
  runtimeDirectory,
} from '../backend/paths.js'
import { installRuntime } from '../backend/runtime.js'
import { startManagedWorkers } from '../backend/managed-workers.js'
import { retryManagedDelivery } from '../backend/managed-retry.js'
import { messageLink } from '../shared/links.js'
import { setupApproval, connectionApproval } from '../backend/prompts.js'
const build = path.dirname(fileURLToPath(import.meta.url)),
  root = path.dirname(build)
const directory = dataDirectory(),
  runtime = runtimeDirectory()
function optionalServiceTier(
  value: unknown,
): 'default' | 'priority' | undefined {
  if (value === undefined) return undefined
  if (value === 'default' || value === 'priority') return value
  throw new Error('Choose Codex default, Standard, or Fast mode.')
}
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
          ...(v.channelId === undefined
            ? {}
            : { channelId: string(v.channelId, 'channel ID') }),
        })
      })
      handle('room:read-mentions', (value) => room.readMentions(uuid(value)))
      const channelMembers = (value: unknown) => {
        if (!Array.isArray(value)) throw new Error('Invalid channel members.')
        return value.map(uuid)
      }
      handle('room:create-channel', (value) => {
        const v = object(value)
        return room.createChannel({
          name: string(v.name, 'channel name'),
          memberIds: channelMembers(v.memberIds),
        })
      })
      handle('room:channel-members', (value) => {
        const v = object(value)
        return room.setChannelMembers({
          id: string(v.id, 'channel ID'),
          memberIds: channelMembers(v.memberIds),
        })
      })
      handle('room:reply-limit', (value) => room.setReplyLimit(value))
      handle('room:delete-channel', (value) =>
        room.deleteChannel(string(value, 'channel ID')),
      )
      handle('room:pause', (value) => {
        if (typeof value !== 'boolean') throw new Error('Invalid pause state.')
        room.transaction((s) => {
          s.paused = value
        })
      })
      handle('room:add', (value) => room.add(parseTeammateInput(value)))
      handle('room:edit', (value) => room.edit(parseTeammateInput(value)))
      handle('room:archive-teammate', (value) =>
        room.archiveTeammate(uuid(value)),
      )
      handle('room:restore-teammate', (value) =>
        room.restoreTeammate(uuid(value)),
      )
      handle('room:models', () => loadModelCatalog())
      handle('room:managed-model', async (value) => {
        const payload = object(value)
        const id = uuid(payload.id)
        const worker = room.state.workers.find((item) => item.id === id)
        if (!worker?.managed || worker.archivedAt)
          throw new Error('Choose an active Crews-created teammate.')
        const model = string(payload.model, 'model')
        const effort = string(payload.effort, 'effort')
        const serviceTier =
          payload.serviceTier === null
            ? null
            : optionalServiceTier(payload.serviceTier)
        const models = await loadModelCatalog()
        validateModelChoice(models, model, effort)
        validateServiceTierChoice(models, model, serviceTier)
        room.setManagedModel(id, model, effort, serviceTier)
      })
      handle('room:pick-folder', async () => {
        const result = await dialog.showOpenDialog(window!, {
          title: 'Choose a folder for the new Codex task',
          defaultPath: app.getPath('home'),
          properties: ['openDirectory'],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      })
      let creatingTask = false
      handle('room:create-task', async (value) => {
        if (creatingTask)
          throw new Error('Wait for the current task creation to finish.')
        creatingTask = true
        try {
          const v = object(value)
          const serviceTier = optionalServiceTier(v.serviceTier)
          const draft = parseTeammateInput({ ...v, id: randomUUID() })
          validateTeammate(room.state, draft)
          const cwd = await validateManagedChoice({
            cwd: string(v.cwd, 'folder'),
            model: string(v.model, 'model'),
            effort: string(v.effort, 'effort'),
            serviceTier,
            permission: string(v.permission, 'permission') as 'auto' | 'full',
          })
          room.addManaged(draft, {
            cwd,
            model: string(v.model, 'model'),
            effort: string(v.effort, 'effort'),
            ...(serviceTier && { serviceTier }),
            permission: string(v.permission, 'permission') as 'auto' | 'full',
            threadId: null,
          })
          const worker = room.snapshot().workers.find((w) => w.id === draft.id)
          if (!worker)
            throw new Error('Teammate was saved but could not be read back.')
          return { worker }
        } finally {
          creatingTask = false
        }
      })
      handle('room:approve-hire', async (value) => {
        if (creatingTask)
          throw new Error('Wait for the current teammate creation to finish.')
        creatingTask = true
        try {
          const payload = object(value)
          const id = uuid(payload.id)
          if (
            !room.state.hireRequests.some(
              (request) => request.id === id && request.status === 'pending',
            )
          )
            throw new Error('This hire request is no longer pending.')
          const draft = decodeHireDraft(payload.draft)
          const cwd = await validateManagedChoice(draft)
          const created = room.approveHire(id, draft, cwd)
          const worker = room
            .snapshot()
            .workers.find((item) => item.id === created.id)
          if (!worker)
            throw new Error('Teammate was saved but could not be read back.')
          return { worker }
        } finally {
          creatingTask = false
        }
      })
      handle('room:decline-hire', (value) => room.declineHire(uuid(value)))
      handle('room:retry-managed', (value) =>
        retryManagedDelivery(room, uuid(value)),
      )
      handle('room:resolve-rejected', (value) => {
        const payload = object(value)
        room.resolveRejectedConversation(
          uuid(payload.rootId),
          uuid(payload.workerId),
        )
      })
      handle('room:managed-approval', (value) => {
        const payload = object(value)
        room.answerManagedApproval(
          uuid(payload.id),
          string(payload.decision, 'decision') as 'accept' | 'decline',
        )
      })
      // Share concurrent picker refreshes and publish only a complete catalog.
      let catalogRefresh: Promise<void> | null = null
      handle('room:refresh', () => {
        if (catalogRefresh) return catalogRefresh
        room.transaction((s) => {
          s.refreshRequestedAt = Date.now()
        })
        catalogRefresh = loadTaskCatalog()
          .then((tasks) => {
            room.receive({ kind: 'catalog', tasks, catalogVersion: 1 })
          })
          .finally(() => {
            room.transaction((s) => {
              s.refreshRequestedAt = null
            })
            catalogRefresh = null
          })
        return catalogRefresh
      })
      handle('room:approval', (value) => {
        if (teammate(value).managed)
          throw new Error('This teammate connects inside Crews.')
        return connectionApproval(
          room.state,
          room.beginApproval(teammate(value).id),
          directory,
          runtime,
          executable,
        )
      })
      handle('room:copy-open', (value) => {
        const w = teammate(object(value).id)
        if (w.managed) throw new Error('This teammate works inside Crews.')
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
      handle('room:open-task', (value) => {
        const worker = teammate(value)
        if (worker.managed) throw new Error('This teammate works inside Crews.')
        return shell.openExternal('codex://threads/' + worker.id)
      })
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
      // The room emits this only after accepting and saving a new agent mention.
      const notifications = new Map<string, Notification>()
      room.on('humanMention', (message) => {
        if (!Notification.isSupported()) return
        const worker = room.state.workers.find(
          (item) => item.id === message.authorId,
        )
        if (!worker) return
        const notification = new Notification({
          id: message.id,
          groupId: message.rootId,
          title: `@${worker.handle} mentioned you`,
          body: message.text.replace(/\s+/g, ' ').slice(0, 180),
        })
        notifications.set(message.id, notification)
        notification.on('show', () => {
          if (process.env.CREWS_NOTIFICATION_TEST === '1')
            console.info('Crews mention notification shown', message.id)
        })
        notification.on('click', () => {
          if (!window || window.isDestroyed()) return
          if (window.isMinimized()) window.restore()
          window.show()
          window.focus()
          window.webContents.send('room:state', room.snapshot())
          window.webContents.send('room:open-mention', message.id)
        })
        notification.on('close', () => notifications.delete(message.id))
        notification.on('failed', (_event, error) => {
          console.warn('Crews mention notification failed:', error)
          notifications.delete(message.id)
        })
        notification.show()
      })
      room.on('deliveryError', (error) => {
        if (window && !window.isDestroyed())
          window.webContents.send('room:error', error)
      })
      const stopManagedWorkers = startManagedWorkers(room, runtime, executable)
      const scope = Effect.runSync(Scope.make())
      Effect.runSync(
        Scope.addFinalizer(
          scope,
          attempt('mark room closed', () => {
            stopManagedWorkers()
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
