import { BrowserWindow } from "electron";
import { NodeGatewayClient, type ConnectionState } from "@intelli-claw/shared";
import { CanvasManager } from "./canvas-manager";
import { createCanvasRouter } from "./canvas-command-router";

/**
 * NodeConnectionManager — orchestrates the node-role WebSocket connection
 * and CanvasManager lifecycle in the Electron main process.
 */
export class NodeConnectionManager {
  private nodeClient: NodeGatewayClient | null = null;
  private canvasManager: CanvasManager;
  private stateChangeUnsub: (() => void) | null = null;

  constructor() {
    this.canvasManager = new CanvasManager();
  }

  start(url: string, token: string): void {
    this.stop();

    // Attach canvas to the first available window
    const mainWin = BrowserWindow.getAllWindows()[0];
    if (mainWin) {
      this.canvasManager.setMainWindow(mainWin);
    }

    const router = createCanvasRouter(this.canvasManager);

    this.nodeClient = new NodeGatewayClient(url, token, async (id, command, params) => {
      return router(id, command, params);
    });

    // When connected, pass canvasHostUrl to manager
    this.stateChangeUnsub = this.nodeClient.onStateChange((state) => {
      if (state === "connected" && this.nodeClient) {
        const hostUrl = this.nodeClient.canvasHostUrl;
        if (hostUrl) {
          this.canvasManager.setCanvasHostUrl(hostUrl);
        }
      }
    });

    this.nodeClient.connect();
    console.log("[NodeConn] Started node connection to", url);
  }

  stop(): void {
    if (this.stateChangeUnsub) {
      this.stateChangeUnsub();
      this.stateChangeUnsub = null;
    }
    if (this.nodeClient) {
      this.nodeClient.disconnect();
      this.nodeClient = null;
    }
    this.canvasManager.cleanup();
    console.log("[NodeConn] Stopped");
  }

  getState(): ConnectionState | "disabled" {
    if (!this.nodeClient) return "disabled";
    return this.nodeClient.state;
  }
}
