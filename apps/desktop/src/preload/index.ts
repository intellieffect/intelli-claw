import { contextBridge, ipcRenderer } from "electron";

// Parse window ID from additionalArguments (--window-id=N)
const windowIdArg = process.argv.find((a) => a.startsWith("--window-id="));
const windowId = windowIdArg ? parseInt(windowIdArg.split("=")[1], 10) : 0;

const electronAPI = {
  windowId,
  getVersion: () => ipcRenderer.invoke("app:version") as Promise<string>,
  platform: {
    mediaInfo: (filePath: string) => ipcRenderer.invoke("media:info", filePath),
    mediaServe: (filePath: string) => ipcRenderer.invoke("media:serve", filePath),
    mediaRange: (filePath: string, start: number, end: number) =>
      ipcRenderer.invoke("media:range", filePath, start, end),
    showcaseList: () => ipcRenderer.invoke("showcase:list"),
    showcaseServe: (relPath: string) => ipcRenderer.invoke("showcase:serve", relPath),
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
