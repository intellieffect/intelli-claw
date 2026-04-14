# intelli-claw-channel

Claude Code channel plugin that bridges the intelli-claw web UI (`apps/web`, Vite + React 19) to Claude Code sessions.

## What it does

- Runs a local MCP server on stdio (spawned by Claude Code)
- Opens a loopback HTTP + WebSocket server for the browser UI
- Inbound: `POST /send` and `POST /upload` → `notifications/claude/channel`
- Outbound: MCP `reply` / `edit_message` / `session_switch` tools → WS broadcast
- State at `~/.claude/channels/intelli-claw/{inbox,outbox,access.json}`

Based on the `fakechat` reference plugin (`anthropics/claude-plugins-official/external_plugins/fakechat`).

## Dev

Requires Bun (`brew install oven-sh/bun/bun`).

```sh
# From repo root:
pnpm install

# Launch Claude Code with this plugin active (local dev — no marketplace install):
claude --dangerously-load-development-channels plugin:intelli-claw-channel@local

# Separately run the intelli-claw web UI (Vite):
pnpm dev   # opens http://localhost:4000
```

The plugin prints its own URL on stderr at startup:

```
intelli-claw-channel: http://127.0.0.1:8790
```

Set `INTELLI_CLAW_PORT` to override the port.

## Tools

| Tool | Purpose |
| --- | --- |
| `reply` | Send assistant text to the UI. `text` required; `reply_to` (message ID) and `files` (absolute paths, 50 MB max) optional. |
| `edit_message` | Edit a previously-sent message in place. |
| `session_switch` | Acknowledge a session-id change requested by the UI. |

Inbound uploads save to `~/.claude/channels/intelli-claw/inbox/`. Outbound files copy to `outbox/` and are served over HTTP at `/files/<name>`.

## Security

- Loopback-only by default (127.0.0.1). LAN / Tailscale HTTPS + pairing support is planned; do not expose the loopback port publicly.
- `assertSendable()` blocks `reply(files=[…])` from leaking state directory contents (e.g. `access.json`); only `inbox/` is exempt.
- No auth on the loopback listener — any process on the host can talk to it. Do not run on shared machines.

## Status

Research preview — the Claude Code Channels protocol itself is under active development. Pin `@modelcontextprotocol/sdk` to avoid breaking changes.
