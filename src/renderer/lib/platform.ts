/**
 * Platform abstraction — Electron-specific helpers.
 */
export const platform = {
  /** Convert a local file path to a fetchable URL via the custom protocol */
  mediaUrl(filePath: string): string {
    return `intelli-claw://${encodeURIComponent(filePath)}`;
  },

  get isElectron(): boolean {
    return typeof window !== "undefined" && "electron" in window;
  },
};
