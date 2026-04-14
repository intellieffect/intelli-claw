# Dev Setup

## Prerequisites

- Node 22+
- pnpm 10 (`corepack enable && corepack prepare pnpm@10.12.4 --activate`)
- Bun (`brew install oven-sh/bun/bun`) — 플러그인 런타임
- Claude Code CLI (Pro/Max/Team 구독 필요) — 실제 end-to-end 테스트용

## 설치

```sh
pnpm install
```

`apps/desktop`, `apps/mobile`은 pnpm workspace에서 제외되어 있습니다 (Phase 4에서 재작업 예정).

## 개발 흐름

### 0. 로컬 마켓플레이스 등록 (최초 1회)

저장소 루트의 `.claude-plugin/marketplace.json`을 사용해 Claude Code에 마켓플레이스를 등록합니다:

```sh
claude plugin marketplace add /절대/경로/intelli-claw
claude plugin install intelli-claw-channel@intelli-claw
```

정상 등록 시 `Successfully installed plugin: intelli-claw-channel@intelli-claw (scope: user)` 가 출력됩니다. 업데이트는 `claude plugin update intelli-claw-channel` 또는 `claude plugin marketplace update intelli-claw`.

### 1. Channel 플러그인 기동

두 가지 방식:

```sh
# (A) Claude Code 세션에 붙여서 — 실제 사용 모드
claude --dangerously-load-development-channels plugin:intelli-claw-channel@intelli-claw

# (B) 플러그인 단독 기동 — UI만 테스트하고 싶을 때 (Claude와 연결 안 됨)
cd plugins/intelli-claw-channel && bun server.ts
```

플러그인이 stderr에 URL을 출력합니다:

```
intelli-claw-channel: http://127.0.0.1:8790
```

환경변수:
- `INTELLI_CLAW_PORT` — HTTP/WS 포트 (기본 8790)
- `INTELLI_CLAW_HOST` — 바인드 주소 (기본 127.0.0.1)

### 2. 웹 dev server 기동

```sh
scripts/start-dev.sh
# 또는:
pnpm dev
```

Vite가 `http://localhost:4000`에서 서빙하고 `VITE_CHANNEL_URL`(기본 `http://127.0.0.1:8790`)로 플러그인에 연결합니다.

### 3. 브라우저에서 접속

`http://localhost:4000` 열기. 연결 상태가 "연결됨"(초록)이면 준비 완료.

## 환경변수

`apps/web/.env.local`:

```
VITE_CHANNEL_URL=http://127.0.0.1:8790
# VITE_CHANNEL_TOKEN=  # LAN 모드에서만 필요 (Phase 4)
```

## 테스트

```sh
# 전체
pnpm test

# 웹만 (Vitest)
pnpm --filter @intelli-claw/web exec vitest run

# 플러그인만 (Bun test)
pnpm --filter @intelli-claw/channel test
```

### 회귀 가드

- `active-imports-no-gateway.test.ts` — 활성 엔트리에 OpenClaw gateway 의존 import 금지
- `active-code-no-gateway-rpc.test.ts` — 활성 코드에 `sessions.patch|delete|chat.send` 문자열 0건

이 가드 2개가 CI에서 OpenClaw 아티팩트 재도입을 막습니다.

## 빌드

```sh
pnpm build     # turbo run build (shared + web)
```

Vite 프로덕션 빌드는 `apps/web/dist/`에 생성됩니다.

## 문제 해결

### "끊김" 상태가 지속

1. 플러그인 서버가 실행 중인지 확인: `curl http://127.0.0.1:8790/config`
2. 포트 충돌: `INTELLI_CLAW_PORT=8791 bun server.ts`
3. CORS 실패: 브라우저 DevTools Network 탭에서 OPTIONS 프리플라이트 응답 확인. 플러그인의 `ALLOWED_ORIGINS`에 없는 origin이면 차단됨.

### Claude가 메시지를 못 받음

- `--dangerously-load-development-channels` 플래그 없이 Claude Code를 기동했을 가능성. MCP 서버 자체는 spawn되지만 channel notification은 silently drop됨. 플래그 달고 재기동.

### 번들 크기 경고

`main-*.js` 2.4MB는 주로 `@excalidraw/excalidraw` + `react-markdown` 트랜스디펜던시. Phase 3 후속으로 dynamic import 도입 예정.

## Phase 4에서 이관될 것

- `apps/desktop/` — Electron 셸을 `ChannelProvider`로 재연결, Origin 재작성/crypto 초기화 제거
- `apps/mobile/` — Expo 앱을 LAN/Tailscale HTTPS + pairing으로 연결
- 자체 플러그인 마켓플레이스 등록 (현재는 `--dangerously-load-development-channels` 모드)
