/**
 * mobilePlatform — PlatformAPI implementation for React Native.
 * Uses Gateway HTTP proxy endpoints for media and showcase access.
 */

import Constants from "expo-constants";
import type { PlatformAPI, MediaInfo, ShowcaseFileEntry } from "@intelli-claw/shared";

function getHttpBaseUrl(): string {
  return (
    Constants.expoConfig?.extra?.gatewayHttpUrl || "http://127.0.0.1:18789"
  );
}

export const mobilePlatform: PlatformAPI = {
  mediaUrl(
    filePath: string,
    opts?: { dl?: boolean; info?: boolean },
  ): string {
    const base = getHttpBaseUrl();
    const params = new URLSearchParams({ path: filePath });
    if (opts?.dl) params.set("dl", "1");
    if (opts?.info) params.set("info", "1");
    return `${base}/api/media?${params.toString()}`;
  },

  async mediaGetInfo(filePath: string): Promise<MediaInfo> {
    const base = getHttpBaseUrl();
    const res = await fetch(
      `${base}/api/media?path=${encodeURIComponent(filePath)}&info=1`,
    );
    if (!res.ok) throw new Error(`Failed to get media info: ${res.status}`);
    return res.json();
  },

  async showcaseList(): Promise<{ files: ShowcaseFileEntry[] }> {
    const base = getHttpBaseUrl();
    const res = await fetch(`${base}/api/showcase`);
    if (!res.ok) throw new Error(`Failed to list showcase: ${res.status}`);
    return res.json();
  },

  showcaseUrl(relativePath: string): string {
    const base = getHttpBaseUrl();
    return `${base}/api/showcase/${encodeURIComponent(relativePath)}`;
  },
};
