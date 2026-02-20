import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const SHOWCASE_DIR =
  process.env.SHOWCASE_DIR ||
  path.join(os.homedir(), ".openclaw/workspace-iponoff/drafts");

const MIME: Record<string, string> = {
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;
  const relPath = segments.join("/");

  // Security: block traversal
  if (relPath.includes("..") || path.isAbsolute(relPath)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const filePath = path.join(SHOWCASE_DIR, relPath);

  // Ensure resolved path is still within SHOWCASE_DIR
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(SHOWCASE_DIR))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    return NextResponse.json({ error: "unsupported type" }, { status: 400 });
  }

  try {
    const data = await fs.readFile(filePath);
    return new NextResponse(data, {
      headers: { "Content-Type": mime },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
