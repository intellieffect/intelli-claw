/**
 * Electron main process — minimal shell + Claude Code session orchestrator.
 *
 * The renderer is the Vite-built apps/web bundle. The shell talks to the
 * loopback channel plugin spawned by each Claude Code session it owns.
 *
 * Dev: loads http://localhost:4000 (Vite dev server).
 * Prod: loads the packaged renderer via the app:// protocol so CORS works
 *       against the plugin (file:// would produce a null origin).
 */

import { app, BrowserWindow, ipcMain, shell, protocol, net } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SessionManager } from "./session-manager.js";
import {
  loadSessionHistory,
  type SessionHistoryRequest,
} from "./session-history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

const RENDERER_DIR = path.join(__dirname, "../renderer");

const sessions = new SessionManager();
let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function broadcastSessionsChanged(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("session:changed", sessions.list());
}

ipcMain.handle(
  "session:spawn",
  (_event, opts: { uuid?: string; cwd: string }) => {
    const info = sessions.spawn(opts);
    broadcastSessionsChanged();
    return info;
  },
);

ipcMain.handle("session:list", () => sessions.list());

ipcMain.handle("session:stop", (_event, port: number) => {
  sessions.stop(port);
  // The pty.onExit handler will emit a session:changed broadcast.
});

ipcMain.handle(
  "session:history",
  (_event, req: SessionHistoryRequest) => loadSessionHistory(req),
);

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:4000");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadURL("app://./index.html");
  }
}

sessions.onChange(broadcastSessionsChanged);

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const relPath = decodeURIComponent(url.pathname);
    const filePath = path.join(RENDERER_DIR, relPath.replace(/^\//, ""));
    return net.fetch(pathToFileURL(filePath).toString());
  });

  return createWindow();
});

app.on("window-all-closed", () => {
  sessions.shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => {
  sessions.shutdown();
});
