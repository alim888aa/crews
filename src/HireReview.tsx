import { useState } from 'react'
import type { CodexModelOption, HireRequest, Worker } from '../shared/contracts'
import { CreateTeammate } from '@/CreateTeammate'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function HireReview({
  request,
  requester,
  channelName,
  count,
}: {
  request: HireRequest
  requester?: Worker
  channelName: string
  count: number
}) {
  const [models, setModels] = useState<CodexModelOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [approving, setApproving] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  async function review() {
    setLoading(true)
    setError('')
    try {
      setModels(await window.crew.listModels())
      setEditing(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function decline() {
    setDeclining(true)
    setError('')
    try {
      await window.crew.declineHire(request.id)
      setDone(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDeclining(false)
    }
  }

  async function approve() {
    setApproving(true)
    setError('')
    try {
      await window.crew.approveHire({ id: request.id, draft: request.draft })
      setDone(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setApproving(false)
    }
  }

  if (done) return null
  return (
    <Alert className="fixed right-4 bottom-4 max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <AlertTitle>New hire requested</AlertTitle>
          <AlertDescription>
            @{requester?.handle ?? 'teammate'} wants to hire for #{channelName}.
          </AlertDescription>
        </div>
        {count > 1 && <Badge variant="secondary">1 of {count}</Badge>}
      </div>
      {editing && models ? (
        <div className="mt-4">
          <CreateTeammate
            key={request.id}
            request={request}
            channelName={channelName}
            models={models}
            onCancel={() => setEditing(false)}
            onCreated={() => setDone(true)}
          />
        </div>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Teammate</dt>
            <dd>
              {request.draft.title} · @{request.draft.handle}
            </dd>
            <dt className="text-muted-foreground">Channel</dt>
            <dd>
              #{channelName}
              {channelName !== 'general' && ' · also in #general'}
            </dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd>
              {request.draft.model} · {request.draft.effort} ·{' '}
              {request.draft.serviceTier === 'priority'
                ? 'Fast'
                : request.draft.serviceTier === 'default'
                  ? 'Standard'
                  : 'Codex default'}
            </dd>
            <dt className="text-muted-foreground">Permissions</dt>
            <dd>
              {request.draft.permission === 'full'
                ? 'Full access'
                : 'Approve for me'}
            </dd>
            <dt className="text-muted-foreground">Folder</dt>
            <dd className="min-w-0 break-all">{request.draft.cwd}</dd>
            <dt className="text-muted-foreground">Description</dt>
            <dd>{request.draft.role || 'None proposed'}</dd>
            <dt className="text-muted-foreground">Instructions</dt>
            <dd className="line-clamp-3 whitespace-pre-wrap">
              {request.draft.identity || 'None proposed'}
            </dd>
          </dl>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={loading || declining || approving}
              onClick={() => void decline()}
            >
              {declining ? 'Declining…' : 'Decline'}
            </Button>
            <Button
              variant="outline"
              disabled={loading || declining || approving}
              onClick={() => void review()}
            >
              {loading ? 'Loading models…' : 'Review & edit'}
            </Button>
            <Button
              disabled={loading || declining || approving}
              onClick={() => void approve()}
            >
              {approving ? 'Approving hire…' : 'Approve & hire'}
            </Button>
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </Alert>
  )
}
