# intelli-clawd

> Multi-panel agent workspace UI for OpenClaw.

## Status
- Early stage, preparing for open-source release.
- Product name may change before public launch.

## Features (current)
- Multi-panel chat workspace
- Session switcher + shortcuts
- Agent selector
- Task memo per session
- Slash command handling (`/stop`, `/new`, `/reset`, `/model`, ...)

## Requirements
- Node.js 20+
- pnpm
- OpenClaw Gateway running

## Quick start
```bash
pnpm install
pnpm dev
```

Default local URLs:
- Dev: `http://127.0.0.1:4000`
- Prod: `http://127.0.0.1:4100`

## Scripts
```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
```

## Configuration
Create `.env.local` (local only).

Example:
```bash
NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789
```

## Open-source readiness checklist
See `OPEN_SOURCE_CHECKLIST.md`.

## Security
Please report vulnerabilities via `SECURITY.md`.

## Contributing
See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## License
MIT (see `LICENSE`).
