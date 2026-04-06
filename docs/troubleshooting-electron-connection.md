# Troubleshooting: Electron Gateway Connection

> **TL;DR** — When the Electron desktop app shows "연결 끊김" with no obvious cause, **capture stderr first**:
>
> ```bash
> pkill -x iClaw
> ~/Applications/iclaw.app/Contents/MacOS/iClaw \
>   > /tmp/iclaw-stdout.log 2> /tmp/iclaw-stderr.log &
> sleep 8
> grep -iE "error|fail|reject" /tmp/iclaw-stderr.log
> ```
>
> Don't use `open ~/Applications/iclaw.app` — it loses stderr.

This document captures the lessons from a 4-bug Electron connection failure on **2026-04-06** so they don't have to be re-discovered.

---

## The Architecture, Briefly

```
┌────────────────────────┐         ┌────────────────────────┐
│ iClaw Electron app     │ ──ws──▶ │ OpenClaw Gateway       │
│ (apps/desktop)         │         │ (~/.openclaw)          │
│  - main process        │         │  port 18789            │
│  - renderer (web src)  │         │  bind: lan / tailscale │
└─────┬──────────────────┘         └────────────────────────┘
      │
      └─ ws/wss → API server (apps/server)
         port 4001
```

The renderer is the same code as the web app (`apps/web/src/`), but it runs inside Electron with a custom main process at `apps/desktop/src/main/index.ts`. The main process is where Electron-specific things happen — Origin rewriting, custom protocol handlers, the API base URL derivation.

---

## The Four Pitfalls

### 1. ❌ `sessionStorage` for the auth token

**Don't** use `sessionStorage` for anything in Electron. Electron has no "tab close" concept, so `sessionStorage` is wiped every time the user quits the app — they lose their auth state on every restart.

The web app's threat model (XSS isolation across tabs) doesn't apply to Electron, which already has `contextIsolation` and origin lock.

**Right way** — `apps/web/src/lib/gateway/hooks.tsx`:

```ts
function shouldUseSessionStorageForToken(): boolean {
  return !("electronAPI" in window);  // Web only
}
```

Then branch in `loadGatewayConfig` / `saveConfig`:
- Web: token → `sessionStorage`
- Electron: token → `localStorage` (alongside the URL)

History: PR #305 (#229) introduced the bug, PR #309 fixed it.

---

### 2. ❌ Hardcoded WebSocket Origin in main process

**Don't** rewrite the WebSocket Origin header to a hardcoded `host:port`. The gateway's `allowedOrigins` list can change between deployments (TLS vs plain, Tailscale vs LAN, port changes), and any drift breaks the connection silently.

**Right way** — `apps/desktop/src/main/index.ts`:

```ts
win.webContents.session.webRequest.onBeforeSendHeaders(
  { urls: ["wss://*/*", "ws://*/*"] },
  (details, callback) => {
    try {
      const u = new URL(details.url);
      const httpScheme = u.protocol === "wss:" ? "https" : "http";
      details.requestHeaders["Origin"] = `${httpScheme}://${u.host}`;
    } catch { /* leave Origin untouched */ }
    callback({ requestHeaders: details.requestHeaders });
  },
);
```

Rewriting Origin to the **gateway's own origin** (`scheme://host:port`) always passes — every reasonable `allowedOrigins` list includes self.

History: PR #311.

> **Why doesn't the OpenClaw Control UI need this?**
> Because the Control UI is **served by the gateway itself**, so the page origin automatically matches `http://localhost:18789`. Electron is a separate app, so we have to rewrite Origin manually.

---

### 3. ❌ Hardcoded scheme in derived URLs

**Don't** hardcode `https://` when deriving an API URL from the gateway URL. If the gateway is plain HTTP (e.g. `bind: "lan"` without TLS), every API call hits SSL handshake errors:

```
ERROR:net/socket/ssl_client_socket_impl.cc:916] handshake failed; net_error -107
```

**Right way** — both `apps/desktop/electron.vite.config.ts` (`deriveApiUrl`) and `apps/desktop/src/main/index.ts` (`getApiBaseUrl`):

```ts
const u = new URL(gatewayUrl);
const httpScheme = u.protocol === "wss:" ? "https" : "http";
return `${httpScheme}://${u.hostname}:${apiPort}`;
```

Mapping rules:
- `wss://` ↔ `https://`
- `ws://` ↔ `http://`

There are **two** copies of this derive logic — fix both at the same time.

History: PR #312.

---

### 4. ❌ `.env.local` drift vs gateway config

`.env.local`'s `VITE_GATEWAY_URL` and `VITE_GATEWAY_TOKEN` are inlined into the build at compile time (Vite). When you edit `~/.openclaw/openclaw.json` (token rotation, mode change, port change), `.env.local` becomes stale and the next Electron build starts with the wrong values.

There's also a precedence subtlety: `loadGatewayConfig()` prefers `localStorage` over env. If a previous build wrote a stale token to `localStorage`, the new build will keep using that stale token even after you fix `.env.local`.

**Recovery checklist**:

1. Confirm the canonical token from the gateway:
   ```bash
   grep -A2 '"auth"' ~/.openclaw/openclaw.json
   ```
2. Update `apps/web/.env.local` to match.
3. Stop the app, reset Electron's `Local Storage` directory:
   ```bash
   pkill -x iClaw
   rm -rf ~/Library/Application\ Support/@intelli-claw/desktop/Local\ Storage
   ```
4. Rebuild + redeploy: `scripts/deploy.sh local`.

After PR #310 there's a fallback path: if `localStorage` has the URL but no token AND `.env.local` has a token for the same URL, the env token is used and persisted back to `localStorage`. So step 3 (reset) isn't strictly required — it just speeds up recovery when the localStorage token is also stale.

---

## Diagnostic Checklist (5 minutes)

When the Electron app fails to connect, run through this list **before** changing any code:

```bash
# 1. Capture stderr — DO THIS FIRST
pkill -x iClaw
~/Applications/iclaw.app/Contents/MacOS/iClaw \
  > /tmp/iclaw-stdout.log 2> /tmp/iclaw-stderr.log &
sleep 8
grep -iE "error|fail|reject" /tmp/iclaw-stderr.log

# 2. Gateway log — was a connection even attempted?
tail -100 ~/.openclaw/logs/gateway.log | grep -E "ws|webchat|connect"
# - No webchat connect at all → client can't reach gateway (URL/scheme/port wrong)
# - webchat connect followed by immediate disconnect → auth/origin rejected

# 3. Gateway config — what does it actually expect?
grep -A8 '"gateway"' ~/.openclaw/openclaw.json | head -20
# Check: bind, mode, allowedOrigins, auth.token

# 4. Reachability — what scheme is actually live?
curl -sI http://localhost:18789 | head -3   # Plain HTTP
curl -skI https://localhost:18789 | head -3 # TLS

# 5. localStorage state inside the app
strings ~/Library/Application\ Support/@intelli-claw/desktop/Local\ Storage/leveldb/*.log \
  2>/dev/null | grep -A1 "gateway-config"
```

If steps 1–4 don't reveal anything, **then** you can start debugging code.

---

## Why This Was Hard To Find

The original symptom was just "연결 끊김" in the UI. The four bugs interacted:

1. PR #305 (#229) introduced the `sessionStorage` issue, hidden until app restart.
2. The `.env.local` token was stale (gateway re-rotated), but `localStorage` had a written-once value that took precedence.
3. Even after fixing tokens, `Origin` rewriting was wrong, so the WebSocket upgrade got rejected.
4. Even after fixing `Origin`, the API base URL was https against an http server, and *that's* where stderr finally showed `net_error -107`.

Each fix individually was small, but discovering the chain required actually capturing stderr — which the GUI launcher hides. **Always capture stderr first**.

---

## Related Files

| File | Purpose |
|---|---|
| `apps/web/src/lib/gateway/hooks.tsx` | `loadGatewayConfig`, `saveConfig`, `shouldUseSessionStorageForToken` |
| `apps/desktop/src/main/index.ts` | Origin rewriter, `getApiBaseUrl()` |
| `apps/desktop/electron.vite.config.ts` | `deriveApiUrl()`, `envDir` |
| `apps/web/.env.local` | Build-time `VITE_GATEWAY_URL`/`VITE_GATEWAY_TOKEN` |
| `~/.openclaw/openclaw.json` | Authoritative gateway config (mode, bind, auth.token, allowedOrigins) |

## Related PRs

- **#305** (#229) — sessionStorage migration (introduced regression for Electron)
- **#309** — Electron localStorage branch (fixes regression)
- **#310** — env token fallback when localStorage has URL but no token
- **#311** — Origin rewriter uses gateway's own origin
- **#312** — API URL scheme follows gateway scheme
