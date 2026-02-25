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
};
