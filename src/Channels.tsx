import { useState, useSyncExternalStore } from 'react'
import { Hash, Plus, Settings, Trash2 } from 'lucide-react'
import {
  channelHasDraftWork,
  deleteChannel,
  getDraftOperations,
  subscribeDrafts,
} from './store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChannelDialog } from './ChannelDialog'
import {
  GENERAL_CHANNEL_ID,
  isOpenDelivery,
  type Channel,
  type RoomState,
} from '../shared/contracts'

export function Channels({
  room,
  selectedId,
  onSelect,
}: {
  room: RoomState
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [dialog, setDialog] = useState<'new' | string | null>(null)
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const [savingDelete, setSavingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  useSyncExternalStore(subscribeDrafts, getDraftOperations)
  const busy = (id: string) =>
    channelHasDraftWork(id) ||
    room.deliveries.some(
      (d) =>
        isOpenDelivery(d) &&
        room.messages.some((m) => m.id === d.rootId && m.channelId === id),
    )
  async function confirmDelete() {
    if (!deleting || savingDelete) return
    if (busy(deleting.id)) {
      setDeleteError(
        'Finish this channel’s pending replies, sends or uploads first.',
      )
      return
    }
    setSavingDelete(true)
    setDeleteError('')
    try {
      await deleteChannel(deleting.id)
      if (selectedId === deleting.id) onSelect(GENERAL_CHANNEL_ID)
      setDeleting(null)
    } catch (cause) {
      setDeleteError(
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Could not delete the channel.',
      )
    } finally {
      setSavingDelete(false)
    }
  }
  const selected = room.channels.find((channel) => channel.id === selectedId)
  return (
    <>
      <div className="flex items-center justify-between px-4 text-xs text-muted-foreground">
        <span>CHANNELS</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New channel"
          onClick={() => setDialog('new')}
        >
          <Plus />
        </Button>
      </div>
      <nav className="mt-2 flex flex-col gap-1 px-2" aria-label="Channels">
        {room.channels.map((channel) => (
          <div key={channel.id} className="flex items-center gap-1">
            <Button
              variant={channel.id === selectedId ? 'secondary' : 'ghost'}
              className="min-w-0 flex-1 justify-start"
              aria-label={`Open #${channel.name}`}
              aria-current={channel.id === selectedId ? 'page' : undefined}
              onClick={() => onSelect(channel.id)}
            >
              <Hash data-icon="inline-start" /> {channel.name}
            </Button>
            {channel.id !== GENERAL_CHANNEL_ID && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete #${channel.name}`}
                disabled={savingDelete || busy(channel.id)}
                onClick={() => {
                  setDeleteError('')
                  setDeleting(channel)
                }}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </nav>
      {selected && selected.id !== GENERAL_CHANNEL_ID && (
        <Button
          variant="ghost"
          size="sm"
          className="mx-2 mt-1 justify-start"
          aria-label="Manage channel members"
          onClick={() => setDialog(selected.id)}
        >
          <Settings data-icon="inline-start" /> Manage members
        </Button>
      )}
      {dialog && (
        <ChannelDialog
          key={dialog}
          room={room}
          channel={
            dialog === 'new'
              ? undefined
              : room.channels.find((item) => item.id === dialog)
          }
          onClose={() => setDialog(null)}
          onCreated={(channel) => onSelect(channel.id)}
        />
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !savingDelete) setDeleting(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete #{deleting.name}?</DialogTitle>
              <DialogDescription>
                This deletes this channel’s conversations, images and drafts.
                This cannot be undone in Crews. Your Codex tasks and other
                channels will remain.
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <p role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
            )}
            {busy(deleting.id) && !savingDelete && (
              <p className="text-sm text-muted-foreground">
                Finish this channel’s pending replies, sends or uploads first.
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={savingDelete}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={savingDelete || busy(deleting.id)}
                onClick={() => void confirmDelete()}
              >
                Delete channel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
