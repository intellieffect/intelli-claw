# Claude Code Channels — intelli-claw 재설계 사양

> Phase 0 산출물. 재설계 Plan (`~/.claude/plans/tingly-sniffing-otter.md`) 의 전제.
> 조사일: 2026-04-15. Claude Code v2.1.108 기준.
> Channels 자체는 **Research Preview** (v2.1.80 도입, v2.1.81에 permission relay 추가).

## TL;DR

- **Channel 플러그인 = MCP 서버 + `claude/channel` experimental capability**. stdio JSON-RPC 전송. 별도 프로토콜 아님.
- **공식 레퍼런스 4종 소스 공개**: `github.com/anthropics/claude-plugins-official/external_plugins/{fakechat,telegram,discord,imessage}` — 로컬 경로 `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/`.
- **intelli-claw의 직접 템플릿은 `fakechat`** — "Simple UI for testing the channel contract without an external service. Open a browser, type, messages go to your Claude Code session, replies come back." (295 LOC Bun 서버, 단일 파일).
- 재설계 범위는 **OpenClaw Gateway 완전 제거**이되, intelli-claw의 멀티-에이전트/세션 라벨/도구 시각화 같은 고급 기능은 Channels 위에 다시 설계해야 한다. Channels는 얇은 브리지이며, 그 위 UI/상태 관리는 전적으로 플러그인 몫.

---

## 1. Plugin 파일 구조 (공식)

출처: `~/.claude/plugins/marketplaces/claude-plugins-official/README.md`, `external_plugins/fakechat/*` 실제 파일.

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json       # 메타데이터 (required)
├── .mcp.json             # MCP 서버 spawn 설정 (channel은 필수)
├── server.ts             # MCP 서버 엔트리포인트
├── package.json          # deps: @modelcontextprotocol/sdk
├── bun.lock
├── .npmrc
├── README.md
└── LICENSE
# 선택:
├── commands/             # 슬래시 커맨드
├── agents/               # 에이전트 정의
├── skills/               # SKILL.md 번들 (telegram처럼 /<name>:access UX 제공 시)
```

### plugin.json 스키마 (확정)

```json
{
  "name": "fakechat",
  "description": "…",
  "version": "0.0.1",
  "keywords": ["channel", "mcp", "…"]
}
```

### .mcp.json 스키마 (확정)

```json
{
  "mcpServers": {
    "fakechat": {
      "command": "bun",
      "args": ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "--shell=bun", "--silent", "start"]
    }
  }
}
```

- `${CLAUDE_PLUGIN_ROOT}` — Claude Code가 치환해 주는 빌트인 환경변수
- `bun`은 런타임 필수 (공식 4종 모두 Bun). Node 대체 가능하나 레퍼런스는 Bun

### package.json 기본 형태

```json
{
  "name": "claude-channel-<name>",
  "version": "0.0.1",
  "license": "Apache-2.0",
  "type": "module",
  "bin": "./server.ts",
  "scripts": { "start": "bun install --no-summary && bun server.ts" },
  "dependencies": { "@modelcontextprotocol/sdk": "^1.0.0" }
}
```

---

## 2. IPC / 전송 (확정)

- **MCP over stdio JSON-RPC**. Claude Code가 `.mcp.json` 설정대로 서버를 subprocess로 spawn하고 stdin/stdout으로 MCP 메시지 주고받음.
- 외부 포트 노출 **금지**. 플러그인이 웹 UI를 호스팅할 때도 반드시 `127.0.0.1` loopback.
- Claude Code는 `claude --channels plugin:<name>@<marketplace>` 플래그로 기동 시에만 해당 플러그인의 `notifications/claude/channel` 을 subscribe. 플래그 누락 시 notification이 silently drop됨 (다수 공개 이슈).

---

## 3. Channel capability 선언

`server.ts`에서:

```ts
const mcp = new Server(
  { name: 'fakechat', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        // v2.1.81+ permission relay opt-in:
        // 'claude/channel/permission': {},
      },
    },
    instructions: `<채널 사용법을 Claude에게 주입하는 system prompt 파편>`,
  },
)
```

`experimental['claude/channel']: {}` 키가 있어야 Claude Code가 해당 서버를 channel으로 인식.

---

## 4. 메시지 포맷 (확정)

### 4.1 Inbound — UI/외부 플랫폼 → Claude

서버가 `mcp.notification()` 호출:

```ts
mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: '사용자 메시지 본문',
    meta: {
      chat_id: 'web',           // 필수: 대화/채널 식별자
      message_id: 'm123',       // 필수: 메시지 고유 ID
      user: 'bruce',            // 선택: 발신자 식별자
      ts: '2026-04-15T…',       // 선택: 타임스탬프 ISO
      file_path: '/abs/path',   // 선택: 첨부파일 절대경로
      // 주의: 하이픈 포함 키는 silently drop. snake_case만.
    },
  },
})
```

Claude context에는 다음 형태로 삽입됨:

```xml
<channel source="fakechat" chat_id="web" message_id="m123" user="bruce">
사용자 메시지 본문
</channel>
```

`meta`의 각 키는 XML attribute로 그대로 들어간다. 따라서 하이픈 포함 키는 XML invalid → drop.

### 4.2 Outbound — Claude → UI

표준 MCP tool call. 플러그인이 `ListToolsRequestSchema` / `CallToolRequestSchema` 핸들러로 노출.

**fakechat의 정식 outbound tools**:

```ts
{
  name: 'reply',
  description: 'Send a message to the fakechat UI. Pass reply_to for quote-reply, files for attachments.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      reply_to: { type: 'string' },       // 이전 message_id
      files: { type: 'array', items: { type: 'string' } },  // 절대경로 배열
    },
    required: ['text'],
  },
}
{
  name: 'edit_message',
  inputSchema: {
    type: 'object',
    properties: {
      message_id: { type: 'string' },
      text: { type: 'string' },
    },
    required: ['message_id', 'text'],
  },
}
```

- `files`는 **절대경로만**. base64/URL 아님. 서버가 읽어서 UI로 전달.
- Telegram/Discord는 추가로 `react(emoji)`, `fetch_messages(...)` (Discord만, 히스토리 API 있을 때) 제공.
- **스트리밍 delta는 없음**. Claude가 완성된 응답을 한 번에 `reply`로 보냄 (필요 시 여러 번 호출하여 청킹). delta 이벤트는 Claude Code 내부 streaming이지, 채널로는 최종 텍스트만 흐름.

### 4.3 Tool-call 이벤트가 채널에 흐르는가?

확정적 답: **아니오**. Channels는 "사람이 읽을 메시지" 브리지. Claude의 내부 tool call은 채널로 자동 전파되지 않는다. 플러그인이 tool 시각화를 원하면 Claude에게 instructions로 "tool 쓸 때마다 reply로 요약 보내라"고 유도하거나, 별도 UX를 포기해야 함. intelli-claw의 현재 tool-call 시각화 기능은 Channels로는 재현 불가.

---

## 5. CLI / 실행 (확정)

- `claude --channels plugin:<name>@<marketplace>` — 설치된 플러그인 채널 활성화. 공백으로 여러 채널 나열 가능.
- `claude --dangerously-load-development-channels server:<name>` — bare MCP 서버를 개발 중 채널로 로드 (allowlist 우회).
- `claude --dangerously-load-development-channels plugin:<name>@<marketplace>` — 플러그인 형태 dev 로드.
- 마켓플레이스 관리: `/plugin install <name>@<marketplace>`, `/plugin uninstall …`, `/plugin list`.
- Claude.ai 인증 필수 (Pro/Max/Team/Enterprise). API key 단독 사용 불가.

출처: `claude --help` 로컬 출력, `https://code.claude.com/docs/en/cli-reference.md`, 공식 플러그인 README들.

---

## 6. Permission Relay (v2.1.81+, auto-approve by default)

> **intelli-claw 현재 동작**: capability는 선언하되 모든 permission_request를 즉시 `allow`로 자동 반송. Pending UI 없음. 원상복구 방법은 `docs/architecture.md` "Permission 모델" 참조.

### 원래 사양 (참고용)

채널이 tool approval 프롬프트도 대행하고 싶을 때:

1. Capability opt-in: `experimental['claude/channel/permission']: {}`
2. Claude가 tool 실행하려면 `notifications/claude/channel/permission_request` 가 채널로 push됨
   - `request_id`: 5자 소문자 `[a-km-z]` (l 제외, 음성 오독 방지)
3. 사용자가 채널 UI에서 `yes <id>` 또는 `no <id>` 입력 → 플러그인이 `notifications/claude/channel/permission` 로 verdict 반송
4. 로컬 터미널 다이얼로그와 병행 실행, **first-to-answer wins**

Regex (telegram/server.ts:84 인용):
```ts
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
```

---

## 7. 상태 저장 규약 (관례)

모든 공식 채널은:

```
~/.claude/channels/<name>/
├── .env          # 0600, 토큰/시크릿 (있을 때)
├── access.json   # 0600, 접근제어 상태 (있을 때)
├── approved/     # 페어링 완료 센티널 디렉터리
├── inbox/        # 외부 플랫폼에서 들어온 파일 (재다운로드 불가한 경우 eager save)
├── outbox/       # Claude가 보낸 파일 (HTTP 서빙용)
└── bot.pid       # 폴링 프로세스 PID (중복 기동 방지)
```

- **Path traversal 방어**: `telegram/server.ts:135-145`의 `assertSendable()`처럼 STATE_DIR 밖 파일만 허용. STATE_DIR 내부는 inbox만 허용 (state 유출 차단).
- **Env 로딩 패턴** (telegram/server.ts:33-40): `STATE_DIR/.env` 파일을 파싱해 `process.env`에 머지. 플러그인 spawn 시 env block이 비어 있으므로.

---

## 8. Auth / Permission 모델

- Claude.ai 로그인 + Claude Code subscription 필수
- 플러그인 마켓플레이스는 allowlist 통과한 것만 일반 경로로 설치 가능
- 서드파티 플러그인은 사용자가 마켓플레이스를 `/plugin marketplace add <github-repo>` 로 명시 등록 후 설치
- Dev 중에는 `--dangerously-load-development-channels` 플래그가 allowlist 우회. **org policy `channelsEnabled`는 여전히 적용됨** (Enterprise/Team 환경)

---

## 9. Known Issues / Gotchas

| 이슈 | 원인 | 회피 |
|------|------|------|
| notification silently dropped | `--channels` 플래그 누락 | 항상 `claude --channels ...`로 기동 |
| 409 Conflict (Telegram) | 이전 세션의 폴링 프로세스 orphan | `bot.pid` 기반 stale killer (레퍼런스 구현) |
| 플러그인 auto-load 중복 spawn (#38098) | `--channels` 없어도 MCP는 spawn되어 토큰 경쟁 | 채널 모드와 MCP 모드 분리 설계 |
| permission prompt 엉뚱한 peer (iMessage #1010) | "polluted SELF set" | SELF handle 감지 로직 신중 |
| `meta`의 하이픈 키 drop | XML attribute로 삽입되므로 | snake_case만 |
| Research preview breaking change 리스크 | 버전 변동 | `@modelcontextprotocol/sdk` 버전 pin, upstream changelog 모니터 |

---

## 10. intelli-claw 재설계 함의 (설계 분기 확정안)

### 10.1 분기 1 — 멀티 에이전트 대체

현재 intelli-claw는 OpenClaw 덕에 `main / claude / content-engine / biz-ops / product-dev / scout` 6종 에이전트와 대화 가능. Channels 위에서는:

**결정 권장**: **(b) 단일 채널 + Claude Code 세션 단위 분리**
- 각 "에이전트" = 별도 Claude Code 세션 = 별도 cwd + 다른 system prompt/skills
- intelli-claw UI 상단에서 "세션 선택 드롭다운"으로 전환
- 기술적: 채널 플러그인은 단일, 세션 선택은 클라이언트가 `session_id`를 meta에 담아 전송하고, 플러그인이 내부 라우팅
- 이유: 채널 여러 인스턴스 기동(옵션 a)은 `bot.pid` / 포트 충돌로 복잡. subagent/skill (옵션 c)은 에이전트 독립성 손실

### 10.2 분기 2 — Web UI 호스팅 위치

현재 intelli-claw web은 Vite dev (4000) + API (4001). fakechat은 플러그인 내부에 Bun 서버로 HTML/WS 번들링 (단일 파일 295 LOC).

**결정 권장**: **(b) Vite 앱 유지 + 플러그인은 HTTP+WS 브리지만 제공**
- 플러그인 `server.ts`는 fakechat 패턴의 HTTP+WS 서버만 (정적 자산 미포함, 최소 300~500 LOC)
- intelli-claw web(Vite)이 플러그인 엔드포인트에 붙어서 UI 렌더링
- 이유: intelli-claw는 shadcn/ui + Tailwind + React 19 수천 LOC. 플러그인에 번들링 불합리. 분리하면 UI는 개별 배포(Vercel 등), 플러그인은 로컬 마켓플레이스에 경량 제공 가능.
- 단점: 기동 절차 2단계 (Vite + `claude --channels`). `scripts/start-dev.sh`가 이를 동시 기동.

### 10.3 분기 3 — 모바일 (Expo)

플러그인이 loopback이면 모바일은 바로 접근 불가.

**결정 권장**: **(a) 플러그인에 LAN/Tailscale HTTPS 모드 추가 + pairing**
- fakechat은 `127.0.0.1` 고정이므로 이 부분은 intelli-claw-channel이 확장해야 함
- pairing 플로우는 telegram 플러그인 패턴 재사용 (6자 코드, `access.json`)
- TLS는 mkcert 또는 Tailscale 내부 HTTPS 활용
- 리스크: 이 확장은 공식 레퍼런스에 선례 없음. 별도 설계 필요 + 보안 리뷰

### 10.4 분기 4 — 비-Anthropic 모델 (Kimi/Codex/Zai 등)

**결정 권장**: **포기 (out of scope)**
- Claude Code Channels는 Claude 세션 한정
- 타 모델 지원 원하면 별도 플러그인/경로. 본 재설계에서는 제외

---

## 11. intelli-claw-channel 최소 구현 스케치

Phase 1에서 구현할 플러그인의 개념 스케치 (fakechat 기반 확장):

```
plugins/intelli-claw-channel/
├── .claude-plugin/plugin.json        # name, version, description
├── .mcp.json                         # bun start 설정
├── server.ts                         # ~500 LOC 예상
│   - MCP: capabilities['claude/channel'] opt-in
│   - MCP tools: reply, edit_message, react(optional), session_switch
│   - HTTP server: 127.0.0.1:<PORT>
│     - GET /config        → {session_ids, tools_metadata}
│     - POST /send         → notification/claude/channel 발행
│     - POST /upload       → inbox/ 저장 후 file_path 포함 notification
│     - WS /stream         → assistant reply 실시간 push
│     - GET /files/<name>  → outbox 서빙
│   - State: ~/.claude/channels/intelli-claw/{inbox,outbox,access.json}
│   - (옵션) LAN HTTPS 모드 + pairing code
├── package.json                      # deps: @modelcontextprotocol/sdk
├── bun.lock
└── README.md
```

**Vite 앱 측 변경 요약**:
- `packages/shared/src/channel/` 신규 → HTTP+WS 클라이언트 (기존 gateway 모듈 대체)
- WS 메시지 포맷: `{type: 'msg' | 'edit' | 'session', ...}` (fakechat의 Wire 타입 확장)
- env: `VITE_CHANNEL_URL`, `VITE_CHANNEL_TOKEN`(LAN 모드에서만)

---

## 12. Phase 1 착수 Gate

- ✅ Manifest/IPC/메시지 API/CLI/Auth 모두 확인됨
- ✅ 공식 레퍼런스 소스 4종 로컬에 확보 (`~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/`)
- ✅ 설계 분기 4개 권장안 제시
- ⚠️ Research Preview — breaking change 리스크는 상수. `@modelcontextprotocol/sdk` 버전 pin 필수
- ⚠️ Tool-call 시각화는 Channels로 재현 불가 → 기능 축소 수용 필요

**Gate 통과 판단**: **Plan B(Agent SDK headless) 불필요. Phase 1 착수 가능.**

---

## 13. 참조

### 공식 문서
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/plugin-marketplaces
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/channels-reference (Agent B 확인, 2026-04 기준 존재)
- https://code.claude.com/docs/en/changelog (v2.1.80 Channels, v2.1.81 permission relay)

### 레퍼런스 소스 (로컬)
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat/server.ts` — **intelli-claw 직접 템플릿**
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts` — access control/pairing/path traversal 방어 패턴
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord/server.ts` — 히스토리 API 있는 채널 패턴
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/imessage/` — 네이티브 OS 자동화 패턴 (참고용)

### GitHub 공개 레포
- https://github.com/anthropics/claude-plugins-official (공식 마켓플레이스)
