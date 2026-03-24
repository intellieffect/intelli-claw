/**
 * #256 — Cmd+R 새로고침 시 새 창(Cmd+N)의 변경된 세션이 최초 세션으로 복귀되는 이슈
 *
 * 검증 대상:
 * 1. buildReloadTarget — windowSessionKeys에서 최신 sessionKey를 읽어 URL/file 타겟 구성
 * 2. 세션 변경 후 reload 시 최신 sessionKey 반영
 * 3. 세션 미변경(windowSessionKeys에 없는 경우) 시 기본 URL로 fallback
 * 4. Dev(URL) / Prod(file) 양쪽 경로 모두 커버
 */
import { describe, it, expect } from "vitest";
import { buildReloadTarget, type ReloadContext } from "../../../desktop/src/main/window-reload";

function makeCtx(overrides: Partial<ReloadContext> & { sessions?: [number, string][] } = {}): ReloadContext {
  const sessions = overrides.sessions ?? [];
  const map = new Map<number, string>(sessions);
  return {
    windowId: "windowId" in overrides ? overrides.windowId : 1,
    windowSessionKeys: map,
    rendererUrl: overrides.rendererUrl ?? undefined,
    rendererHtmlPath: overrides.rendererHtmlPath ?? "/app/renderer/index.html",
  };
}

// ─── Dev mode (rendererUrl) ──────────────────────────────────────

describe("#256 — buildReloadTarget (dev mode)", () => {
  const devUrl = "http://localhost:5173";

  it("should include latest sessionKey in URL when session was changed", () => {
    const ctx = makeCtx({
      rendererUrl: devUrl,
      windowId: 2,
      sessions: [[2, "agent:claude:chat-99"]],
    });
    const target = buildReloadTarget(ctx);
    expect(target.kind).toBe("url");
    if (target.kind === "url") {
      expect(target.url).toContain("session=agent%3Aclaude%3Achat-99");
    }
  });

  it("should return plain URL when no session is tracked for window", () => {
    const ctx = makeCtx({ rendererUrl: devUrl, windowId: 5, sessions: [] });
    const target = buildReloadTarget(ctx);
    expect(target.kind).toBe("url");
    if (target.kind === "url") {
      expect(target.url).toBe(devUrl);
      expect(target.url).not.toContain("session=");
    }
  });

  it("should use & separator when rendererUrl already has query params", () => {
    const ctx = makeCtx({
      rendererUrl: "http://localhost:5173?theme=dark",
      windowId: 1,
      sessions: [[1, "agent:gpt:main"]],
    });
    const target = buildReloadTarget(ctx);
    if (target.kind === "url") {
      expect(target.url).toContain("&session=");
      expect(target.url).not.toContain("?session=");
    }
  });

  it("should handle windowId undefined gracefully (no session)", () => {
    const ctx = makeCtx({
      rendererUrl: devUrl,
      windowId: undefined,
      sessions: [[1, "agent:test:s1"]],
    });
    const target = buildReloadTarget(ctx);
    if (target.kind === "url") {
      expect(target.url).toBe(devUrl);
    }
  });
});

// ─── Production mode (file) ─────────────────────────────────────

describe("#256 — buildReloadTarget (production mode)", () => {
  const htmlPath = "/app/out/renderer/index.html";

  it("should return file target with session query when session is tracked", () => {
    const ctx = makeCtx({
      rendererHtmlPath: htmlPath,
      windowId: 3,
      sessions: [[3, "agent:assistant:session-42"]],
    });
    const target = buildReloadTarget(ctx);
    expect(target.kind).toBe("file");
    if (target.kind === "file") {
      expect(target.filePath).toBe(htmlPath);
      expect(target.query).toEqual({ session: "agent:assistant:session-42" });
    }
  });

  it("should return file target without query when no session tracked", () => {
    const ctx = makeCtx({ rendererHtmlPath: htmlPath, windowId: 7, sessions: [] });
    const target = buildReloadTarget(ctx);
    expect(target.kind).toBe("file");
    if (target.kind === "file") {
      expect(target.filePath).toBe(htmlPath);
      expect(target.query).toBeUndefined();
    }
  });
});

// ─── 세션 변경 시나리오 ─────────────────────────────────────────

describe("#256 — Session change then reload scenario", () => {
  it("should reflect the LATEST session, not the initial one", () => {
    // Simulate: window opened with session A, user switches to B via IPC
    const sessions = new Map<number, string>();
    sessions.set(1, "agent:claude:initial-session");  // initial
    sessions.set(1, "agent:claude:switched-session");  // user changed

    const ctx: ReloadContext = {
      windowId: 1,
      windowSessionKeys: sessions,
      rendererUrl: "http://localhost:5173",
      rendererHtmlPath: "/app/renderer/index.html",
    };

    const target = buildReloadTarget(ctx);
    if (target.kind === "url") {
      expect(target.url).toContain("session=agent%3Aclaude%3Aswitched-session");
      expect(target.url).not.toContain("initial-session");
    }
  });
});
