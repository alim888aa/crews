import { cn } from '@/lib/utils'
import { conversationActivity, messageActivity } from '../shared/activity'
import type { RoomState } from '../shared/contracts'

export function ConversationActivity({
  room,
  rootId,
  messageId,
  className,
}: {
  room: RoomState
  rootId?: string
  messageId?: string
  className?: string
}) {
  const activity = messageId
    ? messageActivity(room, messageId)
    : rootId
      ? conversationActivity(room, rootId)
      : []
  if (!activity.length) return null
  const labels = {
    working: 'working…',
    queued: 'queued',
    next: 'up next',
    approval: 'needs approval',
    attention: 'needs attention',
    paused: 'paused',
    sent: 'waiting to start…',
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap text-xs text-muted-foreground',
        className,
      )}
    >
      {activity.map((item) => (
        <span
          key={item.workerId}
          className="inline-flex shrink-0 items-center gap-1.5"
        >
          {item.state === 'working' && (
            <span aria-hidden className="activity-dots">
              <span />
              <span />
              <span />
            </span>
          )}
          <span>
            @{item.handle} {labels[item.state]}
          </span>
        </span>
      ))}
    </div>
  )
}
