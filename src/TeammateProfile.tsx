import { useState } from 'react'
import { ArrowUpRight, Pencil } from 'lucide-react'
import type { Worker } from '@/store'
import type { CodexModelOption } from '../shared/contracts'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConnectionLabel } from '@/ConnectionLabel'
import { ManagedModelEditor } from '@/ManagedModelEditor'

export function TeammateProfile({
  worker,
  onClose,
  onEdit,
}: {
  worker: Worker
  onClose: () => void
  onEdit: () => void
}) {
  const [models, setModels] = useState<CodexModelOption[] | null>(null)
  const [editingModel, setEditingModel] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState('')

  async function changeModel() {
    setLoadingModels(true)
    setModelError('')
    try {
      setModels(await window.crew.listModels())
      setEditingModel(true)
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingModels(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-4">
          <Avatar size="lg" className="size-14">
            <AvatarFallback className="text-lg">
              {worker.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="truncate text-lg">
              {worker.title}
            </DialogTitle>
            <DialogDescription>@{worker.handle}</DialogDescription>
          </div>
        </DialogHeader>
        <Badge variant="outline" className="w-fit">
          {worker.archivedAt ? 'Archived' : <ConnectionLabel worker={worker} />}
        </Badge>
        {worker.managed && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Model & speed
                </h3>
                <p className="text-sm">
                  {worker.managed.model} · {worker.managed.effort} ·{' '}
                  {worker.managed.serviceTier === 'priority'
                    ? 'Fast'
                    : worker.managed.serviceTier === 'default'
                      ? 'Standard'
                      : 'Codex default'}
                </p>
              </div>
              {!worker.archivedAt && !editingModel && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingModels}
                  onClick={() => void changeModel()}
                >
                  {loadingModels ? 'Loading…' : 'Change settings'}
                </Button>
              )}
            </div>
            {editingModel && models && (
              <ManagedModelEditor
                worker={worker}
                models={models}
                onCancel={() => setEditingModel(false)}
                onSaved={() => setEditingModel(false)}
              />
            )}
            {modelError && (
              <p className="text-sm text-destructive">{modelError}</p>
            )}
          </section>
        )}
        {!worker.managed && (
          <p className="text-xs text-muted-foreground">
            Change this teammate’s model in their Codex task.
          </p>
        )}
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </h3>
          <p className="text-sm leading-relaxed">
            {worker.role?.trim() || 'No description yet.'}
          </p>
        </section>
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Instructions
          </h3>
          <div className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
            {worker.identity?.trim() || 'No instructions yet.'}
          </div>
        </section>
        <p className="text-xs text-muted-foreground">
          @{worker.handle} can suggest and save changes to their own description
          and instructions.
        </p>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          {!worker.archivedAt && (
            <Button variant="outline" onClick={onEdit}>
              <Pencil data-icon="inline-start" /> Edit profile
            </Button>
          )}
          {!worker.managed && !worker.archivedAt && (
            <Button onClick={() => void window.crew.openTask(worker.id)}>
              Open Codex task <ArrowUpRight data-icon="inline-end" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
