/**
 * 첫 사용자 시나리오 통합 테스트
 *
 * 설정 없이 앱을 처음 여는 사용자의 전체 플로우:
 * 1. localStorage 비어 있음, env도 없음 → 기본 URL로 연결 시도
 * 2. 연결 실패 → ConnectionStatus에 에러 표시
 * 3. ConnectionStatus 클릭 → 설정 다이얼로그 열림
 * 4. URL/토큰 입력 후 저장 → localStorage에 저장 + 재연결
 * 5. 에러 발생 시 → 가이드 프롬프트 복사 가능
 * 6. 디바이스 초기화 동작
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { GatewayProvider, useGateway, GATEWAY_CONFIG_STORAGE_KEY, DEFAULT_GATEWAY_URL } from "@/lib/gateway/hooks";
import { ConnectionStatus, STATUS_CONFIG } from "@/components/chat/connection-status";
import { ConnectionSettings } from "@/components/settings/connection-settings";
import { classifyError, getSetupGuide } from "@/lib/gateway/setup-guide";
import type { ErrorShape } from "@/lib/gateway/protocol";

// --- Mock device-identity ---
const mockClearDeviceIdentity = vi.fn(async () => {});
const mockGetOrCreateDevice = vi.fn(async () => ({
  id: "test-device-abc123",
  publicKey: {} as CryptoKey,
  privateKey: {} as CryptoKey,
  publicKeyJwk: { kty: "EC", crv: "P-256" },
  createdAt: Date.now(),
}));

vi.mock("@/lib/gateway/device-identity", () => ({
  signChallenge: vi.fn(async (nonce: string) => ({
    id: "test-device-abc123",
    publicKey: '{"kty":"EC","crv":"P-256"}',
    signature: "dGVzdA==",
    signedAt: Date.now(),
    nonce,
  })),
  clearDeviceIdentity: (...args: unknown[]) => mockClearDeviceIdentity(...args),
  getOrCreateDevice: (...args: unknown[]) => mockGetOrCreateDevice(...args),
}));

// --- Mock WebSocket ---
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.(); }

  simulateMessage(data: string) { this.onmessage?.({ data }); }
  simulateClose() { this.onclose?.(); }
  simulateError() { this.onerror?.(); }
}

// --- Mock clipboard ---
const mockClipboard = { text: "", writeText: vi.fn(async (t: string) => { mockClipboard.text = t; }) };

// --- Helpers ---
function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

async function completeHandshake(ws: MockWebSocket) {
  // Simulate challenge
  ws.simulateMessage(JSON.stringify({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "n1" },
  }));
  await new Promise((r) => setTimeout(r, 10));

  const connectReq = JSON.parse(ws.sent[0]);

  // Simulate hello-ok
  ws.simulateMessage(JSON.stringify({
    type: "res",
    id: connectReq.id,
    ok: true,
    payload: {
      type: "hello-ok",
      protocol: 3,
      server: { version: "2.0.0", commit: "abc12345", connId: "c1" },
      features: { methods: [], events: [] },
      snapshot: {
        presence: [],
        health: {},
        stateVersion: { presence: 0, health: 0 },
        uptimeMs: 0,
        sessionDefaults: { mainSessionKey: "agent:alpha:main" },
      },
      policy: {},
    },
  }));
}

async function failHandshakeWithError(ws: MockWebSocket, error: ErrorShape) {
  // Simulate challenge
  ws.simulateMessage(JSON.stringify({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "n1" },
  }));
  await new Promise((r) => setTimeout(r, 10));

  const connectReq = JSON.parse(ws.sent[0]);

  // Simulate error response
  ws.simulateMessage(JSON.stringify({
    type: "res",
    id: connectReq.id,
    ok: false,
    error,
  }));

  // Server closes connection after auth error
  ws.simulateClose();
}

// --- localStorage mock ---
let lsStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => lsStore[key] ?? null,
  setItem: (key: string, value: string) => { lsStore[key] = value; },
  removeItem: (key: string) => { delete lsStore[key]; },
  clear: () => { lsStore = {}; },
};

// --- sessionStorage mock (#229: token storage) ---
let ssStore: Record<string, string> = {};
const mockSessionStorage = {
  getItem: (key: string) => ssStore[key] ?? null,
  setItem: (key: string, value: string) => { ssStore[key] = value; },
  removeItem: (key: string) => { delete ssStore[key]; },
  clear: () => { ssStore = {}; },
};

// --- Test Suite ---
describe("첫 사용자 시나리오", () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    lsStore = {};
    ssStore = {};
    MockWebSocket.instances = [];
    mockClearDeviceIdentity.mockClear();
    mockGetOrCreateDevice.mockClear();
    mockClipboard.text = "";
    mockClipboard.writeText.mockClear();

    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error mock
    globalThis.WebSocket = MockWebSocket;

    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("sessionStorage", mockSessionStorage);

    Object.defineProperty(navigator, "clipboard", {
      value: mockClipboard,
      writable: true,
      configurable: true,
    });

    // Vite env 초기화 — 첫 사용자에게는 env 없음
    vi.stubEnv("VITE_GATEWAY_URL", "");
    vi.stubEnv("VITE_GATEWAY_TOKEN", "");
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // ─── 1. 설정 없이 기본 URL로 연결 시도 ───

  describe("1. 초기 연결 시도", () => {
    it("localStorage와 env가 비어 있으면 기본 URL로 연결", async () => {
      render(
        <GatewayProvider>
          <div>test</div>
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
      expect(latestWs().url).toBe(DEFAULT_GATEWAY_URL);
    });

    it("env 값이 있으면 그 URL로 연결", async () => {
      vi.stubEnv("VITE_GATEWAY_URL", "ws://custom:9999");

      // 이미 모듈이 로드된 후라 직접 GatewayProvider를 사용해 테스트
      // loadGatewayConfig는 매 호출 시 import.meta.env를 참조
      render(
        <GatewayProvider>
          <div>test</div>
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(latestWs().url).toBe("ws://custom:9999");
    });

    it("localStorage에 저장된 설정이 env보다 우선 (같은 URL일 때)", async () => {
      // When env URL matches localStorage URL, localStorage token wins
      vi.stubEnv("VITE_GATEWAY_URL", "ws://saved-url:5678");
      mockLocalStorage.setItem(GATEWAY_CONFIG_STORAGE_KEY, JSON.stringify({
        url: "ws://saved-url:5678",
        token: "saved-token",
      }));

      render(
        <GatewayProvider>
          <div>test</div>
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(latestWs().url).toBe("ws://saved-url:5678");
    });

    it("env URL이 non-default이고 localStorage와 다르면 env가 우선", async () => {
      // Deployment target changed — env wins, stale localStorage cleared (#220)
      vi.stubEnv("VITE_GATEWAY_URL", "ws://new-deploy:1234");
      mockLocalStorage.setItem(GATEWAY_CONFIG_STORAGE_KEY, JSON.stringify({
        url: "ws://old-saved:5678",
        token: "old-token",
      }));

      render(
        <GatewayProvider>
          <div>test</div>
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(latestWs().url).toBe("ws://new-deploy:1234");
    });
  });

  // ─── 2. 연결 실패 시 에러 표시 ───

  describe("2. 연결 실패 → 에러 표시", () => {
    it("disconnected 상태에서 에러 없으면 '연결 끊김' 표시", () => {
      render(<ConnectionStatus state="disconnected" />);
      expect(screen.getByText("연결 끊김")).toBeInTheDocument();
    });

    it("origin not allowed 에러 시 'Origin 미등록' 표시", () => {
      const error: ErrorShape = { code: "FORBIDDEN", message: "origin not allowed" };
      render(<ConnectionStatus state="disconnected" error={error} />);
      expect(screen.getByText("Origin 미등록")).toBeInTheDocument();
    });

    it("device identity mismatch 에러 시 '디바이스 불일치' 표시", () => {
      const error: ErrorShape = { code: "device_identity_mismatch", message: "Device identity mismatch" };
      render(<ConnectionStatus state="disconnected" error={error} />);
      expect(screen.getByText("디바이스 불일치")).toBeInTheDocument();
    });

    it("device identity required 에러 시 '디바이스 인증 필요' 표시", () => {
      const error: ErrorShape = { code: "device_identity_required", message: "Device identity required" };
      render(<ConnectionStatus state="disconnected" error={error} />);
      expect(screen.getByText("디바이스 인증 필요")).toBeInTheDocument();
    });

    it("auth_timeout 에러 시 '인증 시간 초과' 표시", () => {
      const error: ErrorShape = { code: "auth_timeout", message: "Authentication timed out" };
      render(<ConnectionStatus state="disconnected" error={error} />);
      expect(screen.getByText("인증 시간 초과")).toBeInTheDocument();
    });

    it("unauthorized 에러 시 '인증 실패' 표시", () => {
      const error: ErrorShape = { code: "unauthorized", message: "Invalid token" };
      render(<ConnectionStatus state="disconnected" error={error} />);
      expect(screen.getByText("인증 실패")).toBeInTheDocument();
    });

    it("알 수 없는 에러 시 메시지 그대로 표시 (20자 초과 시 truncate)", () => {
      const error: ErrorShape = { code: "UNKNOWN", message: "Something very unexpected happened here" };
      render(<ConnectionStatus state="disconnected" error={error} />);
      expect(screen.getByText("Something very unexp...")).toBeInTheDocument();
    });

    it("connected 상태에서는 에러 무시하고 '연결됨' 표시", () => {
      const error: ErrorShape = { code: "old_error", message: "stale" };
      render(<ConnectionStatus state="connected" error={error} />);
      expect(screen.getByText("연결됨")).toBeInTheDocument();
    });
  });

  // ─── 3. ConnectionStatus 클릭 → 설정 다이얼로그 ───

  describe("3. 설정 다이얼로그", () => {
    it("onClick이 있으면 클릭 가능, 없으면 cursor-default", () => {
      const onClick = vi.fn();
      const { rerender } = render(<ConnectionStatus state="disconnected" onClick={onClick} />);

      const btn = screen.getByText("연결 끊김").closest("button")!;
      expect(btn.className).toContain("cursor-pointer");
      fireEvent.click(btn);
      expect(onClick).toHaveBeenCalled();

      rerender(<ConnectionStatus state="disconnected" />);
      const btn2 = screen.getByText("연결 끊김").closest("button")!;
      expect(btn2.className).toContain("cursor-default");
    });
  });

  // ─── 4. ConnectionSettings 다이얼로그 ───

  describe("4. 연결 설정 다이얼로그 상호작용", () => {
    // 다이얼로그를 GatewayProvider 안에서 렌더링하는 래퍼
    function SettingsTestWrapper({ open }: { open: boolean }) {
      const gateway = useGateway();
      return (
        <>
          <div data-testid="state">{gateway.state}</div>
          <ConnectionSettings open={open} onClose={vi.fn()} />
        </>
      );
    }

    it("open=false이면 아무것도 렌더링하지 않음", () => {
      render(
        <GatewayProvider>
          <SettingsTestWrapper open={false} />
        </GatewayProvider>
      );
      expect(screen.queryByText("연결 설정")).not.toBeInTheDocument();
    });

    it("open=true이면 URL/토큰/디바이스 ID 필드 렌더링", async () => {
      render(
        <GatewayProvider>
          <SettingsTestWrapper open={true} />
        </GatewayProvider>
      );

      await waitFor(() => {
        expect(screen.getByText("연결 설정")).toBeInTheDocument();
      });

      expect(screen.getByPlaceholderText("wss://your-gateway.example.com")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Gateway operator token")).toBeInTheDocument();
      expect(screen.getByText("Device ID")).toBeInTheDocument();
    });

    it("디바이스 ID를 표시함", async () => {
      render(
        <GatewayProvider>
          <SettingsTestWrapper open={true} />
        </GatewayProvider>
      );

      await waitFor(() => {
        expect(screen.getByText("test-device-abc123")).toBeInTheDocument();
      });
    });

    it("URL/토큰 입력 후 저장하면 localStorage에 저장됨", async () => {
      const onClose = vi.fn();

      function Wrapper() {
        return (
          <GatewayProvider>
            <ConnectionSettings open={true} onClose={onClose} />
          </GatewayProvider>
        );
      }

      render(<Wrapper />);
      await new Promise((r) => setTimeout(r, 10));

      const urlInput = screen.getByPlaceholderText("wss://your-gateway.example.com");
      const tokenInput = screen.getByPlaceholderText("Gateway operator token");

      fireEvent.change(urlInput, { target: { value: "ws://new-server:9999" } });
      fireEvent.change(tokenInput, { target: { value: "my-secret-token" } });

      const saveBtn = screen.getByText(/저장/);
      fireEvent.click(saveBtn);

      // #229: URL → localStorage, token → sessionStorage
      const saved = JSON.parse(mockLocalStorage.getItem(GATEWAY_CONFIG_STORAGE_KEY) || "{}");
      expect(saved.url).toBe("ws://new-server:9999");
      expect(saved.token).toBeUndefined();
      expect(mockSessionStorage.getItem("awf:gateway-token")).toBe("my-secret-token");

      // 새 WebSocket 연결이 생성됐는지 확인
      await new Promise((r) => setTimeout(r, 20));
      const newWs = latestWs();
      expect(newWs.url).toBe("ws://new-server:9999");
    });

    it("디바이스 초기화 버튼 클릭 시 clearDeviceIdentity 호출", async () => {
      render(
        <GatewayProvider>
          <ConnectionSettings open={true} onClose={vi.fn()} />
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));

      const resetBtn = screen.getByText("초기화");
      await act(async () => {
        fireEvent.click(resetBtn);
      });

      expect(mockClearDeviceIdentity).toHaveBeenCalled();
    });

    it("ESC 키로 다이얼로그 닫기", async () => {
      const onClose = vi.fn();

      render(
        <GatewayProvider>
          <ConnectionSettings open={true} onClose={onClose} />
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ─── 5. 에러별 가이드 프롬프트 ───

  describe("5. 가이드 프롬프트 생성 및 복사", () => {
    it("classifyError가 올바른 guideKey와 label을 반환", () => {
      expect(classifyError("FORBIDDEN", "origin not allowed")).toEqual({
        guideKey: "origin_not_allowed",
        label: "Origin 미등록",
      });
      expect(classifyError("device_identity_mismatch", "")).toEqual({
        guideKey: "device_identity_mismatch",
        label: "디바이스 불일치",
      });
      expect(classifyError("device_identity_required", "")).toEqual({
        guideKey: "device_identity_required",
        label: "디바이스 인증 필요",
      });
      expect(classifyError("auth_timeout", "")).toEqual({
        guideKey: "auth_failed",
        label: "인증 시간 초과",
      });
      expect(classifyError("unauthorized", "")).toEqual({
        guideKey: "auth_failed",
        label: "인증 실패",
      });
      expect(classifyError("RANDOM_CODE", "nothing special")).toBeNull();
    });

    it("getSetupGuide가 origin 플레이스홀더를 치환", () => {
      const guide = getSetupGuide("origin_not_allowed", { origin: "http://localhost:4000" });
      expect(guide).toContain("http://localhost:4000");
      expect(guide).toContain("allowedOrigins");
    });

    it("getSetupGuide가 deviceId를 포함", () => {
      const guide = getSetupGuide("device_identity_mismatch", { deviceId: "dev-123" });
      expect(guide).toContain("dev-123");
    });

    it("getSetupGuide가 gatewayUrl을 포함", () => {
      const guide = getSetupGuide("auth_failed", { gatewayUrl: "wss://my.server.com" });
      expect(guide).toContain("wss://my.server.com");
    });

    it("general_setup 가이드가 모든 정보를 포함", () => {
      const guide = getSetupGuide("general_setup", {
        origin: "http://localhost:4000",
        gatewayUrl: "ws://127.0.0.1:18789",
      });
      expect(guide).toContain("http://localhost:4000");
      expect(guide).toContain("ws://127.0.0.1:18789");
      expect(guide).toContain("operatorToken");
    });

    it("에러 상태에서 다이얼로그에 가이드 프롬프트와 복사 버튼 표시", async () => {
      // 에러 상태를 가진 GatewayProvider를 시뮬레이션하기 위해
      // 직접 연결 실패를 만듦
      render(
        <GatewayProvider>
          <ErrorSettingsWrapper />
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));

      // 연결 실패 시뮬레이션
      const ws = latestWs();
      await act(async () => {
        await failHandshakeWithError(ws, {
          code: "FORBIDDEN",
          message: "origin not allowed",
        });
      });

      // 약간 대기 후 확인
      await waitFor(() => {
        expect(screen.getByText("설정 가이드 (AI agent에 전달)")).toBeInTheDocument();
      });

      // 복사 버튼 클릭
      const copyBtn = screen.getByText("복사");
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(mockClipboard.writeText).toHaveBeenCalled();
      const copiedText = mockClipboard.writeText.mock.calls[0][0];
      expect(copiedText).toContain("origin not allowed");
      expect(copiedText).toContain("allowedOrigins");
    });

    it("연결 끊김 상태(에러 없음)에서는 general_setup 가이드 표시", async () => {
      render(
        <GatewayProvider>
          <DisconnectedSettingsWrapper />
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));

      // 연결 시도 없이 바로 닫히게 시뮬레이션
      const ws = latestWs();
      act(() => {
        ws.simulateClose();
      });

      await waitFor(() => {
        expect(screen.getByText("설정 가이드 (AI agent에 전달)")).toBeInTheDocument();
      });
    });
  });

  // ─── 6. 전체 플로우 통합 ───

  describe("6. 전체 플로우: 실패 → 설정 → 성공", () => {
    it("잘못된 토큰으로 연결 실패 → 올바른 토큰으로 재연결 성공", async () => {
      const states: string[] = [];

      function FlowTestWrapper() {
        const { state, error, updateConfig } = useGateway();
        // 상태 추적
        if (states.length === 0 || states[states.length - 1] !== state) {
          states.push(state);
        }
        return (
          <>
            <ConnectionStatus state={state} error={error} />
            <button data-testid="reconfigure" onClick={() => updateConfig("ws://good-server:18789", "correct-token")} />
          </>
        );
      }

      render(
        <GatewayProvider>
          <FlowTestWrapper />
        </GatewayProvider>
      );

      await new Promise((r) => setTimeout(r, 10));

      // Phase 1: 연결은 되지만 인증 실패
      const ws1 = latestWs();
      await act(async () => {
        await failHandshakeWithError(ws1, {
          code: "unauthorized",
          message: "Invalid token",
        });
      });

      await waitFor(() => {
        expect(screen.getByText("인증 실패")).toBeInTheDocument();
      });

      // Phase 2: 사용자가 올바른 설정으로 재연결
      // 재연결 타이머 방지를 위해 즉시 updateConfig 호출
      await act(async () => {
        fireEvent.click(screen.getByTestId("reconfigure"));
      });

      await new Promise((r) => setTimeout(r, 10));

      // 새 WebSocket이 올바른 URL로 연결
      const ws2 = latestWs();
      expect(ws2.url).toBe("ws://good-server:18789");

      // 이번에는 인증 성공
      await act(async () => {
        await completeHandshake(ws2);
      });

      await waitFor(() => {
        expect(screen.getByText("연결됨")).toBeInTheDocument();
      });

      // 상태 전이 확인: disconnected → connecting → authenticating → ... → connected
      expect(states).toContain("connected");
    });
  });

  // ─── 7. STATUS_CONFIG export 일관성 ───

  describe("7. STATUS_CONFIG 상수 일관성", () => {
    it("모든 ConnectionState에 대해 레이블이 정의됨", () => {
      const allStates: Array<keyof typeof STATUS_CONFIG> = ["disconnected", "connecting", "authenticating", "connected"];
      for (const s of allStates) {
        expect(STATUS_CONFIG[s]).toBeDefined();
        expect(STATUS_CONFIG[s].label).toBeTruthy();
        expect(STATUS_CONFIG[s].color).toBeTruthy();
      }
    });
  });
});

// --- 헬퍼 컴포넌트 ---

/** 에러가 있는 상태에서 설정 다이얼로그를 여는 래퍼 */
function ErrorSettingsWrapper() {
  const { error } = useGateway();
  // 항상 열려있는 설정
  return <ConnectionSettings open={true} onClose={vi.fn()} />;
}

/** 연결 끊김 상태에서 설정 다이얼로그를 여는 래퍼 */
function DisconnectedSettingsWrapper() {
  return <ConnectionSettings open={true} onClose={vi.fn()} />;
}
