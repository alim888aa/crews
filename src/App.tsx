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
  getRoomError,
  subscribeErrors,
  clearRoomError,
  getDrafts,
  getImageDrafts,
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
import { Setup, Teammates, ConnectionLabel } from '@/Connections'

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
  showQuote = false,
}: {
  message: ChatMessage
  state: RoomState
  children?: ReactNode
  onReply?: () => void
  showQuote?: boolean
}) {
  const worker = state.workers.find((w) => w.id === message.authorId)
  const parent =
    showQuote && message.parentId && message.parentId !== message.rootId
      ? state.messages.find((m) => m.id === message.parentId)
      : null
  return (
    <Message>
      <PersonAvatar worker={worker} user={message.authorId === 'user'} />
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
          {worker && (
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
  root,
  replyTarget,
  onClearTarget,
  onSent,
}: {
  room: RoomState
  root?: ChatMessage
  replyTarget?: ChatMessage
  onClearTarget?: () => void
  onSent: (message: ChatMessage) => void
}) {
  const drafts = useSyncExternalStore(subscribeDrafts, getDrafts)
  const draftId = root?.id ?? 'channel'
  const text = drafts[draftId] ?? ''
  const imageDrafts = useSyncExternalStore(subscribeDrafts, getImageDrafts)
  const images = imageDrafts[draftId] ?? []
  const [uploading, setUploading] = useState(false)
  const busy = useRef(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const allowed = root
    ? root.recipientIds.flatMap((id) => room.workers.filter((w) => w.id === id))
    : room.workers
  const handles = [
    ...new Set(
      [...text.matchAll(/(?:^|[\s(])@([a-z][a-z0-9-]*)\b/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    ),
  ]
  const simultaneous = handles.includes('all')
  const recipients = simultaneous
    ? allowed
    : handles.length
      ? handles.flatMap((h) => allowed.filter((w) => w.handle === h))
      : root
        ? allowed
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
    if (busy.current || sending) return
    busy.current = true
    setUploading(true)
    setError('')
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
      busy.current = false
      setUploading(false)
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
    try {
      await window.crew.removeImage(id)
      setImageDrafts(
        draftId,
        (getImageDrafts()[draftId] ?? []).filter((a) => a.id !== id),
      )
    } catch (error) {
      setError(errorText(error))
    }
  }
  async function send() {
    if (
      sending ||
      busy.current ||
      (!text.trim() && !images.length) ||
      !recipients.length ||
      unknown
    )
      return
    setSending(true)
    setError('')
    try {
      const message = await window.crew.send({
        text,
        attachmentIds: images.map((a) => a.id),
        parentId: replyTarget?.id ?? root?.id ?? null,
      })
      setDraft(draftId, '')
      setImageDrafts(draftId, [])
      onClearTarget?.()
      onSent(message)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSending(false)
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
            {root ? 'Reply to conversation' : 'Message general'}
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
                onClick={onClearTarget}
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
                      : 'Mention all teammates'
                  }
                >
                  @all
                </InputGroupButton>
                {allowed.map((w) => (
                  <InputGroupButton
                    key={w.id}
                    variant="ghost"
                    size="xs"
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
  const roomError = useSyncExternalStore(subscribeErrors, getRoomError)
  const [selected, setSelectedId] = useState<string | null>(null)
  const [conversationOpen, setConversationOpen] = useState(false)
  const [panelMotion, setPanelMotion] = useState(false)
  const conversationPanel = useRef<PanelImperativeHandle | null>(null)
  const conversationWidth = useRef('42%')
  function setSelected(id: string | null) {
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
  const root = state.messages.find((m) => m.id === selected)
  const roots = state.messages.filter((m) => m.id === m.rootId)
  const relayOnline =
    state.relay.status === 'waiting' || state.relay.status === 'dispatching'
  const conversation = root
    ? state.messages.filter((m) => m.rootId === root.id)
    : []
  const target =
    root && replyTargets[root.id]
      ? state.messages.find((m) => m.id === replyTargets[root.id])
      : undefined
  const clearTarget = () => {
    if (root) setReplyTargets({ ...replyTargets, [root.id]: '' })
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
          <span className="text-xs text-muted-foreground">
            Slack for your Codex threads.
          </span>
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
              <nav className="px-2">
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => setSelected(null)}
                >
                  <Hash data-icon="inline-start" /> general
                </Button>
              </nav>
              <div className="mt-8 flex items-center justify-between px-4 text-xs text-muted-foreground">
                <span>TEAMMATES</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Add teammate"
                  onClick={() => {
                    setManage({})
                    void window.crew
                      .refreshTasks()
                      .catch((e) => setError(errorText(e)))
                  }}
                >
                  <Plus />
                </Button>
              </div>
              <div className="mt-3 flex flex-col gap-1 px-2">
                {state.workers.map((w) => (
                  <Button
                    key={w.id}
                    variant="ghost"
                    className="h-auto w-full items-start justify-start gap-2 px-2 py-3 text-left whitespace-normal"
                    aria-label={'Manage ' + w.title}
                    aria-haspopup="dialog"
                    onClick={() => setManage({ id: w.id })}
                  >
                    <PersonAvatar worker={w} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        @{w.handle}
                      </span>
                      <span
                        className="block truncate text-xs font-normal text-muted-foreground"
                        title={w.title}
                      >
                        {w.title}
                      </span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        <span
                          className={cn(
                            'presence-dot',
                            w.connection === 'connected' && 'is-listening',
                          )}
                        />
                        <ConnectionLabel worker={w} />
                        {w.pending > 0 && ' · ' + w.pending + ' pending'}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </SidebarContent>
            <SidebarFooter className="gap-3 p-4">
              <ReplyLimit key={state.replyLimit} value={state.replyLimit} />
              <Separator />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">Luna relay</span>
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
                  ? 'Connect Codex to bring your tasks into the room.'
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
            <ResizablePanel id="channel" defaultSize="100%" minSize="240px">
              <main className="channel h-full">
                <div className="channel-header">
                  <div className="flex items-center gap-2">
                    <Hash className="size-5 text-muted-foreground" />
                    <h1 className="font-semibold">general</h1>
                    {state.paused && <Badge variant="secondary">Paused</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {state.workers.length} existing Codex tasks
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
                  {!state.relay.taskId ||
                  state.relay.automationId === 'pending' ||
                  state.recentAt === null ? (
                    <Setup state={state} />
                  ) : roots.length === 0 ? (
                    <Empty className="h-full">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Users />
                        </EmptyMedia>
                        <EmptyTitle>Your room is ready.</EmptyTitle>
                        <EmptyDescription>
                          Add a teammate from your recent Codex tasks, then
                          mention them here.
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
                {state.workers.length > 0 && (
                  <Composer
                    room={state}
                    onSent={(message) => setSelected(message.rootId)}
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
              defaultSize="0%"
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
                    <h2 className="font-semibold">Conversation</h2>
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
                    .map((d) => (
                      <div
                        key={d.id}
                        role="alert"
                        className="flex flex-col gap-2 px-5 py-2"
                      >
                        <p className="text-sm text-destructive">
                          @
                          {
                            state.workers.find((w) => w.id === d.workerId)
                              ?.handle
                          }{' '}
                          · {d.error}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            d.failure === 'approval'
                              ? setManage({ id: d.workerId })
                              : void window.crew.openTask(d.workerId)
                          }
                        >
                          {d.failure === 'approval'
                            ? 'Reapprove teammate'
                            : 'Open original task'}
                        </Button>
                      </div>
                    ))}
                  <div className="min-h-0 flex-1">
                    <Transcript
                      key={root.id}
                      messages={conversation}
                      render={(m) => (
                        <MessageRow
                          message={m}
                          state={state}
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
      </SidebarProvider>
    </TooltipProvider>
  )
}
