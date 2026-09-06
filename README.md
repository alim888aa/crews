# Crews

**Slack for your Codex threads.**

A local Mac app that puts your existing Codex desktop tasks in one shared chat.

Give each task an @name, message one teammate, or bring several into a conversation. Each task keeps its existing history, model and tools. Replies appear under your original message.

**Early alpha.** Crews is an independent project built around the Codex desktop app. Setup requires a few direct approvals in Codex, and delivery depends on its native tools and scheduler. It is not affiliated with OpenAI.

## What it does

- Connect existing tasks from a picker showing your ten most recent local tasks.
- Mention teammates in order, or use `@all` for simultaneous replies.
- Keep discussions in resizable conversation panels.
- Paste screenshots with Command+V or attach them with the paperclip.
- Render Markdown and show queued, working and failed deliveries.
- Save messages and connections locally across app restarts.

There is no teammate-creation button yet. Create a task in Codex, then add it here. Live token streaming and an explicit steering control are also not included.

## Requirements

- macOS 13 (Ventura) or later. Other operating systems have not been tested or packaged.
- The Codex desktop app, signed in and kept open while using Crews.
- Access to Codex's native task messaging and automation tools, plus the GPT-5.6 Luna model used by the relay.
- For building from source, Node.js 22.12+ and npm. The packaged app includes its runtime.

Compatibility depends on your Codex version, available tools, account limits and approval settings. A successful test on one Mac does not establish compatibility with every account or managed installation.

## Build and open

From this repository's directory:

```sh
npm ci
npm run build
npm test
npm start
```

To make a Mac app bundle:

```sh
npm run package:mac
```

The first start or packaging run downloads the matching Electron binary if needed, so it requires internet access.

Copy `release/Crews.app` into your Applications folder, then open it. Quit an older copy before replacing it. The build script uses an ad-hoc signature; this source build is not Apple-notarized. No public binary download is provided by these instructions.

## Connect Codex

1. Open Crews and click **Connect to Codex**.
2. Codex opens a new task with the setup message prepared. Review it and press **Send**.
3. That task becomes the dedicated relay. It registers itself, sets up a recurring wakeup and returns recent task metadata to Crews.
4. Review any setup or hook approval Codex requests. The optional compaction-recovery hook needs Codex's explicit trust before it can run.
5. When the picker is ready, click **Add teammate** and choose an existing task.
6. Choose a display name and @name, then click **Add and connect**. Crews copies a connection message and opens that exact task in Codex. Paste it and press **Send**.
7. Wait for the connection to be confirmed in Crews.

Repeat the teammate steps for each task you want in the room. Existing-task links cannot prefill the approval automatically, so the paste-and-send step is required. Connecting a task does not remove its normal approval rules.

## Send a message

`@planner Help me choose what to work on` goes only to that teammate.

`@planner @builder Discuss this change` gives the named teammates turns in that order.

`@all What do you think?` in the main channel addresses all connected teammates. Inside an existing conversation it addresses that conversation's participants.

Reply without a mention to keep that conversation's participant order. Agents can request further peer discussion through addressed replies, within a bounded conversation budget. The relay forwards prompts and each task writes its own reply.

Click a message's reply count to open its conversation. Drag the divider to resize it. Command+B toggles the teammate sidebar. Click a teammate's row to open its settings.

Screenshot attachments support PNG, JPEG and WebP, up to four per message and 10 MB per image including the normalized PNG. Unsaved text and attachment drafts survive reopening. Markdown web, mail and Codex task links are clickable; local filesystem links currently display as text.

## If something gets stuck

Delivery is not instantaneous. The relay wakes periodically, and Codex scheduling and model latency still apply.

- **Queued** means the message is saved but has not started. A task handles one active room delivery at a time.
- **Waiting to start** means it was dispatched but the task has not acknowledged it yet.
- **Needs approval** means an actual approval problem was recorded. Use **Reapprove teammate** and submit the copied message in the original Codex task.
- **Needs attention** shows a recorded failure. Open the original task and inspect its outcome before resuming any work.
- For relay problems, open **Connection details** and use the repair action. It copies a repair approval and opens the existing relay task.

A confirmed stopped task releases its slot so newer messages can arrive. Its failed request stays visible and is never automatically replayed. Approval, storage and uncertain-send holds remain blocked until resolved. Reconnecting does not silently resend uncertain work.

Pause stops new dispatches. Already-dispatched work may finish. Replies written while Crews is closed can be accepted after it reopens.

See [recovery and clean setup](docs/recovery.md) for backups and first-run testing.

## Local storage and permissions

Crews stores its room data, attachments, installed helpers and UI state under `~/Library/Application Support/Crews/`. It has no separate cloud backend. Messages handled by Codex still use Codex's normal hosted model service and account usage; “local” does not mean offline inference.

The relay and connected tasks need access to the room folders covered by their direct approvals. Peer messages cannot grant permissions. The app uses shared files under your macOS account, so @mentions control routing, not file-level privacy between tasks or other processes running as you.

Compaction recovery can remind a task about its acknowledged unfinished delivery. It never resends a request or grants permission. A hook receipt proves that context was emitted, not that the model followed it. Actual model continuation after compaction has not yet been verified end to end.

## Development

The app uses TypeScript, Electron, React, shadcn and Effect. See [architecture](docs/architecture.md) for the module layout and delivery lifecycle.

```sh
npm run check       # frontend and backend TypeScript
npm run build       # checks, backend bundles and renderer
npm test            # run after building the helpers
npm run test:images # isolated Electron attachment checks
```

The attachment check changes the system clipboard. It uses a temporary room and does not message real Codex tasks.

To try a separate development room without using your normal room data:

```sh
CREWS_DATA="$(mktemp -d)" npm start
```

This isolates the app's files. Connecting that room still creates real tasks and automations in Codex, so leave it unconnected for local UI testing. Only one Crews app instance can run at a time.

## Project status

The maintainer develops the original repository. Licensed under the [MIT license](LICENSE). Forks are welcome; outside contributions are not part of the current maintenance workflow.

The tested source covers routing, durable replies, restart recovery, validation, attachments, Markdown and failure handling. Fresh setup and normal delivery have been exercised locally through Codex, but independent testing on another person's Mac is still needed. Expect rough edges and changes as Codex evolves.
