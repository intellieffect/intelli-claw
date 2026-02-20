# Architecture (Draft)

## Overview
AWF is a Next.js frontend for OpenClaw Gateway.

### Core modules
- `src/components/chat/*` — panel UI, message list, input, session switcher
- `src/lib/gateway/*` — gateway client hooks and protocol mapping
- `src/components/settings/*` — session-level settings UI

### Data flow
1. UI action triggers hook (`useChat`, `useSessions`, ...)
2. Hook sends request/event through Gateway WS client
3. Incoming events update local React state
4. Components render derived view state

### Session model
- main / thread / cron / subagent / a2a
- Session switcher shows all sessions and metadata
- Thread sessions can be auto-labeled for better discoverability

### Runtime modes
- Dev (port 4000): HMR/turbopack
- Prod (port 4100): built stable version
