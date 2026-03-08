import { describe, it, expect } from "vitest";
import { stripInboundMeta } from "@/lib/gateway/hooks";

describe("stripInboundMeta", () => {
  it("strips Sender (untrusted metadata) JSON block and preserves message after it", () => {
    const input = `Sender (untrusted metadata):\n\`\`\`json\n{"name": "user1", "role": "admin"}\n\`\`\`\nHello, how are you?`;
    expect(stripInboundMeta(input)).toBe("Hello, how are you?");
  });

  it("strips OpenClaw runtime context (internal) and everything after, preserves message before", () => {
    const input = `What is the weather today?\nOpenClaw runtime context (internal):\nSome internal data\nMore internal stuff`;
    expect(stripInboundMeta(input)).toBe("What is the weather today?");
  });

  it("strips day-prefixed timestamp like [Sun 2026-03-08 10:45 GMT+9]", () => {
    const input = "[Sun 2026-03-08 10:45 GMT+9] Hello world";
    expect(stripInboundMeta(input)).toBe("Hello world");
  });

  it("preserves plain user message content untouched", () => {
    const input = "Just a normal message with no metadata";
    expect(stripInboundMeta(input)).toBe("Just a normal message with no metadata");
  });

  it("returns empty string when message is entirely runtime context", () => {
    const input = "OpenClaw runtime context (internal):\nAll of this is internal context";
    expect(stripInboundMeta(input)).toBe("");
  });

  it("still strips Conversation info (untrusted metadata) pattern (regression)", () => {
    const input = `Conversation info (untrusted metadata):\n\`\`\`json\n{"session": "abc123"}\n\`\`\`\nActual message here`;
    expect(stripInboundMeta(input)).toBe("Actual message here");
  });
});
