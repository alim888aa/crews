import type { Worker } from '@/store'

export function ConnectionLabel({ worker }: { worker: Worker }) {
  if (worker.connection === 'new') return <>Not connected</>
  if (worker.connection === 'awaiting') return <>Waiting for your approval</>
  if (worker.connection === 'approval') return <>Approval needed</>
  return (
    <>
      {
        {
          idle: 'Ready',
          working: 'Working…',
          queued: 'Queued',
          turn: 'Waiting for turn',
          unconfirmed: 'Waiting for task',
          attention: 'Needs attention',
        }[worker.presence]
      }
    </>
  )
}
