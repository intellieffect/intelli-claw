import type { PlatformAPI } from "./types";
import { webPlatform } from "./web";
import { electronPlatform } from "./electron";

export type { PlatformAPI, MediaInfo, ShowcaseFileEntry } from "./types";

function detectPlatform(): PlatformAPI {
  if (typeof window !== "undefined" && "electronAPI" in window) {
    return electronPlatform;
  }
  return webPlatform;
}

/** Lazily resolved platform API — auto-detects web vs Electron */
export const platform: PlatformAPI = new Proxy({} as PlatformAPI, {
  get(_target, prop) {
    return (detectPlatform() as any)[prop];
  },
});
