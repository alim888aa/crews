import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { RoomState } from '../shared/contracts'

const time = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)

export function Mentions({
  room,
  onOpen,
}: {
  room: RoomState
  onOpen: (messageId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const mentions = room.mentions
    .flatMap((mention) => {
      const message = room.messages.find(
        (item) => item.id === mention.messageId,
      )
      if (!message) return []
      const worker = room.workers.find((item) => item.id === message.authorId)
      const channel = room.channels.find(
        (item) => item.id === message.channelId,
      )
      return [{ mention, message, worker, channel }]
    })
    .sort((a, b) => b.message.createdAt - a.message.createdAt)
  const unread = mentions.filter(
    ({ mention }) => mention.readAt === undefined,
  ).length

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Mentions${unread ? `, ${unread} unread` : ''}`}
          />
        }
      >
        <Bell data-icon="inline-start" />
        Mentions
        {unread > 0 && <Badge variant="secondary">{unread}</Badge>}
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Mentions</SheetTitle>
          <SheetDescription>
            When a teammate tags @you, it shows up here.
          </SheetDescription>
        </SheetHeader>
        {mentions.length ? (
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-4 pb-4">
            {mentions.map(({ mention, message, worker, channel }) => (
              <Button
                key={message.id}
                variant="outline"
                className="h-auto w-full flex-col items-start gap-2 py-3 text-left whitespace-normal"
                onClick={() => {
                  onOpen(message.id)
                  setOpen(false)
                }}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="font-semibold">
                    @{worker?.handle ?? 'teammate'}
                  </span>
                  {mention.readAt === undefined && (
                    <Badge variant="secondary">New</Badge>
                  )}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {time(message.createdAt)}
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  #{channel?.name ?? 'general'}
                </span>
                <span className="line-clamp-3 text-sm font-normal">
                  {message.text}
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bell />
              </EmptyMedia>
              <EmptyTitle>No mentions yet</EmptyTitle>
              <EmptyDescription>
                Teammates can tag @you when they need you.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </SheetContent>
    </Sheet>
  )
}
