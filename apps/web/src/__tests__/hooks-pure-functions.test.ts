/**
 * hooks-pure-functions.test.ts — Unit tests for exported pure functions in hooks.tsx.
 *
 * Tests the ACTUAL exported functions (no inline replication).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeContentForDedup,
  shouldSuppressStreamingPreview,
  truncateForPreview,
  canBeReplyTarget,
  buildReplyTo,
  createPendingStreamSnapshot,
  isPendingStreamSnapshotFresh,
  finalEventKey,
  HIDDEN_REPLY_RE,
  type DisplayMessage,
} from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// normalizeContentForDedup
// ---------------------------------------------------------------------------
describe("normalizeContentForDedup", () => {
  it("collapses multiple spaces to single space", () => {
    expect(normalizeContentForDedup("hello   world")).toBe("hello world");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeContentForDedup("  hello  ")).toBe("hello");
  });

  it("strips gateway timestamp prefix", () => {
    expect(normalizeContentForDedup("[2026-03-03 15:10:00+09:00] 질문")).toBe("질문");
  });

  it("strips System wrapper variants", () => {
    expect(normalizeContentForDedup("[System] important message")).toBe("important message");
    expect(normalizeContentForDedup("(System) important message")).toBe("important message");
    expect(normalizeContentForDedup("System: important message")).toBe("important message");
  });

  it("normalizes image placeholders to (image)", () => {
    expect(normalizeContentForDedup("(image)")).toBe("(image)");
    expect(normalizeContentForDedup("(첨부 파일)")).toBe("(image)");
    expect(normalizeContentForDedup("(이미지)")).toBe("(image)");
    expect(normalizeContentForDedup("")).toBe("(image)");
  });

  it("produces a compact fingerprint for long content (>200 chars) (#155)", () => {
    const long = "a".repeat(300);
    const result = normalizeContentForDedup(long);
    // Should be shorter than original but contain hash for uniqueness
    expect(result.length).toBeLessThan(300);
    expect(result.length).toBeGreaterThan(0);
    // Same input → same output (deterministic)
    expect(normalizeContentForDedup(long)).toBe(result);
  });

  it("distinguishes long content that differs after char 200 (#155)", () => {
    const base = "x".repeat(250);
    const a = normalizeContentForDedup(base + "AAA");
    const b = normalizeContentForDedup(base + "BBB");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// shouldSuppressStreamingPreview
// ---------------------------------------------------------------------------
describe("shouldSuppressStreamingPreview", () => {
  it("suppresses progressive NO_REPLY prefixes", () => {
    const prefixes = ["N", "NO", "NO_", "NO_R", "NO_RE", "NO_REP", "NO_REPL", "NO_REPLY"];
    for (const prefix of prefixes) {
      expect(shouldSuppressStreamingPreview(prefix)).toBe(true);
    }
  });

  it("suppresses HEARTBEAT_OK prefixes", () => {
    const prefixes = ["H", "HE", "HEA", "HEAR", "HEART", "HEARTB", "HEARTBE", "HEARTBEA", "HEARTBEAT", "HEARTBEAT_", "HEARTBEAT_O", "HEARTBEAT_OK"];
    for (const prefix of prefixes) {
      expect(shouldSuppressStreamingPreview(prefix)).toBe(true);
    }
  });

  it("suppresses progressive REPLY_SKIP prefixes", () => {
    const prefixes = ["R", "RE", "REP", "REPL", "REPLY", "REPLY_", "REPLY_S", "REPLY_SK", "REPLY_SKI", "REPLY_SKIP"];
    for (const prefix of prefixes) {
      expect(shouldSuppressStreamingPreview(prefix)).toBe(true);
    }
  });

  it("does not suppress normal text", () => {
    expect(shouldSuppressStreamingPreview("Hello world")).toBe(false);
    expect(shouldSuppressStreamingPreview("Not a control token")).toBe(false);
  });

  it("does not suppress empty string", () => {
    expect(shouldSuppressStreamingPreview("")).toBe(false);
  });

  it("suppresses full hidden reply patterns", () => {
    expect(shouldSuppressStreamingPreview("NO_REPLY")).toBe(true);
    expect(shouldSuppressStreamingPreview("HEARTBEAT_OK")).toBe(true);
    expect(shouldSuppressStreamingPreview("REPLY_SKIP")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// truncateForPreview
// ---------------------------------------------------------------------------
describe("truncateForPreview", () => {
  it("returns short text unchanged", () => {
    expect(truncateForPreview("Hello")).toBe("Hello");
  });

  it("truncates long text with ellipsis", () => {
    const long = "a".repeat(150);
    const result = truncateForPreview(long);
    expect(result.length).toBe(100);
    expect(result.endsWith("…")).toBe(true);
  });

  it("collapses multiline to single line", () => {
    expect(truncateForPreview("line1\nline2\nline3")).toBe("line1 line2 line3");
  });
});

// ---------------------------------------------------------------------------
// canBeReplyTarget
// ---------------------------------------------------------------------------
describe("canBeReplyTarget", () => {
  it("returns false for system messages", () => {
    const msg: DisplayMessage = {
      id: "1", role: "system", content: "System msg", timestamp: "", toolCalls: [],
    };
    expect(canBeReplyTarget(msg)).toBe(false);
  });

  it("returns false for session-boundary", () => {
    const msg: DisplayMessage = {
      id: "1", role: "session-boundary", content: "", timestamp: "", toolCalls: [],
    };
    expect(canBeReplyTarget(msg)).toBe(false);
  });

  it("returns false for hidden reply content", () => {
    const msg: DisplayMessage = {
      id: "1", role: "assistant", content: "NO_REPLY", timestamp: "", toolCalls: [],
    };
    expect(canBeReplyTarget(msg)).toBe(false);
  });

  it("returns true for normal user/assistant messages", () => {
    const user: DisplayMessage = {
      id: "1", role: "user", content: "Hello", timestamp: "", toolCalls: [],
    };
    const assistant: DisplayMessage = {
      id: "2", role: "assistant", content: "Hi there", timestamp: "", toolCalls: [],
    };
    expect(canBeReplyTarget(user)).toBe(true);
    expect(canBeReplyTarget(assistant)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildReplyTo
// ---------------------------------------------------------------------------
describe("buildReplyTo", () => {
  it("builds valid ReplyTo for normal message", () => {
    const msg: DisplayMessage = {
      id: "msg-1", role: "user", content: "Test question", timestamp: "", toolCalls: [],
    };
    const reply = buildReplyTo(msg);
    expect(reply).toEqual({
      id: "msg-1",
      content: "Test question",
      role: "user",
    });
  });

  it("returns null for non-reply-target messages", () => {
    const msg: DisplayMessage = {
      id: "1", role: "system", content: "system", timestamp: "", toolCalls: [],
    };
    expect(buildReplyTo(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createPendingStreamSnapshot / isPendingStreamSnapshotFresh
// ---------------------------------------------------------------------------
describe("PendingStreamSnapshot", () => {
  it("creates snapshot with correct structure", () => {
    const snapshot = createPendingStreamSnapshot({
      runId: "run-1",
      streamId: "stream-1",
      content: "Partial content",
      toolCalls: [{ callId: "tc-1", name: "search", args: "{}", status: "running" }],
      now: 1_000_000,
    });

    expect(snapshot.v).toBe(2);
    expect(snapshot.runId).toBe("run-1");
    expect(snapshot.streamId).toBe("stream-1");
    expect(snapshot.content).toBe("Partial content");
    expect(snapshot.toolCalls).toHaveLength(1);
    expect(snapshot.toolCalls[0].callId).toBe("tc-1");
    expect(snapshot.updatedAt).toBe(1_000_000);
  });

  it("is fresh within TTL (45s)", () => {
    const now = 1_700_000_000_000;
    const snapshot = createPendingStreamSnapshot({
      runId: "run-1",
      streamId: "s-1",
      content: "x",
      toolCalls: [],
      now: now - 10_000,
    });
    expect(isPendingStreamSnapshotFresh(snapshot, now)).toBe(true);
  });

  it("is stale beyond TTL", () => {
    const now = 1_700_000_000_000;
    const snapshot = createPendingStreamSnapshot({
      runId: "run-1",
      streamId: "s-1",
      content: "x",
      toolCalls: [],
      now: now - 60_000,
    });
    expect(isPendingStreamSnapshotFresh(snapshot, now)).toBe(false);
  });

  it("rejects snapshot with wrong version", () => {
    const snapshot = createPendingStreamSnapshot({
      runId: "run-1",
      streamId: "s-1",
      content: "x",
      toolCalls: [],
    });
    // Tamper with version to an unsupported value
    (snapshot as any).v = 99;
    expect(isPendingStreamSnapshotFresh(snapshot)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// finalEventKey
// ---------------------------------------------------------------------------
describe("finalEventKey", () => {
  it("returns formatted key for valid runId", () => {
    expect(finalEventKey("run-123")).toBe("run:run-123");
  });

  it("returns null for null runId", () => {
    expect(finalEventKey(null)).toBeNull();
  });

  it("returns null for undefined runId", () => {
    expect(finalEventKey(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HIDDEN_REPLY_RE pattern
// ---------------------------------------------------------------------------
describe("HIDDEN_REPLY_RE", () => {
  it("matches known hidden patterns", () => {
    const patterns = [
      "NO_REPLY",
      "REPLY_SKIP",
      "HEARTBEAT_OK",
      "NO_",
      "NO",
      "Pre-compaction memory flush...",
      "Read HEARTBEAT.md and respond",
      "reply with NO_REPLY",
      "Store durable memories now",
      "[System] 이전 세션이 컨텍스트 한도로 갱신",
      "(System) 이전 세션이 컨텍스트 한도로 갱신",
      "이전 세션이 컨텍스트 한도로 갱신되었습니다. 아래는 최근 대화 요약입니다.",
      "[이전 세션 맥락]",
    ];
    for (const p of patterns) {
      expect(HIDDEN_REPLY_RE.test(p.trim())).toBe(true);
    }
  });

  it("does not match normal messages", () => {
    const normals = [
      "Hello world",
      "How are you?",
      "Let me help",
    ];
    for (const n of normals) {
      expect(HIDDEN_REPLY_RE.test(n.trim())).toBe(false);
    }
  });

  it("does not match partial hidden pattern in middle of text", () => {
    expect(HIDDEN_REPLY_RE.test("NO_REPLY is a pattern")).toBe(false);
  });
});
