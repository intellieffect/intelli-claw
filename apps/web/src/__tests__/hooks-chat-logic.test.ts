/**
 * hooks-chat-logic.test.ts — Pure logic tests for useChat hook internals
 *
 * Tests exported values (HIDDEN_REPLY_RE, loadGatewayConfig) and
 * replicated pure functions from hooks.tsx (stripInboundMeta, stripTemplateVars,
 * deduplicateMessages, extractMediaAttachments, isHiddenMessage, session isolation).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { HIDDEN_REPLY_RE, loadGatewayConfig } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// Replicated pure functions (mirrors hooks.tsx internals for direct testing)
// ---------------------------------------------------------------------------

function stripInboundMeta(text: string): string {
  let cleaned = text.replace(
    /Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g,
    "",
  );
  cleaned = cleaned.replace(/^\[\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/g, "");
  return cleaned.trim();
}

function stripTemplateVars(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]\s*/g, "").trim();
}

function deduplicateMessages<
  T extends { id: string; role: string; content: string; timestamp: string },
>(msgs: T[]): T[] {
  const seen: Array<{ role: string; contentKey: string; ts: number }> = [];
  return msgs.filter((m) => {
    if (m.role === "session-boundary") return true;
    const contentKey = m.content.replace(/\s+/g, " ").trim().slice(0, 200);
    const ts = new Date(m.timestamp).getTime();
    const isDup = seen.some(
      (s) =>
        s.role === m.role &&
        s.contentKey === contentKey &&
        Math.abs(s.ts - ts) < 60_000,
    );
    if (isDup) return false;
    seen.push({ role: m.role, contentKey, ts });
    return true;
  });
}

interface DisplayAttachment {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  downloadUrl?: string;
  textContent?: string;
}

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
    // Simplified mime lookup for testing (mirrors getMimeType behavior)
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      pdf: "application/pdf",
    };
    const mimeType = mimeMap[ext] || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isHttp =
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("data:");
    const downloadUrl = isHttp ? raw : `/media/${raw}`;
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

function isHiddenMessage(role: string, text: string): boolean {
  if (role === "system") return true;
  return HIDDEN_REPLY_RE.test(text.trim());
}

// Helper for session isolation logic (mirrors hooks.tsx onEvent handler)
function shouldAcceptEvent(
  evSessionKey: string | undefined,
  boundSessionKey: string | undefined,
): boolean {
  if (evSessionKey && evSessionKey !== boundSessionKey) return false;
  if (!evSessionKey && boundSessionKey) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HIDDEN_REPLY_RE filtering (#117)", () => {
  it.each([
    ["NO_REPLY", true],
    ["NO_REPLY ", true],
    ["HEARTBEAT_OK", true],
    ["NO_", true],
    ["Pre-compaction memory flush...", true],
    ["Read HEARTBEAT.md", true],
    ["reply with NO_REPLY", true],
    ["Store durable memories now", true],
    ["[System] 이전 세션이 컨텍스트 한도로 갱신", true],
    ["[이전 세션 맥락]", true],
    ["Hello world", false],
    ["NO_REPLY is a pattern", false],
  ])("%s → %s", (input, shouldMatch) => {
    expect(HIDDEN_REPLY_RE.test(input.trim())).toBe(shouldMatch);
  });
});

describe("isHiddenMessage", () => {
  it("always hides system role", () => {
    expect(isHiddenMessage("system", "Hello world")).toBe(true);
  });

  it("hides assistant NO_REPLY", () => {
    expect(isHiddenMessage("assistant", "NO_REPLY")).toBe(true);
  });

  it("shows normal assistant message", () => {
    expect(isHiddenMessage("assistant", "Hello!")).toBe(false);
  });

  it("shows normal user message", () => {
    expect(isHiddenMessage("user", "Tell me a joke")).toBe(false);
  });
});

describe("stripInboundMeta (#55)", () => {
  it("removes gateway timestamp prefix", () => {
    expect(stripInboundMeta("[2024-01-15 10:30:45+09:00] Hello")).toBe("Hello");
  });

  it("preserves [important] user text", () => {
    expect(stripInboundMeta("[important] Do this")).toBe("[important] Do this");
  });

  it("removes Conversation info block", () => {
    const input = `Conversation info (untrusted metadata):\n\`\`\`json\n{"key":"val"}\n\`\`\`\nActual message`;
    expect(stripInboundMeta(input)).toBe("Actual message");
  });

  it("handles empty string", () => {
    expect(stripInboundMeta("")).toBe("");
  });

  it("handles text with no metadata", () => {
    expect(stripInboundMeta("Just plain text")).toBe("Just plain text");
  });

  it("removes timestamp with timezone offset", () => {
    expect(stripInboundMeta("[2024-06-01 08:00:00+00:00] Test")).toBe("Test");
  });
});

describe("stripTemplateVars", () => {
  it("removes [[name]] variable", () => {
    expect(stripTemplateVars("[[name]] Hello")).toBe("Hello");
  });

  it("preserves normal text without template vars", () => {
    expect(stripTemplateVars("Hello world")).toBe("Hello world");
  });

  it("removes multiple template vars", () => {
    expect(stripTemplateVars("[[a]] [[b]] text")).toBe("text");
  });

  it("handles empty string", () => {
    expect(stripTemplateVars("")).toBe("");
  });

  it("does not remove single brackets", () => {
    expect(stripTemplateVars("[not a var] text")).toBe("[not a var] text");
  });
});

describe("deduplicateMessages (#121)", () => {
  const ts1 = "2024-01-15T10:00:00Z";
  const ts2 = "2024-01-15T10:00:30Z"; // 30s later (within 60s)
  const ts3 = "2024-01-15T10:02:00Z"; // 2min later (>60s)

  it("keeps first of duplicate role+content+close timestamp", () => {
    const msgs = [
      { id: "1", role: "assistant", content: "Hello", timestamp: ts1 },
      { id: "2", role: "assistant", content: "Hello", timestamp: ts2 },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("keeps both when same content but different role", () => {
    const msgs = [
      { id: "1", role: "user", content: "Hello", timestamp: ts1 },
      { id: "2", role: "assistant", content: "Hello", timestamp: ts2 },
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(2);
  });

  it("keeps both when same role+content but >60s apart", () => {
    const msgs = [
      { id: "1", role: "assistant", content: "Hello", timestamp: ts1 },
      { id: "2", role: "assistant", content: "Hello", timestamp: ts3 },
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(2);
  });

  it("always keeps session-boundary even if duplicate", () => {
    const msgs = [
      { id: "1", role: "session-boundary", content: "", timestamp: ts1 },
      { id: "2", role: "session-boundary", content: "", timestamp: ts2 },
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(2);
  });

  it("compares only first 200 chars of content", () => {
    const longBase = "a".repeat(200);
    const msgs = [
      {
        id: "1",
        role: "assistant",
        content: longBase + "XXXXX",
        timestamp: ts1,
      },
      {
        id: "2",
        role: "assistant",
        content: longBase + "YYYYY",
        timestamp: ts2,
      },
    ];
    // First 200 chars are identical → duplicate
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("normalizes whitespace before comparing", () => {
    const msgs = [
      { id: "1", role: "assistant", content: "hello  world", timestamp: ts1 },
      { id: "2", role: "assistant", content: "hello world", timestamp: ts2 },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("handles empty array", () => {
    expect(deduplicateMessages([])).toEqual([]);
  });
});

describe("Session isolation logic (#5536)", () => {
  it("rejects event when evSessionKey differs from boundSessionKey", () => {
    expect(shouldAcceptEvent("session-A", "session-B")).toBe(false);
  });

  it("rejects event when evSessionKey is undefined but boundSessionKey exists", () => {
    expect(shouldAcceptEvent(undefined, "session-B")).toBe(false);
  });

  it("accepts event when evSessionKey matches boundSessionKey", () => {
    expect(shouldAcceptEvent("session-A", "session-A")).toBe(true);
  });

  it("accepts event when both are undefined", () => {
    expect(shouldAcceptEvent(undefined, undefined)).toBe(true);
  });
});

describe("loadGatewayConfig", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubEnv("VITE_GATEWAY_URL", "");
    vi.stubEnv("VITE_GATEWAY_TOKEN", "");
    // Mock localStorage with a plain object store
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    };
    vi.stubGlobal("localStorage", mockStorage);
  });

  it("parses valid config from localStorage", () => {
    store["awf:gateway-config"] = JSON.stringify({ url: "ws://custom:1234", token: "my-token" });
    const config = loadGatewayConfig();
    expect(config.url).toBe("ws://custom:1234");
    expect(config.token).toBe("my-token");
  });

  it("returns defaults when localStorage is empty", () => {
    const config = loadGatewayConfig();
    expect(config.url).toBeTruthy();
    expect(typeof config.token).toBe("string");
  });

  it("returns defaults for invalid JSON", () => {
    store["awf:gateway-config"] = "not-json{{{";
    const config = loadGatewayConfig();
    expect(config.url).toBeTruthy();
    expect(typeof config.token).toBe("string");
  });

  it("returns defaults when config has no url/token", () => {
    store["awf:gateway-config"] = JSON.stringify({ foo: "bar" });
    const config = loadGatewayConfig();
    // Should fall through since url and token are missing
    expect(config.url).toBeTruthy();
  });
});

describe("extractMediaAttachments", () => {
  it("extracts local file path attachment", () => {
    const input = "Hello\nMEDIA:/path/to/image.png\nWorld";
    const result = extractMediaAttachments(input);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].fileName).toBe("image.png");
    expect(result.attachments[0].mimeType).toBe("image/png");
    expect(result.attachments[0].dataUrl).toBeTruthy(); // image → has dataUrl
    expect(result.cleanedText).toBe("Hello\n\nWorld");
  });

  it("handles multiple MEDIA lines", () => {
    const input = "MEDIA:/a/photo.jpg\nText\nMEDIA:/b/doc.pdf";
    const result = extractMediaAttachments(input);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0].mimeType).toBe("image/jpeg");
    expect(result.attachments[1].mimeType).toBe("application/pdf");
    expect(result.attachments[1].dataUrl).toBeUndefined(); // PDF → no dataUrl
    expect(result.cleanedText).toBe("Text");
  });

  it("returns unchanged text when no MEDIA lines", () => {
    const input = "Just normal text\nwith newlines";
    const result = extractMediaAttachments(input);
    expect(result.attachments).toHaveLength(0);
    expect(result.cleanedText).toBe(input);
  });

  it("handles HTTP URL", () => {
    const input = "MEDIA:https://example.com/photo.png";
    const result = extractMediaAttachments(input);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].downloadUrl).toBe(
      "https://example.com/photo.png",
    );
    expect(result.attachments[0].dataUrl).toBe(
      "https://example.com/photo.png",
    );
  });

  it("handles data: URL", () => {
    const input = "MEDIA:data:image/png;base64,iVBOR...";
    const result = extractMediaAttachments(input);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].downloadUrl).toContain("data:image/png");
  });

  it("handles empty text", () => {
    const result = extractMediaAttachments("");
    expect(result.attachments).toHaveLength(0);
    expect(result.cleanedText).toBe("");
  });
});
