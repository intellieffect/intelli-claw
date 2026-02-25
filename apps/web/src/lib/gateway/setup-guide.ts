/**
 * Error-specific gateway setup guide prompts.
 * Users copy these and paste into their AI agent for guided gateway configuration.
 */

interface GuideContext {
  origin?: string;
  deviceId?: string;
  gatewayUrl?: string;
}

export type GuideKey = "origin_not_allowed" | "device_identity_mismatch" | "device_identity_required" | "auth_failed" | "general_setup";

const GUIDES: Record<GuideKey, (ctx: GuideContext) => string> = {
  origin_not_allowed: (ctx) => `OpenClaw Gateway에서 "origin not allowed" 에러가 발생했습니다.

현재 클라이언트 origin: ${ctx.origin || window.location.origin}

아래 작업을 수행해주세요:
1. Gateway 설정 파일(config.yaml 또는 .env)에서 allowedOrigins 목록에 "${ctx.origin || window.location.origin}"을 추가
2. Gateway를 리로드하거나 재시작
3. 예시 (config.yaml):
   allowedOrigins:
     - "${ctx.origin || window.location.origin}"

작업 완료 후 클라이언트에서 재연결하면 됩니다.`,

  device_identity_mismatch: (ctx) => `OpenClaw Gateway에서 "device identity mismatch" 에러가 발생했습니다.

${ctx.deviceId ? `현재 디바이스 ID: ${ctx.deviceId}` : ""}

이 에러는 브라우저의 디바이스 키가 서버에 등록된 것과 다를 때 발생합니다.

해결 방법 (택 1):
1. **클라이언트 디바이스 초기화**: 클라이언트 연결 설정에서 "디바이스 초기화" 버튼 클릭
2. **서버 측 초기화**: Gateway의 paired.json (또는 device store)에서 이 디바이스 항목 삭제 후 Gateway 리로드
3. **디바이스 인증 비활성화** (개발용): Gateway 설정에서 dangerouslyDisableDeviceAuth: true 설정 후 리로드`,

  device_identity_required: (ctx) => `OpenClaw Gateway에서 "device identity required" 에러가 발생했습니다.

이 에러는 서버가 디바이스 인증을 요구하지만 클라이언트가 디바이스 키를 전송하지 못했을 때 발생합니다.

확인 사항:
1. 브라우저가 Web Crypto API를 지원하는지 확인 (HTTPS 또는 localhost 필요)
2. IndexedDB가 차단되지 않았는지 확인 (시크릿 모드에서는 제한될 수 있음)
3. 클라이언트 연결 설정에서 "디바이스 초기화" 후 재연결 시도`,

  auth_failed: (ctx) => `OpenClaw Gateway 인증에 실패했습니다.

확인 사항:
1. Gateway URL이 올바른지 확인: ${ctx.gatewayUrl || "(미설정)"}
2. 인증 토큰이 올바른지 확인 (Gateway 설정의 operatorToken과 일치해야 함)
3. Gateway가 실행 중인지 확인`,

  general_setup: (ctx) => `OpenClaw Gateway 연결 설정 가이드

1. **Gateway URL 확인**: WebSocket URL (예: wss://your-gateway.example.com 또는 ws://127.0.0.1:18789)
2. **인증 토큰 설정**: Gateway의 operatorToken 값을 클라이언트에 입력
3. **Origin 허용**: Gateway allowedOrigins에 "${ctx.origin || window.location.origin}" 추가
4. **Gateway 리로드**: 설정 변경 후 Gateway를 리로드하거나 재시작

현재 설정:
- Gateway URL: ${ctx.gatewayUrl || "(미설정)"}
- Origin: ${ctx.origin || window.location.origin}`,
};

export function getSetupGuide(key: GuideKey, ctx: GuideContext = {}): string {
  ctx.origin = ctx.origin || window.location.origin;
  return GUIDES[key](ctx);
}

/** Classify error code/message into a known category */
export function classifyError(code?: string, message?: string): { guideKey: GuideKey; label: string } | null {
  const c = (code || "").toLowerCase();
  const m = (message || "").toLowerCase();

  if (m.includes("origin not allowed") || c.includes("origin"))
    return { guideKey: "origin_not_allowed", label: "Origin 미등록" };
  if (m.includes("device identity mismatch") || c.includes("device_identity_mismatch"))
    return { guideKey: "device_identity_mismatch", label: "디바이스 불일치" };
  if (m.includes("device identity required") || c.includes("device_identity_required"))
    return { guideKey: "device_identity_required", label: "디바이스 인증 필요" };
  if (c === "auth_timeout")
    return { guideKey: "auth_failed", label: "인증 시간 초과" };
  if (c === "unauthorized" || m.includes("unauthorized"))
    return { guideKey: "auth_failed", label: "인증 실패" };
  return null;
}
