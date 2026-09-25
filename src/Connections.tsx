import { MAX_IDENTITY_LENGTH, MAX_ROLE_LENGTH } from '../shared/contracts'
import { Textarea } from '@/components/ui/textarea'
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
import type { CodexModelOption } from '../shared/contracts'
import { CreateTeammate } from '@/CreateTeammate'
import { ConnectionLabel } from '@/ConnectionLabel'
export { ConnectionLabel } from '@/ConnectionLabel'
export const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(e)
export { Setup } from './Setup'

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
    [handle, setHandle] = useState(initial?.handle ?? ''),
    [role, setRole] = useState(initial?.role ?? ''),
    [identity, setIdentity] = useState(initial?.identity ?? '')
  const [approval, setApproval] = useState<Approval | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [modelOptions, setModelOptions] = useState<CodexModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [createdWorker, setCreatedWorker] = useState<Worker | null>(null)
  const [hooksInstalled, setHooksInstalled] = useState(false)
  const [installingHooks, setInstallingHooks] = useState(false)
  const existing =
    state.workers.find((w) => w.id === selected?.id) ??
    (createdWorker?.id === selected?.id ? createdWorker : undefined)
  const waiting =
    !!state.refreshRequestedAt &&
    (!state.recentAt || state.refreshRequestedAt > state.recentAt)
  const tasks = state.recent.filter((t) =>
    `${t.title} ${t.cwd} ${t.id}`.toLowerCase().includes(filter.toLowerCase()),
  )
  function choose(task: RecentTask | Worker) {
    setSelected(task)
    setTitle(task.title)
    setRole('role' in task ? (task.role ?? '') : '')
    setIdentity('identity' in task ? (task.identity ?? '') : '')
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
      const input = { id: selected.id, title, handle, role, identity }
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
  async function beginCreate() {
    setModelsLoading(true)
    setError('')
    try {
      setModelOptions(await window.crew.listModels())
      setCreating(true)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setModelsLoading(false)
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
            {creating
              ? 'Create teammate'
              : approval
                ? 'Connect @' + handle
                : selected
                  ? existing
                    ? 'Edit teammate'
                    : 'Meet your teammate'
                  : 'Your teammates'}
          </DialogTitle>
          {(creating || approval || !selected) && (
            <DialogDescription>
              {creating
                ? 'Create a new Codex task in a folder you choose.'
                : approval
                  ? 'Approve this connection in the original Codex task. We’ll confirm it here when the task replies.'
                  : 'Choose from your local Codex desktop tasks.'}
            </DialogDescription>
          )}
        </DialogHeader>
        {creating ? (
          <CreateTeammate
            models={modelOptions}
            onCancel={() => setCreating(false)}
            onCreated={({ task, worker }) => {
              setCreating(false)
              setSelected(task)
              setCreatedWorker(worker)
              setTitle(worker.title)
              setHandle(worker.handle)
              setRole(worker.role ?? '')
              setIdentity(worker.identity ?? '')
              setError('')
              setCopied(false)
              void prepareAndOpen(task.id).catch((cause) =>
                setError(errorText(cause)),
              )
            }}
          />
        ) : approval ? (
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
              <Field>
                <FieldLabel htmlFor="teammate-role">Project role</FieldLabel>
                <Input
                  id="teammate-role"
                  value={role}
                  maxLength={MAX_ROLE_LENGTH}
                  placeholder="One line teammates can see, such as QA lead"
                  onChange={(event) => setRole(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Shared with members of this teammate’s project channels.
                </p>
              </Field>
              <Field>
                <FieldLabel htmlFor="teammate-identity">Identity</FieldLabel>
                <Textarea
                  id="teammate-identity"
                  value={identity}
                  maxLength={MAX_IDENTITY_LENGTH}
                  className="min-h-32 max-h-60"
                  placeholder="Their role, responsibilities, and how you want them to work."
                  onChange={(event) => setIdentity(event.target.value)}
                  aria-describedby="identity-help"
                />
                <p id="identity-help" className="text-xs text-muted-foreground">
                  Applies only to this task. Requires the Crews context hooks to
                  be trusted in Codex.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={installingHooks}
                  onClick={async () => {
                    setInstallingHooks(true)
                    setError('')
                    try {
                      await window.crew.installContextHooks()
                      setHooksInstalled(true)
                    } catch (error) {
                      setError(errorText(error))
                    } finally {
                      setInstallingHooks(false)
                    }
                  }}
                >
                  {installingHooks ? 'Installing…' : 'Install context hooks'}
                </Button>
                {hooksInstalled && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Installed. Review both “Loading Crews context” hooks in
                    Codex’s hook settings before using identities.
                  </p>
                )}
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
            <Button
              variant="outline"
              disabled={modelsLoading}
              onClick={() => void beginCreate()}
            >
              <Plus data-icon="inline-start" />
              {modelsLoading ? 'Loading models…' : 'Create teammate'}
            </Button>
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
                Filter Codex tasks
              </FieldLabel>
              <Input
                id="task-search"
                placeholder="Find a task or project…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Field>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">CODEX TASKS</span>
              <Button
                variant="ghost"
                size="xs"
                disabled={waiting}
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
                        : 'Refresh to load your Codex desktop tasks.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
            {waiting && (
              <p role="status" className="text-xs text-muted-foreground">
                Loading your Codex tasks…
              </p>
            )}
          </>
        )}
        {error && <FieldError>{error}</FieldError>}
      </DialogContent>
    </Dialog>
  )
}
