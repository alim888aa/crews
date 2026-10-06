import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchModelCatalog,
  validateServiceTierChoice,
} from '../backend/model-catalog.js'

const model = (name: string, hidden = false) => ({
  model: name,
  displayName: name.toUpperCase(),
  description: 'A model',
  hidden,
  supportedReasoningEfforts: [
    { reasoningEffort: 'medium' },
    { reasoningEffort: 'high' },
  ],
  defaultReasoningEffort: 'medium',
  isDefault: name === 'first',
  serviceTiers:
    name === 'first'
      ? [{ id: 'priority', name: 'Fast', description: 'Faster' }]
      : [],
})

test('visible model choices include every page and only supported efforts', async () => {
  const cursors: (string | null)[] = []
  const result = await fetchModelCatalog(async (_method, params) => {
    const cursor = (params as { cursor: string | null }).cursor
    cursors.push(cursor)
    return cursor === null
      ? { data: [model('first'), model('hidden', true)], nextCursor: 'more' }
      : { data: [model('second')], nextCursor: null }
  })
  assert.deepEqual(cursors, [null, 'more'])
  assert.equal(result[0]?.fastServiceTier, 'priority')
  assert.equal(result[1]?.fastServiceTier, null)
  validateServiceTierChoice(result, 'first', 'priority')
  validateServiceTierChoice(result, 'second', 'default')
  assert.throws(
    () => validateServiceTierChoice(result, 'second', 'priority'),
    /Fast mode is unavailable/,
  )
  assert.deepEqual(
    result.map(({ model, efforts, defaultEffort }) => ({
      model,
      efforts,
      defaultEffort,
    })),
    [
      { model: 'first', efforts: ['medium', 'high'], defaultEffort: 'medium' },
      { model: 'second', efforts: ['medium', 'high'], defaultEffort: 'medium' },
    ],
  )
})

test('bad model pagination cannot expose a partial picker', async () => {
  await assert.rejects(
    fetchModelCatalog(async () => ({
      data: [model('first')],
      nextCursor: 'same',
    })),
    /repeated a model cursor/,
  )
})
