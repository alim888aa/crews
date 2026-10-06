import { useState } from 'react'
import { Archive, Plus, RotateCcw } from 'lucide-react'
import type { RoomState, Worker } from '../shared/contracts'
import { isOpenDelivery } from '../shared/contracts'
import { channelMemberIds } from '../shared/channels'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConnectionLabel } from '@/ConnectionLabel'

export function SidebarTeammates({
  room,
  channelId,
  onAdd,
  onProfile,
  onError,
}: {
  room: RoomState
  channelId: string
  onAdd: () => void
  onProfile: (id: string) => void
  onError: (error: string) => void
}) {
  const [firing, setFiring] = useState<Worker | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const members = new Set(channelMemberIds(room, channelId))
  const active = room.workers.filter((worker) => members.has(worker.id))
  const archived = room.workers.filter((worker) => worker.archivedAt)
  const pending = firing
    ? room.deliveries.some(
        (delivery) =>
          delivery.workerId === firing.id && isOpenDelivery(delivery),
      )
    : false

  async function fire() {
    if (!firing || pending || busy) return
    setBusy(true)
    try {
      await window.crew.archiveTeammate(firing.id)
      setFiring(null)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function restore(id: string) {
    if (busy) return
    setBusy(true)
    try {
      await window.crew.restoreTeammate(id)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mt-8 flex items-center justify-between px-4 text-xs text-muted-foreground">
        <span>TEAMMATES</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Archived teammates${archived.length ? ` (${archived.length})` : ''}`}
            onClick={() => setArchivedOpen(true)}
          >
            <Archive />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Add teammate"
            onClick={onAdd}
          >
            <Plus />
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1 px-2">
        {active.map((worker) => (
          <div key={worker.id} className="flex items-center gap-1">
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 items-start justify-start gap-2 px-2 py-3 text-left whitespace-normal"
              aria-label={'View profile for ' + worker.title}
              aria-haspopup="dialog"
              onClick={() => onProfile(worker.id)}
            >
              <Avatar>
                <AvatarFallback>{worker.initials}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  @{worker.handle}
                </span>
                <span
                  className="block truncate text-xs font-normal text-muted-foreground"
                  title={worker.title}
                >
                  {worker.title}
                </span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  <span
                    className={cn(
                      'presence-dot',
                      worker.connection === 'connected' && 'is-listening',
                    )}
                  />
                  <ConnectionLabel worker={worker} />
                  {worker.pending > 0 && ' · ' + worker.pending + ' pending'}
                </span>
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Fire @${worker.handle}`}
              title={`Fire @${worker.handle}`}
              onClick={() => setFiring(worker)}
            >
              <Archive />
            </Button>
          </div>
        ))}
      </div>
      {firing && (
        <Dialog open onOpenChange={(open) => !open && !busy && setFiring(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Fire @{firing.handle}?</DialogTitle>
              <DialogDescription>
                They’ll leave your sidebar, channels and mention list. Their old
                messages and Codex task stay. You can restore them later.
              </DialogDescription>
            </DialogHeader>
            {pending && (
              <p className="text-sm text-muted-foreground">
                Finish their pending replies before firing them.
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setFiring(null)}
              >
                Keep teammate
              </Button>
              <Button
                variant="destructive"
                disabled={busy || pending}
                onClick={() => void fire()}
              >
                {busy ? 'Firing…' : 'Fire teammate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={archivedOpen} onOpenChange={setArchivedOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archived teammates</DialogTitle>
            <DialogDescription>
              Restore someone to bring them back to your sidebar and channels.
            </DialogDescription>
          </DialogHeader>
          {archived.length ? (
            <div className="flex flex-col gap-2">
              {archived.map((worker) => (
                <div
                  key={worker.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span className="min-w-0 truncate text-sm">
                    @{worker.handle}
                    <span className="block truncate text-xs text-muted-foreground">
                      {worker.title}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void restore(worker.id)}
                  >
                    <RotateCcw data-icon="inline-start" /> Restore
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No archived teammates.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
