import { useState } from 'react'
import { Plus } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { CreateTeammate } from '@/CreateTeammate'
import type {
  Channel,
  CodexModelOption,
  CreatedTeammate,
  RoomState,
} from '../shared/contracts'

const cleanName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

export function ChannelDialog({
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
  const [memberIds, setMemberIds] = useState(
    channel?.memberIds.filter((id) =>
      room.workers.some((worker) => worker.id === id && !worker.archivedAt),
    ) ?? [],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [creatingTeammate, setCreatingTeammate] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [models, setModels] = useState<CodexModelOption[]>([])
  const [newTeammates, setNewTeammates] = useState<CreatedTeammate[]>([])
  const normalizedName = cleanName(name)
  const workers = [
    ...room.workers.filter((worker) => !worker.archivedAt),
    ...newTeammates
      .map(({ worker }) => worker)
      .filter((worker) => !room.workers.some((item) => item.id === worker.id)),
  ]
  async function beginCreateTeammate() {
    setLoadingModels(true)
    setError('')
    try {
      setModels(await window.crew.listModels())
      setCreatingTeammate(true)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load Codex models.',
      )
    } finally {
      setLoadingModels(false)
    }
  }
  async function save() {
    if ((!channel && !normalizedName) || saving) return
    setSaving(true)
    try {
      if (channel)
        await window.crew.setChannelMembers({
          id: channel.id,
          memberIds: [
            ...memberIds,
            // Saving visible choices must not silently fire archived members
            // from a project they can rejoin after Restore.
            ...channel.memberIds.filter((id) =>
              room.workers.some(
                (worker) => worker.id === id && worker.archivedAt,
              ),
            ),
          ],
        })
      else {
        const created = await window.crew.createChannel({
          name: normalizedName,
          memberIds,
        })
        onCreated(created)
        onClose()
      }
      if (channel) onClose()
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              '',
            )
          : 'Something went wrong. Try again.'
      setError(message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving && !creatingTask) onClose()
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!saving && !creatingTask}
      >
        <DialogHeader>
          <DialogTitle>
            {creatingTeammate
              ? 'Create teammate'
              : channel
                ? `Manage #${channel.name}`
                : 'New channel'}
          </DialogTitle>
          <DialogDescription>
            {creatingTeammate
              ? 'Create a teammate who works in Crews using Codex.'
              : channel
                ? 'Choose who gets messages sent to everyone in this channel.'
                : 'Give it a short name and choose its teammates.'}
          </DialogDescription>
        </DialogHeader>
        {creatingTeammate ? (
          <CreateTeammate
            models={models}
            onCancel={() => setCreatingTeammate(false)}
            onBusyChange={setCreatingTask}
            onCreated={(created) => {
              setNewTeammates((current) => [...current, created])
              setMemberIds((current) => [...current, created.worker.id])
              setCreatingTeammate(false)
            }}
          />
        ) : (
          <>
            {!channel && (
              <Field>
                <FieldLabel htmlFor="channel-name">Name</FieldLabel>
                <Input
                  id="channel-name"
                  name="channel-name"
                  autoFocus
                  disabled={saving}
                  value={name}
                  placeholder="project-name"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            )}
            <FieldSet className="gap-2">
              <div className="flex items-center justify-between gap-3">
                <FieldLegend variant="label" className="mb-0">
                  Teammates
                </FieldLegend>
                <Badge variant="secondary">{memberIds.length} selected</Badge>
              </div>
              <FieldGroup className="max-h-56 gap-0 overflow-y-auto rounded-lg border">
                {workers.map((worker) => (
                  <Field
                    key={worker.id}
                    orientation="horizontal"
                    className="gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
                  >
                    <Checkbox
                      id={`channel-member-${worker.id}`}
                      disabled={saving}
                      checked={memberIds.includes(worker.id)}
                      onCheckedChange={(checked) =>
                        setMemberIds((current) =>
                          checked
                            ? [...current, worker.id]
                            : current.filter((id) => id !== worker.id),
                        )
                      }
                    />
                    <Avatar size="sm">
                      <AvatarFallback>{worker.initials}</AvatarFallback>
                    </Avatar>
                    <FieldLabel
                      htmlFor={`channel-member-${worker.id}`}
                      className="min-w-0 cursor-pointer"
                    >
                      <span className="truncate">@{worker.handle}</span>
                    </FieldLabel>
                    {newTeammates.some(
                      ({ worker: newWorker }) => newWorker.id === worker.id,
                    ) && <Badge variant="outline">New</Badge>}
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
            {!channel && (
              <Field className="gap-2">
                <Button
                  variant="outline"
                  disabled={loadingModels || saving}
                  onClick={() => void beginCreateTeammate()}
                >
                  <Plus data-icon="inline-start" />
                  {loadingModels ? 'Loading models…' : 'Create teammate'}
                </Button>
                <FieldDescription>
                  They’ll start working when you message them. They’ll still
                  appear in #general if you cancel this channel.
                </FieldDescription>
              </Field>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={saving || (!channel && !normalizedName)}
                onClick={() => void save()}
              >
                {channel ? 'Save members' : 'Create channel'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
