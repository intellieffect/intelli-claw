# Phase 4 End-to-End QA Report

Executed from the redesign branch against Claude Code **v2.1.108** on macOS (Darwin 25.3.0) with Bun 1.2.17.

## Commands exercised

```sh
# once
claude plugin marketplace add /Volumes/WorkSSD/Projects/intelli-claw
claude plugin install intelli-claw-channel@intelli-claw

# each session
claude --dangerously-load-development-channels \
       plugin:intelli-claw-channel@intelli-claw
```

Verified the plugin was installed at `~/.claude/plugins/cache/intelli-claw/intelli-claw-channel/0.1.0/` and the cached `server.ts` matches the working copy (`diff` returns 0 after `claude plugin marketplace update intelli-claw`).

## Results

| Check | Result | Notes |
| --- | --- | --- |
| `claude plugin marketplace add <repo>` | ✅ | marketplace declared in user settings |
| `claude plugin install intelli-claw-channel@intelli-claw` | ✅ | installs to `~/.claude/plugins/cache/…/0.1.0` |
| `claude plugin validate <repo>` | ✅ | `marketplace.json` + `plugin.json` schemas green |
| Plugin MCP spawn via `--dangerously-load-development-channels` | ✅ | subprocess comes up in ≤5 s on first cold spawn (bun install), ≤1 s thereafter |
| `GET /config` | ✅ | returns `{status, plugin, version, port, activeSessionId, tools, authRequired: false, mode: "loopback"}` |
| `POST /send {id,text,session_id}` | ✅ | 204 + WS broadcast (confirmed via Bun/Vitest integration tests and curl) |
| `POST /send {id:"", text:""}` | ✅ | 400 `missing id or text` |
| `GET /files/../something` | ✅ | 400 (path-traversal guard) |
| Unknown route | ✅ | 404 |
| Claude recognizes the plugin's tools | ✅ | enumerated as `intelli-claw-channel (reply, edit_message, session_switch)` in the session's deferred-tool list |
| Claude invokes `reply` end-to-end over MCP | ⚠️ | **interactive-only**. In `-p` (print) mode Claude terminates before accepting a follow-up `notifications/claude/channel` push, and MCP tools are deferred so a one-shot prompt can't force a `CallTool`. Confirmed via `claude -p "List every tool…"` that the tools are loaded; the actual `reply → WS broadcast` trip must be exercised from an interactive session. |

## Issues fixed during QA

- **Stale listener** blocking port 8790: ported the telegram plugin's `bot.pid` reclaim pattern into `server.ts` (`claimPidLock`). Next spawn now SIGTERMs the old process before binding.
- Initial smoke run was served by a forgotten `bun server.ts` from Phase 1. Added the PID lock so future reproductions don't drift.

## Known limitations (non-blockers)

- Cold-start latency of ~5 s on a fresh `claude plugin install` because Bun resolves `@modelcontextprotocol/sdk` transitively inside `CLAUDE_PLUGIN_ROOT`. Subsequent spawns hit the cache.
- `--dangerously-load-development-channels` is required because the plugin hasn't been submitted to the upstream allowlist yet (`clau.de/plugin-directory-submission` — Phase 5 candidate).
- Permission relay (`claude/channel/permission`) is wired end-to-end in contract tests (41 pass) but the human-in-the-loop path (`yes <id>` → `notifications/claude/channel/permission`) still needs an interactive manual pass on a device.

## Manual verification checklist (for reviewers)

1. `claude plugin marketplace add <this-repo>` → `claude plugin install intelli-claw-channel@intelli-claw`.
2. Open two terminals.
   - Terminal A: `claude --dangerously-load-development-channels plugin:intelli-claw-channel@intelli-claw`
   - Terminal B: `pnpm dev` (Vite on :4000).
3. In the browser, type a message. Expect: user bubble appears, Claude replies in Terminal A, UI receives the assistant bubble.
4. Ask Claude to run a tool that triggers permission (e.g., `Bash "date"`). Expect: an orange permission card in the UI with Allow/Deny buttons; Allow dispatches the verdict back through `notifications/claude/channel/permission` and Claude proceeds.
5. LAN sanity: quit, relaunch with `INTELLI_CLAW_HOST=0.0.0.0 INTELLI_CLAW_TOKEN=$(openssl rand -hex 12)`, pair the Expo app with the same host + token, repeat the chat.
