# intelli-claw

OpenClaw Gateway 기반 AI 에이전트 채팅 클라이언트 — pnpm 모노레포

## OpenClaw 참조

이 프로젝트는 OpenClaw 게이트웨이 위에서 동작한다. 에이전트 설정, 배포, 운영 컨텍스트는 아래를 참조:

- **OpenClaw 설정**: `~/.openclaw/` — 게이트웨이 설정, 에이전트 워크스페이스, 크론 잡
- **OpenClaw CLAUDE.md**: `~/.openclaw/CLAUDE.md` — 에이전트 구조, 배포 워크플로우, 핵심 규칙
- **에이전트 워크스페이스**: `~/.openclaw/workspace-intelliclaw/` — IntelliClaw 에이전트 전용 (IDENTITY, PLAYBOOK, MEMORY)
- **Gateway 프로토콜**: `wss://127.0.0.1:18789` (loopback TLS)
- **배포 (Desktop)**: `scripts/deploy.sh` → Electron 빌드 + Mac Studio/MacBook 배포
- **배포 (Mobile)**: `scripts/deploy-testflight.sh` → EAS Build + TestFlight 제출

## Tech Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Framework**: Vite + React 19 (SPA) + Electron (데스크톱)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york style)
- **State**: React hooks + IndexedDB (세션 영속화)
- **Protocol**: WebSocket (OpenClaw Gateway Protocol v3)
- **Test**: Vitest + Testing Library + jsdom
- **Package Manager**: pnpm
- **Desktop**: electron-vite + electron-builder
- **Mobile**: Expo + React Native (EAS Build → TestFlight)

## Project Structure

```
packages/
└── shared/                     # @intelli-claw/shared — 공유 코드
    └── src/
        ├── gateway/            # 프로토콜, 클라이언트, device-identity
        ├── hooks/              # GatewayProvider, useGateway, useCron 등
        ├── adapters/           # CryptoAdapter, StorageAdapter, PlatformAPI 인터페이스
        ├── utils/              # cn() 등 유틸리티
        └── index.ts            # Barrel export

apps/
├── web/                        # @intelli-claw/web — 웹 SPA
│   ├── src/
│   │   ├── main.tsx            # React 엔트리포인트
│   │   ├── App.tsx             # 루트 컴포넌트
│   │   ├── adapters/           # WebCryptoAdapter, LocalStorageAdapter
│   │   ├── components/         # chat/, settings/, showcase/, ui/ (shadcn)
│   │   ├── lib/
│   │   │   ├── gateway/        # Re-export shims + web-specific hooks (hooks.tsx)
│   │   │   ├── platform/       # 플랫폼 추상화 (web/electron)
│   │   │   └── hooks/          # 웹 전용 hooks
│   │   ├── styles/             # globals.css (Tailwind)
│   │   └── __tests__/          # Vitest 테스트
│   ├── vite.config.ts
│   └── vitest.config.ts
├── desktop/                    # @intelli-claw/desktop — Electron 앱
│   ├── src/
│   │   ├── main/               # BrowserWindow, IPC, 프로토콜
│   │   └── preload/            # contextBridge
│   └── electron.vite.config.ts
├── mobile/                     # @intelli-claw/mobile — Expo React Native
│   ├── app/                    # expo-router 페이지
│   ├── eas.json                # EAS Build + Submit 설정
│   └── app.config.ts           # Expo 설정 (bundleId, projectId)
└── server/                     # @intelli-claw/server — 웹 API 서버
    └── src/
        └── api-server.ts
```

## Commands

```bash
# 웹 개발 서버 (port 4000 + API 4001)
scripts/start-dev.sh

# Electron 개발
pnpm dev:electron

# 프로덕션 빌드 + 서버 (port 4100)
scripts/start-prod.sh

# 전체 빌드 (turbo)
pnpm build

# Electron 빌드
pnpm build:electron

# Electron 패키징 (.dmg)
pnpm package

# 모바일 개발 (Expo)
pnpm dev:mobile

# TestFlight 배포 (빌드 + 제출)
pnpm deploy:testflight

# TestFlight 빌드만 (제출 없이)
scripts/deploy-testflight.sh --build-only

# TestFlight 제출만 (최신 빌드)
scripts/deploy-testflight.sh --skip-build

# 테스트
pnpm test

# 린트
pnpm lint
```

## MUST DO

- **기능 구현 후 반드시 E2E 테스트 수행** — 유닛 테스트만으로 끝내지 말 것. 실제 dev 서버(localhost:4000)에서 브라우저로 기능 동작 확인 필수. Chrome 자동화(claude-in-chrome) 또는 Playwright 사용.
- 개발 서버는 **반드시 `scripts/start-dev.sh`** 사용
- Electron 개발은 `pnpm dev:electron`
- 경로 alias는 `@/` 사용 → `apps/web/src/`로 해석 (e.g. `@/components/ui/button`)
- UI 컴포넌트는 `shadcn/ui` 패턴 따를 것 (components.json 참고)
- CSS class 조합 시 `cn()` 유틸리티 사용 (`@intelli-claw/shared`)
- WebSocket 통신은 `packages/shared/src/gateway/` 내 클라이언트/프로토콜 사용
- 파일 서빙 API는 `apps/web/src/lib/platform/` 추상화 레이어를 통해 접근
- 플랫폼 독립 코드는 `packages/shared`에 배치
- 어댑터 패턴: `CryptoAdapter` / `StorageAdapter` 인터페이스는 shared, 구현은 각 앱

## MUST NOT DO

- `npm` 사용 금지 — **pnpm** 만 사용
- `.env.local`을 커밋하지 말 것 (gateway token 포함)
- `apps/web/src/components/ui/` 내 shadcn 컴포넌트를 직접 수정하지 말 것 (래퍼 만들어 확장)
- `/api/media`, `/api/showcase` 하드코딩 금지 — `platform` API 사용
- shared 패키지에 web-specific API (localStorage, IndexedDB, import.meta.env) 사용 금지

## Conventions

- 컴포넌트: PascalCase 파일명 (kebab-case도 혼용 중)
- hooks: `use-*.ts` 또는 `hooks.tsx`
- 테스트: `apps/web/src/__tests__/*.test.ts(x)`
- 커밋 메시지: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`)
- PR: squash merge

## Gateway Protocol

WebSocket 프레임 기반 통신 (`packages/shared/src/gateway/protocol.ts`):
- `ReqFrame` → 요청, `ResFrame` → 응답
- `EventFrame` → 서버 이벤트 (스트리밍, 상태 변경)
- Device identity: CryptoAdapter 기반 인증 (`device-identity.ts`)

## Platform Abstraction

`apps/web/src/lib/platform/` — 웹/Electron 자동 감지:
- `platform.mediaUrl(path)` — 미디어 파일 URL 생성
- `platform.mediaGetInfo(path)` — 파일 메타데이터 조회
- `platform.showcaseList()` — 쇼케이스 목록
- `platform.showcaseUrl(path)` — 쇼케이스 파일 URL

## Adapter Pattern

`packages/shared/src/adapters/` — 플랫폼 독립 인터페이스:
- `CryptoAdapter` — 키 쌍 생성/서명 (Web Crypto, native 등)
- `StorageAdapter` — 영속 저장소 (localStorage, SecureStore 등)
- `PlatformAPI` — 미디어/쇼케이스 파일 접근

## Environment

```
VITE_GATEWAY_URL=wss://...   # Gateway WebSocket URL
VITE_GATEWAY_TOKEN=...       # Gateway 인증 토큰
VITE_DEFAULT_AGENT=...       # 기본 에이전트 ID (선택)
```
