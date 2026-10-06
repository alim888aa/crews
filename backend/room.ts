import { attempt, invalidRequest } from './errors.js'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Effect, Schedule } from 'effect'
import type {
  SavedRoom,
  RoomState,
  RoomEvent,
  Receipt,
  ManagedApproval,
  Teammate,
  TeammateInput,
  ManagedSession,
  HireDraft,
} from '../shared/contracts.js'
import { isOpenDelivery, isRelayRejection } from '../shared/contracts.js'
import { isManagedWriterConflict } from '../shared/contracts.js'
import {
  acceptEvent,
  newRoom,
  sendMessage,
  validateTeammate,
  validateChannel,
} from './domain.js'
import { atomicWrite, optionalJSON, object } from './storage.js'
import { Attachments } from './attachments.js'
import { decodeState, decodeEvent, isReplyLimit } from './schema.js'
export const receiptPath = (dir: string, id: string) =>
  path.join(dir, 'receipts', id + '.json')
export function readState(directory: string): SavedRoom {
  const value = optionalJSON(path.join(directory, 'state.json'))
  return value === undefined
    ? newRoom()
    : (structuredClone(decodeState(value)) as SavedRoom)
}
export function receipt(directory: string, id: string): Receipt | undefined {
  const value = optionalJSON(receiptPath(directory, id))
  if (value === undefined) return undefined
  const r = object(value)
  if (
    !['claimed', 'sent', 'attention'].includes(String(r.status)) ||
    typeof r.at !== 'number' ||
    typeof r.detail !== 'string'
  )
    throw invalidRequest('Invalid delivery receipt.')
  if (
    r.failure &&
    ![
      'approval',
      'relay-approval',
      'uncertain',
      'task',
      'storage',
      'writer',
    ].includes(String(r.failure))
  )
    throw invalidRequest('Invalid delivery failure.')
  return r as unknown as Receipt
}
export class Room extends EventEmitter {
  state: SavedRoom
  private pendingApprovals = new Map<
    string,
    {
      approval: ManagedApproval
      answer: (decision: 'accept' | 'decline') => void
    }
  >()
  constructor(readonly directory: string) {
    super()
    for (const f of ['events', 'processed', 'rejected', 'claims', 'receipts'])
      fs.mkdirSync(path.join(directory, f), { recursive: true, mode: 0o700 })
    this.state = readState(directory)
    atomicWrite(path.join(directory, 'state.json'), this.state)
  }
  transaction<A>(change: (state: SavedRoom) => A): A {
    const next = structuredClone(this.state)
    const result = change(next)
    next.revision++
    atomicWrite(path.join(this.directory, 'state.json'), next)
    this.state = next
    return result
  }
  setReplyLimit(value: unknown): void {
    if (!isReplyLimit(value))
      throw invalidRequest('Enter a whole number of replies greater than zero.')
    this.transaction((state) => {
      state.replyLimit = value
    })
  }
  send(payload: {
    text: string
    parentId: string | null
    channelId?: string
    attachmentIds?: string[]
  }) {
    const images = new Attachments(this.directory).resolve(
      payload.attachmentIds ?? [],
    )
    return this.transaction((s) =>
      sendMessage(s, payload.text, payload.parentId, images, payload.channelId),
    )
  }
  createChannel(input: { name: string; memberIds: string[] }) {
    return this.transaction((state) => {
      const channel = validateChannel(state, input)
      state.channels.push(channel)
      return channel
    })
  }
  setChannelMembers(input: { id: string; memberIds: string[] }) {
    this.transaction((state) => {
      const index = state.channels.findIndex(
        (channel) => channel.id === input.id,
      )
      if (index < 0) throw invalidRequest('Unknown channel.')
      const old = state.channels[index]!
      if (old.id === 'general')
        throw invalidRequest(
          'The general channel always includes all teammates.',
        )
      state.channels[index] = validateChannel(state, {
        ...old,
        memberIds: input.memberIds,
      })
      const removed = old.memberIds.filter(
        (id) => !state.channels[index]!.memberIds.includes(id),
      )
      // Removing a member also withdraws any older guest invitation in this channel.
      if (removed.length)
        for (const message of state.messages.filter(
          (item) => item.channelId === old.id && item.invitedGuestIds?.length,
        ))
          message.invitedGuestIds = message.invitedGuestIds!.filter(
            (id) => !removed.includes(id),
          )
    })
  }
  deleteChannel(id: string) {
    if (id === 'general')
      throw invalidRequest('The general channel cannot be deleted.')
    const removed = this.transaction((state) => {
      if (!state.channels.some((c) => c.id === id))
        throw invalidRequest('Unknown channel.')
      if (
        state.hireRequests.some(
          (request) => request.channelId === id && request.status === 'pending',
        )
      )
        throw invalidRequest(
          'Resolve this channel’s pending hires before deleting it.',
        )
      const messages = state.messages.filter((m) => m.channelId === id)
      const messageIds = new Set(messages.map((m) => m.id))
      const deliveries = state.deliveries.filter((d) =>
        messageIds.has(d.rootId),
      )
      // Recheck here, not when the confirmation opens: new work may have arrived.
      if (deliveries.some(isOpenDelivery))
        throw invalidRequest(
          'Finish this channel’s pending replies before deleting it.',
        )
      state.channels = state.channels.filter((c) => c.id !== id)
      state.messages = state.messages.filter((m) => m.channelId !== id)
      state.mentions = state.mentions.filter(
        (mention) => !messageIds.has(mention.messageId),
      )
      state.deliveries = state.deliveries.filter(
        (d) => !messageIds.has(d.rootId),
      )
      return { messages, deliveries }
    })
    // State is committed first, so a failed save never removes files from a live chat.
    // Disk cleanup failure is reported separately; never pretend the committed deletion rolled back.
    try {
      const deliveryIds = new Set(removed.deliveries.map((d) => d.id))
      for (const deliveryId of deliveryIds) {
        fs.rmSync(path.join(this.directory, 'claims', deliveryId), {
          force: true,
        })
        fs.rmSync(receiptPath(this.directory, deliveryId), { force: true })
      }
      for (const folder of ['events', 'processed', 'rejected', 'compactions']) {
        const directory = path.join(this.directory, folder)
        if (!fs.existsSync(directory)) continue
        for (const name of fs
          .readdirSync(directory)
          .filter((n) => n.endsWith('.json'))) {
          const file = path.join(directory, name)
          const value = optionalJSON(file) as
            { deliveryId?: string } | undefined
          if (value?.deliveryId && deliveryIds.has(value.deliveryId)) {
            fs.rmSync(file, { force: true })
            fs.rmSync(file + '.error.json', { force: true })
          }
        }
      }
    } catch (cause) {
      this.emit(
        'deliveryError',
        'Channel deleted, but some local files could not be removed: ' +
          String(cause),
      )
    }
    // The renderer can preserve images used by unsent drafts in other channels.
    // The image handler separately protects images still used by saved messages.
    return [
      ...new Set(
        removed.messages.flatMap((m) => m.attachments?.map((a) => a.id) ?? []),
      ),
    ]
  }
  add(input: TeammateInput) {
    this.transaction((s) => {
      if (s.workers.some((w) => w.id === input.id))
        throw invalidRequest('This task is already in the room.')
      if (!s.recent.some((t) => t.id === input.id))
        throw invalidRequest(
          'Refresh Codex tasks and choose one from the list.',
        )
      s.workers.push(validateTeammate(s, input))
    })
  }
  addManaged(input: TeammateInput, managed: ManagedSession) {
    this.transaction((state) => {
      if (state.workers.some((worker) => worker.id === input.id))
        throw invalidRequest('This teammate is already in the room.')
      state.workers.push({
        ...validateTeammate(state, input),
        managed,
        connection: 'connected',
        connectedAt: Date.now(),
      })
    })
  }
  setManagedModel(
    id: string,
    model: string,
    effort: string,
    serviceTier?: ManagedSession['serviceTier'] | null,
  ) {
    if (!model.trim() || !effort.trim())
      throw invalidRequest('Choose a model and reasoning effort.')
    if (
      serviceTier !== undefined &&
      serviceTier !== null &&
      serviceTier !== 'default' &&
      serviceTier !== 'priority'
    )
      throw invalidRequest('Choose Codex default, Standard, or Fast mode.')
    this.transaction((state) => {
      const worker = state.workers.find((item) => item.id === id)
      if (!worker?.managed || worker.archivedAt)
        throw invalidRequest('Choose an active Crews-created teammate.')
      worker.managed.model = model
      worker.managed.effort = effort
      if (serviceTier === null) delete worker.managed.serviceTier
      else if (serviceTier !== undefined)
        worker.managed.serviceTier = serviceTier
    })
  }
  approveHire(id: string, draft: HireDraft, cwd: string) {
    return this.transaction((state) => {
      const request = state.hireRequests.find((item) => item.id === id)
      if (!request || request.status !== 'pending')
        throw invalidRequest('This hire request is no longer pending.')
      const channel = state.channels.find(
        (item) => item.id === request.channelId,
      )
      if (!channel) throw invalidRequest('The hiring channel no longer exists.')
      const worker = validateTeammate(state, {
        id: randomUUID(),
        title: draft.title,
        handle: draft.handle,
        role: draft.role,
        identity: draft.identity,
      })
      worker.managed = {
        cwd,
        model: draft.model,
        effort: draft.effort,
        ...(draft.serviceTier && { serviceTier: draft.serviceTier }),
        permission: draft.permission,
        threadId: null,
      }
      worker.connection = 'connected'
      worker.connectedAt = Date.now()
      state.workers.push(worker)
      if (channel.id !== 'general') channel.memberIds.push(worker.id)
      request.draft = { ...draft, cwd }
      request.status = 'approved'
      request.resolvedAt = Date.now()
      request.workerId = worker.id
      return worker
    })
  }
  declineHire(id: string) {
    this.transaction((state) => {
      const request = state.hireRequests.find((item) => item.id === id)
      if (!request || request.status !== 'pending')
        throw invalidRequest('This hire request is no longer pending.')
      request.status = 'declined'
      request.resolvedAt = Date.now()
    })
  }
  archiveTeammate(id: string) {
    this.transaction((state) => {
      const worker = state.workers.find((item) => item.id === id)
      if (!worker) throw invalidRequest('Unknown teammate.')
      if (worker.archivedAt)
        throw invalidRequest('This teammate is already archived.')
      if (
        state.deliveries.some(
          (delivery) => delivery.workerId === id && isOpenDelivery(delivery),
        )
      )
        throw invalidRequest(
          'Finish this teammate’s pending replies before firing them.',
        )
      worker.archivedAt = Date.now()
    })
  }
  restoreTeammate(id: string) {
    this.transaction((state) => {
      const worker = state.workers.find((item) => item.id === id)
      if (!worker?.archivedAt)
        throw invalidRequest('This teammate is not archived.')
      delete worker.archivedAt
    })
  }
  setManagedThread(workerId: string, threadId: string) {
    this.transaction((state) => {
      const worker = state.workers.find((item) => item.id === workerId)
      if (!worker?.managed) throw invalidRequest('Unknown managed teammate.')
      if (worker.managed.threadId && worker.managed.threadId !== threadId)
        throw invalidRequest('This teammate already has a Codex session.')
      worker.managed.threadId = threadId
      worker.managed.turnAttempted = false
      state.recent = state.recent.filter((task) => task.id !== threadId)
    })
  }
  markManagedTurnAttempted(workerId: string, threadId: string) {
    this.transaction((state) => {
      const managed = state.workers.find(
        (item) => item.id === workerId,
      )?.managed
      if (!managed || managed.threadId !== threadId)
        throw invalidRequest('Managed Codex session changed before turn start.')
      managed.turnAttempted = true
    })
  }
  markManagedTurnRejected(workerId: string, threadId: string) {
    this.transaction((state) => {
      const managed = state.workers.find(
        (item) => item.id === workerId,
      )?.managed
      if (!managed || managed.threadId !== threadId)
        throw invalidRequest(
          'Managed Codex session changed after turn rejection.',
        )
      managed.turnAttempted = false
    })
  }
  clearEmptyManagedThread(workerId: string, threadId: string) {
    this.transaction((state) => {
      const managed = state.workers.find(
        (item) => item.id === workerId,
      )?.managed
      if (
        !managed ||
        managed.threadId !== threadId ||
        managed.turnAttempted !== false
      )
        throw invalidRequest(
          'Cannot replace a Codex session that may have worked.',
        )
      managed.threadId = null
    })
  }
  managedRetryTarget(deliveryId: string) {
    const delivery = this.state.deliveries.find(
      (item) => item.id === deliveryId,
    )
    const worker = this.state.workers.find(
      (item) => item.id === delivery?.workerId,
    )
    const previous = receipt(this.directory, deliveryId)
    if (
      !delivery ||
      delivery.status !== 'pending' ||
      !worker?.managed ||
      previous?.status !== 'attention' ||
      !['task', 'uncertain', 'writer'].includes(previous.failure ?? '')
    )
      throw invalidRequest('This managed delivery is not ready to retry.')
    return { delivery, worker, previous }
  }
  replaceManagedThread(
    deliveryId: string,
    oldThreadId: string,
    newThreadId: string,
  ) {
    this.transaction((state) => {
      const delivery = state.deliveries.find((item) => item.id === deliveryId)
      const worker = state.workers.find(
        (item) => item.id === delivery?.workerId,
      )
      const previous = receipt(this.directory, deliveryId)
      if (
        !delivery ||
        delivery.status !== 'pending' ||
        !worker?.managed ||
        worker.managed.threadId !== oldThreadId ||
        !isManagedWriterConflict(
          previous?.failure,
          previous?.detail,
          oldThreadId,
        ) ||
        oldThreadId === newThreadId
      )
        throw invalidRequest('This teammate changed during recovery.')
      worker.managed.threadId = newThreadId
      // A fork has saved history, so never treat it as an empty disposable task.
      worker.managed.turnAttempted = true
      state.recent = state.recent.filter((task) => task.id !== newThreadId)
    })
  }
  retryManaged(deliveryId: string) {
    this.managedRetryTarget(deliveryId)
    // The claim is removed for an explicit retry, but later queue folding must
    // still know this delivery was dispatched before.
    this.transaction((state) => {
      state.deliveries.find(
        (item) => item.id === deliveryId,
      )!.previouslyClaimed = true
    })
    fs.rmSync(path.join(this.directory, 'claims', deliveryId), { force: true })
    fs.rmSync(receiptPath(this.directory, deliveryId), { force: true })
    this.transaction(() => {})
  }
  resolveRejectedConversation(rootId: string, workerId: string) {
    this.transaction((state) => {
      const worker = state.workers.find((item) => item.id === workerId)
      if (!worker || worker.managed)
        throw invalidRequest('Choose a connected Desktop teammate.')
      const pending = state.deliveries.filter(
        (item) =>
          item.rootId === rootId &&
          item.workerId === workerId &&
          item.status === 'pending',
      )
      if (!pending.length)
        throw invalidRequest('No pending replies remain in this conversation.')
      const rejected = pending.some((item) => {
        const result = receipt(this.directory, item.id)
        return (
          result?.status === 'attention' &&
          isRelayRejection(result.failure, result.detail)
        )
      })
      if (!rejected)
        throw invalidRequest(
          'Only a relay-rejected conversation can be marked handled.',
        )
      for (const item of pending) {
        const result = receipt(this.directory, item.id)
        const hasClaim = fs.existsSync(
          path.join(this.directory, 'claims', item.id),
        )
        if (
          state.deliveries.some(
            (later) =>
              later.roundId === item.roundId && later.status === 'waiting',
          )
        )
          throw invalidRequest(
            'Later teammates are waiting in this ordered round. Resolve their turns first.',
          )
        // Never cancel a turn that might already be running or have been sent.
        if (
          item.startedAt !== undefined ||
          (hasClaim && result === undefined) ||
          (result !== undefined &&
            !(
              result.status === 'attention' &&
              isRelayRejection(result.failure, result.detail)
            ))
        )
          throw invalidRequest(
            'A reply may already be running. Check its task first.',
          )
      }
      for (const item of pending) {
        item.status = 'resolved'
        item.resolvedAt = Date.now()
      }
    })
  }
  requestManagedApproval(
    workerId: string,
    deliveryId: string,
    method: string,
    rawParams: unknown,
    signal: AbortSignal,
    fileChanges?: Array<{ path: string; kind: string; diff: string }>,
  ): Promise<unknown> {
    if (
      ![
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
        'item/permissions/requestApproval',
        'execCommandApproval',
        'applyPatchApproval',
      ].includes(method)
    )
      throw invalidRequest(`Crews cannot handle Codex request ${method}.`)
    const params = object(rawParams)
    const fileChangeRequest =
      method === 'item/fileChange/requestApproval' ||
      method === 'applyPatchApproval'
    // An approval without the patch would ask the user to approve a blind edit.
    const declineBlindEdit = () =>
      method === 'applyPatchApproval'
        ? {
            decision: {
              denied: {
                rejection: 'No reviewable file changes were provided.',
              },
            },
          }
        : { decision: 'decline' }
    if (
      fileChangeRequest &&
      (!fileChanges?.length ||
        fileChanges.some(
          (change) => !change.path || !change.kind || !change.diff,
        ))
    )
      return Promise.resolve(declineBlindEdit())
    const changeDetails = fileChanges
      ?.map((change) => `${change.kind}: ${change.path}\n${change.diff}`)
      .join('\n\n')
    if (changeDetails && changeDetails.length > 60_000)
      return Promise.resolve(declineBlindEdit())
    const id = randomUUID()
    const approval: ManagedApproval = {
      id,
      workerId,
      deliveryId,
      summary:
        method === 'item/permissions/requestApproval'
          ? 'Additional access requested'
          : method.includes('fileChange') || method === 'applyPatchApproval'
            ? 'File changes requested'
            : 'Command approval requested',
      detail: [
        typeof params.reason === 'string' ? params.reason : '',
        typeof params.command === 'string' ? params.command : '',
        typeof params.cwd === 'string' ? `Folder: ${params.cwd}` : '',
        typeof params.grantRoot === 'string'
          ? `Additional write root: ${params.grantRoot}`
          : '',
        params.permissions ? JSON.stringify(params.permissions) : '',
        changeDetails ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
    return new Promise((resolve) => {
      const answer = (decision: 'accept' | 'decline') => {
        if (!this.pendingApprovals.has(id)) return
        signal.removeEventListener('abort', abort)
        this.pendingApprovals.delete(id)
        this.emit('change', this.snapshot())
        if (method === 'item/permissions/requestApproval')
          resolve({
            permissions: decision === 'accept' ? params.permissions : {},
            scope: 'turn',
          })
        else if (
          method === 'execCommandApproval' ||
          method === 'applyPatchApproval'
        )
          resolve({
            decision:
              decision === 'accept'
                ? 'approved'
                : { denied: { rejection: 'Declined in Crews.' } },
          })
        else resolve({ decision })
      }
      const abort = () => answer('decline')
      this.pendingApprovals.set(id, { approval, answer })
      signal.addEventListener('abort', abort, { once: true })
      this.emit('change', this.snapshot())
      if (signal.aborted) abort()
    })
  }
  answerManagedApproval(id: string, decision: 'accept' | 'decline') {
    if (decision !== 'accept' && decision !== 'decline')
      throw invalidRequest('Choose Allow or Decline.')
    const pending = this.pendingApprovals.get(id)
    if (!pending) throw invalidRequest('This approval request has expired.')
    pending.answer(decision)
  }
  edit(input: TeammateInput) {
    this.transaction((s) => {
      const index = s.workers.findIndex((w) => w.id === input.id)
      if (index < 0) throw invalidRequest('Unknown teammate.')
      if (
        s.workers[index]!.handle !== input.handle &&
        s.deliveries.some(isOpenDelivery)
      )
        throw invalidRequest(
          'Finish pending deliveries before changing an @name. Display names can be edited now.',
        )
      s.workers[index] = validateTeammate(s, input)
    })
  }
  beginApproval(id: string): Teammate {
    return this.transaction((s) => {
      const w = s.workers.find((w) => w.id === id)
      if (!w) throw invalidRequest('Unknown teammate.')
      if (w.archivedAt) throw invalidRequest('Restore this teammate first.')
      // Reopening a waiting approval keeps its token valid for a prompt already copied.
      if (w.connection !== 'awaiting') w.token = randomUUID()
      w.connection = 'awaiting'
      return { ...w }
    })
  }
  receive(event: RoomEvent) {
    const previousMentions = new Set(
      this.state.mentions.map((mention) => mention.messageId),
    )
    this.transaction((s) => {
      const firstTake =
        event.kind === 'started' &&
        s.deliveries.some(
          (delivery) =>
            delivery.id === event.deliveryId &&
            delivery.workerId === event.workerId &&
            delivery.startedAt === undefined,
        )
      acceptEvent(
        s,
        event,
        (delivery) =>
          !delivery.previouslyClaimed &&
          !fs.existsSync(path.join(this.directory, 'claims', delivery.id)) &&
          !receipt(this.directory, delivery.id),
        (delivery) =>
          !delivery.previouslyClaimed &&
          fs.existsSync(path.join(this.directory, 'claims', delivery.id)) &&
          ['claimed', 'sent'].includes(
            receipt(this.directory, delivery.id)?.status ?? '',
          ),
      )
      if (!firstTake || event.kind !== 'started') return
      const active = s.deliveries.find(
        (delivery) => delivery.id === event.deliveryId,
      )!
      if (active.previouslyClaimed) return
      for (const queued of s.deliveries) {
        if (
          queued.id === active.id ||
          queued.workerId !== active.workerId ||
          queued.rootId !== active.rootId ||
          queued.roundId !== active.roundId ||
          queued.status !== 'pending' ||
          queued.startedAt !== undefined ||
          queued.previouslyClaimed ||
          fs.existsSync(path.join(this.directory, 'claims', queued.id))
        )
          continue
        const message = s.messages.find((item) => item.id === queued.messageId)
        const round = s.messages.find((item) => item.id === queued.roundId)
        // Keep human requests and ordered handoffs separate. Only an unclaimed
        // simultaneous peer tag can be covered by this freshly started turn.
        if (
          !message ||
          message.authorId === 'user' ||
          round?.mode !== 'simultaneous'
        )
          continue
        queued.status = 'resolved'
        queued.resolvedAt = Date.now()
        queued.coalescedInto = active.id
        active.coalescedMessageIds ??= []
        active.coalescedMessageIds.push(
          queued.messageId,
          ...(queued.coalescedMessageIds ?? []),
        )
      }
    })
    if (
      event.kind === 'reply' ||
      event.kind === 'progress' ||
      event.kind === 'conversation-start' ||
      event.kind === 'conversation-post'
    ) {
      const added = this.state.mentions.find(
        (mention) => !previousMentions.has(mention.messageId),
      )
      const message = this.state.messages.find(
        (item) => item.id === added?.messageId,
      )
      if (message) this.emit('humanMention', message)
    }
    if (event.kind === 'connect') {
      for (const d of this.state.deliveries.filter(
        (d) => d.workerId === event.workerId && d.status === 'pending',
      )) {
        const old = receipt(this.directory, d.id)
        // Older builds stored relay review rejections as generic approval.
        if (
          old?.failure === 'approval' &&
          !old.detail.startsWith('Codex rejected the dispatch')
        )
          atomicWrite(receiptPath(this.directory, d.id), {
            ...old,
            failure: 'task',
            detail:
              'Connection reapproved. Finish this same pending delivery in the original task; it has not been sent again.',
          })
      }
    }
  }
  readMentions(rootId: string) {
    if (
      !this.state.messages.some(
        (message) => message.id === rootId && message.rootId === rootId,
      )
    )
      throw invalidRequest('Unknown conversation.')
    const unread = this.state.mentions.some((mention) => {
      const message = this.state.messages.find(
        (item) => item.id === mention.messageId,
      )
      return message?.rootId === rootId && mention.readAt === undefined
    })
    if (!unread) return
    this.transaction((state) => {
      for (const mention of state.mentions) {
        const message = state.messages.find(
          (item) => item.id === mention.messageId,
        )
        if (message?.rootId === rootId) mention.readAt ??= Date.now()
      }
    })
  }
  drain() {
    for (const name of fs
      .readdirSync(path.join(this.directory, 'events'))
      .filter((f) => f.endsWith('.json'))) {
      const source = path.join(this.directory, 'events', name)
      try {
        const event = decodeEvent(optionalJSON(source)) as RoomEvent
        this.receive(event)
        fs.renameSync(source, path.join(this.directory, 'processed', name))
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'Invalid room event.'
        // Preserve failed events for inspection; never turn a malformed reply into a success.
        if (fs.existsSync(source))
          fs.renameSync(source, path.join(this.directory, 'rejected', name))
        atomicWrite(
          path.join(this.directory, 'rejected', name + '.error.json'),
          { error: detail },
        )
        this.emit('deliveryError', detail)
      }
    }
  }
  snapshot(): RoomState {
    const presence = object(
      optionalJSON(path.join(this.directory, 'relay-presence.json')) ?? {},
    )
    const seen = typeof presence.at === 'number' ? presence.at : null
    const host = object(
      optionalJSON(path.join(this.directory, 'host.json')) ?? {},
    )
    const start =
      typeof host.startedAt === 'number' ? host.startedAt : Date.now()
    const deliveries = this.state.deliveries.map((d) => {
      const r = isOpenDelivery(d) ? receipt(this.directory, d.id) : undefined
      return {
        ...d,
        relayStatus: r?.status,
        error: r?.status === 'attention' ? r.detail : undefined,
        failure: r?.failure,
      }
    })
    return {
      ...this.state,
      managedApprovals: [...this.pendingApprovals.values()].map(
        ({ approval }) => approval,
      ),
      deliveries,
      workers: this.state.workers.map((w) => {
        const open = deliveries.filter(
          (d) => d.workerId === w.id && isOpenDelivery(d),
        )
        const permission = open.some(
          (d) =>
            d.failure === 'approval' &&
            !d.error?.startsWith('Codex rejected the dispatch'),
        )
        return {
          ...w,
          connection:
            permission && w.connection !== 'awaiting'
              ? 'approval'
              : w.connection,
          pending: open.length,
          lastSeen: w.connectedAt,
          presence: open.some((d) => d.relayStatus === 'attention')
            ? 'attention'
            : open.some((d) => d.startedAt !== undefined)
              ? 'working'
              : open.some(
                    (d) =>
                      d.relayStatus === 'claimed' || d.relayStatus === 'sent',
                  )
                ? 'unconfirmed'
                : open.some((d) => d.status === 'pending')
                  ? 'queued'
                  : open.length
                    ? 'turn'
                    : 'idle',
        }
      }),
      relay: {
        ...this.state.relay,
        status:
          seen && Date.now() - seen < 75_000
            ? String(presence.status)
            : 'offline',
        lastSeen: seen,
        error:
          presence.status === 'attention' && typeof presence.detail === 'string'
            ? presence.detail
            : undefined,
        delayed: Date.now() - Math.max(start, seen ?? 0) > 180_000,
      },
    }
  }
  watch() {
    return Effect.suspend(() => {
      let last = ''
      return attempt('read room updates', () => {
        this.drain()
        const snapshot = this.snapshot(),
          serialized = JSON.stringify(snapshot)
        if (serialized !== last) {
          last = serialized
          this.emit('change', snapshot)
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() =>
            this.emit(
              'deliveryError',
              `Could not read room updates: ${error.message}`,
            ),
          ),
        ),
        Effect.repeat(Schedule.spaced('500 millis')),
      )
    })
  }
}
