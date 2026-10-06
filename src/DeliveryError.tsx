import { useState } from 'react'
import {
  isManagedWriterConflict,
  isRelayRejection,
  type RoomState,
} from '../shared/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type FailedDelivery = RoomState['deliveries'][number]
type Teammate = RoomState['workers'][number]

export function DeliveryError({
  delivery,
  teammate,
  pendingCount,
  onReapprove,
  onError,
}: {
  delivery: FailedDelivery
  teammate: Teammate
  pendingCount: number
  onReapprove: () => void
  onError: (message: string) => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const relayRejected = isRelayRejection(delivery.failure, delivery.error)
  const openRelay =
    delivery.error?.startsWith('Codex rejected the dispatch') === true
  const writerLocked = isManagedWriterConflict(
    delivery.failure,
    delivery.error,
    teammate.managed?.threadId,
  )

  async function primaryAction() {
    setBusy(true)
    try {
      if (teammate.managed) await window.crew.retryManaged(delivery.id)
      else if (openRelay) await window.crew.openRelay()
      else if (delivery.failure === 'approval') onReapprove()
      else await window.crew.openTask(teammate.id)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function markHandled() {
    setBusy(true)
    try {
      await window.crew.resolveRejectedConversation({
        rootId: delivery.rootId,
        workerId: teammate.id,
      })
      setConfirmOpen(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alert" className="flex flex-col gap-2 px-5 py-2">
      <p className="text-sm text-destructive">
        @{teammate.handle} ·{' '}
        {writerLocked
          ? 'Codex Desktop still has this task open. Retry will continue the message in a named fork with its history.'
          : openRelay
            ? 'Codex blocked this delivery. It was not sent.'
            : delivery.error}
      </p>
      {openRelay && (
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer">Review reason</summary>
          <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
            {delivery.error}
          </p>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void primaryAction()}
        >
          {busy
            ? 'Working…'
            : teammate.managed
              ? 'Retry message'
              : openRelay
                ? 'Open relay task'
                : delivery.failure === 'approval'
                  ? 'Reapprove teammate'
                  : 'Open original task'}
        </Button>
        {relayRejected && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            Mark handled
          </Button>
        )}
      </div>
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !busy && setConfirmOpen(open)}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Mark @{teammate.handle} handled?</DialogTitle>
            <DialogDescription>
              {pendingCount} pending {pendingCount === 1 ? 'reply' : 'replies'}{' '}
              in this conversation will be closed without sending them. The chat
              messages stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              Keep waiting
            </Button>
            <Button disabled={busy} onClick={() => void markHandled()}>
              {busy ? 'Saving…' : 'Mark handled'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
