import { describe, it, expect } from "vitest";
import { generateTopicSummary } from "@/lib/gateway/topic-summary";
import type { StoredMessage } from "@/lib/gateway/message-store";

function msg(role: StoredMessage["role"], content: string, ts?: string): StoredMessage {
  return {
    sessionKey: "agent:alpha:main:topic:test",
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: ts || new Date().toISOString(),
  };
}

describe("generateTopicSummary", () => {
  it("returns empty string for empty messages array", () => {
    expect(generateTopicSummary([])).toBe("");
  });

  it("returns empty string when no user messages exist", () => {
    const messages = [
      msg("assistant", "Hello, how can I help?"),
      msg("system", "Session started"),
    ];
    expect(generateTopicSummary(messages)).toBe("");
  });

  it("extracts summary from a single user message", () => {
    const messages = [
      msg("user", "React hooks 패턴에 대해 알려줘"),
      msg("assistant", "React hooks는..."),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toBe("React hooks 패턴에 대해 알려줘");
  });

  it("joins multiple user messages with separator", () => {
    const messages = [
      msg("user", "첫 번째 질문"),
      msg("assistant", "답변 1"),
      msg("user", "두 번째 질문"),
      msg("assistant", "답변 2"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toBe("첫 번째 질문 · 두 번째 질문");
  });

  it("only takes last 5 user messages", () => {
    const messages = [
      msg("user", "질문 1"),
      msg("user", "질문 2"),
      msg("user", "질문 3"),
      msg("user", "질문 4"),
      msg("user", "질문 5"),
      msg("user", "질문 6"),
      msg("user", "질문 7"),
    ];
    const summary = generateTopicSummary(messages);
    // Should only include last 5
    expect(summary).not.toContain("질문 1");
    expect(summary).not.toContain("질문 2");
    expect(summary).toContain("질문 3");
    expect(summary).toContain("질문 7");
  });

  it("truncates to max summary length", () => {
    const messages = [
      msg("user", "이것은 매우 긴 첫 번째 질문입니다 정말로 길게 작성합니다"),
      msg("user", "이것은 매우 긴 두 번째 질문입니다 정말로 길게 작성합니다"),
      msg("user", "이것은 매우 긴 세 번째 질문입니다 정말로 길게 작성합니다"),
      msg("user", "이것은 매우 긴 네 번째 질문입니다 정말로 길게 작성합니다"),
      msg("user", "이것은 매우 긴 다섯 번째 질문입니다 정말로 길게 작성합니다"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary).toMatch(/…$/);
  });

  it("strips slash commands from user messages", () => {
    const messages = [
      msg("user", "/status"),
      msg("user", "/model gpt-4o\n실제 질문입니다"),
      msg("user", "일반 메시지"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).not.toContain("/status");
    expect(summary).not.toContain("/model");
    expect(summary).toContain("실제 질문입니다");
    expect(summary).toContain("일반 메시지");
  });

  it("strips MEDIA: lines from user messages", () => {
    const messages = [
      msg("user", "이미지 첨부합니다\nMEDIA:/tmp/image.png"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toBe("이미지 첨부합니다");
    expect(summary).not.toContain("MEDIA:");
  });

  it("strips file attachment hints", () => {
    const messages = [
      msg("user", "📎 [PDF: doc.pdf] /tmp/doc.pdf\n이 문서 분석해줘"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toContain("이 문서 분석해줘");
    expect(summary).not.toContain("📎");
  });

  it("takes first sentence when multiple sentences exist", () => {
    const messages = [
      msg("user", "첫 번째 문장입니다. 두 번째 문장입니다. 세 번째도 있습니다."),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toBe("첫 번째 문장입니다.");
  });

  it("returns empty string when all user messages are slash commands only", () => {
    const messages = [
      msg("user", "/status"),
      msg("user", "/clear"),
      msg("user", "/help"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toBe("");
  });

  it("handles messages with only whitespace content", () => {
    const messages = [
      msg("user", "   "),
      msg("user", "\n\n"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toBe("");
  });

  it("interleaves user and assistant messages correctly", () => {
    const messages = [
      msg("user", "질문 A"),
      msg("assistant", "답변 A"),
      msg("user", "질문 B"),
      msg("assistant", "답변 B"),
      msg("user", "질문 C"),
    ];
    const summary = generateTopicSummary(messages);
    expect(summary).toBe("질문 A · 질문 B · 질문 C");
  });
});
