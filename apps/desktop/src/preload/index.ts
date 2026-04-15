/**
 * Preload script.
 *
 * Exposes the Electron-only Session orchestration surface to the renderer.
 * In the browser/web context this object is absent, so the renderer falls
 * back to the manual `?channel=<port>` workflow.
 */

import { contextBridge, ipcRenderer } from "electron";

export interface SessionInfo {
  port: number;
  uuid: string | null;
  cwd: string;
  pid: number;
  startedAt: number;
}

const electronAPI = {
  platform: process.platform,
  electronVersion: process.versions.electron ?? "",
  session: {
    spawn: (opts: { uuid?: string; cwd: string }): Promise<SessionInfo> =>
      ipcRenderer.invoke("session:spawn", opts) as Promise<SessionInfo>,
    list: (): Promise<SessionInfo[]> =>
      ipcRenderer.invoke("session:list") as Promise<SessionInfo[]>,
    stop: (port: number): Promise<void> =>
      ipcRenderer.invoke("session:stop", port) as Promise<void>,
    onChanged: (cb: (snapshot: SessionInfo[]) => void): (() => void) => {
      const listener = (_event: unknown, snap: SessionInfo[]): void => cb(snap);
      ipcRenderer.on("session:changed", listener);
      return () => ipcRenderer.removeListener("session:changed", listener);
    },
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
