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
import { readFile, stat, open, readdir, mkdir, writeFile } from "node:fs/promises";
import { extname, basename, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

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

/** Allowed base directories for media file access (#106 security fix) */
const ALLOWED_MEDIA_ROOTS = [
  join(homedir(), ".openclaw"),
  join(homedir(), "Downloads"),
  join(homedir(), "Documents"),
  join(homedir(), "Pictures"),
  join(homedir(), "Desktop"),
  // Allow /tmp for transient agent files
  "/tmp",
];

function validatePath(p: string | null): string | null {
  if (!p) return null;
  if (p.includes("..")) return null;
  // Expand ~ to home directory so agents can reference ~/path/to/file
  let resolved: string;
  if (p.startsWith("~/") || p === "~") {
    resolved = resolve(join(homedir(), p.slice(1)));
  } else if (isAbsolute(p)) {
    resolved = resolve(p);
  } else {
    return null; // reject relative paths without ~
  }
  // Security: only allow files under approved directories (#106)
  const allowed = ALLOWED_MEDIA_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + "/"),
  );
  if (!allowed) return null;
  return resolved;
}

// ---- Media upload handler (#110) ----

const UPLOAD_DIR = join(homedir(), ".openclaw", "media", "uploads");
const MAX_UPLOAD_B64 = 10 * 1024 * 1024; // 10 MB base64 limit
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp",
  "image/tiff": "tiff",
};

async function handleMediaUpload(req: http.IncomingMessage, res: http.ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const data = body.data as string | undefined;
  const mimeType = body.mimeType as string | undefined;
  const fileName = body.fileName as string | undefined;

  if (!data || typeof data !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'data' (base64 string)" }));
    return;
  }

  if (!mimeType || typeof mimeType !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'mimeType'" }));
    return;
  }

  if (!mimeType.startsWith("image/")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Only image types are accepted" }));
    return;
  }

  if (data.length > MAX_UPLOAD_B64) {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Data too large (max 10MB base64)" }));
    return;
  }

  const ext = MIME_TO_EXT[mimeType] || mimeType.split("/")[1] || "bin";
  const uuid = randomUUID();
  const outName = fileName
    ? `${uuid}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`
    : `${uuid}.${ext}`;
  const outPath = join(UPLOAD_DIR, outName);

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const buffer = Buffer.from(data, "base64");
    await writeFile(outPath, buffer);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ path: outPath }));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to save file" }));
  }
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (path === "/api/media/upload" && req.method === "POST") {
      await handleMediaUpload(req, res);
    } else if (path === "/api/media") {
      await handleMedia(req, res, url);
    } else if (path === "/api/showcase") {
      await handleShowcaseList(req, res);
    } else if (path.startsWith("/api/showcase/")) {
      const relPath = decodeURIComponent(path.slice("/api/showcase/".length));
      await handleShowcaseServe(req, res, relPath);
    } else if (path.startsWith("/api/session-history/")) {
      const agentId = decodeURIComponent(path.slice("/api/session-history/".length).split("/")[0]);
      if (!agentId || agentId.includes("..")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid agentId" }));
      } else {
        await handleSessionHistory(req, res, agentId, url);
      }
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
  const host = process.env.API_HOST || "127.0.0.1";
  const server = http.createServer(createHandler());
  server.listen(port, host, () => {
    console.log(`[api-server] listening on ${host}:${port}`);
  });
}

// ---- Session History handler ----
// Returns parsed messages from OpenClaw session JSONL logs.
// GET /api/session-history/:agentId
//   ?sessionId=xxx  — specific session
//   (no sessionId)  — list all sessions with metadata

const OPENCLAW_DIR = join(homedir(), ".openclaw");

interface SessionMeta {
  sessionId: string;
  startedAt: string;
  messageCount: number;
}

interface ParsedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  attachments?: Array<{ type: string; url?: string }>;
}

function parseJsonlMessages(lines: string[]): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  for (const line of lines) {
    try {
      const d = JSON.parse(line);
      if (d.type !== "message") continue;
      const msg = d.message || d;
      const role = msg.role;
      if (role !== "user" && role !== "assistant") continue;

      let content = "";
      const rawContent = msg.content;
      if (typeof rawContent === "string") {
        content = rawContent;
      } else if (Array.isArray(rawContent)) {
        content = rawContent
          .filter((p: any) => p.type === "text" && typeof p.text === "string")
          .map((p: any) => p.text)
          .join("");
      }

      if (!content.trim()) continue;

      messages.push({
        id: d.id || `log-${d.timestamp || Date.now()}`,
        role,
        content,
        timestamp: d.timestamp || new Date().toISOString(),
      });
    } catch {
      // skip malformed lines
    }
  }
  return messages;
}

async function handleSessionHistory(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string,
  url: URL,
) {
  const sessionsDir = join(OPENCLAW_DIR, "agents", agentId, "sessions");
  const requestedSessionId = url.searchParams.get("sessionId");

  try {
    if (requestedSessionId) {
      // Return messages for a specific session
      const filePath = join(sessionsDir, `${requestedSessionId}.jsonl`);
      const resolved = resolve(filePath);
      if (!resolved.startsWith(resolve(sessionsDir))) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }

      const data = await readFile(filePath, "utf-8");
      const lines = data.split("\n").filter(Boolean);
      const messages = parseJsonlMessages(lines);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: requestedSessionId, messages }));
    } else {
      // List all sessions with metadata
      const files = await readdir(sessionsDir);
      const sessions: SessionMeta[] = [];
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const sessionId = file.replace(".jsonl", "");
        const filePath = join(sessionsDir, file);
        const data = await readFile(filePath, "utf-8");
        const lines = data.split("\n").filter(Boolean);
        let startedAt = "";
        let messageCount = 0;
        for (const line of lines) {
          try {
            const d = JSON.parse(line);
            if (d.type === "session" && d.timestamp) startedAt = d.timestamp;
            if (d.type === "message") {
              const role = d.message?.role || d.role;
              if (role === "user" || role === "assistant") messageCount++;
            }
          } catch { /* skip */ }
        }
        sessions.push({ sessionId, startedAt, messageCount });
      }
      sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions }));
    }
  } catch (e: any) {
    if (e.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
}
