import { readFile, stat, readdir } from "node:fs/promises";
import { join, relative, resolve, extname, isAbsolute } from "node:path";
import { homedir } from "node:os";

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

export async function handleShowcaseList(): Promise<{ files: FileEntry[] }> {
  const files = await walkHtml(SHOWCASE_DIR, SHOWCASE_DIR);
  return { files };
}

export async function handleShowcaseServe(
  relPath: string,
): Promise<{ data: Buffer; mime: string }> {
  if (relPath.includes("..") || isAbsolute(relPath)) {
    throw new Error("forbidden");
  }

  const filePath = join(SHOWCASE_DIR, relPath);
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(SHOWCASE_DIR))) {
    throw new Error("forbidden");
  }

  const ext = extname(filePath).toLowerCase();
  const mime = SHOWCASE_MIME[ext];
  if (!mime) throw new Error("unsupported type");

  const data = await readFile(filePath);
  return { data, mime };
}
