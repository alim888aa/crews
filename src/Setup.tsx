import { useState } from 'react'
import { ArrowUpRight, Link, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Empty,
  EmptyHeader,
  EmptyContent,
  EmptyTitle,
} from '@/components/ui/empty'
import type { RoomState } from '@/store'

const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(e)

export function Setup({
  state,
  onAddTeammate,
}: {
  state: RoomState
  onAddTeammate: () => void
}) {
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
    <Empty
      className="min-h-full items-start gap-8 px-10 py-10 text-left"
      aria-label="Connect Crews"
    >
      <EmptyHeader className="items-start">
        <EmptyTitle className="text-4xl font-semibold tracking-tight">
          Set up Crews
        </EmptyTitle>
      </EmptyHeader>
      <EmptyContent className="max-w-xl items-start gap-8">
        <div className="space-y-3 rounded-lg border p-5">
          <p className="font-medium">Create a teammate in Crews</p>
          <p className="text-sm text-muted-foreground">
            Pick their folder, model and permissions. Their Codex conversation
            starts when you first message them here.
          </p>
          <Button onClick={onAddTeammate}>
            <Plus data-icon="inline-start" /> Add teammate
          </Button>
        </div>
        <div className="space-y-3 rounded-lg border p-5">
          <p className="font-medium">Bring in existing Desktop tasks</p>
          <p className="text-sm text-muted-foreground">
            Connect the relay once, then choose the Codex tasks you already use.
          </p>
          <Button variant="outline" onClick={() => void connect()} disabled={opening}>
            <Link data-icon="inline-start" />
            {opening
              ? 'Opening Codex…'
              : registered
                ? 'Resume setup'
                : opened
                  ? 'Reopen setup'
                  : 'Connect Desktop tasks'}
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
        {(opened || registered) && (
          <p role="status" className="text-muted-foreground">
            {registered
              ? 'Paste the copied message in Codex and press Send.'
              : 'Select Luna · Medium, then press Send in Codex.'}
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </EmptyContent>
    </Empty>
  )
}
