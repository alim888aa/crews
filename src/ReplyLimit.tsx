import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { errorText } from './Connections'

export function ReplyLimit({ value }: { value: number }) {
  const [draft, setDraft] = useState(String(value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const changed = draft !== String(value)

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (saving || !changed) return
        const next = Number(draft)
        if (!Number.isSafeInteger(next) || next < 1) {
          setError('Enter a whole number greater than zero.')
          return
        }
        setSaving(true)
        setError('')
        try {
          await window.crew.setReplyLimit(next)
        } catch (e) {
          setError(errorText(e))
        } finally {
          setSaving(false)
        }
      }}
    >
      <Field className="gap-2" data-invalid={!!error}>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="reply-limit">Reply limit</FieldLabel>
          <Input
            id="reply-limit"
            className="h-8 w-20"
            type="number"
            min={1}
            step={1}
            value={draft}
            disabled={saving}
            aria-invalid={!!error}
            aria-describedby={error ? 'reply-limit-error' : 'reply-limit-help'}
            onChange={(event) => {
              setDraft(event.target.value)
              setError('')
            }}
          />
        </div>
        <p id="reply-limit-help" className="text-xs text-muted-foreground">
          Per message, across all agents.
        </p>
        {error && <FieldError id="reply-limit-error">{error}</FieldError>}
        {changed && (
          <Button type="submit" variant="outline" size="sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save limit'}
          </Button>
        )}
      </Field>
    </form>
  )
}
