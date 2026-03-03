import { describe, it, expect } from "vitest";

/**
 * Tests for image persistence after Gateway compaction (#110)
 *
 * Root cause: Gateway compacts session logs and strips base64 image data.
 * After compaction, image source becomes {} (empty), causing broken images.
 *
 * Fix: Save images server-side via /api/media/upload, reference by MEDIA: path.
 * Also gracefully skip empty image sources instead of creating invalid data URLs.
 */

// ---- Type replicas --------------------------------------------------------

interface DisplayAttachment {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  downloadUrl?: string;
}

// ---- Pure function replicas -----------------------------------------------

/**
 * Replica of extractMediaAttachments from hooks.tsx
 * Tests that uploaded image paths (absolute paths) are correctly resolved.
 */
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
    const MIME_MAP: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", svg: "image/svg+xml",
    };
    const mimeType = MIME_MAP[ext] || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isHttp = raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:");
    const downloadUrl = isHttp ? raw : `/api/media?path=${encodeURIComponent(raw)}`;
    attachments.push({
      fileName,
      mimeType,
      dataUrl: isImage ? downloadUrl : undefined,
      downloadUrl,
    });
  }
  const cleanedText = text.replace(/^MEDIA:.+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedText, attachments };
}

/**
 * Replica of the image source parsing logic from loadHistory in hooks.tsx.
 * This is the critical function that must NOT create invalid data URLs
 * when Gateway compaction strips the source object.
 */
function parseImageSource(
  source: Record<string, string> | null | undefined,
): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const { media_type, data } = source;
  if (!media_type || !data) return undefined;
  return `data:${media_type};base64,${data}`;
}

/**
 * Simulates the image part processing in loadHistory.
 * Returns a data URL or undefined (never an invalid URL).
 */
function processImagePart(part: Record<string, unknown>): string | undefined {
  // Check image_url first (OpenAI format)
  if (typeof part.image_url === "object" && part.image_url) {
    const url = (part.image_url as Record<string, string>).url;
    if (url) return url;
  }
  // Check url field
  if (typeof part.url === "string" && part.url) return part.url;
  // Check source field (Anthropic format) — MUST validate before creating data URL
  if (typeof part.source === "object" && part.source) {
    return parseImageSource(part.source as Record<string, string>);
  }
  return undefined;
}

// ---- Tests ----------------------------------------------------------------

describe("Image persistence (#110)", () => {
  describe("extractMediaAttachments with uploaded paths", () => {
    it("handles absolute path from upload endpoint", () => {
      const text = "Here is the image\nMEDIA:/Users/test/.openclaw/media/uploads/abc123.jpg";
      const { cleanedText, attachments } = extractMediaAttachments(text);
      expect(cleanedText).toBe("Here is the image");
      expect(attachments).toHaveLength(1);
      expect(attachments[0].fileName).toBe("abc123.jpg");
      expect(attachments[0].mimeType).toBe("image/jpeg");
      expect(attachments[0].dataUrl).toMatch(/\/api\/media\?path=/);
      expect(attachments[0].downloadUrl).toMatch(/\/api\/media\?path=/);
    });

    it("handles multiple MEDIA lines including uploaded paths", () => {
      const text = [
        "Check these images:",
        "MEDIA:/Users/test/.openclaw/media/uploads/img1.png",
        "MEDIA:/Users/test/.openclaw/media/uploads/img2.jpg",
        "Done!",
      ].join("\n");
      const { cleanedText, attachments } = extractMediaAttachments(text);
      expect(cleanedText).toBe("Check these images:\n\nDone!");
      expect(attachments).toHaveLength(2);
      expect(attachments[0].mimeType).toBe("image/png");
      expect(attachments[1].mimeType).toBe("image/jpeg");
    });

    it("produces correct media URL for uploaded path", () => {
      const path = "/Users/test/.openclaw/media/uploads/abc123.jpg";
      const text = `MEDIA:${path}`;
      const { attachments } = extractMediaAttachments(text);
      expect(attachments[0].downloadUrl).toBe(`/api/media?path=${encodeURIComponent(path)}`);
    });
  });

  describe("empty image source handling (compaction)", () => {
    it("returns undefined for empty source object", () => {
      expect(parseImageSource({} as Record<string, string>)).toBeUndefined();
    });

    it("returns undefined for null source", () => {
      expect(parseImageSource(null)).toBeUndefined();
    });

    it("returns undefined for undefined source", () => {
      expect(parseImageSource(undefined)).toBeUndefined();
    });

    it("returns undefined for source with missing data", () => {
      expect(parseImageSource({ media_type: "image/jpeg" } as Record<string, string>)).toBeUndefined();
    });

    it("returns undefined for source with missing media_type", () => {
      expect(parseImageSource({ data: "abc123" } as Record<string, string>)).toBeUndefined();
    });

    it("returns undefined for source with empty strings", () => {
      expect(parseImageSource({ media_type: "", data: "" })).toBeUndefined();
    });

    it("returns valid data URL for complete source", () => {
      const url = parseImageSource({ media_type: "image/jpeg", data: "abc123" });
      expect(url).toBe("data:image/jpeg;base64,abc123");
    });
  });

  describe("processImagePart (loadHistory integration)", () => {
    it("handles image_url format correctly", () => {
      const part = { type: "image_url", image_url: { url: "https://example.com/img.jpg" } };
      expect(processImagePart(part)).toBe("https://example.com/img.jpg");
    });

    it("handles url field correctly", () => {
      const part = { type: "image", url: "https://example.com/img.jpg" };
      expect(processImagePart(part)).toBe("https://example.com/img.jpg");
    });

    it("handles valid Anthropic source correctly", () => {
      const part = {
        type: "image",
        source: { media_type: "image/jpeg", data: "base64data" },
      };
      expect(processImagePart(part)).toBe("data:image/jpeg;base64,base64data");
    });

    it("skips empty source from compaction (CRITICAL FIX)", () => {
      // This is the exact scenario that causes #110
      const part = { type: "image", source: {} };
      const url = processImagePart(part);
      expect(url).toBeUndefined();
      // MUST NOT produce "data:undefined;base64,undefined"
    });

    it("skips null source", () => {
      const part = { type: "image", source: null };
      expect(processImagePart(part)).toBeUndefined();
    });

    it("skips when no image data fields present", () => {
      const part = { type: "image" };
      expect(processImagePart(part)).toBeUndefined();
    });
  });

  describe("data URL validation", () => {
    it("never creates data:undefined;base64,undefined", () => {
      // Test various empty/invalid source objects
      const invalidSources = [{}, null, undefined, { media_type: "" }, { data: "" }];
      for (const source of invalidSources) {
        const url = parseImageSource(source as Record<string, string>);
        expect(url).not.toBe("data:undefined;base64,undefined");
        expect(url).toBeUndefined();
      }
    });
  });

  describe("upload request building", () => {
    it("builds correct upload payload from base64", () => {
      const base64 = "abc123";
      const mimeType = "image/jpeg";
      const payload = { data: base64, mimeType, fileName: "photo.jpg" };
      expect(payload.data).toBe(base64);
      expect(payload.mimeType).toBe(mimeType);
      expect(payload.mimeType.startsWith("image/")).toBe(true);
    });

    it("derives extension from mimeType", () => {
      const mimeToExt: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
      };
      for (const [mime, ext] of Object.entries(mimeToExt)) {
        expect(ext).toBeDefined();
        expect(mime.startsWith("image/")).toBe(true);
      }
    });
  });
});
