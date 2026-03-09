import { contextBridge, ipcRenderer } from "electron";

// Parse window ID from additionalArguments (--window-id=N)
const windowIdArg = process.argv.find((a) => a.startsWith("--window-id="));
const windowId = windowIdArg ? parseInt(windowIdArg.split("=")[1], 10) : 0;

const electronAPI = {
  windowId,
  getVersion: () => ipcRenderer.invoke("app:version") as Promise<string>,
  /** Notify main process of current active session key (#170) */
  updateSessionKey: (sessionKey: string) => ipcRenderer.send("session:update", sessionKey),
  platform: {
    mediaInfo: (filePath: string) => ipcRenderer.invoke("media:info", filePath),
    mediaServe: (filePath: string) => ipcRenderer.invoke("media:serve", filePath),
    mediaRange: (filePath: string, start: number, end: number) =>
      ipcRenderer.invoke("media:range", filePath, start, end),
    mediaUpload: (data: string, mimeType: string, fileName?: string) =>
      ipcRenderer.invoke("media:upload", data, mimeType, fileName) as Promise<{ path: string }>,
    showcaseList: () => ipcRenderer.invoke("showcase:list"),
    showcaseServe: (relPath: string) => ipcRenderer.invoke("showcase:serve", relPath),
  },
  node: {
    status: () => ipcRenderer.invoke("node:status") as Promise<string>,
    enable: (url: string, token: string) => ipcRenderer.invoke("node:enable", url, token) as Promise<string>,
    disable: () => ipcRenderer.invoke("node:disable") as Promise<string>,
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
