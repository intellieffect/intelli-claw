import { app, BrowserWindow, shell, protocol, net, Menu, screen, dialog, nativeImage, ipcMain } from "electron";
import { join, resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import { spawn, type ChildProcess } from "child_process";

// Read version from package.json (bundled into the app)
const appVersion = app.getVersion(); // electron-builder sets this from package.json
import { registerIpcHandlers } from "./ipc-handlers";
import { NodeConnectionManager } from "./node-connection";
import { buildReloadTarget, type ReloadContext } from "./window-reload";

// --- Dev mode detection & isolation ---
const isDev = !app.isPackaged;

if (isDev) {
  // Use separate userData directory so dev and production don't share state
  app.setPath("userData", join(app.getPath("userData"), "-dev"));
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === "win32") {
  app.setAppUserModelId(isDev ? "com.openclaw.intelli-claw.dev" : app.getName());
}

let mainWindow: BrowserWindow | null = null;
let nextWindowId = 0;
let isQuitting = false;
const nodeConnection = new NodeConnectionManager();

// ── Claude Code session manager ──
let claudeProcess: ChildProcess | null = null;
const WEBCHAT_PORT = 4003;

function spawnClaudeCode(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = process.env.CLAUDE_CODE_CWD || app.getAppPath();

    const proc = spawn("claude", [
      "--dangerously-load-development-channels", "server:webchat",
      "--dangerously-skip-permissions",
    ], {
      cwd,
      env: { ...process.env, WEBCHAT_PORT: String(WEBCHAT_PORT) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    claudeProcess = proc;

    // Auto-confirm the development channel warning (sends Enter)
    let confirmed = false;
    const confirmTimer = setTimeout(() => {
      if (!confirmed && proc.stdin?.writable) {
        proc.stdin.write("\n");
        confirmed = true;
      }
    }, 3000);

    // Wait for webchat plugin to be ready (port listening)
    let ready = false;
    const checkReady = setInterval(() => {
      import("net").then(({ createConnection }) => {
        const sock = createConnection({ port: WEBCHAT_PORT, host: "127.0.0.1" });
        sock.on("connect", () => {
          sock.destroy();
          if (!ready) {
            ready = true;
            clearInterval(checkReady);
            clearTimeout(confirmTimer);
            console.log(`[claude-code] Ready on port ${WEBCHAT_PORT}`);
            resolve();
          }
        });
        sock.on("error", () => sock.destroy());
      });
    }, 1000);

    // Timeout after 30s
    setTimeout(() => {
      if (!ready) {
        clearInterval(checkReady);
        clearTimeout(confirmTimer);
        console.warn("[claude-code] Timed out waiting for webchat plugin");
        resolve(); // Don't block app start
      }
    }, 30000);

    proc.on("error", (err) => {
      console.error("[claude-code] Spawn error:", err);
      claudeProcess = null;
      clearInterval(checkReady);
      clearTimeout(confirmTimer);
      resolve(); // Don't block
    });

    proc.on("exit", (code) => {
      console.log("[claude-code] Exited with code:", code);
      claudeProcess = null;
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log("[claude-code]", line);
    });
  });
}

function killClaudeCode() {
  if (claudeProcess) {
    claudeProcess.kill("SIGTERM");
    claudeProcess = null;
  }
}

// Track active session key per window (windowId → sessionKey)
const windowSessionKeys = new Map<number, string>();

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
  sessionKey?: string;
  /** Start in Claude Code webchat mode */
  claudeCode?: boolean;
}

/**
 * Reload a window while preserving its current session (#256).
 * Uses windowSessionKeys (populated via session:update IPC) to rebuild
 * the correct URL/file target with the latest sessionKey.
 */
function reloadWindow(win: BrowserWindow): void {
  // Find windowId for this window
  let wid: number | undefined;
  for (const [id, w] of windowMap) {
    if (w === win) { wid = id; break; }
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const htmlPath = join(__dirname, "../renderer/index.html");

  const ctx: ReloadContext = {
    windowId: wid,
    windowSessionKeys,
    rendererUrl,
    rendererHtmlPath: htmlPath,
  };

  const target = buildReloadTarget(ctx);
  if (target.kind === "url") {
    win.loadURL(target.url);
  } else {
    win.loadFile(target.filePath, target.query ? { query: target.query } : undefined);
  }
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
    backgroundColor: isDev ? "#0d1117" : "#0a0a0a",
    title: isDev ? `iClaw [DEV] v${appVersion}` : `iClaw v${appVersion}`,
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

  // Auto-reload renderer on crash (GPU process death can kill the renderer)
  win.webContents.on("render-process-gone", (_event, details) => {
    console.warn("[main] Renderer crashed:", details.reason, "— reloading in 1s");
    if (details.reason !== "clean-exit") {
      setTimeout(() => {
        if (!win.isDestroyed()) reloadWindow(win);
      }, 1000);
    }
  });

  // Dev: load from Vite dev server, Prod: load built HTML
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  console.log("[main] ELECTRON_RENDERER_URL:", rendererUrl);

  // Append session query param if duplicating a session (#170)
  const sessionParam = opts?.sessionKey ? `session=${encodeURIComponent(opts.sessionKey)}` : "";
  const hash = opts?.claudeCode ? "#/claude-code" : "";

  if (rendererUrl) {
    const separator = rendererUrl.includes("?") ? "&" : "?";
    let url = sessionParam ? `${rendererUrl}${separator}${sessionParam}` : rendererUrl;
    if (hash) url += hash;
    win.loadURL(url);
  } else {
    const htmlPath = join(__dirname, "../renderer/index.html");
    if (sessionParam) {
      win.loadFile(htmlPath, { query: { session: opts!.sessionKey! }, hash });
    } else {
      win.loadFile(htmlPath, hash ? { hash } : undefined);
    }
  }

  // Persist window states on move/resize (debounced) so dev crashes don't lose state
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowStates, 1000);
  };
  win.on("moved", debouncedSave);
  win.on("resized", debouncedSave);

  const sendFocusState = (focused: boolean) => {
    if (!win.isDestroyed()) {
      win.webContents.send("window:focus-change", focused);
    }
  };

  win.on("focus", () => sendFocusState(true));
  win.on("blur", () => sendFocusState(false));
  win.webContents.once("did-finish-load", () => {
    sendFocusState(win.isFocused());
  });

  win.on("closed", () => {
    windowMap.delete(windowId);
    if (!isQuitting) saveWindowStates();
    if (win === mainWindow) mainWindow = null;
  });

  if (!mainWindow) mainWindow = win;
  return win;
}

// ---- API server URL for remote media fallback (#110) ----
// Derive from VITE_GATEWAY_URL (wss://host:port → https://host:4001)
// The API server is exposed via Tailscale Serve (HTTPS) on port 4001.
function getApiBaseUrl(): string | null {
  // Allow explicit override via VITE_API_URL
  const explicit = process.env.VITE_API_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const gwUrl = process.env.VITE_GATEWAY_URL || process.env.GATEWAY_URL;
  if (!gwUrl) return null;
  try {
    const u = new URL(gwUrl);
    // Use HTTPS (Tailscale Serve wraps the HTTP API server)
    return `https://${u.hostname}:${process.env.API_PORT || "4001"}`;
  } catch {
    return null;
  }
}

// Register custom protocol for media/showcase serving
function registerProtocol() {
  const apiBase = getApiBaseUrl();
  console.log("[protocol] API base URL for remote fallback:", apiBase || "(none)");

  const PROTOCOL_PREFIX = "intelli-claw://";
  const SHOWCASE_PREFIX = "intelli-claw://showcase/";

  protocol.handle("intelli-claw", async (request) => {
    const raw = request.url;

    // --- Showcase files ---
    if (raw.startsWith(SHOWCASE_PREFIX)) {
      const relPath = decodeURIComponent(raw.slice(SHOWCASE_PREFIX.length));
      if (relPath.includes("..")) return new Response("Forbidden", { status: 403 });
      // Serve showcase via API fallback (no local showcase on remote machines)
      if (apiBase) {
        try {
          const res = await net.fetch(`${apiBase}/api/showcase/${encodeURIComponent(relPath)}`);
          if (res.ok) return res;
        } catch { /* fall through */ }
      }
      return new Response("Not found", { status: 404 });
    }

    // --- Media files ---
    // URL format: intelli-claw://<percent-encoded-absolute-path>
    // IMPORTANT: Don't use new URL() — custom protocols with // cause the
    // parser to treat the encoded path as a hostname, losing the pathname.
    const encoded = raw.slice(PROTOCOL_PREFIX.length);
    const filePath = decodeURIComponent(encoded);

    // Security: block traversal
    if (filePath.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }

    // 1. Try local file first (fast path when running on the same machine)
    if (filePath.startsWith("/")) {
      try {
        const localRes = await net.fetch(`file://${filePath}`);
        if (localRes.ok) return localRes;
      } catch {
        // Local file not found — continue to API fallback
      }
    }

    // 2. Fallback: fetch from API server on the gateway host (#110)
    if (apiBase) {
      try {
        const apiUrl = `${apiBase}/api/media?path=${encodeURIComponent(filePath)}`;
        console.log("[protocol] API fallback:", apiUrl);
        const apiRes = await net.fetch(apiUrl);
        if (apiRes.ok) return apiRes;
        console.warn("[protocol] API fallback failed:", apiRes.status, filePath);
      } catch (err) {
        console.warn("[protocol] API fallback error:", err, filePath);
      }
    } else {
      console.warn("[protocol] No API base URL configured — cannot fallback for:", filePath);
    }

    return new Response("Not found", { status: 404 });
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
  killClaudeCode();
});

// Prevent GPU/child process crashes from killing the app
app.on("child-process-gone", (_event, details) => {
  console.warn("[main] child-process-gone:", details.type, "reason:", details.reason, "exitCode:", details.exitCode);
  // Don't quit — let Chromium restart the GPU process
});

app.on("render-process-gone", (_event, _webContents, details) => {
  console.warn("[main] render-process-gone:", details.reason, "exitCode:", details.exitCode);
});

app.whenReady().then(async () => {
  // Set Dock icon (macOS) — ensures iClaw icon shows in Dock & Cmd+Tab even in dev mode
  if (process.platform === "darwin") {
    const iconPath = join(__dirname, "../../../../resources/icon.png");
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) app.dock.setIcon(icon);
    } catch (err) {
      console.warn("[main] Failed to set dock icon:", err);
    }
  }

  registerProtocol();
  registerIpcHandlers(nodeConnection);

  // Start Claude Code session (webchat channel plugin)
  console.log("[main] Starting Claude Code session...");
  await spawnClaudeCode();

  // IPC: renderer reports its active session key (#170)
  ipcMain.on("session:update", (event, sessionKey: string) => {
    // Find the windowId for the sender
    for (const [wid, win] of windowMap) {
      if (!win.isDestroyed() && win.webContents === event.sender) {
        windowSessionKeys.set(wid, sessionKey);
        break;
      }
    }
  });

  // Restore previous windows, or create a fresh one — default to Claude Code mode
  const useClaudeCode = !!claudeProcess;
  const savedStates = loadWindowStates();
  if (savedStates.length > 0) {
    for (const state of savedStates) {
      createWindow({ windowId: state.id, bounds: state.bounds, claudeCode: useClaudeCode });
    }
  } else {
    createWindow({ claudeCode: useClaudeCode });
  }

  // Application menu with Cmd+N for new window
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: `About iClaw v${appVersion}`,
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "About iClaw",
              message: `iClaw v${appVersion}`,
              detail: `Version: ${appVersion}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode: ${process.versions.node}\nPlatform: ${process.platform} ${process.arch}`,
              buttons: ["OK"],
            });
          },
        },
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
          accelerator: process.platform === "darwin" ? "Cmd+N" : "Ctrl+N",
          click: () => {
            // Duplicate current session in new window (#170)
            const focused = BrowserWindow.getFocusedWindow();
            let sessionKey: string | undefined;
            if (focused) {
              // Find the windowId for the focused window
              for (const [wid, win] of windowMap) {
                if (win === focused) {
                  sessionKey = windowSessionKeys.get(wid);
                  break;
                }
              }
            }
            createWindow(sessionKey ? { sessionKey } : undefined);
          },
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
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && !focused.isDestroyed()) reloadWindow(focused);
          },
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && !focused.isDestroyed()) {
              focused.webContents.session.clearCache().then(() => reloadWindow(focused));
            }
          },
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        {
          label: "Claude Code",
          accelerator: "CmdOrCtrl+Shift+C",
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            if (focused && !focused.isDestroyed()) {
              focused.webContents.executeJavaScript(`
                if (location.hash === '#/claude-code') {
                  location.hash = '';
                  location.reload();
                } else {
                  location.hash = '#/claude-code';
                  location.reload();
                }
              `);
            }
          },
        },
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
