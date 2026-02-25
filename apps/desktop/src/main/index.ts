import { app, BrowserWindow, shell, protocol, net, Menu, screen } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { registerIpcHandlers } from "./ipc-handlers";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === "win32") {
  app.setAppUserModelId(app.getName());
}

let mainWindow: BrowserWindow | null = null;
let nextWindowId = 0;
let isQuitting = false;

// --- Window state persistence ---

interface WindowState {
  id: number;
  bounds: Electron.Rectangle;
}

const windowMap = new Map<number, BrowserWindow>();

function windowStatePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function loadWindowStates(): WindowState[] {
  try {
    const data = readFileSync(windowStatePath(), "utf-8");
    const states = JSON.parse(data) as WindowState[];
    if (Array.isArray(states) && states.length > 0) return states;
  } catch {}
  return [];
}

function saveWindowStates() {
  const states: WindowState[] = [];
  for (const [id, win] of windowMap) {
    if (!win.isDestroyed()) {
      states.push({ id, bounds: win.getBounds() });
    }
  }
  try {
    writeFileSync(windowStatePath(), JSON.stringify(states));
  } catch (err) {
    console.error("[main] Failed to save window states:", err);
  }
}

/** Check that the bounds are at least partially visible on some display */
function boundsVisible(bounds: Electron.Rectangle): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const { x, y, width, height } = d.workArea;
    // At least 100px overlap horizontally and 50px vertically
    return (
      bounds.x + bounds.width > x + 100 &&
      bounds.x < x + width - 100 &&
      bounds.y + bounds.height > y + 50 &&
      bounds.y < y + height - 50
    );
  });
}

// --- Window creation ---

interface CreateWindowOpts {
  windowId?: number;
  bounds?: Electron.Rectangle;
}

function createWindow(opts?: CreateWindowOpts): BrowserWindow {
  const windowId = opts?.windowId ?? nextWindowId++;
  if (windowId >= nextWindowId) nextWindowId = windowId + 1;

  const useBounds = opts?.bounds && boundsVisible(opts.bounds);
  const windowOpts: Electron.BrowserWindowConstructorOptions = {
    ...(useBounds ? opts.bounds : { width: 1200, height: 800 }),
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
      additionalArguments: [`--window-id=${windowId}`],
    },
  };

  const win = new BrowserWindow(windowOpts);
  windowMap.set(windowId, win);

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
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Persist window states on move/resize (debounced) so dev crashes don't lose state
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowStates, 1000);
  };
  win.on("moved", debouncedSave);
  win.on("resized", debouncedSave);

  win.on("closed", () => {
    windowMap.delete(windowId);
    if (!isQuitting) saveWindowStates();
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

app.on("before-quit", () => {
  isQuitting = true;
  saveWindowStates();
});

app.whenReady().then(() => {
  registerProtocol();
  registerIpcHandlers();

  // Restore previous windows, or create a fresh one
  const savedStates = loadWindowStates();
  if (savedStates.length > 0) {
    for (const state of savedStates) {
      createWindow({ windowId: state.id, bounds: state.bounds });
    }
  } else {
    createWindow();
  }

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
