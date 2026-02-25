import type { PlatformAPI, MediaInfo, ShowcaseFileEntry } from "./types";
import type { ElectronAPI } from "../../../preload/index";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export const electronPlatform: PlatformAPI = {
  mediaUrl(filePath) {
    // Use custom protocol for direct URL access (img, video, audio src)
    return `intelli-claw://${encodeURIComponent(filePath)}`;
  },

  async mediaGetInfo(filePath): Promise<MediaInfo> {
    return window.electronAPI.platform.mediaInfo(filePath);
  },

  async showcaseList(): Promise<{ files: ShowcaseFileEntry[] }> {
    return window.electronAPI.platform.showcaseList();
  },

  showcaseUrl(relativePath) {
    // Showcase files served via custom protocol
    return `intelli-claw://showcase/${encodeURIComponent(relativePath)}`;
  },
};
