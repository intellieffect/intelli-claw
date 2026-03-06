import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

/**
 * Server-side tests for POST /api/media/upload (#110)
 *
 * Tests the upload endpoint that persists user-sent images as files,
 * so they survive Gateway session compaction.
 */

// --- Helpers ---------------------------------------------------------------

/** Send a POST request with JSON body and return parsed response */
async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode!, data: { raw } });
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// A tiny valid 1x1 red JPEG in base64
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh" +
  "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR" +
  "CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgED" +
  "AwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcY" +
  "GRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJ" +
  "ipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo" +
  "6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgEC" +
  "BAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl" +
  "8RcYI4Q/RFhHRUYnJCk6ODs8PT4/RFdIOUQ6Ojs8PT4/RF/9oADAMBAAIRAxEAPwD3+gD/2Q==";

// --- Test Suite -------------------------------------------------------------

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Dynamic import so we pick up the latest createHandler
  const mod = await import("../../src/api-server.js");
  const handler = mod.createHandler();
  server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
});

describe("POST /api/media/upload", () => {
  it("saves a valid image and returns its path", async () => {
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: TINY_JPEG_B64,
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
    });
    expect(status).toBe(200);
    expect(data.path).toBeDefined();
    expect(typeof data.path).toBe("string");
    expect((data.path as string)).toContain(".openclaw/media/uploads/");
    expect((data.path as string)).toMatch(/\.jpg$/);

    // Verify file actually exists on disk and is valid
    const savedData = await readFile(data.path as string);
    expect(savedData.length).toBeGreaterThan(0);
  });

  it("returns the saved file via GET /api/media", async () => {
    // First upload
    const { data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: TINY_JPEG_B64,
      mimeType: "image/jpeg",
    });
    const filePath = data.path as string;

    // Then retrieve
    const getRes = await new Promise<{ status: number; contentType: string }>((resolve, reject) => {
      http.get(`${baseUrl}/api/media?path=${encodeURIComponent(filePath)}`, (res) => {
        res.resume(); // consume body
        res.on("end", () => resolve({ status: res.statusCode!, contentType: res.headers["content-type"] || "" }));
      }).on("error", reject);
    });
    expect(getRes.status).toBe(200);
    expect(getRes.contentType).toContain("image/jpeg");
  });

  it("rejects disallowed mime types (legacy test — updated for #157)", async () => {
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: btoa("hello world"),
      mimeType: "application/x-executable",
    });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("accepts application/pdf uploads (#157)", async () => {
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: btoa("%PDF-1.4 fake"),
      mimeType: "application/pdf",
      fileName: "doc.pdf",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.pdf$/);
  });

  it("rejects missing data", async () => {
    const { status } = await postJson(`${baseUrl}/api/media/upload`, {
      mimeType: "image/jpeg",
    });
    expect(status).toBe(400);
  });

  it("rejects missing mimeType", async () => {
    const { status } = await postJson(`${baseUrl}/api/media/upload`, {
      data: TINY_JPEG_B64,
    });
    expect(status).toBe(400);
  });

  it("rejects oversized data (> 10MB base64)", async () => {
    // Create a 11MB base64 string
    const bigData = "A".repeat(11 * 1024 * 1024);
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: bigData,
      mimeType: "image/jpeg",
    });
    expect(status).toBe(413);
    expect(data.error).toContain("large");
  });

  it("supports png uploads", async () => {
    // A minimal 1x1 PNG in base64
    const TINY_PNG_B64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: TINY_PNG_B64,
      mimeType: "image/png",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.png$/);
  });

  it("supports webp uploads", async () => {
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: TINY_JPEG_B64, // reuse; content doesn't matter for extension test
      mimeType: "image/webp",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.webp$/);
  });

  // ---- #157: Text file upload support ----

  it("accepts text/csv uploads", async () => {
    const csvContent = Buffer.from("name,age\nAlice,30\nBob,25").toString("base64");
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: csvContent,
      mimeType: "text/csv",
      fileName: "data.csv",
    });
    expect(status).toBe(200);
    expect(data.path).toBeDefined();
    expect((data.path as string)).toMatch(/\.csv$/);
    // Verify file content is correct
    const saved = await readFile(data.path as string, "utf-8");
    expect(saved).toBe("name,age\nAlice,30\nBob,25");
  });

  it("accepts text/plain uploads", async () => {
    const txtContent = Buffer.from("Hello, world!").toString("base64");
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: txtContent,
      mimeType: "text/plain",
      fileName: "notes.txt",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.txt$/);
  });

  it("accepts application/json uploads", async () => {
    const jsonContent = Buffer.from(JSON.stringify({ key: "value" })).toString("base64");
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: jsonContent,
      mimeType: "application/json",
      fileName: "config.json",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.json$/);
  });

  it("accepts text/markdown uploads", async () => {
    const mdContent = Buffer.from("# Title\n\nParagraph").toString("base64");
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: mdContent,
      mimeType: "text/markdown",
      fileName: "readme.md",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.md$/);
  });

  it("accepts text/xml uploads", async () => {
    const xmlContent = Buffer.from("<root><item>1</item></root>").toString("base64");
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: xmlContent,
      mimeType: "text/xml",
      fileName: "data.xml",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.xml$/);
  });

  it("accepts text/yaml uploads", async () => {
    const yamlContent = Buffer.from("key: value\nlist:\n  - a\n  - b").toString("base64");
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: yamlContent,
      mimeType: "text/yaml",
      fileName: "config.yaml",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.yaml$/);
  });

  it("accepts text/tab-separated-values uploads", async () => {
    const tsvContent = Buffer.from("name\tage\nAlice\t30").toString("base64");
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: tsvContent,
      mimeType: "text/tab-separated-values",
      fileName: "data.tsv",
    });
    expect(status).toBe(200);
    expect((data.path as string)).toMatch(/\.tsv$/);
  });

  it("rejects disallowed mime types (e.g. application/x-executable)", async () => {
    const { status, data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: Buffer.from("MZ").toString("base64"),
      mimeType: "application/x-executable",
    });
    expect(status).toBe(400);
    expect(data.error).toBeDefined();
  });

  it("serves uploaded text file via GET /api/media", async () => {
    const csvContent = Buffer.from("col1,col2\n1,2").toString("base64");
    const { data } = await postJson(`${baseUrl}/api/media/upload`, {
      data: csvContent,
      mimeType: "text/csv",
      fileName: "serve-test.csv",
    });
    const filePath = data.path as string;

    const getRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get(`${baseUrl}/api/media?path=${encodeURIComponent(filePath)}`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      }).on("error", reject);
    });
    expect(getRes.status).toBe(200);
    expect(getRes.body).toBe("col1,col2\n1,2");
  });

  it("handles CORS preflight for upload endpoint", async () => {
    const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(`${baseUrl}/api/media/upload`, { method: "OPTIONS" }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });
});
