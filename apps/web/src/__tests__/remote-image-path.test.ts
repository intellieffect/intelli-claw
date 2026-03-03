/**
 * remote-image-path.test.ts — #114 외부 기기에서 전송한 이미지의 맥스튜디오 저장 경로 검증
 */
import { describe, it, expect } from "vitest";

function validateMediaPath(path: string): { valid: boolean; reason?: string } {
  if (!path || typeof path !== "string") return { valid: false, reason: "empty path" };
  if (path.startsWith("data:")) return { valid: true };
  if (path.startsWith("http://") || path.startsWith("https://")) return { valid: true };
  if (path.startsWith("/") && !path.includes("/openclaw/") && !path.includes("/media/")) {
    return { valid: false, reason: "absolute path may not be accessible from remote device" };
  }
  return { valid: true };
}

function resolveMediaUrl(path: string, apiBase: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) return path;
  if (path.startsWith("/")) return `${apiBase}/api/media?path=${encodeURIComponent(path)}`;
  return `${apiBase}/api/media?path=${encodeURIComponent(path)}`;
}

function sanitizeAttachmentPath(rawPath: string): string {
  let sanitized = rawPath.replace(/[\x00-\x1f]/g, "");
  sanitized = sanitized.replace(/\.\.\//g, "");
  sanitized = sanitized.replace(/\.\.\\/g, "");
  return sanitized.trim();
}

describe("#114 — media path validation", () => {
  it("validates data: URLs as valid", () => {
    expect(validateMediaPath("data:image/png;base64,abc123")).toEqual({ valid: true });
  });
  it("validates HTTP URLs as valid", () => {
    expect(validateMediaPath("https://example.com/image.png")).toEqual({ valid: true });
  });
  it("rejects empty path", () => {
    expect(validateMediaPath("")).toEqual({ valid: false, reason: "empty path" });
  });
  it("flags absolute paths that may not be accessible remotely", () => {
    const result = validateMediaPath("/Users/bruce/Desktop/screenshot.png");
    expect(result.valid).toBe(false);
  });
  it("accepts gateway media paths", () => {
    expect(validateMediaPath("/path/to/openclaw/media/img.png")).toEqual({ valid: true });
  });
  it("accepts relative paths", () => {
    expect(validateMediaPath("inbound-images/photo.jpg")).toEqual({ valid: true });
  });
});

describe("#114 — media URL resolution", () => {
  const apiBase = "http://localhost:4001";
  it("passes through http(s) URLs", () => {
    expect(resolveMediaUrl("https://example.com/img.png", apiBase)).toBe("https://example.com/img.png");
  });
  it("passes through data: URLs", () => {
    expect(resolveMediaUrl("data:image/png;base64,abc", apiBase)).toBe("data:image/png;base64,abc");
  });
  it("converts absolute path to API URL", () => {
    expect(resolveMediaUrl("/var/openclaw/media/photo.jpg", apiBase)).toBe(
      "http://localhost:4001/api/media?path=%2Fvar%2Fopenclaw%2Fmedia%2Fphoto.jpg"
    );
  });
  it("converts relative path to API URL", () => {
    expect(resolveMediaUrl("inbound/photo.jpg", apiBase)).toBe(
      "http://localhost:4001/api/media?path=inbound%2Fphoto.jpg"
    );
  });
  it("returns empty string for empty path", () => {
    expect(resolveMediaUrl("", apiBase)).toBe("");
  });
});

describe("#114 — attachment path sanitization", () => {
  it("removes null bytes", () => {
    expect(sanitizeAttachmentPath("photo\x00.jpg")).toBe("photo.jpg");
  });
  it("prevents directory traversal", () => {
    expect(sanitizeAttachmentPath("../../etc/passwd")).toBe("etc/passwd");
  });
  it("trims whitespace", () => {
    expect(sanitizeAttachmentPath("  photo.jpg  ")).toBe("photo.jpg");
  });
  it("preserves normal paths", () => {
    expect(sanitizeAttachmentPath("media/inbound/photo.jpg")).toBe("media/inbound/photo.jpg");
  });
});
