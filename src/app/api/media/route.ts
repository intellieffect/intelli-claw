import { NextRequest, NextResponse } from "next/server";
import { readFile, stat, open } from "fs/promises";
import { extname, basename } from "path";
import { getMimeTypeByDotExt } from "@/lib/mime-types";

/** MIME types that should be displayed inline (not download) */
const INLINE_TYPES = new Set([
  "image/", "video/", "audio/", "application/pdf", "text/",
]);

function shouldInline(mime: string): boolean {
  return Array.from(INLINE_TYPES).some((prefix) => mime.startsWith(prefix));
}

const MAX_SIZE = 100 * 1024 * 1024; // 100MB

function validatePath(path: string | null): { error: string; status: number } | null {
  if (!path) return { error: "Missing path parameter", status: 400 };
  if (path.includes("..") || path.includes("~")) return { error: "Invalid path", status: 403 };
  return null;
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  const pathError = validatePath(path);
  if (pathError) return NextResponse.json({ error: pathError.error }, { status: pathError.status });
  const resolved = path!;

  // Check if this is an info request
  const infoOnly = req.nextUrl.searchParams.get("info") === "1";

  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      return NextResponse.json({ error: "Not a file" }, { status: 404 });
    }

    const ext = extname(resolved).toLowerCase();
    const mime = getMimeTypeByDotExt(ext);
    const fileName = basename(resolved);

    // Info-only mode: return metadata without file content
    if (infoOnly) {
      return NextResponse.json({
        fileName,
        size: info.size,
        mimeType: mime,
        extension: ext,
        modifiedAt: info.mtime.toISOString(),
      });
    }

    if (info.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }

    const forceDownload = req.nextUrl.searchParams.get("dl") === "1";
    const disposition = (!forceDownload && shouldInline(mime))
      ? `inline; filename="${encodeURIComponent(fileName)}"`
      : `attachment; filename="${encodeURIComponent(fileName)}"`;

    // Range request support for audio/video seeking
    const rangeHeader = req.headers.get("range");
    if (rangeHeader && (mime.startsWith("video/") || mime.startsWith("audio/"))) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : info.size - 1;
        const chunkSize = end - start + 1;

        const fd = await open(resolved, "r");
        const buf = Buffer.alloc(chunkSize);
        await fd.read(buf, 0, chunkSize, start);
        await fd.close();

        return new NextResponse(buf, {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${end}/${info.size}`,
            "Accept-Ranges": "bytes",
            "Content-Disposition": disposition,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    }

    const data = await readFile(resolved);

    return new NextResponse(data, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "Content-Disposition": disposition,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
