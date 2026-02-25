import { app, BrowserWindow, shell, protocol, net, Menu } from "electron";
import { join } from "path";
import { registerIpcHandlers } from "./ipc-handlers";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === "win32") {
  app.setAppUserModelId(app.getName());
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // External links open in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Rewrite Origin header for WebSocket connections to the gateway
  // so the gateway's allowedOrigins check passes in Electron dev mode
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["wss://*/*", "ws://*/*"] },
    (details, callback) => {
      const gatewayUrl = new URL(details.url);
      details.requestHeaders["Origin"] = `https://${gatewayUrl.hostname}:4000`;
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Dev: load from Vite dev server, Prod: load built HTML
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  console.log("[main] ELECTRON_RENDERER_URL:", rendererUrl);

  if (rendererUrl) {
    win.loadURL(rendererUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => {
    if (win === mainWindow) mainWindow = null;
  });

  if (!mainWindow) mainWindow = win;
  return win;
}

// Register custom protocol for media/showcase serving
function registerProtocol() {
  protocol.handle("intelli-claw", async (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);

    // Security: block traversal
    if (filePath.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      return await net.fetch(`file://${filePath}`);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

// Allow self-signed certificates (local gateway uses wss:// with self-signed cert)
app.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(true);
});

app.whenReady().then(() => {
  registerProtocol();
  registerIpcHandlers();
  createWindow();

  // Application menu with Cmd+N for new window
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => createWindow(),
        },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
