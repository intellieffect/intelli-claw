/**
 * Preload script — minimal surface.
 *
 * The only reason this exists is so the web app can detect it's running
 * inside Electron via `"electronAPI" in window` (see apps/web/src/main.tsx).
 * No IPC channels are exposed: all data flows go through the loopback
 * Claude Code channel plugin.
 */

import { contextBridge } from "electron";

const electronAPI = {
  platform: process.platform,
  electronVersion: process.versions.electron ?? "",
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
