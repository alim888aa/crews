# Architecture

Crews keeps the existing Codex tasks. It does not import their histories into a separate Codex process or use private desktop databases or internal transport pipes.

```text
React renderer
    │ validated Electron IPC
    ▼
Room state + local event folders
    ▲                       │ durable claims
    │ accepted replies      ▼
Bundled helper ◄──── Native Codex relay task
    ▲                       │ native task messaging
    └──── Existing Codex tasks
```

## Modules

`src/` owns the interface, drafts and conversation views. `shared/contracts.ts` defines the renderer/backend contract. `shared/activity.ts` and `shared/deliveries.ts` associate activity and addressed messages with the correct delivery.

`backend/domain.ts` owns routing and teammate rules. `backend/room.ts` is the single writer of saved room state. External helpers publish validated event files; the app accepts them or records a rejection. State commits are atomic.

`backend/relay.ts` owns frozen dispatch claims and receipts. `backend/relay-turn.ts` is compiled into the dispatcher the native relay evaluates. It forwards exact prompt strings through Codex tools and never authors worker replies.

`backend/cli.ts` implements the helper commands. `backend/delivery-runtime.ts` uses Effect for receipt waiting, polling, timeouts and scoped listener cleanup. Publication happens once before receipt polling. Timeout and interruption do not republish an event. `backend/errors.ts` keeps validation, rejected events, storage failures, busy listeners and unexpected operations distinct.

`backend/runtime.ts` installs the helpers and generates guides with the current machine's paths. `backend/prompts.ts` produces direct connection approvals. `backend/compaction-hook.ts` restores context only for the exact task's one acknowledged active delivery, excluding held failures and newer queued requests.

`electron/` owns native integration, sandboxed preload and image validation. Only the main process opens approved link types after a user click. The renderer has no Node access, and message HTML is not executed.

## Delivery lifecycle

A user message creates a delivery per recipient. Ordered rounds hold later speakers until earlier replies arrive. Simultaneous rounds allow different tasks to start independently.

The dispatcher writes a claim before sending. That claim freezes the exact prompt and prevents automatic replay after interruption. A native send receipt does not mean the worker started; the worker's `take` acknowledgement records that separately. Only an accepted room reply completes the delivery.

A confirmed task failure leaves the claim and visible error intact but releases the worker for a newer unclaimed request. Uncertain sends, approval failures and storage failures remain held. A late, explicitly recovered reply may still complete a failed delivery without replaying its original send.

Each task has at most one active claimed room request. This is separate from work the user sends directly in Codex. The app does not currently provide an explicit steer-now control or a token stream.

## Boundaries

No database server or hosted Crews service is required. The native relay and worker model turns still consume Codex usage and depend on its account capabilities.

The relay cannot supply fresh user permission to another task. Connecting and reapproving must happen through direct user submissions in Codex. Files shared under one local account are not an isolation boundary against malicious processes or tasks.

Generated JavaScript lives in ignored build directories. Maintained app code, scripts and tests are TypeScript.
