import { BrowserWindow, WebContentsView } from "electron";

/**
 * CanvasManager — manages a WebContentsView for canvas/A2UI rendering.
 *
 * Attaches a child WebContentsView to the main BrowserWindow, positioned
 * as a right-side split pane (default 40% width).
 */

interface PresentParams {
  url?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface NavigateParams {
  url: string;
}

interface EvalParams {
  js: string;
}

interface SnapshotParams {
  format?: "png" | "jpeg";
  quality?: number;
}

interface A2UIPushParams {
  text?: string;
  jsonl?: string;
  url?: string;
}

const DEFAULT_SPLIT_RATIO = 0.4;

export class CanvasManager {
  private view: WebContentsView | null = null;
  private mainWindow: BrowserWindow | null = null;
  private canvasHostUrl = "";

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  setCanvasHostUrl(url: string): void {
    this.canvasHostUrl = url;
  }

  async present(params?: PresentParams): Promise<{ ok: boolean }> {
    const win = this.getMainWindow();

    // Destroy existing view if any
    this.destroyView();

    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Allow self-signed certificates (gateway TLS)
    this.view.webContents.session.setCertificateVerifyProc((_request, callback) => {
      callback(0); // accept
    });

    win.contentView.addChildView(this.view);
    this.layoutView(params);

    // Recalculate layout on window resize
    win.on("resized", this.handleResize);

    const url = params?.url || "about:blank";
    await this.view.webContents.loadURL(url);

    return { ok: true };
  }

  async navigate(params: NavigateParams): Promise<{ ok: boolean }> {
    if (!this.view) throw new Error("Canvas not presented");
    await this.view.webContents.loadURL(params.url);
    return { ok: true };
  }

  async eval(params: EvalParams): Promise<{ result: unknown }> {
    if (!this.view) throw new Error("Canvas not presented");
    const result = await this.view.webContents.executeJavaScript(params.js);
    return { result };
  }

  async snapshot(params?: SnapshotParams): Promise<{ dataUrl: string }> {
    if (!this.view) throw new Error("Canvas not presented");
    const image = await this.view.webContents.capturePage();
    const format = params?.format || "png";
    const quality = params?.quality ?? 90;
    let dataUrl: string;
    if (format === "jpeg") {
      dataUrl = `data:image/jpeg;base64,${image.toJPEG(quality).toString("base64")}`;
    } else {
      dataUrl = image.toDataURL();
    }
    return { dataUrl };
  }

  async hide(): Promise<{ ok: boolean }> {
    this.destroyView();
    return { ok: true };
  }

  async a2uiPush(params: A2UIPushParams): Promise<{ ok: boolean }> {
    if (!this.canvasHostUrl) throw new Error("No canvasHostUrl available");

    // If canvas not yet presented, present with the A2UI renderer URL
    if (!this.view) {
      await this.present({ url: this.canvasHostUrl });
    }

    // Navigate to canvas host URL if not already there
    const currentUrl = this.view?.webContents.getURL() || "";
    if (!currentUrl.startsWith(this.canvasHostUrl)) {
      await this.view!.webContents.loadURL(this.canvasHostUrl);
    }

    // Inject A2UI content
    if (params.jsonl) {
      await this.view!.webContents.executeJavaScript(
        `window.__a2ui_push(${JSON.stringify(params.jsonl)})`,
      );
    } else if (params.text) {
      await this.view!.webContents.executeJavaScript(
        `window.__a2ui_push(${JSON.stringify(JSON.stringify({ type: "text", text: params.text }))})`,
      );
    } else if (params.url) {
      await this.view!.webContents.loadURL(params.url);
    }

    return { ok: true };
  }

  async a2uiReset(): Promise<{ ok: boolean }> {
    if (!this.view) return { ok: true };
    await this.view.webContents.executeJavaScript("window.__a2ui_reset?.()");
    return { ok: true };
  }

  get isPresented(): boolean {
    return this.view !== null;
  }

  cleanup(): void {
    this.destroyView();
  }

  // --- Private ---

  private getMainWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length === 0) throw new Error("No window available for canvas");
      this.mainWindow = wins[0];
    }
    return this.mainWindow;
  }

  private layoutView(params?: PresentParams): void {
    if (!this.view || !this.mainWindow) return;
    const [winWidth, winHeight] = this.mainWindow.getContentSize();

    if (params?.x !== undefined && params?.y !== undefined && params?.width && params?.height) {
      // Explicit positioning
      this.view.setBounds({
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });
    } else {
      // Default: right-side split pane
      const canvasWidth = Math.round(winWidth * DEFAULT_SPLIT_RATIO);
      this.view.setBounds({
        x: winWidth - canvasWidth,
        y: 0,
        width: canvasWidth,
        height: winHeight,
      });
    }
  }

  private handleResize = (): void => {
    if (!this.view || !this.mainWindow) return;
    const [winWidth, winHeight] = this.mainWindow.getContentSize();
    const canvasWidth = Math.round(winWidth * DEFAULT_SPLIT_RATIO);
    this.view.setBounds({
      x: winWidth - canvasWidth,
      y: 0,
      width: canvasWidth,
      height: winHeight,
    });
  };

  private destroyView(): void {
    if (!this.view) return;
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.contentView.removeChildView(this.view);
        this.mainWindow.off("resized", this.handleResize);
      }
      this.view.webContents.close();
    } catch {
      // view may already be destroyed
    }
    this.view = null;
  }
}
