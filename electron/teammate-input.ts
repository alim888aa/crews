import type { TeammateInput } from '../shared/contracts.js'
import { object, string, uuid } from '../backend/storage.js'

/** Validate IPC types here; the room validates handle, role and identity rules. */
export function parseTeammateInput(value: unknown): TeammateInput {
  const input = object(value)
  return {
    id: uuid(input.id),
    title: string(input.title, 'name').trim(),
    handle: string(input.handle, '@name').trim().toLowerCase(),
    ...(input.identity === undefined
      ? {}
      : {
          identity:
            typeof input.identity === 'string'
              ? input.identity
              : string(input.identity, 'identity'),
        }),
    ...(input.role === undefined
      ? {}
      : {
          role:
            typeof input.role === 'string'
              ? input.role
              : string(input.role, 'role'),
        }),
  }
}
