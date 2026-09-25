import type { CodexModelOption } from '../shared/contracts.js'
import { withAppServer, type AppServerRequest } from './app-server.js'

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Codex app-server returned invalid ${label}.`)
  return value as Record<string, unknown>
}

/** Read the signed-in desktop account's visible models and their allowed efforts. */
export async function fetchModelCatalog(
  request: AppServerRequest,
): Promise<CodexModelOption[]> {
  const models = new Map<string, CodexModelOption>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  do {
    const page = record(
      await request('model/list', { cursor, limit: 100, includeHidden: false }),
      'model list',
    )
    if (!Array.isArray(page.data))
      throw new Error('Codex app-server returned a model list without data.')
    for (const value of page.data) {
      const model = record(value, 'model')
      if (model.hidden === true) continue
      if (
        typeof model.model !== 'string' ||
        !model.model ||
        typeof model.displayName !== 'string' ||
        !Array.isArray(model.supportedReasoningEfforts) ||
        typeof model.defaultReasoningEffort !== 'string'
      )
        throw new Error('Codex app-server returned invalid model details.')
      const efforts = model.supportedReasoningEfforts.map((option) => {
        const effort = record(option, 'model effort')
        if (
          typeof effort.reasoningEffort !== 'string' ||
          !effort.reasoningEffort
        )
          throw new Error('Codex app-server returned invalid model effort.')
        return effort.reasoningEffort
      })
      if (!efforts.includes(model.defaultReasoningEffort))
        throw new Error(
          'Codex app-server returned a model without its default effort.',
        )
      models.set(model.model, {
        model: model.model,
        displayName: model.displayName,
        description:
          typeof model.description === 'string' ? model.description : '',
        efforts: [...new Set(efforts)],
        defaultEffort: model.defaultReasoningEffort,
        isDefault: model.isDefault === true,
      })
    }
    if (page.nextCursor !== null && typeof page.nextCursor !== 'string')
      throw new Error('Codex app-server returned an invalid model cursor.')
    cursor = page.nextCursor as string | null
    if (cursor) {
      if (cursors.has(cursor))
        throw new Error('Codex app-server repeated a model cursor.')
      cursors.add(cursor)
    }
  } while (cursor)
  if (!models.size)
    throw new Error(
      'Codex did not return any available models for this account.',
    )
  return [...models.values()]
}

export async function loadModelCatalog(): Promise<CodexModelOption[]> {
  return withAppServer((client) => fetchModelCatalog(client.request))
}

export function validateModelChoice(
  models: CodexModelOption[],
  model: string,
  effort: string,
): void {
  const selected = models.find((item) => item.model === model)
  if (!selected) throw new Error('Choose an available Codex model.')
  if (!selected.efforts.includes(effort))
    throw new Error('Choose an effort supported by that model.')
}
