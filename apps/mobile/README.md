# intelli-claw Mobile

React Native (Expo) client for [OpenClaw](https://github.com/openclaw/openclaw) Gateway.

## Prerequisites

- Node.js ≥ 20
- pnpm
- [Expo Go](https://expo.dev/go) on your device **or** iOS Simulator / Android Emulator
- A running OpenClaw Gateway instance

## Quick Start

```bash
# 1. Install dependencies (from monorepo root)
pnpm install

# 2. Create your local env file
cp apps/mobile/.env.example apps/mobile/.env.local

# 3. Edit .env.local with your Gateway details
#    See "Configuration" below

# 4. Start the dev server
cd apps/mobile
pnpm start
```

## Configuration

All configuration is done via `.env.local` (never committed to git).

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `GATEWAY_URL` | ✅ | WebSocket URL of your OpenClaw Gateway | `ws://192.168.1.100:18789` |
| `GATEWAY_TOKEN` | ✅ | Auth token from `openclaw status` or `openclaw.json` | `abc123...` |
| `GATEWAY_HTTP_URL` | ✅ | HTTP URL for REST calls (media, etc.) | `http://192.168.1.100:18789` |

### Finding your Gateway URL & Token

```bash
# On the machine running OpenClaw:
openclaw status
# Look for:
#   Gateway: http://0.0.0.0:18789
#   Token: abc123...
```

### Network Notes

- **Same WiFi**: Use your machine's local IP (e.g., `192.168.1.x`)
- **Tailscale**: Use your Tailscale IP (e.g., `100.x.y.z`) — recommended for remote access
- **Simulator on same machine**: `127.0.0.1` works
- **Physical device**: Must use a routable IP (not `localhost` / `127.0.0.1`)
- Default Gateway port: `18789` (check your openclaw config if different)

### Changing Gateway at Runtime

You can also change the Gateway URL and token from within the app:
1. Tap the ⚙️ (Settings) icon in the top-right
2. Update the URL and Token fields
3. The app will reconnect automatically

Runtime settings persist across app restarts and override `.env.local` values.

## Development

```bash
# Start Expo dev server
pnpm start

# iOS Simulator
pnpm ios

# Android Emulator
pnpm android

# Expo Go (scan QR code from terminal)
pnpm start
```

### Expo Go Caveats

- Expo Go uses its own runtime — some native modules may not work
- For full native module support, use a [development build](https://docs.expo.dev/develop/development-builds/introduction/)

## Project Structure

```
apps/mobile/
├── app/                    # Expo Router pages
│   ├── _layout.tsx         # Root layout (providers, config)
│   └── (tabs)/
│       ├── _layout.tsx     # Tab layout (currently single screen)
│       └── index.tsx       # Main chat screen
├── src/
│   ├── adapters/           # Platform adapters (storage, crypto)
│   ├── components/         # Reusable components (Markdown, Settings)
│   ├── hooks/              # Custom hooks (useChat, useSessions)
│   ├── platform/           # Platform-specific utilities
│   └── stores/             # State management (session context)
├── .env.example            # Environment template
└── app.config.ts           # Expo config (reads env vars)
```

## Features

- Real-time chat with OpenClaw agents via WebSocket
- Multi-session support with session picker
- Image attachments (gallery & camera)
- Markdown rendering (with horizontal-scrolling tables)
- Session persistence across app restarts
- Runtime Gateway configuration

## Troubleshooting

### "연결 안 됨" (Not Connected)

1. Verify Gateway is running: `openclaw status`
2. Check `.env.local` URL is reachable from your device
3. Ensure token is correct
4. Check firewall allows the Gateway port

### Images not sending

- Ensure the Gateway version supports `chat.send` with `attachments`
- Attachments use the `content` field (base64, no data URL prefix)

### App reloads lose session

- Session key is persisted via AsyncStorage
- If using Expo Go, "Clear Data" will reset it
