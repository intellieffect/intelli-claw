# intelli-claw Mobile

Expo client for the Claude Code [intelli-claw-channel](../../plugins/intelli-claw-channel) plugin. Shares `ChannelProvider` / `useChannel` with `apps/web` through `@intelli-claw/shared`.

## Prerequisites

- Node 22+, pnpm 10, Xcode / Android Studio (or Expo Go for quick smoke tests)
- A host machine running Claude Code with the `intelli-claw-channel` plugin:
  ```sh
  # one-time
  claude plugin marketplace add <path-to-this-repo>
  claude plugin install intelli-claw-channel@intelli-claw
  # each session (LAN mode + token):
  INTELLI_CLAW_HOST=0.0.0.0 INTELLI_CLAW_TOKEN=<secret> \
    claude --dangerously-load-development-channels plugin:intelli-claw-channel@intelli-claw
  ```

## Quick Start

```sh
pnpm install
pnpm --filter @intelli-claw/mobile dev   # opens Expo dev server
```

On first launch the app shows a pairing screen:

- **Channel URL** — the host's address (e.g. `http://192.168.1.10:8790` for LAN, or `http://100.x.y.z:8790` over Tailscale)
- **Bearer Token** — the `INTELLI_CLAW_TOKEN` you set on the host

The app calls `/config` to verify the endpoint, then stores both values in iOS Keychain / Android Keystore via `expo-secure-store`. Message history is cached in MMKV (non-secret).

## Network notes

- **Loopback (127.0.0.1)** only works on the same machine — OK for the iOS Simulator on the host.
- **Physical devices** need a routable address; use the host's LAN IP or Tailscale IP.
- LAN exposure requires `INTELLI_CLAW_HOST=0.0.0.0` + `INTELLI_CLAW_TOKEN`; otherwise the plugin stays loopback-only.
- HTTPS is delegated to a reverse proxy (e.g. Tailscale Serve) — the plugin itself speaks plain HTTP/WS.

## Project layout

```
apps/mobile/
├── app/
│   ├── _layout.tsx         # SecureStore-loaded config → ChannelProvider or PairingScreen
│   └── index.tsx           # Chat screen (messages, composer, permission prompts)
├── src/
│   ├── pairing-screen.tsx  # URL + token entry
│   ├── storage.ts          # MMKV-backed ChannelStorage
│   └── secure-config.ts    # expo-secure-store wrapper (URL + token)
└── app.config.ts
```

## Commands

```sh
pnpm --filter @intelli-claw/mobile dev         # expo start
pnpm --filter @intelli-claw/mobile ios         # Xcode simulator build
pnpm --filter @intelli-claw/mobile android     # Android emulator build
pnpm --filter @intelli-claw/mobile typecheck
```

EAS Build / TestFlight / Firebase App Distribution rigs have been removed for the Channel rebuild. Re-introduce them once the plugin's LAN pairing UX stabilizes.

## Troubleshooting

- **"연결 해제" only**: the plugin's `/config` endpoint rejected the auth attempt. Retry with the correct `INTELLI_CLAW_TOKEN`.
- **Connecting forever on a phone**: ensure the host is reachable (`curl http://<host>:8790/config`) and the firewall allows the port.
- **Permission prompts never appear**: the plugin must be loaded with `--dangerously-load-development-channels plugin:…`; without the flag, `notifications/claude/channel/permission_request` is dropped.
