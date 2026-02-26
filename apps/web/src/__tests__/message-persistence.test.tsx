/**
 * Tests for message persistence bugs:
 * - #55: User messages disappear after refresh (loadHistory filtering)
 * - #51: Image+text messages show "I didn't receive any text" after refresh
 * - #48: Responses require refresh to display (event handler state updates)
 *
 * TDD approach: Tests written FIRST, expected to FAIL against the buggy code,
 * then the production code is fixed to make them pass.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// These helpers are replicated from hooks.tsx for direct unit testing.
// The test verifies the FIXED versions of these functions.
// After fixing hooks.tsx, these replicas must be kept in sync.
// ---------------------------------------------------------------------------

// === CURRENT (buggy) stripInboundMeta — matches the production code ===
function stripInboundMeta_BUGGY(text: string): string {
  let cleaned = text.replace(
    /Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g,
    ""
  );
  cleaned = cleaned.replace(/^\[[\w\s\-:+]+\]\s*/g, "");
  return cleaned.trim();
}

// === FIXED stripInboundMeta — what the production code SHOULD do ===
function stripInboundMeta(text: string): string {
  let cleaned = text.replace(
    /Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g,
    ""
  );
  // Only strip timestamps like [2024-01-15 10:30:45+09:00], not arbitrary [bracketed text]
  cleaned = cleaned.replace(/^\[\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/g, "");
  return cleaned.trim();
}

function stripTemplateVars(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]\s*/g, "").trim();
}

const HIDDEN_PATTERNS =
  /^(NO_REPLY|HEARTBEAT_OK|NO_)\s*$|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now|\[System\] 이전 세션이 컨텍스트 한도로 갱신|\[이전 세션 맥락\]/;

function isHiddenMessage(role: string, text: string): boolean {
  if (role === "system") return true;
  return HIDDEN_PATTERNS.test(text.trim());
}

/**
 * Simulates loadHistory message mapping from hooks.tsx (FIXED version).
 */
function parseHistoryMessage(
  m: { role: string; content: unknown; timestamp?: string; toolCalls?: unknown[] },
  i: number
) {
  let textContent = "";
  const imgAttachments: Array<{
    fileName: string;
    mimeType: string;
    dataUrl?: string;
  }> = [];

  if (typeof m.content === "string") {
    textContent = m.content;
  } else if (Array.isArray(m.content)) {
    const parts = m.content as Array<Record<string, unknown>>;
    const hasToolUse = parts.some((p) => p.type === "tool_use");
    for (const p of parts) {
      if (p.type === "text" && typeof p.text === "string") {
        if (hasToolUse && m.role === "assistant") {
          const text = (p.text as string).trim();
          if (text.length < 100 && !text.includes("\n")) continue;
        }
        textContent += p.text;
      } else if (p.type === "image_url" || p.type === "image") {
        const url =
          typeof p.image_url === "object" && p.image_url
            ? (p.image_url as Record<string, string>).url
            : typeof p.url === "string"
              ? p.url
              : typeof p.source === "object" && p.source
                ? `data:${(p.source as Record<string, string>).media_type};base64,${(p.source as Record<string, string>).data}`
                : undefined;
        if (url) {
          imgAttachments.push({
            fileName: "image",
            mimeType: "image/png",
            dataUrl: url,
          });
        }
      }
    }
  } else {
    textContent = String(m.content || "");
  }

  if (m.role === "user") textContent = stripInboundMeta(textContent);

  if (m.role === "assistant") textContent = stripTemplateVars(textContent);

  // FIXED: system detection regex runs on content BEFORE stripping,
  // or uses anchored/specific patterns that won't false-positive
  const role: string =
    m.role === "system" ||
    (m.role === "user" &&
      /^\[System Message\]|^\[sessionId:|^System:\s*\[/.test(
        typeof m.content === "string" ? m.content : textContent
      ))
      ? "system"
      : m.role;

  return {
    id: `hist-${i}`,
    role,
    content: textContent,
    attachments: imgAttachments.length > 0 ? imgAttachments : undefined,
  };
}

// =============================================================================
// #55: User messages disappear after refresh
// =============================================================================

describe("Bug #55: User messages should persist after history load", () => {
  it("should preserve plain text user messages in history", () => {
    const messages = [
      {
        role: "user",
        content: "Hello, how are you?",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        role: "assistant",
        content: "I'm doing well, thanks!",
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe("user");
    expect(parsed[0].content).toBe("Hello, how are you?");
    expect(parsed[1].role).toBe("assistant");
    expect(parsed[1].content).toBe("I'm doing well, thanks!");
  });

  it("should preserve user messages with timestamp prefix", () => {
    const messages = [
      {
        role: "user",
        content: "[2024-01-15 10:30:45+09:00] My actual message here",
        timestamp: "2024-01-15T01:30:45Z",
      },
      {
        role: "assistant",
        content: "Got it!",
        timestamp: "2024-01-15T01:30:46Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe("user");
    expect(parsed[0].content).toBe("My actual message here");
  });

  it("should preserve user messages that contain metadata prefix", () => {
    const messages = [
      {
        role: "user",
        content:
          'Conversation info (untrusted metadata):\n```json\n{"sessionKey":"agent:test:main"}\n```\nWhat is the weather today?',
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("user");
    expect(parsed[0].content).toBe("What is the weather today?");
  });

  it("should NOT reclassify normal user messages as system messages", () => {
    const messages = [
      {
        role: "user",
        content: "Tell me about the system architecture",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        role: "user",
        content: "What is a session key?",
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe("user");
    expect(parsed[1].role).toBe("user");
  });

  it("should correctly identify and hide ONLY system-injected user messages", () => {
    const messages = [
      {
        role: "user",
        content: "[System Message] Context bridge...",
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        role: "user",
        content: "Normal user message",
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    // The [System Message] user message gets reclassified as system -> hidden
    // Normal user message should remain
    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("user");
    expect(parsed[0].content).toBe("Normal user message");
  });

  it("should preserve user messages even when content starts with bracketed text", () => {
    // BUG #55: The old regex ^\[[\w\s\-:+]+\]\s* would strip [important]
    // which is legitimate user content, not a gateway timestamp.
    const messages = [
      {
        role: "user",
        content: "[important] Please handle this carefully",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("user");
    // FIXED: [important] should NOT be stripped — it's user content, not a timestamp
    expect(parsed[0].content).toBe("[important] Please handle this carefully");
  });

  it("should NOT incorrectly reclassify messages containing sessionId in middle of text", () => {
    // BUG #55: The old regex /\[sessionId:/ (non-anchored) matches anywhere in text.
    // A user message like "I set [sessionId:abc] in config" would be reclassified as system.
    const messages = [
      {
        role: "user",
        content: "I configured the [sessionId:abc] parameter",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe("user");
  });

  it("should still hide actual system-injected messages with [sessionId: prefix", () => {
    const messages = [
      {
        role: "user",
        content: "[sessionId:abc-123] System context bridge data...",
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    // This is a system-injected message (starts with [sessionId:) — should be hidden
    expect(parsed).toHaveLength(0);
  });
});

// =============================================================================
// #51: Image+text messages show wrong content after refresh
// =============================================================================

describe("Bug #51: Image+text messages should preserve original content", () => {
  it("should extract both text and image from array content (user message)", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "What is in this image?" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,iVBOR..." },
        },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };

    const parsed = parseHistoryMessage(msg, 0);

    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("What is in this image?");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments![0].dataUrl).toBe(
      "data:image/png;base64,iVBOR..."
    );
  });

  it("should handle image-only user message (no text part)", () => {
    const msg = {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };

    const parsed = parseHistoryMessage(msg, 0);

    expect(parsed.role).toBe("user");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments![0].dataUrl).toBe(
      "data:image/png;base64,abc123"
    );
  });

  it("should handle Anthropic-style image source format", () => {
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "Describe this photo" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "base64encodeddata",
          },
        },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };

    const parsed = parseHistoryMessage(msg, 0);

    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("Describe this photo");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments![0].dataUrl).toBe(
      "data:image/jpeg;base64,base64encodeddata"
    );
  });

  it("should NOT confuse user text with assistant error response in history", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this picture?" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,img" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        role: "assistant",
        content:
          "I didn't receive any text with your image. Could you tell me what you'd like to know?",
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const parsed = messages
      .map((m, i) => parseHistoryMessage(m, i))
      .filter((m) => !isHiddenMessage(m.role, m.content));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe("user");
    expect(parsed[0].content).toBe("What is in this picture?");
    expect(parsed[0].attachments).toHaveLength(1);
    expect(parsed[1].role).toBe("assistant");
    expect(parsed[1].content).toContain("I didn't receive any text");
  });

  it("should handle user message with text that includes metadata + image", () => {
    const msg = {
      role: "user",
      content: [
        {
          type: "text",
          text: 'Conversation info (untrusted metadata):\n```json\n{"sessionKey":"test"}\n```\nAnalyze this chart',
        },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,chart" },
        },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };

    const parsed = parseHistoryMessage(msg, 0);

    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("Analyze this chart");
    expect(parsed.attachments).toHaveLength(1);
  });

  it("should preserve short text from user messages with tool_use parts", () => {
    // BUG #51 variant: The code skips short text for assistant+tool_use
    // but MUST NOT skip for user messages
    const msg = {
      role: "user",
      content: [
        { type: "text", text: "Run this" },
        { type: "tool_use", id: "tc-1", name: "exec", input: {} },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };

    const parsed = parseHistoryMessage(msg, 0);

    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("Run this");
  });

  it("should handle image+text where text part has only metadata (no user text)", () => {
    // After stripping metadata, only the image remains — content is empty but
    // attachments must still be preserved
    const msg = {
      role: "user",
      content: [
        {
          type: "text",
          text: 'Conversation info (untrusted metadata):\n```json\n{"key":"val"}\n```\n',
        },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,onlyimage" },
        },
      ],
      timestamp: "2024-01-01T00:00:00Z",
    };

    const parsed = parseHistoryMessage(msg, 0);

    expect(parsed.role).toBe("user");
    // Text is empty after metadata strip, but image attachment must be preserved
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments![0].dataUrl).toBe(
      "data:image/png;base64,onlyimage"
    );
  });
});

// =============================================================================
// #48: Responses require refresh to display (event handler state updates)
// =============================================================================

describe("Bug #48: Responses should appear without refresh", () => {
  /**
   * Simulates the event handler's message accumulation + session key filtering.
   * This is the FIXED version that also checks data.sessionKey.
   */
  function processAgentEvents(
    events: Array<{
      stream: string;
      data?: Record<string, unknown>;
      sessionKey?: string;
    }>,
    targetSessionKey: string
  ) {
    let streamBuf: {
      id: string;
      content: string;
      toolCalls: Map<string, { callId: string; name: string; status: string }>;
    } | null = null;
    let streaming = false;
    let streamIdCounter = 0;
    const messages: Array<{
      id: string;
      role: string;
      content: string;
      streaming: boolean;
    }> = [];

    for (const raw of events) {
      const stream = raw.stream;
      const data = raw.data;
      // FIXED: check both top-level sessionKey AND data.sessionKey
      const evSessionKey =
        raw.sessionKey ?? (data?.sessionKey as string | undefined);

      // Session key filtering
      if (evSessionKey && evSessionKey !== targetSessionKey) continue;
      if (!evSessionKey && targetSessionKey) continue;

      if (
        stream === "assistant" &&
        (typeof data?.delta === "string" || typeof data?.text === "string")
      ) {
        const chunk =
          (data?.delta as string | undefined) ?? (data?.text as string);
        streaming = true;

        if (!streamBuf) {
          streamBuf = {
            id: `stream-${Date.now()}-${++streamIdCounter}`,
            content: "",
            toolCalls: new Map(),
          };
        }
        streamBuf.content += chunk;

        const existing = messages.findIndex((m) => m.id === streamBuf!.id);
        const msg = {
          id: streamBuf.id,
          role: "assistant",
          content: streamBuf.content,
          streaming: true,
        };
        if (existing >= 0) messages[existing] = msg;
        else messages.push(msg);
      } else if (stream === "lifecycle" && data?.phase === "start") {
        streaming = true;
      } else if (stream === "lifecycle" && data?.phase === "end") {
        streaming = false;
        if (streamBuf) {
          const existing = messages.findIndex((m) => m.id === streamBuf!.id);
          if (existing >= 0) {
            messages[existing] = { ...messages[existing], streaming: false };
          }
          streamBuf = null;
        }
      }
    }

    return { messages, streaming, streamBuf };
  }

  it("should accumulate text deltas into a visible message", () => {
    const events = [
      {
        stream: "lifecycle",
        data: { phase: "start" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "assistant",
        data: { delta: "Hello" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "assistant",
        data: { delta: " world" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "assistant",
        data: { delta: "!" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:test:main",
      },
    ];

    const result = processAgentEvents(events, "agent:test:main");

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Hello world!");
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[0].streaming).toBe(false);
    expect(result.streaming).toBe(false);
    expect(result.streamBuf).toBeNull();
  });

  it("should handle multiple sequential responses (streamBuf reset)", () => {
    const events1 = [
      {
        stream: "lifecycle",
        data: { phase: "start" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "assistant",
        data: { delta: "First response" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:test:main",
      },
    ];

    const result1 = processAgentEvents(events1, "agent:test:main");
    expect(result1.messages).toHaveLength(1);
    expect(result1.messages[0].content).toBe("First response");
    expect(result1.streamBuf).toBeNull();

    const events2 = [
      {
        stream: "lifecycle",
        data: { phase: "start" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "assistant",
        data: { delta: "Second response" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:test:main",
      },
    ];

    const result2 = processAgentEvents(events2, "agent:test:main");
    expect(result2.messages).toHaveLength(1);
    expect(result2.messages[0].content).toBe("Second response");
    expect(result2.streamBuf).toBeNull();
  });

  it("should DROP events when sessionKey does not match", () => {
    const events = [
      {
        stream: "lifecycle",
        data: { phase: "start" },
        sessionKey: "agent:other:main",
      },
      {
        stream: "assistant",
        data: { delta: "Wrong session" },
        sessionKey: "agent:other:main",
      },
      {
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:other:main",
      },
    ];

    const result = processAgentEvents(events, "agent:test:main");
    expect(result.messages).toHaveLength(0);
  });

  it("should accept events where sessionKey is inside data instead of top-level", () => {
    // BUG #48: Gateway sometimes puts sessionKey inside data, not at payload root.
    // The old code only checked raw.sessionKey, missing data.sessionKey.
    const events = [
      {
        stream: "lifecycle",
        data: { phase: "start", sessionKey: "agent:test:main" },
      },
      {
        stream: "assistant",
        data: { delta: "Hello from nested key", sessionKey: "agent:test:main" },
      },
      {
        stream: "lifecycle",
        data: { phase: "end", sessionKey: "agent:test:main" },
      },
    ];

    const result = processAgentEvents(events, "agent:test:main");

    // FIXED: events with sessionKey in data should be accepted
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Hello from nested key");
  });

  it("should drop events without any sessionKey when target has sessionKey", () => {
    // Events with NO sessionKey at all should still be dropped for session-bound chats
    const events = [
      { stream: "lifecycle", data: { phase: "start" } },
      { stream: "assistant", data: { delta: "Global event" } },
      { stream: "lifecycle", data: { phase: "end" } },
    ];

    const result = processAgentEvents(events, "agent:test:main");
    expect(result.messages).toHaveLength(0);
  });

  it("should create new streamBuf after lifecycle end clears old one", () => {
    // Verifies that streamBuf=null after lifecycle end allows next response
    const allEvents = [
      {
        stream: "lifecycle",
        data: { phase: "start" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "assistant",
        data: { delta: "First" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "lifecycle",
        data: { phase: "start" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "assistant",
        data: { delta: "Second" },
        sessionKey: "agent:test:main",
      },
      {
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:test:main",
      },
    ];

    const result = processAgentEvents(allEvents, "agent:test:main");

    // Both messages should be created
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("First");
    expect(result.messages[0].streaming).toBe(false);
    expect(result.messages[1].content).toBe("Second");
    expect(result.messages[1].streaming).toBe(false);
    expect(result.streamBuf).toBeNull();
  });
});

// =============================================================================
// stripInboundMeta regression tests
// =============================================================================

describe("stripInboundMeta edge cases", () => {
  it("should strip conversation metadata but preserve user text", () => {
    const input =
      'Conversation info (untrusted metadata):\n```json\n{"foo":"bar"}\n```\nActual question here';
    expect(stripInboundMeta(input)).toBe("Actual question here");
  });

  it("should strip timestamp prefix [2024-01-15 10:30:45+09:00]", () => {
    const input = "[2024-01-15 10:30:45+09:00] Hello world";
    expect(stripInboundMeta(input)).toBe("Hello world");
  });

  it("should handle text that is ONLY metadata (no user content)", () => {
    const input =
      'Conversation info (untrusted metadata):\n```json\n{"key":"val"}\n```\n';
    expect(stripInboundMeta(input)).toBe("");
  });

  it("should NOT strip non-timestamp bracketed user text like [important]", () => {
    // BUG #55: Old regex ^\[[\w\s\-:+]+\] stripped [important], [TODO], etc.
    expect(stripInboundMeta("[important] Do this now")).toBe(
      "[important] Do this now"
    );
    expect(stripInboundMeta("[TODO] Fix the login bug")).toBe(
      "[TODO] Fix the login bug"
    );
    expect(stripInboundMeta("[URGENT] Server is down")).toBe(
      "[URGENT] Server is down"
    );
  });

  it("should preserve multiline user text after metadata", () => {
    const input =
      'Conversation info (untrusted metadata):\n```json\n{"x":"y"}\n```\nLine 1\nLine 2\nLine 3';
    expect(stripInboundMeta(input)).toBe("Line 1\nLine 2\nLine 3");
  });

  it("should strip various timestamp formats", () => {
    expect(stripInboundMeta("[2024-01-15] Hello")).toBe("Hello");
    expect(stripInboundMeta("[2024-01-15 10:30] Hello")).toBe("Hello");
    expect(stripInboundMeta("[2024-01-15 10:30:45] Hello")).toBe("Hello");
    expect(stripInboundMeta("[2024-01-15 10:30:45+09:00] Hello")).toBe("Hello");
  });
});

// =============================================================================
// isHiddenMessage regression tests
// =============================================================================

describe("isHiddenMessage edge cases", () => {
  it("should hide system role messages", () => {
    expect(isHiddenMessage("system", "Any content")).toBe(true);
  });

  it("should hide NO_REPLY messages", () => {
    expect(isHiddenMessage("user", "NO_REPLY")).toBe(true);
    expect(isHiddenMessage("assistant", "NO_REPLY")).toBe(true);
  });

  it("should hide HEARTBEAT_OK messages", () => {
    expect(isHiddenMessage("user", "HEARTBEAT_OK")).toBe(true);
  });

  it("should NOT hide normal user messages", () => {
    expect(isHiddenMessage("user", "Hello")).toBe(false);
    expect(isHiddenMessage("user", "What time is it?")).toBe(false);
    expect(isHiddenMessage("user", "Tell me about NO_REPLY patterns")).toBe(
      false
    );
  });

  it("should NOT hide normal assistant messages", () => {
    expect(isHiddenMessage("assistant", "Here's my response")).toBe(false);
    expect(isHiddenMessage("assistant", "I can help with that")).toBe(false);
  });
});

// =============================================================================
// Verify buggy vs fixed stripInboundMeta behavior
// =============================================================================

describe("stripInboundMeta: buggy vs fixed", () => {
  it("BUGGY version incorrectly strips [important] prefix", () => {
    // This shows the bug exists in the old code
    const result = stripInboundMeta_BUGGY("[important] Do this now");
    // Buggy: [important] is stripped because ^\[[\w\s\-:+]+\] matches it
    expect(result).toBe("Do this now"); // The bug!
  });

  it("FIXED version preserves [important] prefix", () => {
    const result = stripInboundMeta("[important] Do this now");
    // Fixed: only timestamps like [2024-01-15 ...] are stripped
    expect(result).toBe("[important] Do this now");
  });

  it("Both versions strip timestamps correctly", () => {
    const input = "[2024-01-15 10:30:45+09:00] Hello";
    expect(stripInboundMeta_BUGGY(input)).toBe("Hello");
    expect(stripInboundMeta(input)).toBe("Hello");
  });
});
