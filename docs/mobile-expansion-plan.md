# intelli-claw 모바일 확장 계획

> **Version**: 0.1.0
> **Date**: 2026-02-25
> **Status**: Draft

---

## 목차

1. [현재 상태 분석](#1-현재-상태-분석)
2. [추천 기술 스택](#2-추천-기술-스택)
3. [모노레포 구조](#3-모노레포-구조)
4. [공유 코드 분리 전략](#4-공유-코드-분리-전략)
5. [플랫폼 추상화 설계](#5-플랫폼-추상화-설계)
6. [모바일 앱 설계](#6-모바일-앱-설계)
7. [구현 단계](#7-구현-단계)
8. [빌드 및 배포 파이프라인](#8-빌드-및-배포-파이프라인)
9. [리스크 및 대응](#9-리스크-및-대응)
10. [참고 자료](#10-참고-자료)

---

## 1. 현재 상태 분석

### 1.1 프로젝트 개요

intelli-claw는 OpenClaw Gateway Protocol v3 기반의 AI 에이전트 채팅 클라이언트로, 현재 **웹(Vite SPA)**과 **데스크톱(Electron)** 두 플랫폼을 지원한다.

| 항목 | 현재 상태 |
|------|-----------|
| Framework | Vite + React 19 (SPA) + Electron |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + shadcn/ui (new-york) |
| State | React hooks + IndexedDB |
| Protocol | WebSocket (Gateway Protocol v3) |
| Test | Vitest + Testing Library + jsdom |
| Package Manager | pnpm |
| Version | 0.2.0 |

### 1.2 현재 소스 구조

```
src/
├── main/                   # Electron main process
│   ├── index.ts            # BrowserWindow, 프로토콜 등록, 윈도우 상태 관리
│   ├── ipc-handlers.ts     # IPC 핸들러 등록
│   ├── media-handler.ts    # 파일 메타데이터/서빙
│   └── showcase-handler.ts # 쇼케이스 파일 서빙
├── preload/                # Electron preload (contextBridge)
│   └── index.ts
├── server/                 # 웹 전용 API 서버
│   └── api-server.ts       # 독립 HTTP 서버 (port 4001)
├── renderer/               # React SPA (렌더러)
│   ├── main.tsx            # React 엔트리, 플랫폼 감지
│   ├── App.tsx             # 루트 컴포넌트 (GatewayProvider)
│   ├── components/
│   │   ├── chat/           # 채팅 UI (패널, 카드, 스트림 등)
│   │   ├── settings/       # 설정 패널 (에이전트, cron, 세션, 스킬)
│   │   ├── showcase/       # 쇼케이스
│   │   └── ui/             # 공통 UI (shadcn 기반)
│   ├── lib/
│   │   ├── gateway/        # WebSocket 클라이언트, 프로토콜, hooks
│   │   ├── platform/       # 플랫폼 추상화 (web/electron)
│   │   ├── hooks/          # 공통 React hooks
│   │   └── utils/          # cn() 등 유틸리티
│   └── styles/             # globals.css (Tailwind)
└── __tests__/              # Vitest 테스트
```

### 1.3 코드 재사용성 분석

#### Tier 1 — 직접 이식 가능 (95%+)

| 모듈 | 파일 | 설명 |
|------|------|------|
| Gateway Protocol | `lib/gateway/protocol.ts` | Frame 타입 정의, ClientId (이미 `openclaw-ios`, `openclaw-android` 포함), 파서 |
| Gateway Client | `lib/gateway/client.ts` | WebSocket 연결 관리, 요청/응답 매칭, 자동 재연결 |
| React Hooks | `lib/gateway/hooks.tsx` | GatewayContext, useGateway() |
| 전문 Hooks | `lib/gateway/use-*.ts` | useSession, useCron, useSkills 등 데이터 변환 hooks |
| Utils | `lib/utils.ts` | cn(), 기타 순수 유틸리티 |

#### Tier 2 — 어댑터 패턴으로 이식 (80%+)

| 모듈 | 변경 필요 사항 |
|------|---------------|
| Device Identity | `lib/gateway/device-identity.ts` — Web Crypto → expo-crypto, IndexedDB → SecureStore |
| Session Persistence | IndexedDB → MMKV/AsyncStorage |
| Config Loading | import.meta.env → expo-constants 또는 app.config.ts |

#### Tier 3 — UI 재작성 필요 (30%+ 로직 재사용)

| 모듈 | 상태 |
|------|------|
| chat/ 컴포넌트 | 비즈니스 로직 재사용, JSX → React Native 컴포넌트 |
| settings/ 컴포넌트 | 상태 관리 로직 재사용, UI 재작성 |
| ui/ 컴포넌트 | shadcn/ui → React Native Reusables (RN 포트) |

#### 이식 불가 — 플랫폼 전용 코드

| 모듈 | 이유 |
|------|------|
| `src/main/` | Electron main process (BrowserWindow, IPC) |
| `src/preload/` | Electron contextBridge |
| `src/server/` | Express HTTP 서버 (웹 전용 API) |
| `lib/platform/web.ts` | fetch 기반 HTTP API 호출 |
| `lib/platform/electron.ts` | IPC + 커스텀 프로토콜 |

### 1.4 플랫폼 추상화 현황

현재 `PlatformAPI` 인터페이스가 이미 잘 설계되어 있으며, Proxy 기반 런타임 감지로 web/electron을 투명하게 전환한다.

```typescript
// src/renderer/lib/platform/types.ts
export interface PlatformAPI {
  mediaUrl(filePath: string, opts?: { dl?: boolean; info?: boolean }): string;
  mediaGetInfo(filePath: string): Promise<MediaInfo>;
  showcaseList(): Promise<{ files: ShowcaseFileEntry[] }>;
  showcaseUrl(relativePath: string): string;
}

// src/renderer/lib/platform/index.ts
function detectPlatform(): PlatformAPI {
  if (typeof window !== "undefined" && "electronAPI" in window) {
    return electronPlatform;
  }
  return webPlatform;
}

export const platform: PlatformAPI = new Proxy({} as PlatformAPI, {
  get(_target, prop) {
    return (detectPlatform() as any)[prop];
  },
});
```

이 패턴을 모바일로 확장하면 된다.

---

## 2. 추천 기술 스택

### 2.1 React Native + Expo (추천)

| 레이어 | 기술 | 버전 | 선택 이유 |
|--------|------|------|-----------|
| Runtime | Expo SDK | 53+ | 빌드/배포 간소화, OTA 업데이트, EAS Build |
| UI Framework | React Native | 0.77+ | React 19 지원, New Architecture 안정화 |
| Navigation | Expo Router | v4 | 파일 기반 라우팅, 딥링크 자동 처리 |
| Styling | NativeWind | v4 | Tailwind CSS 문법 재사용, 기존 클래스명 호환 |
| UI Components | React Native Reusables | latest | shadcn/ui의 React Native 포트 |
| Storage (일반) | react-native-mmkv | 3.x | 고속 KV 스토리지, 동기 API |
| Storage (보안) | expo-secure-store | SDK 53 | 디바이스 키/토큰 보안 저장 (Keychain/Keystore) |
| Crypto | expo-crypto | SDK 53 | ECDSA 서명, device-identity 생성 |
| WebSocket | React Native 내장 | - | 브라우저 WebSocket API와 동일 인터페이스 |
| State | React Context | - | 현행 유지, 추가 라이브러리 불필요 |
| Markdown | @ronradtke/react-native-markdown-display | 8.x | 마크다운 렌더링 + 코드 하이라이팅 |
| List | @shopify/flash-list | 1.7+ | 대량 메시지 가상화 렌더링 |

### 2.2 Expo를 추천하는 이유

1. **EAS Build** — iOS/Android 클라우드 빌드, 로컬 Xcode/Android Studio 의존도 최소화
2. **OTA 업데이트** — 앱스토어 심사 없이 JS 번들 업데이트 (핫픽스에 필수)
3. **Expo Router** — 파일 기반 라우팅 + 딥링크 + 유니버설 링크 자동 처리
4. **Prebuild** — 네이티브 코드 생성 자동화, bare workflow 전환 가능
5. **React 19 지원** — Expo SDK 53부터 React 19 + New Architecture 기본 활성화
6. **Dev Client** — 커스텀 네이티브 모듈 포함한 개발 빌드

### 2.3 대안 비교

| 항목 | Expo (Managed) | React Native CLI | Flutter |
|------|---------------|-------------------|---------|
| 초기 설정 시간 | 5분 | 1시간+ | 30분 |
| 코드 재사용 (현 프로젝트) | 높음 (React 동일) | 높음 (React 동일) | 낮음 (Dart 재작성) |
| 빌드 복잡도 | 낮음 (EAS) | 높음 (Xcode/Gradle) | 중간 |
| 네이티브 모듈 | expo-modules로 가능 | 완전 자유 | FFI 필요 |
| OTA 업데이트 | 내장 | CodePush (별도) | 불가 |
| 커뮤니티/생태계 | 가장 활발 | 활발 | 별도 생태계 |

Flutter는 코드 재사용률이 극히 낮아 제외. React Native CLI는 Expo 대비 설정/관리 오버헤드가 크므로, Expo 우선으로 시작하되 필요 시 bare workflow 전환.

### 2.4 모노레포 도구

| 도구 | 추천 여부 | 이유 |
|------|-----------|------|
| **pnpm workspace** | 추천 | 이미 pnpm 사용 중, workspace 설정만 추가 |
| **Turborepo** | 추천 | 빌드 캐싱, 태스크 병렬화, pnpm 네이티브 지원 |
| Nx | 비추천 | 오버엔지니어링, 학습 곡선 |
| Lerna | 비추천 | 사실상 deprecated, Nx에 흡수 |

---

## 3. 모노레포 구조

### 3.1 디렉토리 구조

```
intelli-claw/
│
├── packages/                          # 공유 패키지
│   │
│   ├── shared/                        # 플랫폼 무관 공유 코드
│   │   ├── package.json               # @intelli-claw/shared
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── gateway/
│   │   │   │   ├── protocol.ts        # Frame types, ClientId, 파서
│   │   │   │   ├── client.ts          # GatewayClient (어댑터 주입)
│   │   │   │   ├── device-identity.ts # 서명 로직 (CryptoAdapter 주입)
│   │   │   │   └── types.ts           # 공유 타입
│   │   │   ├── hooks/
│   │   │   │   ├── use-gateway.ts     # GatewayContext + Provider
│   │   │   │   ├── use-session.ts     # 세션 관리 hook
│   │   │   │   ├── use-cron.ts        # Cron 관리 hook
│   │   │   │   └── use-skills.ts      # 스킬 관리 hook
│   │   │   ├── adapters/
│   │   │   │   ├── storage.ts         # StorageAdapter 인터페이스
│   │   │   │   └── crypto.ts          # CryptoAdapter 인터페이스
│   │   │   └── utils/
│   │   │       └── index.ts           # cn(), 공용 유틸리티
│   │   └── index.ts                   # 패키지 엔트리
│   │
│   ├── ui-web/                        # 웹 전용 UI 컴포넌트
│   │   ├── package.json               # @intelli-claw/ui-web
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── components/
│   │       │   ├── chat/              # 웹 채팅 컴포넌트 (현행)
│   │       │   ├── settings/          # 웹 설정 컴포넌트 (현행)
│   │       │   ├── showcase/          # 쇼케이스 (웹 전용)
│   │       │   └── ui/               # shadcn/ui 컴포넌트 (현행)
│   │       └── styles/
│   │           └── globals.css
│   │
│   └── ui-mobile/                     # 모바일 전용 UI 컴포넌트
│       ├── package.json               # @intelli-claw/ui-mobile
│       ├── tsconfig.json
│       └── src/
│           ├── components/
│           │   ├── chat/              # 모바일 채팅 컴포넌트
│           │   ├── settings/          # 모바일 설정 컴포넌트
│           │   └── ui/               # React Native Reusables 기반
│           ├── navigation/            # React Navigation 설정
│           └── theme/                 # NativeWind 테마
│
├── apps/                              # 플랫폼별 애플리케이션
│   │
│   ├── web/                           # Vite SPA (기존 웹 앱)
│   │   ├── package.json               # @intelli-claw/web
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx               # 웹 엔트리
│   │       ├── App.tsx                # 루트 컴포넌트
│   │       ├── platform/
│   │       │   └── web.ts             # PlatformAPI 웹 구현
│   │       └── adapters/
│   │           ├── storage.ts         # IndexedDB StorageAdapter
│   │           └── crypto.ts          # Web Crypto CryptoAdapter
│   │
│   ├── desktop/                       # Electron (기존 데스크톱 앱)
│   │   ├── package.json               # @intelli-claw/desktop
│   │   ├── electron.vite.config.ts
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main/                  # Electron main process (현행)
│   │       │   ├── index.ts
│   │       │   ├── ipc-handlers.ts
│   │       │   ├── media-handler.ts
│   │       │   └── showcase-handler.ts
│   │       ├── preload/
│   │       │   └── index.ts
│   │       ├── renderer/              # Electron renderer (ui-web 소비)
│   │       │   └── main.tsx
│   │       ├── platform/
│   │       │   └── electron.ts        # PlatformAPI Electron 구현
│   │       └── adapters/
│   │           ├── storage.ts         # Electron store adapter
│   │           └── crypto.ts          # Node crypto adapter
│   │
│   ├── mobile/                        # Expo React Native (NEW)
│   │   ├── package.json               # @intelli-claw/mobile
│   │   ├── app.json                   # Expo 설정
│   │   ├── app.config.ts              # 동적 Expo 설정
│   │   ├── eas.json                   # EAS Build 프로파일
│   │   ├── tsconfig.json
│   │   ├── metro.config.js            # Metro 번들러 (모노레포 지원)
│   │   ├── nativewind-env.d.ts        # NativeWind 타입
│   │   ├── tailwind.config.ts         # NativeWind 설정
│   │   ├── app/                       # Expo Router (파일 기반 라우팅)
│   │   │   ├── _layout.tsx            # 루트 레이아웃 (GatewayProvider)
│   │   │   ├── (tabs)/
│   │   │   │   ├── _layout.tsx        # 탭 네비게이션
│   │   │   │   ├── index.tsx          # 채팅 (기본 탭)
│   │   │   │   ├── sessions.tsx       # 세션 목록
│   │   │   │   └── settings.tsx       # 설정
│   │   │   └── (modals)/
│   │   │       ├── agent-selector.tsx  # 에이전트 선택
│   │   │       └── session-detail.tsx  # 세션 상세
│   │   ├── platform/
│   │   │   └── mobile.ts             # PlatformAPI 모바일 구현
│   │   ├── adapters/
│   │   │   ├── storage.ts            # MMKV StorageAdapter
│   │   │   └── crypto.ts             # expo-crypto CryptoAdapter
│   │   └── assets/                    # 앱 아이콘, 스플래시 등
│   │
│   └── server/                        # 웹 전용 API 서버
│       ├── package.json               # @intelli-claw/server
│       └── src/
│           └── api-server.ts          # HTTP 엔드포인트 (현행)
│
├── pnpm-workspace.yaml                # 모노레포 워크스페이스 설정
├── turbo.json                         # Turborepo 빌드 오케스트레이션
├── tsconfig.base.json                 # 공유 TypeScript 설정
├── .eslintrc.js                       # 공유 ESLint 설정
├── .prettierrc                        # 공유 Prettier 설정
└── package.json                       # 루트 package.json (scripts, devDeps)
```

### 3.2 워크스페이스 설정

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
  - "apps/*"
```

### 3.3 Turborepo 설정

```jsonc
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "out/**", ".next/**", ".expo/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

### 3.4 패키지 의존성 그래프

```
@intelli-claw/shared          (의존성 없음 — 순수 로직)
    │
    ├── @intelli-claw/ui-web  (shared + react + shadcn/ui + tailwind)
    │       │
    │       ├── @intelli-claw/web      (ui-web + vite)
    │       └── @intelli-claw/desktop  (ui-web + electron)
    │
    └── @intelli-claw/ui-mobile (shared + react-native + nativewind)
            │
            └── @intelli-claw/mobile   (ui-mobile + expo)
```

---

## 4. 공유 코드 분리 전략

### 4.1 마이그레이션 매핑

현재 파일 경로와 모노레포 이동 대상:

```
현재 위치                                  → 이동 위치
──────────────────────────────────────────────────────────────
src/renderer/lib/gateway/protocol.ts       → packages/shared/src/gateway/protocol.ts
src/renderer/lib/gateway/client.ts         → packages/shared/src/gateway/client.ts
src/renderer/lib/gateway/device-identity.ts→ packages/shared/src/gateway/device-identity.ts
src/renderer/lib/gateway/hooks.tsx         → packages/shared/src/hooks/use-gateway.ts
src/renderer/lib/gateway/use-session-settings.ts → packages/shared/src/hooks/use-session.ts
src/renderer/lib/gateway/use-cron.ts       → packages/shared/src/hooks/use-cron.ts
src/renderer/lib/gateway/use-skills.ts     → packages/shared/src/hooks/use-skills.ts
src/renderer/lib/utils.ts                  → packages/shared/src/utils/index.ts

src/renderer/lib/platform/types.ts         → packages/shared/src/adapters/ (확장)
src/renderer/lib/platform/web.ts           → apps/web/src/platform/web.ts
src/renderer/lib/platform/electron.ts      → apps/desktop/src/platform/electron.ts
(신규)                                     → apps/mobile/src/platform/mobile.ts

src/renderer/components/                   → packages/ui-web/src/components/
src/renderer/styles/                       → packages/ui-web/src/styles/

src/main/                                  → apps/desktop/src/main/
src/preload/                               → apps/desktop/src/preload/
src/server/                                → apps/server/src/
```

### 4.2 어댑터 인터페이스

공유 코드가 플랫폼별 기능을 사용해야 할 때, 어댑터 패턴으로 의존성을 역전시킨다.

#### StorageAdapter

```typescript
// packages/shared/src/adapters/storage.ts

export interface StorageAdapter {
  /** 값 조회. 없으면 null 반환 */
  getItem(key: string): Promise<string | null>;

  /** 값 저장 */
  setItem(key: string, value: string): Promise<void>;

  /** 값 삭제 */
  removeItem(key: string): Promise<void>;
}
```

**플랫폼별 구현:**

| 플랫폼 | 구현체 | 라이브러리 |
|--------|--------|-----------|
| Web | `IndexedDBStorageAdapter` | 네이티브 IndexedDB |
| Desktop | `ElectronStorageAdapter` | electron-store 또는 IndexedDB |
| Mobile | `MMKVStorageAdapter` | react-native-mmkv |

#### CryptoAdapter

```typescript
// packages/shared/src/adapters/crypto.ts

export interface CryptoKeyPair {
  publicKeyBase64: string;
  privateKeyId: string;  // 플랫폼별 키 참조 (Web: CryptoKey, Mobile: SecureStore key)
}

export interface CryptoAdapter {
  /** ECDSA P-256 키쌍 생성 및 저장 */
  generateAndStoreKeyPair(id: string): Promise<CryptoKeyPair>;

  /** 저장된 키로 서명 */
  sign(privateKeyId: string, data: string): Promise<string>;

  /** 저장된 키쌍 존재 여부 */
  hasKeyPair(id: string): Promise<boolean>;

  /** 저장된 공개키 조회 */
  getPublicKey(id: string): Promise<string | null>;
}
```

**플랫폼별 구현:**

| 플랫폼 | 구현체 | 라이브러리 |
|--------|--------|-----------|
| Web | `WebCryptoAdapter` | Web Crypto API + IndexedDB |
| Desktop | `WebCryptoAdapter` (동일) | Chromium Web Crypto |
| Mobile | `ExpoCryptoAdapter` | expo-crypto + expo-secure-store |

#### PlatformAPI (확장)

```typescript
// packages/shared/src/adapters/platform.ts

export interface MediaInfo {
  fileName: string;
  size: number;
  mimeType: string;
  extension: string;
  modifiedAt: string;
}

export interface ShowcaseFileEntry {
  name: string;
  relativePath: string;
  size: number;
  modified: string;
  meta: Record<string, string>;
}

export interface PlatformAPI {
  mediaUrl(filePath: string, opts?: { dl?: boolean; info?: boolean }): string;
  mediaGetInfo(filePath: string): Promise<MediaInfo>;
  showcaseList(): Promise<{ files: ShowcaseFileEntry[] }>;
  showcaseUrl(relativePath: string): string;
}
```

### 4.3 GatewayClient 어댑터 주입 패턴

현재 `client.ts`가 직접 IndexedDB와 Web Crypto를 사용하는 부분을 어댑터 주입으로 변경:

```typescript
// packages/shared/src/gateway/client.ts

import type { StorageAdapter } from "../adapters/storage";
import type { CryptoAdapter } from "../adapters/crypto";

export interface GatewayClientConfig {
  url: string;
  token?: string;
  clientId: ClientId;
  storage: StorageAdapter;
  crypto: CryptoAdapter;
}

export class GatewayClient {
  constructor(private config: GatewayClientConfig) {}

  async connect(): Promise<void> {
    // 어댑터를 통해 디바이스 키 로드/생성
    const hasKey = await this.config.crypto.hasKeyPair("device");
    if (!hasKey) {
      await this.config.crypto.generateAndStoreKeyPair("device");
    }
    // WebSocket 연결...
  }
}
```

**앱별 초기화 예시:**

```typescript
// apps/mobile/app/_layout.tsx
import { GatewayClient } from "@intelli-claw/shared";
import { MMKVStorageAdapter } from "../adapters/storage";
import { ExpoCryptoAdapter } from "../adapters/crypto";

const client = new GatewayClient({
  url: Constants.expoConfig?.extra?.gatewayUrl,
  token: Constants.expoConfig?.extra?.gatewayToken,
  clientId: "openclaw-ios", // 또는 Platform.OS에 따라 동적 결정
  storage: new MMKVStorageAdapter(),
  crypto: new ExpoCryptoAdapter(),
});
```

---

## 5. 플랫폼 추상화 설계

### 5.1 확장된 플랫폼 감지

```typescript
// packages/shared/src/adapters/detect-platform.ts

export type PlatformType = "web" | "electron" | "ios" | "android";

export function detectPlatformType(): PlatformType {
  // React Native 환경
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    // Platform.OS는 앱 레벨에서 주입
    return globalThis.__INTELLI_CLAW_PLATFORM__ ?? "ios";
  }

  // Electron 환경
  if (typeof window !== "undefined" && "electronAPI" in window) {
    return "electron";
  }

  // 웹 환경
  return "web";
}
```

### 5.2 모바일 PlatformAPI 구현

```typescript
// apps/mobile/src/platform/mobile.ts

import type { PlatformAPI, MediaInfo } from "@intelli-claw/shared";

export const mobilePlatform: PlatformAPI = {
  mediaUrl(filePath, opts) {
    // 모바일에서는 Gateway의 media 프록시 엔드포인트 사용
    const base = Constants.expoConfig?.extra?.gatewayHttpUrl;
    const params = new URLSearchParams({ path: filePath });
    if (opts?.dl) params.set("dl", "1");
    return `${base}/api/media?${params}`;
  },

  async mediaGetInfo(filePath): Promise<MediaInfo> {
    const base = Constants.expoConfig?.extra?.gatewayHttpUrl;
    const res = await fetch(`${base}/api/media?path=${encodeURIComponent(filePath)}&info=1`);
    return res.json();
  },

  async showcaseList() {
    const base = Constants.expoConfig?.extra?.gatewayHttpUrl;
    const res = await fetch(`${base}/api/showcase`);
    return res.json();
  },

  showcaseUrl(relativePath) {
    const base = Constants.expoConfig?.extra?.gatewayHttpUrl;
    return `${base}/api/showcase/${encodeURIComponent(relativePath)}`;
  },
};
```

### 5.3 플랫폼별 ClientId 매핑

protocol.ts에 이미 정의된 ClientId 활용:

```typescript
import { Platform } from "react-native";

function getClientId(): ClientId {
  return Platform.OS === "ios" ? "openclaw-ios" : "openclaw-android";
}

function getDeviceFamily(): string {
  // expo-device로 상세 정보
  return Device.modelName ?? Platform.OS;
}
```

---

## 6. 모바일 앱 설계

### 6.1 화면 구성

```
┌──────────────────────────────────────┐
│          Status Bar (Safe Area)       │
├──────────────────────────────────────┤
│  ┌─ Header ────────────────────────┐ │
│  │ [Agent Avatar] Agent Name    ⚙️ │ │
│  │ Connected • Session: default    │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ┌─ Message Stream ────────────────┐ │
│  │                                  │ │
│  │  [User] 프로젝트 구조 분석해줘  │ │
│  │                                  │ │
│  │  [Agent]                        │ │
│  │  프로젝트를 분석하겠습니다...   │ │
│  │                                  │ │
│  │  ┌─ Tool Call ──────────────┐   │ │
│  │  │ 📁 read_file            │   │ │
│  │  │ src/main/index.ts       │   │ │
│  │  │ ▶ 결과 보기             │   │ │
│  │  └─────────────────────────┘   │ │
│  │                                  │ │
│  │  분석 결과:                     │ │
│  │  - TypeScript 기반 Electron...  │ │
│  │  - 컴포넌트 구조...            │ │
│  │                                  │ │
│  └──────────────────────────────────┘ │
│                                      │
│  ┌─ Input Area ────────────────────┐ │
│  │ [📎] 메시지를 입력하세요... [▶]│ │
│  └─────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  [💬 Chat]  [📋 Sessions]  [⚙ Set] │
└──────────────────────────────────────┘
```

### 6.2 네비게이션 구조

```
Root Layout (_layout.tsx)
├── GatewayProvider (연결 관리)
├── ThemeProvider (NativeWind)
│
├── (tabs)/ — 탭 네비게이션
│   ├── index.tsx      — 채팅 (기본)
│   ├── sessions.tsx   — 세션 목록
│   └── settings.tsx   — 설정
│
└── (modals)/ — 모달 (stack presentation)
    ├── agent-selector.tsx   — 에이전트 선택
    ├── session-detail.tsx   — 세션 상세 정보
    ├── skill-picker.tsx     — 스킬 선택
    └── file-preview.tsx     — 파일 미리보기
```

### 6.3 핵심 컴포넌트 매핑

웹 컴포넌트와 모바일 대응:

| 웹 컴포넌트 | 모바일 대응 | 비고 |
|-------------|------------|------|
| `chat-panel.tsx` | `ChatScreen` | FlashList 기반 메시지 스트림 |
| `message-input.tsx` | `MessageInput` | 키보드 회피 + 파일 첨부 |
| `agent-selector.tsx` | `AgentSelectorModal` | Bottom Sheet 모달 |
| `session-manager-panel.tsx` | `SessionsScreen` | FlatList + 스와이프 삭제 |
| `session-switcher.tsx` | `SessionsScreen`에 통합 | 탭으로 분리 |
| `tool-call-card.tsx` | `ToolCallCard` | Accordion 스타일 접힘/펼침 |
| `markdown-renderer.tsx` | `MarkdownRenderer` | react-native-markdown-display |
| `subagent-card.tsx` | `SubagentCard` | 접힘 가능한 카드 |
| `status-card.tsx` | `StatusBanner` | 상단 배너 형태 |
| `file-attachments.tsx` | `FileAttachments` | expo-document-picker |
| `skill-picker.tsx` | `SkillPickerModal` | Bottom Sheet |
| `shortcut-help-dialog.tsx` | 제외 | 모바일에서 키보드 단축키 불필요 |
| `showcase-panel.tsx` | 제외 (Phase 1) | 모바일 우선순위 낮음 |

### 6.4 모바일 전용 UX 고려사항

#### iOS

- **Safe Area**: `SafeAreaProvider` + `useSafeAreaInsets()`
- **키보드 회피**: `KeyboardAvoidingView` (behavior="padding")
- **햅틱 피드백**: `expo-haptics` (메시지 전송, 세션 전환)
- **Pull to Refresh**: 세션 목록 갱신
- **제스처**: 스와이프 백 (React Navigation 기본)
- **Dynamic Island / Notch**: Safe Area로 자동 처리

#### Android

- **Navigation Bar**: `navigationBarColor` 설정
- **Back Handler**: 하드웨어 뒤로가기 처리
- **Material You**: 시스템 동적 색상 (선택적)
- **Edge-to-Edge**: Android 15+ 대응
- **키보드**: `windowSoftInputMode: "adjustResize"`

#### 공통

- **다크모드**: `useColorScheme()` + NativeWind dark variant
- **오프라인 상태**: 연결 끊김 시 UI 피드백 (배너)
- **백그라운드 → 포그라운드**: WebSocket 자동 재연결
- **터치 타겟**: 최소 44pt (iOS) / 48dp (Android)

---

## 7. 구현 단계

### Phase 0: 모노레포 전환 (예상 1주)

**목표**: 기존 앱 동작을 깨뜨리지 않으면서 모노레포 구조로 전환

**작업 목록**:

- [ ] `pnpm-workspace.yaml` 생성
- [ ] `turbo.json` 생성
- [ ] `tsconfig.base.json` 생성 (공유 컴파일러 옵션)
- [ ] `packages/shared/` 패키지 생성
  - [ ] `gateway/protocol.ts` 이동
  - [ ] `gateway/client.ts` 이동 + 어댑터 주입 리팩터링
  - [ ] `gateway/device-identity.ts` 이동 + CryptoAdapter 주입
  - [ ] `hooks/` 이동
  - [ ] `adapters/` 인터페이스 정의 (StorageAdapter, CryptoAdapter)
  - [ ] `utils/` 이동
- [ ] `apps/web/` — 기존 웹 앱 이동
  - [ ] Vite 설정 조정 (모노레포 경로)
  - [ ] IndexedDB StorageAdapter 구현
  - [ ] Web Crypto CryptoAdapter 구현
- [ ] `apps/desktop/` — 기존 Electron 앱 이동
  - [ ] electron-vite 설정 조정
  - [ ] 어댑터 구현 (웹과 동일 가능)
- [ ] `apps/server/` — API 서버 이동
- [ ] **회귀 테스트**: 웹/Electron 모두 기존과 동일하게 동작하는지 검증

**주의사항**:
- 단계적으로 파일 이동 (한 번에 전체 이동 X)
- 각 이동 후 빌드/테스트 통과 확인
- git history 보존을 위해 `git mv` 사용

### Phase 1: 모바일 앱 부트스트랩 (예상 1주)

**목표**: Expo 프로젝트 초기화, Gateway 연결 성공

**작업 목록**:

- [ ] `apps/mobile/` Expo 프로젝트 생성 (`npx create-expo-app`)
- [ ] Metro 번들러 모노레포 설정 (`metro.config.js`)
- [ ] NativeWind v4 설정
- [ ] 환경 변수 설정 (`app.config.ts` — `extra` 필드)
- [ ] `MMKVStorageAdapter` 구현
- [ ] `ExpoCryptoAdapter` 구현
- [ ] `mobilePlatform` PlatformAPI 구현
- [ ] GatewayClient 초기화 + WebSocket 연결 테스트
- [ ] 기본 화면 구조 (탭 네비게이션 3개)
- [ ] 연결 상태 표시 (Connected/Disconnected 배너)

**검증 기준**:
- `pnpm dev:mobile` 실행 시 Expo Go/Dev Client에서 앱 로드
- Gateway WebSocket handshake 성공 (`hello-ok` 수신)
- 디바이스 ID 생성 및 SecureStore 저장 확인

### Phase 2: 코어 채팅 UI (예상 2주)

**목표**: 기본 채팅 기능 완성

**Week 1 — 메시지 스트림**:

- [ ] `ChatScreen` — FlashList 기반 메시지 리스트
- [ ] `MessageBubble` — User/Assistant 메시지 렌더링
- [ ] `MarkdownRenderer` — 마크다운 렌더링 (코드 하이라이팅 포함)
- [ ] `MessageInput` — 텍스트 입력 + 전송 버튼
- [ ] 키보드 회피 처리 (`KeyboardAvoidingView`)
- [ ] 스트리밍 텍스트 표시 (delta 이벤트 처리)
- [ ] 자동 스크롤 (새 메시지 시 하단으로)

**Week 2 — Tool Call + 파일**:

- [ ] `ToolCallCard` — 도구 호출 카드 (접힘/펼침)
- [ ] `SubagentCard` — 서브에이전트 스트림 카드
- [ ] `FileAttachments` — 파일 첨부 (expo-document-picker)
- [ ] `FilePreview` — 이미지/PDF 미리보기
- [ ] 메시지 중단 기능 (chat.abort)
- [ ] 에이전트 선택 모달 (`AgentSelectorModal`)
- [ ] 스킬 선택 모달 (`SkillPickerModal`)

**검증 기준**:
- 텍스트 메시지 전송/수신 동작
- 마크다운 (코드 블록, 표, 리스트) 정상 렌더링
- Tool Call 카드 접힘/펼침 동작
- 파일 첨부 및 미리보기 동작

### Phase 3: 세션 관리 + 설정 (예상 1주)

**목표**: 세션 전환, 에이전트 관리, 앱 설정

**작업 목록**:

- [ ] `SessionsScreen` — 세션 목록 (FlatList)
  - [ ] 세션 생성/삭제
  - [ ] 세션 간 전환
  - [ ] 마지막 메시지 미리보기
  - [ ] 스와이프 삭제 제스처
- [ ] `SettingsScreen`
  - [ ] Gateway 연결 설정 (URL, 토큰)
  - [ ] 에이전트 관리 (목록, 기본 에이전트 설정)
  - [ ] 세션 설정 (기본값)
  - [ ] 앱 정보 (버전, 라이선스)
- [ ] 세션 영속화 (MMKV)
- [ ] 앱 시작 시 마지막 세션 복원
- [ ] 딥링크 지원 (특정 세션으로 이동)

**검증 기준**:
- 세션 생성 → 채팅 → 다른 세션 전환 → 원래 세션 복귀 시 히스토리 유지
- 앱 종료 → 재시작 시 마지막 세션 복원
- 설정 변경 사항 즉시 반영

### Phase 4: 플랫폼 최적화 (예상 1주)

**목표**: iOS/Android 각각의 플랫폼 컨벤션에 맞는 최적화

**작업 목록**:

- [ ] **iOS 최적화**
  - [ ] 키보드 인터랙티브 dismissal
  - [ ] 햅틱 피드백 (메시지 전송, 세션 전환)
  - [ ] 3D Touch / Haptic Touch (메시지 long press)
  - [ ] Dynamic Type (접근성 — 시스템 글자 크기 반영)
- [ ] **Android 최적화**
  - [ ] Material 3 스타일 적응
  - [ ] 하드웨어 뒤로가기 처리
  - [ ] Edge-to-Edge 디스플레이
  - [ ] 알림 채널 설정
- [ ] **성능 최적화**
  - [ ] FlashList 최적화 (estimatedItemSize, overrideItemLayout)
  - [ ] 이미지 캐싱 (expo-image)
  - [ ] 메모리 관리 (긴 대화 시 메시지 페이지네이션)
  - [ ] Hermes 엔진 최적화 확인
- [ ] **접근성**
  - [ ] VoiceOver (iOS) / TalkBack (Android) 테스트
  - [ ] 접근성 레이블 추가
  - [ ] 최소 터치 영역 보장 (44pt / 48dp)

### Phase 5: 배포 파이프라인 (예상 1주)

**목표**: CI/CD를 통한 자동 빌드 및 배포

**작업 목록**:

- [ ] EAS Build 설정 (`eas.json`)
  - [ ] `development` 프로파일 — Dev Client 빌드
  - [ ] `preview` 프로파일 — 내부 테스트 빌드
  - [ ] `production` 프로파일 — 스토어 제출 빌드
- [ ] EAS Update 설정 (OTA 업데이트)
  - [ ] 업데이트 채널 (development, preview, production)
  - [ ] 자동 롤백 설정
- [ ] CI/CD 파이프라인 (GitHub Actions)
  - [ ] PR 시: lint + typecheck + test
  - [ ] main 머지 시: EAS Build (preview) 자동 트리거
  - [ ] 태그 푸시 시: EAS Build (production) + 스토어 제출
- [ ] 앱스토어 준비
  - [ ] Apple Developer Account 설정
  - [ ] Google Play Console 설정
  - [ ] 앱 아이콘, 스플래시, 스크린샷
  - [ ] 앱 설명, 개인정보 처리방침
- [ ] TestFlight (iOS) / Internal Testing (Android) 설정
- [ ] Crash 리포팅 (Sentry 또는 expo-updates 내장)

---

## 8. 빌드 및 배포 파이프라인

### 8.1 EAS Build 프로파일

```json
// apps/mobile/eas.json
{
  "cli": { "version": ">= 15.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true },
      "env": {
        "GATEWAY_URL": "wss://dev.openclaw.example/ws",
        "GATEWAY_TOKEN": ""
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false },
      "env": {
        "GATEWAY_URL": "wss://staging.openclaw.example/ws"
      }
    },
    "production": {
      "autoIncrement": true,
      "env": {
        "GATEWAY_URL": "wss://api.openclaw.example/ws"
      }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "...", "appleTeamId": "..." },
      "android": { "serviceAccountKeyPath": "./google-sa.json", "track": "internal" }
    }
  }
}
```

### 8.2 CI/CD 플로우

```
Developer Push
      │
      ▼
┌─ GitHub Actions ──────────────────────┐
│                                        │
│  PR:                                   │
│  ├── pnpm install                     │
│  ├── turbo lint (all packages)        │
│  ├── turbo typecheck (all packages)   │
│  └── turbo test (all packages)        │
│                                        │
│  Merge to main:                        │
│  ├── All of above                     │
│  ├── eas build --profile preview      │
│  └── eas update --branch preview      │
│                                        │
│  Tag (v*.*.*):                         │
│  ├── eas build --profile production   │
│  └── eas submit --profile production  │
│                                        │
└────────────────────────────────────────┘
```

### 8.3 OTA 업데이트 전략

```
Production App
      │
      ├── JS Bundle 변경만 (UI, 로직)
      │   └── EAS Update → 즉시 배포 (앱스토어 심사 X)
      │
      └── Native 변경 (새 네이티브 모듈, SDK 업그레이드)
          └── EAS Build → 앱스토어 심사 → 릴리스
```

---

## 9. 리스크 및 대응

### 9.1 기술적 리스크

| 리스크 | 발생 확률 | 영향도 | 대응 전략 |
|--------|----------|--------|-----------|
| **모노레포 전환 시 회귀** | 중 | 높음 | Phase 0에서 각 단계마다 빌드/테스트 검증. `git mv`로 히스토리 보존 |
| **React 19 + RN 호환성** | 낮 | 중 | Expo SDK 53이 React 19 공식 지원. 문제 시 shared 패키지만 React 18 호환 유지 |
| **마크다운 렌더링 품질** | 중 | 중 | `react-native-markdown-display`가 기본. 부족하면 WebView 폴백 또는 커스텀 렌더러 |
| **WebSocket 백그라운드 끊김** | 높 | 중 | client.ts의 기존 reconnect 로직 활용. AppState 이벤트 리스너로 포그라운드 복귀 시 즉시 재연결 |
| **대량 메시지 성능** | 중 | 중 | FlashList 가상화 + 메시지 페이지네이션. 500개 이상 메시지 시 오래된 메시지 언로드 |
| **NativeWind v4 안정성** | 낮 | 낮 | NativeWind v4는 Tailwind v4 기반으로 안정화됨. 문제 시 StyleSheet 폴백 |
| **Metro 모노레포 해석** | 중 | 중 | `metro.config.js`에서 `watchFolders` + `nodeModulesPaths` 명시적 설정 |

### 9.2 운영 리스크

| 리스크 | 대응 |
|--------|------|
| Apple 심사 거절 | 최소 기능(채팅)으로 첫 심사 통과 후 점진적 기능 추가 |
| 앱스토어 개인정보 요구사항 | 개인정보 처리방침 사전 준비, 데이터 수집 최소화 선언 |
| 기기 파편화 (Android) | Expo의 기기 호환성 레이어 활용, 주요 기기(Samsung/Pixel) 우선 테스트 |
| 앱 크기 | Hermes 엔진 사용 (기본), 사용하지 않는 네이티브 모듈 제거 |

### 9.3 의존성 리스크

| 현재 의존성 | 모바일 대체 | 호환 여부 |
|------------|------------|-----------|
| `react` 19 | 동일 | 호환 (Expo SDK 53+) |
| `react-markdown` | `react-native-markdown-display` | API 상이, 래퍼 필요 |
| `highlight.js` | 동일 (JS 라이브러리) | 호환 |
| `lucide-react` | `lucide-react-native` | 1:1 대응 |
| `radix-ui` | React Native Reusables | 컴포넌트 단위 재작성 |
| `framer-motion` | `react-native-reanimated` | API 상이, 래퍼 필요 |
| `tailwindcss` v4 | NativeWind v4 | 클래스명 대부분 호환 |
| `pdfjs-dist` | `react-native-pdf` | API 상이 |
| `uuid` | 동일 | 호환 |
| `remeda` | 동일 (JS 라이브러리) | 호환 |

---

## 10. 참고 자료

### 공식 문서

- [Expo SDK 53 Docs](https://docs.expo.dev/)
- [Expo Router v4](https://docs.expo.dev/router/introduction/)
- [NativeWind v4](https://www.nativewind.dev/)
- [React Native Reusables](https://rnr-docs.vercel.app/) (shadcn/ui RN 포트)
- [Turborepo + pnpm](https://turbo.build/repo/docs/getting-started/installation)
- [EAS Build](https://docs.expo.dev/build/introduction/)
- [EAS Update](https://docs.expo.dev/eas-update/introduction/)

### 모노레포 참고 구성

- [Expo Monorepo Example](https://github.com/expo/examples/tree/master/with-yarn-workspaces) (pnpm 변환 필요)
- [Turborepo + Expo](https://github.com/vercel/turbo/tree/main/examples/with-react-native)

### 디자인 가이드

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Material Design 3](https://m3.material.io/)
