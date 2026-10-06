export const DEFAULT_REPLY_LIMIT = 32
export const MAX_IDENTITY_LENGTH = 8000
export const MAX_ROLE_LENGTH = 160
export const GENERAL_CHANNEL_ID = 'general'
export interface Channel {
  id: string
  name: string
  memberIds: string[]
}

export type Connection = 'new' | 'awaiting' | 'connected' | 'approval'
export type TaskPermissionMode = 'auto' | 'full'
export type ManagedServiceTier = 'default' | 'priority'
export interface ManagedSession {
  cwd: string
  model: string
  effort: string
  serviceTier?: ManagedServiceTier
  permission: TaskPermissionMode
  threadId: string | null
  turnAttempted?: boolean
}
export type FailureKind =
  'approval' | 'relay-approval' | 'uncertain' | 'task' | 'storage' | 'writer'
export const isManagedWriterConflict = (
  failure: FailureKind | undefined,
  detail: string | undefined,
  threadId: string | null | undefined,
) =>
  (failure === 'writer' || failure === 'uncertain') &&
  !!threadId &&
  detail?.includes(`thread ${threadId} already has an active writer`) === true
export const isRelayRejection = (failure?: FailureKind, detail?: string) =>
  failure === 'relay-approval' ||
  (failure === 'approval' &&
    detail?.startsWith('Codex rejected the dispatch') === true)
export interface TeammateInput {
  id: string
  title: string
  handle: string
  identity?: string
  role?: string
}
export interface HireDraft extends Omit<TeammateInput, 'id'> {
  role: string
  identity: string
  cwd: string
  model: string
  effort: string
  serviceTier?: ManagedServiceTier
  permission: TaskPermissionMode
}
export interface HireRequest {
  id: string
  requesterId: string
  channelId: string
  rootId?: string
  draft: HireDraft
  status: 'pending' | 'approved' | 'declined'
  createdAt: number
  resolvedAt?: number
  workerId?: string
}
export interface Teammate {
  managed?: ManagedSession
  archivedAt?: number
  identity?: string
  role?: string
  id: string
  handle: string
  title: string
  initials: string
  connection: Connection
  token: string
  connectedAt: number | null
}
export interface RecentTask {
  id: string
  title: string
  updatedAt: number
  cwd: string
}
export interface CreatedTeammate {
  worker: Worker
}
export interface CodexModelOption {
  model: string
  displayName: string
  description: string
  efforts: string[]
  defaultEffort: string
  fastServiceTier: 'priority' | 'fast' | null
  isDefault: boolean
}
export const MAX_IMAGES = 4
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export interface ImageAttachment {
  id: string
  name: string
  mime: 'image/png'
  size: number
  width: number
  height: number
}
export interface ChatMessage {
  id: string
  rootId: string
  parentId: string | null
  authorId: string
  kind: 'message' | 'reply' | 'progress'
  text: string
  attachments?: ImageAttachment[]
  createdAt: number
  recipientIds: string[]
  invitedGuestIds?: string[]
  roundId: string
  channelId: string
  discussionPaused?: boolean
  mode?: 'ordered' | 'simultaneous'
  deliveryId?: string
}
export interface HumanMention {
  messageId: string
  readAt?: number
}
export interface Delivery {
  id: string
  workerId: string
  messageId: string
  rootId: string
  roundId: string
  status: 'pending' | 'waiting' | 'replied' | 'resolved'
  createdAt: number
  startedAt?: number
  replyId?: string
  resolvedAt?: number
  coalescedInto?: string
  coalescedMessageIds?: string[]
  previouslyClaimed?: boolean
}
export const isOpenDelivery = (delivery: Delivery) =>
  delivery.status === 'pending' || delivery.status === 'waiting'
export interface RelayConfig {
  taskId: string | null
  automationId: string | null
  token: string
}
export interface SavedRoom {
  replyLimit: number
  version: 2
  revision: number
  paused: boolean
  channels: Channel[]
  workers: Teammate[]
  hireRequests: HireRequest[]
  messages: ChatMessage[]
  mentions: HumanMention[]
  deliveries: Delivery[]
  relay: RelayConfig
  recent: RecentTask[]
  catalogVersion?: 1
  recentAt: number | null
  refreshRequestedAt: number | null
}
export interface Receipt {
  status: 'claimed' | 'sent' | 'attention'
  at: number
  detail: string
  failure?: FailureKind
}
export interface ManagedApproval {
  id: string
  workerId: string
  deliveryId: string
  summary: string
  detail: string
}
export interface Worker extends Teammate {
  presence: 'working' | 'unconfirmed' | 'attention' | 'idle' | 'queued' | 'turn'
  pending: number
  lastSeen: number | null
}
export interface RoomState extends Omit<
  SavedRoom,
  'workers' | 'deliveries' | 'relay'
> {
  workers: Worker[]
  deliveries: (Delivery & {
    error?: string
    failure?: FailureKind
    relayStatus?: string
  })[]
  relay: RelayConfig & {
    status: string
    lastSeen: number | null
    delayed: boolean
    error?: string
  }
  managedApprovals?: ManagedApproval[]
}
export type RoomEvent =
  | {
      kind: 'hire'
      id: string
      workerId: string
      token: string
      rootId: string
      draft: HireDraft
    }
  | {
      kind: 'conversation-start'
      id: string
      workerId: string
      token: string
      channelId: string
      text: string
      to: string[]
      mode: 'ordered' | 'simultaneous'
    }
  | {
      kind: 'conversation-post'
      id: string
      workerId: string
      token: string
      channelId: string
      rootId: string
      text: string
      to: string[]
      mode: 'ordered' | 'simultaneous'
    }
  | {
      kind: 'profile'
      workerId: string
      token: string
      role?: string
      identity?: string
    }
  | {
      kind: 'reply' | 'progress'
      workerId: string
      deliveryId: string
      text: string
      to: string[]
    }
  | { kind: 'started'; workerId: string; deliveryId: string }
  | { kind: 'connect'; workerId: string; token: string }
  | { kind: 'relay'; taskId: string; automationId: string; token: string }
  | { kind: 'catalog'; tasks: RecentTask[]; catalogVersion?: 1 }
export interface Approval {
  text: string
  url: string
}
export interface CrewAPI {
  snapshot(): Promise<RoomState>
  send(payload: {
    text: string
    parentId: string | null
    channelId?: string
    attachmentIds?: string[]
  }): Promise<ChatMessage>
  readMentions(rootId: string): Promise<void>
  onOpenMention(callback: (messageId: string) => void): () => void
  createChannel(payload: {
    name: string
    memberIds: string[]
  }): Promise<Channel>
  setChannelMembers(payload: { id: string; memberIds: string[] }): Promise<void>
  deleteChannel(id: string): Promise<string[]>
  importImage(payload: {
    name: string
    bytes: Uint8Array
  }): Promise<ImageAttachment>
  pickImages(): Promise<ImageAttachment[]>
  removeImage(id: string): Promise<void>
  pause(paused: boolean): Promise<void>
  setReplyLimit(value: number): Promise<void>
  setup(): Promise<Approval>
  installContextHooks(): Promise<void>
  add(payload: TeammateInput): Promise<void>
  edit(payload: TeammateInput): Promise<void>
  archiveTeammate(id: string): Promise<void>
  restoreTeammate(id: string): Promise<void>
  pickTaskFolder(): Promise<string | null>
  listModels(): Promise<CodexModelOption[]>
  setManagedModel(payload: {
    id: string
    model: string
    effort: string
    serviceTier?: ManagedServiceTier | null
  }): Promise<void>
  createTask(
    payload: Omit<TeammateInput, 'id'> & {
      cwd: string
      model: string
      effort: string
      serviceTier?: ManagedServiceTier
      permission: TaskPermissionMode
    },
  ): Promise<CreatedTeammate>
  approveHire(payload: {
    id: string
    draft: HireDraft
  }): Promise<CreatedTeammate>
  declineHire(id: string): Promise<void>
  retryManaged(deliveryId: string): Promise<void>
  resolveRejectedConversation(payload: {
    rootId: string
    workerId: string
  }): Promise<void>
  answerManagedApproval(payload: {
    id: string
    decision: 'accept' | 'decline'
  }): Promise<void>
  approval(id: string): Promise<Approval>
  copyOpen(approval: { id: string }): Promise<void>
  refreshTasks(): Promise<void>
  openTask(id: string): Promise<void>
  openLink(url: string): Promise<void>
  openRelay(): Promise<void>
  onState(callback: (state: RoomState) => void): () => void
  onError(callback: (error: string) => void): () => void
}
