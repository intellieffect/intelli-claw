/**
 * Electron main process — minimal shell for intelli-claw.
 *
 * The renderer is the Vite-built apps/web bundle. All data flows through the
 * loopback Claude Code channel plugin (http://127.0.0.1:8790) — the main
 * process does no protocol work, no IPC relay, no origin rewriting.
 *
 * Dev: loads http://localhost:4000 (Vite dev server).
 * Prod: loads the packaged renderer via the app:// protocol so CORS works
 *       against the plugin (file:// would produce a null origin).
 */

import { app, BrowserWindow, shell, protocol, net } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

const RENDERER_DIR = path.join(__dirname, "../renderer");

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

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      // webSecurity stays on in prod (app:// origin satisfies the plugin's
      // CORS allowlist). In dev we load http://localhost:4000, which is also
      // allowlisted, so webSecurity can stay on there too.
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  if (isDev) {
    await win.loadURL("http://localhost:4000");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadURL("app://./index.html");
  }
}

app.whenReady().then(() => {
  // Map app://./<path> → out/renderer/<path> for prod bundles.
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const relPath = decodeURIComponent(url.pathname);
    const filePath = path.join(RENDERER_DIR, relPath.replace(/^\//, ""));
    return net.fetch(pathToFileURL(filePath).toString());
  });

  return createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
