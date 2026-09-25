import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { newRoom, validateTeammate } from '../backend/domain.js'
import { parseTeammateInput } from '../electron/teammate-input.js'

test('IPC teammate input accepts blank roles on add, edit and clear', () => {
  const id = randomUUID()
  const state = newRoom()
  const initial = parseTeammateInput({
    id,
    title: 'QA Lead',
    handle: 'QA',
    role: '',
    identity: '',
  })
  assert.equal(initial.role, '')
  state.workers.push(validateTeammate(state, initial))
  assert.equal(state.workers[0]!.role, '')

  const edited = parseTeammateInput({
    id,
    title: 'QA Lead',
    handle: 'qa',
    role: 'Checks releases',
    identity: '',
  })
  state.workers[0] = validateTeammate(state, edited)
  assert.equal(state.workers[0]!.role, 'Checks releases')

  const cleared = parseTeammateInput({
    id,
    title: 'QA Lead',
    handle: 'qa',
    role: '',
    identity: '',
  })
  state.workers[0] = validateTeammate(state, cleared)
  assert.equal(state.workers[0]!.role, '')
  assert.throws(() => parseTeammateInput({ ...cleared, role: 3 }))
})
