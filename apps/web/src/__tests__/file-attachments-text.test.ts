import { describe, it, expect } from "vitest";
import {
  attachmentToPayload,
  type ChatAttachment,
  type AttachmentPayloadResult,
  isTextFile,
  TEXT_INLINE_LIMIT,
} from "@/components/chat/file-attachments";

/**
 * #157: Text file attachment handling tests (TDD)
 *
 * Text files (CSV, TXT, JSON, MD, etc.) should:
 * 1. Be identified by isTextFile()
 * 2. Have content extracted and returned as prependText (inline) for small files
 * 3. Still produce a payload for server upload
 * 4. Truncate content at TEXT_INLINE_LIMIT for very large files
 */

function makeFile(name: string, content: string, type?: string): File {
  return new File([content], name, { type: type || "" });
}

function makeAttachment(
  file: File,
  overrides?: Partial<ChatAttachment>,
): ChatAttachment {
  return {
    id: `test-${Date.now()}`,
    file,
    type: "file",
    ...overrides,
  };
}

// ---- isTextFile ----

describe("isTextFile", () => {
  it.each([
    ["data.csv", true],
    ["notes.txt", true],
    ["config.json", true],
    ["readme.md", true],
    ["changelog.mdx", true],
    ["log.log", true],
    ["data.xml", true],
    ["config.yaml", true],
    ["config.yml", true],
    ["data.tsv", true],
    ["code.py", false],
    ["photo.jpg", false],
    ["archive.zip", false],
    ["document.pdf", false],
    ["app.exe", false],
    ["noext", false],
  ])("isTextFile('%s') → %s", (name, expected) => {
    expect(isTextFile(name)).toBe(expected);
  });
});

// ---- attachmentToPayload for text files ----

describe("attachmentToPayload — text files (#157)", () => {
  it("extracts CSV content as prependText", async () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const att = makeAttachment(makeFile("data.csv", csv, "text/csv"));
    const result = await attachmentToPayload(att);

    expect(result.prependText).toBeDefined();
    expect(result.prependText).toContain("data.csv");
    expect(result.prependText).toContain("name,age");
    expect(result.prependText).toContain("Alice,30");
  });

  it("extracts TXT content as prependText", async () => {
    const txt = "Hello world, this is a text file.";
    const att = makeAttachment(makeFile("notes.txt", txt, "text/plain"));
    const result = await attachmentToPayload(att);

    expect(result.prependText).toBeDefined();
    expect(result.prependText).toContain("notes.txt");
    expect(result.prependText).toContain(txt);
  });

  it("extracts JSON content as prependText", async () => {
    const json = '{"key": "value", "count": 42}';
    const att = makeAttachment(makeFile("config.json", json, "application/json"));
    const result = await attachmentToPayload(att);

    expect(result.prependText).toBeDefined();
    expect(result.prependText).toContain("config.json");
    expect(result.prependText).toContain('"key"');
  });

  it("extracts MD content as prependText", async () => {
    const md = "# Title\n\nSome paragraph.";
    const att = makeAttachment(makeFile("readme.md", md, "text/markdown"));
    const result = await attachmentToPayload(att);

    expect(result.prependText).toBeDefined();
    expect(result.prependText).toContain("readme.md");
    expect(result.prependText).toContain("# Title");
  });

  it("extracts YAML content as prependText", async () => {
    const yaml = "key: value\nlist:\n  - a\n  - b";
    const att = makeAttachment(makeFile("config.yaml", yaml, "text/yaml"));
    const result = await attachmentToPayload(att);

    expect(result.prependText).toBeDefined();
    expect(result.prependText).toContain("config.yaml");
    expect(result.prependText).toContain("key: value");
  });

  it("truncates large text files at TEXT_INLINE_LIMIT", async () => {
    const largeContent = "x".repeat(TEXT_INLINE_LIMIT + 10_000);
    const att = makeAttachment(makeFile("big.csv", largeContent, "text/csv"));
    const result = await attachmentToPayload(att);

    expect(result.prependText).toBeDefined();
    // Should contain truncation indicator
    expect(result.prependText!.length).toBeLessThan(largeContent.length + 500);
    expect(result.prependText).toContain("…truncated");
  });

  it("also produces a payload for server upload", async () => {
    const csv = "col1,col2\n1,2";
    const att = makeAttachment(makeFile("small.csv", csv, "text/csv"));
    const result = await attachmentToPayload(att);

    // Should have a payload for upload
    expect(result.payloads.length).toBe(1);
    expect(result.payloads[0].fileName).toBe("small.csv");
    expect(result.payloads[0].mimeType).toBe("text/csv");
    expect(result.payloads[0].content).toBeTruthy(); // base64
  });

  it("wraps content in code block with file name header", async () => {
    const txt = "line1\nline2";
    const att = makeAttachment(makeFile("test.txt", txt, "text/plain"));
    const result = await attachmentToPayload(att);

    expect(result.prependText).toContain("```");
    expect(result.prependText).toContain("📎");
  });

  it("does NOT inline-extract non-text files (e.g. .exe, .zip)", async () => {
    const att = makeAttachment(
      makeFile("app.exe", "binary-stuff", "application/octet-stream"),
    );
    const result = await attachmentToPayload(att);

    // No text extraction — just raw payload
    expect(result.prependText).toBeUndefined();
    expect(result.payloads.length).toBe(1);
  });

  it("handles Electron filePath hint for text files", async () => {
    const att = makeAttachment(
      makeFile("data.csv", "a,b\n1,2", "text/csv"),
      { filePath: "/Users/test/data.csv" },
    );
    const result = await attachmentToPayload(att);

    // Should include the file path in prependText for agent read access
    expect(result.prependText).toContain("/Users/test/data.csv");
  });

  it("handles empty text files gracefully", async () => {
    const att = makeAttachment(makeFile("empty.txt", "", "text/plain"));
    const result = await attachmentToPayload(att);

    // Should still have a payload (the file exists even if empty)
    expect(result.payloads.length).toBe(1);
    // prependText can be undefined or contain just the header
    // No crash is the main assertion
  });
});
