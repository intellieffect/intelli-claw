import { describe, it, expect } from "vitest";

// Test the event mapping logic extracted from hooks
// Since hooks are tightly coupled to React, we test the pure logic

/**
 * Simulates how hooks.tsx maps gateway agent events to display state.
 * This mirrors the if/else chain in useChat's onEvent handler.
 */
function mapAgentEvent(raw: Record<string, unknown>) {
  const stream = raw.stream as string | undefined;
  const data = raw.data as Record<string, unknown> | undefined;

  if (stream === "assistant" && data?.delta) {
    return { type: "text-delta", delta: data.delta as string };
  } else if (stream === "tool-start" && data) {
    return {
      type: "tool-call-start",
      callId: (data.toolCallId || data.callId || "") as string,
      name: (data.name || data.tool || "") as string,
      args: data.args as string | undefined,
    };
  } else if (stream === "tool-end" && data) {
    return {
      type: "tool-call-end",
      callId: (data.toolCallId || data.callId || "") as string,
      result: data.result as string | undefined,
    };
  } else if (stream === "lifecycle" && data?.phase === "end") {
    return { type: "done", source: "lifecycle" };
  } else if (stream === "error") {
    return {
      type: "error",
      message: (data?.message || data?.error || "Unknown error") as string,
    };
  }
  return { type: "unknown", stream };
}

/**
 * Simulates how hooks.tsx parses chat.history message content.
 */
function parseMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join("");
  }
  return String(content || "");
}

describe("agent event mapping", () => {
  it("maps text-delta from assistant stream", () => {
    const result = mapAgentEvent({
      stream: "assistant",
      data: { text: "Hello world", delta: " world" },
      sessionKey: "agent:alpha:main",
    });
    expect(result).toEqual({ type: "text-delta", delta: " world" });
  });

  it("maps tool-call-start", () => {
    const result = mapAgentEvent({
      stream: "tool-start",
      data: {
        toolCallId: "tc-123",
        name: "web_search",
        args: '{"query":"test"}',
      },
    });
    expect(result).toEqual({
      type: "tool-call-start",
      callId: "tc-123",
      name: "web_search",
      args: '{"query":"test"}',
    });
  });

  it("maps tool-call-start with alternative field names", () => {
    const result = mapAgentEvent({
      stream: "tool-start",
      data: { callId: "tc-456", tool: "exec" },
    });
    expect(result).toEqual({
      type: "tool-call-start",
      callId: "tc-456",
      name: "exec",
      args: undefined,
    });
  });

  it("maps tool-call-end", () => {
    const result = mapAgentEvent({
      stream: "tool-end",
      data: { toolCallId: "tc-123", result: "search results here" },
    });
    expect(result).toEqual({
      type: "tool-call-end",
      callId: "tc-123",
      result: "search results here",
    });
  });

  it("maps lifecycle end as done", () => {
    const result = mapAgentEvent({
      stream: "lifecycle",
      data: { phase: "end", endedAt: 1234567890 },
    });
    expect(result).toEqual({ type: "done", source: "lifecycle" });
  });

  it("maps error stream", () => {
    const result = mapAgentEvent({
      stream: "error",
      data: { message: "rate limit exceeded" },
    });
    expect(result).toEqual({ type: "error", message: "rate limit exceeded" });
  });

  it("maps error with alternative field name", () => {
    const result = mapAgentEvent({
      stream: "error",
      data: { error: "timeout" },
    });
    expect(result).toEqual({ type: "error", message: "timeout" });
  });

  it("returns unknown for unrecognized streams", () => {
    const result = mapAgentEvent({
      stream: "thinking",
      data: { text: "hmm" },
    });
    expect(result).toEqual({ type: "unknown", stream: "thinking" });
  });

  it("handles missing data gracefully", () => {
    const result = mapAgentEvent({ stream: "assistant" });
    expect(result).toEqual({ type: "unknown", stream: "assistant" });
  });

  it("ignores lifecycle events that are not end", () => {
    const result = mapAgentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
    });
    expect(result).toEqual({ type: "unknown", stream: "lifecycle" });
  });
});

describe("chat.history content parsing", () => {
  it("handles plain string content", () => {
    expect(parseMessageContent("Hello world")).toBe("Hello world");
  });

  it("handles array content with text blocks", () => {
    const content = [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ];
    expect(parseMessageContent(content)).toBe("Hello world");
  });

  it("filters non-text blocks from array content", () => {
    const content = [
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "tc-1", name: "read" },
      { type: "text", text: " world" },
    ];
    expect(parseMessageContent(content)).toBe("Hello world");
  });

  it("handles empty array", () => {
    expect(parseMessageContent([])).toBe("");
  });

  it("handles null/undefined content", () => {
    expect(parseMessageContent(null)).toBe("");
    expect(parseMessageContent(undefined)).toBe("");
  });

  it("handles number content", () => {
    expect(parseMessageContent(42)).toBe("42");
  });

  it("handles array with missing text field", () => {
    const content = [{ type: "text" }];
    expect(parseMessageContent(content)).toBe("");
  });
});
