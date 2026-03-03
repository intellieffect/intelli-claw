/**
 * issue-111-112-session-reset.test.ts — TDD tests for session reset context preservation
 *
 * #111: Context bridge should preserve sufficient context across session resets
 * #112: Previous session messages should remain visible after session reset
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  trackSessionId,
  markSessionEnded,
  getTopicHistory,
  getCurrentSessionId,
} from "@/lib/gateway/topic-store";
import {
  saveMessages,
  getLocalMessages,
  backfillFromApi,
  isBackfillDone,
  type StoredMessage,
} from "@/lib/gateway/message-store";

// ---------------------------------------------------------------------------
// Replicated pure functions from hooks.tsx for direct testing
// ---------------------------------------------------------------------------

/**
 * buildContextSummary — replicated from hooks.tsx useChat
 * ORIGINAL (broken): slices last 5 messages, MAX_PER_MSG=500
 * FIXED: slices last 10 messages, MAX_PER_MSG=1000, includes tool calls + memory hint
 */
function buildContextSummaryOriginal(
  messages: Array<{
    role: string;
    content: string;
    toolCalls?: Array<{ name: string }>;
  }>,
): string | null {
  const relevant = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-5);
  if (relevant.length === 0) return null;

  const MAX_PER_MSG = 500;
  const lines: string[] = [
    "[System] 이전 세션이 컨텍스트 한도로 갱신되었습니다. 아래는 최근 대화 요약입니다.",
  ];

  for (const m of relevant) {
    const label = m.role === "user" ? "사용자" : "어시스턴트";
    const text = m.content.slice(0, MAX_PER_MSG).replace(/\n/g, " ").trim();
    const toolNames = m.toolCalls?.map((tc) => tc.name).filter(Boolean);
    const toolSuffix =
      toolNames && toolNames.length > 0
        ? ` [tools: ${toolNames.join(", ")}]`
        : "";
    lines.push(
      `${label}: ${text}${text.length >= MAX_PER_MSG ? "…" : ""}${toolSuffix}`,
    );
  }

  lines.push(
    "위 맥락을 참고하여 대화를 이어주세요. 이 메시지에 대해 별도 답변하지 마세요.",
  );
  const full = lines.join("\n");
  return full.length > 2000 ? full.slice(0, 1997) + "…" : full;
}

function buildContextSummaryFixed(
  messages: Array<{
    role: string;
    content: string;
    toolCalls?: Array<{ name: string; args?: string }>;
  }>,
): string | null {
  const relevant = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .slice(-10);
  if (relevant.length === 0) return null;

  const MAX_PER_MSG = 1000;
  const lines: string[] = [
    "[이전 세션 맥락] 이전 세션이 컨텍스트 한도로 갱신되었습니다. 아래는 최근 대화 요약입니다.",
  ];

  for (const m of relevant) {
    const label = m.role === "user" ? "사용자" : "어시스턴트";
    const text = m.content.slice(0, MAX_PER_MSG).replace(/\n/g, " ").trim();
    const toolNames = m.toolCalls?.map((tc) => tc.name).filter(Boolean);
    const toolSuffix =
      toolNames && toolNames.length > 0
        ? ` [tools: ${toolNames.join(", ")}]`
        : "";
    lines.push(
      `${label}: ${text}${text.length >= MAX_PER_MSG ? "…" : ""}${toolSuffix}`,
    );
  }

  lines.push(
    "에이전트 메모리 파일(memory/)을 참조하여 프로젝트 컨텍스트를 복원하세요.",
  );
  lines.push(
    "위 맥락을 참고하여 대화를 이어주세요. 이 메시지에 대해 별도 답변하지 마세요.",
  );
  const full = lines.join("\n");
  return full.length > 4000 ? full.slice(0, 3997) + "…" : full;
}

// ---------------------------------------------------------------------------
// DB cleanup helpers
// ---------------------------------------------------------------------------

function deleteTopicDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("intelli-claw-topics");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteMessageDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("intelli-claw-messages");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// #111 Tests: Context Bridge Preservation
// ---------------------------------------------------------------------------

describe("#111 — Context bridge preserves sufficient context", () => {
  it("original buildContextSummary only uses last 5 messages (insufficient)", () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}: ${"x".repeat(100)}`,
      toolCalls: i === 5 ? [{ name: "read_file" }] : [],
    }));

    const summary = buildContextSummaryOriginal(messages);
    expect(summary).not.toBeNull();

    // Original only captures last 5 — messages 1-7 are lost
    // Count how many "Message N:" references appear
    const messageRefs = summary!.match(/Message \d+/g) || [];
    expect(messageRefs.length).toBe(5); // only 5 messages captured
  });

  it("fixed buildContextSummary uses last 10 messages", () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}: ${"x".repeat(100)}`,
      toolCalls: i === 5 ? [{ name: "read_file" }] : [],
    }));

    const summary = buildContextSummaryFixed(messages);
    expect(summary).not.toBeNull();

    const messageRefs = summary!.match(/Message \d+/g) || [];
    expect(messageRefs.length).toBe(10); // 10 messages captured
  });

  it("fixed buildContextSummary includes tool call information", () => {
    const messages = [
      { role: "user", content: "디자인 토큰 파일을 읽어줘", toolCalls: [] },
      {
        role: "assistant",
        content: "design-tokens.css 파일을 읽었습니다. 주요 색상은...",
        toolCalls: [
          { name: "read_file", args: "design-tokens.css" },
          { name: "web_search" },
        ],
      },
      { role: "user", content: "코드 구조를 분석해줘", toolCalls: [] },
      {
        role: "assistant",
        content: "프로젝트 구조는 monorepo 형태입니다...",
        toolCalls: [{ name: "exec", args: "find . -name '*.ts'" }],
      },
    ];

    const summary = buildContextSummaryFixed(messages);
    expect(summary).not.toBeNull();
    expect(summary).toContain("read_file");
    expect(summary).toContain("web_search");
    expect(summary).toContain("exec");
    expect(summary).toContain("[tools:");
  });

  it("fixed buildContextSummary includes memory file hint", () => {
    const messages = [
      { role: "user", content: "안녕하세요", toolCalls: [] },
      { role: "assistant", content: "안녕하세요! 무엇을 도와드릴까요?", toolCalls: [] },
    ];

    const summary = buildContextSummaryFixed(messages);
    expect(summary).not.toBeNull();
    expect(summary).toContain("메모리 파일");
    expect(summary).toContain("memory/");
  });

  it("fixed buildContextSummary uses MAX_PER_MSG=1000 for longer content", () => {
    const longContent = "A".repeat(800);
    const messages = [
      { role: "user", content: longContent, toolCalls: [] },
      { role: "assistant", content: "OK", toolCalls: [] },
    ];

    // Original truncates at 500
    const originalSummary = buildContextSummaryOriginal(messages);
    expect(originalSummary).toContain("…"); // truncated at 500

    // Fixed keeps full 800-char content (under 1000 limit)
    const fixedSummary = buildContextSummaryFixed(messages);
    expect(fixedSummary).toContain(longContent); // not truncated
    expect(fixedSummary).not.toContain("…"); // should not have truncation for content <1000
  });

  it("context summary for 10+ messages is sufficiently detailed", () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Important context ${i + 1}: detailed information about topic ${i + 1}`,
      toolCalls:
        i % 3 === 0
          ? [{ name: `tool_${i}` }]
          : [],
    }));

    const summary = buildContextSummaryFixed(messages);
    expect(summary).not.toBeNull();

    // Should contain references from messages 6-15 (last 10)
    for (let i = 6; i <= 15; i++) {
      expect(summary).toContain(`context ${i}`);
    }
    // Earlier messages (1-5) should NOT be in summary
    expect(summary).not.toContain("context 1:");
    expect(summary).not.toContain("context 2:");
  });
});

// ---------------------------------------------------------------------------
// #112 Tests: Previous session messages persist after reset
// ---------------------------------------------------------------------------

describe("#112 — Previous session messages visible after reset", () => {
  // jsdom doesn't provide a real localStorage — create a simple in-memory mock
  let localStorageData: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => localStorageData[key] ?? null,
    setItem: (key: string, value: string) => { localStorageData[key] = value; },
    removeItem: (key: string) => { delete localStorageData[key]; },
    clear: () => { localStorageData = {}; },
    get length() { return Object.keys(localStorageData).length; },
    key: (i: number) => Object.keys(localStorageData)[i] ?? null,
  };

  beforeEach(async () => {
    await deleteTopicDB();
    await deleteMessageDB();
    localStorageData = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  it("topic-store records previous sessionId on reset", async () => {
    const sessionKey = "agent:test:main";

    // First session
    await trackSessionId(sessionKey, "session-old-111", { label: "Test" });
    await tick();

    // Session reset: mark old as ended, track new
    await markSessionEnded(sessionKey, "session-old-111", {
      summary: "Discussed design tokens",
    });
    await trackSessionId(sessionKey, "session-new-222", { label: "Test" });

    const history = await getTopicHistory(sessionKey);
    expect(history.length).toBe(2);

    const oldSession = history.find((h) => h.sessionId === "session-old-111");
    expect(oldSession).toBeDefined();
    expect(oldSession!.endedAt).toBeDefined();
    expect(oldSession!.summary).toBe("Discussed design tokens");

    const newSession = history.find((h) => h.sessionId === "session-new-222");
    expect(newSession).toBeDefined();
    expect(newSession!.endedAt).toBeUndefined();
  });

  it("getLocalMessages returns messages from current session key", async () => {
    const sessionKey = "agent:test:main";

    const messages: StoredMessage[] = [
      {
        sessionKey,
        id: "msg-1",
        role: "user",
        content: "Hello from old session",
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        sessionKey,
        id: "msg-2",
        role: "assistant",
        content: "Hi! How can I help?",
        timestamp: "2025-01-01T00:00:01Z",
      },
    ];

    await saveMessages(sessionKey, messages);
    const loaded = await getLocalMessages(sessionKey);
    expect(loaded.length).toBe(2);
    expect(loaded[0].content).toBe("Hello from old session");
    expect(loaded[1].content).toBe("Hi! How can I help?");
  });

  it("messages from previous sessions are preserved in IndexedDB after reset", async () => {
    const sessionKey = "agent:test:main";

    // Save messages from old session
    const oldMessages: StoredMessage[] = [
      {
        sessionKey,
        id: "old-msg-1",
        role: "user",
        content: "디자인 토큰 분석해줘",
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        sessionKey,
        id: "old-msg-2",
        role: "assistant",
        content: "design-tokens.css 파일을 분석했습니다.",
        timestamp: "2025-01-01T00:00:01Z",
      },
    ];
    await saveMessages(sessionKey, oldMessages);

    // Session boundary
    const boundaryMsg: StoredMessage = {
      sessionKey,
      id: "boundary-1",
      role: "session-boundary",
      content: "",
      timestamp: "2025-01-01T01:00:00Z",
      oldSessionId: "session-old",
      newSessionId: "session-new",
    };
    await saveMessages(sessionKey, [boundaryMsg]);

    // New session messages
    const newMessages: StoredMessage[] = [
      {
        sessionKey,
        id: "new-msg-1",
        role: "user",
        content: "이전 대화 이어서 진행",
        timestamp: "2025-01-01T01:00:01Z",
      },
    ];
    await saveMessages(sessionKey, newMessages);

    // All messages (old + boundary + new) should be retrievable
    const allMessages = await getLocalMessages(sessionKey);
    expect(allMessages.length).toBe(4);

    // Should be sorted by timestamp
    expect(allMessages[0].id).toBe("old-msg-1");
    expect(allMessages[1].id).toBe("old-msg-2");
    expect(allMessages[2].id).toBe("boundary-1");
    expect(allMessages[3].id).toBe("new-msg-1");
  });

  it("session boundary message has correct oldSessionId and newSessionId", async () => {
    const sessionKey = "agent:test:main";
    const boundaryMsg: StoredMessage = {
      sessionKey,
      id: "boundary-test",
      role: "session-boundary",
      content: "",
      timestamp: "2025-06-01T00:00:00Z",
      oldSessionId: "abc-123",
      newSessionId: "def-456",
    };
    await saveMessages(sessionKey, [boundaryMsg]);

    const loaded = await getLocalMessages(sessionKey);
    const boundary = loaded.find((m) => m.role === "session-boundary");
    expect(boundary).toBeDefined();
    expect(boundary!.oldSessionId).toBe("abc-123");
    expect(boundary!.newSessionId).toBe("def-456");
  });

  it("backfillFromApi saves previous session messages to IndexedDB", async () => {
    const sessionKey = "agent:test:main";
    const sessionId = "prev-session-abc";

    // Mock fetch to return previous session messages
    const mockMessages = [
      {
        id: "api-1",
        role: "user",
        content: "이전 세션 메시지 1",
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        id: "api-2",
        role: "assistant",
        content: "이전 세션 응답 1",
        timestamp: "2025-01-01T00:00:01Z",
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: mockMessages }),
    });

    const backfilled = await backfillFromApi(
      sessionKey,
      sessionId,
      "http://localhost:4001",
      "test-agent",
    );

    expect(backfilled.length).toBe(2);
    expect(backfilled[0].content).toBe("이전 세션 메시지 1");
    expect(backfilled[1].content).toBe("이전 세션 응답 1");

    // Verify they're in IndexedDB
    const stored = await getLocalMessages(sessionKey);
    expect(stored.length).toBe(2);

    // Verify backfill is marked as done
    expect(isBackfillDone(sessionKey, sessionId)).toBe(true);
  });

  it("backfillFromApi does not re-backfill already done sessions", async () => {
    const sessionKey = "agent:test:main";
    const sessionId = "done-session";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: [{ id: "1", role: "user", content: "test", timestamp: "2025-01-01T00:00:00Z" }] }),
    });

    // First backfill
    await backfillFromApi(sessionKey, sessionId, "http://localhost:4001", "test-agent");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // Second backfill — should skip
    const result = await backfillFromApi(sessionKey, sessionId, "http://localhost:4001", "test-agent");
    expect(result.length).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no additional call
  });

  it("getTopicHistory returns all sessions including ended ones", async () => {
    const sessionKey = "agent:test:main";

    await trackSessionId(sessionKey, "s1", { label: "Session 1" });
    await tick();
    await markSessionEnded(sessionKey, "s1");
    await tick();
    await trackSessionId(sessionKey, "s2", { label: "Session 2" });
    await tick();
    await markSessionEnded(sessionKey, "s2");
    await tick();
    await trackSessionId(sessionKey, "s3", { label: "Session 3" });

    const topics = await getTopicHistory(sessionKey);
    expect(topics.length).toBe(3);

    // Most recent first (sorted by startedAt desc)
    expect(topics[0].sessionId).toBe("s3");
    expect(topics[0].endedAt).toBeUndefined(); // current

    expect(topics[1].sessionId).toBe("s2");
    expect(topics[1].endedAt).toBeDefined(); // ended

    expect(topics[2].sessionId).toBe("s1");
    expect(topics[2].endedAt).toBeDefined(); // ended
  });

  it("getCurrentSessionId returns the active (non-ended) session", async () => {
    const sessionKey = "agent:test:main";

    await trackSessionId(sessionKey, "old-s");
    await tick();
    await markSessionEnded(sessionKey, "old-s");
    await tick();
    await trackSessionId(sessionKey, "new-s");

    const currentId = await getCurrentSessionId(sessionKey);
    expect(currentId).toBe("new-s");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
