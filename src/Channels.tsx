import { useState } from 'react'
import { Hash, Plus, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  GENERAL_CHANNEL_ID,
  type Channel,
  type RoomState,
} from '../shared/contracts'

const cleanName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

function ChannelDialog({
  room,
  channel,
  onClose,
  onCreated,
}: {
  room: RoomState
  channel?: Channel
  onClose: () => void
  onCreated: (channel: Channel) => void
}) {
  const [name, setName] = useState(channel?.name ?? '')
  const [memberIds, setMemberIds] = useState(channel?.memberIds ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const normalizedName = cleanName(name)
  async function save() {
    if ((!channel && !normalizedName) || saving) return
    setSaving(true)
    try {
      if (channel)
        await window.crew.setChannelMembers({ id: channel.id, memberIds })
      else
        onCreated(
          await window.crew.createChannel({ name: normalizedName, memberIds }),
        )
      onClose()
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Something went wrong. Try again.'
      setError(message)
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {channel ? `Manage #${channel.name}` : 'New channel'}
          </DialogTitle>
          <DialogDescription>
            {channel
              ? 'Choose who gets messages sent to everyone in this channel.'
              : 'Give it a short name and choose its teammates.'}
          </DialogDescription>
        </DialogHeader>
        {!channel && (
          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="channel-name"
          >
            Name
            <Input
              id="channel-name"
              name="channel-name"
              autoFocus
              value={name}
              placeholder="project-name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <fieldset className="grid max-h-64 gap-2 overflow-y-auto">
          <legend className="mb-2 text-sm font-medium">Teammates</legend>
          {room.workers.map((worker) => (
            <label
              key={worker.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={memberIds.includes(worker.id)}
                onChange={(event) =>
                  setMemberIds(
                    event.target.checked
                      ? [...memberIds, worker.id]
                      : memberIds.filter((id) => id !== worker.id),
                  )
                }
              />
              <span>@{worker.handle}</span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || (!channel && !normalizedName)}
            onClick={() => void save()}
          >
            {channel ? 'Save members' : 'Create channel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
          <Button
            key={channel.id}
            variant={channel.id === selectedId ? 'secondary' : 'ghost'}
            className="w-full justify-start"
            aria-label={`Open #${channel.name}`}
            aria-current={channel.id === selectedId ? 'page' : undefined}
            onClick={() => onSelect(channel.id)}
          >
            <Hash data-icon="inline-start" /> {channel.name}
          </Button>
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
    </>
  )
}
