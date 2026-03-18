/**
 * inbound-dedup.test.ts (#243)
 *
 * Tests for:
 * 1. normalizeContentForDedup stripping MEDIA: markers
 * 2. normalizeContentForDedup normalizing punctuation spacing
 * 3. Verifying MEDIA-containing messages are properly normalized for dedup
 */
import { describe, it, expect } from "vitest";
import {
  normalizeContentForDedup,
  extractMediaAttachments,
} from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// 1. MEDIA marker stripping in normalizeContentForDedup
// ---------------------------------------------------------------------------
describe("normalizeContentForDedup — MEDIA marker stripping", () => {
  it("strips single MEDIA: marker from content", () => {
    const input = "Hello world\nMEDIA:photos/image.png";
    const result = normalizeContentForDedup(input);
    expect(result).toBe("Hello world");
  });

  it("strips multiple MEDIA: markers", () => {
    const input = "Check these files\nMEDIA:a.png\nMEDIA:b.jpg\nEnd";
    const result = normalizeContentForDedup(input);
    expect(result).toBe("Check these files End");
  });

  it("deduplicates messages differing only by MEDIA markers", () => {
    const withMedia = "Hello world\nMEDIA:photos/image.png";
    const withoutMedia = "Hello world";
    expect(normalizeContentForDedup(withMedia)).toBe(
      normalizeContentForDedup(withoutMedia),
    );
  });

  it("strips MEDIA markers with various path formats", () => {
    const input = "Result\nMEDIA:https://example.com/image.png\nMEDIA:data:image/png;base64,abc";
    const result = normalizeContentForDedup(input);
    expect(result).toBe("Result");
  });

  it("handles content that is only a MEDIA marker", () => {
    const input = "MEDIA:image.png";
    const result = normalizeContentForDedup(input);
    // After stripping MEDIA and trimming, empty string matches IMAGE_PLACEHOLDERS_DEDUP
    expect(result).toBe("(image)");
  });
});

// ---------------------------------------------------------------------------
// 2. Punctuation spacing normalization
// ---------------------------------------------------------------------------
describe("normalizeContentForDedup — punctuation spacing", () => {
  it("normalizes space after period", () => {
    const a = "Hello.World";
    const b = "Hello. World";
    expect(normalizeContentForDedup(a)).toBe(normalizeContentForDedup(b));
  });

  it("normalizes newline after period to space", () => {
    const a = "Hello.\nWorld";
    const b = "Hello. World";
    expect(normalizeContentForDedup(a)).toBe(normalizeContentForDedup(b));
  });

  it("normalizes space after exclamation and question marks", () => {
    const a = "Hello!World?Really";
    const b = "Hello! World? Really";
    expect(normalizeContentForDedup(a)).toBe(normalizeContentForDedup(b));
  });

  it("normalizes Japanese period (。)", () => {
    const a = "こんにちは。世界";
    const b = "こんにちは。 世界";
    expect(normalizeContentForDedup(a)).toBe(normalizeContentForDedup(b));
  });

  it("handles multiple punctuation differences in longer text", () => {
    const a = "First sentence.Second sentence!Third sentence?Done";
    const b = "First sentence. Second sentence! Third sentence? Done";
    expect(normalizeContentForDedup(a)).toBe(normalizeContentForDedup(b));
  });
});

// ---------------------------------------------------------------------------
// 3. Combined: MEDIA + punctuation + whitespace normalization for dedup
// ---------------------------------------------------------------------------
describe("normalizeContentForDedup — combined normalization", () => {
  it("deduplicates streaming vs inbound with MEDIA and whitespace diffs", () => {
    // Streaming version (after extractMediaAttachments, no MEDIA markers)
    const streaming = "Here is the result.\nPlease check.";
    // Inbound version (still has MEDIA markers + different whitespace)
    const inbound = "Here is the result.  Please check.\nMEDIA:output.png";
    expect(normalizeContentForDedup(streaming)).toBe(
      normalizeContentForDedup(inbound),
    );
  });

  it("dedup works with timestamp prefix + MEDIA", () => {
    const streaming = "안녕하세요. 결과입니다.";
    const inbound = "[2026-03-18 10:00:00+09:00] 안녕하세요. 결과입니다.\nMEDIA:result.png";
    expect(normalizeContentForDedup(streaming)).toBe(
      normalizeContentForDedup(inbound),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. extractMediaAttachments on inbound assistant content
// ---------------------------------------------------------------------------
describe("extractMediaAttachments — inbound assistant safety net", () => {
  it("extracts MEDIA markers from inbound content", () => {
    const text = "Here is the image\nMEDIA:photos/cat.jpg\nEnd of message";
    const result = extractMediaAttachments(text);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].fileName).toBe("cat.jpg");
    expect(result.cleanedText).toBe("Here is the image\n\nEnd of message");
  });

  it("returns empty attachments when no MEDIA markers", () => {
    const text = "No media here";
    const result = extractMediaAttachments(text);
    expect(result.attachments).toHaveLength(0);
    expect(result.cleanedText).toBe("No media here");
  });
});
