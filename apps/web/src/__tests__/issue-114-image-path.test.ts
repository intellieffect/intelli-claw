/**
 * TDD tests for Issue #114:
 * Validate external device image paths for cross-device access.
 *
 * When images are sent from an external device (e.g., MacBook) to the
 * Mac Studio agent, the paths must be correctly resolved so that:
 *   - HTTP/HTTPS URLs are passed through unchanged
 *   - data: URLs are passed through unchanged
 *   - Local/absolute paths are converted via platform.mediaUrl()
 *   - Various MEDIA: prefix patterns are handled correctly
 *   - Edge cases (empty paths, whitespace, special chars) are robust
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { platform } from "@/lib/platform";
import { extractMediaAttachments } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Issue #114: extractMediaAttachments – image path handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- HTTP/HTTPS URL pass-through ---
  describe("HTTP/HTTPS URLs are passed through unchanged", () => {
    it("preserves https:// URLs as downloadUrl", () => {
      const input = "MEDIA:https://example.com/images/photo.jpg";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].downloadUrl).toBe(
        "https://example.com/images/photo.jpg",
      );
      expect(result.attachments[0].fileName).toBe("photo.jpg");
      expect(result.attachments[0].mimeType).toBe("image/jpeg");
      expect(result.attachments[0].dataUrl).toBe(
        "https://example.com/images/photo.jpg",
      );
    });

    it("preserves http:// URLs as downloadUrl", () => {
      const input = "MEDIA:http://192.168.1.100:8080/media/snap.png";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].downloadUrl).toBe(
        "http://192.168.1.100:8080/media/snap.png",
      );
    });

    it("preserves URLs with query parameters", () => {
      const input =
        "MEDIA:https://cdn.example.com/img.png?token=abc&size=large";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].downloadUrl).toBe(
        "https://cdn.example.com/img.png?token=abc&size=large",
      );
    });
  });

  // --- data: URL pass-through ---
  describe("data: URLs are passed through unchanged", () => {
    it("preserves data: URLs (base64 images)", () => {
      const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANS";
      const input = `MEDIA:${dataUrl}`;
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].downloadUrl).toBe(dataUrl);
    });
  });

  // --- Local paths → platform.mediaUrl() ---
  describe("local paths are converted via platform.mediaUrl()", () => {
    it("converts absolute local path to media proxy URL", () => {
      const input =
        "MEDIA:/Users/bruce/.openclaw/media/screenshot-2026.png";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      // platform.mediaUrl (web) generates /api/media?path=...
      expect(result.attachments[0].downloadUrl).toContain("/api/media");
      expect(result.attachments[0].downloadUrl).toContain(
        "path=%2FUsers%2Fbruce%2F.openclaw%2Fmedia%2Fscreenshot-2026.png",
      );
    });

    it("converts ~ home-relative path to media proxy URL", () => {
      const input = "MEDIA:~/.openclaw/media/photo.jpg";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].downloadUrl).toContain("/api/media");
      // URLSearchParams encodes ~ as %7E
      expect(result.attachments[0].downloadUrl).toContain(
        "%7E%2F.openclaw%2Fmedia%2Fphoto.jpg",
      );
    });

    it("correctly identifies image MIME type for local file", () => {
      const input = "MEDIA:/tmp/agent-upload/diagram.png";
      const result = extractMediaAttachments(input);

      expect(result.attachments[0].mimeType).toBe("image/png");
      expect(result.attachments[0].dataUrl).toBeDefined();
    });

    it("correctly identifies non-image MIME type for local file", () => {
      const input = "MEDIA:/tmp/report.pdf";
      const result = extractMediaAttachments(input);

      expect(result.attachments[0].mimeType).toBe("application/pdf");
      expect(result.attachments[0].dataUrl).toBeUndefined();
    });
  });

  // --- Multiple MEDIA: lines ---
  describe("multiple MEDIA: lines in single message", () => {
    it("extracts all attachments from mixed sources", () => {
      const input = [
        "Here are the images:",
        "MEDIA:https://example.com/remote.jpg",
        "MEDIA:/Users/bruce/Desktop/local.png",
        "MEDIA:data:image/gif;base64,R0lGODlh",
        "End of message",
      ].join("\n");
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(3);
      // Remote: pass-through
      expect(result.attachments[0].downloadUrl).toBe(
        "https://example.com/remote.jpg",
      );
      // Local: proxied
      expect(result.attachments[1].downloadUrl).toContain("/api/media");
      // data: pass-through
      expect(result.attachments[2].downloadUrl).toMatch(/^data:/);
    });

    it("cleaned text removes all MEDIA: lines", () => {
      const input = [
        "First line",
        "MEDIA:https://example.com/a.jpg",
        "MEDIA:/tmp/b.png",
        "Last line",
      ].join("\n");
      const result = extractMediaAttachments(input);

      expect(result.cleanedText).toBe("First line\n\nLast line");
    });
  });

  // --- Edge cases ---
  describe("edge cases", () => {
    it("handles MEDIA: with extra whitespace around path", () => {
      const input = "MEDIA:  /tmp/spaced.png  ";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].fileName).toBe("spaced.png");
    });

    it("handles paths with spaces in filename", () => {
      const input = "MEDIA:/Users/bruce/My Photos/vacation pic.jpg";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].fileName).toBe("vacation pic.jpg");
      expect(result.attachments[0].downloadUrl).toContain("/api/media");
    });

    it("handles text with no MEDIA: lines", () => {
      const input = "Just a normal message with no attachments";
      const result = extractMediaAttachments(input);

      expect(result.attachments).toHaveLength(0);
      expect(result.cleanedText).toBe(input);
    });

    it("handles empty text", () => {
      const result = extractMediaAttachments("");
      expect(result.attachments).toHaveLength(0);
      expect(result.cleanedText).toBe("");
    });

    it("handles MEDIA: with various image extensions", () => {
      const extensions = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
      for (const ext of extensions) {
        const input = `MEDIA:/tmp/test.${ext}`;
        const result = extractMediaAttachments(input);
        expect(result.attachments[0].mimeType).toMatch(/^image\//);
        expect(result.attachments[0].dataUrl).toBeDefined();
      }
    });

    it("MEDIA: must be at start of line (not mid-line)", () => {
      const input = "some text MEDIA:/tmp/test.png more text";
      const result = extractMediaAttachments(input);

      // The regex uses ^ anchor with multiline flag, so mid-line should NOT match
      expect(result.attachments).toHaveLength(0);
    });
  });

  // --- Cross-device path scenario (the core issue) ---
  describe("cross-device image path scenarios", () => {
    it("external device HTTP gateway URL is preserved", () => {
      // When an external device sends an image through the gateway,
      // the URL should be an HTTP reference to the gateway
      const gatewayUrl =
        "https://gateway.local:9666/api/media?path=%2Ftmp%2Fnode-upload%2Fphoto.jpg";
      const input = `MEDIA:${gatewayUrl}`;
      const result = extractMediaAttachments(input);

      expect(result.attachments[0].downloadUrl).toBe(gatewayUrl);
    });

    it("node-uploaded file path is served via local media proxy", () => {
      // When an external device uploads a file that gets saved to the
      // Mac Studio's /tmp or ~/.openclaw, we reference it via local proxy
      const input = "MEDIA:/tmp/node-uploads/macbook-screenshot.png";
      const result = extractMediaAttachments(input);

      expect(result.attachments[0].downloadUrl).toContain("/api/media");
      expect(result.attachments[0].downloadUrl).toContain(
        encodeURIComponent("/tmp/node-uploads/macbook-screenshot.png"),
      );
    });

    it("treats platform.mediaUrl result as a valid proxy URL", () => {
      const localPath = "/Users/brucechoe/.openclaw/media/node-img.jpg";
      const proxyUrl = platform.mediaUrl(localPath);

      // The proxy URL should be a relative /api/media path
      expect(proxyUrl).toMatch(/^\/api\/media\?/);
      expect(proxyUrl).toContain("path=");
    });
  });
});
