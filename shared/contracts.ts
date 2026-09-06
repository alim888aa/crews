export type Connection = 'new' | 'awaiting' | 'connected' | 'approval'
export type FailureKind = 'approval' | 'uncertain' | 'task' | 'storage'
export interface Teammate {
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
  roundId: string
  discussionPaused?: boolean
  mode?: 'ordered' | 'simultaneous'
  deliveryId?: string
}
export interface Delivery {
  id: string
  workerId: string
  messageId: string
  rootId: string
  roundId: string
  status: 'pending' | 'waiting' | 'replied'
  createdAt: number
  startedAt?: number
  replyId?: string
}
export interface RelayConfig {
  taskId: string | null
  automationId: string | null
  token: string
}
export interface SavedRoom {
  version: 2
  revision: number
  paused: boolean
  workers: Teammate[]
  messages: ChatMessage[]
  deliveries: Delivery[]
  relay: RelayConfig
  recent: RecentTask[]
  recentAt: number | null
  refreshRequestedAt: number | null
}
export interface Receipt {
  status: 'claimed' | 'sent' | 'attention'
  at: number
  detail: string
  failure?: FailureKind
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
}
export type RoomEvent =
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
  | { kind: 'catalog'; tasks: RecentTask[] }
export interface Approval {
  text: string
  url: string
}
export interface CrewAPI {
  snapshot(): Promise<RoomState>
  send(payload: {
    text: string
    parentId: string | null
    attachmentIds?: string[]
  }): Promise<ChatMessage>
  importImage(payload: {
    name: string
    bytes: Uint8Array
  }): Promise<ImageAttachment>
  pickImages(): Promise<ImageAttachment[]>
  removeImage(id: string): Promise<void>
  pause(paused: boolean): Promise<void>
  setup(): Promise<Approval>
  add(payload: { id: string; title: string; handle: string }): Promise<void>
  edit(payload: { id: string; title: string; handle: string }): Promise<void>
  approval(id: string): Promise<Approval>
  copyOpen(approval: { id: string }): Promise<void>
  refreshTasks(): Promise<void>
  openTask(id: string): Promise<void>
  openLink(url: string): Promise<void>
  openRelay(): Promise<void>
  onState(callback: (state: RoomState) => void): () => void
  onError(callback: (error: string) => void): () => void
}
