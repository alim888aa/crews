import { Schema } from 'effect'
import { DEFAULT_REPLY_LIMIT } from '../shared/contracts.js'
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
  roundId: ID,
  mode: Schema.optional(Mode),
  deliveryId: Schema.optional(ID),
  discussionPaused: Schema.optional(Schema.Boolean),
})
const Delivery = Schema.Struct({
  id: ID,
  workerId: ID,
  messageId: ID,
  rootId: ID,
  roundId: ID,
  status: Schema.Literal('pending', 'waiting', 'replied'),
  createdAt: Schema.Number,
  startedAt: Schema.optional(Schema.Number),
  replyId: Schema.optional(ID),
})
const Worker = Schema.Struct({
  id: ID,
  handle: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]{0,31}$/)),
  title: Text,
  initials: Text,
  connection: Schema.Literal('new', 'awaiting', 'connected', 'approval'),
  token: ID,
  connectedAt: Schema.NullOr(Schema.Number),
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
  workers: Schema.Array(Worker),
  messages: Schema.Array(Message),
  deliveries: Schema.Array(Delivery),
  relay: Schema.Struct({
    taskId: Schema.NullOr(ID),
    automationId: Schema.NullOr(Text),
    token: ID,
  }),
  recent: Schema.Array(Task),
  recentAt: Schema.NullOr(Schema.Number),
  refreshRequestedAt: Schema.NullOr(Schema.Number),
})
export const EventSchema = Schema.Union(
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
  Schema.Struct({ kind: Schema.Literal('catalog'), tasks: Schema.Array(Task) }),
)
export const decodeState = Schema.decodeUnknownSync(StateSchema)
export const decodeEvent = Schema.decodeUnknownSync(EventSchema)
