import { useState } from 'react'
import { ArrowUpRight, Link } from 'lucide-react'
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
        <ol className="flex flex-col gap-4">
          <li className="flex items-center gap-3">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm text-muted-foreground"
              aria-hidden="true"
            >
              1
            </span>
            <div>
              <p className="text-base font-medium">Connect Codex</p>
              <p className="text-sm text-muted-foreground">
                Select Luna · Medium in Codex, then send the setup message.
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm text-muted-foreground"
              aria-hidden="true"
            >
              2
            </span>
            <div>
              <p className="text-base font-medium">Add your agents</p>
              <p className="text-sm text-muted-foreground">
                Create a new task or choose an existing one, then connect it.
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm text-muted-foreground"
              aria-hidden="true"
            >
              3
            </span>
            <div>
              <p className="text-base font-medium">Start chatting</p>
              <p className="text-sm text-muted-foreground">
                @mention an agent, or use @all for everyone.
              </p>
            </div>
          </li>
        </ol>
        <Button onClick={() => void connect()} disabled={opening}>
          <Link data-icon="inline-start" />
          {opening
            ? 'Opening Codex…'
            : registered
              ? 'Resume setup'
              : opened
                ? 'Reopen setup'
                : 'Connect to Codex'}
          <ArrowUpRight data-icon="inline-end" />
        </Button>
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
