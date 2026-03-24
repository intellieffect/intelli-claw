import { dialog, net } from "electron";
import { readFile, stat, open, mkdir, writeFile, copyFile } from "node:fs/promises";
import { extname, basename, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const MIME_MAP: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  tiff: "image/tiff", tif: "image/tiff",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  avi: "video/x-msvideo", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
  aac: "audio/aac", m4a: "audio/mp4", wma: "audio/x-ms-wma",
  pdf: "application/pdf",
  txt: "text/plain", csv: "text/csv", json: "application/json",
  html: "text/html", css: "text/css", js: "text/javascript",
  md: "text/markdown", zip: "application/zip",
};

function getMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace(/^\./, "");
  return MIME_MAP[ext] || "application/octet-stream";
}

const MAX_SIZE = 100 * 1024 * 1024;

export async function handleMediaInfo(filePath: string) {
  if (!filePath || filePath.includes("..") || filePath.includes("~")) {
    throw new Error("Invalid path");
  }
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Not a file");

  return {
    fileName: basename(filePath),
    size: info.size,
    mimeType: getMime(filePath),
    extension: extname(filePath).toLowerCase(),
    modifiedAt: info.mtime.toISOString(),
  };
}

export async function handleMediaServe(filePath: string): Promise<{ data: Buffer; mime: string; fileName: string }> {
  if (!filePath || filePath.includes("..") || filePath.includes("~")) {
    throw new Error("Invalid path");
  }
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Not a file");
  if (info.size > MAX_SIZE) throw new Error("File too large");

  const data = await readFile(filePath);
  return {
    data,
    mime: getMime(filePath),
    fileName: basename(filePath),
  };
}

export async function handleMediaRange(
  filePath: string,
  start: number,
  end: number,
): Promise<{ data: Buffer; mime: string; start: number; end: number; total: number }> {
  if (!filePath || filePath.includes("..") || filePath.includes("~")) {
    throw new Error("Invalid path");
  }
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Not a file");

  const actualEnd = end || info.size - 1;
  const chunkSize = actualEnd - start + 1;

  const fd = await open(filePath, "r");
  const buf = Buffer.alloc(chunkSize);
  await fd.read(buf, 0, chunkSize, start);
  await fd.close();

  return {
    data: buf,
    mime: getMime(filePath),
    start,
    end: actualEnd,
    total: info.size,
  };
}

// ---- #157: File upload (same as server api-server.ts upload handler) ----

const UPLOAD_DIR = join(homedir(), ".openclaw", "media", "uploads");

const UPLOAD_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp",
  "text/plain": "txt", "text/csv": "csv", "text/markdown": "md",
  "text/xml": "xml", "text/yaml": "yaml", "text/html": "html",
  "text/tab-separated-values": "tsv",
  "application/json": "json", "application/xml": "xml",
  "application/pdf": "pdf",
};

export async function handleMediaUpload(
  data: string,
  mimeType: string,
  fileName?: string,
): Promise<{ path: string }> {
  const ext = UPLOAD_MIME_TO_EXT[mimeType] || mimeType.split("/")[1] || "bin";
  const uuid = randomUUID();
  const outName = fileName
    ? `${uuid}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`
    : `${uuid}.${ext}`;
  const outPath = join(UPLOAD_DIR, outName);

  await mkdir(UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(data, "base64");
  await writeFile(outPath, buffer);

  return { path: outPath };
}

export async function handleMediaDownload(input: {
  url?: string;
  dataUrl?: string;
  fileName: string;
  mimeType?: string;
}): Promise<{ saved: boolean; canceled?: boolean; path?: string; error?: string }> {
  const source = input.url || input.dataUrl;
  if (!source) {
    return { saved: false, error: "No download source" };
  }

  // Build file type filters from mimeType for better UX
  const filters: Electron.FileFilter[] = [];
  if (input.mimeType) {
    const ext = input.fileName.split(".").pop()?.toLowerCase();
    if (ext) {
      const mimeLabel: Record<string, string> = {
        "application/pdf": "PDF",
        "image/jpeg": "Images", "image/png": "Images", "image/gif": "Images", "image/webp": "Images",
        "video/mp4": "Videos", "video/webm": "Videos", "video/quicktime": "Videos",
        "audio/mpeg": "Audio", "audio/wav": "Audio", "audio/ogg": "Audio",
      };
      const label = mimeLabel[input.mimeType] || ext.toUpperCase();
      filters.push({ name: label, extensions: [ext] });
    }
    filters.push({ name: "All Files", extensions: ["*"] });
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: input.fileName,
    filters: filters.length > 0 ? filters : undefined,
  });

  if (canceled || !filePath) {
    return { saved: false, canceled: true };
  }

  try {
    if (source.startsWith("data:")) {
      const comma = source.indexOf(",");
      if (comma < 0) throw new Error("Invalid data URL");
      const base64 = source.slice(comma + 1);
      await writeFile(filePath, Buffer.from(base64, "base64"));
      return { saved: true, path: filePath };
    }

    if (source.startsWith("/")) {
      try {
        await stat(source);
      } catch {
        return { saved: false, error: `파일을 찾을 수 없습니다: ${basename(source)}` };
      }
      await copyFile(source, filePath);
      return { saved: true, path: filePath };
    }

    const res = await net.fetch(source);
    if (!res.ok) {
      return { saved: false, error: `Download failed: ${res.status} ${res.statusText}` };
    }
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length === 0) {
      return { saved: false, error: "Empty file" };
    }
    await writeFile(filePath, buf);
    return { saved: true, path: filePath };
  } catch (err) {
    return { saved: false, error: err instanceof Error ? err.message : String(err) };
  }
}
