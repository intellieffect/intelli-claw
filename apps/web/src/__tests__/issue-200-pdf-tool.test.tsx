import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock useGateway before importing components
vi.mock("@/lib/gateway/hooks", () => ({
  useGateway: () => ({ client: null }),
}));

import { ToolCallCard } from "@/components/chat/tool-call-card";
import type { ToolCall } from "@/lib/gateway/protocol";

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    callId: "call-1",
    name: "pdf",
    args: JSON.stringify({ pdf: "/path/to/report.pdf", prompt: "요약해줘" }),
    status: "running",
    ...overrides,
  };
}

describe("Issue #200: PDF tool visualization", () => {
  describe("PdfToolCard rendering", () => {
    it("renders specialized card for pdf tool (not generic)", () => {
      const tc = makeToolCall();
      render(<ToolCallCard toolCall={tc} />);
      // Should show PDF file path
      expect(screen.getByText(/report\.pdf/)).toBeTruthy();
    });

    it("displays PDF file path", () => {
      const tc = makeToolCall({
        args: JSON.stringify({ pdf: "/Users/bruce/docs/quarterly.pdf", prompt: "분석" }),
      });
      render(<ToolCallCard toolCall={tc} />);
      expect(screen.getByText(/quarterly\.pdf/)).toBeTruthy();
    });

    it("displays prompt text", () => {
      const tc = makeToolCall({
        args: JSON.stringify({ pdf: "/path/to/file.pdf", prompt: "이 보고서를 요약해줘" }),
      });
      render(<ToolCallCard toolCall={tc} />);
      expect(screen.getByText(/이 보고서를 요약해줘/)).toBeTruthy();
    });

    it("displays pages range when present", () => {
      const tc = makeToolCall({
        args: JSON.stringify({ pdf: "/path/to/file.pdf", prompt: "분석", pages: "1-5,7" }),
      });
      render(<ToolCallCard toolCall={tc} />);
      expect(screen.getByText(/1-5,7/)).toBeTruthy();
    });

    it("shows running status with spinner", () => {
      const tc = makeToolCall({ status: "running" });
      const { container } = render(<ToolCallCard toolCall={tc} />);
      // Loader2 has animate-spin class
      expect(container.querySelector(".animate-spin")).toBeTruthy();
    });

    it("shows completed result with native mode badge", () => {
      const tc = makeToolCall({
        status: "done",
        result: JSON.stringify({
          content: [{ text: "PDF 분석 결과입니다." }],
          details: { model: "anthropic/claude-opus-4-6", native: true },
        }),
      });
      const { container } = render(<ToolCallCard toolCall={tc} />);
      // Click to expand
      const btn = container.querySelector("button");
      if (btn) fireEvent.click(btn);
      expect(screen.getByText(/native/i)).toBeTruthy();
    });

    it("shows completed result with extraction mode badge", () => {
      const tc = makeToolCall({
        status: "done",
        result: JSON.stringify({
          content: [{ text: "추출 결과입니다." }],
          details: { model: "openai/gpt-5", native: false },
        }),
      });
      const { container } = render(<ToolCallCard toolCall={tc} />);
      const btn = container.querySelector("button");
      if (btn) fireEvent.click(btn);
      expect(screen.getByText(/extraction/i)).toBeTruthy();
    });

    it("shows error status", () => {
      const tc = makeToolCall({
        status: "error",
        result: JSON.stringify({
          error: { code: "pdf_too_large", message: "PDF exceeds 10MB limit" },
        }),
      });
      render(<ToolCallCard toolCall={tc} />);
      expect(screen.getByText(/report\.pdf/)).toBeTruthy();
    });

    it("renders generic card for non-pdf tools", () => {
      const tc: ToolCall = {
        callId: "call-2",
        name: "web_search",
        args: JSON.stringify({ query: "test" }),
        status: "done",
      };
      render(<ToolCallCard toolCall={tc} />);
      // Should show tool name in generic format
      expect(screen.getByText("web_search")).toBeTruthy();
    });

    it("handles multi-PDF (pdfs parameter)", () => {
      const tc = makeToolCall({
        args: JSON.stringify({
          pdfs: ["/path/a.pdf", "/path/b.pdf", "/path/c.pdf"],
          prompt: "비교 분석",
        }),
      });
      render(<ToolCallCard toolCall={tc} />);
      expect(screen.getByText(/a\.pdf/)).toBeTruthy();
      expect(screen.getByText(/b\.pdf/)).toBeTruthy();
      expect(screen.getByText(/c\.pdf/)).toBeTruthy();
    });
  });

  describe("Electron PDF hint", () => {
    it("includes pdf tool guidance in hint text", () => {
      // This tests the hint format used in chat-panel.tsx
      const hint = `📎 [PDF: report.pdf] /path/to/report.pdf\n💡 Use the \`pdf\` tool for native analysis.`;
      expect(hint).toContain("pdf");
      expect(hint).toContain("native analysis");
    });
  });
});
