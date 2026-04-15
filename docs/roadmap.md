# Roadmap

## Completed

- **Phase 0** — Channels 사양 확정 (`docs/redesign/channels-spec.md`)
- **Phase 1** — `plugins/intelli-claw-channel/` 구현 + 26 tests
- **Phase 2** — `packages/shared/src/channel/` + `apps/web` 재배선 (minimal UI)
- **Phase 3** — OpenClaw 완전 제거 (gateway/hooks/adapters 삭제, dead 컴포넌트/테스트 정리)

## Next

### Phase 4 — 멀티플랫폼 복구

- **Electron** (`apps/desktop/`)
  - BrowserWindow가 loopback 플러그인 엔드포인트에 붙도록 재배선
  - `electron.vite.config.ts`의 Gateway 파생 URL 로직 삭제
  - IPC 핸들러(`media`, `canvas`, `showcase` 등) 재평가 — 대부분 gateway 전제였으므로 대폭 축소 또는 제거
- **Mobile** (`apps/mobile/`)
  - 플러그인에 LAN/Tailscale HTTPS + Bearer pairing 모드 추가
  - Expo 앱이 pairing 코드로 연결

### Phase 5 — 선택

- 자체 플러그인 마켓플레이스 등록 (`claude-plugins-official`과는 별개)
- 채널에 Permission Relay (v2.1.81+) opt-in → 모바일에서 tool approval UI 제공
- UI 확장: tool-call 요약 뷰, 슬래시 커맨드, 세션 히스토리

## Out of Scope

- OpenClaw Gateway/ACP 호환 레이어 부활 — 플랜 원칙 위반
- 비-Anthropic 모델(Kimi/Codex/Zai 등) 직접 지원 — Channels가 Claude 전용
- 기존 `chat-panel.tsx`의 고급 기능(토픽/스레드/서브에이전트 트리 등) 1:1 복원 — 필요 시 Channel 도구/프롬프트로 재현
