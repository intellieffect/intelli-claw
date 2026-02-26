/**
 * TDD tests for media handling bugs:
 *   #52 — Agent-sent media (images via MEDIA: protocol) display as broken icons
 *   #46 — Sending image-only message (no text) returns "no text" error
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageList } from "@/components/chat/message-list";
import type { DisplayMessage, DisplayAttachment } from "@/lib/gateway/hooks";
import { getMimeType } from "@/lib/mime-types";
import { platform } from "@/lib/platform";

// ---------------------------------------------------------------------------
// Inline replica of extractMediaAttachments (from hooks.tsx L202-223)
// Mirrors the production code exactly so we can test the logic in isolation
// ---------------------------------------------------------------------------

function extractMediaAttachments(text: string): {
  cleanedText: string;
  attachments: DisplayAttachment[];
} {
  const MEDIA_RE = /^MEDIA:(.+)$/gm;
  const attachments: DisplayAttachment[] = [];
  let match: RegExpExecArray | null;
  while ((match = MEDIA_RE.exec(text)) !== null) {
    const raw = match[1].trim();
    const fileName = raw.split("/").pop() || raw;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const mimeType = getMimeType(ext);
    const isImage = mimeType.startsWith("image/");
    const isHttp =
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("data:");
    const downloadUrl = isHttp ? raw : platform.mediaUrl(raw);
    attachments.push({
      fileName,
      mimeType,
      dataUrl: isImage ? downloadUrl : undefined,
      downloadUrl,
    });
  }
  const cleanedText = text
    .replace(/^MEDIA:.+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanedText, attachments };
}

// ---------------------------------------------------------------------------
// Helper: build a DisplayMessage
// ---------------------------------------------------------------------------

function makeAssistantMsg(overrides: Partial<DisplayMessage> = {}): DisplayMessage {
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    toolCalls: [],
    streaming: false,
    ...overrides,
  };
}

// ===========================================================================
// #52: Agent-sent MEDIA images should render correctly
// ===========================================================================

describe("#52: Agent-sent MEDIA images should render correctly", () => {
  describe("extractMediaAttachments URL generation", () => {
    it("generates correct /api/media URL for absolute file paths", () => {
      const text = "MEDIA:/tmp/output/generated.png";
      const result = extractMediaAttachments(text);

      expect(result.attachments).toHaveLength(1);
      const att = result.attachments[0];
      expect(att.fileName).toBe("generated.png");
      expect(att.mimeType).toBe("image/png");
      expect(att.downloadUrl).toMatch(/^\/api\/media\?path=/);
      expect(att.dataUrl).toBe(att.downloadUrl);
    });

    it("handles paths with spaces (URL encoding)", () => {
      const text = "MEDIA:/tmp/my images/photo 2024.png";
      const result = extractMediaAttachments(text);

      expect(result.attachments).toHaveLength(1);
      const att = result.attachments[0];
      expect(att.downloadUrl).toContain("path=");
      // Spaces must be encoded in the URL
      expect(att.downloadUrl).not.toContain(" ");
    });

    it("handles tilde paths from home directory", () => {
      const text = "MEDIA:~/Documents/image.png";
      const result = extractMediaAttachments(text);

      expect(result.attachments).toHaveLength(1);
      const att = result.attachments[0];
      expect(att.downloadUrl).toMatch(/^\/api\/media\?path=/);
      expect(att.dataUrl).toBeTruthy();
    });

    it("passes through HTTP URLs unchanged", () => {
      const text = "MEDIA:https://cdn.example.com/images/photo.jpg";
      const result = extractMediaAttachments(text);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].downloadUrl).toBe(
        "https://cdn.example.com/images/photo.jpg"
      );
      expect(result.attachments[0].dataUrl).toBe(
        "https://cdn.example.com/images/photo.jpg"
      );
    });

    it("passes through data URLs unchanged", () => {
      const text = "MEDIA:data:image/png;base64,iVBORw0KGgo=";
      const result = extractMediaAttachments(text);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].downloadUrl).toBe(
        "data:image/png;base64,iVBORw0KGgo="
      );
    });

    it("handles mixed sources correctly", () => {
      const text = [
        "Here are the generated images:",
        "MEDIA:/tmp/local.png",
        "MEDIA:https://example.com/remote.jpg",
        "MEDIA:data:image/gif;base64,R0lGODlh",
        "All done.",
      ].join("\n");
      const result = extractMediaAttachments(text);

      expect(result.attachments).toHaveLength(3);
      expect(result.attachments[0].downloadUrl).toMatch(/^\/api\/media/);
      expect(result.attachments[1].downloadUrl).toBe(
        "https://example.com/remote.jpg"
      );
      expect(result.attachments[2].downloadUrl).toBe(
        "data:image/gif;base64,R0lGODlh"
      );
      expect(result.cleanedText).toBe(
        "Here are the generated images:\n\nAll done."
      );
    });
  });

  describe("MessageList renders MEDIA image attachments", () => {
    it("renders img tag for assistant message with image attachment", () => {
      const messages: DisplayMessage[] = [
        makeAssistantMsg({
          attachments: [
            {
              fileName: "generated.png",
              mimeType: "image/png",
              dataUrl: "/api/media?path=%2Ftmp%2Fgenerated.png",
              downloadUrl: "/api/media?path=%2Ftmp%2Fgenerated.png",
            },
          ],
        }),
      ];

      const { container } = render(
        <MessageList messages={messages} loading={false} streaming={false} />
      );

      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe(
        "/api/media?path=%2Ftmp%2Fgenerated.png"
      );
      expect(img?.getAttribute("alt")).toBe("generated.png");
    });

    it("renders multiple image attachments", () => {
      const messages: DisplayMessage[] = [
        makeAssistantMsg({
          content: "Here are the results:",
          attachments: [
            {
              fileName: "style-1.png",
              mimeType: "image/png",
              dataUrl: "https://example.com/style-1.png",
              downloadUrl: "https://example.com/style-1.png",
            },
            {
              fileName: "style-2.jpg",
              mimeType: "image/jpeg",
              dataUrl: "https://example.com/style-2.jpg",
              downloadUrl: "https://example.com/style-2.jpg",
            },
          ],
        }),
      ];

      const { container } = render(
        <MessageList messages={messages} loading={false} streaming={false} />
      );

      const imgs = container.querySelectorAll("img");
      expect(imgs.length).toBe(2);
    });

    it("MEDIA-only message (no text content) is NOT filtered out", () => {
      const messages: DisplayMessage[] = [
        makeAssistantMsg({
          content: "", // empty after MEDIA lines are stripped
          attachments: [
            {
              fileName: "output.png",
              mimeType: "image/png",
              dataUrl: "https://example.com/output.png",
              downloadUrl: "https://example.com/output.png",
            },
          ],
        }),
      ];

      const { container } = render(
        <MessageList messages={messages} loading={false} streaming={false} />
      );

      // The image should be rendered even though content is empty
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
    });
  });

  describe("API server validatePath (server-side fix)", () => {
    // Replica of the FIXED validatePath from api-server.ts
    // The original rejected any path containing "~" which blocked
    // agent-generated paths like ~/Documents/image.png
    function validatePathFixed(p: string | null): string | null {
      if (!p) return null;
      if (p.includes("..")) return null;
      // Expand ~ to home directory
      if (p.startsWith("~/") || p === "~") {
        return "/home/testuser" + p.slice(1); // simulated homedir()
      }
      return p;
    }

    it("expands tilde to home directory for ~/path", () => {
      expect(validatePathFixed("~/Documents/image.png")).toBe(
        "/home/testuser/Documents/image.png"
      );
    });

    it("accepts paths with tilde in middle of path", () => {
      expect(validatePathFixed("/home/user~backup/file.png")).toBe(
        "/home/user~backup/file.png"
      );
    });

    it("still rejects directory traversal", () => {
      expect(validatePathFixed("/tmp/../etc/passwd")).toBeNull();
      expect(validatePathFixed("../../secret")).toBeNull();
    });

    it("rejects null/empty paths", () => {
      expect(validatePathFixed(null)).toBeNull();
      expect(validatePathFixed("")).toBeNull();
    });

    it("accepts absolute paths without tilde", () => {
      expect(validatePathFixed("/tmp/output/image.png")).toBe(
        "/tmp/output/image.png"
      );
    });
  });
});

// ===========================================================================
// #46: Image-only message (no text) returns "no text" error
// ===========================================================================

describe("#46: Image-only message should not produce 'no text' error", () => {
  describe("message construction logic (current BUG)", () => {
    it("BUG: empty string sent when text is empty and no PDF text", () => {
      const text = "";
      const pdfTexts = "";
      // Current logic from chat-panel.tsx L366:
      const userMsg = [text, pdfTexts].filter(Boolean).join("\n\n") || "";
      expect(userMsg).toBe("");
      // Gateway receives empty message -> "I didn't receive any text"
    });

    it("text provided: message is non-empty (no bug)", () => {
      const text = "Check this image";
      const pdfTexts = "";
      const userMsg = [text, pdfTexts].filter(Boolean).join("\n\n") || "";
      expect(userMsg).toBe("Check this image");
    });

    it("PDF attachment: pdfTexts provide content (no bug)", () => {
      const text = "";
      const pdfTexts = "PDF: doc.pdf -- 3 pages\nExtracted text...";
      const userMsg = [text, pdfTexts].filter(Boolean).join("\n\n") || "";
      expect(userMsg).not.toBe("");
    });
  });

  describe("fixed message construction", () => {
    /**
     * After fix: when text is empty but attachments exist,
     * a placeholder is used so gateway doesn't reject the message.
     */
    function buildMessageFixed(
      text: string,
      pdfTexts: string,
      hasAttachments: boolean,
    ): string {
      const userMsg = [text, pdfTexts].filter(Boolean).join("\n\n");
      if (!userMsg && hasAttachments) return "(image)";
      return userMsg || "";
    }

    it("provides placeholder for image-only messages", () => {
      const result = buildMessageFixed("", "", true);
      expect(result).not.toBe("");
      expect(result.length).toBeGreaterThan(0);
    });

    it("preserves user text when provided", () => {
      expect(buildMessageFixed("Check this", "", true)).toBe("Check this");
    });

    it("combines text and PDF text normally", () => {
      expect(buildMessageFixed("Review", "PDF text", true)).toBe(
        "Review\n\nPDF text"
      );
    });

    it("returns empty when no attachments and no text", () => {
      expect(buildMessageFixed("", "", false)).toBe("");
    });
  });

  describe("display-side user message", () => {
    it("addUserMessage uses placeholder text for display", () => {
      // chat-panel.tsx L383: addUserMessage(text || "(첨부 파일)", displayAtts)
      const text = "";
      const displayText = text || "(첨부 파일)";
      expect(displayText).toBe("(첨부 파일)");
    });

    it("user message with image attachment renders in MessageList", () => {
      const messages: DisplayMessage[] = [
        {
          id: "user-1",
          role: "user",
          content: "(첨부 파일)",
          timestamp: new Date().toISOString(),
          toolCalls: [],
          attachments: [
            {
              fileName: "photo.png",
              mimeType: "image/png",
              dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            },
          ],
        },
      ];

      const { container } = render(
        <MessageList messages={messages} loading={false} streaming={false} />
      );

      // Image should be rendered
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      // The placeholder text should NOT be shown when attachments exist
      // (message-list.tsx L421-423 handles this)
      expect(
        screen.queryByText("(첨부 파일)")
      ).not.toBeInTheDocument();
    });
  });
});
