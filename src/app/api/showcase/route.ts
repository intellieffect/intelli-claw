import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const SHOWCASE_DIR =
  process.env.SHOWCASE_DIR ||
  path.join(os.homedir(), ".openclaw/workspace-iponoff/drafts");

export async function GET() {
  try {
    const files = await walkHtml(SHOWCASE_DIR, SHOWCASE_DIR);
    return NextResponse.json({ files });
  } catch (e: any) {
    return NextResponse.json({ files: [], error: e.message }, { status: 500 });
  }
}

interface FileEntry {
  name: string;
  relativePath: string;
  size: number;
  modified: string;
  meta: Record<string, string>;
}

const META_RE = /<meta\s+name="showcase:(\w+)"\s+content="([^"]*)"[^>]*>/gi;

async function parseMeta(filePath: string): Promise<Record<string, string>> {
  const meta: Record<string, string> = {};
  try {
    const head = await fs.readFile(filePath, "utf-8");
    // Only scan first 2KB
    const snippet = head.slice(0, 2048);
    let m: RegExpExecArray | null;
    while ((m = META_RE.exec(snippet)) !== null) {
      meta[m[1]] = m[2];
    }
    META_RE.lastIndex = 0;
  } catch {}
  return meta;
}

async function walkHtml(dir: string, root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  let items: string[];
  try {
    items = await fs.readdir(dir);
  } catch {
    return entries;
  }
  for (const item of items) {
    if (item === "index.html") continue;
    const full = path.join(dir, item);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      entries.push(...(await walkHtml(full, root)));
    } else if (item.endsWith(".html")) {
      const meta = await parseMeta(full);
      entries.push({
        name: item,
        relativePath: path.relative(root, full),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        meta,
      });
    }
  }
  return entries.sort(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()
  );
}
