import { Schema } from 'effect'
import {
  DEFAULT_REPLY_LIMIT,
  GENERAL_CHANNEL_ID,
  MAX_IDENTITY_LENGTH,
  MAX_ROLE_LENGTH,
} from '../shared/contracts.js'
export const ReplyLimitSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
export const isReplyLimit = Schema.is(ReplyLimitSchema)
const ID = Schema.String.pipe(
  Schema.pattern(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  ),
)
const Text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120000))
export const ImageSchema = Schema.Struct({
  id: ID,
  name: Schema.String.pipe(Schema.maxLength(200)),
  mime: Schema.Literal('image/png'),
  size: Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.lessThanOrEqualTo(10 * 1024 * 1024),
  ),
  width: Schema.Number.pipe(Schema.int(), Schema.positive()),
  height: Schema.Number.pipe(Schema.int(), Schema.positive()),
})
export const decodeImage = Schema.decodeUnknownSync(ImageSchema)
const Mode = Schema.Literal('ordered', 'simultaneous')
const ChannelId = Schema.Union(ID, Schema.Literal(GENERAL_CHANNEL_ID))
const Channel = Schema.Struct({
  id: ChannelId,
  name: Schema.String.pipe(Schema.pattern(/^[a-z0-9-]{1,40}$/)),
  memberIds: Schema.Array(ID),
})
const Message = Schema.Struct({
  id: ID,
  rootId: ID,
  parentId: Schema.NullOr(ID),
  authorId: Schema.String,
  kind: Schema.Literal('message', 'reply', 'progress'),
  text: Schema.String.pipe(Schema.maxLength(120000)),
  attachments: Schema.optional(
    Schema.Array(ImageSchema).pipe(Schema.maxItems(4)),
  ),
  createdAt: Schema.Number,
  recipientIds: Schema.Array(ID),
  invitedGuestIds: Schema.optional(Schema.Array(ID)),
  roundId: ID,
  channelId: Schema.optionalWith(ChannelId, {
    default: () => GENERAL_CHANNEL_ID,
  }),
  mode: Schema.optional(Mode),
  deliveryId: Schema.optional(ID),
  discussionPaused: Schema.optional(Schema.Boolean),
})
const HumanMention = Schema.Struct({
  messageId: ID,
  readAt: Schema.optional(Schema.Number),
})
const Delivery = Schema.Struct({
  id: ID,
  workerId: ID,
  messageId: ID,
  rootId: ID,
  roundId: ID,
  status: Schema.Literal('pending', 'waiting', 'replied', 'resolved'),
  createdAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  replyId: Schema.optional(ID),
  resolvedAt: Schema.optional(Schema.Number),
  coalescedInto: Schema.optional(ID),
  coalescedMessageIds: Schema.optional(Schema.Array(ID)),
  previouslyClaimed: Schema.optional(Schema.Boolean),
})
const Worker = Schema.Struct({
  archivedAt: Schema.optional(Schema.Number),
  managed: Schema.optional(
    Schema.Struct({
      cwd: Schema.String,
      model: Schema.String,
      effort: Schema.String,
      serviceTier: Schema.optional(Schema.Literal('default', 'priority')),
      permission: Schema.Literal('auto', 'full'),
      threadId: Schema.NullOr(ID),
      turnAttempted: Schema.optional(Schema.Boolean),
    }),
  ),
  identity: Schema.optional(
    Schema.String.pipe(Schema.maxLength(MAX_IDENTITY_LENGTH)),
  ),
  role: Schema.optional(Schema.String.pipe(Schema.maxLength(MAX_ROLE_LENGTH))),
  id: ID,
  handle: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]{0,31}$/)),
  title: Text,
  initials: Text,
  connection: Schema.Literal('new', 'awaiting', 'connected', 'approval'),
  token: ID,
  connectedAt: Schema.NullOr(Schema.Number),
})
const HireDraft = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  handle: Schema.String.pipe(Schema.maxLength(32)),
  role: Schema.String.pipe(Schema.maxLength(MAX_ROLE_LENGTH)),
  identity: Schema.String.pipe(Schema.maxLength(MAX_IDENTITY_LENGTH)),
  cwd: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4096)),
  model: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  effort: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(30)),
  serviceTier: Schema.optional(Schema.Literal('default', 'priority')),
  permission: Schema.Literal('auto', 'full'),
})
export const decodeHireDraft = Schema.decodeUnknownSync(HireDraft)
const HireRequest = Schema.Struct({
  id: ID,
  requesterId: ID,
  channelId: Schema.optionalWith(ChannelId, {
    default: () => GENERAL_CHANNEL_ID,
  }),
  rootId: Schema.optional(ID),
  draft: HireDraft,
  status: Schema.Literal('pending', 'approved', 'declined'),
  createdAt: Schema.Number,
  resolvedAt: Schema.optional(Schema.Number),
  workerId: Schema.optional(ID),
})
const Task = Schema.Struct({
  id: ID,
  title: Text,
  updatedAt: Schema.Number,
  cwd: Schema.String,
})
export const StateSchema = Schema.Struct({
  version: Schema.Literal(2),
  revision: Schema.Number,
  paused: Schema.Boolean,
  replyLimit: Schema.optionalWith(ReplyLimitSchema, {
    default: () => DEFAULT_REPLY_LIMIT,
  }),
  channels: Schema.optionalWith(Schema.Array(Channel), {
    default: () => [
      { id: GENERAL_CHANNEL_ID, name: GENERAL_CHANNEL_ID, memberIds: [] },
    ],
  }),
  workers: Schema.Array(Worker),
  hireRequests: Schema.optionalWith(Schema.Array(HireRequest), {
    default: () => [],
  }),
  messages: Schema.Array(Message),
  mentions: Schema.optionalWith(Schema.Array(HumanMention), {
    default: () => [],
  }),
  deliveries: Schema.Array(Delivery),
  relay: Schema.Struct({
    taskId: Schema.NullOr(ID),
    automationId: Schema.NullOr(Text),
    token: ID,
  }),
  recent: Schema.Array(Task),
  catalogVersion: Schema.optional(Schema.Literal(1)),
  recentAt: Schema.NullOr(Schema.Number),
  refreshRequestedAt: Schema.NullOr(Schema.Number),
})
export const EventSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('hire'),
    id: ID,
    workerId: ID,
    token: ID,
    rootId: ID,
    draft: HireDraft,
  }),
  Schema.Struct({
    kind: Schema.Literal('conversation-start'),
    id: ID,
    workerId: ID,
    token: ID,
    channelId: ChannelId,
    text: Text,
    to: Schema.Array(Schema.String).pipe(Schema.maxItems(100)),
    mode: Mode,
  }),
  Schema.Struct({
    kind: Schema.Literal('conversation-post'),
    id: ID,
    workerId: ID,
    token: ID,
    channelId: ChannelId,
    rootId: ID,
    text: Text,
    to: Schema.Array(Schema.String).pipe(Schema.maxItems(100)),
    mode: Mode,
  }),
  Schema.Struct({
    kind: Schema.Literal('profile'),
    workerId: ID,
    token: ID,
    role: Schema.optional(
      Schema.String.pipe(Schema.maxLength(MAX_ROLE_LENGTH)),
    ),
    identity: Schema.optional(
      Schema.String.pipe(Schema.maxLength(MAX_IDENTITY_LENGTH)),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('started'),
    workerId: ID,
    deliveryId: ID,
  }),
  Schema.Struct({
    kind: Schema.Literal('reply', 'progress'),
    workerId: ID,
    deliveryId: ID,
    text: Text,
    to: Schema.Array(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('connect'), workerId: ID, token: ID }),
  Schema.Struct({
    kind: Schema.Literal('relay'),
    taskId: ID,
    automationId: Text,
    token: ID,
  }),
  Schema.Struct({
    kind: Schema.Literal('catalog'),
    tasks: Schema.Array(Task),
    catalogVersion: Schema.optional(Schema.Literal(1)),
  }),
)
export const decodeState = Schema.decodeUnknownSync(StateSchema)
export const decodeEvent = Schema.decodeUnknownSync(EventSchema)
