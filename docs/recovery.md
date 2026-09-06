# Recovery and clean setup

## Back up before resetting

Quit Crews before copying or moving its files. Back up the entire `~/Library/Application Support/Crews/` folder, not just `data/state.json`. Messages, attachment files, event receipts, claims, helpers and UI drafts need to remain together.

The app bundle and its saved data are separate. Replacing the app should preserve saved data. Deleting only the app bundle does not produce a clean first run.

## Reconnect an existing teammate

Click its row in Crews, use the connection action, then paste and send the copied approval in that exact Codex task. Wait for an accepted connection receipt. This preserves the existing task and its history.

Inspect a held delivery before resuming its work. An uncertain send could already have performed actions. The helper returns completed for a delivery that already has an accepted final reply, preventing duplicate room replies.

## Repair the relay

Keep Codex open. Open Crews's connection details and use **Copy repair approval and open relay**. Submit the copied message directly in that saved relay task. Repair reuses the relay and its automation rather than creating replacements.

A delay alone does not establish an approval failure. Inspect the actual recorded error. Crews cannot override Codex's native policy or restore tools unavailable in your installation.

## Try a clean onboarding run

A complete reset affects both local Crews files and the relay registration in Codex. Do not erase data while an agent is still working on a room request.

1. Finish or explicitly stop outstanding room work, then quit Crews.
2. Pause the old relay's recurring automation in Codex. Otherwise it can wake later against the same default runtime path.
3. Back up the complete Crews support folder and move it out of the default location.
4. Open the app. It should show first-run setup with no teammates or previous messages.
5. Follow the README's connection steps. Setup creates a new dedicated relay; your existing worker tasks remain in Codex.
6. Reconnect only the worker tasks you want. Test a simple request, close and reopen the app, and test another request.

The compaction hook is registered in your active Codex configuration. Do not delete unrelated hooks. Setup installs its definition without granting trust; review the exact current hook in Codex if asked. A new executable path or changed definition may need another review.

Restoring a backup also means restoring its intended relay and automation relationship. Keep the replacement relay automation paused while restoring the earlier installation. Never run two relays against the same room deliberately.

## What has and has not been verified

Automated tests cover isolated rooms, ordered and simultaneous delivery, replay protection, connection validation, saved replies across app closure, stale listener cleanup, typed failures, attachments, Markdown and compaction-context selection.

Local live tests have verified direct setup approvals, reconnecting existing tasks, normal delivery and startup recovery. They do not establish every account's permissions, scheduler timing or compatibility. Actual model behavior after a real compaction and onboarding on an independent user's Mac remain unverified.
