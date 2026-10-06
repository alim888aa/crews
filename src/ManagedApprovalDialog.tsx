import { useState } from 'react'
import type { ManagedApproval } from '../shared/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function ManagedApprovalDialog({
  approval,
  handle,
  onError,
}: {
  approval: ManagedApproval
  handle: string
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  async function respond(decision: 'accept' | 'decline') {
    setBusy(true)
    try {
      await window.crew.answerManagedApproval({ id: approval.id, decision })
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{approval.summary}</DialogTitle>
          <DialogDescription>
            @{handle} needs your decision before continuing this message.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
          {approval.detail || 'Codex did not include more details.'}
        </pre>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void respond('decline')}
          >
            Decline
          </Button>
          <Button disabled={busy} onClick={() => void respond('accept')}>
            Allow once
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
