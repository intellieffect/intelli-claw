# Contributing

Thanks for your interest in contributing.

## Development
```bash
pnpm install
./scripts/start-dev.sh    # HTTPS dev server on port 4000
```

For HTTPS setup, LAN/remote access, and mobile testing, see [`docs/dev-setup.md`](docs/dev-setup.md).

## Branch naming (required)

Branch names **must** include the issue number:

```
fix/142-multi-window-storage
feat/79-reply-to
refactor/50-session-init
```

Format: `{type}/{issue-number}-{short-description}`

This triggers automation that:
1. Auto-assigns you to the issue
2. Adds `in-dev` label when branch is pushed
3. Moves to `in-review` when PR is opened
4. Cleans up labels when PR is merged

PRs without a linked issue will show a warning. PRs with unassigned issues **will fail the CI check**.

## Before opening a PR
- Run lint/typecheck/build locally
- Keep PRs focused and small
- Add/update docs when behavior changes

## Commit style
Prefer clear commit messages:
- `feat:` new feature
- `fix:` bug fix
- `refactor:` internal cleanup
- `docs:` documentation

## Pull Requests
Please include:
- What changed
- Why it changed
- How to test
- Screenshots (if UI changes)
