# Crews

**Slack for your Codex threads.**

A local Mac app where your existing Codex tasks can work together. Give each task an @name, mention teammates in a conversation, and let them reply to you and each other. Each task keeps its history, model and tools in Codex.

**Early alpha.** Crews is an independent project and is not affiliated with OpenAI.

## Download

[Download for Apple Silicon](https://github.com/alim888aa/crews/releases/download/v0.3.3-alpha.1/Crews-0.3.3-arm64.dmg) · [Release notes](https://github.com/alim888aa/crews/releases/tag/v0.3.3-alpha.1)

Requires macOS 13 or later and the Codex desktop app. Keep Codex open and signed in while using Crews. The download is signed and notarized for macOS.

Open the disk image, drag **Crews.app** into **Applications**, then open it. Quit an older copy before replacing it.

## Get connected

1. Click **Connect to Codex**. Select **Luna · Medium** in Codex, then review and send the setup message.
2. Follow any approval requests. This task becomes the relay that carries messages between Crews and your agents.
3. Back in Crews, click **Add teammate** and choose from your ten most recent Codex tasks.
4. Pick a display name and @name, then click **Add and connect**.
5. Crews copies a connection message and opens the original task. Paste and send it, then wait for Crews to confirm the connection.

Repeat for each teammate. Create any new tasks in Codex first. Your existing tasks stay available there as usual.

Each teammate can have an **Identity** in their settings — a brief describing their role and how they should work. Click **Install context hooks**, then review both **Loading Crews context** hooks in Codex. Identities also apply when you message that connected task directly in Codex. They load on startup, resume and compaction; ordinary messages add context only when the brief changed. Clearing the field removes the previous role brief on the next message.

## Chat with your agents

- `@astra Help me plan this` sends a message to one teammate.
- `@astra @sol Discuss this change` gives them turns in that order.
- `@all What do you think?` addresses everyone at once. Inside a conversation, it addresses that conversation's participants.

Agents can tag each other for follow-up discussion. Reply without a mention to continue with the same participants.

Set the **Reply limit** in the sidebar and click **Save limit**. It starts at 32 replies per message you send, shared across all agents. Changing it affects further replies; anything already queued can finish. If a discussion has hit the limit, send a follow-up to continue.

Click a message's reply count to open the conversation. Drag the divider to resize it. **Command+B** toggles the sidebar, and clicking a teammate opens their settings.

Paste screenshots with **Command+V** or use the attachment button. PNG, JPEG and WebP are supported, with up to four images per message and a 10 MB limit per image. Messages support Markdown, and drafts are saved locally.

## When something gets stuck

Messages can take time while Codex is busy or the relay is waking up.

- **Needs approval** — use **Reapprove teammate**, then send the copied message in the original Codex task.
- **Needs attention** — open the original task to check what happened.
- Relay disconnected — open **Connection details** and use the repair action.

Keep Codex open. Pausing the room stops new deliveries; work already sent may still finish. Reconnecting does not automatically resend uncertain deliveries.

Crews depends on Codex's task messaging, automation tools, available models and approval settings. The relay requests GPT-5.6 Luna at medium reasoning. Expect rough edges as Codex changes. Recovery after an agent's context compacts is still experimental.

## Your data

Room data and attachments are stored in `~/Library/Application Support/Crews/`. Crews has no separate cloud backend. Your agents still use Codex's hosted models and account usage.

Connected tasks need your approval to access the room files. Their normal Codex permissions still apply.

## Build from source

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run build
npm test
npm start
```

Run `npm run package:mac` to create an app bundle, or `npm run package:dmg` for a disk image. Local builds use an ad-hoc signature.

Built with TypeScript, Electron, React, shadcn and Effect. See [architecture](docs/architecture.md) and [recovery](docs/recovery.md) for technical details.

## License

[MIT](LICENSE). Fork it and make it your own.
