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
} from '../shared/contracts'

type Draft = {
  title: string
  handle: string
  identity: string
  role: string
  cwd: string
  model: string
  effort: string
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
}: {
  models: CodexModelOption[]
  onCancel: () => void
  onCreated: (created: CreatedTeammate) => void
}) {
  const initial = models.find((item) => item.isDefault) ?? models[0]!
  const [title, setTitle] = useState('')
  const [handle, setHandle] = useState('')
  const [handleEdited, setHandleEdited] = useState(false)
  const [identity, setIdentity] = useState('')
  const [role, setRole] = useState('')
  const [cwd, setCwd] = useState('')
  const [model, setModel] = useState(initial.model)
  const [effort, setEffort] = useState(initial.defaultEffort)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
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
    setError('')
    const draft: Draft = { title, handle, identity, role, cwd, model, effort }
    try {
      const created = await window.crew.createTask(draft)
      onCreated(created)
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : String(cause)
      if (
        message.startsWith('Codex may have started') ||
        message.startsWith('Codex task ')
      )
        setUncertain(true)
      setError(message)
    } finally {
      setBusy(false)
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
              disabled={busy || uncertain}
            >
              <FolderOpen />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The Codex task runs in this folder.
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
            }}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
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
          <FieldLabel htmlFor="new-teammate-effort">
            Reasoning effort
          </FieldLabel>
          <select
            id="new-teammate-effort"
            value={effort}
            onChange={(event) => setEffort(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {selectedModel.efforts.map((option) => (
              <option key={option} value={option}>
                {effortLabel(option)}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-role">Project role</FieldLabel>
          <Input
            id="new-teammate-role"
            value={role}
            maxLength={MAX_ROLE_LENGTH}
            placeholder="One line teammates can see, such as QA lead"
            onChange={(event) => setRole(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-teammate-identity">Identity</FieldLabel>
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
        Crews will send one short first message so this task appears in Codex.
        The model and effort you chose will stay with that task.
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
        <Button type="submit" disabled={busy || uncertain}>
          {busy ? 'Creating in Codex…' : 'Create teammate'}
        </Button>
      </div>
    </form>
  )
}
