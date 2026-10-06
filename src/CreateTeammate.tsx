import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '@/components/ui/field'
import {
  MAX_IDENTITY_LENGTH,
  MAX_ROLE_LENGTH,
  type CodexModelOption,
  type CreatedTeammate,
  type HireRequest,
  type ManagedServiceTier,
  type TaskPermissionMode,
} from '../shared/contracts'

type Draft = {
  title: string
  handle: string
  identity: string
  role: string
  cwd: string
  model: string
  effort: string
  serviceTier?: ManagedServiceTier
  permission: TaskPermissionMode
}

function effortLabel(effort: string): string {
  return (
    { xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }[effort] ??
    effort[0]!.toUpperCase() + effort.slice(1)
  )
}

function handleFrom(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 32) || 'teammate'
  )
}

export function CreateTeammate({
  models,
  onCancel,
  onCreated,
  onBusyChange,
  request,
  channelName,
}: {
  models: CodexModelOption[]
  onCancel: () => void
  onCreated: (created: CreatedTeammate) => void
  onBusyChange?: (busy: boolean) => void
  request?: HireRequest
  channelName?: string
}) {
  const initial = models.find((item) => item.isDefault) ?? models[0]!
  const [title, setTitle] = useState(request?.draft.title ?? '')
  const [handle, setHandle] = useState(request?.draft.handle ?? '')
  const [handleEdited, setHandleEdited] = useState(!!request)
  const [identity, setIdentity] = useState(request?.draft.identity ?? '')
  const [role, setRole] = useState(request?.draft.role ?? '')
  const [cwd, setCwd] = useState(request?.draft.cwd ?? '')
  const [model, setModel] = useState(request?.draft.model ?? initial.model)
  const [effort, setEffort] = useState(
    request?.draft.effort ?? initial.defaultEffort,
  )
  const [serviceTier, setServiceTier] = useState<ManagedServiceTier | ''>(
    request?.draft.serviceTier ?? '',
  )
  const [permission, setPermission] = useState<TaskPermissionMode>(
    request?.draft.permission ?? 'full',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectedModel = models.find((item) => item.model === model) ?? initial

  async function chooseFolder() {
    setError('')
    try {
      const folder = await window.crew.pickTaskFolder()
      if (folder) setCwd(folder)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function create() {
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    const draft: Draft = {
      title,
      handle,
      identity,
      role,
      cwd,
      model,
      effort,
      ...(serviceTier && { serviceTier }),
      permission,
    }
    try {
      const created = request
        ? await window.crew.approveHire({ id: request.id, draft })
        : await window.crew.createTask(draft)
      onCreated(created)
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : String(cause)
      setError(message)
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="new-teammate-name">Name</FieldLabel>
          <Input
            id="new-teammate-name"
            value={title}
            maxLength={100}
            required
            onChange={(event) => {
              const name = event.target.value
              setTitle(name)
              if (!handleEdited) setHandle(handleFrom(name))
            }}
            placeholder="Your teammate's name"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-handle">@name</FieldLabel>
          <Input
            id="new-teammate-handle"
            value={handle}
            maxLength={32}
            required
            onChange={(event) => {
              setHandleEdited(true)
              setHandle(event.target.value.toLowerCase())
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-folder">Task folder</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="new-teammate-folder"
              value={cwd}
              required
              onChange={(event) => setCwd(event.target.value)}
              placeholder="Choose a folder on this Mac"
            />
            <Button
              type="button"
              variant="outline"
              aria-label="Browse folders"
              onClick={() => void chooseFolder()}
              disabled={busy}
            >
              <FolderOpen />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your teammate runs in this folder when you message them.
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-model">Model</FieldLabel>
          <select
            id="new-teammate-model"
            value={model}
            onChange={(event) => {
              const next = models.find(
                (item) => item.model === event.target.value,
              )
              if (!next) return
              setModel(next.model)
              setEffort(next.defaultEffort)
              if (serviceTier === 'priority' && !next.fastServiceTier)
                setServiceTier('default')
            }}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {!models.some((option) => option.model === model) && (
              <option value={model}>Unavailable · {model}</option>
            )}
            {models.map((option) => (
              <option key={option.model} value={option.model}>
                {option.displayName}
              </option>
            ))}
          </select>
          {selectedModel.description && (
            <p className="text-xs text-muted-foreground">
              {selectedModel.description}
            </p>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-speed">Speed</FieldLabel>
          <select
            id="new-teammate-speed"
            value={serviceTier}
            onChange={(event) =>
              setServiceTier(event.target.value as ManagedServiceTier | '')
            }
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="">Codex default</option>
            <option value="default">Standard</option>
            {selectedModel.fastServiceTier && (
              <option value="priority">Fast · higher usage</option>
            )}
          </select>
          <p className="text-xs text-muted-foreground">
            Fast uses more of your Codex allowance.
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-effort">
            Reasoning effort
          </FieldLabel>
          <select
            id="new-teammate-effort"
            value={effort}
            onChange={(event) => setEffort(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {!selectedModel.efforts.includes(effort) && (
              <option value={effort}>Unavailable · {effort}</option>
            )}
            {selectedModel.efforts.map((option) => (
              <option key={option} value={option}>
                {effortLabel(option)}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-permission">Permissions</FieldLabel>
          <select
            id="new-teammate-permission"
            value={permission}
            onChange={(event) =>
              setPermission(event.target.value as TaskPermissionMode)
            }
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="full">Full access</option>
            <option value="auto">Approve for me</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {permission === 'full'
              ? 'This task can access any file and the internet without asking.'
              : 'Codex reviews eligible requests automatically; some actions may still ask you.'}
          </p>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-role">Description</FieldLabel>
          <Input
            id="new-teammate-role"
            value={role}
            maxLength={MAX_ROLE_LENGTH}
            placeholder="One line teammates can see, such as QA lead"
            onChange={(event) => setRole(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-identity">Instructions</FieldLabel>
          <Textarea
            id="new-teammate-identity"
            value={identity}
            maxLength={MAX_IDENTITY_LENGTH}
            className="min-h-32 max-h-60"
            placeholder="Their role, responsibilities, and how you want them to work."
            onChange={(event) => setIdentity(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <p className="mt-4 text-xs text-muted-foreground">
        Crews starts their Codex session when you first message them. They’ll
        work here in Crews using the model and effort you choose.
        {request && channelName && (
          <span className="mt-1 block">
            Approval adds them to #{channelName}
            {channelName !== 'general' && ' and #general'}.
          </span>
        )}
      </p>
      {error && <FieldError className="mt-3">{error}</FieldError>}
      <div className="mt-5 flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Back
        </Button>
        <Button type="submit" disabled={busy}>
          {busy
            ? request
              ? 'Approving hire…'
              : 'Creating teammate…'
            : request
              ? 'Approve & hire'
              : 'Create teammate'}
        </Button>
      </div>
    </form>
  )
}
