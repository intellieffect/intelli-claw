import type { PlatformAPI, MediaInfo, ShowcaseFileEntry } from "./types";

export const webPlatform: PlatformAPI = {
  mediaUrl(filePath, opts) {
    const params = new URLSearchParams({ path: filePath });
    if (opts?.dl) params.set("dl", "1");
    if (opts?.info) params.set("info", "1");
    return `/api/media?${params}`;
  },

  async mediaGetInfo(filePath): Promise<MediaInfo> {
    const res = await fetch(`/api/media?path=${encodeURIComponent(filePath)}&info=1`);
    if (!res.ok) throw new Error("Failed to fetch media info");
    return res.json();
  },

  async showcaseList(): Promise<{ files: ShowcaseFileEntry[] }> {
    const res = await fetch("/api/showcase");
    if (!res.ok) throw new Error("Failed to fetch showcase list");
    return res.json();
  },

  showcaseUrl(relativePath) {
    return `/api/showcase/${encodeURIComponent(relativePath)}`;
  },

  async mediaUpload(data, mimeType, fileName) {
    const res = await fetch("/api/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, mimeType, fileName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || "Upload failed");
    }
    return res.json();
  },
};
