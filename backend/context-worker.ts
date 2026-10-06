import type { SavedRoom } from '../shared/contracts.js'

/** Resolve either a Desktop teammate's task ID or a Crews-owned task ID. */
export function workerForTask(state: SavedRoom, taskId: string) {
  return state.workers.find(
    (worker) => worker.id === taskId || worker.managed?.threadId === taskId,
  )
}
