# Architecture

## Overview

intelli-claw는 Claude Code 세션과 브라우저 UI를 잇는 **Claude Code Channel 플러그인**과 그 플러그인에 붙는 **React 웹 앱**으로 구성됩니다. Anthropic 공식 Channels(v2.1.80+, Research Preview) 위에 직접 정렬되어 있으며, OpenClaw Gateway나 자체 WebSocket 프로토콜은 사용하지 않습니다.

## 데이터 흐름

```
사용자
  │ 타이핑
  ▼
[브라우저 UI — apps/web]
  │ HTTP POST /send  또는  POST /upload
  ▼
[Channel 플러그인 — plugins/intelli-claw-channel/server.ts]
  │ MCP notifications/claude/channel  (stdio)
  ▼
[Claude Code 세션]
  │ MCP tool call: reply / edit_message / session_switch
  ▼
[Channel 플러그인]
  │ WebSocket /ws broadcast
  ▼
[브라우저 UI]
```

### Inbound — 사용자 메시지

1. 브라우저가 `POST /send` (JSON) 또는 `POST /upload` (multipart) 전송
2. 플러그인이 `notifications/claude/channel` MCP notification을 stdio로 발행
3. Claude Code가 notification을 받아 세션에 다음 태그로 삽입:

```xml
<channel source="intelli-claw" session_id="main" message_id="u123" user="web">
사용자 본문
</channel>
```

### Outbound — Claude 회신

1. Claude가 `reply(text, files?, session_id?)` MCP tool 호출
2. 플러그인이 `outbox/`에 파일 복사 후 `/ws` 구독자 전체에 JSON 프레임 broadcast
3. React 상태가 업데이트되어 UI에 표시

## 주요 컴포넌트

### Channel 플러그인 (`plugins/intelli-claw-channel/`)

- **Entry**: `server.ts` — Bun 스크립트, `.mcp.json`에 의해 Claude Code가 subprocess로 spawn
- **MCP capability**: `experimental['claude/channel']: {}` opt-in
- **Tools**: `reply`, `edit_message`, `session_switch`
- **HTTP server**: `127.0.0.1:<PORT>` (기본 8790, `INTELLI_CLAW_PORT` 환경변수로 override)
  - `GET /config` — 플러그인 메타, 활성 세션, 도구 목록
  - `POST /send` — JSON body
  - `POST /upload` — multipart body
  - `GET /files/<name>` — outbox 서빙
  - `WS /ws` — 메시지 broadcast
- **State**: `~/.claude/channels/intelli-claw/{inbox,outbox}` (0700)
- **Security**: `assertSendable()` — state 디렉터리 밖 혹은 inbox 내부만 첨부 허용

### Shared 모듈 (`packages/shared/src/channel/`)

- `protocol.ts` — Wire 타입 (서버와 byte-identical 유지 필수)
- `client.ts` — `ChannelClient` (HTTP/WS 클라이언트, 자동 재연결)
- `hooks.tsx` — `ChannelProvider` + `useChannel` React 훅

### Web 앱 (`apps/web/`)

- `main.tsx` → `App.tsx` → `ChannelProvider` → `ChannelChatView`
- `ChannelChatView` (~270 LOC): 헤더(세션 드롭다운 + 연결 뱃지), 메시지 리스트(markdown-renderer), 입력창(Enter 전송, 파일 첨부)
- Vite dev server: `http://localhost:4000`, 플러그인은 `http://127.0.0.1:8790`

## 보안 경계

- 플러그인은 기본 loopback(`127.0.0.1`) — 로컬호스트 모든 프로세스가 접근 가능. 공유 머신에서 실행 금지.
- LAN 모드(Phase 4 계획): `VITE_CHANNEL_TOKEN` Bearer auth + pairing code. 아직 미구현.
- `assertSendable()`이 `.env` 등 플러그인 자체 상태를 reply에 실어 보내는 것을 차단.
- CORS allowlist: `http://localhost:4000`, `http://localhost:4100`, `app://` (Electron 향후).

## 세션 모델

Claude Code는 단일 세션. intelli-claw UI는 "세션 드롭다운"으로 여러 역할(main/scout/biz-ops/…)을 구분하지만, 이는 **플러그인이 meta에 `session_id`를 담아 Claude에게 힌트를 주는 수준**. 실제로는 한 Claude Code 프로세스가 전부 처리. 진짜 독립 세션을 원하면 별도 Claude Code 프로세스를 기동.

## 회귀 가드

- `apps/web/src/__tests__/active-imports-no-gateway.test.ts` — 활성 엔트리 3종에 OpenClaw gateway import 금지
- `apps/web/src/__tests__/active-code-no-gateway-rpc.test.ts` — 활성 7 파일에 `sessions.patch|delete|chat.send` RPC 문자열 0건
- `plugins/intelli-claw-channel/server.test.ts` — 플러그인 계약 26 tests (unit + HTTP/WS 통합)

## Phase 로드맵

- Phase 0–3 완료
- Phase 4 (계획): Electron/Mobile 플랫폼 Channel 기반 재구현, LAN 모드
- Phase 5 (선택): 자체 마켓플레이스 퍼블리시
