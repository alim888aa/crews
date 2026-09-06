import { useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  Link,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import type { RoomState, Worker, RecentTask, Approval } from '@/store'
export const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(e)
export function Setup({ state }: { state: RoomState }) {
  const [opening, setOpening] = useState(false),
    [opened, setOpened] = useState(false),
    [error, setError] = useState('')
  const registered = !!state.relay.taskId
  async function connect() {
    setOpening(true)
    setError('')
    try {
      await window.crew.setup()
      setOpened(true)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setOpening(false)
    }
  }
  return (
    <section className="onboarding" aria-label="Connect Crews">
      <div className="onboarding-copy">
        <Badge variant="outline">YOUR TASKS. ONE ROOM.</Badge>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight">
          Bring your people
          <br />
          into the room.
        </h1>
        <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
          The planner who knows your week. The builder who knows your code. Keep
          their history and tools, and talk to them here.
        </p>
        <div className="mt-8 flex flex-col gap-4">
          <div className="setup-step">
            <span className="step-number">1</span>
            <div>
              <p className="font-medium">Connect Codex</p>
              <p className="text-sm text-muted-foreground">
                Open the prepared setup message and press Send.
              </p>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-number">2</span>
            <div>
              <p className="font-medium">Choose your teammates</p>
              <p className="text-sm text-muted-foreground">
                Pick existing tasks and give them an @name.
              </p>
            </div>
          </div>
          <div className="setup-step">
            <span className="step-number">3</span>
            <div>
              <p className="font-medium">Say something</p>
              <p className="text-sm text-muted-foreground">
                Mention one person, a few, or everyone.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button onClick={() => void connect()} disabled={opening}>
            <Link data-icon="inline-start" />
            {opening
              ? 'Opening Codex…'
              : registered
                ? 'Copy setup and open relay'
                : opened
                  ? 'Reopen setup'
                  : 'Connect to Codex'}
            <ArrowUpRight data-icon="inline-end" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Keep Codex open while using the room.
          </span>
        </div>
        {(opened || registered) && (
          <Alert className="mt-5">
            <AlertTitle>
              {registered
                ? 'Finish setup in the relay task'
                : 'Your setup message is ready in Codex'}
            </AlertTitle>
            <AlertDescription>
              {registered
                ? 'If you reopened setup, paste the copied message and press Send in that relay task. The room will update when the relay reports back.'
                : 'Press Send there, then return here. No teammate receives messages until you connect them.'}
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="onboarding-note">
        <Users className="size-10 text-muted-foreground" />
        <h2 className="mt-6 text-xl font-medium">Already know each other?</h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Good. Your existing Codex tasks stay exactly where they are. You’re
          giving them a shared place to talk.
        </p>
        <div className="mt-8 border-t pt-5 text-sm text-muted-foreground">
          Room history stays on this Mac.
          <br />
          Agents keep using your Codex account.
        </div>
      </div>
    </section>
  )
}
export function ConnectionLabel({ worker }: { worker: Worker }) {
  if (worker.connection === 'new') return <>Not connected</>
  if (worker.connection === 'awaiting') return <>Waiting for your approval</>
  if (worker.connection === 'approval') return <>Approval needed</>
  return (
    <>
      {
        {
          idle: 'Ready',
          working: 'Working…',
          queued: 'Queued',
          turn: 'Waiting for turn',
          unconfirmed: 'Waiting for task',
          attention: 'Needs attention',
        }[worker.presence]
      }
    </>
  )
}
export function Teammates({
  state,
  open,
  onClose,
  initialId,
}: {
  state: RoomState
  open: boolean
  onClose: () => void
  initialId?: string
}) {
  const initial = state.workers.find((w) => w.id === initialId)
  const [selected, setSelected] = useState<RecentTask | Worker | undefined>(
    initial,
  )
  const [title, setTitle] = useState(initial?.title ?? ''),
    [handle, setHandle] = useState(initial?.handle ?? '')
  const [approval, setApproval] = useState<Approval | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState('')
  const existing = state.workers.find((w) => w.id === selected?.id)
  const waiting =
    !!state.refreshRequestedAt &&
    (!state.recentAt || state.refreshRequestedAt > state.recentAt)
  const tasks = state.recent.filter((t) =>
    t.title.toLowerCase().includes(filter.toLowerCase()),
  )
  function choose(task: RecentTask | Worker) {
    setSelected(task)
    setTitle(task.title)
    setHandle(
      'handle' in task
        ? task.handle
        : task.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .replace(/^[^a-z]+/, '')
            .slice(0, 32) || 'teammate',
    )
    setError('')
    setApproval(null)
    setCopied(false)
  }
  async function save() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const input = { id: selected.id, title, handle }
      if (existing) await window.crew.edit(input)
      else await window.crew.add(input)
      if (existing?.connection === 'connected') {
        onClose()
        return
      }
      await prepareAndOpen(selected.id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function prepareAndOpen(id: string) {
    setCopied(false)
    setApproval(await window.crew.approval(id))
    await window.crew.copyOpen({ id })
    setCopied(true)
  }
  async function prepare() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await prepareAndOpen(selected.id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function connect() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await window.crew.copyOpen({ id: selected.id })
      setCopied(true)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {approval
              ? 'Connect @' + handle
              : selected
                ? existing
                  ? 'Edit teammate'
                  : 'Meet your teammate'
                : 'Your teammates'}
          </DialogTitle>
          {(approval || !selected) && (
            <DialogDescription>
              {approval
                ? 'Approve this connection in the original Codex task. We’ll confirm it here when the task replies.'
                : 'Choose from your ten most recent local Codex tasks.'}
            </DialogDescription>
          )}
        </DialogHeader>
        {approval ? (
          <div className="flex flex-col gap-4">
            {existing?.connection === 'connected' ? (
              <Alert>
                <Check />
                <AlertTitle>Connection confirmed</AlertTitle>
                <AlertDescription>
                  @{existing.handle} wrote back successfully. You can mention
                  them in the room.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert>
                  <Link />
                  <AlertTitle>
                    {copied
                      ? 'Copied — paste and send in Codex'
                      : 'Copy this message to connect'}
                  </AlertTitle>
                  <AlertDescription>
                    {copied
                      ? `In “${title}”, press ⌘V and send the message. Then return here — the connection will confirm automatically.`
                      : `Copy the message below, then paste and send it in the Codex task “${title}”.`}
                  </AlertDescription>
                </Alert>
                <Button onClick={() => void connect()} disabled={busy}>
                  <Copy data-icon="inline-start" />
                  {copied ? 'Copy again and reopen task' : 'Copy and open task'}
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
                <div className="text-xs text-muted-foreground">
                  <p id="approval-label">Your connection message</p>
                  <pre
                    tabIndex={0}
                    aria-labelledby="approval-label"
                    className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 select-text"
                  >
                    {approval.text}
                  </pre>
                </div>
                {copied && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Waiting for a reply from that task. If it shows a permission
                    request, respond there. A delay alone doesn’t mean approval
                    was lost.
                  </p>
                )}
              </>
            )}
            <Button variant="outline" onClick={onClose}>
              {existing?.connection === 'connected'
                ? 'Back to the room'
                : 'Close for now'}
            </Button>
          </div>
        ) : selected ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="teammate-name">Name</FieldLabel>
                <Input
                  id="teammate-name"
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </Field>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="teammate-handle">@name</FieldLabel>
                <Input
                  id="teammate-handle"
                  value={handle}
                  maxLength={32}
                  onChange={(e) => setHandle(e.target.value.toLowerCase())}
                  required
                  aria-invalid={!!error}
                />
              </Field>
            </FieldGroup>
            {existing && (
              <p className="mt-4 text-sm text-muted-foreground">
                <ConnectionLabel worker={existing} />
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => setSelected(undefined)}>
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
              <div className="flex gap-2">
                {existing && existing.connection !== 'connected' && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void prepare()}
                  >
                    {existing.connection === 'approval'
                      ? 'Reapprove'
                      : 'Connect'}
                  </Button>
                )}
                <Button type="submit" disabled={busy}>
                  {existing ? 'Save changes' : 'Add and connect'}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <>
            {state.workers.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="mb-1 text-xs text-muted-foreground">
                  IN YOUR ROOM
                </p>
                {state.workers.map((w) => (
                  <Button
                    key={w.id}
                    variant="ghost"
                    className="h-auto justify-between py-3"
                    onClick={() => choose(w)}
                  >
                    <span>@{w.handle}</span>
                    <span className="text-xs text-muted-foreground">
                      <ConnectionLabel worker={w} />
                    </span>
                  </Button>
                ))}
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="task-search" className="sr-only">
                Filter recent tasks
              </FieldLabel>
              <Input
                id="task-search"
                placeholder="Find a recent task…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Field>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                RECENT TASKS
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={waiting || !state.relay.taskId}
                onClick={() => {
                  setError('')
                  void window.crew
                    .refreshTasks()
                    .catch((e) => setError(errorText(e)))
                }}
              >
                <RefreshCw data-icon="inline-start" />
                {waiting ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {tasks.map((task) => {
                const added = state.workers.some((w) => w.id === task.id)
                return (
                  <Button
                    key={task.id}
                    variant="ghost"
                    className="h-auto justify-between py-3 text-left"
                    disabled={added}
                    onClick={() => choose(task)}
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate">{task.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {task.cwd.split('/').filter(Boolean).at(-1) ||
                          'Standalone task'}
                      </span>
                    </span>
                    {added ? (
                      <Check data-icon="inline-end" />
                    ) : (
                      <Plus data-icon="inline-end" />
                    )}
                  </Button>
                )
              })}
              {tasks.length === 0 && (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Users />
                    </EmptyMedia>
                    <EmptyTitle>
                      {filter ? 'No matches' : 'Waiting for your tasks'}
                    </EmptyTitle>
                    <EmptyDescription>
                      {filter
                        ? 'Try another name.'
                        : state.relay.taskId
                          ? 'Keep Codex open. The relay will send the list when it checks in.'
                          : 'Connect Codex first to load your recent tasks.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
            {waiting && (
              <p role="status" className="text-xs text-muted-foreground">
                Refresh is queued for the relay’s next check. You can keep using
                the room.
              </p>
            )}
          </>
        )}
        {error && <FieldError>{error}</FieldError>}
      </DialogContent>
    </Dialog>
  )
}
