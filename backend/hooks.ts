import { invalidRequest } from './errors.js'
import path from 'node:path'
import { atomicWrite, object, optionalJSON } from './storage.js'
import { quote, shellCommand } from './paths.js'

export function installCompactionHook(
  file: string,
  runtime: string,
  executable: string[],
) {
  const script = path.join(runtime, 'compaction-hook.mjs')
  const command = shellCommand([...executable, script])
  const document = object(optionalJSON(file) ?? {})
  const hooks = object(document.hooks ?? {})
  const groups = hooks.SessionStart ?? []
  if (!Array.isArray(groups))
    throw invalidRequest('Invalid SessionStart hook configuration.')
  const handler = {
    type: 'command',
    command,
    timeout: 5,
    statusMessage: 'Restoring Crews request',
    additionalContextLimit: 5000,
  }
  // Preserve every unrelated handler, including ones sharing a matcher group.
  const next: Record<string, unknown>[] = groups.flatMap((value: unknown) => {
    const group = object(value)
    if (!Array.isArray(group.hooks))
      throw invalidRequest('Invalid hook matcher group.')
    const remaining = group.hooks.filter((value: unknown) => {
      const entry = object(value)
      return !(
        entry.type === 'command' &&
        typeof entry.command === 'string' &&
        entry.command.endsWith(' ' + quote(script))
      )
    })
    return remaining.length ? [{ ...group, hooks: remaining }] : []
  })
  next.push({ matcher: '^compact$', hooks: [handler] })
  const updated = { ...document, hooks: { ...hooks, SessionStart: next } }
  if (JSON.stringify(document) !== JSON.stringify(updated))
    atomicWrite(file, updated)
  // Installation never grants hook trust. Codex's normal review still applies.
  return { file, command }
}
