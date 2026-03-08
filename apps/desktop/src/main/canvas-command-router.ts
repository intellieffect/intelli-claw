import { BrowserWindow } from "electron";
import type { CanvasManager } from "./canvas-manager";
import type { InvokeHandler } from "@intelli-claw/shared";

/**
 * Creates an InvokeHandler that routes canvas commands to the CanvasManager.
 * Returns { ok, payload } or { ok: false, error } for each command.
 */
export function createCanvasRouter(manager: CanvasManager): InvokeHandler {
  return async (_id: string, command: string, params: unknown) => {
    // Check that the app is in the foreground
    const focusedWin = BrowserWindow.getFocusedWindow();
    if (!focusedWin?.isVisible()) {
      throw new Error("Canvas requires foreground window");
    }

    const p = (params ?? {}) as Record<string, unknown>;

    switch (command) {
      case "canvas.present":
        return manager.present(p as any);

      case "canvas.navigate":
        return manager.navigate(p as any);

      case "canvas.eval":
        return manager.eval(p as any);

      case "canvas.snapshot":
        return manager.snapshot(p as any);

      case "canvas.hide":
        return manager.hide();

      case "canvas.a2ui.push":
        return manager.a2uiPush(p as any);

      case "canvas.a2ui.reset":
        return manager.a2uiReset();

      default:
        throw new Error(`Unknown canvas command: ${command}`);
    }
  };
}
