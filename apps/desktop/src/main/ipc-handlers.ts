import { app, ipcMain } from "electron";
import { handleMediaServe, handleMediaRange, handleMediaInfo, handleMediaUpload } from "./media-handler";
import { handleShowcaseList, handleShowcaseServe } from "./showcase-handler";

export function registerIpcHandlers() {
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
}
