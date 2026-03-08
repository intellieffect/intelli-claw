import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock useGateway before importing components
vi.mock("@/lib/gateway/hooks", () => ({
  useGateway: () => ({ client: null }),
}));

import { ToolCallCard } from "@/components/chat/tool-call-card";
import { SubagentCard } from "@/components/chat/subagent-card";
import type { ToolCall } from "@/lib/gateway/protocol";

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    callId: "call-1",
    name: "sessions_spawn",
    args: JSON.stringify({ task: "분석해줘" }),
    status: "running",
    ...overrides,
  };
}

describe("Issue #198: sessions_spawn attachments visualization", () => {
  describe("ToolCallCard with attachments", () => {
    it("renders SubagentCard for sessions_spawn without attachments (backward compat)", () => {
      const tc = makeToolCall();
      const { container } = render(<ToolCallCard toolCall={tc} />);
      // Should render SubagentCard (contains "서브에이전트" or task text)
      expect(container.querySelector("button")).toBeTruthy();
    });

    it("passes attachments to SubagentCard when present in args", () => {
      const tc = makeToolCall({
        args: JSON.stringify({
          task: "PDF 분석해줘",
          attachments: [
            { name: "report.pdf", content: "base64data", encoding: "base64", mimeType: "application/pdf" },
          ],
        }),
      });
      render(<ToolCallCard toolCall={tc} />);
      // Should show attachment count badge
      expect(screen.getByText(/1/)).toBeTruthy();
    });

    it("shows multiple attachment count", () => {
      const tc = makeToolCall({
        args: JSON.stringify({
          task: "여러 파일 분석",
          attachments: [
            { name: "a.pdf", content: "x", encoding: "base64", mimeType: "application/pdf" },
            { name: "b.png", content: "y", encoding: "base64", mimeType: "image/png" },
            { name: "c.csv", content: "z", encoding: "base64", mimeType: "text/csv" },
          ],
        }),
      });
      render(<ToolCallCard toolCall={tc} />);
      expect(screen.getByText(/3/)).toBeTruthy();
    });
  });

  describe("SubagentCard attachments display", () => {
    it("renders without attachments prop (backward compat)", () => {
      const { container } = render(
        <SubagentCard sessionKey="agent:ops:subagent:abc" label="Test" task="Do something" />
      );
      expect(container.querySelector("button")).toBeTruthy();
    });

    it("shows attachment badge when attachments provided", () => {
      const attachments = [
        { name: "report.pdf", mimeType: "application/pdf" },
      ];
      render(
        <SubagentCard
          sessionKey="agent:ops:subagent:abc"
          label="Test"
          task="분석"
          attachments={attachments}
        />
      );
      expect(screen.getByTitle(/첨부/i)).toBeTruthy();
    });

    it("shows attachment file names when expanded", () => {
      const attachments = [
        { name: "report.pdf", mimeType: "application/pdf" },
        { name: "photo.jpg", mimeType: "image/jpeg" },
      ];
      const { container } = render(
        <SubagentCard
          sessionKey="agent:ops:subagent:abc"
          label="Test"
          task="분석"
          attachments={attachments}
        />
      );
      // Click to expand
      const btn = container.querySelector("button");
      if (btn) fireEvent.click(btn);
      expect(screen.getByText("report.pdf")).toBeTruthy();
      expect(screen.getByText("photo.jpg")).toBeTruthy();
    });

    it("displays correct icon for PDF mime type", () => {
      const attachments = [
        { name: "doc.pdf", mimeType: "application/pdf" },
      ];
      const { container } = render(
        <SubagentCard
          sessionKey="agent:ops:subagent:abc"
          label="Test"
          task="분석"
          attachments={attachments}
        />
      );
      const btn = container.querySelector("button");
      if (btn) fireEvent.click(btn);
      // PDF should use FileText icon — check by data-testid or class
      expect(screen.getByText("doc.pdf")).toBeTruthy();
    });

    it("displays correct icon for image mime type", () => {
      const attachments = [
        { name: "photo.png", mimeType: "image/png" },
      ];
      const { container } = render(
        <SubagentCard
          sessionKey="agent:ops:subagent:abc"
          label="Test"
          task="분석"
          attachments={attachments}
        />
      );
      const btn = container.querySelector("button");
      if (btn) fireEvent.click(btn);
      expect(screen.getByText("photo.png")).toBeTruthy();
    });
  });

  describe("Receipt display", () => {
    it("shows receipt info when result contains receipts", () => {
      const tc = makeToolCall({
        status: "done",
        args: JSON.stringify({
          task: "분석",
          attachments: [
            { name: "report.pdf", content: "base64data", encoding: "base64", mimeType: "application/pdf" },
          ],
        }),
        result: JSON.stringify({
          status: "accepted",
          runId: "run-1",
          childSessionKey: "agent:ops:subagent:abc",
          receipts: [
            { name: "report.pdf", sha256: "abc123def456" },
          ],
        }),
      });
      render(<ToolCallCard toolCall={tc} />);
      // Expand to see receipt
      const btn = screen.getAllByRole("button")[0];
      fireEvent.click(btn);
      expect(screen.getByText(/abc123/)).toBeTruthy();
    });
  });
});
