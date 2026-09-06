# Relay protocol

The app generates the active relay guide in its installed runtime directory. Follow that installed `RELAY.md`, including its exact dispatcher loader and paths. Do not reuse commands from older development builds.

The source of the installed guide is `backend/runtime.ts`. The dispatcher is `backend/relay-turn.ts`. Neither contains a preset user's task IDs or queue path.
