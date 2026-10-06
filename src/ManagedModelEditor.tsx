import { useState } from 'react'
import type {
  CodexModelOption,
  ManagedServiceTier,
  Worker,
} from '../shared/contracts'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'

function effortLabel(value: string) {
  return (
    { xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }[value] ??
    value[0]!.toUpperCase() + value.slice(1)
  )
}

export function ManagedModelEditor({
  worker,
  models,
  onCancel,
  onSaved,
}: {
  worker: Worker
  models: CodexModelOption[]
  onCancel: () => void
  onSaved: () => void
}) {
  const current = worker.managed!
  const initial = models.find((item) => item.model === current.model)
  const [model, setModel] = useState(current.model)
  const [effort, setEffort] = useState(
    initial?.efforts.includes(current.effort)
      ? current.effort
      : (initial?.defaultEffort ?? current.effort),
  )
  const [serviceTier, setServiceTier] = useState<ManagedServiceTier | ''>(
    current.serviceTier ?? '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = models.find((item) => item.model === model)

  async function save() {
    setSaving(true)
    setError('')
    try {
      await window.crew.setManagedModel({
        id: worker.id,
        model,
        effort,
        serviceTier: serviceTier || null,
      })
      onSaved()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : String(cause),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <Field>
        <FieldLabel htmlFor="teammate-model">Model</FieldLabel>
        <select
          id="teammate-model"
          value={model}
          disabled={saving}
          onChange={(event) => {
            const next = models.find(
              (item) => item.model === event.target.value,
            )
            if (!next) return
            setModel(next.model)
            setEffort(
              next.efforts.includes(effort) ? effort : next.defaultEffort,
            )
            if (serviceTier === 'priority' && !next.fastServiceTier)
              setServiceTier('default')
          }}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          {!selected && <option value={model}>Unavailable · {model}</option>}
          {models.map((item) => (
            <option key={item.model} value={item.model}>
              {item.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="teammate-effort">Reasoning effort</FieldLabel>
        <select
          id="teammate-effort"
          value={effort}
          disabled={saving}
          onChange={(event) => setEffort(event.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          {!selected && <option value={effort}>{effort}</option>}
          {selected?.efforts.map((value) => (
            <option key={value} value={value}>
              {effortLabel(value)}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="teammate-speed">Speed</FieldLabel>
        <select
          id="teammate-speed"
          value={serviceTier}
          disabled={saving}
          onChange={(event) =>
            setServiceTier(event.target.value as ManagedServiceTier | '')
          }
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="">Codex default</option>
          <option value="default">Standard</option>
          {selected?.fastServiceTier && (
            <option value="priority">Fast · higher usage</option>
          )}
          {serviceTier === 'priority' && !selected?.fastServiceTier && (
            <option value="priority" disabled>
              Fast · unavailable for this model
            </option>
          )}
        </select>
      </Field>
      <p className="text-xs text-muted-foreground">
        The next turn uses these settings in the same Codex chat. Fast uses more
        of your Codex allowance.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            saving ||
            !selected ||
            (serviceTier === 'priority' && !selected.fastServiceTier) ||
            (model === current.model &&
              effort === current.effort &&
              serviceTier === (current.serviceTier ?? ''))
          }
        >
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
