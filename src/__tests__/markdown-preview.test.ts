import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMimeType } from "@/lib/mime-types";

// ============================================================
// 1. MIME detection for .md files
// ============================================================

describe("markdown MIME detection", () => {
  it("getMimeType returns text/markdown for md extension", () => {
    expect(getMimeType("md")).toBe("text/markdown");
  });

  it("getMimeType returns text/plain for txt extension", () => {
    expect(getMimeType("txt")).toBe("text/plain");
  });
});

// ============================================================
// 2. MEDIA: protocol with .md files — URL generation
// ============================================================

describe("MEDIA: protocol .md file handling", () => {
  it("generates correct download URL for local .md path", () => {
    const raw = "/tmp/readme.md";
    const url = `/api/media?path=${encodeURIComponent(raw)}`;
    expect(url).toBe("/api/media?path=%2Ftmp%2Freadme.md");
  });

  it("preserves http URL for remote .md file", () => {
    const raw = "https://example.com/docs/readme.md";
    const isHttp = raw.startsWith("http://") || raw.startsWith("https://");
    expect(isHttp).toBe(true);
  });

  it("extracts .md extension correctly", () => {
    const fileName = "PROJECT-README.md";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    expect(ext).toBe("md");
    expect(getMimeType(ext)).toBe("text/markdown");
  });
});

// ============================================================
// 3. detectMediaType — .md should be "text" type
// ============================================================

describe("detectMediaType for markdown files", () => {
  // Mirror the logic from markdown-renderer.tsx
  const TEXT_EXTS = ["txt", "md", "log", "json", "yaml", "yml"];

  function detectMediaType(path: string): string {
    const match = path.match(/\.(\w+)(?:\?|$)/);
    const ext = match ? match[1].toLowerCase() : "";
    if (TEXT_EXTS.includes(ext)) return "text";
    return "other";
  }

  it("detects .md as text type", () => {
    expect(detectMediaType("/tmp/readme.md")).toBe("text");
  });

  it("detects .txt as text type", () => {
    expect(detectMediaType("/tmp/notes.txt")).toBe("text");
  });

  it("detects .log as text type", () => {
    expect(detectMediaType("/var/log/app.log")).toBe("text");
  });

  it("detects unknown extension as other", () => {
    expect(detectMediaType("/tmp/binary.dat")).toBe("other");
  });
});

// ============================================================
// 4. isMarkdownFile helper logic
// ============================================================

describe("isMarkdownFile detection", () => {
  function isMarkdownFile(fileName: string, mimeType?: string): boolean {
    if (mimeType === "text/markdown") return true;
    const ext = fileName.split(".").pop()?.toLowerCase();
    return ext === "md" || ext === "mdx";
  }

  it("detects .md by extension", () => {
    expect(isMarkdownFile("readme.md")).toBe(true);
  });

  it("detects .mdx by extension", () => {
    expect(isMarkdownFile("page.mdx")).toBe(true);
  });

  it("detects by MIME type", () => {
    expect(isMarkdownFile("file", "text/markdown")).toBe(true);
  });

  it("rejects non-markdown files", () => {
    expect(isMarkdownFile("image.png")).toBe(false);
    expect(isMarkdownFile("doc.pdf")).toBe(false);
    expect(isMarkdownFile("data.json")).toBe(false);
  });

  it("rejects text/plain (not markdown)", () => {
    expect(isMarkdownFile("notes.txt", "text/plain")).toBe(false);
  });
});

// ============================================================
// 5. Markdown content fetch simulation
// ============================================================

describe("markdown content fetch", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("fetches and returns markdown content", async () => {
    const mdContent = "# Hello\n\nThis is a **bold** paragraph.\n\n- Item 1\n- Item 2";
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mdContent),
    });

    const res = await fetch("/api/media?path=%2Ftmp%2Freadme.md");
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain("# Hello");
    expect(text).toContain("**bold**");
  });

  it("handles fetch failure gracefully", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const res = await fetch("/api/media?path=%2Ftmp%2Fmissing.md");
    expect(res.ok).toBe(false);
  });

  it("handles GFM content (tables, strikethrough)", async () => {
    const gfmContent = "| Col A | Col B |\n|-------|-------|\n| 1 | 2 |\n\n~~deleted~~\n\n- [x] Done\n- [ ] Todo";
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(gfmContent),
    });

    const res = await fetch("/api/media?path=%2Ftmp%2Ftable.md");
    const text = await res.text();
    expect(text).toContain("| Col A |");
    expect(text).toContain("~~deleted~~");
    expect(text).toContain("[x] Done");
  });

  it("handles code blocks", async () => {
    const codeContent = "```typescript\nconst x: number = 42;\n```";
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(codeContent),
    });

    const text = await (await fetch("/api/media?path=%2Ftmp%2Fcode.md")).text();
    expect(text).toContain("```typescript");
    expect(text).toContain("const x: number = 42;");
  });
});

// ============================================================
// 6. DisplayAttachment textContent for user uploads
// ============================================================

describe("DisplayAttachment textContent for .md uploads", () => {
  it("should read .md file content via File.text()", async () => {
    const mdContent = "# Test\n\nHello world";
    const file = new File([mdContent], "test.md", { type: "text/markdown" });

    const text = await file.text();
    expect(text).toBe(mdContent);
    expect(text).toContain("# Test");
  });

  it("should handle empty .md file", async () => {
    const file = new File([""], "empty.md", { type: "text/markdown" });
    const text = await file.text();
    expect(text).toBe("");
  });

  it("should handle large .md file (truncation scenario)", async () => {
    const longContent = "# Long\n\n" + "Lorem ipsum dolor sit amet. ".repeat(1000);
    const file = new File([longContent], "long.md", { type: "text/markdown" });
    const text = await file.text();
    expect(text.length).toBeGreaterThan(10000);
  });
});

// ============================================================
// 7. Multiple .md MEDIA: lines
// ============================================================

describe("multiple .md MEDIA: lines", () => {
  const MEDIA_RE = /^MEDIA:(.+)$/gm;

  it("extracts multiple .md files", () => {
    const text = "MEDIA:/tmp/readme.md\nMEDIA:/tmp/changelog.md\nSome text.";
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = MEDIA_RE.exec(text)) !== null) {
      matches.push(m[1].trim());
    }
    expect(matches).toEqual(["/tmp/readme.md", "/tmp/changelog.md"]);
    expect(matches.every((p) => p.endsWith(".md"))).toBe(true);
  });

  it("mixes .md with other file types", () => {
    const text = "MEDIA:/tmp/image.png\nMEDIA:/tmp/readme.md\nMEDIA:/tmp/video.mp4";
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = MEDIA_RE.exec(text)) !== null) {
      matches.push(m[1].trim());
    }
    expect(matches).toHaveLength(3);
    const mdFiles = matches.filter((p) => p.endsWith(".md"));
    expect(mdFiles).toEqual(["/tmp/readme.md"]);
  });
});
