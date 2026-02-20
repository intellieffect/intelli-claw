# intelli-claw

> A multi-panel agent workspace for [OpenClaw](https://github.com/openclaw/openclaw).  
> Talk to multiple AI agents side-by-side, manage sessions, and track tasks — all from one browser tab.

---

## Why?

OpenClaw connects to messaging platforms like Telegram, Slack, Discord, and more.  
But those platforms have **limits** — no multi-panel views, no per-session task tracking, limited slash command UX, and no way to work with multiple agents or sessions simultaneously.

**intelli-claw** is a purpose-built web workspace that unlocks the full power of OpenClaw:

- **Multiple panels** — talk to different agents (or different sessions of the same agent) side by side
- **Session management** — switch, rename, create, and delete sessions with keyboard shortcuts
- **Task tracking** — per-session task memos that update automatically as your agent works
- **Slash commands** — `/stop`, `/new`, `/reset`, `/model`, `/status` and more, with autocomplete
- **File attachments** — drag & drop or paste files directly into chat
- **Full Gateway access** — session settings, model switching, thinking levels — things messaging apps can't do natively

Think of it as **mission control for your AI agents** — everything Telegram/Slack can't give you.

---

## Features

### 🖥️ Multi-Panel Workspace
Split your screen into multiple chat panels. Each panel connects to a different session or agent. Great for:
- Working on multiple tasks simultaneously
- Comparing agent responses
- Monitoring long-running background tasks

### 📋 Session Switcher (`Cmd+K`)
Quick-switch between sessions with fuzzy search. Sessions show:
- Agent name and type badge (main / thread / cron)
- Token usage and last activity time
- Custom labels for easy identification

### ✏️ Auto Session Labeling
New thread sessions get meaningful names automatically:
- On creation: `agent/작업-0220-1430` (timestamp-based)
- After first message: `agent/your first message summary`
- Press `R` in the session panel to rename manually

### 📌 Task Memo
A collapsible task checklist at the top of each panel:
- Agents can auto-update it via hidden markers in messages
- You can also add/edit/remove tasks manually
- Status cycle: ⬜ pending → 🔄 in-progress → ✅ done
- Persisted per-session in localStorage

### ⚡ Slash Commands
Type `/` to see all available commands with autocomplete:

| Command | Action |
|---------|--------|
| `/stop` | Abort current streaming response |
| `/new` | Start a new thread session |
| `/reset` | Reset current session |
| `/status` | Show session status (tokens, model, etc.) |
| `/model <name>` | Change model for this session |
| `/reasoning` | Toggle reasoning mode |
| `/help` | Show available commands |

Skills (from OpenClaw) also appear in the command palette.

### 📎 File Attachments
- Drag & drop files onto the chat
- Paste images from clipboard
- Preview before sending
- Supports images, documents, and more

### ⚙️ Session Settings
Click the gear icon to access per-session settings:
- Model selection
- Thinking level (Off / Low / Medium / High)
- Verbose mode toggle
- Reset or delete session

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/)
- [OpenClaw](https://github.com/openclaw/openclaw) Gateway running

### Install & Run

```bash
# Clone
git clone https://github.com/intellieffect/intelli-claw.git
cd intelli-claw

# Install dependencies
pnpm install

# Configure (create .env.local)
cp .env.example .env.local
# Edit .env.local — set your Gateway URL and token

# Start dev server
pnpm dev
```

Open `http://localhost:4000` in your browser.

### Configuration

Create `.env.local` with:

```bash
# Required: your OpenClaw Gateway WebSocket URL
NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789

# Optional: Gateway auth token (if configured)
# NEXT_PUBLIC_GATEWAY_TOKEN=your-token-here

# Optional: default agent ID
# NEXT_PUBLIC_DEFAULT_AGENT=default
```

### Production Build

```bash
# Build and start on port 4100
./scripts/start-prod.sh

# Or manually:
pnpm build
pnpm start --port 4100
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open session switcher |
| `Cmd+N` | New session |
| `Cmd+\` | Split panel |
| `Cmd+W` | Close panel |
| `Cmd+1-9` | Switch to panel N |
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `R` (in session panel) | Rename selected session |
| `Esc` | Close dialogs / abort |

---

## Tech Stack

- [Next.js](https://nextjs.org/) 15 + React 19
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) 4
- [Radix UI](https://www.radix-ui.com/) primitives
- WebSocket connection to OpenClaw Gateway
- [Vitest](https://vitest.dev/) for testing

---

## Project Structure

```
src/
├── app/                    # Next.js app router pages
├── components/
│   ├── chat/               # Core chat UI (panels, messages, input, sessions)
│   ├── settings/           # Session settings, cron panel
│   ├── showcase/           # HTML showcase panel
│   └── ui/                 # Shared UI primitives
├── lib/
│   ├── gateway/            # OpenClaw Gateway client, hooks, protocol
│   └── hooks/              # Shared React hooks
└── styles/                 # Global CSS
```

---

## Scripts

```bash
pnpm dev          # Start dev server (port 4000)
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm exec vitest run  # Run tests
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities via [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) — built by [IntelliEffect](https://intellieffect.com).
