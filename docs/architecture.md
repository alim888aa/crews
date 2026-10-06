# Architecture

Crews keeps existing Codex desktop tasks and can create its own Codex teammates. Both use the user's normal Codex login and supported app-server API. Crews never imports desktop histories or uses private desktop databases or internal transport pipes.

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

Room state ──── Crews-owned app-server turns
```

## Modules

`src/` owns the interface, drafts and conversation views. `shared/contracts.ts` defines the renderer/backend contract. `shared/activity.ts` and `shared/deliveries.ts` associate activity and addressed messages with the correct delivery.

`backend/domain.ts` owns routing and teammate rules. `backend/room.ts` is the single writer of saved room state. External helpers publish validated event files; the app accepts them or records a rejection. State commits are atomic.

Channels hold names and teammate IDs. `#general` dynamically includes every teammate. Messages carry their channel ID, while deliveries continue to reference their original message and conversation through the existing queue. Legacy saved messages default to `#general`. `shared/channels.ts` supplies channel membership and conversation participants for both recipient selection and the renderer. Conversation participants are derived from message recipients, so inviting a guest needs no separate membership record and does not change an ordered round's original recipients.

The sidebar teammate list follows the selected channel's membership. `#general` shows all active teammates; other channels show only their members. The archived teammate manager remains room-wide so a teammate can be restored regardless of the selected channel.

Firing a teammate sets `archivedAt` on the saved teammate after all their deliveries settle. Archived teammates remain in state so historical messages retain their author, but disappear from the active sidebar, channel routing, mention choices and project rosters. Their Codex task is untouched. The Archived teammates dialog restores them and their previous channel memberships. An archived task cannot connect, update its Crews profile, or publish replies until restored.

Agent replies and progress can tag the human with `@you`. An accepted new tag adds one saved mention linked to its message; it does not create a teammate delivery. The Electron main process shows a native notification for that new accepted tag, and the renderer keeps it unread until its conversation is opened from Mentions. Older saved rooms start with an empty mention inbox, and deleting a channel removes its linked mentions.

The new-channel dialog reuses Create teammate without discarding the channel draft. Each created teammate is selected for that channel and is ready after the channel saves. Cancelling the channel leaves already created teammates in dynamic `#general` membership.

Each teammate has a short editable project role separate from its identity brief. `backend/roster.ts` derives a task's rosters from current channel membership. The context hook refreshes those rosters on lifecycle events and when they change, and withdraws previously emitted rosters while a task is disconnected. Each delivery `take` gives a channel member the current roster for that project's conversation; guests receive no project roster. A member may address another current member through the existing reply queue even if that person has not spoken in the conversation. Guests can address only existing conversation participants. Peer messages still grant no permission.

`backend/relay.ts` owns frozen dispatch claims and receipts. `backend/relay-turn.ts` is compiled into the dispatcher the native relay evaluates. It forwards exact prompt strings through Codex tools and never authors worker replies.

`backend/cli.ts` implements the helper commands. `backend/delivery-runtime.ts` uses Effect for receipt waiting, polling, timeouts and scoped listener cleanup. Publication happens once before receipt polling. Timeout and interruption do not republish an event. `backend/errors.ts` keeps validation, rejected events, storage failures, busy listeners and unexpected operations distinct.

`backend/runtime.ts` installs the helpers and generates guides with the current machine's paths. `backend/prompts.ts` produces direct connection approvals. `backend/compaction-hook.ts` restores context only for the exact task's one acknowledged active delivery, excluding held failures and newer queued requests.

`electron/` owns native integration, sandboxed preload and image validation. Only the main process opens approved link types after a user click. The renderer has no Node access, and message HTML is not executed.

## Task picker

The Electron main process reads the complete non-archived desktop task catalog through the supported local Codex app-server thread/list API, following pagination and closing the process after refresh. It does not start model turns, read private databases directly, or require the relay. Failed refreshes preserve the previous catalog. The relay setup helper uses the same reader when it needs an initial catalog.

Create teammate reads the signed-in account's visible models and supported reasoning efforts from app-server. It validates the chosen folder, model, effort and permission profile, then saves a Crews-owned teammate in `#general`. It spends no model turn during creation. The first addressed room message starts a persistent Codex app-server session and its real first turn. Crews saves the returned session ID before starting that turn and resumes it for later messages. The new teammate never needs a Desktop connection message. Existing desktop teammates retain their exact-task connection and relay flow. A claim freezes each managed delivery before sending, and an uncertain result is never replayed automatically.

A Crews-owned teammate's profile can change its model and reasoning effort. The picker reads the installed Codex app's current visible model catalog, validates the pair again in Electron, and saves it on the same teammate without replacing its Codex session or permission mode. A running turn keeps the settings it started with; the next turn reads the saved pair. Desktop-connected teammates continue to use their Codex task's own model setting. Crews prefers the Codex CLI bundled with the installed ChatGPT app so the picker and managed turns see the same current models.

Crews-owned teammates may also choose Codex default, Standard, or Fast speed. Existing saved teammates and older hire requests omit the setting and keep inheriting their Codex thread's tier, which may come from Codex configuration. An explicit Standard or Fast choice is saved per teammate and sent with each new Crews turn as `serviceTierForTurn`, leaving the persistent Codex chat intact. The model catalog advertises Fast support; Electron validates it when a teammate is created, hired, or edited. Codex still decides whether the signed-in account can use the tier on an actual turn. Desktop-connected teammates retain their Codex task's speed setting.

Connected teammates can propose another teammate through the bundled `hire` helper, naming the conversation root from `take`. The helper requires the caller's exact Codex task ID; the room checks that the caller participates in that conversation and either belongs to its channel or was invited there by a user-authored message. The pending hire is bound to that channel, so the requester cannot quietly move it elsewhere. The renderer shows one sticky in-page review card at a time with the channel and proposed fields. The user can edit the name, handle, description, instructions, folder, model, effort and permission in the same card, then approve or decline. Approval revalidates the final model and settings and atomically creates a Crews-owned teammate in the requested channel and dynamic `#general`; it does not invite the hire into a conversation. The request remains pending if validation fails. Decline records the decision without creating a task. The requester can check the decision with `hire-status`. Neither request nor approval starts a model turn; the approved teammate's first addressed message creates its Codex chat through the normal managed-worker path. A channel with pending hire requests cannot be deleted until they are resolved.

The same connected teammate can use `conversation-start` to publish a new root conversation in a channel they belong to or were personally invited into by the user. A user-authored message records guest recipients only when they were outside the channel at send time; an old message sent to a member cannot become a guest grant after member removal. Removing a member also withdraws any earlier guest grant, and a fresh user invitation can grant access again. `conversation-post` adds a message and invites channel members or existing conversation participants into a conversation the sender participates in. Both helpers require the caller's exact Codex task ID and a valid room event token. A peer invitation by itself does not grant channel-wide recruiting or conversation-start rights. An agent-authored root uses the existing message and delivery lifecycle, so invited teammates receive a normal claimed delivery and the human sees the conversation in its channel. No extra human approval is required for these conversation messages; hiring still requires approval.

## Delivery lifecycle

A user message creates a delivery per recipient. Ordered rounds hold later speakers until earlier replies arrive. Simultaneous rounds allow different tasks to start independently.

An agent tag in a simultaneous round joins an undispatched queued delivery for the same teammate and round without consuming another reply-limit slot. If the first delivery has already been claimed but not taken, extra queued peer deliveries fold in at the first take. When the reply limit is already full, a tag can still join that claimed delivery before take; it is not falsely marked paused. The take response lists each addressed message and still includes the full conversation. New human requests, ordered handoffs and tags arriving after the take remain separate. Each folded delivery is saved as resolved with a link to the turn that covered it, so a restart does not recreate it. Explicit retry records that a delivery was previously claimed before removing its claim file; neither a retried delivery nor a previously dispatched sibling can be silently folded into another turn.

The dispatcher writes a claim before sending. That claim freezes the exact prompt and prevents automatic replay after interruption. A native send receipt does not mean the worker started; the worker's `take` acknowledgement records that separately. Only an accepted room reply completes the delivery.

A confirmed task failure leaves the claim and visible error intact but releases the worker for a newer unclaimed request. Uncertain sends, approval failures and storage failures remain held. A late, explicitly recovered reply may still complete a failed delivery without replaying its original send.

Each teammate has at most one active claimed room request. Crews-owned turns run only while the app is open. On restart an unfinished claim is shown as uncertain, and the user can explicitly retry it after checking what already happened. If Codex Desktop still owns the original task's writer, that Retry requires a settled saved turn, forks the history through that turn, verifies the same permission profile, names the fork, and switches only that teammate before releasing the held delivery. A recovery record retains the fork ID across app restarts and failed permission or naming steps, so the next Retry uses that same fork. If Codex never confirms a fork ID, Crews holds the delivery for review rather than blindly making another fork. The original task remains intact. The app does not currently provide an explicit steer-now control or a token stream.

## Boundaries

No database server or hosted Crews service is required. The native relay and worker model turns still consume Codex usage and depend on its account capabilities.

The relay cannot supply fresh user permission to another desktop task. Connecting and reapproving desktop tasks must happen through direct user submissions in Codex. Crews-owned teammates use the permission selected during creation. Files shared under one local account are not an isolation boundary against malicious processes or tasks.

Generated JavaScript lives in ignored build directories. Maintained app code, scripts and tests are TypeScript.

## Teammate identity

The optional `Teammate.identity` can be edited in the app, or by that teammate through the `profile-set` helper. The helper checks `CODEX_THREAD_ID` against the desktop task ID or the Crews-owned session ID, accepts only description and instructions, and posts a validated room event through the single writer. It cannot change name, handle or connection. Teammates may suggest and save edits to their own fields immediately. Peer messages grant no authority for other actions. A profile event returns `accepted:true` only after the app commits it. `backend/identity.ts` owns loading the brief and its per-task emitted-context hash under `data/identities/`. The hash is a deduplication checkpoint, not proof that the model followed the brief. A missing or damaged checkpoint causes reinjection.

Both `SessionStart` and `UserPromptSubmit` call the same `context-hook.mjs` entrypoint. It validates the exact root task ID and ignores subagents. Session starts, resumes, clears and compactions restore the identity; ordinary prompts emit only a changed identity or a removal notice. A connected task can retain its role while chatting directly in Codex or while room delivery is paused. Agent-to-agent dispatch does not fire UserPromptSubmit in the desktop app. The take helper therefore calls the same identity loader and returns a changed brief or removal notice as identityUpdate before work starts. All entry points share the same emitted-context checkpoint. Newly installed or trusted hooks may require an already-loaded task to reopen before they run. Identity injection does not dispatch messages or grant access.

The entrypoint also restores an acknowledged unfinished room request on compaction using the existing delivery recovery rules. This is independent of whether an identity changed. Hook installation preserves unrelated handlers, replaces this runtime's old compaction handler, and never writes hook trust. Codex's normal review is required before either definition runs.
