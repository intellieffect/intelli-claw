# Development Environment Setup

intelli-claw는 Web Crypto API(ECDSA P-256)를 사용한 device identity 인증을 지원합니다.
Web Crypto API(`crypto.subtle`)는 **secure context**(HTTPS 또는 `localhost`)에서만 동작하므로,
localhost 이외의 환경에서 접속하려면 HTTPS 설정이 필요합니다.

---

## 목차

1. [기본 로컬 개발 (localhost)](#1-기본-로컬-개발-localhost)
2. [HTTPS 로컬 개발](#2-https-로컬-개발)
3. [LAN 접속 (같은 네트워크)](#3-lan-접속-같은-네트워크)
4. [Tailscale 원격 접속](#4-tailscale-원격-접속)
5. [모바일(iOS) 접속](#5-모바일ios-접속)
6. [Gateway 설정](#6-gateway-설정)
7. [트러블슈팅](#7-트러블슈팅)

---

## 1. 기본 로컬 개발 (localhost)

가장 간단한 방식입니다. `localhost`는 브라우저가 secure context로 취급하므로 HTTPS 없이도 `crypto.subtle`이 동작합니다.

```bash
pnpm install
pnpm dev --port 4000
```

브라우저에서 `http://localhost:4000` 접속.

> **Note:** 이 방식은 같은 머신의 브라우저에서만 접근 가능합니다.

---

## 2. HTTPS 로컬 개발

HTTPS를 사용하면 LAN/원격 접속의 기반이 됩니다. 프로젝트의 `scripts/start-dev.sh`가 HTTPS 모드로 dev server를 실행합니다.

### 2-1. mkcert 설치

```bash
# macOS
brew install mkcert

# 로컬 CA 설치 (최초 1회)
mkcert -install
```

### 2-2. 인증서 생성

```bash
# 프로젝트 루트에서 실행
mkdir -p certificates
mkcert -key-file certificates/localhost-key.pem \
       -cert-file certificates/localhost.pem \
       localhost 127.0.0.1 ::1
```

### 2-3. dev server 실행

```bash
./scripts/start-dev.sh
```

이 스크립트는 다음과 같이 동작합니다:
- 기존 dev server 프로세스 종료
- `.next` 캐시 삭제
- `--experimental-https` 옵션으로 HTTPS dev server 시작 (port 4000)
- `certificates/` 디렉토리의 인증서 사용
- 백그라운드(`nohup`)로 실행, 로그는 `/tmp/intelli-clawd-dev.log`

브라우저에서 `https://localhost:4000` 접속.

---

## 3. LAN 접속 (같은 네트워크)

같은 네트워크의 다른 PC/Mac에서 접속하려면 인증서에 호스트 정보를 추가해야 합니다.

### 3-1. 호스트명/IP 확인

```bash
# 호스트명 확인
hostname
# 예: brucechoe-macstudio

# LAN IP 확인
ipconfig getifaddr en0
# 예: 192.168.0.10
```

### 3-2. 인증서 재생성 (호스트명/IP 포함)

```bash
mkcert -key-file certificates/localhost-key.pem \
       -cert-file certificates/localhost.pem \
       localhost 127.0.0.1 ::1 \
       $(hostname) \
       $(ipconfig getifaddr en0)
```

### 3-3. Next.js allowedDevOrigins 설정

`next.config.ts`에 접속할 호스트명을 추가합니다:

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["your-hostname"],
};
```

> **왜 필요한가?** Next.js dev server는 기본적으로 `localhost` 이외의 origin에서 오는 HMR WebSocket 연결을 거부합니다. `allowedDevOrigins`에 호스트명을 추가해야 hot reload가 정상 동작합니다.

### 3-4. Gateway allowedOrigins 설정

원격 접속 origin을 Gateway에도 등록해야 합니다. [6. Gateway 설정](#6-gateway-설정) 참고.

### 3-5. dev server 재시작

```bash
./scripts/start-dev.sh
```

접속 클라이언트 브라우저에서 `https://<호스트명>:4000` 접속.

> **Important:** 접속하는 클라이언트 머신에도 mkcert CA 인증서를 설치해야 `ERR_CERT_AUTHORITY_INVALID` 에러가 발생하지 않습니다.
> 클라이언트가 macOS인 경우:
> ```bash
> # 서버 머신에서 CA 인증서 위치 확인
> mkcert -CAROOT
> # 예: /Users/you/Library/Application Support/mkcert
>
> # rootCA.pem을 클라이언트에 복사한 뒤, 클라이언트에서:
> sudo security add-trusted-cert -d -r trustRoot \
>   -k /Library/Keychains/System.keychain rootCA.pem
> ```

---

## 4. Tailscale 원격 접속

Tailscale을 사용하면 외부 네트워크에서도 안전하게 접속할 수 있습니다.

### 4-1. Tailscale IP/호스트명 확인

```bash
# Tailscale IP
tailscale ip -4
# 예: 100.107.218.100

# Tailscale 호스트명 (유료 플랜에서 MagicDNS 사용 시)
tailscale status
# 예: brucechoe-macstudio
```

### 4-2. 인증서에 Tailscale IP 추가

```bash
mkcert -key-file certificates/localhost-key.pem \
       -cert-file certificates/localhost.pem \
       localhost 127.0.0.1 ::1 \
       $(hostname) \
       $(ipconfig getifaddr en0) \
       $(tailscale ip -4)
```

### 4-3. 나머지 설정

- `next.config.ts`의 `allowedDevOrigins`에 Tailscale 호스트명 추가 (필요 시)
- Gateway `allowedOrigins`에 Tailscale origin 추가 ([6. Gateway 설정](#6-gateway-설정) 참고)
- `./scripts/start-dev.sh`로 재시작

### 무료 vs 유료 플랜

| 기능 | 무료 | 유료 |
|------|------|------|
| IP 기반 접속 | O | O |
| MagicDNS (호스트명) | O | O |
| HTTPS 인증서 (Let's Encrypt) | X | O |

> **Tip:** 유료 플랜의 Tailscale HTTPS 인증서를 사용하면 mkcert 없이도 신뢰할 수 있는 HTTPS 연결이 가능합니다. 자세한 내용은 [Tailscale HTTPS 문서](https://tailscale.com/kb/1153/enabling-https) 참고.

---

## 5. 모바일(iOS) 접속

iOS Safari에서 접속하려면 mkcert CA 인증서를 디바이스에 설치해야 합니다.

### 5-1. CA 인증서 파일 찾기

```bash
mkcert -CAROOT
# 예: /Users/you/Library/Application Support/mkcert
# → rootCA.pem 파일 사용
```

### 5-2. iOS로 전송

- **AirDrop**: rootCA.pem 파일을 iPhone/iPad로 전송
- 또는 이메일 첨부, 웹 서버 호스팅 등

### 5-3. 프로파일 설치

1. AirDrop 수신 후 **설정** 앱 상단에 "프로파일이 다운로드됨" 표시
2. 탭하여 **프로파일 설치** 진행
3. 비밀번호 입력 → **설치** 완료

### 5-4. 인증서 신뢰 활성화

1. **설정 → 일반 → 정보 → 인증서 신뢰 설정**
2. "mkcert ..." 항목의 스위치를 **켜기**

### 5-5. 접속

Safari에서 `https://<서버IP>:4000` 접속.

> **Note:** 인증서 생성 시 서버의 LAN IP 또는 Tailscale IP가 포함되어 있어야 합니다 ([3-2](#3-2-인증서-재생성-호스트명ip-포함) 또는 [4-2](#4-2-인증서에-tailscale-ip-추가) 참고).

---

## 6. Gateway 설정

intelli-claw는 OpenClaw Gateway에 WebSocket으로 연결합니다. HTTPS origin에서 접속할 경우, Gateway의 CORS 설정에 해당 origin을 등록해야 합니다.

### 6-1. openclaw.json 편집

`~/.openclaw/openclaw.json`의 `gateway.controlUi.allowedOrigins`에 접속 origin을 추가합니다:

```jsonc
{
  "gateway": {
    "controlUi": {
      "allowedOrigins": [
        // localhost (기본)
        "http://localhost:4000",
        "https://localhost:4000",

        // LAN 호스트명
        "http://your-hostname:4000",
        "https://your-hostname:4000",

        // LAN IP
        "http://192.168.0.10:4000",
        "https://192.168.0.10:4000",

        // Tailscale IP
        "http://100.x.x.x:4000",
        "https://100.x.x.x:4000"
      ]
    }
  }
}
```

### 6-2. Gateway 재시작

설정 변경 후 Gateway를 재시작해야 적용됩니다.

### 6-3. WebSocket URL 설정

`.env.local`의 `NEXT_PUBLIC_GATEWAY_URL`도 접속 환경에 맞게 설정합니다:

```bash
# localhost 접속
NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789

# LAN/Tailscale에서 접속하는 경우 (Gateway가 같은 서버에서 실행)
NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789
# 또는 서버 호스트명/IP로 변경:
# NEXT_PUBLIC_GATEWAY_URL=ws://your-hostname:18789
```

---

## 7. 트러블슈팅

### `crypto.subtle` is undefined

**증상:** 콘솔에 `Web Crypto API unavailable — requires HTTPS or localhost` 에러

**원인:** 브라우저가 현재 페이지를 secure context로 인식하지 못함

**해결:**
- `http://localhost:4000`으로 접속 (localhost는 예외적으로 secure context)
- 또는 HTTPS 설정 후 `https://...`로 접속 ([2. HTTPS 로컬 개발](#2-https-로컬-개발) 참고)

---

### ERR_CERT_AUTHORITY_INVALID

**증상:** 브라우저에서 "연결이 비공개로 설정되어 있지 않습니다" 경고

**원인:** mkcert의 로컬 CA가 접속 클라이언트에 설치되지 않음

**해결:**
- 서버 머신에서 `mkcert -CAROOT` 경로의 `rootCA.pem`을 클라이언트에 복사
- macOS 클라이언트: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain rootCA.pem`
- iOS: [5. 모바일(iOS) 접속](#5-모바일ios-접속) 참고
- 인증서에 접속하는 호스트명/IP가 포함되어 있는지 확인 (`mkcert` 실행 시 인자로 추가)

---

### origin not allowed

**증상:** WebSocket 연결 실패, Gateway 로그에 `origin not allowed`

**원인:** 접속 origin이 Gateway의 `allowedOrigins`에 등록되지 않음

**해결:**
- `~/.openclaw/openclaw.json`의 `gateway.controlUi.allowedOrigins`에 정확한 origin 추가
- origin 형식: `https://hostname:port` (경로 없이, 프로토콜+호스트+포트만)
- Gateway 재시작

---

### mkcert Java keystore 에러

**증상:** `mkcert -install` 실행 시 Java keystore 관련 에러

```
ERROR: failed to execute keytool: ...
```

**원인:** Java가 설치되어 있으나 keytool 접근 문제, 또는 Java keystore 경로 이상

**해결:**
- 무시해도 무방 — 브라우저용 CA 설치는 정상 진행됨
- Java 인증서 저장소에 CA를 설치할 필요가 없다면 에러를 무시
- Java가 필요한 경우: `JAVA_HOME` 환경변수 확인 후 재실행

---

### Next.js HMR WebSocket 연결 실패

**증상:** 페이지는 로드되지만 hot reload가 동작하지 않음, 콘솔에 WebSocket 에러

**원인:** `next.config.ts`의 `allowedDevOrigins`에 접속 호스트명이 없음

**해결:**
`next.config.ts`에 호스트명 추가:
```ts
allowedDevOrigins: ["your-hostname"],
```
dev server 재시작.

---

## 요약: 시나리오별 체크리스트

| 시나리오 | mkcert 인증서 | allowedDevOrigins | Gateway allowedOrigins | 클라이언트 CA 설치 |
|----------|:---:|:---:|:---:|:---:|
| localhost (HTTP) | - | - | - | - |
| localhost (HTTPS) | O | - | O | - |
| LAN 접속 | O (호스트명/IP 포함) | O | O | O |
| Tailscale 접속 | O (Tailscale IP 포함) | O | O | O |
| iOS 접속 | O (IP 포함) | - | O | O (프로파일 설치) |
