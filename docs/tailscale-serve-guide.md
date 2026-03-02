# Tailscale Serve + Ed25519 Device Identity Guide

mkcert 자체서명 인증서에서 Tailscale Serve(Let's Encrypt)로 전환하면서 겪은 과정과 현재 설정을 정리한 문서입니다.

> **관련 문서:** 기본 개발 환경 설정은 [dev-setup.md](./dev-setup.md) 참고.

---

## 목차

1. [배경 및 문제 상황](#1-배경-및-문제-상황)
2. [아키텍처 변경 (Before → After)](#2-아키텍처-변경-before--after)
3. [Tailscale Serve 설정](#3-tailscale-serve-설정)
4. [Gateway 설정 변경 (openclaw.json)](#4-gateway-설정-변경-openclawjson)
5. [Ed25519 Device Identity 프로토콜](#5-ed25519-device-identity-프로토콜)
6. [Vite Dev Server 설정](#6-vite-dev-server-설정)
7. [Electron Desktop 앱](#7-electron-desktop-앱)
8. [Device Pairing](#8-device-pairing)
9. [트러블슈팅](#9-트러블슈팅)

---

## 1. 배경 및 문제 상황

### mkcert 자체서명 인증서의 한계

mkcert로 생성한 자체서명 인증서는 **서버 머신에서만** 신뢰됩니다.
외부 기기(iPad, 다른 PC, 모바일)에서 접속하면:

- 브라우저가 인증서를 신뢰하지 않아 `ERR_CERT_AUTHORITY_INVALID` 발생
- iOS Safari에서 CA 프로파일을 수동 설치해야 함
- 일부 환경에서 `crypto.subtle`이 **secure context**로 인식되지 않아 device identity 키 생성 자체가 불가능

### 임시 우회의 보안 문제

```jsonc
// openclaw.json — 이전 임시 설정
{
  "gateway": {
    "controlUi": {
      "dangerouslyDisableDeviceAuth": true  // 모든 device auth 우회
    }
  }
}
```

이 옵션은 device identity 검증을 완전히 비활성화하므로, 네트워크에 접근 가능한 누구나 Gateway에 연결 가능합니다.

### Tailscale Serve가 해결하는 것

- **신뢰할 수 있는 TLS 인증서**: Let's Encrypt가 발급한 인증서를 Tailscale이 자동 관리
- **모든 기기에서 secure context**: 추가 CA 설치 없이 `crypto.subtle` 사용 가능
- **device auth 활성화 가능**: `dangerouslyDisableDeviceAuth: false`로 안전하게 운영

---

## 2. 아키텍처 변경 (Before → After)

### Before: mkcert TLS 직접 서빙

```
클라이언트 (브라우저)
    │
    ├─ HTTPS ──→ Vite Dev Server (port 4000, mkcert 인증서)
    │
    └─ WSS ────→ Gateway (port 18789, mkcert 인증서)
```

- 각 서비스가 mkcert 인증서로 직접 TLS 종단
- 외부 기기에서 CA 수동 설치 필요
- `host: true` (0.0.0.0 bind)로 모든 인터페이스에 노출

### After: Tailscale Serve 리버스 프록시

```
클라이언트 (Tailnet 내 기기)
    │
    │  Tailscale Serve (Let's Encrypt 인증서)
    │  ┌─────────────────────────────────────────┐
    ├──│ :4000  ──proxy──→ https+insecure://127.0.0.1:4000  │──→ Vite (127.0.0.1:4000)
    │  │                                                      │
    └──│ :18789 ──proxy──→ https+insecure://127.0.0.1:18789 │──→ Gateway (127.0.0.1:18789)
       └─────────────────────────────────────────┘
```

- Tailscale Serve가 TLS를 종단하고, Let's Encrypt 인증서를 자동 발급/갱신
- `https+insecure://`로 로컬 mkcert 인증서를 검증 없이 프록시
- Gateway/Vite는 `127.0.0.1`에만 bind → 외부 직접 접근 차단
- 클라이언트는 `https://brucechoe-macstudio.tailcc76d6.ts.net:PORT` 로 접속

---

## 3. Tailscale Serve 설정

### 사전 조건

1. **Tailscale 설치 및 로그인**
   ```bash
   # macOS
   brew install tailscale
   # 또는 Mac App Store에서 Tailscale 설치
   ```

2. **HTTPS 인증서 활성화** — Tailscale Admin Console에서:
   - DNS → HTTPS Certificates → Enable

3. **Tailscale Serve 기능 활성화** — ACL에서 Serve 허용 필요 (기본 활성화)

### Gateway WebSocket 프록시 설정

```bash
# Gateway (port 18789)를 Tailscale Serve로 프록시
tailscale serve --bg --https 18789 https+insecure://127.0.0.1:18789
```

- `--bg`: 백그라운드 실행
- `--https 18789`: Tailscale FQDN의 포트 18789에서 수신
- `https+insecure://127.0.0.1:18789`: 로컬 Gateway로 프록시 (자체서명 인증서 허용)

### Control UI 프록시 설정

```bash
# Vite dev server (port 4000)를 Tailscale Serve로 프록시
tailscale serve --bg --https 4000 https+insecure://127.0.0.1:4000
```

### 상태 확인

```bash
tailscale serve status
```

정상 출력:

```
https://brucechoe-macstudio.tailcc76d6.ts.net:18789 (tailnet only)
|-- / proxy https+insecure://127.0.0.1:18789

https://brucechoe-macstudio.tailcc76d6.ts.net:4000 (tailnet only)
|-- / proxy https+insecure://127.0.0.1:4000
```

### Serve 제거

```bash
# 특정 포트 제거
tailscale serve --https 18789 off
tailscale serve --https 4000 off

# 전체 초기화
tailscale serve reset
```

---

## 4. Gateway 설정 변경 (openclaw.json)

`~/.openclaw/openclaw.json`의 `gateway` 블록:

```jsonc
{
  "gateway": {
    "mode": "local",
    "bind": "loopback",
    "trustedProxies": ["127.0.0.1", "::1"],
    "controlUi": {
      "allowedOrigins": [
        "https://brucechoe-macstudio.tailcc76d6.ts.net",
        "https://brucechoe-macstudio.tailcc76d6.ts.net:4000",
        "https://brucechoe-macstudio.tailcc76d6.ts.net:4100",
        "http://localhost:4000",
        "http://localhost:5173",
        "https://localhost:4000",
        "https://localhost:4100",
        "file://"
      ],
      "dangerouslyDisableDeviceAuth": false
    },
    "tls": {
      "enabled": true,
      "autoGenerate": false
    }
  }
}
```

### 각 설정의 의미

#### `bind: "loopback"`

Gateway가 `127.0.0.1`에만 바인딩합니다.
외부에서 Gateway에 직접 접근할 수 없고, **반드시 Tailscale Serve를 통해서만** 접근 가능합니다.

#### `trustedProxies: ["127.0.0.1", "::1"]`

Tailscale Serve는 같은 머신의 `127.0.0.1`에서 프록시 요청을 보냅니다.
Gateway는 이 IP에서 오는 `X-Forwarded-For` 헤더를 신뢰하여 실제 클라이언트 IP를 인식합니다.

#### `tls.enabled: true`

Gateway 자체도 mkcert 인증서로 TLS를 활성화합니다.
Tailscale Serve가 `https+insecure://`로 프록시할 때 Gateway가 TLS를 사용해야 하므로 필요합니다.
`autoGenerate: false`는 별도 생성한 인증서(`~/.openclaw/gateway/tls/`)를 사용한다는 의미입니다.

#### `dangerouslyDisableDeviceAuth: false`

Device identity 인증을 활성화합니다. Tailscale Serve 전환 후 모든 기기에서 secure context가 보장되므로 안전하게 활성화할 수 있습니다.

#### `allowedOrigins`

Tailscale FQDN 기반 origin을 포함합니다:
- `https://brucechoe-macstudio.tailcc76d6.ts.net` — Tailscale Serve 기본 origin
- `https://...ts.net:4000` — Vite dev server (Tailscale 경유)
- `file://` — Electron 앱의 `file://` origin

---

## 5. Ed25519 Device Identity 프로토콜

### 개요

Gateway v3 프로토콜은 WebSocket 연결 시 **device identity**를 요구합니다.
각 클라이언트(브라우저, Electron 앱)가 고유한 Ed25519 키 쌍을 생성하고, 서버의 challenge에 서명하여 인증합니다.

### 키 생성: Web Crypto API

```ts
// apps/web/src/adapters/crypto.ts
const keyPair = await crypto.subtle.generateKey(
  "Ed25519",
  false,          // extractable: false (private key는 추출 불가)
  ["sign", "verify"]
);

// raw public key 추출 (32 bytes)
const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
```

- **알고리즘**: Ed25519 (이전 ECDSA P-256에서 전환, IndexedDB v1 → v2)
- **저장소**: IndexedDB (`intelli-claw-device` DB, `keys` 스토어, key ID: `"primary"`)
- `extractable: false` — private key는 IndexedDB에서 `CryptoKey` 객체로만 존재

### Device ID 파생

```ts
async function deriveDeviceId(rawPublicKey: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", rawPublicKey);
  return bufToHex(hash);  // 64-character hex string
}
```

- 입력: raw 32-byte Ed25519 public key
- 해시: SHA-256 → 32 bytes
- 출력: hex 인코딩 → 64-character string
- 예: `83edb92d248a045a9fa8705e4e3f86aafac6704aef01ceb5642031a69b6f01b5`

### Public Key 전송 형식

```ts
function toBase64Url(buf: ArrayBuffer): string {
  // standard base64 → +를 -로, /를 _로, trailing = 제거
}

// public key: base64url(raw 32 bytes)
return { id: device.id, publicKey: toBase64Url(device.publicKeyRaw) };
```

- raw 32-byte Ed25519 public key를 **base64url** 인코딩하여 전송
- 예: `EeQ4EnmF6gR3DeHOKzzmmMImnyHzZV18jLv7Uh1uZlw`

### v3 Signature Payload

서버가 challenge nonce를 보내면, 클라이언트는 다음 형식의 문자열에 서명합니다:

```
v3|{deviceId}|{clientId}|{mode}|{role}|{scopes}|{signedAt}|{token}|{nonce}|{platform}|{deviceFamily}
```

실제 값 예시:

```
v3|83edb92d...|openclaw-control-ui|ui|operator|operator.read,operator.write,operator.admin|1769840312023|7839b9c1...|abc123|web|
```

구현 코드 (`packages/shared/src/gateway/client.ts`):

```ts
const payload = [
  "v3",
  keyPair.id,           // device ID (SHA-256 hex)
  clientId,             // "openclaw-control-ui"
  clientMode,           // "ui"
  role,                 // "operator"
  scopes.join(","),     // "operator.read,operator.write,operator.admin"
  String(signedAt),     // Unix ms timestamp
  this.token,           // gateway auth token
  nonce,                // challenge nonce from server
  platform,             // "web"
  "",                   // deviceFamily (empty)
].join("|");

const signature = await cryptoAdapter.sign(DEVICE_KEY_ID, payload);
```

### Connect Request (전체 구조)

```jsonc
{
  "minProtocol": 3,
  "maxProtocol": 3,
  "client": {
    "id": "openclaw-control-ui",
    "version": "1.0.0",
    "platform": "web",
    "mode": "ui"
  },
  "role": "operator",
  "scopes": ["operator.read", "operator.write", "operator.admin"],
  "auth": { "token": "<gateway-token>" },
  "device": {
    "id": "<SHA-256 hex of public key>",
    "publicKey": "<base64url raw 32-byte Ed25519 public key>",
    "signature": "<base64url Ed25519 signature>",
    "signedAt": 1769840312023,
    "nonce": "<challenge nonce>"
  }
}
```

### Handshake Flow

```
Client                          Server
  │                               │
  │──── WebSocket connect ───────→│
  │                               │
  │←── event: connect.challenge ──│  { nonce: "..." }
  │                               │
  │──── req: connect ────────────→│  { device: { id, publicKey, signature, ... } }
  │                               │
  │←── res: connect (HelloOk) ───│  { auth: { deviceToken, role, scopes } }
  │                               │
```

### ECDSA P-256과의 차이

| 항목 | ECDSA P-256 (이전) | Ed25519 (현재) |
|------|-------------------|----------------|
| 키 크기 | public: 65 bytes (uncompressed) | public: 32 bytes |
| Device ID | SHA-256 of JWK JSON | SHA-256 of raw 32-byte public key |
| Public key 전송 | JWK JSON 문자열 | base64url raw bytes |
| Signature | r \|\| s (64 bytes) | Ed25519 signature (64 bytes) |
| IndexedDB version | v1 | v2 |
| Web Crypto 지원 | 모든 브라우저 | Chrome 113+, Safari 17+, Firefox 130+ |

> **주의:** ECDSA P-256에서 Ed25519로 전환하면 IndexedDB가 v1 → v2로 업그레이드되며, **기존 키 쌍은 삭제됩니다.** 새 키 쌍 생성 후 device re-pairing이 필요합니다.

---

## 6. Vite Dev Server 설정

### vite.config.ts

```ts
// apps/web/vite.config.ts
export default defineConfig({
  server: {
    port: 4000,
    host: "127.0.0.1",  // ← loopback only
    allowedHosts: process.env.ALLOWED_HOSTS?.split(",").map(h => h.trim()) || [],
    https: httpsConfig, // mkcert 인증서 (Tailscale Serve가 프록시)
    hmr: {
      host: "localhost", // HMR WebSocket은 localhost로 연결
    },
  },
});
```

### `host: "127.0.0.1"` vs `host: true`

| 설정 | bind 주소 | 동작 |
|------|----------|------|
| `host: "127.0.0.1"` | 127.0.0.1만 | Tailscale Serve와 포트 공존 가능 |
| `host: true` | 0.0.0.0 (모든 인터페이스) | Tailscale Serve와 포트 충돌 |

Tailscale Serve는 Tailscale 인터페이스(100.x.x.x)에서 같은 포트를 사용합니다.
Vite가 `0.0.0.0`에 바인딩하면 포트 충돌이 발생하므로, **반드시 `127.0.0.1`로 설정**해야 합니다.

### 환경변수 (.env.local)

```bash
# 프로젝트 루트 또는 apps/web/.env.local
VITE_GATEWAY_URL=wss://brucechoe-macstudio.tailcc76d6.ts.net:18789
VITE_GATEWAY_TOKEN=<gateway-auth-token>
ALLOWED_HOSTS=brucechoe-macstudio,brucechoe-macstudio.tailcc76d6.ts.net
```

- `VITE_GATEWAY_URL`: Tailscale FQDN 기반 WebSocket URL (`wss://`)
- `ALLOWED_HOSTS`: Vite의 `allowedHosts`에 전달되는 호스트 목록

### HMR WebSocket 설정

```ts
hmr: {
  host: "localhost",
}
```

HMR은 개발자 로컬 브라우저에서만 사용하므로 `localhost`로 충분합니다.
원격에서 HMR이 필요하면 Tailscale 호스트명으로 변경하세요.

---

## 7. Electron Desktop 앱

### 빌드 및 실행

```bash
# 개발 모드
pnpm --filter desktop dev

# 프로덕션 빌드
cd apps/desktop
pnpm electron-vite build
pnpm electron-builder --mac
```

### 프로덕션 vs Dev 모드

| 항목 | Dev 모드 | 프로덕션 |
|------|---------|---------|
| UI 로드 | Vite dev server (localhost:4000) | 빌드된 정적 파일 |
| userData 경로 | `<default>-dev` (분리됨) | 기본 경로 |
| 인증서 검증 | 비활성화 (자체서명 허용) | 비활성화 |

### Origin 헤더 재작성

Electron의 WebSocket 요청은 `file://` 또는 `http://localhost` origin을 보냅니다.
Gateway의 `allowedOrigins` 검증을 통과하기 위해 origin을 재작성합니다:

```ts
// apps/desktop/src/main/index.ts
win.webContents.session.webRequest.onBeforeSendHeaders(
  { urls: ["wss://*/*", "ws://*/*"] },
  (details, callback) => {
    const gatewayUrl = new URL(details.url);
    details.requestHeaders["Origin"] = `https://${gatewayUrl.hostname}:4000`;
    callback({ requestHeaders: details.requestHeaders });
  },
);
```

### 별도 Device Identity

Electron 앱은 브라우저와 **별도의 IndexedDB**를 사용합니다:
- Dev 모드: `<userData>-dev/IndexedDB/`
- 프로덕션: `<userData>/IndexedDB/`

따라서 Chrome 브라우저와 Electron 앱은 **각각 별도의 Ed25519 키 쌍을 생성**하며, **각각 device pairing이 필요**합니다.

### 인증서 처리

Electron은 자체서명 인증서를 허용합니다:

```ts
app.on("certificate-error", (event, _wc, _url, _err, _cert, callback) => {
  event.preventDefault();
  callback(true); // 모든 인증서 허용
});
```

---

## 8. Device Pairing

### 개요

Device identity가 활성화된 상태(`dangerouslyDisableDeviceAuth: false`)에서는, 새 device가 Gateway에 처음 연결하면 **pending** 상태가 됩니다. 관리자가 승인해야 연결이 활성화됩니다.

### Device 목록 확인

```bash
openclaw devices list
```

출력 예시:

```
Pending devices:
  Request ID: abc123
  Device ID: 83edb92d...
  Platform: web
  Requested: 2026-03-01T10:00:00Z

Paired devices:
  Device ID: 7f4a2e1b...
  Platform: web
  Paired: 2026-02-28T15:30:00Z
```

### Device 승인

```bash
openclaw devices approve <request-id>
```

### 각 클라이언트별 Pairing

| 클라이언트 | IndexedDB | Device ID | Pairing |
|-----------|-----------|-----------|---------|
| Chrome 브라우저 | 브라우저 프로파일별 | 고유 | 별도 필요 |
| Electron (dev) | `<userData>-dev` | 고유 | 별도 필요 |
| Electron (prod) | `<userData>` | 고유 | 별도 필요 |
| 다른 브라우저/프로파일 | 각각 별도 | 고유 | 별도 필요 |

> **Tip:** Chrome 시크릿 모드나 브라우저 데이터 삭제 시 IndexedDB가 초기화되며, 새 키 쌍이 생성됩니다. 이 경우 re-pairing이 필요합니다.

---

## 9. 트러블슈팅

### `control ui requires device identity`

**증상:** WebSocket 연결 시 서버가 device identity를 요구하지만 클라이언트가 제공하지 못함

**원인:**
- 페이지가 secure context가 아닌 경우 (`http://`로 접속, localhost 제외)
- `crypto.subtle`이 undefined → Ed25519 키 생성 불가

**해결:**
- `https://` URL로 접속 (Tailscale Serve 경유)
- 또는 `http://localhost:4000`으로 접속 (localhost는 secure context)

---

### `device identity mismatch`

**증상:** 연결 시 `device_identity_mismatch` 에러

**원인:** 클라이언트가 보낸 device ID와 서버가 기대하는 ID가 다름. 주로 ECDSA P-256 → Ed25519 전환 시 발생.

**해결:**
1. 브라우저 DevTools → Application → IndexedDB → `intelli-claw-device` 삭제
2. 페이지 새로고침 → 새 Ed25519 키 쌍 자동 생성
3. `openclaw devices approve` 로 새 device 승인

---

### `device-signature-invalid`

**증상:** 서명 검증 실패

**원인:**
- Signature payload 형식이 서버 기대와 불일치
- v3 프로토콜의 pipe-delimited 형식이 아닌 이전 형식(`nonce:signedAt`) 사용
- 또는 token/scopes 값이 서명 시점과 전송 시점에서 다름

**해결:**
- 클라이언트 코드가 v3 payload 형식을 사용하는지 확인
- 서명에 포함되는 token이 실제 전송하는 token과 동일한지 확인
- 시계 동기화 확인 (signedAt 타임스탬프)

---

### `NOT_PAIRED` / `pairing required`

**증상:** 연결은 되지만 `NOT_PAIRED` 응답

**원인:** Device가 서버에 등록되었으나 관리자 승인이 되지 않은 상태

**해결:**
```bash
# pending device 확인
openclaw devices list

# 승인
openclaw devices approve <request-id>
```

---

### Vite 포트 충돌

**증상:** Vite dev server 시작 시 포트가 이미 사용 중이라는 에러, 또는 Tailscale Serve가 연결 불가

**원인:** `vite.config.ts`에서 `host: true` (0.0.0.0)로 설정하면 Tailscale Serve와 포트 충돌

**해결:**
```ts
// vite.config.ts
server: {
  host: "127.0.0.1",  // ✅ loopback만 사용
  // host: true,       // ❌ 0.0.0.0 bind → Tailscale Serve와 충돌
}
```

Vite가 `127.0.0.1:4000`에 바인딩하면, Tailscale Serve는 `100.x.x.x:4000`에 바인딩하여 공존합니다.

---

### `errSecInternalComponent` (macOS codesign)

**증상:** Electron 빌드 시 코드서명 에러

```
Error: ... errSecInternalComponent
```

**원인:** macOS keychain이 잠겨있거나 codesign에 필요한 인증서에 접근 불가

**해결:**
```bash
# Keychain 잠금 해제
security unlock-keychain -p "<password>" ~/Library/Keychains/login.keychain-db

# 또는 codesign 건너뛰기 (로컬 테스트용)
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron-builder --mac
```

---

## 부록: 네트워크 다이어그램

```
                         Tailnet
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌──────────┐     Tailscale Serve      ┌────────────┐  │
│  │  iPad     │◀──(LE cert, HTTPS)─────▶│ Mac Studio │  │
│  │  iPhone   │                          │            │  │
│  │  Other PC │     Port 18789 ─────────▶│ Gateway    │  │
│  │           │     Port 4000  ─────────▶│ Vite Dev   │  │
│  └──────────┘                          │            │  │
│                                         │ 127.0.0.1  │  │
│                                         │ only       │  │
│                                         └────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 부록: 모바일 (Expo) 참고사항

모바일 앱(`apps/mobile`)은 Web Crypto API 대신 `@noble/curves/ed25519`로 Ed25519를 구현합니다.
React Native 환경에서 Web Crypto API가 없으므로 pure JS 구현체를 사용합니다.

| 항목 | Web/Electron | Mobile (Expo) |
|------|-------------|---------------|
| 키 생성 | `crypto.subtle.generateKey("Ed25519")` | `@noble/curves/ed25519` + `expo-crypto` (랜덤 바이트) |
| 저장소 | IndexedDB (DB v2) | expo-secure-store (Keychain/Keystore) |
| Device ID | `SHA-256(raw public key)` → hex | `sha256(raw public key)` → hex (동일) |
| Public key 형식 | base64url(raw 32 bytes) | base64url(raw 32 bytes) (동일) |
| Signing | `crypto.subtle.sign("Ed25519", ...)` | `ed25519.sign(msg, privateKey)` |
| 키 prefix | N/A (IndexedDB key) | `iclaw_ed_pk_`, `iclaw_ed_pub_`, `iclaw_ed_id_` |

### 모바일 Gateway URL 캐싱 주의

모바일 앱은 Gateway URL을 **MMKV/AsyncStorage**에 캐싱합니다 (키: `awf:gateway-config`).
`.env.local`보다 캐시가 우선하므로, URL을 변경해도 앱에 반영되지 않을 수 있습니다.

**해결:** 앱 설정 화면에서 직접 Gateway URL을 수정하세요.

### 모바일 allowedOrigins

React Native WebSocket은 Gateway URL 자체를 `Origin` 헤더로 보냅니다.
따라서 `openclaw.json`의 `allowedOrigins`에 Gateway의 Tailscale Serve URL(포트 포함)을 추가해야 합니다:

```jsonc
"allowedOrigins": [
  // ... 기존 항목 ...
  "https://brucechoe-macstudio.tailcc76d6.ts.net:18789"  // 모바일 WebSocket origin
]
```
