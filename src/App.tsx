import { ReplyLimit } from './ReplyLimit'
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ArrowUp,
  AtSign,
  Paperclip,
  Plus,
  ExternalLink,
  Hash,
  MessageSquare,
  Pause,
  Play,
  Reply,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
} from '@/components/ui/sidebar'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import type { PanelImperativeHandle } from 'react-resizable-panels'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Message,
  MessageContent,
  MessageHeader,
  MessageFooter,
} from '@/components/ui/message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from '@/components/ui/message-scroller'
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '@/components/ui/field'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  getSnapshot,
  subscribe,
  getMentionNavigation,
  subscribeMentionNavigation,
  clearMentionNavigation,
  openMention,
  getRoomError,
  subscribeErrors,
  clearRoomError,
  getDrafts,
  getImageDrafts,
  getDraftOperations,
  beginDraftOperation,
  endDraftOperation,
  setDraftError,
  setImageDrafts,
  subscribeDrafts,
  setDraft,
  type Worker,
  type ChatMessage,
  type RoomState,
} from '@/store'

import { ConversationActivity } from '@/ConversationActivity'
import { MessageMarkdown } from '@/MessageMarkdown'
import { ImagePreviews } from '@/ImagePreviews'
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  type ImageAttachment,
} from '../shared/contracts'
import { Setup, Teammates } from '@/Connections'
import { Channels } from '@/Channels'
import { SidebarTeammates } from '@/SidebarTeammates'
import { TeammateProfile } from '@/TeammateProfile'
import { ManagedApprovalDialog } from '@/ManagedApprovalDialog'
import { HireReview } from '@/HireReview'
import { DeliveryError } from '@/DeliveryError'
import { Mentions } from '@/Mentions'
import {
  channelMemberIds,
  conversationParticipantIds,
} from '../shared/channels'
import { GENERAL_CHANNEL_ID } from '../shared/contracts'

const time = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)
const author = (message: ChatMessage, state: RoomState) =>
  message.authorId === 'user'
    ? 'You'
    : '@' + state.workers.find((w) => w.id === message.authorId)?.handle
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'Something went wrong. Try again.'

function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
function PersonAvatar({
  worker,
  user = false,
}: {
  worker?: Worker
  user?: boolean
}) {
  return (
    <Avatar>
      <AvatarFallback>{user ? 'Y' : (worker?.initials ?? '?')}</AvatarFallback>
    </Avatar>
  )
}
function Transcript({
  messages,
  render,
}: {
  messages: ChatMessage[]
  render: (m: ChatMessage) => ReactNode
}) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent className="p-6">
            {messages.map((m) => (
              <MessageScrollerItem
                key={m.id}
                messageId={m.id}
                scrollAnchor={m.authorId === 'user'}
              >
                {render(m)}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
function MessageRow({
  message,
  state,
  children,
  onReply,
  onProfile,
  showQuote = false,
}: {
  message: ChatMessage
  state: RoomState
  children?: ReactNode
  onReply?: () => void
  onProfile?: (id: string) => void
  showQuote?: boolean
}) {
  const worker = state.workers.find((w) => w.id === message.authorId)
  const parent =
    showQuote && message.parentId && message.parentId !== message.rootId
      ? state.messages.find((m) => m.id === message.parentId)
      : null
  return (
    <Message>
      {worker && onProfile ? (
        <button
          type="button"
          aria-label={`View @${worker.handle} profile`}
          className="h-fit rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => onProfile(worker.id)}
        >
          <PersonAvatar worker={worker} />
        </button>
      ) : (
        <PersonAvatar worker={worker} user={message.authorId === 'user'} />
      )}
      <MessageContent className="gap-1.5">
        <MessageHeader className="gap-2">
          <span className="font-semibold text-foreground">
            {author(message, state)}
          </span>
          <time dateTime={new Date(message.createdAt).toISOString()}>
            {time(message.createdAt)}
          </time>
          {message.kind === 'progress' && (
            <Badge variant="outline">Update</Badge>
          )}
          {message.authorId === 'user' &&
            message.recipientIds.length > 1 &&
            message.mode && (
              <Badge variant="outline">
                {message.mode === 'simultaneous' ? 'All at once' : 'In order'}
              </Badge>
            )}
          {worker && !worker.managed && (
            <Hint label="Open original Codex task">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={'Open ' + worker.title}
                onClick={() => window.crew.openTask(worker.id)}
              >
                <ExternalLink />
              </Button>
            </Hint>
          )}
          {onReply && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              aria-label={'Reply to ' + author(message, state)}
              onClick={onReply}
            >
              <Reply />
            </Button>
          )}
        </MessageHeader>
        {parent && (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Reply className="size-3 shrink-0" />
            <span className="truncate">
              {author(parent, state)} · {parent.text || 'Image attachment'}
            </span>
          </div>
        )}
        <Bubble variant="ghost">
          <BubbleContent>
            {message.text && <MessageMarkdown text={message.text} />}
            {!!message.attachments?.length && (
              <ImagePreviews images={message.attachments} />
            )}
          </BubbleContent>
        </Bubble>
        {message.discussionPaused && (
          <p className="text-xs text-muted-foreground">
            Reply limit reached. Increase it in the sidebar, then send a
            follow-up to continue.
          </p>
        )}
        {children && (
          <MessageFooter className="flex-wrap gap-2 empty:hidden">
            {children}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

function Composer({
  room,
  channelId,
  root,
  replyTarget,
  onClearTarget,
  onSent,
}: {
  room: RoomState
  channelId: string
  root?: ChatMessage
  replyTarget?: ChatMessage
  onClearTarget?: (targetId: string) => void
  onSent: (message: ChatMessage) => void
}) {
  const drafts = useSyncExternalStore(subscribeDrafts, getDrafts)
  const draftId =
    root?.id ??
    (channelId === GENERAL_CHANNEL_ID ? 'channel' : `channel:${channelId}`)
  const text = drafts[draftId] ?? ''
  const imageDrafts = useSyncExternalStore(subscribeDrafts, getImageDrafts)
  const images = imageDrafts[draftId] ?? []
  const operations = useSyncExternalStore(subscribeDrafts, getDraftOperations)
  const uploading = operations[draftId]?.pending === 'uploading'
  const sending = operations[draftId]?.pending === 'sending'
  const error = operations[draftId]?.error ?? ''
  const setError = (value: string) => setDraftError(draftId, value)
  const input = useRef<HTMLTextAreaElement>(null)
  const allowed = room.workers.filter((worker) => !worker.archivedAt)
  const allRecipientIds = root
    ? conversationParticipantIds(room, root.id)
    : channelMemberIds(room, channelId)
  const allRecipients = allRecipientIds.flatMap((id) =>
    room.workers.filter((worker) => worker.id === id),
  )
  const primaryMentionIds = new Set(allRecipientIds)
  const mentionChoices = [
    ...allowed.filter((worker) => primaryMentionIds.has(worker.id)),
    ...allowed.filter((worker) => !primaryMentionIds.has(worker.id)),
  ]
  const handles = [
    ...new Set(
      [...text.matchAll(/(?:^|[\s(])@([a-z][a-z0-9-]*)\b/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    ),
  ]
  const simultaneous = handles.includes('all')
  const namedRecipients = handles.flatMap((handle) =>
    allowed.filter((worker) => worker.handle === handle),
  )
  const recipients = simultaneous
    ? [
        ...new Map(
          [...allRecipients, ...namedRecipients].map((worker) => [
            worker.id,
            worker,
          ]),
        ).values(),
      ]
    : handles.length
      ? namedRecipients
      : root
        ? allRecipients
        : []
  const unknown = handles.some(
    (h) => h !== 'all' && !allowed.some((w) => w.handle === h),
  )
  function mention(handle: string) {
    const caret = input.current?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/@[\w-]*$/, '')
    const inserted =
      before + (before && !/\s$/.test(before) ? ' ' : '') + '@' + handle + ' '
    setDraft(draftId, inserted + text.slice(caret))
    setError('')
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(inserted.length, inserted.length)
    })
  }
  async function attach(load: () => Promise<ImageAttachment[]>) {
    if (!beginDraftOperation(draftId, 'uploading')) return
    try {
      const added = await load()
      const current = getImageDrafts()[draftId] ?? []
      if (current.length + added.length > MAX_IMAGES) {
        await Promise.all(added.map((a) => window.crew.removeImage(a.id)))
        throw new Error(`Attach up to ${MAX_IMAGES} images per message.`)
      }
      setImageDrafts(draftId, [...current, ...added])
    } catch (e) {
      setError(errorText(e))
    } finally {
      endDraftOperation(draftId)
      input.current?.focus()
    }
  }
  async function paste(files: File[]) {
    if (files.length + images.length > MAX_IMAGES)
      throw new Error(`Attach up to ${MAX_IMAGES} images per message.`)
    const added: ImageAttachment[] = []
    try {
      for (const file of files) {
        if (file.size > MAX_IMAGE_BYTES)
          throw new Error('Choose an image smaller than 10 MB.')
        added.push(
          await window.crew.importImage({
            name: file.name || 'Screenshot.png',
            bytes: new Uint8Array(await file.arrayBuffer()),
          }),
        )
      }
      return added
    } catch (error) {
      await Promise.all(added.map((a) => window.crew.removeImage(a.id)))
      throw error
    }
  }
  async function removeImage(id: string) {
    if (!beginDraftOperation(draftId, 'uploading')) return
    try {
      await window.crew.removeImage(id)
      setImageDrafts(
        draftId,
        (getImageDrafts()[draftId] ?? []).filter((a) => a.id !== id),
      )
    } catch (error) {
      setError(errorText(error))
    } finally {
      endDraftOperation(draftId)
    }
  }
  async function send() {
    if ((!text.trim() && !images.length) || !recipients.length || unknown)
      return
    if (!beginDraftOperation(draftId, 'sending')) return
    try {
      const message = await window.crew.send({
        text,
        attachmentIds: images.map((a) => a.id),
        parentId: replyTarget?.id ?? root?.id ?? null,
        channelId,
      })
      if (getDrafts()[draftId] === text) setDraft(draftId, '')
      const currentImages = getImageDrafts()[draftId] ?? []
      if (
        currentImages.length === images.length &&
        currentImages.every((image, index) => image.id === images[index]?.id)
      )
        setImageDrafts(draftId, [])
      if (replyTarget) onClearTarget?.(replyTarget.id)
      onSent(message)
    } catch (e) {
      setError(errorText(e))
    } finally {
      endDraftOperation(draftId)
    }
  }
  return (
    <form
      className="shrink-0 p-4 pt-2"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={'compose-' + draftId} className="sr-only">
            {root
              ? 'Reply to conversation'
              : `Message ${room.channels.find((channel) => channel.id === channelId)?.name ?? 'channel'}`}
          </FieldLabel>
          {replyTarget && replyTarget.id !== root?.id && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Reply className="size-3 shrink-0" />
              <span className="truncate">
                Replying to {author(replyTarget, room)} ·{' '}
                {replyTarget.text || 'Image attachment'}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Cancel reply target"
                onClick={() => onClearTarget?.(replyTarget.id)}
              >
                <X />
              </Button>
            </div>
          )}
          <InputGroup>
            <InputGroupTextarea
              ref={input}
              id={'compose-' + draftId}
              aria-invalid={!!error}
              placeholder={
                root
                  ? 'Reply to this conversation…'
                  : 'Mention someone, then say your thing…'
              }
              value={text}
              disabled={sending}
              className="max-h-52 min-h-24 resize-none"
              onChange={(e) => {
                setDraft(draftId, e.target.value)
                setError('')
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.items)
                  .filter(
                    (item) =>
                      item.kind === 'file' && item.type.startsWith('image/'),
                  )
                  .flatMap((item) => {
                    const file = item.getAsFile()
                    return file ? [file] : []
                  })
                if (files.length) {
                  e.preventDefault()
                  void attach(() => paste(files))
                }
              }}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            {!!images.length && (
              <InputGroupAddon align="block-start">
                <ImagePreviews
                  images={images}
                  onRemove={(id) => void removeImage(id)}
                  disabled={sending || uploading}
                />
              </InputGroupAddon>
            )}
            <InputGroupAddon align="block-end" className="min-w-0 flex-nowrap">
              <Hint label="Attach images">
                <InputGroupButton
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Attach images"
                  disabled={sending || uploading || images.length >= MAX_IMAGES}
                  onClick={() => void attach(() => window.crew.pickImages())}
                >
                  <Paperclip />
                </InputGroupButton>
              </Hint>
              <div
                className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [&>*]:shrink-0"
                aria-label="Mention teammates"
              >
                <AtSign />
                <InputGroupButton
                  variant="ghost"
                  size="xs"
                  onClick={() => mention('all')}
                  aria-label={
                    root
                      ? 'Mention everyone in this conversation'
                      : 'Mention all channel members'
                  }
                >
                  @all
                </InputGroupButton>
                {mentionChoices.map((w) => (
                  <InputGroupButton
                    key={w.id}
                    variant="ghost"
                    size="xs"
                    className={
                      primaryMentionIds.has(w.id)
                        ? 'font-bold text-foreground hover:text-foreground'
                        : 'font-normal text-muted-foreground hover:text-muted-foreground'
                    }
                    onClick={() => mention(w.handle)}
                    aria-label={'Mention ' + w.handle}
                  >
                    {w.handle}
                  </InputGroupButton>
                ))}
              </div>
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                className="ml-auto shrink-0"
                aria-label={root ? 'Send reply' : 'Send message'}
                disabled={
                  sending ||
                  uploading ||
                  (!text.trim() && !images.length) ||
                  !recipients.length ||
                  unknown
                }
              >
                <ArrowUp />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {uploading && (
            <p role="status" className="text-xs text-muted-foreground">
              Adding image…
            </p>
          )}
          <FieldError>
            {error ||
              (unknown ? 'Choose a teammate in this conversation.' : '')}
          </FieldError>
        </Field>
      </FieldGroup>
    </form>
  )
}

export default function App() {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const pendingHires = state.hireRequests.filter(
    (request) => request.status === 'pending',
  )
  const nextHire = pendingHires[0]
  const mentionNavigation = useSyncExternalStore(
    subscribeMentionNavigation,
    getMentionNavigation,
  )
  const roomError = useSyncExternalStore(subscribeErrors, getRoomError)
  const [localChannelId, setChannelId] = useState(GENERAL_CHANNEL_ID)
  const channelIdRef = useRef(localChannelId)
  const [localSelected, setSelectedId] = useState<string | null>(null)
  const [localConversationOpen, setConversationOpen] = useState(false)
  const channelId = mentionNavigation?.channelId ?? localChannelId
  const selected = mentionNavigation?.rootId ?? localSelected
  const conversationOpen = Boolean(mentionNavigation) || localConversationOpen
  const [panelMotion, setPanelMotion] = useState(false)
  const conversationPanel = useRef<PanelImperativeHandle | null>(null)
  const conversationWidth = useRef('42%')
  function setSelected(id: string | null) {
    const activeMention = getMentionNavigation()
    if (activeMention) {
      channelIdRef.current = activeMention.channelId
      setChannelId(activeMention.channelId)
    }
    clearMentionNavigation()
    setPanelMotion(true)
    if (id) {
      setSelectedId(id)
      setConversationOpen(true)
      conversationPanel.current?.resize(conversationWidth.current)
    } else {
      setConversationOpen(false)
      conversationPanel.current?.collapse()
    }
  }
  const [replyTargets, setReplyTargets] = useState<Record<string, string>>({})
  const [relayDetails, setRelayDetails] = useState(false)
  const [error, setError] = useState('')
  const [manage, setManage] = useState<{ id?: string } | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const profileWorker = state.workers.find((worker) => worker.id === profileId)
  const root = state.messages.find(
    (m) => m.id === selected && m.channelId === channelId,
  )
  const channel =
    state.channels.find((item) => item.id === channelId) ?? state.channels[0]
  const roots = state.messages.filter(
    (m) => m.id === m.rootId && m.channelId === channelId,
  )
  const relayOnline =
    state.relay.status === 'waiting' || state.relay.status === 'dispatching'
  const conversation = root
    ? state.messages.filter((m) => m.rootId === root.id)
    : []
  const target =
    root && replyTargets[root.id]
      ? state.messages.find((m) => m.id === replyTargets[root.id])
      : undefined
  const clearTarget = (targetId: string) => {
    if (root)
      setReplyTargets((current) =>
        current[root.id] === targetId ? { ...current, [root.id]: '' } : current,
      )
  }
  const guestCount = root
    ? conversationParticipantIds(state, root.id).filter(
        (id) => !channelMemberIds(state, root.channelId).includes(id),
      ).length
    : 0
  function selectChannel(id: string) {
    if (id === channelId && !mentionNavigation) return
    clearMentionNavigation()
    channelIdRef.current = id
    setSelectedId(null)
    setConversationOpen(false)
    conversationPanel.current?.collapse()
    setChannelId(id)
  }
  return (
    <TooltipProvider>
      <SidebarProvider
        className="app-shell min-h-0"
        style={{ '--sidebar-width': '15rem' } as React.CSSProperties}
      >
        <header className="titlebar">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <span className="text-sm font-medium">Crews</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Slack for your Codex threads.
            </span>
            <Mentions room={state} onOpen={openMention} />
          </div>
        </header>
        <div className="workspace">
          <Sidebar
            collapsible="offcanvas"
            className="top-12 h-[calc(100svh-3rem)]"
            aria-label="Room and teammates"
          >
            <SidebarHeader className="flex-row items-center justify-between px-4 pb-5 pt-6">
              <span className="text-sm font-semibold">Your workspace</span>
              <Badge variant="outline">Local</Badge>
            </SidebarHeader>
            <SidebarContent className="gap-0">
              <Channels
                room={state}
                selectedId={channelId}
                onSelect={selectChannel}
              />
              <SidebarTeammates
                room={state}
                channelId={channelId}
                onProfile={setProfileId}
                onError={setError}
                onAdd={() => {
                  setManage({})
                  void window.crew
                    .refreshTasks()
                    .catch((e) => setError(errorText(e)))
                }}
              />
            </SidebarContent>
            <SidebarFooter className="gap-3 p-4">
              <ReplyLimit key={state.replyLimit} value={state.replyLimit} />
              <Separator />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">Desktop relay</span>
                <Badge variant={relayOnline ? 'secondary' : 'outline'}>
                  {!state.relay.taskId
                    ? 'Not connected'
                    : state.relay.error
                      ? 'Needs attention'
                      : relayOnline
                        ? 'Connected'
                        : state.relay.delayed
                          ? 'Delayed'
                          : 'Connecting'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground" role="status">
                {!state.relay.taskId
                  ? 'Connect the relay to bring existing Desktop tasks into the room. Crews-owned teammates work without it.'
                  : state.relay.error
                    ? state.relay.error
                    : relayOnline
                      ? 'Your mentions go to the original Codex tasks.'
                      : state.relay.delayed
                        ? 'Taking longer than usual. Your messages are saved while the connection recovers.'
                        : 'Connecting automatically. Send your message whenever you’re ready.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRelayDetails(!relayDetails)}
              >
                Connection details
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await window.crew.pause(!state.paused)
                  } catch (e) {
                    setError(errorText(e))
                  }
                }}
              >
                {state.paused ? (
                  <Play data-icon="inline-start" />
                ) : (
                  <Pause data-icon="inline-start" />
                )}
                {state.paused ? 'Resume room' : 'Pause room'}
              </Button>
            </SidebarFooter>
          </Sidebar>
          <ResizablePanelGroup
            key={mentionNavigation?.messageId ?? 'room'}
            orientation="horizontal"
            className="chat-panels min-w-0 flex-1"
            data-motion={panelMotion}
            onTransitionEnd={(event) => {
              if (event.propertyName === 'flex-grow') setPanelMotion(false)
            }}
            onPointerDownCapture={() => setPanelMotion(false)}
            onKeyDownCapture={(event) => {
              if (
                event.target instanceof HTMLElement &&
                event.target.hasAttribute('data-separator')
              )
                setPanelMotion(false)
            }}
            onLayoutChanged={(layout, meta) => {
              if (!meta.isUserInteraction) return
              const width = layout.conversation ?? 0
              setConversationOpen(width > 0)
              if (width > 0) conversationWidth.current = width + '%'
            }}
          >
            <ResizablePanel
              id="channel"
              defaultSize={conversationOpen ? '58%' : '100%'}
              minSize="240px"
            >
              <main className="channel h-full">
                <div className="channel-header">
                  <div className="flex items-center gap-2">
                    <Hash className="size-5 text-muted-foreground" />
                    <h1 className="font-semibold">
                      {channel?.name ?? 'general'}
                    </h1>
                    {state.paused && <Badge variant="secondary">Paused</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {channelMemberIds(state, channelId).length} teammates
                  </span>
                </div>
                {relayDetails && (
                  <section
                    className="connection-panel"
                    aria-label="Luna relay connection"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold">Luna relay</h2>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Close relay details"
                        onClick={() => setRelayDetails(false)}
                      >
                        <X />
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Codex checks the connection every minute and wakes Luna
                      automatically. Keep Codex open. Closing Crews stops
                      listening; reopening it reconnects. Your messages and
                      replies stay saved between launches.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {state.relay.lastSeen
                        ? 'Last relay check at ' +
                          time(state.relay.lastSeen) +
                          '.'
                        : 'Waiting for the first relay check.'}{' '}
                      If a task needs your approval, its original Codex task
                      will show the request.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!state.relay.taskId}
                        onClick={async () => {
                          try {
                            await window.crew.openRelay()
                          } catch (e) {
                            setError(errorText(e))
                          }
                        }}
                      >
                        Open Luna task
                        <ExternalLink data-icon="inline-end" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void window.crew
                            .setup()
                            .catch((e) => setError(errorText(e)))
                        }}
                      >
                        Copy repair approval and open relay
                      </Button>
                    </div>
                  </section>
                )}
                {(error || roomError) && (
                  <div
                    role="alert"
                    className="flex items-center gap-3 px-6 py-2"
                  >
                    <p className="text-sm text-destructive">
                      {error || roomError}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Dismiss error"
                      onClick={() => {
                        setError('')
                        clearRoomError()
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  {!state.workers.some(
                    (worker) => worker.managed && !worker.archivedAt,
                  ) &&
                  (!state.relay.taskId ||
                    state.relay.automationId === 'pending' ||
                    state.recentAt === null) ? (
                    <Setup state={state} onAddTeammate={() => setManage({})} />
                  ) : roots.length === 0 ? (
                    <Empty className="h-full">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Users />
                        </EmptyMedia>
                        <EmptyTitle>Your room is ready.</EmptyTitle>
                        <EmptyDescription>
                          Create a teammate here or add an existing Codex task,
                          then mention them.
                        </EmptyDescription>
                      </EmptyHeader>
                      <Button
                        onClick={() => {
                          setManage({})
                          void window.crew
                            .refreshTasks()
                            .catch((e) => setError(errorText(e)))
                        }}
                      >
                        <Plus data-icon="inline-start" />
                        Add teammate
                      </Button>
                    </Empty>
                  ) : (
                    <Transcript
                      messages={roots}
                      render={(m) => {
                        const replies = state.messages.filter(
                          (r) =>
                            r.rootId === m.id &&
                            r.id !== m.id &&
                            r.kind !== 'progress',
                        )
                        const latest = replies.at(-1)
                        return (
                          <div className="flex flex-col gap-2">
                            <MessageRow
                              message={m}
                              state={state}
                              onProfile={setProfileId}
                              onReply={() => setSelected(m.id)}
                            >
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setSelected(m.id)}
                              >
                                <MessageSquare data-icon="inline-start" />
                                {replies.length
                                  ? replies.length +
                                    (replies.length === 1
                                      ? ' reply'
                                      : ' replies')
                                  : 'Open conversation'}
                              </Button>
                              <ConversationActivity
                                room={state}
                                rootId={m.id}
                              />
                            </MessageRow>
                            {latest && (
                              <button
                                className="reply-preview"
                                onClick={() => setSelected(m.id)}
                              >
                                <span className="shrink-0 whitespace-nowrap font-medium">
                                  {author(latest, state)}
                                </span>
                                <span className="truncate text-muted-foreground">
                                  {latest.text}
                                </span>
                              </button>
                            )}
                          </div>
                        )
                      }}
                    />
                  )}
                </div>
                {state.workers.some((worker) => !worker.archivedAt) && (
                  <Composer
                    key={channelId}
                    room={state}
                    channelId={channelId}
                    onSent={(message) => {
                      const currentChannel =
                        getMentionNavigation()?.channelId ??
                        channelIdRef.current
                      if (currentChannel === message.channelId)
                        setSelected(message.rootId)
                    }}
                  />
                )}
              </main>
            </ResizablePanel>
            <ResizableHandle
              aria-label="Resize conversation"
              disabled={!conversationOpen}
              className={cn(
                'conversation-divider',
                !conversationOpen && 'invisible w-0',
              )}
            />
            <ResizablePanel
              id="conversation"
              panelRef={conversationPanel}
              defaultSize={conversationOpen ? '42%' : '0%'}
              minSize="260px"
              maxSize="70%"
              collapsible
              collapsedSize="0%"
              className="conversation-panel"
            >
              {root && (
                <aside
                  className="conversation"
                  data-open={conversationOpen}
                  inert={!conversationOpen}
                  aria-label="Conversation replies"
                >
                  <div className="channel-header">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">Conversation</h2>
                      {guestCount > 0 && (
                        <Badge variant="outline">
                          {guestCount} {guestCount === 1 ? 'guest' : 'guests'}
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Close conversation"
                      onClick={() => setSelected(null)}
                    >
                      <X />
                    </Button>
                  </div>
                  {state.deliveries
                    .filter(
                      (d) =>
                        d.rootId === root.id &&
                        d.status === 'pending' &&
                        d.error,
                    )
                    .map((d) => {
                      const teammate = state.workers.find(
                        (worker) => worker.id === d.workerId,
                      )
                      return teammate ? (
                        <DeliveryError
                          key={d.id}
                          delivery={d}
                          teammate={teammate}
                          pendingCount={
                            state.deliveries.filter(
                              (item) =>
                                item.rootId === d.rootId &&
                                item.workerId === d.workerId &&
                                item.status === 'pending',
                            ).length
                          }
                          onReapprove={() => setManage({ id: d.workerId })}
                          onError={setError}
                        />
                      ) : null
                    })}
                  <div className="min-h-0 flex-1">
                    <Transcript
                      key={root.id}
                      messages={conversation}
                      render={(m) => (
                        <MessageRow
                          message={m}
                          state={state}
                          onProfile={setProfileId}
                          showQuote
                          onReply={() =>
                            setReplyTargets({
                              ...replyTargets,
                              [root.id]: m.id,
                            })
                          }
                        >
                          <ConversationActivity room={state} messageId={m.id} />
                        </MessageRow>
                      )}
                    />
                  </div>
                  <Composer
                    key={root.id}
                    room={state}
                    channelId={root.channelId}
                    root={root}
                    replyTarget={target}
                    onClearTarget={clearTarget}
                    onSent={() => {}}
                  />
                </aside>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        {manage && (
          <Teammates
            key={manage.id ?? 'picker'}
            state={state}
            open
            onClose={() => setManage(null)}
            initialId={manage.id}
          />
        )}
        {profileWorker && (
          <TeammateProfile
            worker={profileWorker}
            onClose={() => setProfileId(null)}
            onEdit={() => {
              setProfileId(null)
              setManage({ id: profileWorker.id })
            }}
          />
        )}
        {state.managedApprovals?.[0] && (
          <ManagedApprovalDialog
            key={state.managedApprovals[0].id}
            approval={state.managedApprovals[0]}
            handle={
              state.workers.find(
                (worker) => worker.id === state.managedApprovals?.[0]?.workerId,
              )?.handle ?? 'teammate'
            }
            onError={setError}
          />
        )}
        {nextHire && (
          <HireReview
            key={nextHire.id}
            request={nextHire}
            requester={state.workers.find(
              (worker) => worker.id === nextHire.requesterId,
            )}
            channelName={
              state.channels.find((item) => item.id === nextHire.channelId)
                ?.name ?? 'general'
            }
            count={pendingHires.length}
          />
        )}
      </SidebarProvider>
    </TooltipProvider>
  )
}
