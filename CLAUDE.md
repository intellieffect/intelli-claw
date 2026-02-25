# intelli-claw

OpenClaw Gateway 기반 AI 에이전트 채팅 클라이언트 (Vite + Electron)

## Tech Stack

- **Framework**: Vite + React 19 (SPA) + Electron (데스크톱)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york style)
- **State**: React hooks + IndexedDB (세션 영속화)
- **Protocol**: WebSocket (OpenClaw Gateway Protocol v3)
- **Test**: Vitest + Testing Library + jsdom
- **Package Manager**: pnpm
- **Desktop**: electron-vite + electron-builder

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── index.ts            # BrowserWindow, 프로토콜 등록
│   ├── ipc-handlers.ts     # IPC 핸들러 등록
│   ├── media-handler.ts    # 파일 서빙 로직
│   └── showcase-handler.ts # 쇼케이스 서빙 로직
├── preload/                # Electron preload (contextBridge)
│   └── index.ts
├── server/                 # 웹 전용 API 서버
│   └── api-server.ts       # 독립 실행 가능한 HTTP 서버
├── renderer/               # React SPA (렌더러)
│   ├── main.tsx            # React 엔트리포인트
│   ├── App.tsx             # 루트 컴포넌트
│   ├── env.d.ts            # Vite 환경변수 타입
│   ├── components/
│   │   ├── chat/           # 채팅 UI
│   │   ├── settings/       # 설정 패널
│   │   ├── showcase/       # 쇼케이스
│   │   └── ui/             # 공통 UI (shadcn 기반)
│   ├── lib/
│   │   ├── gateway/        # WebSocket 클라이언트, 프로토콜, hooks
│   │   ├── platform/       # 플랫폼 추상화 (web/electron)
│   │   ├── hooks/          # 공통 React hooks
│   │   └── utils.ts        # cn() 등 유틸리티
│   └── styles/             # globals.css (Tailwind)
└── __tests__/              # Vitest 테스트
```

## Commands

```bash
# 웹 개발 서버 (port 4000 + API 4001)
scripts/start-dev.sh

# Electron 개발
pnpm dev:electron

# 프로덕션 빌드 + 서버 (port 4100)
scripts/start-prod.sh

# 웹 빌드만
pnpm build

# Electron 빌드
pnpm build:electron

# Electron 패키징 (.dmg)
pnpm package

# 테스트
pnpm test

# 린트
pnpm lint
```

## MUST DO

- 개발 서버는 **반드시 `scripts/start-dev.sh`** 사용
- Electron 개발은 `pnpm dev:electron`
- 경로 alias는 `@/` 사용 → `src/renderer/`로 해석 (e.g. `@/components/ui/button`)
- UI 컴포넌트는 `shadcn/ui` 패턴 따를 것 (components.json 참고)
- CSS class 조합 시 `cn()` 유틸리티 사용
- WebSocket 통신은 `src/renderer/lib/gateway/` 내 클라이언트/프로토콜 사용
- 파일 서빙 API는 `src/renderer/lib/platform/` 추상화 레이어를 통해 접근

## MUST NOT DO

- `npm` 사용 금지 — **pnpm** 만 사용
- `.env.local`을 커밋하지 말 것 (gateway token 포함)
- `src/renderer/components/ui/` 내 shadcn 컴포넌트를 직접 수정하지 말 것 (래퍼 만들어 확장)
- `/api/media`, `/api/showcase` 하드코딩 금지 — `platform` API 사용

## Conventions

- 컴포넌트: PascalCase 파일명 (kebab-case도 혼용 중)
- hooks: `use-*.ts` 또는 `hooks.tsx`
- 테스트: `src/__tests__/*.test.ts(x)`
- 커밋 메시지: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`)
- PR: squash merge

## Gateway Protocol

WebSocket 프레임 기반 통신 (`src/renderer/lib/gateway/protocol.ts`):
- `ReqFrame` → 요청, `ResFrame` → 응답
- `EventFrame` → 서버 이벤트 (스트리밍, 상태 변경)
- Device identity: Web Crypto 기반 인증 (`device-identity.ts`)

## Platform Abstraction

`src/renderer/lib/platform/` — 웹/Electron 자동 감지:
- `platform.mediaUrl(path)` — 미디어 파일 URL 생성
- `platform.mediaGetInfo(path)` — 파일 메타데이터 조회
- `platform.showcaseList()` — 쇼케이스 목록
- `platform.showcaseUrl(path)` — 쇼케이스 파일 URL

## Environment

```
VITE_GATEWAY_URL=wss://...   # Gateway WebSocket URL
VITE_GATEWAY_TOKEN=...       # Gateway 인증 토큰
VITE_DEFAULT_AGENT=...       # 기본 에이전트 ID (선택)
```
