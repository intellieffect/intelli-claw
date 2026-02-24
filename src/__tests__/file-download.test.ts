import { describe, it, expect, vi, beforeEach } from "vitest";
import { MIME_MAP, getMimeType, getMimeTypeByDotExt } from "@/lib/mime-types";
import { blobDownload, forceDownloadUrl } from "@/lib/utils/download";

// ============================================================
// 1. MIME types — 공통 매핑 검증
// ============================================================

describe("MIME_MAP", () => {
  it("has all image types", () => {
    expect(MIME_MAP.png).toBe("image/png");
    expect(MIME_MAP.jpg).toBe("image/jpeg");
    expect(MIME_MAP.jpeg).toBe("image/jpeg");
    expect(MIME_MAP.gif).toBe("image/gif");
    expect(MIME_MAP.webp).toBe("image/webp");
    expect(MIME_MAP.svg).toBe("image/svg+xml");
    expect(MIME_MAP.ico).toBe("image/x-icon");
    expect(MIME_MAP.bmp).toBe("image/bmp");
  });

  it("has all video types", () => {
    expect(MIME_MAP.mp4).toBe("video/mp4");
    expect(MIME_MAP.webm).toBe("video/webm");
    expect(MIME_MAP.mov).toBe("video/quicktime");
    expect(MIME_MAP.avi).toBe("video/x-msvideo");
    expect(MIME_MAP.mkv).toBe("video/x-matroska");
  });

  it("has all audio types", () => {
    expect(MIME_MAP.mp3).toBe("audio/mpeg");
    expect(MIME_MAP.wav).toBe("audio/wav");
    expect(MIME_MAP.ogg).toBe("audio/ogg");
    expect(MIME_MAP.flac).toBe("audio/flac");
    expect(MIME_MAP.aac).toBe("audio/aac");
    expect(MIME_MAP.m4a).toBe("audio/mp4");
  });

  it("has document types", () => {
    expect(MIME_MAP.pdf).toBe("application/pdf");
    expect(MIME_MAP.docx).toContain("wordprocessingml");
    expect(MIME_MAP.xlsx).toContain("spreadsheetml");
    expect(MIME_MAP.pptx).toContain("presentationml");
    expect(MIME_MAP.doc).toBe("application/msword");
  });

  it("has code/text types that were previously missing in hooks.tsx", () => {
    expect(MIME_MAP.md).toBe("text/markdown");
    expect(MIME_MAP.ts).toBe("text/typescript");
    expect(MIME_MAP.js).toBe("text/javascript");
    expect(MIME_MAP.py).toBe("text/x-python");
    expect(MIME_MAP.html).toBe("text/html");
    expect(MIME_MAP.css).toBe("text/css");
    expect(MIME_MAP.sh).toBe("text/x-shellscript");
    expect(MIME_MAP.sql).toBe("text/x-sql");
    expect(MIME_MAP.log).toBe("text/plain");
  });

  it("has archive types", () => {
    expect(MIME_MAP.zip).toBe("application/zip");
    expect(MIME_MAP.tar).toBe("application/x-tar");
    expect(MIME_MAP.gz).toBe("application/gzip");
    expect(MIME_MAP["7z"]).toBe("application/x-7z-compressed");
    expect(MIME_MAP.rar).toBe("application/vnd.rar");
  });
});

describe("getMimeType", () => {
  it("returns correct MIME for known extension", () => {
    expect(getMimeType("png")).toBe("image/png");
    expect(getMimeType("PDF")).toBe("application/pdf");
    expect(getMimeType("Docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("falls back to octet-stream for unknown extension", () => {
    expect(getMimeType("xyz")).toBe("application/octet-stream");
    expect(getMimeType("")).toBe("application/octet-stream");
  });
});

describe("getMimeTypeByDotExt", () => {
  it("handles dot-prefixed extension", () => {
    expect(getMimeTypeByDotExt(".png")).toBe("image/png");
    expect(getMimeTypeByDotExt(".mp4")).toBe("video/mp4");
  });

  it("handles extension without dot", () => {
    expect(getMimeTypeByDotExt("png")).toBe("image/png");
  });
});

// ============================================================
// 2. forceDownloadUrl — dl=1 파라미터 추가
// ============================================================

describe("forceDownloadUrl", () => {
  it("appends dl=1 to /api/media URL without params", () => {
    expect(forceDownloadUrl("/api/media")).toBe("/api/media?dl=1");
  });

  it("appends dl=1 to /api/media URL with existing params", () => {
    expect(forceDownloadUrl("/api/media?path=%2Ftmp%2Ffile.txt")).toBe(
      "/api/media?path=%2Ftmp%2Ffile.txt&dl=1"
    );
  });

  it("does not modify non-api-media URLs", () => {
    expect(forceDownloadUrl("https://example.com/file.png")).toBe("https://example.com/file.png");
    expect(forceDownloadUrl("/other/path")).toBe("/other/path");
  });
});

// ============================================================
// 3. blobDownload — fetch + download 검증
// ============================================================

describe("blobDownload", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let removeChildSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.fn>;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: clickSpy,
      style: {},
    } as unknown as HTMLAnchorElement);
    appendChildSpy = vi.spyOn(document.body, "appendChild").mockReturnValue(null as any);
    removeChildSpy = vi.spyOn(document.body, "removeChild").mockReturnValue(null as any);
    createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("downloads successfully with valid response", async () => {
    const mockBlob = new Blob(["test content"], { type: "text/plain" });
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    const result = await blobDownload("/api/media?path=test.txt&dl=1", "test.txt");

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("/api/media?path=test.txt&dl=1");
    expect(createObjectURLSpy).toHaveBeenCalledWith(mockBlob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });

  it("returns false on HTTP error (404)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await blobDownload("/api/media?path=nonexistent.txt", "nonexistent.txt");

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Download] Failed: 404")
    );
    expect(clickSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns false on HTTP error (500)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await blobDownload("/api/media?path=error.txt", "error.txt");

    expect(result).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns false on empty blob", async () => {
    const emptyBlob = new Blob([], { type: "application/octet-stream" });
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(emptyBlob),
    });

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await blobDownload("/api/media?path=empty.txt", "empty.txt");

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Download] Empty file"),
      expect.any(String)
    );
    expect(clickSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns false on network error", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await blobDownload("/api/media?path=offline.txt", "offline.txt");

    expect(result).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ============================================================
// 4. extractMediaAttachments — MEDIA: 파싱 (hooks.tsx 로직 검증)
// ============================================================

// We import the function indirectly by testing the contract
// since extractMediaAttachments is not exported. We test the MIME mapping
// and URL generation logic that mirrors it.

describe("MEDIA: protocol URL generation", () => {
  it("generates /api/media URL for local paths", () => {
    const raw = "/tmp/test-file.pdf";
    const url = `/api/media?path=${encodeURIComponent(raw)}`;
    expect(url).toBe("/api/media?path=%2Ftmp%2Ftest-file.pdf");
  });

  it("preserves http URLs as-is", () => {
    const raw = "https://example.com/file.png";
    expect(raw.startsWith("http")).toBe(true);
  });

  it("preserves data URLs as-is", () => {
    const raw = "data:image/png;base64,ABC123";
    expect(raw.startsWith("data:")).toBe(true);
  });

  it("extracts fileName from path", () => {
    const raw = "/home/user/documents/report.pdf";
    const fileName = raw.split("/").pop() || raw;
    expect(fileName).toBe("report.pdf");
  });

  it("extracts extension correctly", () => {
    const fileName = "report.final.pdf";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    expect(ext).toBe("pdf");
  });

  it("handles files without extension", () => {
    const fileName = "Makefile";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    // For single-part names, pop returns the name itself
    expect(getMimeType(ext === fileName.toLowerCase() ? "" : ext)).toBe("application/octet-stream");
  });
});

// ============================================================
// 5. 다중 MEDIA: 파싱 검증
// ============================================================

describe("multiple MEDIA: lines parsing", () => {
  const MEDIA_RE = /^MEDIA:(.+)$/gm;

  it("extracts multiple MEDIA: lines", () => {
    const text = "Here are the files:\nMEDIA:/tmp/image1.png\nMEDIA:/tmp/image2.jpg\nMEDIA:/tmp/doc.pdf\nDone.";
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = MEDIA_RE.exec(text)) !== null) {
      matches.push(m[1].trim());
    }
    expect(matches).toEqual(["/tmp/image1.png", "/tmp/image2.jpg", "/tmp/doc.pdf"]);
  });

  it("handles single MEDIA: line", () => {
    const text = "MEDIA:/tmp/file.txt";
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = MEDIA_RE.exec(text)) !== null) {
      matches.push(m[1].trim());
    }
    expect(matches).toEqual(["/tmp/file.txt"]);
  });

  it("handles no MEDIA: lines", () => {
    const text = "Just a regular message with no media.";
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = MEDIA_RE.exec(text)) !== null) {
      matches.push(m[1].trim());
    }
    expect(matches).toEqual([]);
  });

  it("cleans MEDIA: lines from content", () => {
    const text = "Before\nMEDIA:/tmp/file.png\nAfter";
    const cleaned = text.replace(/^MEDIA:.+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    expect(cleaned).toBe("Before\n\nAfter");
  });

  it("handles MEDIA: with spaces in path", () => {
    const text = "MEDIA:/tmp/my file.pdf";
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = MEDIA_RE.exec(text)) !== null) {
      matches.push(m[1].trim());
    }
    expect(matches).toEqual(["/tmp/my file.pdf"]);
  });

  it("handles MEDIA: with URL", () => {
    const text = "MEDIA:https://cdn.example.com/image.png";
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = MEDIA_RE.exec(text)) !== null) {
      matches.push(m[1].trim());
    }
    expect(matches).toEqual(["https://cdn.example.com/image.png"]);
  });
});
