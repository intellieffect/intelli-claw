# intelli-claw

Claude Code Channel 기반 AI 채팅 클라이언트 — pnpm 모노레포.

## 아키텍처 한 줄

로컬 Claude Code 세션과 브라우저 UI를 잇는 **Channel 플러그인**(MCP stdio) 위에 얇은 React 웹 앱을 올린 구조. OpenClaw 게이트웨이를 완전히 제거하고 Anthropic 공식 Channels Research Preview(v2.1.80+)에 직접 정렬.

Phase 0 사양 문서: `docs/redesign/channels-spec.md`.
재설계 Plan: `~/.claude/plans/tingly-sniffing-otter.md`.

## 패키지 레이아웃

```
packages/
└── shared/                       # @intelli-claw/shared — 공유 코드
    └── src/
        ├── channel/              # ChannelClient, ChannelProvider, useChannel, 프로토콜 타입
        ├── utils/                # cn, message-grouping, thinking-parser
        └── index.ts

plugins/
└── intelli-claw-channel/         # @intelli-claw/channel — Claude Code channel 플러그인
    ├── .claude-plugin/plugin.json
    ├── .mcp.json                 # Bun stdio MCP 서버 spawn
    ├── server.ts                 # 메인 엔트리 (~380 LOC)
    └── server.test.ts            # 26 tests

apps/
└── web/                          # @intelli-claw/web — Vite + React 19 SPA
    └── src/
        ├── main.tsx
        ├── App.tsx               # <ChannelProvider> + <ChannelChatView>
        ├── components/
        │   ├── chat/
        │   │   ├── channel-chat-view.tsx   # minimal UI (270 LOC)
        │   │   └── markdown-renderer.tsx
        │   └── ui/               # shadcn
        ├── lib/                  # theme, utils, platform, excalidraw
        └── __tests__/            # 3 files: 2 regression guards + channel-client

# 일시 제외 — Phase 4에서 Channel 기반으로 재작업:
# apps/desktop, apps/mobile — pnpm-workspace.yaml에서 제외됨, 소스는 트리 보존.
```

## Tech Stack

- **Framework**: Vite 6 + React 19 + TypeScript (strict)
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york)
- **Channel plugin**: Bun + `@modelcontextprotocol/sdk` + HTTP/WS (stdio MCP)
- **State**: React hooks + `useChannel`
- **Test**: Vitest (web) + Bun test (plugin)
- **Package manager**: pnpm 10 workspaces + Turborepo

## 명령어

```sh
# 웹 개발 서버 (port 4000)
scripts/start-dev.sh
# 또는:
pnpm dev

# Channel 플러그인 단독 기동 (개발용, Claude Code 없이 HTTP/WS만)
cd plugins/intelli-claw-channel && bun server.ts

# 최초 1회 — 저장소를 로컬 마켓플레이스로 등록
claude plugin marketplace add "$PWD"
claude plugin install intelli-claw-channel@intelli-claw

# Claude Code 세션에 플러그인 연결 (실제 사용)
claude --dangerously-load-development-channels plugin:intelli-claw-channel@intelli-claw

# 전체 빌드
pnpm build

# 테스트
pnpm test          # turbo run test (web vitest + plugin bun test)
```

## MUST DO

- **기능 구현 후 반드시 E2E** — Vitest 유닛만으로 끝내지 말 것. `scripts/start-dev.sh` + 채널 플러그인 기동 후 브라우저로 동작 확인.
- 환경변수: `VITE_CHANNEL_URL` (기본 `http://127.0.0.1:8790`), `VITE_CHANNEL_TOKEN` (LAN 모드에서만).
- 경로 alias: `@/` → `apps/web/src/`. 공유 코드는 `@intelli-claw/shared`.
- UI 컴포넌트는 shadcn/ui 패턴 (`components.json`). CSS class 조합은 `cn()` 유틸.
- Channel 프로토콜 변경 시 **플러그인 server.ts + shared/channel/protocol.ts 동시 수정** — Wire 타입이 갈리면 런타임 파싱이 silently fail.
- 회귀 가드 2종(`active-imports-no-gateway`, `active-code-no-gateway-rpc`) 통과 확인.

## MUST NOT DO

- `npm` 사용 금지 — pnpm 만.
- `.env.local` 커밋 금지.
- `apps/web/src/components/ui/` 내 shadcn 컴포넌트 직접 수정 금지 — 래퍼로 확장.
- **OpenClaw gateway, WebSocket protocol v3, ACP 관련 코드 부활 금지** — Phase 3에서 전부 제거됨. 필요 기능은 Channel 플러그인 tool로 추가.
- **`sessions.patch` / `sessions.delete` / `chat.send` RPC 호출 금지** — Channel contract에 없음. 회귀 가드가 CI 실패로 잡아냄.
- **플러그인 서버를 loopback 외 주소로 바인드 금지** — 기본 `127.0.0.1`. LAN 모드 추가는 별도 pairing 설계와 함께 Phase 4.
- **MCP 메시지 meta에 하이픈 포함 키 사용 금지** — Claude Code가 XML attribute로 삽입하므로 silently drop. snake_case만.

## Channel 프로토콜 요약

### Inbound (UI → Claude)
HTTP `POST /send` (JSON) 또는 `POST /upload` (multipart) → 플러그인이 MCP `notifications/claude/channel` 발행 → Claude context에 다음 태그로 삽입:

```xml
<channel source="intelli-claw" session_id="main" message_id="u123" user="web">
본문
</channel>
```

### Outbound (Claude → UI)
MCP tool call:
- `reply(text, reply_to?, files?, session_id?)` — 메시지 전송
- `edit_message(message_id, text)` — 기존 메시지 편집
- `session_switch(session_id, note?)` — 활성 세션 변경 알림

플러그인이 브라우저 WS로 broadcast → React 상태가 업데이트.

### 상태 저장 위치
`~/.claude/channels/intelli-claw/{inbox,outbox}` — inbound 업로드 / outbound 첨부. `assertSendable()` 가드가 state 디렉터리 유출을 차단.

## 테스트 규칙

- 플러그인 (bun test): `pnpm --filter @intelli-claw/channel test` — 26 tests, 커버리지 90%+.
- 웹 (vitest): `pnpm --filter @intelli-claw/web exec vitest run` — 20 tests (guard 10 + channel-client 10).
- 회귀 가드가 있으므로 새 코드에서 실수로 OpenClaw 아티팩트 재도입 시 CI가 잡는다.

## 컨벤션

- 컴포넌트: PascalCase 파일명.
- 테스트: `apps/web/src/__tests__/*.test.ts(x)` 또는 `plugins/*/server.test.ts`.
- 커밋: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- PR: squash merge.

## Phase 로드맵

- **Phase 0 ✅** Channels 사양 확정 (`docs/redesign/channels-spec.md`).
- **Phase 1 ✅** Channel 플러그인 구현 + 26 tests.
- **Phase 2 ✅** 웹 UI 재배선 (ChannelProvider + minimal ChannelChatView).
- **Phase 3 ✅** OpenClaw 전면 제거 (gateway/adapters/lib/gateway, dead 컴포넌트, dead 테스트).
- **Phase 4 (계획)** Electron/Mobile을 Channel 기반으로 재구현. LAN/Tailscale HTTPS + pairing.
- **Phase 5 (선택)** 자체 플러그인 마켓플레이스 퍼블리시.
