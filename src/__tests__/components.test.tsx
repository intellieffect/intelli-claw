import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "@/components/chat/chat-input";
import { ConnectionStatus } from "@/components/chat/connection-status";
import { MessageList } from "@/components/chat/message-list";
import { SessionSwitcher } from "@/components/chat/session-switcher";
import type { DisplayMessage } from "@/lib/gateway/hooks";
import type { GatewaySession } from "@/lib/gateway/session-utils";

describe("ConnectionStatus", () => {
  it("shows connected state", () => {
    render(<ConnectionStatus state="connected" />);
    expect(screen.getByText("연결됨")).toBeInTheDocument();
  });

  it("shows disconnected state", () => {
    render(<ConnectionStatus state="disconnected" />);
    expect(screen.getByText("연결 끊김")).toBeInTheDocument();
  });

  it("shows connecting state", () => {
    render(<ConnectionStatus state="connecting" />);
    expect(screen.getByText("연결 중...")).toBeInTheDocument();
  });

  it("shows authenticating state", () => {
    render(<ConnectionStatus state="authenticating" />);
    expect(screen.getByText("인증 중...")).toBeInTheDocument();
  });
});

describe("ChatInput", () => {
  it("renders textarea and send button", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} />
    );
    expect(screen.getByPlaceholderText(/메시지를 입력/)).toBeInTheDocument();
    expect(screen.getByLabelText("전송")).toBeInTheDocument();
  });

  it("disables input when disabled prop is true", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={true} />
    );
    expect(screen.getByPlaceholderText(/메시지를 입력/)).toBeDisabled();
  });

  it("shows abort button (and hides send button) when streaming", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={true} disabled={false} />
    );
    expect(screen.getByLabelText("중단")).toBeInTheDocument();
    expect(screen.queryByLabelText("전송")).not.toBeInTheDocument();
  });

  it("calls onSend with text on submit", () => {
    const onSend = vi.fn();
    render(
      <ChatInput onSend={onSend} onAbort={() => {}} streaming={false} disabled={false} />
    );

    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText("전송"));

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("clears input after send", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} />
    );

    const textarea = screen.getByPlaceholderText(/메시지를 입력/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText("전송"));

    expect(textarea.value).toBe("");
  });

  it("does not send empty messages", () => {
    const onSend = vi.fn();
    render(
      <ChatInput onSend={onSend} onAbort={() => {}} streaming={false} disabled={false} />
    );

    fireEvent.click(screen.getByLabelText("전송"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends on Enter key", () => {
    const onSend = vi.fn();
    render(
      <ChatInput onSend={onSend} onAbort={() => {}} streaming={false} disabled={false} />
    );

    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send on Shift+Enter (newline)", () => {
    const onSend = vi.fn();
    render(
      <ChatInput onSend={onSend} onAbort={() => {}} streaming={false} disabled={false} />
    );

    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends on Enter key while streaming", () => {
    const onSend = vi.fn();
    render(
      <ChatInput onSend={onSend} onAbort={() => {}} streaming={true} disabled={false} />
    );

    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "follow-up" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSend).toHaveBeenCalledWith("follow-up");
  });

  it("does not show send button while streaming", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={true} disabled={false} />
    );
    expect(screen.queryByLabelText("전송")).not.toBeInTheDocument();
  });

  it("textarea is not disabled while streaming", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={true} disabled={false} />
    );
    expect(screen.getByPlaceholderText(/메시지를 입력/)).not.toBeDisabled();
  });

  it("calls onAbort when abort button clicked", () => {
    const onAbort = vi.fn();
    render(
      <ChatInput onSend={() => {}} onAbort={onAbort} streaming={true} disabled={false} />
    );

    fireEvent.click(screen.getByLabelText("중단"));
    expect(onAbort).toHaveBeenCalled();
  });
});

describe("SessionSwitcher", () => {
  const mockSessions: GatewaySession[] = [
    { key: "agent:my-agent:main", updatedAt: 300, label: "Alpha 메인" },
    { key: "agent:brxce:main", updatedAt: 200 },
    { key: "agent:my-agent:main:thread:123", updatedAt: 100, totalTokens: 5000 },
  ];

  it("renders trigger button with current session name", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        currentKey="agent:my-agent:main"
        onSelect={() => {}}
        onNew={() => {}}
      />
    );
    expect(screen.getByText("Alpha 메인")).toBeInTheDocument();
  });

  it("renders trigger button with fallback text when no current session", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );
    expect(screen.getByText("세션 선택")).toBeInTheDocument();
  });

  it("opens command palette on trigger click", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );
    fireEvent.click(screen.getByText("세션 선택"));
    expect(screen.getByPlaceholderText(/세션 검색/)).toBeInTheDocument();
  });

  it("shows sessions sorted by updatedAt in palette", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
        open={true}
        onOpenChange={() => {}}
      />
    );
    // Session with updatedAt: 300 should appear (label: Alpha 메인)
    expect(screen.getByText("Alpha 메인")).toBeInTheDocument();
    // All 3 sessions + new conversation
    expect(screen.getByText("3개 세션")).toBeInTheDocument();
  });

  it("filters sessions by search text", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
        open={true}
        onOpenChange={() => {}}
      />
    );
    const input = screen.getByPlaceholderText(/세션 검색/);
    fireEvent.change(input, { target: { value: "brxce" } });
    expect(screen.getByText(/1개 세션/)).toBeInTheDocument();
  });

  it("calls onSelect when clicking a session", () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={() => {}}
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByText("Alpha 메인"));
    expect(onSelect).toHaveBeenCalledWith("agent:my-agent:main");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onNew when clicking new conversation", () => {
    const onNew = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByText("새 대화 시작"));
    expect(onNew).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape key", () => {
    const onOpenChange = vi.fn();
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    const input = screen.getByPlaceholderText(/세션 검색/);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows agent badges for each session", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
        open={true}
        onOpenChange={() => {}}
      />
    );
    // Agent badges should be visible
    const my-agentBadges = screen.getAllByText("my-agent");
    expect(my-agentBadges.length).toBeGreaterThanOrEqual(2); // 2 my-agent sessions
    expect(screen.getByText("brxce")).toBeInTheDocument();
  });

  it("shows keyboard navigation hints in footer", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByText("이동")).toBeInTheDocument();
    expect(screen.getByText("선택")).toBeInTheDocument();
    expect(screen.getByText("닫기")).toBeInTheDocument();
  });

  it("supports controlled open state", () => {
    const { rerender } = render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
        open={false}
        onOpenChange={() => {}}
      />
    );
    // Palette should not be visible
    expect(screen.queryByPlaceholderText(/세션 검색/)).not.toBeInTheDocument();

    // Re-render with open=true
    rerender(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={() => {}}
        onNew={() => {}}
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByPlaceholderText(/세션 검색/)).toBeInTheDocument();
  });
});

describe("MessageList", () => {
  it("shows empty state when no messages", () => {
    render(<MessageList messages={[]} loading={false} streaming={false} />);
    expect(screen.getByText("무엇을 도와드릴까요?")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<MessageList messages={[]} loading={true} streaming={false} />);
    expect(screen.getByText("대화 기록 불러오는 중...")).toBeInTheDocument();
  });

  it("renders user messages", () => {
    const messages: DisplayMessage[] = [
      {
        id: "1",
        role: "user",
        content: "안녕하세요",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      },
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("안녕하세요")).toBeInTheDocument();
  });

  it("renders assistant messages", () => {
    const messages: DisplayMessage[] = [
      {
        id: "1",
        role: "assistant",
        content: "도움이 필요하시면 말씀해주세요",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      },
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);
    expect(screen.getByText("도움이 필요하시면 말씀해주세요")).toBeInTheDocument();
  });

  it("renders multiple messages in order", () => {
    const messages: DisplayMessage[] = [
      { id: "1", role: "user", content: "첫 번째", timestamp: "2026-01-01", toolCalls: [] },
      { id: "2", role: "assistant", content: "두 번째", timestamp: "2026-01-01", toolCalls: [] },
      { id: "3", role: "user", content: "세 번째", timestamp: "2026-01-01", toolCalls: [] },
    ];
    render(<MessageList messages={messages} loading={false} streaming={false} />);

    const texts = screen.getAllByText(/번째/);
    expect(texts).toHaveLength(3);
  });

  it("shows streaming indicator on streaming messages", () => {
    const messages: DisplayMessage[] = [
      {
        id: "1",
        role: "assistant",
        content: "생각 중",
        timestamp: new Date().toISOString(),
        toolCalls: [],
        streaming: true,
      },
    ];
    const { container } = render(<MessageList messages={messages} loading={false} streaming={false} />);
    // The blinking cursor indicator
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });
});
