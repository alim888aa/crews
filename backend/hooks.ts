import { invalidRequest } from './errors.js'
import path from 'node:path'
import { atomicWrite, object, optionalJSON } from './storage.js'
import { quote, shellCommand } from './paths.js'

export function installContextHooks(
  file: string,
  runtime: string,
  executable: string[],
) {
  const script = path.join(runtime, 'context-hook.mjs')
  const command = shellCommand([...executable, script])
  const document = object(optionalJSON(file) ?? {})
  const hooks = { ...object(document.hooks ?? {}) }
  const ownedScripts = [script, path.join(runtime, 'compaction-hook.mjs')]
  for (const event of ['SessionStart', 'UserPromptSubmit']) {
    const groups = hooks[event] ?? []
    if (!Array.isArray(groups))
      throw invalidRequest(`Invalid ${event} hook configuration.`)
    const next: Record<string, unknown>[] = groups.flatMap((value: unknown) => {
      const group = object(value)
      if (!Array.isArray(group.hooks))
        throw invalidRequest('Invalid hook matcher group.')
      const remaining = group.hooks.filter((value: unknown) => {
        const entry = object(value)
        return !(
          entry.type === 'command' &&
          typeof entry.command === 'string' &&
          ownedScripts.some((owned) =>
            (entry.command as string).endsWith(' ' + quote(owned)),
          )
        )
      })
      return remaining.length ? [{ ...group, hooks: remaining }] : []
    })
    next.push({
      ...(event === 'SessionStart'
        ? { matcher: '^(startup|resume|clear|compact)$' }
        : {}),
      hooks: [
        {
          type: 'command',
          command,
          timeout: 5,
          statusMessage: 'Loading Crews context',
          additionalContextLimit: 8000,
        },
      ],
    })
    hooks[event] = next
  }
  const updated = { ...document, hooks }
  if (JSON.stringify(document) !== JSON.stringify(updated))
    atomicWrite(file, updated)
  // The user must review the exact definitions in Codex. Never grant trust here.
  return { file, command }
}
