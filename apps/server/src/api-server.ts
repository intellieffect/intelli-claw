/**
 * Lightweight API server for web builds.
 * Extracts logic from the former Next.js API routes:
 *   - GET /api/media?path=...&info=1&dl=1  (file serving with range support)
 *   - GET /api/showcase                      (list showcase HTML files)
 *   - GET /api/showcase/:path*               (serve showcase files)
 *
 * Run standalone: npx tsx src/server/api-server.ts
 * Or import createHandler for programmatic use.
 */
import http from "node:http";
import { readFile, stat, open, readdir } from "node:fs/promises";
import { extname, basename, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";

// ---- MIME helpers ----

const MIME_MAP: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  tiff: "image/tiff", tif: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  avi: "video/x-msvideo", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
  aac: "audio/aac", m4a: "audio/mp4", wma: "audio/x-ms-wma",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", json: "application/json",
  xml: "application/xml", html: "text/html", css: "text/css",
  js: "text/javascript", ts: "text/typescript", md: "text/markdown",
  yaml: "text/yaml", yml: "text/yaml", py: "text/x-python",
  rs: "text/x-rust", go: "text/x-go", java: "text/x-java",
  c: "text/x-c", cpp: "text/x-c++", h: "text/x-c",
  sh: "text/x-shellscript", sql: "text/x-sql", log: "text/plain",
  zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
  "7z": "application/x-7z-compressed", rar: "application/vnd.rar",
};

function getMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace(/^\./, "");
  return MIME_MAP[ext] || "application/octet-stream";
}

const INLINE_PREFIXES = ["image/", "video/", "audio/", "application/pdf", "text/"];
function shouldInline(mime: string) {
  return INLINE_PREFIXES.some((p) => mime.startsWith(p));
}

// ---- Media handler ----

const MAX_SIZE = 100 * 1024 * 1024;

function validatePath(p: string | null): string | null {
  if (!p) return null;
  if (p.includes("..") || p.includes("~")) return null;
  return p;
}

async function handleMedia(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const rawPath = url.searchParams.get("path");
  const filePath = validatePath(rawPath);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing or invalid path parameter" }));
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not a file" }));
      return;
    }

    const mime = getMime(filePath);
    const fileName = basename(filePath);

    // Info-only mode
    if (url.searchParams.get("info") === "1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        fileName,
        size: info.size,
        mimeType: mime,
        extension: extname(filePath).toLowerCase(),
        modifiedAt: info.mtime.toISOString(),
      }));
      return;
    }

    if (info.size > MAX_SIZE) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File too large" }));
      return;
    }

    const forceDownload = url.searchParams.get("dl") === "1";
    const disposition = (!forceDownload && shouldInline(mime))
      ? `inline; filename="${encodeURIComponent(fileName)}"`
      : `attachment; filename="${encodeURIComponent(fileName)}"`;

    // Range support
    const rangeHeader = req.headers.range;
    if (rangeHeader && (mime.startsWith("video/") || mime.startsWith("audio/"))) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : info.size - 1;
        const chunkSize = end - start + 1;

        const fd = await open(filePath, "r");
        const buf = Buffer.alloc(chunkSize);
        await fd.read(buf, 0, chunkSize, start);
        await fd.close();

        res.writeHead(206, {
          "Content-Type": mime,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Content-Disposition": disposition,
          "Cache-Control": "public, max-age=3600",
        });
        res.end(buf);
        return;
      }
    }

    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Content-Disposition": disposition,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "File not found" }));
  }
}

// ---- Showcase handler ----

const SHOWCASE_DIR = process.env.SHOWCASE_DIR || join(homedir(), ".openclaw/showcase");
const SHOWCASE_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const META_RE = /<meta\s+name="showcase:(\w+)"\s+content="([^"]*)"[^>]*>/gi;

interface FileEntry {
  name: string;
  relativePath: string;
  size: number;
  modified: string;
  meta: Record<string, string>;
}

async function parseMeta(filePath: string): Promise<Record<string, string>> {
  const meta: Record<string, string> = {};
  try {
    const head = await readFile(filePath, "utf-8");
    const snippet = head.slice(0, 2048);
    let m: RegExpExecArray | null;
    while ((m = META_RE.exec(snippet)) !== null) meta[m[1]] = m[2];
    META_RE.lastIndex = 0;
  } catch { /* ignore */ }
  return meta;
}

async function walkHtml(dir: string, root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  let items: string[];
  try { items = await readdir(dir); } catch { return entries; }
  for (const item of items) {
    if (item === "index.html") continue;
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) {
      entries.push(...(await walkHtml(full, root)));
    } else if (item.endsWith(".html")) {
      const meta = await parseMeta(full);
      entries.push({
        name: item,
        relativePath: relative(root, full),
        size: s.size,
        modified: s.mtime.toISOString(),
        meta,
      });
    }
  }
  return entries.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
}

async function handleShowcaseList(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const files = await walkHtml(SHOWCASE_DIR, SHOWCASE_DIR);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ files }));
  } catch (e: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ files: [], error: e.message }));
  }
}

async function handleShowcaseServe(_req: http.IncomingMessage, res: http.ServerResponse, relPath: string) {
  if (relPath.includes("..") || isAbsolute(relPath)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "forbidden" }));
    return;
  }

  const filePath = join(SHOWCASE_DIR, relPath);
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(SHOWCASE_DIR))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "forbidden" }));
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const mime = SHOWCASE_MIME[ext];
  if (!mime) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unsupported type" }));
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }
}

// ---- Request router ----

export function createHandler() {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    // CORS for dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (path === "/api/media") {
      await handleMedia(req, res, url);
    } else if (path === "/api/showcase") {
      await handleShowcaseList(req, res);
    } else if (path.startsWith("/api/showcase/")) {
      const relPath = decodeURIComponent(path.slice("/api/showcase/".length));
      await handleShowcaseServe(req, res, relPath);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  };
}

// ---- Standalone mode ----

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  const port = parseInt(process.env.API_PORT || "4001", 10);
  const server = http.createServer(createHandler());
  server.listen(port, () => {
    console.log(`[api-server] listening on :${port}`);
  });
}
