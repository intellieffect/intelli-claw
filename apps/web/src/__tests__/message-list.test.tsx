/**
 * message-list.test.tsx — Comprehensive tests for message-list.tsx.
 *
 * Covers: utility functions, React.memo comparator, MessageList component states,
 * displayMessages filtering, MessageBubble rendering, SessionBoundary, ThinkingIndicator,
 * and virtual pagination.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  getExt,
  getFileAccent,
  messageBubbleAreEqual,
  MessageList,
} from "@/components/chat/message-list";
import type { DisplayMessage, AgentStatus } from "@/lib/gateway/hooks";
import {
  makeDisplayMessage,
  makeUserMessage,
  makeAssistantMessage,
  makeBoundaryMessage,
  makeStreamingMessage,
  resetFixtureCounter,
} from "./helpers/fixtures";

// Mock heavy child components
vi.mock("@/components/chat/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
  MarkdownFilePreview: ({ src, fileName }: { src: string; fileName: string }) => <div data-testid="md-preview">{fileName}</div>,
}));

vi.mock("@/components/chat/tool-call-card", () => ({
  ToolCallCard: ({ toolCall }: { toolCall: { name: string } }) => <div data-testid="tool-card">{toolCall.name}</div>,
}));

vi.mock("@/components/ui/agent-avatar", () => ({
  AgentAvatar: ({ agentId, size }: { agentId?: string; size: number }) => (
    <div data-testid="agent-avatar" data-agent-id={agentId} data-size={size}>Avatar</div>
  ),
}));

vi.mock("@/lib/utils/download", () => ({
  blobDownload: vi.fn(),
  forceDownloadUrl: vi.fn((url: string) => url),
}));

vi.mock("@/lib/utils/format-time", () => ({
  formatTime: (ts: string) => {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  },
}));

// Mock IntersectionObserver for jsdom
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) { this.callback = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

beforeEach(() => {
  resetFixtureCounter();
});

// ===================================================================
// 7-1. Utility functions
// ===================================================================

describe("getExt", () => {
  it("extracts simple extension", () => {
    expect(getExt("file.pdf")).toBe("pdf");
  });

  it("returns empty string for no extension", () => {
    expect(getExt("README")).toBe("");
  });

  it("extracts last extension from multiple dots", () => {
    expect(getExt("archive.tar.gz")).toBe("gz");
  });

  it("lowercases the extension", () => {
    expect(getExt("photo.PNG")).toBe("png");
  });
});


describe("getFileAccent", () => {
  it("returns red accent for PDF", () => {
    const result = getFileAccent("application/pdf", "pdf");
    expect(result).toContain("red");
  });

  it("returns blue accent for images", () => {
    const result = getFileAccent("image/png", "png");
    expect(result).toContain("blue");
  });

  it("returns cyan accent for code files", () => {
    const result = getFileAccent("text/plain", "ts");
    expect(result).toContain("cyan");
  });

  it("returns default accent for unknown types", () => {
    const result = getFileAccent("application/octet-stream", "dat");
    expect(result).toContain("zinc");
  });
});

// ===================================================================
// 7-2. React.memo comparator
// ===================================================================

describe("messageBubbleAreEqual", () => {
  const baseMsg: DisplayMessage = {
    id: "1", role: "assistant", content: "Hello", timestamp: "2026-01-01T00:00:00Z",
    toolCalls: [], streaming: false,
  };

  const baseProps = {
    message: baseMsg,
    showAvatar: true,
    agentId: "agent-1",
    agentStatus: { phase: "idle" as const },
    focused: false,
    selected: false,
  };

  it("returns true for identical props (different references)", () => {
    const prev = { ...baseProps };
    const next = { ...baseProps, message: { ...baseMsg } };
    expect(messageBubbleAreEqual(prev, next)).toBe(true);
  });

  it("returns false when content changes", () => {
    const next = { ...baseProps, message: { ...baseMsg, content: "Changed" } };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("returns false when streaming changes", () => {
    const next = { ...baseProps, message: { ...baseMsg, streaming: true } };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("returns false when toolCalls length changes", () => {
    const next = {
      ...baseProps,
      message: {
        ...baseMsg,
        toolCalls: [{ callId: "tc-1", name: "search", status: "running" as const }],
      },
    };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("returns false when attachments length changes", () => {
    const next = {
      ...baseProps,
      message: {
        ...baseMsg,
        attachments: [{ fileName: "test.png", mimeType: "image/png" }],
      },
    };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("returns false when focused changes", () => {
    const next = { ...baseProps, focused: true };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("returns false when selected changes", () => {
    const next = { ...baseProps, selected: true };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("returns false when agentId changes", () => {
    const next = { ...baseProps, agentId: "agent-2" };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("returns false when agentStatus phase changes", () => {
    const next = { ...baseProps, agentStatus: { phase: "thinking" as const } };
    expect(messageBubbleAreEqual(baseProps, next)).toBe(false);
  });

  it("handles undefined agentStatus gracefully", () => {
    const prev = { ...baseProps, agentStatus: undefined };
    const next = { ...baseProps, agentStatus: undefined };
    expect(messageBubbleAreEqual(prev, next)).toBe(true);
  });
});

// ===================================================================
// 7-3. MessageList component states
// ===================================================================

describe("MessageList — loading state", () => {
  it("shows loading text when loading=true", () => {
    render(<MessageList messages={[]} loading={true} streaming={false} />);
    expect(screen.getByText("대화 기록 불러오는 중...")).toBeInTheDocument();
  });

  it("does not show messages when loading=true even with messages", () => {
    const messages = [makeUserMessage("Should not be visible")];
    render(<MessageList messages={messages} loading={true} streaming={false} />);
    expect(screen.getByText("대화 기록 불러오는 중...")).toBeInTheDocument();
    expect(screen.queryByText("Should not be visible")).not.toBeInTheDocument();
  });
});

describe("MessageList — empty state", () => {
  it("shows empty state with AgentAvatar and prompt", () => {
    render(<MessageList messages={[]} loading={false} streaming={false} agentId="test-agent" />);
    expect(screen.getByText("무엇을 도와드릴까요?")).toBeInTheDocument();
    expect(screen.getByText("메시지를 입력하여 대화를 시작하세요")).toBeInTheDocument();
    expect(screen.getByTestId("agent-avatar")).toBeInTheDocument();
  });
});

describe("MessageList — with messages", () => {
  it("renders messages when loading=false and messages exist", () => {
    const messages = [
      makeUserMessage("User question"),
      makeAssistantMessage("Assistant answer"),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("User question")).toBeInTheDocument();
    expect(screen.getByText("Assistant answer")).toBeInTheDocument();
  });

  it("does not show empty state when messages exist", () => {
    const messages = [makeUserMessage("Hello")];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.queryByText("무엇을 도와드릴까요?")).not.toBeInTheDocument();
  });
});

// ===================================================================
// 7-4. displayMessages filtering
// ===================================================================

describe("MessageList — display filtering", () => {
  it("hides HIDDEN_REPLY_RE matching messages", () => {
    const messages = [
      makeUserMessage("Visible question"),
      makeAssistantMessage("NO_REPLY"),
      makeAssistantMessage("Visible answer"),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("Visible question")).toBeInTheDocument();
    expect(screen.getByText("Visible answer")).toBeInTheDocument();
    expect(screen.queryByText("NO_REPLY")).not.toBeInTheDocument();
  });

  it("shows messages with empty content but toolCalls", () => {
    const messages = [
      makeAssistantMessage("", {
        toolCalls: [{ callId: "tc-1", name: "web_search", status: "done" as const }],
      }),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    // The tool call card should be rendered
    expect(screen.getByTestId("tool-card")).toBeInTheDocument();
  });

  it("shows streaming messages with empty content", () => {
    const messages = [makeStreamingMessage("")];
    render(<MessageList messages={messages} loading={false} streaming={true} />);
    // The streaming cursor should be visible
    const cursors = document.querySelectorAll(".animate-pulse");
    expect(cursors.length).toBeGreaterThan(0);
  });

  it("shows messages with empty content but attachments", () => {
    const messages = [
      makeAssistantMessage("", {
        attachments: [{ fileName: "photo.png", mimeType: "image/png", dataUrl: "data:..." }],
      }),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    // The message should be rendered (has attachments)
    const images = document.querySelectorAll("img");
    expect(images.length).toBeGreaterThan(0);
  });

  it("renders session-boundary as SessionBoundary component", () => {
    const messages = [
      makeUserMessage("Before"),
      makeBoundaryMessage(),
      makeAssistantMessage("After"),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    // #156: reason이 없으면 'unknown' → "세션 갱신됨"
    expect(screen.getByText("세션 갱신됨")).toBeInTheDocument();
  });

  it("hides HEARTBEAT_OK messages", () => {
    const messages = [
      makeAssistantMessage("HEARTBEAT_OK"),
      makeAssistantMessage("Visible"),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.queryByText("HEARTBEAT_OK")).not.toBeInTheDocument();
    expect(screen.getByText("Visible")).toBeInTheDocument();
  });

  it("hides 이전 세션 맥락 messages", () => {
    const messages = [
      makeAssistantMessage("[이전 세션 맥락] 이전 세션이 ..."),
      makeAssistantMessage("Normal message"),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.queryByText(/이전 세션 맥락/)).not.toBeInTheDocument();
    expect(screen.getByText("Normal message")).toBeInTheDocument();
  });

  it("hides Pre-compaction memory flush messages", () => {
    const messages = [
      makeAssistantMessage("Pre-compaction memory flush now"),
      makeAssistantMessage("Visible reply"),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.queryByText(/Pre-compaction/)).not.toBeInTheDocument();
  });
});

// ===================================================================
// 7-5. MessageBubble rendering
// ===================================================================

describe("MessageBubble — user messages", () => {
  it("renders user message text", () => {
    const messages = [makeUserMessage("My question")];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("My question")).toBeInTheDocument();
  });

  it("shows queued indicator for queued messages", () => {
    const messages = [makeUserMessage("Waiting", { queued: true })];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("대기 중")).toBeInTheDocument();
  });

  it("shows cancel button for queued messages with onCancelQueued", () => {
    const onCancel = vi.fn();
    const messages = [makeUserMessage("Waiting", { queued: true })];
    render(<MessageList messages={messages} loading={false} streaming={false} onCancelQueued={onCancel} />);
    expect(screen.getByText("취소")).toBeInTheDocument();
  });

  it("renders user image attachments", () => {
    const messages = [
      makeUserMessage("See image", {
        attachments: [{
          fileName: "photo.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,test",
        }],
      }),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    const img = document.querySelector("img[alt='photo.png']");
    expect(img).toBeTruthy();
  });
});

describe("MessageBubble — assistant messages", () => {
  it("renders assistant message via MarkdownRenderer", () => {
    const messages = [makeAssistantMessage("**Bold** answer")];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByTestId("markdown")).toBeInTheDocument();
    expect(screen.getByTestId("markdown").textContent).toContain("**Bold** answer");
  });

  it("shows streaming cursor when streaming", () => {
    const messages = [makeStreamingMessage("In progress...")];
    render(<MessageList messages={messages} loading={false} streaming={true} />);
    // Streaming cursor is a span with animate-pulse
    const cursor = document.querySelector("span.animate-pulse");
    expect(cursor).toBeTruthy();
  });

  it("shows avatar for first assistant message", () => {
    const messages = [makeAssistantMessage("Hello")];
    render(<MessageList messages={messages} loading={false} streaming={false} agentId="test" />);
    expect(screen.getByTestId("agent-avatar")).toBeInTheDocument();
  });

  it("renders tool call cards", () => {
    const messages = [
      makeAssistantMessage("Using a tool", {
        toolCalls: [
          { callId: "tc-1", name: "web_search", args: '{"q":"test"}', status: "done" as const },
          { callId: "tc-2", name: "file_read", args: '{"path":"/"}', status: "running" as const },
        ],
      }),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    const toolCards = screen.getAllByTestId("tool-card");
    expect(toolCards).toHaveLength(2);
    expect(toolCards[0].textContent).toBe("web_search");
    expect(toolCards[1].textContent).toBe("file_read");
  });

  it("renders reply quote block", () => {
    const messages = [
      makeAssistantMessage("Response to your question", {
        replyTo: { id: "ref-1", content: "Original question text", role: "user" },
      }),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("나")).toBeInTheDocument(); // role label for user
    expect(screen.getByText("Original question text")).toBeInTheDocument();
  });

  it("renders assistant image attachments", () => {
    const messages = [
      makeAssistantMessage("Here's the image", {
        attachments: [{
          fileName: "result.png",
          mimeType: "image/png",
          dataUrl: "https://example.com/img.png",
          downloadUrl: "https://example.com/img.png",
        }],
      }),
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    const img = document.querySelector("img[alt='result.png']");
    expect(img).toBeTruthy();
  });
});

describe("MessageBubble — system messages", () => {
  it("renders system message with centered muted style", () => {
    const messages = [makeDisplayMessage({ role: "system", content: "System notice" })];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("System notice")).toBeInTheDocument();
  });
});

// ===================================================================
// 7-6. SessionBoundary, ThinkingIndicator, Pagination
// ===================================================================

describe("SessionBoundary", () => {
  it("renders with correct text (unknown reason → fallback)", () => {
    const messages = [makeBoundaryMessage()];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("세션 갱신됨")).toBeInTheDocument();
  });

  it("renders context_overflow reason (#156)", () => {
    const messages = [makeBoundaryMessage({ resetReason: "context_overflow" })];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("세션 갱신됨 (컨텍스트 한도 도달)")).toBeInTheDocument();
  });

  it("renders daily reason (#156)", () => {
    const messages = [makeBoundaryMessage({ resetReason: "daily" })];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("새로운 하루, 새 세션이 시작되었습니다")).toBeInTheDocument();
  });

  it("renders idle reason (#156)", () => {
    const messages = [makeBoundaryMessage({ resetReason: "idle" })];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("장시간 미활동으로 세션이 초기화되었습니다")).toBeInTheDocument();
  });

  it("renders manual reason (#156)", () => {
    const messages = [makeBoundaryMessage({ resetReason: "manual" })];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("새 세션이 시작되었습니다")).toBeInTheDocument();
  });

  it("shows 이전 맥락 불러오기 button when onLoadPreviousContext is provided", () => {
    const onLoad = vi.fn();
    const messages = [makeBoundaryMessage()];
    render(
      <MessageList messages={messages} loading={false} streaming={false} onLoadPreviousContext={onLoad} />,
    );
    expect(screen.getByText("이전 맥락 불러오기")).toBeInTheDocument();
  });

  it("shows 이전 대화 보기 button when onOpenTopicHistory is provided", () => {
    const onOpen = vi.fn();
    const messages = [makeBoundaryMessage()];
    render(
      <MessageList messages={messages} loading={false} streaming={false} onOpenTopicHistory={onOpen} />,
    );
    expect(screen.getByText("이전 대화 보기")).toBeInTheDocument();
  });

  it("calls onLoadPreviousContext when button is clicked", () => {
    const onLoad = vi.fn();
    const messages = [makeBoundaryMessage()];
    render(
      <MessageList messages={messages} loading={false} streaming={false} onLoadPreviousContext={onLoad} />,
    );
    fireEvent.click(screen.getByText("이전 맥락 불러오기"));
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("calls onOpenTopicHistory when button is clicked", () => {
    const onOpen = vi.fn();
    const messages = [makeBoundaryMessage()];
    render(
      <MessageList messages={messages} loading={false} streaming={false} onOpenTopicHistory={onOpen} />,
    );
    fireEvent.click(screen.getByText("이전 대화 보기"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("ThinkingIndicator", () => {
  it("shows when streaming=true but no streaming message exists", () => {
    // When streaming is true but no message has streaming flag,
    // ThinkingIndicator is rendered.
    const messages = [makeUserMessage("Question")];
    render(
      <MessageList
        messages={messages}
        loading={false}
        streaming={true}
        agentId="test"
      />,
    );
    // ThinkingIndicator has bounce dots
    const bounceDots = document.querySelectorAll(".animate-bounce");
    expect(bounceDots.length).toBe(3);
  });

  it("does not show when a streaming message exists", () => {
    const messages = [
      makeUserMessage("Question"),
      makeStreamingMessage("Answering..."),
    ];
    render(
      <MessageList
        messages={messages}
        loading={false}
        streaming={true}
      />,
    );
    // With a streaming message, ThinkingIndicator is hidden
    // But the streaming cursor is shown inside the message bubble
    const bounceDots = document.querySelectorAll(".animate-bounce");
    expect(bounceDots.length).toBe(0);
  });
});

describe("Virtual pagination", () => {
  it("shows loading sentinel when more messages than page size", () => {
    // PAGE_SIZE is 50 in the component
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeUserMessage(`Message ${i}`, {
        id: `msg-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }),
    );

    render(<MessageList messages={messages} loading={false} streaming={false} />);
    const sentinel = screen.queryByText(/이전 메시지 불러오는 중/);
    expect(sentinel).toBeTruthy();
  });

  it("does not show load more when messages fit in one page", () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeUserMessage(`Message ${i}`, {
        id: `msg-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }),
    );

    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.queryByText(/이전 메시지 불러오는 중/)).not.toBeInTheDocument();
  });

  it("shows sentinel with spinner when more messages exist", () => {
    const messages = Array.from({ length: 60 }, (_, i) =>
      makeUserMessage(`Message ${i}`, {
        id: `msg-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }),
    );

    render(<MessageList messages={messages} loading={false} streaming={false} />);
    const sentinel = screen.getByText(/이전 메시지 불러오는 중/);
    expect(sentinel).toBeTruthy();
  });

  it("hides sentinel after all messages are visible", () => {
    // Exactly PAGE_SIZE (50) messages — no pagination needed
    const messages = Array.from({ length: 50 }, (_, i) =>
      makeUserMessage(`Msg ${i}`, {
        id: `msg-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }),
    );

    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.queryByText(/이전 메시지 불러오는 중/)).not.toBeInTheDocument();
  });
});

// ===================================================================
// 7-extra: agentStatus indicator on streaming avatar
// ===================================================================

describe("MessageBubble — agentStatus indicator", () => {
  it("shows green dot for writing phase", () => {
    const messages = [
      makeStreamingMessage("Writing response...", { id: "stream-1" }),
    ];
    const agentStatus: AgentStatus = { phase: "writing" };
    render(
      <MessageList
        messages={messages}
        loading={false}
        streaming={true}
        agentStatus={agentStatus}
      />,
    );
    const greenDot = document.querySelector(".bg-green-400");
    expect(greenDot).toBeTruthy();
  });

  it("shows yellow dot for thinking phase", () => {
    const messages = [
      makeStreamingMessage("", { id: "stream-1" }),
    ];
    const agentStatus: AgentStatus = { phase: "thinking" };
    render(
      <MessageList
        messages={messages}
        loading={false}
        streaming={true}
        agentStatus={agentStatus}
      />,
    );
    const yellowDot = document.querySelector(".bg-yellow-400");
    expect(yellowDot).toBeTruthy();
  });

  it("shows blue dot for tool phase", () => {
    const messages = [
      makeStreamingMessage("", {
        id: "stream-1",
        toolCalls: [{ callId: "tc-1", name: "search", status: "running" as const }],
      }),
    ];
    const agentStatus: AgentStatus = { phase: "tool", toolName: "search" };
    render(
      <MessageList
        messages={messages}
        loading={false}
        streaming={true}
        agentStatus={agentStatus}
      />,
    );
    const blueDot = document.querySelector(".bg-blue-400");
    expect(blueDot).toBeTruthy();
  });

  it("does not show status dot when idle", () => {
    const messages = [makeAssistantMessage("Final answer")];
    const agentStatus: AgentStatus = { phase: "idle" };
    render(
      <MessageList
        messages={messages}
        loading={false}
        streaming={false}
        agentStatus={agentStatus}
      />,
    );
    const dots = document.querySelectorAll(".bg-green-400, .bg-yellow-400, .bg-blue-400");
    expect(dots.length).toBe(0);
  });
});
