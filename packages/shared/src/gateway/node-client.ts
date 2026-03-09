import { GatewayClient, type ConnectionState, type InvokeHandler } from "./client";

/**
 * NodeGatewayClient — wraps GatewayClient with node role + canvas capabilities.
 *
 * Connects to the same gateway as the operator client but with role: "node"
 * and caps: ["canvas"], enabling the gateway to route canvas commands
 * to this client's Electron WebContentsView.
 */
export class NodeGatewayClient {
  private client: GatewayClient;

  constructor(url: string, token: string, invokeHandler: InvokeHandler) {
    this.client = new GatewayClient(url, token, {
      role: "node",
      clientId: "openclaw-control-ui",
      clientMode: "node",
      caps: ["canvas"],
      commands: [
        "canvas.present",
        "canvas.navigate",
        "canvas.eval",
        "canvas.snapshot",
        "canvas.hide",
        "canvas.a2ui.push",
        "canvas.a2ui.reset",
      ],
      onInvoke: invokeHandler,
    });
  }

  connect(): void {
    this.client.connect();
  }

  disconnect(): void {
    this.client.disconnect();
  }

  get state(): ConnectionState {
    return this.client.getState();
  }

  get canvasHostUrl(): string {
    return this.client.canvasHostUrl;
  }

  onStateChange(handler: (state: ConnectionState) => void): () => void {
    return this.client.onStateChange(handler);
  }
}
