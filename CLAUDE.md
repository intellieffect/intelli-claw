# intelli-claw

OpenClaw Gateway 기반 AI 에이전트 채팅 클라이언트 (Next.js)

## Tech Stack

- **Framework**: Next.js 15 (App Router, React 19, Turbopack)
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york style)
- **State**: React hooks + IndexedDB (세션 영속화)
- **Protocol**: WebSocket (OpenClaw Gateway Protocol v3)
- **Test**: Vitest + Testing Library + jsdom
- **Package Manager**: pnpm

## Project Structure

```
src/
├── app/                  # Next.js App Router pages & API routes
├── components/
│   ├── chat/             # 채팅 UI (메시지, 입력, 세션 관리, 마크다운 렌더러)
│   ├── settings/         # 설정 패널 (에이전트 관리)
│   ├── showcase/         # 쇼케이스 페이지
│   └── ui/               # 공통 UI 컴포넌트 (shadcn 기반)
├── lib/
│   ├── gateway/          # WebSocket 클라이언트, 프로토콜, hooks
│   ├── hooks/            # 공통 React hooks
│   └── utils.ts          # cn() 등 유틸리티
├── styles/               # globals.css (Tailwind)
└── __tests__/            # Vitest 테스트
```

## Commands

```bash
# 개발 서버 (port 4000) — 반드시 이 스크립트 사용
scripts/start-dev.sh

# 프로덕션 빌드 + 서버 (port 4100)
scripts/start-prod.sh

# 빌드만
pnpm build

# 테스트
pnpm vitest run

# 린트
pnpm lint
```

## MUST DO

- 개발 서버는 **반드시 `scripts/start-dev.sh`** 사용 (`pnpm dev` 직접 실행 금지)
- 프로덕션 서버는 `scripts/start-prod.sh` 사용
- 경로 alias는 `@/` 사용 (e.g. `@/components/ui/button`)
- UI 컴포넌트는 `shadcn/ui` 패턴 따를 것 (components.json 참고)
- CSS class 조합 시 `cn()` 유틸리티 사용
- WebSocket 통신은 `src/lib/gateway/` 내 클라이언트/프로토콜 사용

## MUST NOT DO

- `npm` 사용 금지 — **pnpm** 만 사용
- `.env.local`을 커밋하지 말 것 (gateway token 포함)
- `src/components/ui/` 내 shadcn 컴포넌트를 직접 수정하지 말 것 (래퍼 만들어 확장)

## Conventions

- 컴포넌트: PascalCase 파일명 (kebab-case도 혼용 중)
- hooks: `use-*.ts` 또는 `hooks.tsx`
- 테스트: `src/__tests__/*.test.ts(x)`
- 커밋 메시지: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`)
- PR: squash merge

## Gateway Protocol

WebSocket 프레임 기반 통신 (`src/lib/gateway/protocol.ts`):
- `ReqFrame` → 요청, `ResFrame` → 응답
- `EventFrame` → 서버 이벤트 (스트리밍, 상태 변경)
- Device identity: Web Crypto 기반 인증 (`device-identity.ts`)

## Environment

```
NEXT_PUBLIC_GATEWAY_URL=wss://...   # Gateway WebSocket URL
NEXT_PUBLIC_GATEWAY_TOKEN=...       # Gateway 인증 토큰
```
