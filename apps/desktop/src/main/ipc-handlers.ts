import { app, ipcMain } from "electron";
import { handleMediaServe, handleMediaRange, handleMediaInfo, handleMediaUpload } from "./media-handler";
import { handleShowcaseList, handleShowcaseServe } from "./showcase-handler";
import { NodeConnectionManager } from "./node-connection";

let nodeConnection: NodeConnectionManager | null = null;

export function registerIpcHandlers(nodeConn?: NodeConnectionManager) {
  nodeConnection = nodeConn ?? null;

  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("media:info", (_event, filePath: string) => handleMediaInfo(filePath));
  ipcMain.handle("media:serve", (_event, filePath: string) => handleMediaServe(filePath));
  ipcMain.handle("media:range", (_event, filePath: string, start: number, end: number) =>
    handleMediaRange(filePath, start, end),
  );
  ipcMain.handle("media:upload", (_event, data: string, mimeType: string, fileName?: string) =>
    handleMediaUpload(data, mimeType, fileName),
  );
  ipcMain.handle("showcase:list", () => handleShowcaseList());
  ipcMain.handle("showcase:serve", (_event, relPath: string) => handleShowcaseServe(relPath));

  // Node connection IPC
  ipcMain.handle("node:status", () => nodeConnection?.getState() ?? "disabled");
  ipcMain.handle("node:enable", (_event, url: string, token: string) => {
    nodeConnection?.start(url, token);
    return nodeConnection?.getState() ?? "disabled";
  });
  ipcMain.handle("node:disable", () => {
    nodeConnection?.stop();
    return "disabled";
  });
}
